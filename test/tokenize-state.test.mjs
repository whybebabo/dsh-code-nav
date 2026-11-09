/**
 * 跨块分词状态（tokenizeLinesWithState）的回归测试。
 *
 * 目标：把一段文本按「行边界」切成多块、逐块带状态分词，结果必须与整文本
 * `tokenizeLines` 逐段完全一致（raw / segs 文本与 class / str 标志），覆盖
 * 块注释、嵌套块注释、模板字符串、三引号、C# 逐字串、Go 原始串、Lua 长注释、
 * XML 注释 / CDATA / 标签与属性、YAML 块标量、properties 续行。
 *
 * 分块约定与客户端 `tokenizeChunk` 一致：非末块文本以行分隔符结尾，`split`
 * 会多出一个尾随空行，调用方把它丢掉后再拼接（`tokenizeLinesWithState` 返回
 * 的 state 是最后一个真实行结束时的状态，见 src/tokenize.js 的 JSDoc）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenizeLines, tokenizeLinesWithState } from "../src/tokenize.js";
import { LANG_META } from "../src/lang-registry.js";
import { planChunk } from "../src/file-chunks.js";

/** 把文本切在第 N 行（1-based）的换行符之后；返回按这些切点分出的块。 */
function chunksAfterLines(text, lineNumbers) {
  const bounds = [0];
  for (const n of lineNumbers) {
    let seen = 0;
    let at = -1;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "\n") continue;
      seen += 1;
      if (seen === n) {
        at = i + 1;
        break;
      }
    }
    assert.notStrictEqual(at, -1, `第 ${n} 行没有行尾换行符，无法在行边界切块`);
    assert.ok(bounds[bounds.length - 1] < at, `切点必须递增（第 ${n} 行）`);
    bounds.push(at);
  }
  bounds.push(text.length);
  const chunks = [];
  for (let i = 0; i < bounds.length - 1; i += 1) chunks.push(text.slice(bounds[i], bounds[i + 1]));
  return chunks;
}

/** 每行 segs 文本拼接必须还原 raw（分词不丢字符）。 */
function assertByteJoin(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const joined = lines[i].segs.map((s) => s.text).join("");
    assert.strictEqual(joined, lines[i].raw, `第 ${i + 1} 行 segs 拼接后与 raw 不一致`);
  }
}

/**
 * 核心断言：按 `lineNumbers` 切块、逐块带状态分词，拼接结果与整文本完全一致。
 * 每块还额外检查：
 *   - 返回的 lines 与 `tokenizeLines(同一块)` 完全一致（差异只有 state）；
 *   - state 走一遍 JSON 序列化 / 反序列化后继续使用，结果仍然一致。
 * @returns {object} 最后一块返回的 state
 */
function assertChunkedEqualsWhole(text, lang, lineNumbers) {
  const whole = tokenizeLines(text, lang);
  assert.ok(whole !== null, `${lang}: 整文本分词不应返回 null`);
  assertByteJoin(whole);
  const chunks = chunksAfterLines(text, lineNumbers);
  assert.ok(chunks.length >= 3, "至少应切成 2 块（含整块文本为一块之外的另一块）");

  const got = [];
  let state;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    assert.ok(chunk.length > 0, `第 ${i + 1} 块不应为空`);
    const result = tokenizeLinesWithState(chunk, lang, state);
    assert.ok(result !== null, `${lang}: 第 ${i + 1} 块分词不应返回 null`);
    // 第一块没有前置状态：必须与 tokenizeLines 完全一致（只有 state 是新增信息）
    if (i === 0) {
      assert.deepStrictEqual(result.lines, tokenizeLines(chunk, lang), `${lang}: 首块与 tokenizeLines 不一致`);
    }
    assertByteJoin(result.lines);
    // 状态必须能过 JSON 往返（客户端可能要把它塞进 ref / 序列化）
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result.state)), result.state, `${lang}: 第 ${i + 1} 块 state JSON 往返不一致`);

    let lines = result.lines;
    const isLast = i === chunks.length - 1;
    if (!isLast) {
      // 非末块以行分隔符结尾：tokenizeLines 会多出尾随空行，调用方丢弃（客户端 tokenizeChunk 同款）
      assert.strictEqual(lines[lines.length - 1].raw, "", `${lang}: 第 ${i + 1} 块尾随空行`);
      lines = lines.slice(0, -1);
    }
    for (const line of lines) got.push(line);
    state = JSON.parse(JSON.stringify(result.state));
  }
  assert.deepStrictEqual(got, whole, `${lang}: 分块拼接结果与整文本不一致`);
  return state;
}

// ---------------------------------------------------------------------------
// 1. 块注释 / 嵌套块注释
// ---------------------------------------------------------------------------

test("cpp 块注释跨块：注释里的代码不会被当代码分词", () => {
  const text = [
    "int before = 1;",
    "/* long comment opens here",
    "class Fake { }",
    "class Fake2 { }",
    "still inside the comment",
    "*/",
    "int after = 2;",
    ""
  ].join("\n");
  // 4 个连续块都落在注释内部
  assertChunkedEqualsWhole(text, "cpp", [2, 3, 4, 5]);
  // 整文本里那些行确实全是注释（否则本测试就是空转）
  const whole = tokenizeLines(text, "cpp");
  for (let i = 1; i <= 4; i += 1) {
    assert.ok(whole[i].segs.every((s) => s.cls === "c-comment"), `第 ${i + 1} 行应全是注释`);
  }
});

test("cpp 块注释跨块（CRLF）", () => {
  const text = ["int a = 1;", "/* open", "class Fake { }", "*/", "int b = 2;", ""].join("\r\n");
  assertChunkedEqualsWhole(text, "cpp", [2, 3]);
});

test("rust 嵌套块注释跨块：嵌套深度状态要跨块保持", () => {
  const text = [
    "fn before() {}",
    "/* outer",
    "   /* inner level two",
    "   */",
    "   still outer",
    "   /* inner again",
    "   */",
    "*/",
    "fn after() {}",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "rust", [2, 3, 4, 5, 6, 7]);
  const whole = tokenizeLines(text, "rust");
  assert.ok(whole[7].segs.every((s) => s.cls === "c-comment"), "外层注释的最后一行应仍是注释");
});

test("lua 长注释跨块（多级 = 定界符）", () => {
  const text = [
    "local a = 1",
    "--[==[ long comment",
    "fake_func()",
    "still comment",
    "]==]",
    "local b = 2",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "lua", [2, 3, 4]);
});

// ---------------------------------------------------------------------------
// 2. 跨行字符串（模板 / 三引号 / 逐字串 / 原始串）
// ---------------------------------------------------------------------------

test("javascript 模板字符串跨块", () => {
  const text = [
    "const before = 1;",
    "const tpl = `alpha",
    "beta ${notCode()}",
    "gamma",
    "`;",
    "const after = 2;",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "javascript", [2, 3, 4]);
});

test("python 三引号字符串跨块（docstring）", () => {
  const text = [
    "def f():",
    '    """doc',
    "    class Fake:",
    "        pass",
    '    """',
    "    return 1",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "python", [2, 3, 4]);
});

test("csharp 逐字字符串跨块（\"\" 转义与换行）", () => {
  const text = [
    "class A {",
    "  void M() {",
    '    var s = @"first',
    'line ""quoted"" still string',
    'last";',
    "  }",
    "}"
  ].join("\n") + "\n";
  assertChunkedEqualsWhole(text, "csharp", [3, 4]);
});

test("csharp 插值逐字字符串（$@\"）跨块", () => {
  const text = [
    "class A {",
    '  string S = $@"value',
    "second line",
    '";',
    "}"
  ].join("\n") + "\n";
  assertChunkedEqualsWhole(text, "csharp", [2, 3]);
});

test("go 反引号原始字符串跨块", () => {
  const text = [
    "package main",
    "var s = `raw",
    "  func Fake() {}",
    "  last line",
    "`",
    "var after = 1",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "go", [2, 3, 4]);
});

test("toml 三引号字符串跨块", () => {
  const text = [
    "title = \"x\"",
    'multi = """',
    "line one",
    "line two",
    '"""',
    "key = 1",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "toml", [2, 3, 4]);
});

// ---------------------------------------------------------------------------
// 3. XML：注释 / CDATA / 标签与属性跨行
// ---------------------------------------------------------------------------

test("xml 注释与 CDATA 跨块", () => {
  const text = [
    "<root>",
    "  <!-- comment opens",
    "  <fake attr=\"1\"/>",
    "  -->",
    "  <![CDATA[",
    "  <fake-cdata/>",
    "  ]]>",
    "  <real/>",
    "</root>",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "xml", [2, 3, 4, 5, 6]);
});

test("xml 标签内属性跨行：标签状态跨块保持", () => {
  const text = [
    "<root>",
    "  <item",
    "    attr=\"v\"",
    "    other=\"w\">",
    "    text",
    "  </item>",
    "</root>",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "xml", [2, 3, 4]);
  // 属性名在整文本里是 c-attr，块边界不应把它降级成普通文本
  const whole = tokenizeLines(text, "xml");
  const attrLine = whole[2];
  const attrSeg = attrLine.segs.find((s) => s.text === "attr");
  assert.strictEqual(attrSeg.cls, "c-attr");
});

test("xml 属性值字符串跨块", () => {
  const text = [
    "<root>",
    "  <item attr=\"first",
    "second line\" other=\"x\">",
    "    text",
    "  </item>",
    "</root>",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "xml", [2, 3]);
});

// ---------------------------------------------------------------------------
// 4. 配置语言：YAML 块标量 / properties 续行
// ---------------------------------------------------------------------------

test("yaml 块标量跨块：正文行不被当键 / 注释", () => {
  const text = [
    "name: demo",
    "script: |",
    "  line one",
    "  key: not a key",
    "  # not a comment",
    "next: 2",
    "folded: >",
    "  folded text",
    "after: true",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "yaml", [2, 3, 4, 5, 6, 7]);
  const whole = tokenizeLines(text, "yaml");
  for (const i of [2, 3, 4]) {
    assert.strictEqual(whole[i].str, true, `第 ${i + 1} 行应是块标量正文`);
  }
});

test("properties 续行跨块：续行按值处理、不重新找键", () => {
  const text = [
    "a=1",
    "b=hello \\",
    "  world \\",
    "  again",
    "c=3",
    ""
  ].join("\n");
  assertChunkedEqualsWhole(text, "properties", [2, 3, 4]);
  const whole = tokenizeLines(text, "properties");
  assert.strictEqual(whole[2].str, true, "续行行 str 应为 true");
  const keyC = whole[4].segs.find((s) => s.text === "c");
  assert.strictEqual(keyC.cls, "c-key", "续行结束后的 c=3 应重新被识别为键");
});

// ---------------------------------------------------------------------------
// 4.5 所有支持语言：各自跨行构造的分块等价（防止只覆盖手写的几种语言）
// ---------------------------------------------------------------------------

test("所有支持语言的跨行构造：分块结果与整文本一致", () => {
  let covered = 0;
  for (const [lang, meta] of Object.entries(LANG_META)) {
    if (meta.scriptBlocks === true) continue; // SFC 不在流式范围（上面单独测过）
    // 该语言声明的跨行构造：块注释 > 三引号 > 跨行普通字符串（与 tokenize 的判定优先级一致）
    let open;
    let close;
    let cls;
    if (Array.isArray(meta.blockComment)) {
      [open, close] = meta.blockComment;
      cls = "c-comment";
    } else if (Array.isArray(meta.tripleStrings) && meta.tripleStrings.length > 0) {
      const triple = meta.tripleStrings[0];
      open = Array.isArray(triple) ? triple[0] : triple;
      close = Array.isArray(triple) ? triple[1] : triple;
      cls = "c-string";
    } else if (Array.isArray(meta.multilineStrings) && meta.multilineStrings.length > 0) {
      const rule = meta.multilineStrings[0];
      open = rule.open;
      close = typeof rule.close === "string" && rule.close.length > 0 ? rule.close : rule.open;
      cls = "c-string";
    } else {
      continue; // 没有跨行构造的语言（shell / ini / dotenv / yaml / properties 等）
    }
    if (typeof open !== "string" || open.length === 0 || typeof close !== "string" || close.length === 0) continue;
    const text = ["before", open + "inside", "still inside", close, "after", ""].join("\n");
    // 构造行在整文本里确实被识别成该类别（否则这个语言的分支是空转）
    const whole = tokenizeLines(text, lang);
    for (let i = 1; i <= 3; i += 1) {
      assert.ok(whole[i].segs.length > 0, `${lang}: 第 ${i + 1} 行应有 token`);
      assert.ok(
        whole[i].segs.every((s) => s.cls === cls),
        `${lang}: 第 ${i + 1} 行应全是 ${cls}，实际 ${JSON.stringify(whole[i].segs.map((s) => s.cls))}`
      );
    }
    assertChunkedEqualsWhole(text, lang, [1, 2, 3]);
    covered += 1;
  }
  assert.ok(covered >= 10, `跨行构造覆盖的语言太少（${covered}）`);
});

// ---------------------------------------------------------------------------
// 5. 状态对象本身：形状 / 序列化 / 非法输入
// ---------------------------------------------------------------------------

const STATE_KEYS = [
  "blockDepth", "inString", "inTriple", "luaLongEnd", "propertiesContinued",
  "stringDoubled", "stringEnd", "stringEscape", "tripleEnd", "v",
  "xmlExpectName", "xmlInTag", "yamlScalarIndent"
];

test("state 是普通 JSON 对象：固定字段、原始值、不携带 chunk 文本", () => {
  const chunk = "/* open comment\nclass Fake { }\n";
  const result = tokenizeLinesWithState(chunk, "cpp");
  assert.ok(result !== null);
  assert.deepStrictEqual(Object.keys(result.state).sort(), STATE_KEYS);
  assert.strictEqual(result.state.v, 1);
  assert.strictEqual(result.state.blockDepth, 1);
  for (const [key, value] of Object.entries(result.state)) {
    assert.ok(
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
      `state.${key} 必须是原始值，实际是 ${typeof value}`
    );
    if (typeof value === "string") {
      assert.ok(value.length <= 16, `state.${key} 不应携带 chunk 文本（长度 ${value.length}）`);
    }
  }
  // JSON 往返后继续使用仍然一致
  const roundTripped = JSON.parse(JSON.stringify(result.state));
  const next = tokenizeLinesWithState("still comment */\nint x;\n", "cpp", roundTripped);
  const wholeNext = tokenizeLines("/* open comment\nclass Fake { }\nstill comment */\nint x;\n", "cpp");
  assert.deepStrictEqual(
    result.lines.slice(0, -1).concat(next.lines),
    wholeNext
  );
});

test("未传 / 非法 state 都从文件开头开始（结果与首个块一致）", () => {
  const text = "a=1\nb=hello \\\n  world\n";
  const fresh = tokenizeLinesWithState(text, "properties");
  const badStates = [
    null,
    42,
    "state",
    [],
    new Map(),
    { v: 2 },
    { v: 1 },
    { v: 1, blockDepth: "x" },
    // 版本对、字段全，但多出来的字段应被忽略（等价于「文件开头」）
    { v: 1, blockDepth: 0, luaLongEnd: "", inTriple: false, tripleEnd: "", inString: false, stringEnd: "", stringEscape: false, stringDoubled: false, xmlInTag: false, xmlExpectName: false, yamlScalarIndent: -1, propertiesContinued: false, extra: true },
    // 进行中但闭定界符为空：必须被当成非法状态，否则行扫描会原地死循环
    { v: 1, blockDepth: 0, luaLongEnd: "", inTriple: true, tripleEnd: "", inString: false, stringEnd: "", stringEscape: false, stringDoubled: false, xmlInTag: false, xmlExpectName: false, yamlScalarIndent: -1, propertiesContinued: false },
    { v: 1, blockDepth: 0, luaLongEnd: "", inTriple: false, tripleEnd: "", inString: true, stringEnd: "", stringEscape: false, stringDoubled: false, xmlInTag: false, xmlExpectName: false, yamlScalarIndent: -1, propertiesContinued: false }
  ];
  for (const bad of badStates) {
    const result = tokenizeLinesWithState(text, "properties", bad);
    assert.ok(result !== null);
    assert.deepStrictEqual(result.lines, fresh.lines);
    assert.deepStrictEqual(result.state, fresh.state);
  }
  // undefined 显式传入等同于不传
  assert.deepStrictEqual(tokenizeLinesWithState(text, "properties", undefined).lines, fresh.lines);
});

test("SFC（vue / svelte）不在流式范围内：整块行为 + 空 state", () => {
  const text = [
    "<template><div>hi</div></template>",
    "<script>",
    "const a = 1;",
    "/* comment",
    "class Fake { }",
    "*/",
    "</script>",
    "<style>.a { color: red; }</style>",
    ""
  ].join("\n");
  for (const lang of ["vue", "svelte"]) {
    const whole = tokenizeLines(text, lang);
    const first = tokenizeLinesWithState(text.slice(0, text.indexOf("<script>") + 9), lang);
    assert.ok(first !== null);
    assert.deepStrictEqual(first.lines, tokenizeLines(text.slice(0, text.indexOf("<script>") + 9), lang));
    assert.deepStrictEqual(first.state, {});
    // 即使传入一个合法状态也按整块处理、返回空状态
    const again = tokenizeLinesWithState(text, lang, { v: 1 });
    assert.deepStrictEqual(again.lines, whole);
    assert.deepStrictEqual(again.state, {});
    assert.deepStrictEqual(JSON.parse(JSON.stringify(again.state)), {});
  }
});

// ---------------------------------------------------------------------------
// 6. tokenizeLines 行为不变（整文本 / 500KB 上限 / null 语义）
// ---------------------------------------------------------------------------

test("tokenizeLinesWithState(text, lang) 与 tokenizeLines(text, lang) 完全一致", () => {
  const cases = [
    ["cpp", "int main() {\n  /* c\n  */\n  return 0;\n}\n"],
    ["javascript", "const re = /[/]+/g;\nconst s = `a\nb`;\n"],
    ["python", "def f():\n    '''doc\n    '''\n    return 1\n"],
    ["xml", "<a b=\"c\">\n<!-- d -->\n</a>\n"],
    ["yaml", "a: |\n  text\nb: 1\n"],
    ["properties", "a=1\nb=x \\\n y\n"],
    ["rust", "/* a /* b */ c */\nfn f() {}\n"]
  ];
  for (const [lang, text] of cases) {
    const whole = tokenizeLines(text, lang);
    const withState = tokenizeLinesWithState(text, lang);
    assert.deepStrictEqual(withState.lines, whole, `${lang}: 未带状态的 lines 应与 tokenizeLines 一致`);
    assert.strictEqual(withState.lines.truncated, whole.truncated, `${lang}: truncated 标记应一致`);
    assertByteJoin(whole);
  }
});

test("500,000 字符防御上限：每个块单独生效，标记与 tokenizeLines 一致", () => {
  const big = "a\n".repeat(260000); // 520,000 字符 > 500,000
  const whole = tokenizeLines(big, "javascript");
  assert.strictEqual(whole.truncated, true);
  const result = tokenizeLinesWithState(big, "javascript");
  assert.ok(result !== null);
  assert.strictEqual(result.lines.truncated, true);
  assert.deepStrictEqual(result.lines, whole);
  assertByteJoin(whole);
  // 分块调用时每块都低于上限 → 不带 truncated 标记
  const chunk = tokenizeLinesWithState(big.slice(0, 50000), "javascript");
  assert.strictEqual(chunk.lines.truncated, undefined);
});

test("未知语言 / 非法文本：两个 API 都返回 null", () => {
  assert.strictEqual(tokenizeLines("x", "not-a-language"), null);
  assert.strictEqual(tokenizeLinesWithState("x", "not-a-language"), null);
  assert.strictEqual(tokenizeLinesWithState("x", "not-a-language", {}), null);
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.strictEqual(tokenizeLines(bad, "cpp"), null);
    assert.strictEqual(tokenizeLinesWithState(bad, "cpp", undefined), null);
  }
});

test("真实 fixture：large-widgets.cpp 的字节拼接不变量 + 分块等价", () => {
  const path = join(import.meta.dirname, "..", "..", "big-demo", "large-widgets.cpp");
  const cpp = readFileSync(path, "utf8");
  // 分词器有 500KB 上限：整文本对照只看前 500,000 字符（与上限同口径，不触发截断）
  const text = cpp.slice(0, 500000);
  const whole = tokenizeLines(text, "cpp");
  assert.ok(whole !== null);
  assertByteJoin(whole);
  assert.deepStrictEqual(tokenizeLinesWithState(text, "cpp").lines, whole);

  // 按客户端的 planChunk（256 KiB、行对齐）切块，复刻 tokenizeChunk 的「丢尾随空行」
  const got = [];
  let state;
  let offset = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const piece = planChunk(text, offset);
    if (piece.raw !== "") {
      const result = tokenizeLinesWithState(piece.raw, "cpp", state);
      assert.ok(result !== null);
      let lines = result.lines;
      if (piece.eof !== true) {
        // 客户端 tokenizeChunk 的契约：非末块比 piece.lines 多一个边界 token（尾随空行）
        assert.strictEqual(lines.length, piece.lines.length + 1, "非末块应多一个尾随空行 token");
        assert.strictEqual(lines[lines.length - 1].raw, "");
        lines = lines.slice(0, piece.lines.length);
      } else {
        assert.strictEqual(lines.length, piece.lines.length);
      }
      for (const line of lines) got.push(line);
      state = result.state;
    }
    if (piece.eof) break;
    offset = piece.nextOffset;
  }
  assert.deepStrictEqual(got, whole, "large-widgets.cpp 分块结果应与整文本一致");
});

test("synthetic JS / Python / XML fixture 的字节拼接不变量", () => {
  const fixtures = [
    ["javascript", "const re = /[/]+/g; // x\nconst t = `a\nb ${c}`;\nclass A { m() {} }\n"],
    ["python", "def f(x):\n    '''doc\n    class Fake:\n    '''\n    return x\n"],
    ["xml", "<root>\n<!-- c\n<fake/>\n-->\n<![CDATA[<x>]]>\n</root>\n"]
  ];
  for (const [lang, text] of fixtures) {
    const whole = tokenizeLines(text, lang);
    assert.ok(whole !== null);
    assertByteJoin(whole);
    assert.deepStrictEqual(tokenizeLinesWithState(text, lang).lines, whole);
  }
});
