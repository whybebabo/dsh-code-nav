/**
 * dsh-code-nav — 第四轮 outline 修复回归（`02-outline.md` 剩余 P2 项）。
 *
 * 覆盖：
 *   1. Vue/Svelte 的 `</script>` 收尾：JS 词法感知扫描（正则 / 字符串 / 注释 /
 *      模板字符串里的 `</script` 不算收尾）；
 *   2. Go 分组声明里「省略值」的成员与 `type Alias = X` 别名；
 *   3. Python 类体属性（field + container），方法体局部赋值仍不进；
 *   4. Swift protocol 里没有函数体、也没有分号的 `func` 要求；
 *   5. C++ 同一行的 `template <...> class X {`。
 *
 * 输出契约保持 `{ kind, name, line, container? }`（line 为 1 基）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineOf } from "../src/outline.js";

const kinds = (syms) => syms.map((s) => s.kind + ":" + s.name);
const detail = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}` + (s.container ? `:${s.container}` : ""));

test("review-4 SFC: regex-literal quotes do not swallow the real </script>", () => {
  // 修复前：正则 /'/ 里的单引号让扫描器进入「字符串」状态，随后把真正的
  // `'</script>'` 里的 </script> 当成收尾标签 → function after 整条丢失。
  const quoteRegex = "<script>\nconst re = /'/;\nconst s = '</script>';\nfunction after() {}\n</script>\n";
  assert.deepEqual(detail(outlineOf(quoteRegex, "vue")), [
    "variable:re@2", "variable:s@3", "function:after@4",
  ]);

  // 修复前：正则 /"/ 找不到同文件里下一个双引号 → 收尾标签找不到（null 回退），
  // 后面的 <template> 正文被并进脚本；修复后模板里的同名文本不应变成符号。
  const doubleRegex = '<script>\nconst re = /"/;\nfunction after() {}\n</script>\n<template>\n  <div>function fake() {}</div>\n</template>\n';
  assert.deepEqual(detail(outlineOf(doubleRegex, "vue")), ["variable:re@2", "function:after@3"]);

  // 修复前：第一个块的正则引号把第二个块吞进同一段，第二块按 JavaScript 解析，
  // TS 泛型箭头变成 variable；修复后两个块各自解析（第二块 lang="ts"）。
  const twoBlocks = "<script>\nconst re = /'/;\n</script>\n<script setup lang=\"ts\">\nconst id = <T>(x: T) => x;\n</script>\n";
  assert.deepEqual(detail(outlineOf(twoBlocks, "vue")), ["variable:re@2", "function:id@5"]);

  // 字符串 / 行注释 / 块注释 / 模板字符串 / 正则里的 </script 都不算收尾。
  const literals = [
    "<script>",
    "// </script>",
    "/* </script> */",
    "const t = `</script>`;",
    'const s = "</script>";',
    "const re = /<\\/script>/;",
    "function after() {}",
    "</script>",
    "",
  ].join("\n");
  assert.deepEqual(detail(outlineOf(literals, "vue")), [
    "variable:t@4", "variable:s@5", "variable:re@6", "function:after@7",
  ]);

  // Svelte 走同一条路径。
  const svelte = "<script>\nconst re = /'/;\nconst s = '</script>';\nfunction after() {}\n</script>\n";
  assert.deepEqual(detail(outlineOf(svelte, "svelte")), ["variable:re@2", "variable:s@3", "function:after@4"]);
});

test("review-4 SFC: self-closing script tags and tag end scanning (aligned with tokenize.js)", () => {
  // 自闭合 `<script ... />` 没有正文：不能把剩余文件当脚本区间。
  // 可观察差异：自闭合标签后紧跟的 TS 块不能再被并进首个 JS 块（否则泛型箭头按 JS 解析）。
  assert.deepEqual(
    detail(outlineOf('<script src="./a.ts" />\n<script setup lang="ts">\nconst id = <T>(x: T) => x;\n</script>\n', "vue")),
    ["function:id@3"]
  );
  // 自闭合标签+模板正文：不产生任何符号
  assert.deepEqual(outlineOf('<script src="./a.ts" />\n<template>\n  <div>function fake() {}</div>\n</template>\n', "vue"), []);
  // 自闭合标签之后的真 script 块仍要解析。
  assert.deepEqual(
    detail(outlineOf('<script src="./a.js" />\n<script>\nfunction real() {}\n</script>\n', "vue")),
    ["function:real@3"]
  );
  // 开标签属性值里的 `>` 不提前结束标签。
  assert.deepEqual(
    detail(outlineOf('<script data-x="a>b">\nfunction ok() {}\n</script>\n', "vue")),
    ["function:ok@2"]
  );
  // 收尾标签允许任意多空白 / 换行（旧实现是 16 字符窗口 → `</script` + 10 空格就找不到）
  assert.deepEqual(detail(outlineOf("<script>\nfunction ok() {}\n</script     >\n", "vue")), ["function:ok@2"]);
  assert.deepEqual(detail(outlineOf("<script>\nfunction ok() {}\n</script\n>\n", "vue")), ["function:ok@2"]);
  assert.deepEqual(
    detail(outlineOf('<script>\nconst a = 1;\n</script          >\n<script setup lang="ts">\nconst id = <T>(x: T) => x;\n</script>\n', "vue")),
    ["variable:a@2", "function:id@5"]
  );
  // 未闭合的普通字符串在行尾放弃（与 tokenize 的状态机一致），不吞掉收尾标签。
  assert.deepEqual(detail(outlineOf('<script>\nconst s = "unterminated\n</script>\n', "vue")), ["variable:s@2"]);
  // `<script lang=…>` 的 TS 判定与 tokenize.js 的 sfcScriptRanges 同口径
  // （引号可省、大小写不敏感）——避免高亮按 TS、大纲按 JS 的两套口径。
  assert.deepEqual(kinds(outlineOf("<script setup lang=ts>\ninterface I { a: string }\n</script>\n", "vue")), ["interface:I"]);
  assert.deepEqual(kinds(outlineOf('<script setup lang="TS">\nconst f = <T>(x: T) => x;\n</script>\n', "vue")), ["function:f"]);
  assert.deepEqual(kinds(outlineOf("<script setup lang=typescript>\nconst f = <T>(x: T) => x;\n</script>\n", "vue")), ["function:f"]);
});

test("review-4 SFC: division is not mistaken for a regex literal", () => {
  // `b / c` 的 `/` 是除号：不能被当正则起点吞掉后面的内容。
  const division = "<script>\nconst a = b / c;\nconst re = /['\"]/;\nfunction afterDiv() {}\n</script>\n";
  assert.deepEqual(detail(outlineOf(division, "vue")), [
    "variable:a@2", "variable:re@3", "function:afterDiv@4",
  ]);

  // 表达式位置（return / 行首 / `{` 之后）的 `/` 是正则：里面的引号不能带偏状态。
  const exprRegex = "<script>\nfunction f() {\n  return /['\"]/;\n}\nif (ok) { /re/.test(s); }\nfunction after() {}\n</script>\n";
  assert.deepEqual(detail(outlineOf(exprRegex, "vue")), ["function:f@2", "function:after@6"]);
});

test("review-4 Go: grouped declarations with omitted values and type aliases", () => {
  const code = [
    "package main",       // 1
    "",                   // 2
    "const (",            // 3
    "  A = iota",         // 4
    "  B",                // 5 省略值：值同上一行
    "  C",                // 6
    ")",                  // 7
    "",                   // 8
    "var (",              // 9
    "  X = 1",            // 10
    "  Y string",         // 11 省略初值
    ")",                  // 12
    "",                   // 13
    "type Alias = User",  // 14 类型别名
    "type (",             // 15
    "  ID = int64",       // 16 分组内别名
    "  Point struct {",   // 17
    "    X int",          // 18
    "  }",                // 19
    ")",                  // 20
    "",                   // 21
    "func F() {}",        // 22
  ].join("\n");
  assert.deepEqual(detail(outlineOf(code, "go")), [
    "constant:A@4", "constant:B@5", "constant:C@6",
    "variable:X@10", "variable:Y@11",
    "class:Alias@14", "class:ID@16", "struct:Point@17",
    "function:F@22",
  ], JSON.stringify(detail(outlineOf(code, "go"))));
});

test("review-4 Python: class-body assignments are fields, method locals stay out", () => {
  const code = [
    "MAX = 1",                 // 1 模块级变量
    "",                        // 2
    "class A:",                // 3
    '    name = "x"',          // 4 类属性
    "    def m(self):",        // 5
    "        local = 1",       // 6 方法体局部 → 不进
    "        self.attr = 2",   // 7 实例属性 → 不进
    "    class Inner:",        // 8
    "        value = 3",       // 9 内层类属性
    "    def n(self):",        // 10
    "        pass",            // 11
  ].join("\n");
  const s = outlineOf(code, "python");
  assert.deepEqual(detail(s), [
    "variable:MAX@1", "class:A@3", "field:name@4:A",
    "method:m@5:A", "class:Inner@8", "field:value@9:Inner", "method:n@10:A",
  ], JSON.stringify(detail(s)));
  // 方法体里的局部 / 实例赋值不能出现在大纲里（与第三轮 P0-1 的口径一致）
  assert.ok(!s.some((x) => x.name === "local"), "方法体局部赋值不应进大纲");
  assert.ok(!s.some((x) => x.name === "attr"), "self.attr 实例赋值不应进大纲");
});

test("review-4 Swift: protocol body-less func requirements", () => {
  const code = [
    "protocol Repo {",                     // 1
    "    func find(id: Int) -> User?",     // 2 无函数体、无分号
    "    func save(_ user: User)",         // 3
    "}",                                   // 4
    "",                                    // 5
    "class A {",                           // 6
    "    func run() {",                    // 7
    "        helper()",                    // 8 调用不是符号
    "    }",                               // 9
    "}",                                   // 10
  ].join("\n");
  assert.deepEqual(detail(outlineOf(code, "swift")), [
    "interface:Repo@1", "method:find@2:Repo", "method:save@3:Repo",
    "class:A@6", "method:run@7:A",
  ], JSON.stringify(detail(outlineOf(code, "swift"))));

  // 跨行参数表的 protocol 要求：符号行号取声明首行，续行不应重复出符号
  const multiline = "protocol P {\n    func f(\n        id: Int\n    ) -> User?\n    func g()\n}\n";
  assert.deepEqual(detail(outlineOf(multiline, "swift")), [
    "interface:P@1", "method:f@2:P", "method:g@5:P",
  ], JSON.stringify(detail(outlineOf(multiline, "swift"))));
});

test("review-4 C++: template class declaration on one physical line", () => {
  const code = [
    "template <typename T> class Box {",            // 1
    "public:",                                       // 2
    "  T get();",                                    // 3
    "};",                                            // 4
    "",                                              // 5
    "template <typename K, typename V>",             // 6
    "class Pair {",                                  // 7 换行写法仍然正常
    "public:",                                       // 8
    "  K first;",                                    // 9
    "};",                                            // 10
    "",                                              // 11
    "template <typename T, typename U> struct Wrap { T a; };", // 12
    "",                                              // 13
    "template <typename M = std::map<int, std::vector<int>>> class Cfg {", // 14
    "public:",                                       // 15
    "  M value;",                                    // 16
    "};",                                            // 17
  ].join("\n");
  assert.deepEqual(detail(outlineOf(code, "cpp")), [
    "class:Box@1", "method:get@3:Box",
    "class:Pair@7", "field:first@9:Pair",
    "struct:Wrap@12", "field:a@12:Wrap",
    "class:Cfg@14", "field:value@16:Cfg",
  ], JSON.stringify(detail(outlineOf(code, "cpp"))));

  // 非模板的 C++ 类不受影响（模板头只对 cpp 生效）
  assert.deepEqual(kinds(outlineOf("class Plain {\npublic:\n  int v;\n};\n", "cpp")), ["class:Plain", "field:v"]);
});
