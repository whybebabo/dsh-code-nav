/**
 * dsh-code-nav — outline.js 第四轮 review 修复回归测试（outline review 2026-11-09）。
 *
 * 覆盖：
 *   1. P1-R3 Kotlin `enum class X`：通用 CLASS_RE 把 `enum class Color` 读成
 *      keyword=enum + name=class，枚举真名丢失、成员容器变成 `class`；
 *   2. OUT-4 TS/JS `semi: false`：接口成员 / 只有类型注解的类字段没有 `;` 时丢失；
 *   3. OUT-8 C `typedef struct/enum`（有标签 + 匿名）完全没有符号、字段也没有容器；
 *   4. OUT-6 Python 带注解的类属性（dataclass / Pydantic 风格）丢失。
 *
 * 输出契约保持 `{ kind, name, line, container? }`（line 为 1 基）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineOf } from "../src/outline.js";

/** kind:name@line[:container] 列表（顺序敏感）。 */
const detail = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}` + (s.container ? `:${s.container}` : ""));
/** 同名符号（同名重载取第一个）。 */
const byName = (syms, name) => syms.find((s) => s.name === name);

// ---------------------------------------------------------------- P1-R3 Kotlin

test("P1-R3: Kotlin `enum class` exports the real name as kind enum (top-level / modified / args)", () => {
  // 顶层：之前是 enum:class（keyword=enum + name=class），真名 Color 从未出现
  const top = outlineOf("enum class Color { RED, GREEN }\n", "kotlin");
  assert.deepEqual(detail(top), ["enum:Color@1"]);
  assert.equal(top[0].kind, "enum");
  assert.notEqual(top[0].name, "class", "枚举名必须取真实类型名，而不是 class 关键字");

  // Allman 风格（`{` 另起一行）同样命中
  assert.deepEqual(detail(outlineOf("enum class Color\n{\n  RED\n}\n", "kotlin")), ["enum:Color@1"]);

  // 带主构造参数
  assert.deepEqual(detail(outlineOf("enum class Color(val rgb: Int) { RED(0) }\n", "kotlin")), ["enum:Color@1"]);

  // 带修饰词
  assert.deepEqual(detail(outlineOf("internal enum class E { A }\n", "kotlin")), ["enum:E@1"]);
  assert.deepEqual(detail(outlineOf("private enum class E { A }\n", "kotlin")), ["enum:E@1"]);

  // 嵌套在类里的枚举也必须是真名
  const nested = outlineOf("class Outer {\n  enum class Inner { A }\n  fun m() {}\n}\n", "kotlin");
  assert.deepEqual(detail(nested), ["class:Outer@1", "enum:Inner@2", "method:m@3:Outer"]);
});

test("P1-R3: Kotlin enum members mount on the enum container, not on a bogus `class`", () => {
  const code = [
    "enum class Color {",       // 1
    "  RED,",                   // 2
    "  GREEN;",                 // 3
    '  fun label() = "r"',      // 4
    "  companion object {",     // 5
    "    fun of(): Color = RED",// 6
    "  }",                      // 7
    "}",                        // 8
    "",                         // 9
    "fun top() {}",             // 10
  ].join("\n");
  const s = outlineOf(code, "kotlin");
  assert.deepEqual(detail(s), [
    "enum:Color@1", "method:label@4:Color", "method:of@6:Color", "function:top@10",
  ]);
  // 任何一个成员都不能挂到 "class" 这个假容器上
  assert.ok(!s.some((x) => x.container === "class"), JSON.stringify(s));
});

test("P1-R3: Kotlin data / sealed / value / object declarations keep their old shape", () => {
  assert.deepEqual(detail(outlineOf("data class P(val x: Int)\n", "kotlin")), ["class:P@1"]);
  assert.deepEqual(detail(outlineOf("sealed class R\n", "kotlin")), ["class:R@1"]);
  assert.deepEqual(detail(outlineOf("value class V(val x: Int)\n", "kotlin")), ["class:V@1"]);
  assert.deepEqual(detail(outlineOf("object S { fun f() {} }\n", "kotlin")), ["class:S@1", "method:f@1:S"]);
  // 接口/抽象类不受影响
  assert.deepEqual(detail(outlineOf("interface I {\n  fun run()\n}\n", "kotlin")), [
    "interface:I@1", "method:run@2:I",
  ]);
});

// ---------------------------------------------------------------- OUT-4 semi:false

test("OUT-4: TS interface members without trailing semicolons are outlined", () => {
  const code = [
    "interface I {",                             // 1
    "  run(): void",                             // 2
    "  stop(reason?: string): Promise<void>",    // 3
    "  readonly id: number",                     // 4
    "}",                                         // 5
  ].join("\n");
  assert.deepEqual(detail(outlineOf(code, "typescript")), [
    "interface:I@1", "method:run@2:I", "method:stop@3:I", "field:id@4:I",
  ]);

  // 跨行参数表的签名：符号行号取声明首行，续行不重复出符号
  const multiline = outlineOf("interface I {\n  run(\n    id: string,\n  ): void\n}\n", "typescript");
  assert.deepEqual(detail(multiline), ["interface:I@1", "method:run@2:I"]);

  // 参数里带对象类型字面量（`{` `}` 会把虚拟行切段）
  assert.deepEqual(
    detail(outlineOf("interface I {\n  run(opts: { a: number }): void\n}\n", "typescript")),
    ["interface:I@1", "method:run@2:I"]
  );

  // 带分号的旧路径不变
  assert.deepEqual(
    detail(outlineOf("interface I {\n  run(): void;\n  stop(): void;\n}\n", "typescript")),
    ["interface:I@1", "method:run@2:I", "method:stop@3:I"]
  );
});

test("OUT-4: TS type-only class fields without semicolons are outlined as fields", () => {
  const code = [
    "class A {",        // 1
    "  foo: string",    // 2
    "  bar?: number",   // 3
    "  baz = 1",        // 4
    "  m() {}",         // 5
    "}",                // 6
  ].join("\n");
  const s = outlineOf(code, "typescript");
  assert.deepEqual(detail(s), [
    "class:A@1", "field:foo@2:A", "field:bar@3:A", "field:baz@4:A", "method:m@5:A",
  ]);

  // 带 `;` / `=` 的字段行为不变（修饰词 / 可选 / 私有字段）
  assert.deepEqual(
    detail(outlineOf("class C {\n  static readonly V = 1;\n  #secret = 42;\n  ready?: boolean;\n}\n", "typescript")),
    ["class:C@1", "field:V@2:C", "field:#secret@3:C", "field:ready@4:C"]
  );

  // 单行类体里的无分号成员保持旧行为（换行才是终止符，不能把同行 `}` 当结束）
  assert.deepEqual(detail(outlineOf("interface I { a: string }", "typescript")), ["interface:I@1"]);
});

test("OUT-4: method-body locals / object literals still never become fields", () => {
  const local = outlineOf(
    [
      "class A {",                       // 1
      "  run() {",                       // 2
      "    const url = build()",         // 3
      "    let n = 1",                   // 4
      "    const o = {",                 // 5
      "      key: 1,",                   // 6
      "    }",                           // 7
      "    return url",                  // 8
      "  }",                             // 9
      "}",                               // 10
    ].join("\n"),
    "typescript"
  );
  assert.deepEqual(detail(local), [
    "class:A@1", "method:run@2:A", "variable:url@3", "variable:n@4", "variable:o@5",
  ]);
  assert.ok(!local.some((x) => x.kind === "field"), JSON.stringify(local));
  assert.ok(!local.some((x) => x.name === "key"), JSON.stringify(local));
});

// ---------------------------------------------------------------- OUT-8 C typedef

test("OUT-8: C `typedef struct Named { … }` exports struct:Named and mounts fields under it", () => {
  const tagged = outlineOf("typedef struct Named {\n  int a;\n} Named;\n", "c");
  assert.deepEqual(detail(tagged), ["struct:Named@1", "field:a@2:Named"]);
  // 收尾的 `} Named;` 不能产生第二个符号
  assert.equal(tagged.filter((x) => x.name === "Named").length, 1);

  // 无别名的 typedef 也只要一个符号
  assert.deepEqual(detail(outlineOf("typedef struct Named {\n  int a;\n};\n", "c")), [
    "struct:Named@1", "field:a@2:Named",
  ]);
});

test("OUT-8: anonymous `typedef struct { … } Alias;` uses the alias as a container", () => {
  const anon = outlineOf("typedef struct {\n  int x;\n  int y;\n} point_t;\n", "c");
  // 符号取 typedef 开行（容器必须在解析结构体字段时就存在），名字取收尾别名
  assert.deepEqual(detail(anon), ["struct:point_t@1", "field:x@2:point_t", "field:y@3:point_t"]);
  assert.equal(anon.filter((x) => x.name === "point_t").length, 1, "`} point_t;` 不能重复出符号");

  // 单行形式
  assert.deepEqual(detail(outlineOf("typedef struct { int x; int y; } pt2;\n", "c")), [
    "struct:pt2@1", "field:x@1:pt2", "field:y@1:pt2",
  ]);

  // 枚举：别名成符号；与 Java/C# 的枚举一致，枚举值本身不单独入列
  const en = outlineOf("typedef enum { RED, GREEN } color_t;\n", "c");
  assert.deepEqual(detail(en), ["enum:color_t@1"]);
  assert.equal(en.filter((x) => x.name === "color_t").length, 1);
});

test("OUT-8: plain C struct/enum behavior is unchanged", () => {
  // 对照组：非 typedef 的 struct 仍然只有 struct + 字段
  assert.deepEqual(detail(outlineOf("struct Named {\n  int a;\n};\n", "c")), [
    "struct:Named@1", "field:a@2:Named",
  ]);
  assert.deepEqual(detail(outlineOf("enum Color { RED, GREEN };\n", "c")), ["enum:Color@1"]);
  // 函数指针 typedef 不是 struct/enum：保持不出符号（不在本次修复范围）
  assert.deepEqual(detail(outlineOf("typedef int (*cmp_fn)(const void *, const void *);\n", "c")), []);
});

// ---------------------------------------------------------------- OUT-6 Python 注解

test("OUT-6: Python annotated class attributes are fields (dataclass / Pydantic style)", () => {
  const code = [
    "from dataclasses import dataclass", // 1
    "",                                  // 2
    "@dataclass",                        // 3
    "class C:",                          // 4
    "    x: int",                        // 5
    '    y: str = "a"',                  // 6
    "    z: list[int] = None",           // 7
  ].join("\n");
  assert.deepEqual(detail(outlineOf(code, "python")), [
    "class:C@4", "field:x@5:C", "field:y@6:C", "field:z@7:C",
  ]);

  // Pydantic 风格：带注解 + 默认值调用
  assert.deepEqual(detail(outlineOf('class C:\n    name: str = Field(default="")\n', "python")), [
    "class:C@1", "field:name@2:C",
  ]);

  // 模块级带注解声明是变量
  assert.deepEqual(detail(outlineOf("TIMEOUT: int = 30\n", "python")), ["variable:TIMEOUT@1"]);
});

test("OUT-6: plain Python class control — bare assignments still fields, locals still out", () => {
  const plain = outlineOf(
    [
      "class D:",             // 1
      "    count: int = 0",   // 2
      "    plain = 1",        // 3
      "    def m(self):",     // 4
      "        local: int = 1", // 5
      "        self.attr = 2",  // 6
      "        pass",         // 7
    ].join("\n"),
    "python"
  );
  assert.deepEqual(detail(plain), [
    "class:D@1", "field:count@2:D", "field:plain@3:D", "method:m@4:D",
  ]);
  assert.ok(!plain.some((x) => x.name === "local"), "方法体局部声明不应进大纲");
  assert.ok(!plain.some((x) => x.name === "attr"), "self.attr 实例赋值不应进大纲");

  // dict 续行（括号深度 > 0）里的 `key: value` 不是类属性
  const dict = outlineOf("class C:\n    MAP = {\n        HOST: 8080,\n    }\n", "python");
  assert.deepEqual(detail(dict), ["class:C@1", "field:MAP@2:C"]);
});
