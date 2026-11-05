/**
 * dsh-code-nav — 分词器修复回归测试（P1：多字符字符串定界符 / P2：Rust 生命周期）。
 *
 * 覆盖三件事：
 *   1. 平铺 `strings` 里只允许单字符定界符 —— 之前 cpp 的 `R"`、rust 的 `r"`、
 *      kotlin 的 `"""` 是多字符项，而扫描闭合时拿单个字符去比整个定界符，
 *      永远合不上，整行剩余部分被涂成 c-string；
 *   2. 三引号（Kotlin / Swift）改走已有的跨行长字符串状态机；
 *   3. Rust 的 `'` 只把字符字面量当字符串，生命周期 `'a` 按普通标点处理。
 *
 * 通用不变量：`segs` 拼接必须逐字等于 `raw`（不丢字符、不重复字符）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeLines } from "../src/tokenize.js";
import { LANG_META } from "../src/lang-registry.js";

/** 断言分词结果结构完整：每行 segs 拼接 === raw。 */
function assertLineIntegrity(t, label) {
  assert.ok(Array.isArray(t), `${label}：tokenizeLines 返回 null`);
  for (let i = 0; i < t.length; i++) {
    const line = t[i];
    assert.equal(line.segs.map((s) => s.text).join(""), line.raw, `${label}：第 ${i + 1} 行 segs 未覆盖整行`);
    assert.ok(line.segs.every((s) => s.text.length > 0), `${label}：第 ${i + 1} 行出现空片段`);
  }
}

/** 某一行里指定类别的片段文本。 */
const textsOf = (line, cls) => line.segs.filter((s) => s.cls === cls).map((s) => s.text);
/** 一行里指定类别拼起来的文本。 */
const joinedOf = (line, cls) => textsOf(line, cls).join("");

test("registry: 平铺 strings 只剩单字符定界符，三引号改走 tripleStrings", () => {
  // 多字符定界符是 P1 的根因：扫描闭合时按单字符比较，永远不会命中。
  for (const lang of ["cpp", "rust", "kotlin"]) {
    for (const quote of LANG_META[lang].strings) {
      assert.equal(quote.length, 1, `${lang}.strings 含多字符定界符 ${JSON.stringify(quote)}`);
    }
  }
  assert.deepEqual(LANG_META.kotlin.tripleStrings, ['"""']);
  assert.deepEqual(LANG_META.swift.tripleStrings, ['"""']);
  assert.equal(LANG_META.rust.charLiteralOnly, true);
  // C# 的逐字字符串 `@"` 由 tokenize 的 verbatim 分支单独处理，本次不动。
  assert.ok(LANG_META.csharp.strings.includes('@"'));
  // 普通语言不应被误加标记
  assert.equal(LANG_META.javascript.charLiteralOnly, undefined);
  assert.equal(LANG_META.cpp.charLiteralOnly, undefined);
});

test("rust: r\"...\" 只吃掉字符串，后面的代码 / 注释保持原类别", () => {
  const t = tokenizeLines('let s = r"hi"; let n = 42; // t', "rust");
  assertLineIntegrity(t, "rust r\"...\"");
  const line = t[0];

  // `r` 退化成普通标识符，字符串是正常配对的 `"hi"`
  assert.equal(joinedOf(line, "c-string"), '"hi"', "字符串片段应当恰好是 \"hi\"");
  assert.ok(textsOf(line, "c-ident").includes("r"), "r 前缀应当是 c-ident");

  // 后半行不能被吞成字符串
  assert.ok(textsOf(line, "c-num").includes("42"), "42 应当是 c-num");
  assert.ok(textsOf(line, "c-kw").includes("let"), "let 应当是 c-kw");
  assert.ok(textsOf(line, "c-comment").includes("// t"), "// t 应当是 c-comment");
  assert.equal(line.str, false, "本行不是跨行长字符串续行");
});

test("cpp: R\"(x)\" 之后 int y = 1; 仍是代码", () => {
  const t = tokenizeLines('auto s = R"(x)"; int y = 1;', "cpp");
  assertLineIntegrity(t, "cpp R\"(...)\"");
  const line = t[0];

  // `R` 退化成标识符 + 普通字符串 `"(x)"`
  assert.ok(textsOf(line, "c-ident").includes("R"), "R 前缀应当是 c-ident");
  assert.equal(joinedOf(line, "c-string"), '"(x)"');

  // 字符串之后的代码保持正确类别
  assert.ok(textsOf(line, "c-kw").includes("int"), "int 应当是 c-kw");
  assert.ok(textsOf(line, "c-ident").includes("y"), "y 应当是 c-ident");
  assert.ok(textsOf(line, "c-num").includes("1"), "1 应当是 c-num");
  assert.equal(textsOf(line, "c-string").includes("; int y = 1;"), false);
});

test("kotlin: 单行三引号字符串", () => {
  // 内容里的 \n 是两个字面字符（三引号原始字符串里不转义）
  const t = tokenizeLines('val s = """a\\nb"""', "kotlin");
  assertLineIntegrity(t, "kotlin 单行三引号");
  const line = t[0];

  assert.equal(joinedOf(line, "c-string"), '"""a\\nb"""', "整段三引号内容是一个 c-string");
  assert.ok(textsOf(line, "c-kw").includes("val"));
  assert.ok(textsOf(line, "c-ident").includes("s"));
});

test("kotlin: 多行三引号跨行后，下一行恢复代码分词", () => {
  const t = tokenizeLines('val s = """a\nb"""\nval x = 1  // c', "kotlin");
  assertLineIntegrity(t, "kotlin 多行三引号");
  assert.equal(t.length, 3);

  // 起始行：三引号之前是代码，之后到行尾是字符串
  assert.ok(textsOf(t[0], "c-kw").includes("val"));
  assert.deepEqual(textsOf(t[0], "c-string"), ['"""a']);
  assert.equal(t[0].str, false);

  // 续行整行是字符串，且标记为续行
  assert.deepEqual(textsOf(t[1], "c-string"), ['b"""']);
  assert.equal(t[1].str, true, "跨行字符串续行应标记 str=true");
  assert.equal(joinedOf(t[1], "c-string"), 'b"""');

  // 关键：三引号闭合之后的下一行必须按代码分词，不能被字符串状态延续
  assert.equal(t[2].str, false, "闭合后的下一行不应再是字符串续行");
  assert.equal(joinedOf(t[2], "c-string"), "", "下一行不应出现字符串片段");
  assert.ok(textsOf(t[2], "c-kw").includes("val"));
  assert.ok(textsOf(t[2], "c-ident").includes("x"));
  assert.ok(textsOf(t[2], "c-num").includes("1"));
  assert.ok(textsOf(t[2], "c-comment").includes("// c"));
});

test("swift: 单行三引号字符串", () => {
  const t = tokenizeLines('let s = """a\\nb"""', "swift");
  assertLineIntegrity(t, "swift 单行三引号");
  const line = t[0];

  assert.equal(joinedOf(line, "c-string"), '"""a\\nb"""');
  assert.ok(textsOf(line, "c-kw").includes("let"), "let 应当是 c-kw");
  assert.ok(textsOf(line, "c-ident").includes("s"));
});

test("rust: 生命周期不是字符串，字符字面量仍是字符串", () => {
  // 生命周期：整行不得出现 c-string；str 是内建类型，{ } 是普通标点
  const fnLine = "fn f<'a>(s: &'a str) -> &'a str { s }";
  const t = tokenizeLines(fnLine, "rust");
  assertLineIntegrity(t, "rust 生命周期");
  const line = t[0];

  assert.equal(joinedOf(line, "c-string"), "", "生命周期行不应出现任何字符串片段");
  assert.ok(textsOf(line, "c-kw").includes("fn"));
  assert.ok(textsOf(line, "c-type").includes("str"));
  assert.ok(textsOf(line, "c-ident").includes("s"));
  assert.ok(line.segs.some((s) => s.cls === "" && s.text.includes("{")), "{ 应当是普通标点");
  assert.ok(line.segs.some((s) => s.cls === "" && s.text.includes("}")), "} 应当是普通标点");

  // 多个生命周期（含逗号分隔）同样不能被当成字符串
  const multi = tokenizeLines("fn f<'a, 'b>(x: &'a u8, y: &'b u8) -> &'a u8 { x }", "rust");
  assertLineIntegrity(multi, "rust 多生命周期");
  assert.equal(joinedOf(multi[0], "c-string"), "");

  // 真字符字面量照旧上色为字符串
  const ch = tokenizeLines("let c = 'x';", "rust");
  assertLineIntegrity(ch, "rust 字符字面量");
  assert.deepEqual(textsOf(ch[0], "c-string"), ["'x'"]);
  assert.ok(textsOf(ch[0], "c-num").length === 0);

  // 转义字符字面量（\n 两个字面字符）也要闭合
  const esc = tokenizeLines("let c = '\\n';", "rust");
  assertLineIntegrity(esc, "rust 转义字符字面量");
  assert.deepEqual(textsOf(esc[0], "c-string"), ["'\\n'"]);

  // \xNN / \u{...} 也是合法字符字面量
  const hex = tokenizeLines("let c = '\\x41'; let u = '\\u{1F600}';", "rust");
  assertLineIntegrity(hex, "rust hex/unicode 字符字面量");
  assert.deepEqual(textsOf(hex[0], "c-string"), ["'\\x41'", "'\\u{1F600}'"]);
});

test("regression: 普通 JS / Java / C 字符串行为不变", () => {
  const js = tokenizeLines('const x = "hi"; // note', "javascript");
  assertLineIntegrity(js, "js");
  assert.deepEqual(textsOf(js[0], "c-string"), ['"hi"']);
  assert.deepEqual(textsOf(js[0], "c-comment"), ["// note"]);
  assert.ok(textsOf(js[0], "c-kw").includes("const"));

  const java = tokenizeLines("String s = 'c'; // x", "java");
  assertLineIntegrity(java, "java");
  assert.deepEqual(textsOf(java[0], "c-string"), ["'c'"]);
  assert.deepEqual(textsOf(java[0], "c-comment"), ["// x"]);
  assert.ok(textsOf(java[0], "c-kw").length === 0, "Java 的 String 是类型不是关键字");

  const c = tokenizeLines('char *p = "a\\"b"; int n = 1;', "c");
  assertLineIntegrity(c, "c");
  assert.deepEqual(textsOf(c[0], "c-string"), ['"a\\"b"']);
  assert.ok(textsOf(c[0], "c-num").includes("1"));

  // C# 逐字字符串走 verbatim 分支（`""` 是转义），闭合后代码照常分词
  const cs = tokenizeLines('var s = @"a ""b"" c"; int y = 1;', "csharp");
  assertLineIntegrity(cs, "csharp");
  assert.deepEqual(textsOf(cs[0], "c-string"), ['@"a ""b"" c"']);
  assert.ok(textsOf(cs[0], "c-ident").includes("y"));
  assert.ok(textsOf(cs[0], "c-num").includes("1"));
});

test("fuzz: 受影响语言随机输入不抛异常且拼接守恒", () => {
  const langs = ["rust", "cpp", "kotlin", "swift", "c", "java", "javascript", "python", "toml", "xml"];
  const alphabet = "abcxyzABC019_'\"`\\#{}()<>;:/*= \t\n\r-+&![]";
  // 固定种子，失败可复现
  let seed = 0x1234abcd;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let n = 0; n < 300; n++) {
    let text = "";
    const len = Math.floor(rand() * 160);
    for (let k = 0; k < len; k++) text += alphabet[Math.floor(rand() * alphabet.length)];
    for (const lang of langs) {
      const t = tokenizeLines(text, lang);
      assert.ok(Array.isArray(t), `${lang}：fuzz 输入返回 null`);
      for (const line of t) {
        assert.equal(line.segs.map((s) => s.text).join(""), line.raw, `${lang}：fuzz 后 segs 拼接 !== raw`);
      }
    }
  }
});
