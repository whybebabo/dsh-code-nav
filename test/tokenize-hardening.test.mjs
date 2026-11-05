/**
 * dsh-code-nav — 分词器 P2 加固回归测试。
 *
 * 覆盖 review 中已验证的 14 类问题：
 *   1. Rust / Swift / Kotlin 嵌套块注释；
 *   2. JS 模板字符串、Go 反引号、C# 逐字字符串跨行（XML 原行为不回归）；
 *   3. SQL / PHP 关键字大小写不敏感；
 *   4. Vue / Svelte 只对 `<script>` 块分词（模板 / 样式留白）；
 *   5. YAML `|` / `>` 块标量正文不被键 / 注释装饰；
 *   6. JS 正则字面量（`/[/*]/` 不被当成块注释）；
 *   7. shell `#` 注释位置、PHP `#` 注释、Lua `--[=*[` 长注释；
 *   8. 段头扫描线性化（50k `[` 不卡死）；
 *   9. langOf 不泄漏原型链属性；
 *  10. >500KB 截断时返回数组上的非枚举 `truncated` 标记（G2）；
 *  11. properties 行尾续行：续行整行按值处理（P2-1）；
 *  12. Vue/Svelte `</script>` 的 JS 词法感知扫描：正则 / 字符串 / 注释不提前截断（P2-2）；
 *  13. YAML 行内长空白：去尾 / 行尾注释线性化（P2-3）；
 *  14. PHP 8 属性 `#[...]` 不再整行当注释（P2-4）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeLines } from "../src/tokenize.js";
import { langOf, LANG_META } from "../src/lang-registry.js";

/** 把一行拼回纯文本。 */
const flat = (line) => line.segs.map((s) => s.text).join("");
/** 某一行里指定类别的片段文本。 */
const textsOf = (line, cls) => line.segs.filter((s) => s.cls === cls).map((s) => s.text);
/** 每行 segs 拼接必须逐字等于 raw（不丢字符、不重复字符）。 */
function assertNoLoss(t, label) {
  assert.ok(Array.isArray(t), label + "：tokenizeLines 返回 null");
  for (const line of t) assert.equal(flat(line), line.raw, label + "：segs 拼接 !== raw");
}

// ---------- 1. 嵌套块注释 ----------
test("nested block comments: rust / swift / kotlin 按深度配对", () => {
  const t = tokenizeLines("/* a /* b */ c */ let x = 1;", "rust");
  assertNoLoss(t, "rust nested block");
  const line = t[0];
  assert.equal(
    textsOf(line, "c-comment").join(""),
    "/* a /* b */ c */",
    "内层 `*/` 不应提前结束外层注释"
  );
  assert.ok(textsOf(line, "c-kw").includes("let"));
  assert.ok(textsOf(line, "c-num").includes("1"));

  // 跨行嵌套：第 0 行开两层，第 1 行只关内层，第 2 行关外层，第 3 行恢复代码
  const m = tokenizeLines("/* a /* b */\nc */\nlet y = 2;", "swift");
  assertNoLoss(m, "swift nested block");
  assert.ok(m[0].segs.every((s) => s.cls === "c-comment"));
  assert.ok(m[1].segs.every((s) => s.cls === "c-comment"));
  assert.ok(textsOf(m[2], "c-kw").includes("let"));
  assert.ok(textsOf(m[2], "c-num").includes("2"));

  // Kotlin 同样嵌套
  const kt = tokenizeLines("/* x /* y */ z */ val n = 3;", "kotlin");
  assert.equal(textsOf(kt[0], "c-comment").join(""), "/* x /* y */ z */");
  assert.ok(textsOf(kt[0], "c-kw").includes("val"));

  // 未声明嵌套的语言保持旧行为：第一个 `*/` 就结束
  const js = tokenizeLines("/* a /* b */ let x = 1;", "javascript");
  assert.equal(textsOf(js[0], "c-comment").join(""), "/* a /* b */");
  assert.ok(textsOf(js[0], "c-kw").includes("let"));
});

// ---------- 2. 跨行普通字符串 ----------
test("JS 模板字符串跨行，续行之后代码 / 注释照常", () => {
  const t = tokenizeLines("const s = `line1\nline2`; const n = 1; // c", "javascript");
  assertNoLoss(t, "js template");
  assert.deepEqual(textsOf(t[0], "c-string"), ["`line1"]);
  assert.equal(t[0].str, false);
  // 第二行：先闭合模板串，剩余 `; const n = 1; // c` 是代码 / 注释
  assert.deepEqual(textsOf(t[1], "c-string"), ["line2`"]);
  assert.ok(textsOf(t[1], "c-kw").includes("const"));
  assert.ok(textsOf(t[1], "c-ident").includes("n"));
  assert.ok(textsOf(t[1], "c-num").includes("1"));
  assert.deepEqual(textsOf(t[1], "c-comment"), ["// c"]);

  // 模板里的转义反引号不提前闭合
  const esc = tokenizeLines("const s = `a\\`b`; const x = 1;", "javascript");
  assertNoLoss(esc, "js template escape");
  assert.equal(textsOf(esc[0], "c-string").join(""), "`a\\`b`");
  assert.ok(textsOf(esc[0], "c-num").includes("1"));

  // 普通单 / 双引号字符串不跨行（旧行为不回归）
  const plain = tokenizeLines('const s = "a\nlet y = 1;', "javascript");
  assertNoLoss(plain, "js plain string");
  assert.ok(!plain[1].str, "普通字符串不应标记为跨行续行");
  assert.ok(textsOf(plain[1], "c-kw").includes("let"));
});

test("Go 反引号原始字符串跨行", () => {
  const t = tokenizeLines("var s = `line1\nline2`; var n = 1", "go");
  assertNoLoss(t, "go raw string");
  assert.deepEqual(textsOf(t[0], "c-string"), ["`line1"]);
  assert.deepEqual(textsOf(t[1], "c-string"), ["line2`"]);
  assert.ok(textsOf(t[1], "c-kw").includes("var"));
  assert.ok(textsOf(t[1], "c-num").includes("1"));
});

test("C# 逐字字符串跨行，`\"\"` 不提前闭合", () => {
  const t = tokenizeLines('var s = @"line1\nline""2"; int y = 1; // c', "csharp");
  assertNoLoss(t, "csharp verbatim");
  assert.deepEqual(textsOf(t[0], "c-string"), ['@"line1']);
  // 续行里的 `""` 是一个字面引号，最后一个 `"` 才闭合
  assert.deepEqual(textsOf(t[1], "c-string"), ['line""2"']);
  assert.ok(textsOf(t[1], "c-kw").includes("int"));
  assert.ok(textsOf(t[1], "c-ident").includes("y"));
  assert.ok(textsOf(t[1], "c-num").includes("1"));
  assert.deepEqual(textsOf(t[1], "c-comment"), ["// c"]);

  // 同行逐字字符串回归
  const one = tokenizeLines('var s = @"a ""b"" c"; int y = 1;', "csharp");
  assert.deepEqual(textsOf(one[0], "c-string"), ['@"a ""b"" c"']);
  assert.ok(textsOf(one[0], "c-num").includes("1"));
});

test("XML 跨行属性值行为不回归", () => {
  const t = tokenizeLines('<root attr="a\n  b">\n  <child/>\n</root>', "xml");
  assertNoLoss(t, "xml attr multiline");
  assert.ok(t[1].segs.some((s) => s.cls === "c-string" && s.text.includes("b")));
  assert.ok(t[1].segs.some((s) => s.text === ">"), "标签应在续行闭合");
  assert.ok(!t[1].segs.some((s) => s.cls === "c-attr"));
  assert.equal(t[2].segs.find((s) => s.text === "child").cls, "c-tag");
  assert.ok(!t[2].segs.some((s) => s.cls === "c-string"));
});

// ---------- 3. SQL / PHP 关键字大小写不敏感 ----------
test("SQL / PHP 关键字大小写不敏感，其他语言不变", () => {
  const sql = tokenizeLines("SELECT id FROM users WHERE id = 1;", "sql");
  assertNoLoss(sql, "sql upper");
  for (const word of ["SELECT", "FROM", "WHERE"]) {
    assert.ok(textsOf(sql[0], "c-kw").includes(word), word + " 应当是 c-kw");
  }
  assert.ok(textsOf(sql[0], "c-ident").includes("users"));
  assert.ok(textsOf(sql[0], "c-num").includes("1"));

  const lower = tokenizeLines("select id from users;", "sql");
  assert.ok(textsOf(lower[0], "c-kw").includes("select"));

  const php = tokenizeLines("IF ($x) { ECHO $x; }", "php");
  for (const word of ["IF", "ECHO"]) {
    assert.ok(textsOf(php[0], "c-kw").includes(word), word + " 应当是 c-kw");
  }

  // 其他语言不受影响
  assert.deepEqual(textsOf(tokenizeLines("SELECT", "java")[0], "c-kw"), []);
  assert.equal(LANG_META.java.caseInsensitiveKeywords, undefined);
});

// ---------- 4. Vue / Svelte 单文件组件 ----------
test("Vue SFC：只有 script 块按 JS/TS 分词，模板 / 样式行留白", () => {
  const text = [
    "<template>",
    '  <div class="box">{{ msg }}</div>',
    '  <a href="http://example.com/x#frag">link</a>',
    "</template>",
    "",
    '<script setup lang="ts" data-note="a>b">',
    "interface Props { msg: string }",
    "const n = 1; // c",
    "</script>",
    "",
    "<style scoped>",
    ".box { color: red; }",
    "</style>"
  ].join("\n");
  const t = tokenizeLines(text, "vue");
  assertNoLoss(t, "vue sfc");
  assert.equal(t.length, 13);

  // 模板 / 样式 / 空行：每行一个空白 seg，没有关键字 / 注释
  for (const i of [0, 1, 2, 3, 4, 9, 10, 11, 12]) {
    assert.equal(t[i].segs.length, 1, "第 " + i + " 行应只有一个留白 seg");
    assert.equal(t[i].segs[0].cls, "", "第 " + i + " 行不应被分词上色");
    assert.equal(t[i].segs[0].text, t[i].raw);
    assert.equal(t[i].str, false);
  }
  // 模板里的 URL 不能被当注释
  assert.deepEqual(textsOf(t[2], "c-comment"), []);
  assert.ok(!t[2].segs.some((s) => s.cls === "c-kw"));

  // script 块：lang="ts" → TypeScript 分词
  assert.ok(textsOf(t[6], "c-kw").includes("interface"), JSON.stringify(t[6].segs));
  assert.ok(textsOf(t[6], "c-type").includes("Props"));
  assert.ok(textsOf(t[7], "c-kw").includes("const"));
  assert.ok(textsOf(t[7], "c-num").includes("1"));
  assert.deepEqual(textsOf(t[7], "c-comment"), ["// c"]);
  // 开 / 闭标签行本身留白
  assert.equal(t[5].segs.length, 1);
  assert.equal(t[5].segs[0].cls, "");
  assert.equal(t[8].segs[0].cls, "");

  // 多个 script 块、大小写不敏感、开标签带 `>`
  const multi = [
    "<SCRIPT>",
    "const a = 1;",
    "</SCRIPT>",
    '<script setup lang="ts">',
    "const b: number = 2;",
    "</script>"
  ].join("\n");
  const m = tokenizeLines(multi, "vue");
  assertNoLoss(m, "vue multi script");
  assert.ok(textsOf(m[1], "c-kw").includes("const"));
  assert.ok(textsOf(m[1], "c-num").includes("1"));
  assert.ok(textsOf(m[4], "c-kw").includes("const"));
  assert.ok(textsOf(m[4], "c-num").includes("2"));
  assert.equal(m[0].segs[0].cls, "");
  assert.equal(m[3].segs[0].cls, "");

  // Svelte 同样只分词 script 块
  const svelte = tokenizeLines('<h1>{x}</h1>\n<script>\nconst y = 3;\n</script>', "svelte");
  assertNoLoss(svelte, "svelte");
  assert.equal(svelte[0].segs[0].cls, "");
  assert.ok(textsOf(svelte[2], "c-num").includes("3"));
});

// ---------- 5. YAML 块标量 ----------
test("YAML 块标量正文不被键 / 注释装饰", () => {
  const text = [
    "description: |",
    "  a: 1",
    "  # not a comment",
    "real: 2",
    "items:",
    "  - |",
    "      fake: value",
    "next: 3"
  ].join("\n");
  const t = tokenizeLines(text, "yaml");
  assertNoLoss(t, "yaml block scalar");
  assert.ok(textsOf(t[0], "c-key").includes("description"));

  // 正文行：无 c-key / c-comment，整行 c-string，str=true
  for (const i of [1, 2]) {
    assert.deepEqual(textsOf(t[i], "c-key"), [], "第 " + i + " 行不应有键");
    assert.deepEqual(textsOf(t[i], "c-comment"), [], "第 " + i + " 行 `#` 是内容不是注释");
    assert.equal(textsOf(t[i], "c-string").join(""), t[i].raw);
    assert.equal(t[i].str, true);
  }
  assert.ok(textsOf(t[3], "c-key").includes("real"));

  // `- |` 列表形式：头行本身照常解析，正文行才是字符串
  assert.equal(t[5].str, false, "块标量头行不是正文");
  assert.deepEqual(textsOf(t[5], "c-key"), [], "列表项不是键");
  assert.equal(t[6].str, true);
  assert.deepEqual(textsOf(t[6], "c-key"), [], "第 6 行不应有键");
  assert.equal(textsOf(t[6], "c-string").join(""), t[6].raw);
  assert.ok(textsOf(t[7], "c-key").includes("next"));

  // 缩进回退 → 块结束，本行照常解析
  const dedent = tokenizeLines("outer:\n  a: |\n    fake: 1\n  b: 2", "yaml");
  assertNoLoss(dedent, "yaml dedent");
  assert.deepEqual(textsOf(dedent[2], "c-key"), []);
  assert.equal(dedent[2].str, true);
  assert.ok(textsOf(dedent[3], "c-key").includes("b"));
  assert.equal(dedent[3].str, false);

  // 普通 YAML 行为不回归：URL 里的 # 不是注释
  const y = tokenizeLines("url: http://x#f", "yaml");
  assert.deepEqual(textsOf(y[0], "c-comment"), []);
  assert.ok(textsOf(y[0], "c-key").includes("url"));
});

// ---------- 6. JS 正则字面量 ----------
test("JS 正则字面量不被误判为注释，除法不受影响", () => {
  const t = tokenizeLines("const re = /[/*]/; const x = 1;", "javascript");
  assertNoLoss(t, "js regex");
  assert.deepEqual(textsOf(t[0], "c-string"), ["/[/*]/"]);
  assert.deepEqual(textsOf(t[0], "c-comment"), []);
  assert.ok(textsOf(t[0], "c-ident").includes("re"));
  assert.ok(textsOf(t[0], "c-ident").includes("x"));
  assert.ok(textsOf(t[0], "c-num").includes("1"));
  assert.equal(textsOf(t[0], "c-kw").filter((w) => w === "const").length, 2);

  // 除法保持代码：`a / b / c`
  const div = tokenizeLines("const d = a / b / c;", "javascript");
  assert.deepEqual(textsOf(div[0], "c-string"), []);
  assert.ok(textsOf(div[0], "c-ident").includes("b"));

  // 关键字之后可以跟正则；带标志位整段上色
  const ret = tokenizeLines("return /x+/g;", "javascript");
  assert.deepEqual(textsOf(ret[0], "c-string"), ["/x+/g"]);
  const paren = tokenizeLines("if (/x/.test(s)) {}", "javascript");
  assert.deepEqual(textsOf(paren[0], "c-string"), ["/x/"]);

  // 行首也是表达式位置（`/re/.test(x)` 很常见）
  const lineStart = tokenizeLines("/[a-z]+/.test(s);", "javascript");
  assert.deepEqual(textsOf(lineStart[0], "c-string"), ["/[a-z]+/"]);

  // 字符串 / 数字之后是值：`/` 是除法，不能当正则
  const afterString = tokenizeLines('const s = "a" / 2 / 3;', "javascript");
  assert.deepEqual(textsOf(afterString[0], "c-string"), ['"a"']);
  assert.ok(textsOf(afterString[0], "c-num").includes("2"));

  // 块注释视为透明：`return /* c */ /re/` 仍是正则
  const afterComment = tokenizeLines("return /* c */ /re/;", "javascript");
  assert.deepEqual(textsOf(afterComment[0], "c-string"), ["/re/"]);
  assert.deepEqual(textsOf(afterComment[0], "c-comment"), ["/* c */"]);

  // 注释语法照旧
  const cmt = tokenizeLines("const a = 1; // note /* x", "javascript");
  assert.deepEqual(textsOf(cmt[0], "c-comment"), ["// note /* x"]);
  const block = tokenizeLines("/* block */ const a = 1;", "javascript");
  assert.equal(textsOf(block[0], "c-comment").join(""), "/* block */");
  assert.ok(textsOf(block[0], "c-num").includes("1"));

  // 其他语言不启用正则识别
  assert.deepEqual(textsOf(tokenizeLines("int re = /[/*]/;", "java")[0], "c-string"), []);
});

// ---------- 7. 注释标记 ----------
test("shell：URL 里的 # 不截断，命令分隔符后的 # 才是注释", () => {
  const url = tokenizeLines("curl http://example.com/a#frag", "shell");
  assertNoLoss(url, "shell url");
  assert.deepEqual(textsOf(url[0], "c-comment"), []);
  assert.equal(flat(url[0]), "curl http://example.com/a#frag");

  assert.deepEqual(textsOf(tokenizeLines("echo hi # note", "shell")[0], "c-comment"), ["# note"]);
  assert.deepEqual(textsOf(tokenizeLines("echo a;# note", "shell")[0], "c-comment"), ["# note"]);
  assert.deepEqual(textsOf(tokenizeLines("a | # note", "shell")[0], "c-comment"), ["# note"]);
  assert.deepEqual(textsOf(tokenizeLines("echo $(# note", "shell")[0], "c-comment"), ["# note"]);
  assert.ok(tokenizeLines("#!/bin/sh", "shell")[0].segs.every((s) => s.cls === "c-comment"));
});

test("PHP：`#` 与 `//` 都是行注释", () => {
  const hash = tokenizeLines("$x = 1; # note", "php");
  assertNoLoss(hash, "php hash");
  assert.deepEqual(textsOf(hash[0], "c-comment"), ["# note"]);
  assert.deepEqual(textsOf(tokenizeLines("$x = 1; // note", "php")[0], "c-comment"), ["// note"]);
});

test("Lua 长注释 --[=*[ ... ]=*]", () => {
  const one = tokenizeLines("--[[ a ]] local x = 1", "lua");
  assertNoLoss(one, "lua long one line");
  assert.equal(textsOf(one[0], "c-comment").join(""), "--[[ a ]]");
  assert.ok(textsOf(one[0], "c-num").includes("1"));

  const multi = tokenizeLines("local a = 1 --[==[ c\nstill c ]==]\nlocal b = 2", "lua");
  assertNoLoss(multi, "lua long multi");
  assert.equal(textsOf(multi[0], "c-comment").join(""), "--[==[ c");
  assert.deepEqual(textsOf(multi[1], "c-comment"), ["still c ]==]"]);
  assert.ok(textsOf(multi[2], "c-kw").includes("local"));
  assert.ok(textsOf(multi[2], "c-num").includes("2"));
});

// ---------- 8. 段头扫描线性化 ----------
test("段头扫描是线性的：50k `[` 快速完成且区间不变", () => {
  const big = "[".repeat(50000);
  const t0 = performance.now();
  const t = tokenizeLines(big, "toml");
  const elapsed = performance.now() - t0;
  assertNoLoss(t, "toml 50k bracket");
  assert.equal(flat(t[0]), big);
  assert.ok(elapsed < 1000, "50k `[` 用时 " + Math.round(elapsed) + "ms，疑似回溯");

  const sectionOf = (line, lang) =>
    tokenizeLines(line, lang)[0].segs.filter((s) => s.cls === "c-section").map((s) => s.text).join("");
  assert.equal(sectionOf("[a]", "toml"), "a");
  assert.equal(sectionOf("[[bin]]", "toml"), "bin");
  // 与旧行为一致：区间包含缩进后的空格；没有闭括号则不标
  assert.equal(sectionOf("  [ x ]", "ini"), " x ");
  assert.equal(sectionOf("[s]", "ini"), "s");
  assert.equal(sectionOf("[", "toml"), "");
  assert.equal(sectionOf("[a", "toml"), "");
});

// ---------- 9. langOf 原型泄漏 ----------
test("langOf / tokenizeLines 不泄漏原型链属性", () => {
  const inherited = [
    "__proto__", "constructor", "toString", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"
  ];
  for (const name of inherited) {
    assert.equal(langOf("x." + name), null, name + " 不应被当成扩展名");
    assert.equal(langOf(name), null, name);
    assert.equal(tokenizeLines("x", name), null, name + " 不应被当成语言 id");
  }
  // 正常扩展名不受影响
  assert.equal(langOf("a/b/App.ts"), "typescript");
  assert.equal(langOf(".env"), "dotenv");
  assert.equal(langOf("README.md"), null);
});

// ---------- 不丢字符 + fuzz ----------
test("受影响语言：分词不丢字符", () => {
  const samples = {
    javascript: "const s = `a\nb`; // c\nconst re = /[/*]/;",
    typescript: "interface A { x: string }\nconst n: number = 1;",
    jsx: "const el = <div className=\"a\">x</div>;",
    tsx: "const el = <A n={1} />;",
    go: "var s = `a\nb`\nvar n = 1",
    csharp: 'var s = @"a\nb";\nint y = 1;',
    rust: "/* a /* b */ c */\nfn f<'a>(s: &'a str) {}",
    swift: "/* a /* b */ c */\nlet s = \"\"\"a\nb\"\"\"",
    kotlin: "/* a /* b */ c */\nval s = \"\"\"a\nb\"\"\"",
    sql: "SELECT id FROM t WHERE a = 'x';",
    php: "$x = 1; # c\n// d",
    shell: "curl http://x#frag\n# c",
    lua: "--[==[ a\nb ]==]\nlocal x = 1",
    yaml: "a: |\n  b: 1\nc: 2",
    toml: "[a]\nb = 1",
    xml: '<r a="1\n2">t</r>',
    vue: "<template><p>x</p></template>\n<script lang=\"ts\">\nconst n = 1;\n</script>",
    svelte: "<script>\nconst n = 1;\n</script>\n<p>{n}</p>"
  };
  for (const [lang, text] of Object.entries(samples)) assertNoLoss(tokenizeLines(text, lang), lang);
});

test("fuzz：随机输入不抛异常且 segs 拼接守恒", () => {
  const langs = [
    "javascript", "typescript", "jsx", "tsx", "go", "csharp", "rust", "swift",
    "kotlin", "sql", "php", "shell", "lua", "yaml", "toml", "xml", "vue", "svelte"
  ];
  const alphabet = "abzAZ09_'\"`\\#{}()<>;:/=*[]-+&|!?%^~$. \t\n\r";
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let n = 0; n < 250; n++) {
    let text = "";
    const len = Math.floor(rand() * 180);
    for (let k = 0; k < len; k++) text += alphabet[Math.floor(rand() * alphabet.length)];
    for (const lang of langs) {
      const t = tokenizeLines(text, lang);
      assert.ok(Array.isArray(t), lang + "：fuzz 输入返回 null");
      for (const line of t) assert.equal(flat(line), line.raw, lang + "：fuzz 后 segs 拼接 !== raw");
    }
  }
});

// ---------- 10. >500KB 截断事实回传（G2） ----------
test(">500KB 截断：返回数组带非枚举 truncated 标记，结果 / deepEqual / null 行为不变", () => {
  // "const a = 1;\n" 每行 13 字符 → 41,667 行 = 541,671 字符，越过 500,000 上限
  const big = "const a = 1;\n".repeat(41667);
  assert.ok(big.length > 500000);

  const t = tokenizeLines(big, "javascript");
  assertNoLoss(t, "big truncated");
  assert.equal(t.truncated, true, "被 500KB 上限截断时必须回传事实");
  assert.equal(
    Object.prototype.propertyIsEnumerable.call(t, "truncated"),
    false,
    "truncated 必须是非枚举属性（不能污染 deepEqual / 序列化）"
  );
  assert.ok(!Object.keys(t).includes("truncated"), "枚举键里不应出现 truncated");

  // 标记不改变内容：与「直接分词截断后的文本」结果 deepEqual
  const same = tokenizeLines(big.slice(0, 500000), "javascript");
  assert.deepEqual(t, same, "truncated 标记不应改变数组内容 / deepEqual 结果");
  assert.equal(same.truncated, undefined, "未截断路径不应有标记");

  // 单行巨型文件同样标记
  const oneLine = tokenizeLines("x".repeat(500001), "javascript");
  assert.equal(oneLine.length, 1);
  assert.equal(oneLine.truncated, true, "单行 >500KB 也要标记");
  for (const line of oneLine) assert.equal(flat(line), line.raw);

  // 边界：恰好 500,000 字符没有截断，不标记
  const exact = tokenizeLines("x".repeat(500000), "javascript");
  assert.equal(exact.truncated, undefined, "恰好 500,000 字符不应标记截断");

  // Vue / Svelte 的 scriptBlocks 返回路径也必须标记
  const vue = tokenizeLines(
    "<template><p>x</p></template>\n<script>\n" + "const a = 1;\n".repeat(40000) + "</script>",
    "vue"
  );
  assert.equal(vue.truncated, true, "Vue scriptBlocks 路径同样要回传截断事实");
  assert.equal(Object.prototype.propertyIsEnumerable.call(vue, "truncated"), false);

  // 非法输入照旧返回 null（截断标记不影响 null 语义）
  assert.equal(tokenizeLines(null, "javascript"), null);
  assert.equal(tokenizeLines(500001, "javascript"), null);
  assert.equal(tokenizeLines("x".repeat(500001), "no-such-language"), null);
});

// ---------- 11. properties 行尾续行（P2-1） ----------
test("properties 续行：续行整行按值处理，键 / 行首 # 都不再误判", () => {
  assert.equal(LANG_META.properties.keyContinuation, true, "properties 应声明续行语义");
  const text = [
    "welcome.message = Welcome to the app \\",
    "    Please log in.",
    "admin.name = Admin",
    "# real comment",
    "note = hello \\",
    "#not-a-comment"
  ].join("\n");
  const t = tokenizeLines(text, "properties");
  assertNoLoss(t, "properties continuation");

  // 首行键照旧
  assert.equal(textsOf(t[0], "c-key").join(""), "welcome.message");
  // 续行：整行是值（c-string），不是键；str=true 与 YAML 块标量正文同义
  assert.equal(textsOf(t[1], "c-key").join(""), "", "续行的值不能被当成新键");
  assert.equal(textsOf(t[1], "c-string").join(""), "    Please log in.");
  assert.equal(t[1].str, true, "续行应标记 str=true");
  // 真注释行仍然是注释
  assert.deepEqual(textsOf(t[3], "c-comment"), ["# real comment"]);
  // 续行行首的 # 是值文本，不是注释
  assert.equal(textsOf(t[5], "c-comment").join(""), "", "续行行首的 # 是值，不是注释");
  assert.equal(textsOf(t[5], "c-string").join(""), "#not-a-comment");
  assert.equal(t[5].str, true);
});

test("properties 续行状态：偶数反斜杠 / 注释行 / 连续续行（与 config-outline 同口径）", () => {
  // 偶数个反斜杠：`\\` 是转义出的字面反斜杠，本行结束
  const even = tokenizeLines("a = foo\\\\\nb = 1", "properties");
  assertNoLoss(even, "properties even backslash");
  assert.equal(even[1].str, false, "偶数个行尾反斜杠不是续行");
  assert.equal(textsOf(even[1], "c-key").join(""), "b");

  // 注释行行尾反斜杠不开启续行（config-outline.js 在注释行 continue）
  const comment = tokenizeLines("# note \\\nkey = 1", "properties");
  assertNoLoss(comment, "properties comment backslash");
  assert.equal(comment[1].str, false, "注释行不应开启续行");
  assert.equal(textsOf(comment[1], "c-key").join(""), "key");

  // 续行自身可再续行；结束后恢复键值解析
  const chain = tokenizeLines("a = 1 \\\ncontinued \\\nstill\nb = 2", "properties");
  assertNoLoss(chain, "properties chain");
  assert.equal(chain[1].str, true);
  assert.equal(chain[2].str, true, "续行自身行尾反斜杠也应继续");
  assert.equal(textsOf(chain[2], "c-string").join(""), "still");
  assert.equal(chain[3].str, false);
  assert.equal(textsOf(chain[3], "c-key").join(""), "b");

  // 空行结束续行态
  const blank = tokenizeLines("a = 1 \\\n\nb = 2", "properties");
  assertNoLoss(blank, "properties blank line");
  assert.equal(blank[2].str, false);
  assert.equal(textsOf(blank[2], "c-key").join(""), "b");

  // 不带续行标记的语言不受影响（不能把 JS 的反斜杠续行当 properties 语义）
  const js = tokenizeLines("const a = 1 \\\nconst b = 2", "javascript");
  assert.equal(js[1].str, false);
  assert.ok(textsOf(js[1], "c-kw").includes("const"));
});

// ---------- 12. Vue/Svelte `</script>` 的 JS 词法感知扫描（P2-2） ----------
test("SFC：script 里的正则字面量不再击穿 </script>（/[\"']/、/it's/）", () => {
  for (const code of ['const re = /["\']/;', "const re = /it's/;"]) {
    const text = [
      "<script>",
      code,
      "const n = 1;",
      "</script>",
      "<template>",
      '  <p class="box">hello</p>',
      "</template>"
    ].join("\n");
    const t = tokenizeLines(text, "vue");
    assertNoLoss(t, "sfc regex " + code);
    assert.ok(
      textsOf(t[1], "c-string").some((s) => s.includes("/")),
      "正则应当作为 c-string 上色：" + JSON.stringify(t[1].segs)
    );
    // `</script>` 之后是模板：整行留白（旧实现在这里涂出 c-ident）
    assert.equal(t[3].segs.length, 1, "收尾标签行不应被分词");
    assert.equal(t[3].segs[0].cls, "");
    assert.equal(t[5].segs.length, 1, "模板行不应被分词");
    assert.equal(t[5].segs[0].cls, "");
    assert.ok(!t[5].segs.some((s) => s.cls === "c-kw" || s.cls === "c-ident"));
  }
});

test("SFC：字符串 / 模板字符串 / 行注释 / 块注释里的 </script> 不提前截断", () => {
  const text = [
    "<script>",
    'const s = "</script>";',
    "const tpl = `</script>`;",
    "// </script>",
    "/* </script> */",
    "const n = 1;",
    "</script>",
    "<template>",
    "<p>x</p>",
    "</template>"
  ].join("\n");
  const t = tokenizeLines(text, "svelte");
  assertNoLoss(t, "sfc string/comment");
  // 真收尾标签在第 7 行；之前的代码照常分词
  assert.ok(textsOf(t[5], "c-num").includes("1"));
  assert.equal(t[6].segs.length, 1, "收尾标签行不应被分词");
  assert.equal(t[6].segs[0].cls, "");
  assert.equal(t[8].segs.length, 1, "模板行不应被分词");
  assert.equal(t[8].segs[0].cls, "");
});

test("SFC：除法不被当正则吞掉；单行 <script>…</script> 正常切分", () => {
  const div = tokenizeLines(
    ["<script>", "const half = total / 2;", "const n = 1;", "</script>", "<template>", "<p>x</p>", "</template>"].join("\n"),
    "vue"
  );
  assertNoLoss(div, "sfc division");
  assert.ok(textsOf(div[1], "c-num").includes("2"));
  assert.equal(div[3].segs.length, 1);
  assert.equal(div[5].segs[0].cls, "");

  // 开闭标签同一行：script 正文照常分词，收尾标签是普通文本
  const one = tokenizeLines('<script>const n = 1;</script>', "vue");
  assertNoLoss(one, "sfc one-line");
  assert.ok(textsOf(one[0], "c-kw").includes("const"));
  assert.ok(textsOf(one[0], "c-num").includes("1"));
  assert.ok(!textsOf(one[0], "c-ident").includes("script"));
});

test("SFC：自闭合 / 无正文的 <script> 不再把整个剩余文件当脚本", () => {
  const text = [
    '<script src="./main.ts" />',
    "<template>",
    '  <div class="box">{{ msg }}</div>',
    "</template>"
  ].join("\n");
  const t = tokenizeLines(text, "vue");
  assertNoLoss(t, "sfc self-closing");
  for (let i = 0; i < t.length; i++) {
    assert.equal(t[i].segs.length, 1, "第 " + (i + 1) + " 行不应被当成脚本分词");
    assert.equal(t[i].segs[0].cls, "");
  }
  assert.ok(!t[2].segs.some((s) => s.cls === "c-kw" || s.cls === "c-ident"));
});

test("SFC：正则里的转义斜杠 / 字符类不提前结束", () => {
  const text = [
    "<script>",
    "const re = /<\\/script>/;",
    "const cls = /[/]/;",
    "const n = 1;",
    "</script>",
    "<template>",
    "<p>x</p>",
    "</template>"
  ].join("\n");
  const t = tokenizeLines(text, "vue");
  assertNoLoss(t, "sfc escaped slash");
  assert.ok(textsOf(t[3], "c-num").includes("1"));
  assert.equal(t[4].segs.length, 1, "收尾标签行不应被分词");
  assert.equal(t[6].segs.length, 1, "模板行不应被分词");
});

// ---------- 13. YAML 行内长空白的线性化（P2-3） ----------
test("YAML 块标量头 / 行尾注释：长空白行仍是线性，语义不变", () => {
  // 语义回归：注释剥离、块标量头识别
  const headers = [
    ["description: | # note", true],
    ["description: |-", true],
    ["description: |2", true],
    ["- >-", true],
    ["key: value # note", false],
    ["url: http://x#frag", false],
    ["# comment", false]
  ];
  for (const [line, want] of headers) {
    const t = tokenizeLines(line + "\n  body", "yaml");
    assert.equal(t[1].str, want, "块标量头判定不符：" + line);
  }

  // 行内 100k 空白 + 非空尾：旧 `/\s+$/` 与 `/\s+#.*$/` 是 O(n²)（40k ≈ 470ms/条），
  // 这里只要求结果正确且不超时（旧实现会到秒级；新实现 ~几十 ms）。
  const spaces = " ".repeat(100000);
  const started = performance.now();
  const t = tokenizeLines("description: |" + spaces + "x\n  body", "yaml");
  const elapsed = performance.now() - started;
  assertNoLoss(t, "yaml long whitespace");
  assert.equal(t[1].str, false, "长空白后还有非空尾 → 不是块标量头");
  assert.ok(elapsed < 2000, "100k 空白行耗时 " + elapsed.toFixed(1) + "ms，疑似又退化成二次方");

  // 长空白 + 行尾注释：注释剥离后仍是块标量头
  const commented = tokenizeLines("description: |" + spaces + "# note\n  body", "yaml");
  assertNoLoss(commented, "yaml long whitespace comment");
  assert.equal(commented[1].str, true, "剥离行尾注释后应识别为块标量头");
});

// ---------- 14. PHP 8 属性 `#[...]`（P2-4） ----------
test("PHP 8 属性 #[...] 不是注释，真正的 # 注释照旧", () => {
  assert.equal(LANG_META.php.commentHashAttribute, true, "php 应声明 #[ 是 attribute");

  const attr = tokenizeLines("#[Route('/x')]", "php");
  assertNoLoss(attr, "php attribute");
  assert.deepEqual(textsOf(attr[0], "c-comment"), [], "属性行不应整行变注释");
  assert.equal(textsOf(attr[0], "c-string").join(""), "'/x'");
  assert.ok(textsOf(attr[0], "c-type").includes("Route"), "Route 应当高亮：" + JSON.stringify(attr[0].segs));

  // 行内（参数）属性
  const param = tokenizeLines("function f(#[SensitiveParameter] $x) {}", "php");
  assertNoLoss(param, "php param attribute");
  assert.deepEqual(textsOf(param[0], "c-comment"), []);
  assert.ok(textsOf(param[0], "c-type").includes("SensitiveParameter"));

  // 真正的 # 注释仍然是注释（行首 / 行内）
  assert.deepEqual(textsOf(tokenizeLines("# comment", "php")[0], "c-comment"), ["# comment"]);
  assert.deepEqual(textsOf(tokenizeLines("$x = 1; # note", "php")[0], "c-comment"), ["# note"]);
  // `# [` 中间有空格不是属性
  assert.deepEqual(textsOf(tokenizeLines("# [x]", "php")[0], "c-comment"), ["# [x]"]);
  // 其他语言的 `#` 行为不受影响
  assert.deepEqual(textsOf(tokenizeLines("# note", "shell")[0], "c-comment"), ["# note"]);
});

