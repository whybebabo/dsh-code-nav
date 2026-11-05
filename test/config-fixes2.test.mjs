/**
 * dsh-code-nav — 配置大纲 P2 修复回归（fix2，task-10）。
 *
 * 覆盖审查报告 `.work/review/02-outline.md` 里配置侧的 P2：
 *   1. YAML `---` / `...` 多文档：新文档重置段栈，第二文档不继承第一文档的 container；
 *   2. YAML 序列与父键同缩进（`key:` 换行 `- item`）：序列元素仍归属 key；
 *   3. TOML 引号段名含 `]`（`["a]b"]` / `[a."b]c"]`）：段名不被截断；
 *   4. dotenv 跨行引号值：续行不得变成新键；
 *   5. XML 错配闭合标签：由 O(depth)/次降为近似 O(1)/次（同时保持正常嵌套输出不变）；
 *   6. YAML flow 映射：单行 / 多行 / 嵌套 / 引号键的键入大纲，多行 flow 的键不抬成顶层键。
 *
 * 输出契约不变：{ kind, name, line, container? }，line 为 1 基。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineOf } from "../src/outline.js";

/** kind:name@line(:container) —— 顺序敏感。 */
const detail = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}` + (s.container ? `:${s.container}` : ""));
/** kind:name —— 只看条目，忽略行号/container。 */
const kinds = (syms) => syms.map((s) => `${s.kind}:${s.name}`);
/** 按名字取第一个符号。 */
const named = (syms, name) => syms.find((s) => s.name === name);

// ---------- 1. YAML — 多文档 ----------
test("yaml multi-doc: a new document does not inherit the previous document's section", () => {
  const code = "a:\n  b:\n    c: 1\n---\n  d: 2\n";
  const s = outlineOf(code, "yaml");
  assert.deepEqual(detail(s), [
    "section:a@1",
    "section:b@2:a",
    "key:c@3:b",
    "key:d@5",              // 修复前是 key:d@5:a（挂到第一文档的 a 上）
  ], JSON.stringify(detail(s)));
});

test("yaml multi-doc: `...` document end also resets the section stack", () => {
  const code = "a:\n  b: 1\n...\n  c: 2\n";
  const s = outlineOf(code, "yaml");
  assert.deepEqual(detail(s), [
    "section:a@1",
    "key:b@2:a",
    "key:c@4",              // 修复前是 key:c@4:a
  ], JSON.stringify(detail(s)));
});

test("yaml multi-doc: kubernetes-style manifests keep each document's own container chain", () => {
  const code = [
    "apiVersion: v1",          // 1
    "kind: Pod",               // 2
    "spec:",                   // 3
    "  containers:",           // 4
    "  - name: app",           // 5
    "    image: nginx",        // 6
    "---",                     // 7
    "apiVersion: v1",          // 8
    "kind: Service",           // 9
    "spec:",                   // 10
    "  ports:",                // 11
    "  - port: 80",            // 12
  ].join("\n");
  const s = outlineOf(code, "yaml");
  assert.equal(named(s, "apiVersion").container, undefined);
  assert.equal(named(s, "name").container, "containers");
  assert.equal(named(s, "image").container, "containers");
  assert.equal(named(s, "ports").container, "spec");
  assert.equal(named(s, "port").container, "ports");
  // 第二文档的 apiVersion 不得挂到第一文档的 spec 下（重名时手动核对最后一个）
  const lastApi = s.filter((x) => x.name === "apiVersion").at(-1);
  assert.equal(lastApi.container, undefined, JSON.stringify(detail(s)));
  assert.equal(lastApi.line, 8);
});

// ---------- 2. YAML — 序列与父键同缩进 ----------
test("yaml sequence: items at the parent key's indentation still belong to that key", () => {
  const s = outlineOf("a:\n- x: 1\n- y: 2\n", "yaml");
  assert.deepEqual(detail(s), [
    "section:a@1",
    "key:x@2:a",            // 修复前无 container
    "key:y@3:a",
  ], JSON.stringify(detail(s)));
});

test("yaml sequence: indented items keep working (regression)", () => {
  const s = outlineOf("list:\n  - id: 1\n    label: first\n", "yaml");
  assert.equal(named(s, "id").container, "list");
  assert.equal(named(s, "label").container, "list");
});

test("yaml sequence: a mapping item's nested section does not leak to the next item", () => {
  const code = "a:\n- b:\n    c: 1\n- d: 2\n";
  const s = outlineOf(code, "yaml");
  assert.deepEqual(detail(s), [
    "section:a@1",
    "section:b@2:a",
    "key:c@3:b",
    "key:d@4:a",            // 修复前会挂到 b 上
  ], JSON.stringify(detail(s)));
});

test("yaml sequence: deep nesting inside a list item still resolves to the item's own section", () => {
  const code = "items:\n  - name: a\n    sub:\n      x: 1\n  - name: b\n";
  const s = outlineOf(code, "yaml");
  assert.equal(named(s, "x").container, "sub");
  const last = s.filter((x) => x.name === "name").at(-1);
  assert.equal(last.container, "items");
});

// ---------- 3. TOML — 引号段名含 ] ----------
test("toml: a quoted section name containing ] is not truncated", () => {
  const s = outlineOf('["a]b"]\nk = 1\n', "toml");
  assert.deepEqual(detail(s), [
    'section:"a]b"@1',
    'key:k@2:"a]b"',
  ], JSON.stringify(detail(s)));
});

test("toml: a dotted section with a quoted segment containing ] keeps the full path", () => {
  const s = outlineOf('[a."b]c"]\nd = 1\n', "toml");
  assert.deepEqual(detail(s), [
    'section:a."b]c"@1',
    'key:d@2:a."b]c"',
  ], JSON.stringify(detail(s)));
});

test("toml: plain and array-of-table headers are unchanged (regression)", () => {
  const code = "[package]\nname = \"x\"\n[dependencies]\nserde = \"1\"\n[[bin]]\nname = \"main\"\n[a.b]\nx = 1\n";
  const s = outlineOf(code, "toml");
  assert.deepEqual(kinds(s), [
    "section:package", "key:name", "section:dependencies", "key:serde",
    "section:bin", "key:name", "section:a.b", "key:x",
  ], JSON.stringify(kinds(s)));
  assert.equal(named(s, "serde").container, "dependencies");
  assert.equal(named(s, "bin").container, undefined);
  // 父段只在「名字是它的点分前缀」且真的出现过时才算数
  assert.equal(named(s, "a.b").container, undefined);
  const withParent = outlineOf("[a]\n[a.b]\nx = 1\n", "toml");
  assert.equal(named(withParent, "a.b").container, "a");
});

// ---------- 4. dotenv — 跨行引号值 ----------
test("dotenv: a double-quoted multi-line value's continuation is not a new key", () => {
  const code = 'KEY="line1\nB=2\nEND"\nNEXT=1\n';
  const s = outlineOf(code, "dotenv");
  assert.deepEqual(detail(s), [
    "key:KEY@1",            // 修复前还有 key:B@2（值内容被当成键）
    "key:NEXT@4",
  ], JSON.stringify(detail(s)));
});

test("dotenv: a single-quoted multi-line value behaves the same", () => {
  const code = "KEY='x\ny'\nNEXT=1\n";
  assert.deepEqual(detail(outlineOf(code, "dotenv")), ["key:KEY@1", "key:NEXT@3"]);
});

test("dotenv: an escaped quote does not close the value", () => {
  const code = 'KEY="a\\"b\nSTILL=inside"\nNEXT=1\n';
  assert.deepEqual(detail(outlineOf(code, "dotenv")), ["key:KEY@1", "key:NEXT@3"]);
});

test("dotenv: single-line quoted values and plain values are unchanged (regression)", () => {
  const code = '# comment\nNODE_ENV=production\nAPI_URL="https://x/y"\nEMPTY=\nexport EXTRA=1\n';
  assert.deepEqual(kinds(outlineOf(code, "dotenv")), [
    "key:NODE_ENV", "key:API_URL", "key:EMPTY", "key:EXTRA",
  ]);
});

test("dotenv: multiline handling does not leak into INI / properties", () => {
  // INI 的引号值不跨行（行为保持修复前）：续行里的 key=value 仍是键
  const ini = outlineOf('[s]\nq="a\nk=1\n', "ini");
  assert.deepEqual(kinds(ini), ["section:s", "key:q", "key:k"], JSON.stringify(kinds(ini)));
  // properties 靠行尾反斜杠续行，引号不参与
  const props = outlineOf('a="x\nb=2\n', "properties");
  assert.deepEqual(kinds(props), ["key:a", "key:b"], JSON.stringify(kinds(props)));
});

// ---------- 5. XML — 错配闭合标签 ----------
test("xml: normal nesting output is unchanged (elements, attributes, containers, lines)", () => {
  const code = [
    '<?xml version="1.0"?>',                                                          // 1
    '<project name="demo">',                                                          // 2
    '  <!-- <fake attr="1"/> -->',                                                    // 3
    "  <dependencies>",                                                               // 4
    '    <dependency groupId="g" artifactId="a">',                                    // 5
    "      <scope>test</scope>",                                                      // 6
    "    </dependency>",                                                              // 7
    "  </dependencies>",                                                              // 8
    "  <build/>",                                                                     // 9
    "</project>",                                                                     // 10
  ].join("\n");
  const s = outlineOf(code, "xml");
  assert.deepEqual(detail(s), [
    "element:project@2",
    "attribute:name@2:project",
    "element:dependencies@4:project",
    "element:dependency@5:dependencies",
    "attribute:groupId@5:dependency",
    "attribute:artifactId@5:dependency",
    "element:scope@6:dependency",
    "element:build@9:project",
  ], JSON.stringify(detail(s)));
});

test("xml: a closing tag for an ancestor pops everything above it (lenient, same as before)", () => {
  const s = outlineOf("<root><a><b></root><after/>\n", "xml");
  // </root> 弹出 b、a、root；after 回到顶层
  assert.deepEqual(detail(s), [
    "element:root@1",
    "element:a@1:root",
    "element:b@1:a",
    "element:after@1",
  ], JSON.stringify(detail(s)));
});

test("xml: unmatched and stray closing tags are ignored", () => {
  const s = outlineOf("<root></nope><a/></root>\n", "xml");
  assert.deepEqual(detail(s), ["element:root@1", "element:a@1:root"]);
});

test("xml: deeply nested same-name elements keep their container chain", () => {
  const s = outlineOf("<r><r><r/></r></r>\n", "xml");
  assert.deepEqual(detail(s), ["element:r@1", "element:r@1:r", "element:r@1:r"]);
});

test("xml: mass mismatched closing tags stay fast (was O(n^2): 40k+40k took ~4.9s)", () => {
  const n = 40000;
  const text = "<a>".repeat(n) + "</b>".repeat(n);
  const started = performance.now();
  const s = outlineOf(text, "xml");
  const elapsed = performance.now() - started;
  assert.equal(s.length, 500, "capped 列表长度");
  assert.ok(elapsed < 2000, `40k 错配闭合耗时 ${elapsed.toFixed(0)}ms，超时（修复前约 4900ms）`);
});

// ---------- 6. YAML — flow 映射 ----------
test("yaml flow: a single-line flow mapping's keys are outlined with the owning key as container", () => {
  const s = outlineOf("key: {a: 1, b: 2}\n", "yaml");
  assert.deepEqual(detail(s), [
    "key:key@1",
    "key:a@1:key",
    "key:b@1:key",
  ], JSON.stringify(detail(s)));
});

test("yaml flow: nested flow containers keep their chain", () => {
  const s = outlineOf("key: {a: {b: 1}, c: [1, 2]}\n", "yaml");
  assert.deepEqual(detail(s), [
    "key:key@1",
    "section:a@1:key",
    "key:b@1:a",
    "section:c@1:key",
  ], JSON.stringify(detail(s)));
});

test("yaml flow: keys inside a multi-line flow mapping are not lifted to top level", () => {
  const code = "key: {\n  a: 1,\n  b: 2\n}\nnext: 3\n";
  const s = outlineOf(code, "yaml");
  assert.deepEqual(detail(s), [
    "key:key@1",
    "key:a@2:key",
    "key:b@3:key",
    "key:next@5",              // 修复前：a/b 无 container，且都是顶层键
  ], JSON.stringify(detail(s)));
});

test("yaml flow: a root flow mapping is parsed as a mapping", () => {
  assert.deepEqual(detail(outlineOf("{a: 1, b: 2}\n", "yaml")), ["key:a@1", "key:b@1"]);
});

test("yaml flow: a flow mapping used as a sequence item keeps the sequence's container", () => {
  const s = outlineOf("items:\n  - {a: 1, b: 2}\n  - {c: 3}\n", "yaml");
  assert.deepEqual(detail(s), [
    "section:items@1",
    "key:a@2:items",
    "key:b@2:items",
    "key:c@3:items",
  ], JSON.stringify(detail(s)));
});

test("yaml flow: quoted keys may contain ':' and ',' without confusing the scanner", () => {
  const s = outlineOf('key: {"a: b": 1, \'x, y\': 2}\n', "yaml");
  assert.deepEqual(detail(s), [
    "key:key@1",
    "key:a: b@1:key",
    "key:x, y@1:key",
  ], JSON.stringify(detail(s)));
});

test("yaml flow: quoted values containing braces/commas create no bogus keys", () => {
  const s = outlineOf('key: {a: "x, {y: 1}", b: 2}\n', "yaml");
  assert.deepEqual(kinds(s), ["key:key", "key:a", "key:b"], JSON.stringify(kinds(s)));
});

test("yaml flow: flow sequences of single-pair mappings keep their keys", () => {
  assert.deepEqual(kinds(outlineOf("key: [a: 1, b: 2]\n", "yaml")), ["key:key", "key:a", "key:b"]);
});

test("yaml flow: an unbalanced flow node falls back without hanging or swallowing the rest", () => {
  const code = "key: {a: 1\nnext: 2\n";
  const s = outlineOf(code, "yaml");
  // 退回逐行行为：key 与 next 都是键（flow 内容不强行入列），且不抛错
  assert.deepEqual(kinds(s), ["key:key", "key:next"], JSON.stringify(kinds(s)));
});

test("yaml flow: braces inside a block scalar are still scalar text (precedence unchanged)", () => {
  const code = "desc: |\n  {a: 1, b: 2}\nreal: 1\n";
  assert.deepEqual(kinds(outlineOf(code, "yaml")), ["key:desc", "key:real"]);
});

// ---------- 回归：YAML 既有语义不受本轮改动影响 ----------
test("yaml regression: anchors/tags/urls/block scalars keep their pre-fix behavior", () => {
  const anchors = outlineOf("defaults: &defaults\n  adapter: postgres\nuse:\n  <<: *b\n  x: 1\n", "yaml");
  assert.deepEqual(detail(anchors), [
    "section:defaults@1",
    "key:adapter@2:defaults",
    "section:use@3",
    "key:<<@4:use",
    "key:x@5:use",
  ], JSON.stringify(detail(anchors)));

  const tag = outlineOf("m: !!map\n  a: 1\n", "yaml");
  assert.deepEqual(detail(tag), ["section:m@1", "key:a@2:m"]);

  assert.deepEqual(kinds(outlineOf("url: http://x/a#frag\nn: 1\n", "yaml")), ["key:url", "key:n"]);

  const block = outlineOf("description: |\n  fake: value\nreal: 1\nfolded: >-\n  also: fake\nlast: 2\n", "yaml");
  assert.deepEqual(kinds(block), ["key:description", "key:real", "key:folded", "key:last"]);
});
