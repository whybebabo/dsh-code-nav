/**
 * dsh-code-nav — outline.js P1 修复回归测试。
 *
 * 覆盖 review 报告里的 7 个 P1：
 *   1. C 家族字段规则把方法体局部变量 / `return x;` 当成字段；
 *   2. SQL DDL 的修饰词顺序与 `IF [NOT] EXISTS`；
 *   3. 跨行参数列表（含 Allman 风格）匹配不到声明；
 *   4. TS/JS 类属性 / 箭头字段从未进入大纲；
 *   5. 无函数体声明（接口 / abstract / C++ 纯虚与 `const;`）；
 *   6. 显式返回类型 + 单行函数体；
 * 另加若干防回归守卫（真字段、返回类型在参数前、方法体普通调用不误报等）。
 *
 * 输出契约保持 `{ kind, name, line, container? }`，line 为 1 基。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineOf } from "../src/outline.js";

/** kind:name 列表（顺序敏感，用于精确断言）。 */
const kinds = (syms) => syms.map((s) => s.kind + ":" + s.name);
/** 找同名符号（同名重载取第一个）。 */
const byName = (syms, name) => syms.find((s) => s.name === name);

test("P1-1: C-family fields only where a class body actually declares them", () => {
  // 方法体里的局部变量与 return 表达式都不是字段
  const java = outlineOf("public class A {\n  int find() {\n    int n = 1;\n    return null;\n  }\n}", "java");
  assert.deepEqual(kinds(java), ["class:A", "method:find"]);
  assert.equal(byName(java, "find").line, 2);
  assert.equal(byName(java, "find").container, "A");

  // C 文件级函数体同理（栈里没有容器，局部变量也不该成为字段）
  const c = outlineOf("int add(int a) {\n  int sum = a + 1;\n  return sum;\n}", "c");
  assert.deepEqual(kinds(c), ["function:add"]);

  // 真正的类字段必须还在，并归属类
  const fieldy = outlineOf(
    "public class A {\n  private int count = 0;\n  public int find() { return count; }\n}",
    "java"
  );
  assert.ok(kinds(fieldy).includes("field:count"), JSON.stringify(kinds(fieldy)));
  assert.equal(byName(fieldy, "count").container, "A");

  // 嵌套类的字段要挂到各自类上（stack 里要能区分层级）
  const nested = outlineOf(
    "public class Outer {\n  private int a = 1;\n  static class Inner {\n    private int b = 2;\n  }\n}",
    "java"
  );
  assert.equal(byName(nested, "a").container, "Outer");
  assert.equal(byName(nested, "b").container, "Inner");

  // Allman 风格类体（`{` 另起一行）里的字段也不能丢
  const allman = outlineOf("public class A\n{\n  private int count = 0;\n}", "java");
  assert.deepEqual(kinds(allman), ["class:A", "field:count"]);
  assert.equal(byName(allman, "count").container, "A");
});

test("P1-2: SQL DDL accepts modifiers in any order and IF [NOT] EXISTS", () => {
  const sql = outlineOf(
    "CREATE TABLE IF NOT EXISTS users (id int);\n" +
      "CREATE UNIQUE INDEX idx ON users (id);\n" +
      "CREATE OR REPLACE VIEW v AS SELECT 1;",
    "sql"
  );
  assert.deepEqual(kinds(sql), ["class:users", "class:idx", "interface:v"]);
  assert.deepEqual(sql.map((s) => s.line), [1, 2, 3]);

  const more = outlineOf(
    [
      "CREATE TEMP TABLE tmp (id int);",
      "DROP TABLE IF EXISTS old_t;",
      "ALTER TABLE users ADD COLUMN x int;",
      "CREATE MATERIALIZED VIEW mv AS SELECT 1;",
      'CREATE TABLE IF NOT EXISTS public."Users" (id int);',
      "CREATE UNIQUE INDEX `MyIdx` ON users (id);",
    ].join("\n"),
    "sql"
  );
  assert.deepEqual(
    kinds(more),
    ["class:tmp", "class:old_t", "class:users", "interface:mv", "class:Users", "class:MyIdx"],
    JSON.stringify(more)
  );
});

test("P1-3: multi-line parameter lists still yield the declaration symbol", () => {
  const js = outlineOf("export function fetchUser(\n  id,\n) {\n  return id;\n}", "javascript");
  assert.deepEqual(kinds(js), ["function:fetchUser"]);
  assert.equal(js[0].line, 1, "符号行号必须是声明首行");

  const java = outlineOf(
    "public class A {\n  public String format(\n    String name,\n    int n\n  ) {\n    return name;\n  }\n}",
    "java"
  );
  assert.deepEqual(kinds(java), ["class:A", "method:format"]);
  assert.equal(byName(java, "format").line, 2);
  assert.equal(byName(java, "format").container, "A");

  // Allman：`)` 与 `{` 之间还隔了换行
  const allman = outlineOf("export function fetchUser(\n  id,\n)\n{\n  return id;\n}", "javascript");
  assert.deepEqual(kinds(allman), ["function:fetchUser"]);

  // 多行参数的箭头函数：const 先被识别为函数而不是变量
  const arrow = outlineOf("const handler = (\n  e: Event,\n) => {\n  use(e);\n};", "typescript");
  assert.deepEqual(kinds(arrow), ["function:handler"]);
  assert.equal(arrow[0].line, 1);
});

test("P1-4: TS/JS class properties and arrow fields are outlined as fields", () => {
  const store = outlineOf(
    "export class Store {\n" +
      "  private items: string[] = [];\n" +
      "  name: string;\n" +
      "  onClick = () => {};\n" +
      "  constructor() {}\n" +
      "  add(it: string): void {}\n" +
      "}",
    "typescript"
  );
  assert.deepEqual(kinds(store), [
    "class:Store",
    "field:items",
    "field:name",
    "field:onClick",
    "constructor:constructor",
    "method:add",
  ]);
  for (const n of ["items", "name", "onClick"]) {
    assert.equal(byName(store, n).container, "Store", n + " 未归属 Store");
    assert.equal(byName(store, n).line, ["items", "name", "onClick"].indexOf(n) + 2);
  }

  // 修饰词 / #私有字段 / ?: 可选 / accessor
  const mods = outlineOf(
    "class C {\n" +
      '  static readonly VERSION = "1";\n' +
      "  #secret = 42;\n" +
      "  protected override ready?: boolean;\n" +
      "  accessor count = 0;\n" +
      "}",
    "typescript"
  );
  assert.deepEqual(kinds(mods), ["class:C", "field:VERSION", "field:#secret", "field:ready", "field:count"]);

  // 方法体里的局部赋值/调用不能变成字段，方法本身也不能被属性规则抢走
  const local = outlineOf("class A {\n  run() {\n    x = 1;\n    doStuff();\n  }\n}", "typescript");
  assert.deepEqual(kinds(local), ["class:A", "method:run"]);
});

test("P1-5: body-less declarations (interface / abstract / C++ const & pure virtual)", () => {
  const java = outlineOf("public interface Repo {\n  User find(String id);\n  void save(User u);\n}", "java");
  assert.deepEqual(kinds(java), ["interface:Repo", "method:find", "method:save"]);
  assert.equal(byName(java, "find").container, "Repo");

  const ts = outlineOf("interface Repo {\n  find(id: string): User;\n}", "typescript");
  assert.deepEqual(kinds(ts), ["interface:Repo", "method:find"]);

  const cpp = outlineOf("class A {\npublic:\n  void draw() const;\n  virtual int area() = 0;\n};", "cpp");
  assert.deepEqual(kinds(cpp), ["class:A", "method:draw", "method:area"]);

  const abs = outlineOf("public abstract class A {\n  abstract void run();\n}", "java");
  assert.ok(kinds(abs).includes("method:run"), JSON.stringify(kinds(abs)));

  // TS 重载签名（类体里以 `;` 结束的方法声明）
  const overload = outlineOf(
    "class Api {\n  find(id: string): User;\n  find(id: number): User;\n  find(id: any): User { return id; }\n}",
    "typescript"
  );
  assert.deepEqual(kinds(overload), ["class:Api", "method:find", "method:find", "method:find"]);

  // 方法体里的普通调用绝不能变成符号
  const calls = outlineOf("class A {\n  void run() {\n    doStuff();\n    helper(1, 2);\n  }\n}", "java");
  assert.deepEqual(kinds(calls), ["class:A", "method:run"]);
});

test("P1-6: explicit return type + one-line body", () => {
  // 之前的 needsBody 只认 `) {`：`: void {` / `: string { ... }` 全被漏掉
  const block = outlineOf(
    'class A {\n  add(it: string): void {}\n  name(): string { return "x"; }\n}',
    "typescript"
  );
  assert.deepEqual(kinds(block), ["class:A", "method:add", "method:name"]);

  // review 里的压缩写法：类与成员在同一个物理行
  const oneLine = outlineOf("class A { add(it: string): void {} }", "typescript");
  assert.deepEqual(kinds(oneLine), ["class:A", "method:add"]);
  assert.equal(byName(oneLine, "add").line, 1);

  const oneLineReturn = outlineOf('class A { name(): string { return "x"; } }', "typescript");
  assert.deepEqual(kinds(oneLineReturn), ["class:A", "method:name"]);
});

test("regression: Java/C# methods with a return type before the params", () => {
  const java = outlineOf(
    "public class App {\n" +
      "  private int counter = 0;\n" +
      "  public static void main(String[] args) {\n" +
      '    System.out.println("hi");\n' +
      "  }\n" +
      "  public int add(int a, int b) {\n" +
      "    return a + b;\n" +
      "  }\n" +
      "}",
    "java"
  );
  assert.deepEqual(kinds(java), ["class:App", "field:counter", "method:main", "method:add"]);
  assert.equal(byName(java, "add").container, "App");
  assert.ok(!kinds(java).includes("method:println"), JSON.stringify(kinds(java)));

  const cs = outlineOf(
    "public class Calculator\n" +
      "{\n" +
      "  private int _base = 1;\n" +
      "  public int Add(int a, int b) => a + b + _base;\n" +
      "  public void Reset()\n" +
      "  {\n" +
      "    _base = 0;\n" +
      "  }\n" +
      "}",
    "csharp"
  );
  assert.ok(kinds(cs).includes("class:Calculator"), JSON.stringify(kinds(cs)));
  assert.ok(kinds(cs).includes("method:Add"));
  assert.ok(kinds(cs).includes("method:Reset"));
  assert.ok(kinds(cs).includes("field:_base"));
  assert.equal(byName(cs, "Reset").container, "Calculator");
  assert.equal(byName(cs, "_base").container, "Calculator");
});

test("regression: PHP / Swift / Java body syntaxes keep their methods", () => {
  const php = outlineOf(
    '<?php\nclass A {\n  public function greet(): string {\n    return GREETING;\n  }\n  public function throwIt() {\n    throw new Exception("x");\n  }\n}',
    "php"
  );
  assert.deepEqual(kinds(php), ["class:A", "method:greet", "method:throwIt"]);

  const swift = outlineOf(
    'class A {\n  func make() -> String {\n    return "x"\n  }\n}',
    "swift"
  );
  assert.deepEqual(kinds(swift), ["class:A", "method:make"]);

  const java = outlineOf("class A {\n  void run() throws Exception {\n  }\n}", "java");
  assert.deepEqual(kinds(java), ["class:A", "method:run"]);
});

test("regression: calls / object literal args / regex parens create no bogus symbols", () => {
  const js = outlineOf(
    [
      "function outer() {",
      "  foo(a, { b: 1 });",
      "  bar(a, [1, 2], { c: 3 });",
      "  expect(/^\\s*\\(/.test(x));",
      "  list.forEach((x) => { use(x); });",
      "  return merge(a, {",
      "    deep: true,",
      "  });",
      "}",
      "",
      "describe(\"suite\", () => {",
      "  test(\"case\", () => {",
      "    doStuff();",
      "  });",
      "});",
    ].join("\n"),
    "javascript"
  );
  assert.deepEqual(kinds(js), ["function:outer"], JSON.stringify(kinds(js)));
});

test("regression: nested / one-line containers keep container attribution", () => {
  const oneLine = outlineOf("class A { m() {} }", "javascript");
  assert.deepEqual(kinds(oneLine), ["class:A", "method:m"]);
  assert.equal(byName(oneLine, "m").container, "A");

  const cpp = outlineOf("class Box {\npublic:\n  Box(int v) : v_(v) {}\n  int get() const { return v_; }\n};", "cpp");
  assert.ok(kinds(cpp).includes("method:Box"), JSON.stringify(kinds(cpp)));
  assert.ok(kinds(cpp).includes("method:get"), JSON.stringify(kinds(cpp)));
});

/* ------------------------------------------------------------------ *
 * 第二轮审查（.work/review/02-outline.md）的回归测试。
 * 编号沿用报告：P0-1 / P1-1 … P1-6（与上面第一轮的 P1-x 不是同一批问题）。
 * ------------------------------------------------------------------ */

/** kind:name@line[:container] 列表（顺序敏感）。 */
const detail = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}` + (s.container ? `:${s.container}` : ""));
/** 断言没有任何 field 符号（局部变量不能变成字段）。 */
const assertNoFields = (syms) => {
  const fields = syms.filter((s) => s.kind === "field");
  assert.deepEqual(fields, [], "不应出现 field: " + JSON.stringify(detail(syms)));
};

test("review-2 P0-1: method-body const/let/var are variables, not fields of the outer class", () => {
  const ts = outlineOf(
    "class Api {\n  fetch() {\n    const url = buildUrl();\n    let n = 1;\n    var v = 2;\n    return this.get(url);\n  }\n}\n",
    "typescript"
  );
  assert.deepEqual(kinds(ts), ["class:Api", "method:fetch", "variable:url", "variable:n", "variable:v"]);
  for (const n of ["url", "n", "v"]) {
    assert.equal(byName(ts, n).kind, "variable", n + " 应是 variable");
    assert.equal(byName(ts, n).container, undefined, n + " 不能归属外层类");
  }
  assertNoFields(ts);

  // 顶层函数体里的 const 也不能变成 field（之前 depth>0 就算字段）
  const js = outlineOf("function f() {\n  const x = 1;\n}\n", "javascript");
  assert.deepEqual(kinds(js), ["function:f", "variable:x"]);
  assertNoFields(js);

  // Swift 的 let / var
  const swift = outlineOf("class A {\n  func f() {\n    let x = 1\n    var y = 2\n  }\n}\n", "swift");
  assert.deepEqual(kinds(swift), ["class:A", "method:f", "variable:x", "variable:y"]);
  assertNoFields(swift);

  // Kotlin 的 val / var
  const kotlin = outlineOf("class A {\n  fun f() {\n    val x = 1\n    var y = 2\n  }\n}\n", "kotlin");
  assert.deepEqual(kinds(kotlin), ["class:A", "method:f", "variable:x", "variable:y"]);
  assertNoFields(kotlin);

  // 对照：真正的类字段仍必须是 field，并归属类
  const fieldy = outlineOf('class A {\n  readonly name: string = "x";\n  run() {}\n}', "typescript");
  assert.deepEqual(kinds(fieldy), ["class:A", "field:name", "method:run"]);
  assert.equal(byName(fieldy, "name").container, "A");
});

test("review-2 P1-2: TS generic functions / methods / arrows are outlined", () => {
  // 泛型函数
  assert.deepEqual(kinds(outlineOf("export function map<T, U>(xs: T[]): U[] {\n  return [];\n}\n", "typescript")), ["function:map"]);
  // 泛型方法（类内）与行号
  const method = outlineOf("class A {\n  find<T>(id: string): T | null {\n    return null;\n  }\n}\n", "typescript");
  assert.deepEqual(detail(method), ["class:A@1", "method:find@2:A"]);
  // 泛型方法（interface 里的无函数体签名）
  assert.deepEqual(kinds(outlineOf("interface Repo {\n  find<T>(id: string): T | null;\n}\n", "typescript")), ["interface:Repo", "method:find"]);
  // 泛型箭头：.ts 允许 `<T>` 与 `<T,>`；.tsx 只认尾逗号 `<T,>`（避开 JSX）
  assert.deepEqual(kinds(outlineOf("const id = <T,>(x: T): T => x;\n", "typescript")), ["function:id"]);
  assert.deepEqual(kinds(outlineOf("const id = <T>(x: T): T => x;\n", "typescript")), ["function:id"]);
  assert.deepEqual(kinds(outlineOf("const id = <T,>(x: T): T => x;\n", "tsx")), ["function:id"]);
  // 嵌套泛型 `>>` 由括号计数配平（不是贪心正则）
  assert.deepEqual(kinds(outlineOf("class A {\n  walk<T extends Map<string, Array<T>>>(m: T): void {}\n}\n", "typescript")), ["class:A", "method:walk"]);
  // 比较表达式 `a < b` 不能被误当成泛型参数表（不产生假方法 / 不丢变量）
  const cmp = outlineOf("class A {\n  m() {\n    const x = a < b;\n  }\n}\n", "typescript");
  assert.deepEqual(kinds(cmp), ["class:A", "method:m", "variable:x"]);
});

test("review-2 P1-3: Swift init / subscript and Kotlin secondary constructor survive keyword filtering", () => {
  const swift = outlineOf(
    "final class S {\n  init(repo: R) {\n    self.r = repo\n  }\n  subscript(i: Int) -> Int {\n    return 0\n  }\n  func load() {}\n}\n",
    "swift"
  );
  assert.deepEqual(detail(swift), [
    "class:S@1", "method:init@2:S", "method:subscript@5:S", "method:load@8:S",
  ], JSON.stringify(detail(swift)));

  const kotlin = outlineOf("class A(val x: Int) {\n  constructor(x: Int, y: Int) : this(x) {\n  }\n  fun load() {}\n}\n", "kotlin");
  assert.deepEqual(detail(kotlin), ["class:A@1", "constructor:constructor@2:A", "method:load@4:A"], JSON.stringify(detail(kotlin)));
});

test("review-2 P1-4: several members on one physical line are all outlined", () => {
  // 类字段 + 方法同行
  assert.deepEqual(detail(outlineOf("class A { x = 1; m() {} }\n", "typescript")), ["class:A@1", "field:x@1:A", "method:m@1:A"]);
  // 单行 C struct 两个字段
  assert.deepEqual(detail(outlineOf("struct S { int a; int b; };\n", "c")), ["struct:S@1", "field:a@1:S", "field:b@1:S"]);
  // 单行空体 Java interface 两个方法（之前整段以 `}` 结尾，两个都丢）
  assert.deepEqual(detail(outlineOf("interface I { void a(); void b(); }\n", "java")), ["interface:I@1", "method:a@1:I", "method:b@1:I"]);
  // 括号内的分号不能被切（for(;;) / 调参 / 数组）；字符串里的分号已由 cleanOf 剥离
  assert.deepEqual(kinds(outlineOf("function f() {\n  for (let i = 0; i < 3; i++) { use(i); }\n}\n", "javascript")), ["function:f"]);
  assert.deepEqual(kinds(outlineOf("const a = 1;\nconst b = 2;\n", "javascript")), ["variable:a", "variable:b"]);
});

test("review-2 P1-5: nested functions are functions, not methods of the outer class", () => {
  // JS：方法体里的 function 不能挂到外层类
  assert.deepEqual(
    detail(outlineOf("class A {\n  m() {\n    function helper() {}\n    return helper;\n  }\n}\n", "javascript")),
    ["class:A@1", "method:m@2:A", "function:helper@3"]
  );
  // JS：IIFE 里的 function 同理
  assert.deepEqual(detail(outlineOf("(function () {\n  function inner() {}\n})();\n", "javascript")), ["function:inner@2"]);
  // Python：方法体里再 def 是嵌套函数
  assert.deepEqual(
    detail(outlineOf("class A:\n    def m(self):\n        def inner():\n            pass\n        return inner\n", "python")),
    ["class:A@1", "method:m@2:A", "function:inner@3"]
  );
  // Rust：mod 不是容器，里面的 fn 是函数；impl 里的 fn 才是方法
  assert.deepEqual(detail(outlineOf("pub mod util {\n  pub fn helper() {}\n}\n", "rust")), ["function:helper@2"]);
  assert.deepEqual(detail(outlineOf("impl Point {\n  fn x(&self) -> f64 { 0.0 }\n}\n", "rust")), ["impl:Point@1", "method:x@2:Point"]);
});

test("review-2 P1-6: C++ header constructor / destructor declarations are kept", () => {
  const s = outlineOf("class A {\npublic:\n  A(int v);\n  ~A();\n  void draw() const;\n};\n", "cpp");
  assert.deepEqual(detail(s), ["class:A@1", "method:A@3:A", "method:~A@4:A", "method:draw@5:A"]);
});

test("review-2 P1-1: Ruby class container applies to every member (end-scoped blocks)", () => {
  // attr_accessor 出现在第一个方法之前时，后面的方法仍要归属类
  assert.deepEqual(
    detail(outlineOf("class Foo\n  attr_accessor :x\n  def a\n  end\n  def b\n  end\nend\n", "ruby")),
    ["class:Foo@1", "field:x@2:Foo", "method:a@3:Foo", "method:b@5:Foo"]
  );
  // 嵌套 module / class，以及 def self.x
  assert.deepEqual(
    detail(outlineOf("module Demo\n  class Greeter\n    attr_reader :name\n    def initialize(n)\n      @n = n\n    end\n    def self.create(n)\n      new(n)\n    end\n  end\nend\n", "ruby")),
    ["class:Demo@1", "class:Greeter@2", "field:name@3:Greeter", "method:initialize@4:Greeter", "method:create@7:Greeter"]
  );
  // 方法体里的 if / do 块不能让类作用域提前结束
  const blocks = outlineOf(
    "class Foo\n  def a\n    if cond\n      x = 1\n    end\n    items.each do |i|\n      use(i)\n    end\n  end\n  def b\n  end\nend\n",
    "ruby"
  );
  assert.deepEqual(detail(blocks), ["class:Foo@1", "method:a@2:Foo", "method:b@10:Foo"], JSON.stringify(detail(blocks)));
  // 单行 `class Foo; def a; end; end`
  assert.deepEqual(detail(outlineOf("class Foo; def a; end; end\n", "ruby")), ["class:Foo@1", "method:a@1:Foo"]);
});

