/**
 * dsh-code-nav — outline.js P2 加固回归测试（task-10）。
 *
 * 覆盖 review 报告里剩余的 P2：
 *   1. C# 自动属性 / 表达式属性；        2. PHP 可见性属性；
 *   3. Rust `impl<T>` 与 `impl Trait for Type`；4. Kotlin 扩展函数；
 *   5. Go 分组 `type (`… 与泛型；        6. Python tab / 嵌套类；
 *   7. Vue/Svelte `<script>` 提取（注释 / 字符串）；8. C++ 类外定义；
 *   9. JS get/set/delete/post 方法名；   10. `outlineOfTokens` 复用 tokens。
 *
 * 输出契约保持 `{ kind, name, line, container? }`（line 为 1 基）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineOf, outlineOfTokens } from "../src/outline.js";
import { tokenizeLines } from "../src/tokenize.js";

const kinds = (syms) => syms.map((s) => s.kind + ":" + s.name);
const detail = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}` + (s.container ? ":" + s.container : ""));
const byName = (syms, name) => syms.find((s) => s.name === name);

test("P2-1: C# auto-properties and expression-bodied properties are fields", () => {
  const code = [
    "public class A",
    "{",
    "  private int _base = 1;",
    "  public int X { get; set; }",
    "  public int Y => 1;",
    "  public int Add(int a) => a + _base;",
    "  public void Run(a)",
    "  {",
    "    var local = 1;",
    "    if (local > 0) { use(local); }",
    "  }",
    "}",
  ].join("\n");
  const s = outlineOf(code, "csharp");
  assert.deepEqual(kinds(s), ["class:A", "field:_base", "field:X", "field:Y", "method:Add", "method:Run"], JSON.stringify(s));
  for (const n of ["_base", "X", "Y"]) {
    assert.equal(byName(s, n).container, "A", n + " 未归属 A");
    assert.equal(byName(s, n).kind, "field");
  }
  assert.equal(byName(s, "X").line, 4);
  assert.equal(byName(s, "Y").line, 5);
  // 方法体里的 var 局部变量不能借 `=>` 变成字段（field 规则只看类体直属层）
  assert.ok(!s.some((x) => x.kind === "field" && x.name === "local"), JSON.stringify(s));
});

test("P2-2: PHP visibility properties are fields, local arrays stay variables", () => {
  const code = [
    "<?php",
    "class User {",
    "  private $name;",
    "  public $age = 0;",
    "  protected int $score = 1;",
    "  public static $count = 0;",
    "  public function load() {",
    "    $items = [1, 2];",
    "    $map = array();",
    "    return $items;",
    "  }",
    "}",
  ].join("\n");
  const s = outlineOf(code, "php");
  assert.deepEqual(kinds(s), [
    "class:User", "field:name", "field:age", "field:score", "field:count",
    "method:load", "variable:items", "variable:map",
  ], JSON.stringify(s));
  for (const n of ["name", "age", "score", "count"]) {
    assert.equal(byName(s, n).container, "User", n + " 未归属 User");
  }
  // 原有的局部数组变量规则不能被挤掉
  assert.equal(byName(s, "items").kind, "variable");
  assert.equal(byName(s, "items").line, 8);
});

test("P2-3: Rust impl<T> and impl Trait for Type are named by the implemented type", () => {
  const code = [
    "impl<T> Wrapper<T> {",
    "  pub fn new(v: T) -> Self { Wrapper { v } }",
    "}",
    "impl Display for Wrapper {",
    "  fn fmt(&self) {}",
    "}",
    "impl Point {",
    "  fn x(&self) -> f64 { 0.0 }",
    "}",
  ].join("\n");
  const s = outlineOf(code, "rust");
  assert.deepEqual(kinds(s), ["impl:Wrapper", "method:new", "impl:Wrapper", "method:fmt", "impl:Point", "method:x"], JSON.stringify(s));
  // 泛型 impl 不再整条丢失，方法挂到实现的类型上
  assert.equal(byName(s, "new").container, "Wrapper");
  assert.equal(byName(s, "new").line, 2);
  // trait 实现：符号名取 Wrapper，trait 放 container
  const traitImpl = s.filter((x) => x.kind === "impl")[1];
  assert.equal(traitImpl.name, "Wrapper");
  assert.equal(traitImpl.container, "Display");
  assert.equal(byName(s, "fmt").container, "Wrapper");
});

test("P2-4: Kotlin extension functions keep the method name and receiver", () => {
  const code = [
    "fun String.pad(): String = this",
    "fun List<Int>.sumAll(): Int = 0",
    "fun main() {",
    '  println("hi")',
    "}",
    "class Repo {",
    "  fun load(): Int = 1",
    "}",
  ].join("\n");
  const s = outlineOf(code, "kotlin");
  assert.deepEqual(kinds(s), ["function:pad", "function:sumAll", "function:main", "class:Repo", "method:load"], JSON.stringify(s));
  assert.equal(byName(s, "pad").container, "String");
  assert.equal(byName(s, "sumAll").container, "List<Int>");
  assert.equal(byName(s, "pad").line, 1);
  assert.equal(byName(s, "load").container, "Repo");
});

test("P2-5: Go grouped declarations and generics", () => {
  const code = [
    "package main",                                  // 1
    "",                                              // 2
    "type (",                                        // 3
    "  T struct {",                                  // 4
    "    X int",                                     // 5
    "  }",                                           // 6
    "  I interface {",                               // 7
    "    M()",                                       // 8
    "  }",                                           // 9
    ")",                                             // 10
    "",                                              // 11
    "const (",                                       // 12
    "  C = 1",                                       // 13
    ")",                                             // 14
    "",                                              // 15
    "var (",                                         // 16
    "  V = \"x\"",                                   // 17
    ")",                                             // 18
    "",                                              // 19
    "type List[T any] struct {",                     // 20
    "  items []T",                                   // 21
    "}",                                             // 22
    "",                                              // 23
    "func Map[T any](xs []T) []T {",                 // 24
    "  return nil",                                  // 25
    "}",                                             // 26
    "",                                              // 27
    "func (l *List[T]) Push(x T) {",                 // 28
    "}",                                             // 29
  ].join("\n");
  const s = outlineOf(code, "go");
  assert.deepEqual(detail(s), [
    "struct:T@4", "interface:I@7", "constant:C@13", "variable:V@17",
    "struct:List@20", "function:Map@24", "method:Push@28:List",
  ], JSON.stringify(s));
});

test("P2-6: Python tab indentation and nested classes", () => {
  const code = [
    "class A:",                // 1
    "\tdef m(self):",          // 2
    "\t\tpass",                // 3
    "",                        // 4
    "class Outer:",            // 5
    "    class Meta:",         // 6
    "        pass",            // 7
    "    def method(self):",   // 8
    "        pass",            // 9
    "",                        // 10
    "def top():",              // 11
    "    pass",                // 12
    "X = 1",                   // 13
  ].join("\n");
  const s = outlineOf(code, "python");
  assert.deepEqual(detail(s), [
    "class:A@1", "method:m@2:A", "class:Outer@5", "class:Meta@6",
    "method:method@8:Outer", "function:top@11", "variable:X@13",
  ], JSON.stringify(s));
});

test("P2-7: Vue/Svelte script extraction ignores comments and string closers", () => {
  // HTML 注释里的 <script> 不是脚本块
  const commented = [
    "<!--",
    "<script>",
    "function fake() {}",
    "</script>",
    "-->",
    "<script>",
    "function real() {}",
    "</script>",
  ].join("\n");
  assert.deepEqual(detail(outlineOf(commented, "vue")), ["function:real@7"]);

  // 字符串 / 注释里的 </script> 不能提前截断，后续函数仍能找到
  const quoted = [
    "<script>",
    'const s = "</script>";',
    "// </script>",
    "function after() {}",
    "</script>",
  ].join("\n");
  assert.deepEqual(detail(outlineOf(quoted, "vue")), ["variable:s@2", "function:after@4"]);

  // 双 script 仍合并，行号按整份文件坐标
  const two = [
    "<script>",
    "function a() {}",
    "</script>",
    "<template><div/></template>",
    '<script setup lang="ts">',
    "interface P { a: string }",
    "function b() {}",
    "</script>",
  ].join("\n");
  assert.deepEqual(detail(outlineOf(two, "vue")), ["function:a@2", "interface:P@6", "function:b@7"]);

  // Svelte 同样处理字符串里的闭合标签
  const svelte = [
    "<script>",
    'const s = "</script>";',
    "function hello() {}",
    "</script>",
  ].join("\n");
  assert.deepEqual(detail(outlineOf(svelte, "svelte")), ["variable:s@2", "function:hello@3"]);
});

test("P2-8: C++ out-of-line definitions become methods with container", () => {
  const s = outlineOf("void A::draw() {}\nint Ns::A::area() { return 0; }\nvoid helper() {}\n", "cpp");
  assert.deepEqual(detail(s), [
    "method:draw@1:A",
    "method:area@2:A",
    "function:helper@3",
  ], JSON.stringify(s));
  // 类内声明仍然是方法，类外定义不会把类名当函数名
  const both = outlineOf("class A {\npublic:\n  void draw();\n};\nvoid A::draw() {}\n", "cpp");
  assert.ok(kinds(both).includes("class:A"), JSON.stringify(both));
  assert.ok(both.filter((x) => x.name === "draw").every((x) => x.kind === "method" && x.container === "A"));
});

test("P2-9: JS method names get/set/delete/post survive keyword filtering", () => {
  const code = [
    "class A {",
    "  get() {}",
    "  set(v) {}",
    "  delete(k) {}",
    "  post(b) {}",
    "  method() {",
    "    if (x) { use(x); }",
    "    while (y) { use(y); }",
    "    doStuff();",
    "  }",
    "}",
  ].join("\n");
  const s = outlineOf(code, "javascript");
  assert.deepEqual(detail(s), [
    "class:A@1",
    "method:get@2:A",
    "method:set@3:A",
    "method:delete@4:A",
    "method:post@5:A",
    "method:method@6:A",
  ], JSON.stringify(s));
  // 控制语句与方法体调用不能被当成符号
  for (const bad of ["if", "while", "use", "doStuff"]) {
    assert.ok(!s.some((x) => x.name === bad), bad + " 不应成为符号: " + JSON.stringify(kinds(s)));
  }
  // TS 的 getter/setter 仍按真实属性名（size）出现
  const accessors = outlineOf("class S {\n  get size(): number { return 1; }\n  set size(v: number) {}\n}", "typescript");
  assert.deepEqual(kinds(accessors), ["class:S", "method:size", "method:size"]);
  // 对象字面量里的 get() 不是类方法（不能因为豁免关键字而漏进来）
  const literal = outlineOf("class A {\n  m() {\n    const o = {\n      get() {},\n    };\n  }\n}", "javascript");
  assert.ok(!literal.some((x) => x.kind === "method" && x.name === "get"), JSON.stringify(kinds(literal)));
});

test("P2-10: outlineOfTokens reuses tokens and matches outlineOf", () => {
  const cases = [
    ["javascript", "export function f(a) {}\nclass A {\n  m() {}\n  get x() { return 1; }\n}"],
    ["java", "public class A {\n  private int c = 0;\n  public void m() {}\n}"],
    ["go", "type List[T any] struct { items []T }\nconst ( C = 1 )\nfunc (l *List[T]) Push(x T) {}"],
    ["protobuf", "message M { string id = 1; }\nservice S { rpc G (Req) returns (Res); }"],
    ["python", "class A:\n\tdef m(self):\n\t\tpass"],
    ["rust", "impl<T> Wrapper<T> { fn n() {} }"],
    ["kotlin", "fun String.pad(): String = this"],
    ["csharp", "public class A { public int X { get; set; } }"],
    ["php", "<?php\nclass U { private $n; }"],
    ["sql", "CREATE TABLE IF NOT EXISTS t (id int);"],
    ["json", '{"a": 1, "b": {"c": 2}}'],
  ];
  for (const [lang, text] of cases) {
    const viaText = outlineOf(text, lang);
    const viaTokens = outlineOfTokens(tokenizeLines(text, lang), lang);
    assert.deepEqual(viaTokens, viaText, lang + " 的 outlineOfTokens 与 outlineOf 不一致");
    assert.deepEqual(viaTokens.map((s) => ({ ...s })), viaText.map((s) => ({ ...s })));
  }
  // Vue/Svelte：tokens 没有 script 边界信息，走 join+outlineOf 回退
  const vue = "<template><p/></template>\n<script>\nfunction a() {}\n</script>\n<script setup lang=\"ts\">\nfunction b() {}\n</script>";
  assert.deepEqual(
    outlineOfTokens(tokenizeLines(vue, "vue"), "vue"),
    outlineOf(vue, "vue")
  );
  // 空 / 非法 tokens 安全返回
  assert.deepEqual(outlineOfTokens([], "javascript"), []);
  assert.deepEqual(outlineOfTokens(null, "javascript"), []);
});

test("regression: previous P1 fixes still hold", () => {
  // 方法体局部变量 / return 不产生字段
  assert.deepEqual(kinds(outlineOf("public class A {\n  int find() {\n    int n = 1;\n    return null;\n  }\n}", "java")), ["class:A", "method:find"]);
  // 接口无函数体声明
  assert.deepEqual(kinds(outlineOf("public interface Repo {\n  User find(String id);\n}", "java")), ["interface:Repo", "method:find"]);
  // 跨行参数 + TS 返回类型
  assert.deepEqual(kinds(outlineOf("class A {\n  add(\n    it: string,\n  ): void {}\n}", "typescript")), ["class:A", "method:add"]);
  // 真实字段仍出现
  assert.ok(kinds(outlineOf("public class A {\n  private int count = 0;\n}", "java")).includes("field:count"));
});
