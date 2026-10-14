import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { langOf, LANG_EXT, LANG_META } from "../src/lang-registry.js";
import { tokenizeLines } from "../src/tokenize.js";
import { outlineOf, kindGroup, OUTLINE_MAX_SYMBOLS } from "../src/outline.js";
import { findMatches, spansOfLine, MAX_MATCHES } from "../src/search.js";
import { SELECTION_LIMIT, selectionHeader, buildSelectionInsert } from "../src/selection.js";
import { RENDER_MAX_LINES, renderedLineCount, inRenderWindow, clipToRenderWindow, clipZeroBasedToRenderWindow } from "../src/render-window.js";
import { propertiesKeyEnd, propertiesKeySlice, unescapePropertyKey } from "../src/properties-key.js";
import { buildBundle, findCollisions, stripModule, topLevelNames, cnUsage, MODULES, EXPORTS } from "../scripts/build.mjs";

/** Java properties 里的字面反斜杠（避免在字符串转义里数不清个数）。 */
const BS = String.fromCharCode(92);

// ---------- lang-registry ----------
test("langOf maps extensions", () => {
  assert.equal(langOf("src/App.tsx"), "tsx");
  assert.equal(langOf("a/b/main.py"), "python");
  assert.equal(langOf("C:\\repo\\Program.cs"), "csharp");
  assert.equal(langOf("README.md"), null);
  assert.equal(langOf("noext"), null);
  assert.equal(langOf(""), null);
});

test("langOf maps proto", () => {
  assert.equal(langOf("api/user.proto"), "protobuf");
  assert.equal(langOf("C:\\repo\\service.proto"), "protobuf");
});

test("langOf maps config extensions", () => {
  assert.equal(langOf("package.json"), "json");
  assert.equal(langOf("tsconfig.jsonc"), "json");
  assert.equal(langOf("data.json5"), "json");
  assert.equal(langOf("events.jsonl"), "json");
  assert.equal(langOf("docker-compose.yml"), "yaml");
  assert.equal(langOf("ci.yaml"), "yaml");
  assert.equal(langOf("Cargo.toml"), "toml");
  assert.equal(langOf("pom.xml"), "xml");
  assert.equal(langOf("info.plist"), "xml");
  assert.equal(langOf("App.csproj"), "xml");
  assert.equal(langOf("app.ini"), "ini");
  assert.equal(langOf("app.properties"), "properties");
  // HTML / SVG 有意不收：前者归内置 HTML 预览、后者归图片预览，
  // 本预览器 priority 更高，收了会把「渲染预览」降级成源码视图。
  assert.equal(langOf("index.html"), null);
  assert.equal(langOf("logo.svg"), null);
});

test("langOf recognises dotfiles", () => {
  assert.equal(langOf(".env"), "dotenv");
  assert.equal(langOf("C:\\repo\\.env"), "dotenv");
  assert.equal(langOf(".editorconfig"), "ini");
  assert.equal(langOf(".gitconfig"), "ini");
  assert.equal(langOf(".npmrc"), "ini");
  // 未收录的点文件与以点结尾的名字仍返回 null
  assert.equal(langOf(".gitignore"), null);
  assert.equal(langOf("trailing."), null);
});

test("every LANG_EXT value has metadata", () => {
  for (const v of new Set(Object.values(LANG_EXT))) {
    assert.ok(v, "empty lang id");
    assert.ok(LANG_META[v], `LANG_EXT maps to "${v}" with no LANG_META entry`);
  }
});

// ---------- tokenize ----------
test("tokenize JS: keywords, strings, comments", () => {
  const t = tokenizeLines('const x = "hi"; // note\n// line\nlet y = 42;\n/* block\n   comment */\nfunction f() {}', "javascript");
  assert.equal(t.length, 6);
  const cls = (i) => t[i].segs.map((s) => s.cls).join(",");
  // 第一行：const(kw) x(ident) =(空) "hi"(string) ;(空) // note(comment)
  assert.ok(cls(0).includes("c-kw"));
  assert.ok(cls(0).includes("c-string"));
  assert.ok(cls(0).includes("c-comment"));
  // 块注释跨行：第 4 行整行 comment
  assert.ok(t[4].segs.every((s) => s.cls === "c-comment"));
  // 数字
  assert.ok(cls(2).includes("c-num"));
});

test("tokenize python: triple-quote cross-line", () => {
  const t = tokenizeLines('"""doc\ntext"""\nx = 1  # c', "python");
  assert.equal(t.length, 3);
  assert.ok(t[0].segs.every((s) => s.cls === "c-string"));
  assert.ok(t[1].segs[0].cls === "c-string");
  assert.ok(t[2].segs.some((s) => s.cls === "c-comment"));
});

test("tokenize rust: raw string tolerated", () => {
  const t = tokenizeLines('let s = r#"a"b"#;\nlet n = 42;', "rust");
  assert.ok(t[0].segs.some((s) => s.cls === "c-string"));
});

test("tokenize protobuf: keywords, types, strings and both comment forms", () => {
  const t = tokenizeLines(
    'syntax = "proto3"; // 版本\n/* 包\n   说明 */\nmessage User {\n  repeated Address a = 1;\n  map<string, int32> n = 2;\n}',
    "protobuf"
  );
  const cls = (i) => t[i].segs.map((s) => s.cls).join(",");
  assert.ok(cls(0).includes("c-kw"), cls(0));
  assert.ok(cls(0).includes("c-string"), cls(0));
  assert.ok(cls(0).includes("c-comment"), cls(0));
  assert.ok(t[1].segs.every((s) => s.cls === "c-comment"), "块注释起始行未整行上色");
  assert.ok(t[2].segs.every((s) => s.cls === "c-comment"), "块注释未跨行保持");
  assert.ok(cls(4).includes("c-kw"), cls(4));     // repeated
  assert.ok(cls(4).includes("c-type"), cls(4));   // Address
  assert.ok(cls(5).includes("c-kw"), cls(5));     // map
  assert.ok(cls(5).includes("c-type"), cls(5));   // string / int32
});

// ---------- tokenize: config formats ----------
/** 把一行拼回纯文本（token 覆盖整行，可用于校验不丢字符）。 */
const flat = (line) => line.segs.map((s) => s.text).join("");

test("tokenize json: keys, values, comments, escapes", () => {
  const t = tokenizeLines('{\n  "name": "app", // trailing\n  "n": 42,\n  "ok": true\n}', "json");
  assert.equal(flat(t[1]), '  "name": "app", // trailing');
  // 键是 c-key，值是 c-string；数字与字面量照常
  assert.equal(t[1].segs.find((s) => s.text === '"name"').cls, "c-key");
  assert.equal(t[1].segs.find((s) => s.text === '"app"').cls, "c-string");
  assert.ok(t[1].segs.some((s) => s.cls === "c-comment"));
  assert.equal(t[2].segs.find((s) => s.text === '"n"').cls, "c-key");
  assert.ok(t[2].segs.some((s) => s.cls === "c-num"));
  assert.equal(t[3].segs.find((s) => s.text === "true").cls, "c-kw");
});

test("tokenize yaml: keys need a following space, comments, block scalars", () => {
  const t = tokenizeLines("# c\nname: app\nurl: http://x:8080/y\n- id: 1\nliteral: |\n  text", "yaml");
  assert.ok(t[0].segs.every((s) => s.cls === "c-comment"));
  assert.equal(t[1].segs.find((s) => s.text === "name").cls, "c-key");
  // `url` 是键，但值里 `http:` / `x:` 的冒号后不接空白 → 不当作键
  const urlKeys = t[2].segs.filter((s) => s.cls === "c-key").map((s) => s.text);
  assert.deepEqual(urlKeys, ["url"], JSON.stringify(t[2].segs));
  // 列表项里的键照样识别
  assert.equal(t[3].segs.find((s) => s.text === "id").cls, "c-key");
  assert.equal(t[4].segs.find((s) => s.text === "literal").cls, "c-key");
});

test("tokenize toml: table headers and keys", () => {
  const t = tokenizeLines("[server]\nport = 8080\nname = \"x\"\n[[bin]]", "toml");
  assert.ok(t[1].segs.some((s) => s.text === "port" && s.cls === "c-key"));
  assert.ok(t[2].segs.some((s) => s.text === "name" && s.cls === "c-key"));
  // 分隔符前的空白不属于键（`port = 8080` 只给 `port` 上色）
  assert.equal(t[1].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join(""), "port");
  assert.equal(t[2].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join(""), "name");
  // 段头与 [table] 的标量字符串区分开（TOML 里 [a] 是表名）
  assert.ok(t[0].segs.some((s) => s.text === "server" && s.cls === "c-section"));
});

test("tokenize config: comment markers only start comments where the format allows", () => {
  // YAML：`#` 必须位于行首或空白之后，URL 片段里的 # 是值
  const yamlUrl = tokenizeLines("url: http://example.com/a#fragment", "yaml");
  assert.ok(!yamlUrl[0].segs.some((s) => s.cls === "c-comment"), JSON.stringify(yamlUrl[0].segs));
  // `#` 与 `fragment` 会被分成两段，故按拼接后的整行文本断言
  assert.ok(yamlUrl[0].segs.map((s) => s.text).join("").includes("#fragment"));
  // 空白之后的 # 仍是注释
  const yamlCmt = tokenizeLines("name: app # trailing", "yaml");
  assert.equal(yamlCmt[0].segs.filter((s) => s.cls === "c-comment").map((s) => s.text).join(""), "# trailing");
  // ini：值里的 `;` 不是注释，行首 / 空白后的才是
  const iniMid = tokenizeLines("a=http://x/y;z", "ini");
  assert.ok(!iniMid[0].segs.some((s) => s.cls === "c-comment"), JSON.stringify(iniMid[0].segs));
  const iniCmt = tokenizeLines("a = 1 ; c", "ini");
  assert.equal(iniCmt[0].segs.filter((s) => s.cls === "c-comment").map((s) => s.text).join(""), "; c");
  // dotenv：`#` 需在行首 / 空白后
  const envMid = tokenizeLines("A=x#y", "dotenv");
  assert.ok(!envMid[0].segs.some((s) => s.cls === "c-comment"));
  // properties：`#` / `!` 只在行首起注释，故值里的 ! 是数据
  const propsMid = tokenizeLines("a=hello!world", "properties");
  assert.ok(!propsMid[0].segs.some((s) => s.cls === "c-comment"), JSON.stringify(propsMid[0].segs));
  const propsHead = tokenizeLines("   ! indented comment", "properties");
  assert.ok(propsHead[0].segs.every((s) => s.cls === "c-comment" || s.text.trim().length === 0));
  // toml：值里的 # 是数据，空白后的 # 才是注释
  const tomlMid = tokenizeLines('a = "x#y"', "toml");
  assert.ok(!tomlMid[0].segs.some((s) => s.cls === "c-comment"));
  const tomlCmt = tokenizeLines("a = 1 # c", "toml");
  assert.equal(tomlCmt[0].segs.filter((s) => s.cls === "c-comment").map((s) => s.text).join(""), "# c");
});

test("tokenize xml: an attribute value may span lines", () => {
  const t = tokenizeLines('<root attr="a\n  b">\n  <child/>\n</root>', "xml");
  // 续行整行（去掉缩进后）都属于属性值字符串
  assert.ok(t[1].segs.some((s) => s.cls === "c-string" && s.text.includes("b")));
  assert.ok(!t[1].segs.some((s) => s.cls === "c-attr"), JSON.stringify(t[1].segs));
  assert.ok(t[1].segs.some((s) => s.text === ">"), "the tag closes on the continuation line");
  // 后续元素不受跨行属性污染
  assert.equal(t[2].segs.find((s) => s.text === "child").cls, "c-tag");
  assert.ok(!t[2].segs.some((s) => s.cls === "c-string"));
  // 注释里的孤立引号不应开启字符串状态
  const c = tokenizeLines('<root>\n<!-- a="b\n-->\n<child/>\n</root>', "xml");
  assert.ok(c[3].segs.some((s) => s.text === "child" && s.cls === "c-tag"), JSON.stringify(c[3].segs));
});

test("tokenize ini/properties/dotenv: comment markers differ per format", () => {
  // ini：; 与 # 都是注释
  const ini = tokenizeLines("; c\n[sec]\nkey=value\n# c2", "ini");
  assert.ok(ini[0].segs.every((s) => s.cls === "c-comment"));
  assert.ok(ini[3].segs.every((s) => s.cls === "c-comment"));
  assert.equal(ini[2].segs.find((s) => s.text === "key").cls, "c-key");
  // properties：! 也是注释
  const props = tokenizeLines("! c\na=1", "properties");
  assert.ok(props[0].segs.every((s) => s.cls === "c-comment"));
  // dotenv：; 只是普通字符，不能整行当注释
  const env = tokenizeLines("A=a;b", "dotenv");
  assert.ok(!env[0].segs.some((s) => s.cls === "c-comment"));
  assert.equal(env[0].segs.find((s) => s.text === "A").cls, "c-key");
});

test("tokenize xml: elements, attributes, comments and CDATA", () => {
  const t = tokenizeLines('<?xml version="1.0"?>\n<root id="1">\n  <child name="x">text</child>\n  <!-- <fake a="1"/> -->\n  <![CDATA[ <not-a-tag/> ]]>\n</root>', "xml");
  assert.equal(t[1].segs.find((s) => s.text === "root").cls, "c-tag");
  assert.equal(t[1].segs.find((s) => s.text === "id").cls, "c-attr");
  assert.equal(t[1].segs.find((s) => s.text === '"1"').cls, "c-string");
  assert.equal(t[2].segs.find((s) => s.text === "child").cls, "c-tag");
  // 注释里的假标签不参与元素名高亮（行首缩进是普通空白，故只看非空白段）
  assert.ok(t[3].segs.filter((s) => s.text.trim().length > 0).every((s) => s.cls === "c-comment"));
  // CDATA 整段是字符串（复用跨行长字符串状态机），内部的 "<not-a-tag/>" 不上色
  const cdata = t[4].segs.filter((s) => s.cls === "c-string").map((s) => s.text).join("");
  assert.ok(cdata.includes("<not-a-tag/>"), JSON.stringify(t[4].segs));
  assert.ok(!t[4].segs.some((s) => s.cls === "c-tag" || s.cls === "c-attr"));
});

test("tokenize config: no characters are lost", () => {
  const samples = {
    json: '{\n  "a": [1, 2], // x\n  "b": "s"\n}',
    yaml: "# c\nname: app\nlist:\n  - id: 1\n",
    toml: "# c\n[a]\nk = 1\n",
    ini: "; c\n[s]\nk=v\n",
    properties: "! c\na=1\n",
    dotenv: "# c\nA=1\n",
    xml: '<?xml version="1.0"?>\n<r a="1">t</r>\n'
  };
  for (const [lang, text] of Object.entries(samples)) {
    const t = tokenizeLines(text, lang);
    assert.deepEqual(t.map(flat), text.split("\n"), lang + " lost characters");
  }
});

// ---------- outline ----------
const JS_SAMPLE = `
import { x } from "./dep";

// 模块级常量
export const VERSION = "1.0";

export function helper(a, b) {
  return a + b;
}

const compute = (x) => x * 2;

export class Foo extends Base {
  private count = 0;

  constructor(name) {
    this.name = name;
  }

  public bar() {
    return this.count;
  }

  async load() {}
}

interface Shape {
  area(): number;
}
`;

test("outline JS/TS: class, methods, functions, variables", () => {
  const s = outlineOf(JS_SAMPLE, "typescript");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Foo"), JSON.stringify(names));
  assert.ok(names.includes("constructor:constructor"));
  assert.ok(names.includes("method:bar"));
  assert.ok(names.includes("method:load"));
  assert.ok(names.includes("function:helper"));
  assert.ok(names.includes("function:compute"));
  assert.ok(names.includes("interface:Shape"));
  assert.ok(names.includes("variable:VERSION"));
  // 方法归属容器
  const bar = s.find((x) => x.name === "bar");
  assert.equal(bar.container, "Foo");
});

test("outline python: class / method / function / variable", () => {
  const code = `
import os
CONFIG = "x"

def top(a):
    return a

class Service:
    def __init__(self):
        self.x = 1

    async def run(self):
        pass

class Other:
    pass
`;
  const s = outlineOf(code, "python");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Service"));
  assert.ok(names.includes("class:Other"));
  assert.ok(names.includes("method:__init__"));
  assert.ok(names.includes("method:run"));
  assert.ok(names.includes("function:top"));
  assert.ok(names.includes("variable:CONFIG"));
  const run = s.find((x) => x.name === "run");
  assert.equal(run.container, "Service");
});

test("outline java: class, method, field", () => {
  const code = `
package demo;

public class App {
    private int counter = 0;

    public static void main(String[] args) {
        System.out.println("hi");
    }

    public int add(int a, int b) {
        return a + b;
    }
}
`;
  const s = outlineOf(code, "java");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:App"));
  assert.ok(names.includes("method:main"));
  assert.ok(names.includes("method:add"));
  assert.ok(names.includes("field:counter"));
  // 不把 println 当方法
  assert.ok(!names.includes("method:println"), JSON.stringify(names));
});

test("outline csharp: class, method, property-ish field", () => {
  const code = `
using System;

namespace Demo;

public class Calculator
{
    private int _base = 1;

    public int Add(int a, int b) => a + b + _base;

    public void Reset()
    {
        _base = 0;
    }
}
`;
  const s = outlineOf(code, "csharp");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Calculator"));
  assert.ok(names.includes("method:Reset"));
  assert.ok(names.includes("field:_base"));
});

test("outline c: functions and macros", () => {
  const code = `
#include <stdio.h>
#define MAX 100

int add(int a, int b) {
    return a + b;
}

static void helper(void) {
    printf("x");
}
`;
  const s = outlineOf(code, "c");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("constant:MAX"));
  assert.ok(names.includes("function:add"));
  assert.ok(names.includes("function:helper"));
});

test("outline cpp: class + methods", () => {
  const code = `
class Widget {
public:
    Widget();
    void draw() {}
    int size = 0;
};
`;
  const s = outlineOf(code, "cpp");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Widget"));
  assert.ok(names.includes("method:draw"));
});

test("outline go: struct, interface, func, var", () => {
  const code = `
package main

var Version = "1.0"

type Server struct {
    port int
}

type Handler interface {
    Serve() error
}

func NewServer(port int) *Server {
    return &Server{port: port}
}

func (s *Server) Start() error {
    return nil
}
`;
  const s = outlineOf(code, "go");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("struct:Server"));
  assert.ok(names.includes("interface:Handler"));
  assert.ok(names.includes("function:NewServer"));
  assert.ok(names.includes("method:Start"));
  assert.ok(names.includes("variable:Version"));
  const start = s.find((x) => x.name === "Start");
  assert.equal(start.container, "Server");
});

test("outline rust: struct, impl, fn, const", () => {
  const code = `
const LIMIT: u32 = 100;

struct Point {
    x: f64,
    y: f64,
}

trait Area {
    fn area(&self) -> f64;
}

impl Point {
    fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }
}
`;
  const s = outlineOf(code, "rust");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("constant:LIMIT"));
  assert.ok(names.includes("struct:Point"));
  assert.ok(names.includes("interface:Area"));
  assert.ok(names.includes("impl:Point"));
  assert.ok(names.includes("method:new"));
});

test("outline php: class, function, const", () => {
  const code = `
<?php
const GREETING = "hi";

function helper(int $n): int {
    return $n;
}

class User {
    public $name;
    const ROLE = "admin";

    public function greet(): string {
        return GREETING;
    }
}
`;
  const s = outlineOf(code, "php");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:User"));
  assert.ok(names.includes("function:helper"));
  assert.ok(names.includes("constant:ROLE"));
  assert.ok(names.includes("method:greet"));
});

test("outline ruby: class, def", () => {
  const code = `
module Demo
  class Greeter
    attr_reader :name

    def initialize(name)
      @name = name
    end

    def self.create(name)
      new(name)
    end
  end
end
`;
  const s = outlineOf(code, "ruby");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Demo"));
  assert.ok(names.includes("class:Greeter"));
  assert.ok(names.includes("method:initialize"));
  assert.ok(names.includes("method:create"));
});

test("outline swift: class, func, var", () => {
  const code = `
import Foundation

let global = 1

class ViewModel: NSObject {
    private var count = 0

    func increment() {
        count += 1
    }
}

protocol Renderable {
    func render()
}
`;
  const s = outlineOf(code, "swift");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:ViewModel"));
  assert.ok(names.includes("interface:Renderable"));
  assert.ok(names.includes("method:increment"));
  assert.ok(names.includes("variable:global"));
});

test("outline kotlin: class, fun, val", () => {
  const code = `
package demo

const val APP = "demo"

fun main() {
    println("hi")
}

class Repository {
    private val cache = mutableMapOf<String, Any>()

    fun load(id: String): Any? {
        return cache[id]
    }
}
`;
  const s = outlineOf(code, "kotlin");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:Repository"));
  assert.ok(names.includes("function:main"));
  assert.ok(names.includes("method:load"));
  assert.ok(names.includes("variable:APP"));
});

test("outline lua: function and local", () => {
  const code = `
local M = {}

local function private(x)
    return x
end

function M.public(x)
    return private(x)
end

local count = 0
`;
  const s = outlineOf(code, "lua");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("function:private"));
  assert.ok(names.includes("function:public"));
  assert.ok(names.includes("variable:count"));
});

test("outline shell: functions and vars", () => {
  const code = `
#!/usr/bin/env bash
NAME="world"

greet() {
    echo "hello $NAME"
}

function main {
    greet
}
`;
  const s = outlineOf(code, "shell");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("function:greet"));
  assert.ok(names.includes("function:main"));
  assert.ok(names.includes("variable:NAME"));
});

test("outline vue: script block with line offset", () => {
  const code = `<template>
  <div>{{ msg }}</div>
</template>

<script lang="ts">
export default {
  data() {
    return { msg: "hi" };
  }
};
function makeThing() {}
</script>
`;
  const s = outlineOf(code, "vue");
  // 行号必须落在整个文件（不是 <script> 片段）的坐标上：`function makeThing` 在
  // 模板之后，偏移算错就会跳到别的行。
  assert.deepEqual(symList(s), ["method:data", "function:makeThing"]);
  assert.equal(s[s.length - 1].line, 11, "SFC 里的 JS 符号行号未回加 <script> 的起始偏移");
});

test("outline vue: both <script> and <script setup> are parsed", () => {
  // 一个 SFC 里同时写普通 <script> 与 <script setup> 是常规用法；只取第一个块时
  // 另一半符号会凭空消失（且 <script setup lang="ts"> 的类型也读不到）。
  const code = `<template>
  <p>{{ a }}</p>
</template>
<script>
function plainFn() {}
</script>
<script setup lang="ts">
interface Props { a: string }
const comp = defineComponent({})
</script>
<style scoped>
.p { color: red }
</style>
`;
  assert.deepEqual(
    symList(outlineOf(code, "vue")),
    ["function:plainFn", "interface:Props", "variable:comp"],
    "多 <script> 块未按文件顺序合并，或 lang=\"ts\" 块没按 TypeScript 解析"
  );
  const lines = outlineOf(code, "vue").map((x) => x.line);
  assert.deepEqual(lines, [5, 8, 9], "各块的行号偏移不对");
});

test("outline svelte: script block line offset", () => {
  const code = `<script>
  function hello(name) { return "hi " + name }
</script>
<h1>{hello("x")}</h1>
<style>
  h1 { color: teal }
</style>
`;
  const s = outlineOf(code, "svelte");
  assert.deepEqual(symList(s), ["function:hello"]);
  assert.equal(s[0].line, 2);
});

test("outline sql: tables", () => {
  const code = `-- schema
CREATE TABLE users (
  id INT PRIMARY KEY
);
CREATE VIEW active_users AS SELECT * FROM users;
`;
  const s = outlineOf(code, "sql");
  const names = s.map((x) => x.kind + ":" + x.name);
  assert.ok(names.includes("class:users"));
  assert.ok(names.includes("interface:active_users"));
});

test("outline protobuf: message, enum, field, oneof, service, rpc", () => {
  const code = `
syntax = "proto3";

package example.user;

import "google/protobuf/timestamp.proto";

option java_package = "com.example";

message User {
  string id = 1;
  repeated Address addresses = 2;
  map<string, int32> login_counts = 3;
  oneof contact {
    string email = 4;
    string phone = 5;
  }
  message Address {
    string city = 1;
  }
  enum Status {
    ACTIVE = 0;
    BANNED = 1;
  }
}

service UserService {
  rpc Get (UserRequest) returns (User);
  rpc Watch(stream WatchRequest) returns (stream WatchReply) {}
}

extend google.protobuf.FieldOptions {
  string audit = 50000;
}
`;
  const s = outlineOf(code, "protobuf");
  assert.deepEqual(s.map((x) => x.kind + ":" + x.name), [
    "class:User", "field:id", "field:addresses", "field:login_counts",
    "section:contact", "field:email", "field:phone",
    "class:Address", "field:city",
    "enum:Status", "constant:ACTIVE", "constant:BANNED",
    "class:UserService", "method:Get", "method:Watch",
    "impl:google.protobuf.FieldOptions", "field:audit"
  ], JSON.stringify(s));
  const at = (n) => s.find((x) => x.name === n);
  assert.equal(at("id").container, "User");
  assert.equal(at("email").container, "contact");
  assert.equal(at("city").container, "Address");
  assert.equal(at("ACTIVE").container, "Status");
  assert.equal(at("Get").container, "UserService");
  assert.equal(at("audit").container, "google.protobuf.FieldOptions");
});

test("outline protobuf: metadata and commented-out code create no symbols", () => {
  const code = `
import "x.proto";

message M {
  option deprecated = true;
  reserved 2, 15, 90 to 100;
  reserved "OLD_NAME", "OTHER";
  extensions 100 to max;
  // int32 ghost = 1;
  /* int32 ghost2 = 2; */
  string note = 2 [default = "message Fake { int32 hidden = 3; }"];
  int32 real = 3;
}
`;
  const s = outlineOf(code, "protobuf");
  assert.deepEqual(s.map((x) => x.kind + ":" + x.name),
    ["class:M", "field:note", "field:real"], JSON.stringify(s));
  // 字符串里的 `{` 不能污染大括号深度，否则 note 之后的字段就找不到所属 message 了
  assert.equal(s[s.length - 1].container, "M");
});

test("outline protobuf: proto2 required / group / default / negative enum value", () => {
  const code = `
syntax = "proto2";

import "google/protobuf/descriptor.proto";

option java_package = "com.x";

message Envelope {
  option (table) = "t_envelope";
  option (ttl) = 3600;
  required string id = 1;
  optional int32 retry = 2 [default = 3];
  optional string label = 3 [default = "message Fake { required int32 x = 1; }"];
  optional google.protobuf.Timestamp updated_at = 4;
  reserved 6, 8 to 10;
  extensions 100 to max;
  optional group Legacy = 5 {
    required string name = 1;
  }
  enum Sentiment {
    NEGATIVE = -1;
    POSITIVE = 1 [deprecated = true];
  }
}
`;
  const s = outlineOf(code, "protobuf");
  assert.deepEqual(s.map((x) => x.kind + ":" + x.name), [
    "class:Envelope", "field:id", "field:retry", "field:label", "field:updated_at",
    "field:Legacy", "field:name", "enum:Sentiment",
    "constant:NEGATIVE", "constant:POSITIVE"
  ], JSON.stringify(s));
  const at = (n) => s.find((x) => x.name === n);
  assert.equal(at("updated_at").container, "Envelope");   // 类型名带点号不影响取字段名
  assert.equal(at("NEGATIVE").container, "Sentiment");    // proto2 的枚举值可为负
  assert.equal(at("Legacy").container, "Envelope");       // group 自身是 Envelope 的字段
  assert.equal(at("name").container, "Legacy");           // 但组体是独立作用域，组内字段挂组名
});

test("outline protobuf: fully-qualified leading-dot names", () => {
  const code = `
syntax = "proto3";

extend .google.protobuf.FieldOptions {
  string audit = 1;
}

message M {
  optional .foo.Bar leading = 1;
  .foo.Baz direct = 2;
}
`;
  const s = outlineOf(code, "protobuf");
  assert.deepEqual(s.map((x) => x.kind + ":" + x.name), [
    "impl:google.protobuf.FieldOptions", "field:audit",
    "class:M", "field:leading", "field:direct"
  ], JSON.stringify(s));
  const at = (n) => s.find((x) => x.name === n);
  assert.equal(at("audit").container, "google.protobuf.FieldOptions");
  assert.equal(at("leading").container, "M");
});

test("outline: symbol count is capped at OUTLINE_MAX_SYMBOLS", () => {
  // 上限本身是静默的，客户端靠它给提示（symbols.capped），所以常量必须导出且真的生效
  const code = Array.from({ length: OUTLINE_MAX_SYMBOLS + 40 }, (_, i) => "function f" + i + "() {}").join("\n");
  const s = outlineOf(code, "javascript");
  assert.equal(s.length, OUTLINE_MAX_SYMBOLS);
  assert.equal(s.capped, true);
  assert.equal(s[0].name, "f0", "应保留文件里靠前的符号");
  const exact = outlineOf(
    Array.from({ length: OUTLINE_MAX_SYMBOLS }, (_, i) => "function exact" + i + "() {}").join("\n"),
    "javascript"
  );
  assert.equal(exact.length, OUTLINE_MAX_SYMBOLS);
  assert.equal(exact.capped, undefined, "恰好达到上限不应提示还有更多符号");
  const multi = outlineOf(
    "<script>\n" + Array.from({ length: OUTLINE_MAX_SYMBOLS + 1 }, (_, i) => "function a" + i + "() {}").join("\n") +
      "\n</script>\n<script setup>\n" + Array.from({ length: OUTLINE_MAX_SYMBOLS + 1 }, (_, i) => "function b" + i + "() {}").join("\n") +
      "\n</script>",
    "vue"
  );
  assert.equal(multi.length, OUTLINE_MAX_SYMBOLS);
  assert.equal(multi.capped, true, "多 script 块合并后仍应保留截断标记");
});

test("outline ignores symbols inside comments/strings", () => {
  const code = `
// class FakeClass { }
const s = "function notReal() { }";
class RealClass { }
`;
  const s = outlineOf(code, "javascript");
  const names = s.map((x) => x.name);
  assert.ok(names.includes("RealClass"));
  assert.ok(!names.includes("FakeClass"));
  assert.ok(!names.includes("notReal"));
});

// ---------- outline: config formats ----------
/** 断言用的辅助：把符号压成 "kind:name" 列表。 */
const symList = (syms) => syms.map((x) => x.kind + ":" + x.name);
/** 找某个名字的符号（配置大纲里同名会出现在不同段，故取第一个匹配）。 */
const symNamed = (syms, name) => syms.find((x) => x.name === name);

test("outline json: nested objects, arrays, comments and escapes", () => {
  const code = `{
  // trailing-style comment with "fake": 1
  "name": "app",
  "version": "1.0",
  "server": {
    "port": 8080,
    "host": "localhost"
  },
  "tags": ["a", "b"],
  "flag": true
}`;
  const s = outlineOf(code, "json");
  const names = symList(s);
  assert.ok(names.includes("key:name"), JSON.stringify(names));
  assert.ok(names.includes("key:version"));
  assert.ok(names.includes("section:server"));
  assert.ok(names.includes("key:port"));
  assert.ok(names.includes("section:tags"));
  // 注释里的假键不算
  assert.ok(!names.includes("key:fake"), JSON.stringify(names));
  // 嵌套归属与行号
  const port = symNamed(s, "port");
  assert.equal(port.container, "server");
  assert.equal(port.line, 6);
  const tags = symNamed(s, "tags");
  assert.equal(tags.kind, "section");   // 数组值算段
});

test("outline json: block comments and one-line nesting keep line numbers", () => {
  const code = `{
  /* block
     "nope": 1 */
  "a": { "b": 1 }
}`;
  const s = outlineOf(code, "json");
  const names = symList(s);
  assert.ok(!names.includes("key:nope"), JSON.stringify(names));
  // `"a"` 的值是对象 → section；`"b"` 的值是标量 → key
  assert.ok(names.includes("section:a"), JSON.stringify(names));
  assert.ok(names.includes("key:b"));
  const b = symNamed(s, "b");
  assert.equal(b.line, 4);
  assert.equal(b.container, "a");
});

test("outline json: escaped key names are decoded", () => {
  // 符号列表是给人读、也用来搜索定位的：把 `"a\nb"` 原样列成带反斜杠的字面量，
  // 用户拿它去文件里找是找不到的。`\n` 解成换行、`\u0064` 解成 d，
  // 未知转义（`\x`）丢掉反斜杠保留其后字符 —— 展示优先于严格校验。
  const src = '{\n  "a' + BS + 'nb": 1,\n  "c' + BS + 'u0064e": 2,\n  "x' + BS + 'y": 3\n}';
  const s = outlineOf(src, "json");
  assert.deepEqual(s.map((x) => x.name), ["a\nb", "cde", "xy"], JSON.stringify(s));
  assert.deepEqual(s.map((x) => x.line), [2, 3, 4], "解码后行号串了行");
});

test("outline yaml: nested maps, lists, block scalars and urls", () => {
  const code = `# top
name: my-app
server:
  host: localhost
  port: 8080
  tls:
    enabled: true
list:
  - id: 1
    label: first
url: http://example.com:8080/x
desc: |
  block text
`;
  const s = outlineOf(code, "yaml");
  const names = symList(s);
  assert.ok(names.includes("key:name"), JSON.stringify(names));
  assert.ok(names.includes("section:server"));
  assert.ok(names.includes("key:port"));
  assert.ok(names.includes("section:tls"));
  assert.ok(names.includes("key:enabled"));
  assert.ok(names.includes("section:list"));
  assert.ok(names.includes("key:id"));
  assert.ok(names.includes("key:label"));
  assert.ok(names.includes("key:url"));
  assert.equal(symNamed(s, "port").container, "server");
  assert.equal(symNamed(s, "enabled").container, "tls");
  assert.equal(symNamed(s, "label").container, "list");
  // `desc: |` 的值是块标量，仍是键
  assert.equal(symNamed(s, "desc").kind, "key");
});

test("outline yaml: block scalar content is not parsed as keys", () => {
  const code = `description: |
  fake: value
  another: 1
real: 1
folded: >
  also: fake
last: 2
`;
  const s = outlineOf(code, "yaml");
  const names = symList(s);
  // 块标量正文里的「键」不得出现在大纲里
  assert.ok(!names.includes("key:fake"), JSON.stringify(names));
  assert.ok(!names.includes("key:another"), JSON.stringify(names));
  assert.ok(!names.includes("key:also"), JSON.stringify(names));
  assert.deepEqual(
    s.map((x) => x.name),
    ["description", "real", "folded", "last"],
    JSON.stringify(names),
  );
  assert.equal(symNamed(s, "real").line, 4);
});

test("outline yaml: block scalar ends when indentation returns", () => {
  const code = `outer:
  a: |
    fake: 1
  b: 2
`;
  const s = outlineOf(code, "yaml");
  const names = symList(s);
  assert.ok(!names.includes("key:fake"), JSON.stringify(names));
  assert.ok(names.includes("key:b"), JSON.stringify(names));
  // 块标量之后回到同级缩进的 b 仍归属 outer
  assert.equal(symNamed(s, "b").container, "outer");
});

test("outline yaml: sequence block scalars do not create keys", () => {
  const code = `items:
  - |
      fake: value
  - id: 1
`;
  const s = outlineOf(code, "yaml");
  const names = symList(s);
  assert.ok(!names.includes("key:fake"), JSON.stringify(names));
  assert.ok(names.includes("key:id"), JSON.stringify(names));
});

test("outline yaml: quoted colons stay inside the key", () => {
  const s = outlineOf('"foo: bar": 1\nnormal: 2\n', "yaml");
  assert.deepEqual(s.map((x) => x.name), ["foo: bar", "normal"]);
});

test("outline toml: multiline string content is not parsed as keys", () => {
  const code = `description = """
fake = value
[T]
"""
literal = '''
also = fake
'''
real = 1
`;
  const s = outlineOf(code, "toml");
  const names = symList(s);
  assert.ok(!names.includes("key:fake"), JSON.stringify(names));
  assert.ok(!names.includes("key:also"), JSON.stringify(names));
  // 多行字符串里的 [T] 也不是段头
  assert.ok(!names.includes("section:T"), JSON.stringify(names));
  assert.deepEqual(s.map((x) => x.name), ["description", "literal", "real"], JSON.stringify(names));
});

test("outline toml: quoted keys and multiline arrays do not create false keys", () => {
  const quoted = outlineOf('"foo=bar" = 1\nreal = 2\n', "toml");
  assert.deepEqual(quoted.map((x) => x.name), ["foo=bar", "real"]);
  const array = outlineOf('arr = [\n  "fake = value",\n]\nreal = 1\n', "toml");
  assert.deepEqual(array.map((x) => x.name), ["arr", "real"]);
  const tripleArray = outlineOf('arr = [\n  """text ] = not-a-key\n  """,\n]\nreal = 1\n', "toml");
  assert.deepEqual(tripleArray.map((x) => x.name), ["arr", "real"]);
});

test("tokenize toml: comments may start directly after an unquoted value", () => {
  const segs = tokenizeLines("a = 1#comment", "toml")[0].segs;
  assert.equal(segs.at(-1).cls, "c-comment");
});

test("outline xml: cross-line attribute values do not corrupt the tree", () => {
  const code = `<root attr="a
  b">
  <child/>
</root>`;
  const s = outlineOf(code, "xml");
  const names = symList(s);
  // 续行里的 `b` 不是属性名，后续 <child/> 仍是元素（且不是属性）
  assert.ok(!names.includes("attribute:b"), JSON.stringify(names));
  assert.ok(names.includes("element:child"), JSON.stringify(names));
  assert.ok(names.includes("element:root"));
  assert.ok(names.includes("attribute:attr"));
  assert.equal(symNamed(s, "child").container, "root");
});

test("outline xml: quotes in text do not hide following tags", () => {
  const s = outlineOf('<root>He said "hello\n<child/></root>', "xml");
  assert.ok(symList(s).includes("element:child"), JSON.stringify(symList(s)));
});

test("tokenize yaml/json5: quoted colons and inline bare keys are scoped correctly", () => {
  const yaml = tokenizeLines('"foo: bar": 1', "yaml")[0].segs;
  assert.ok(yaml.some((x) => x.text === '"foo: bar"' && x.cls === "c-key"), JSON.stringify(yaml));
  const json5 = tokenizeLines("{ foo: 1 }", "json")[0].segs;
  assert.ok(json5.some((x) => x.text === "foo" && x.cls === "c-key"), JSON.stringify(json5));
  assert.ok(!json5.some((x) => x.text.includes("{") && x.cls === "c-key"), JSON.stringify(json5));
});

test("tokenize json5: every bare key on a line is scoped, structure is not", () => {
  const keys = (src) => tokenizeLines(src, "json")[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text);
  // 一行多个裸键要全部上色（不能只标第一个）
  assert.deepEqual(keys("{a: 1, b: 2}"), ["a", "b"]);
  assert.deepEqual(keys("{ a: 1, b: 2 }"), ["a", "b"]);
  assert.deepEqual(keys("{a:1,b:2}"), ["a", "b"]);
  // 键区间不得吞掉 `{` / `=` 等结构符号
  assert.deepEqual(keys("x = {a: 1}"), ["a"]);
  assert.deepEqual(keys("x = 1"), []);
  // 引号键路径不受影响
  assert.deepEqual(keys('{"a": 1, "b": 2}'), ['"a"', '"b"']);
  assert.deepEqual(keys('{"a": { "b": 1 }}'), ['"a"', '"b"']);
});

test("outline config: trailing comment markers inside values are kept", () => {
  // YAML 的 `#` 只在空白后起注释，故 URL 片段不影响键识别
  const y = outlineOf("url: http://x/a#frag\nn: 1\n", "yaml");
  assert.deepEqual(y.map((x) => x.name), ["url", "n"], JSON.stringify(symList(y)));
  // properties 的值里含 `!` 时，键与值都完好
  const p = outlineOf("a=hello!world\nb=2\n", "properties");
  assert.deepEqual(p.map((x) => x.name), ["a", "b"], JSON.stringify(symList(p)));
});

test("outline toml: tables are absolute paths, not nested under the previous one", () => {
  const code = `# manifest
[package]
name = "app"
version = "0.1"

[dependencies]
serde = "1.0"

[[bin]]
name = "main"

[package.metadata.docs]
foo = 1
`;
  const s = outlineOf(code, "toml");
  const names = symList(s);
  assert.ok(names.includes("section:package"), JSON.stringify(names));
  assert.ok(names.includes("key:name"));
  assert.ok(names.includes("key:serde"));
  assert.ok(names.includes("section:bin"));
  assert.equal(symNamed(s, "serde").container, "dependencies");
  // `[[bin]]` 不能挂到上一个表 dependencies 下
  assert.equal(symNamed(s, "bin").container, undefined);
  // 点是前缀关系时才算父表
  assert.equal(symNamed(s, "package.metadata.docs").container, "package");
});

test("outline xml: element tree, attributes, comments and CDATA", () => {
  const code = `<?xml version="1.0"?>
<project name="demo">
  <!-- <fake attr="1"/> -->
  <dependencies>
    <dependency groupId="g" artifactId="a">
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build/>
</project>`;
  const s = outlineOf(code, "xml");
  const names = symList(s);
  assert.ok(names.includes("element:project"), JSON.stringify(names));
  assert.ok(names.includes("attribute:name"));
  assert.ok(names.includes("element:dependencies"));
  assert.ok(names.includes("element:dependency"));
  assert.ok(names.includes("attribute:groupId"));
  assert.ok(names.includes("element:scope"));
  // 注释里的假标签不出现
  assert.ok(!names.includes("element:fake"), JSON.stringify(names));
  assert.ok(!names.includes("attribute:attr"));
  // 层级与属性归属
  assert.equal(symNamed(s, "dependency").container, "dependencies");
  assert.equal(symNamed(s, "scope").container, "dependency");
  assert.equal(symNamed(s, "groupId").container, "dependency");
  assert.equal(symNamed(s, "build").container, "project");
  // 自闭合元素不成为后续元素的父级
  assert.equal(symNamed(s, "scope").container, "dependency");
});

test("outline xml: CDATA content is not parsed as markup", () => {
  const code = `<root>
  <![CDATA[
    <fake attr="1"/>
  ]]>
  <real/>
</root>`;
  const s = outlineOf(code, "xml");
  const names = symList(s);
  assert.ok(names.includes("element:root"), JSON.stringify(names));
  assert.ok(names.includes("element:real"));
  assert.ok(!names.includes("element:fake"), JSON.stringify(names));
  assert.equal(symNamed(s, "real").container, "root");
});

test("outline ini: sections, keys and bare keys", () => {
  const code = `; comment
[core]
repositoryformatversion = 0
bare = false

[remote "origin"]
url = git@x:y.git
`;
  const s = outlineOf(code, "ini");
  const names = symList(s);
  assert.ok(names.includes("section:core"), JSON.stringify(names));
  assert.ok(names.includes("key:repositoryformatversion"));
  assert.ok(names.includes("section:remote \"origin\""));
  assert.equal(symNamed(s, "bare").container, "core");
  assert.equal(symNamed(s, "url").container, "remote \"origin\"");
});

test("outline properties: dot keys, ! comments, line continuations", () => {
  const code = `# comment
! also a comment
server.port=8080
spring.datasource.url: jdbc:x
long.value=a\\
  b
`;
  const s = outlineOf(code, "properties");
  const names = symList(s);
  assert.ok(names.includes("key:server.port"), JSON.stringify(names));
  assert.ok(names.includes("key:spring.datasource.url"));
  assert.ok(names.includes("key:long.value"));
  // 续行不产生假键
  assert.ok(!names.some((n) => n.includes("b")), JSON.stringify(names));
});

test("outline dotenv: export prefix and quoted values", () => {
  const code = `# comment
NODE_ENV=production
API_URL="https://x/y"
EMPTY=
DB=a;b
export EXTRA=1
`;
  const s = outlineOf(code, "dotenv");
  const names = symList(s);
  assert.ok(names.includes("key:NODE_ENV"), JSON.stringify(names));
  assert.ok(names.includes("key:API_URL"));
  assert.ok(names.includes("key:EMPTY"));
  assert.ok(names.includes("key:DB"));
  assert.ok(names.includes("key:EXTRA"));
});

test("tokenize dotenv: the export prefix is not part of the highlighted key", () => {
  const keyHighlight = (line) =>
    tokenizeLines(line, "dotenv")[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  // `export` 只是前缀：键从其后开始（而不是把 `export EXTRA` 整段涂成键）
  assert.equal(keyHighlight("export EXTRA=1"), "EXTRA");
  assert.equal(keyHighlight("  export EXTRA=1"), "EXTRA");
  assert.equal(keyHighlight("\texport\tEXTRA=1"), "EXTRA");
  assert.equal(keyHighlight("export  DOUBLE=1"), "DOUBLE");
  // 无空格时 `exportX` / `export` 本身就是键
  assert.equal(keyHighlight("exportX=1"), "exportX");
  assert.equal(keyHighlight("export="), "export");
  // 注释行不产生键
  assert.equal(keyHighlight("#export X=1"), "");
});

test("dotenv: highlight key and outline key agree", () => {
  // 高亮与大纲必须同口径 —— 上一版的缺陷正是二者不一致
  const cases = [
    "export EXTRA=1", "  export EXTRA=1", "\texport\tEXTRA=1", "exportX=1",
    "export =1", "export=", "export  DOUBLE=1", "export", "EXTRA=1",
    'export FOO="a b"', "#export X=1", "export A=1 # c", "export A", "A=1"
  ];
  for (const line of cases) {
    const highlighted = tokenizeLines(line, "dotenv")[0].segs
      .filter((s) => s.cls === "c-key").map((s) => s.text).join("");
    const names = outlineOf(line, "dotenv").map((s) => s.name);
    if (highlighted === "") {
      assert.deepEqual(names, [], "no outline key expected for " + JSON.stringify(line));
    } else {
      assert.deepEqual(names, [highlighted], "mismatch for " + JSON.stringify(line));
    }
    // 上色不能改变行内容
    assert.equal(
      tokenizeLines(line, "dotenv")[0].segs.map((s) => s.text).join(""),
      line,
      "character loss on " + JSON.stringify(line)
    );
  }
  // 其他语言不受 dotenv 的 export 规则影响
  const keyOf = (line, lang) =>
    tokenizeLines(line, lang)[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  assert.equal(keyOf("export = 1", "python"), "");
  assert.equal(keyOf("export const a = 1", "javascript"), "");
  assert.equal(keyOf("export=1", "ini"), "export", "ini 的 `export` 不是前缀");
  assert.equal(keyOf("export = 1", "toml"), "export");
  assert.equal(keyOf("export: 1", "yaml"), "export");
});

test("outline config: malformed input does not throw", () => {
  const cases = [
    ["json", "not json at all {{{{ \"unclosed: 1"],
    ["json", ""],
    ["yaml", ":\n::: bad\n- - -"],
    ["toml", "= no key\n[]"],
    ["xml", "<a><b></c></d>"],
    ["xml", "<<"],
    ["ini", "[[[bad"],
    ["dotenv", "=== x"]
  ];
  for (const [lang, text] of cases) {
    const s = outlineOf(text, lang);
    assert.ok(Array.isArray(s), lang + " did not return an array");
  }
});

test("outline config: name length is bounded", () => {
  const long = "k".repeat(200);
  const s = outlineOf('{"' + long + '": 1}', "json");
  assert.equal(s.length, 0);
  // XML 属性名走同一条上限：超长的「名字」几乎必然是解析跑偏（引号未闭合等），
  // 曾经这一支完全绕过了长度判定，把 200 个字符当成一个属性列进大纲。
  const xml = outlineOf('<a ' + long + '="1" ok="2"/>', "xml");
  assert.deepEqual(
    xml.filter((x) => x.kind === "attribute").map((x) => x.name),
    ["ok"],
    "XML 属性名未受 CFG_NAME_MAX 约束"
  );
});

test("kindGroup classification", () => {
  assert.equal(kindGroup("class"), "class");
  assert.equal(kindGroup("interface"), "class");
  assert.equal(kindGroup("struct"), "class");
  assert.equal(kindGroup("enum"), "class");
  assert.equal(kindGroup("impl"), "class");
  assert.equal(kindGroup("method"), "method");
  assert.equal(kindGroup("function"), "method");
  assert.equal(kindGroup("constructor"), "method");
  assert.equal(kindGroup("variable"), "variable");
  assert.equal(kindGroup("field"), "variable");
  assert.equal(kindGroup("constant"), "variable");
  // 配置文件：段 / 元素归「类」，键 / 属性归「变量」
  assert.equal(kindGroup("section"), "class");
  assert.equal(kindGroup("element"), "class");
  assert.equal(kindGroup("key"), "variable");
  assert.equal(kindGroup("attribute"), "variable");
});

// ---------- search ----------
test("findMatches: basic, case, positions", () => {
  const text = "foo\nbar foo\nbaz";
  const m = findMatches(text, "foo", {});
  assert.equal(m.length, 2);
  assert.equal(m[0].line, 0);
  assert.equal(m[0].col, 0);
  assert.equal(m[1].line, 1);
  assert.equal(m[1].col, 4);
  // 大小写
  const text2 = "Foo foo FOO";
  assert.equal(findMatches(text2, "foo", {}).length, 3);
  assert.equal(findMatches(text2, "foo", { caseSensitive: true }).length, 1);
  // 空查询
  assert.equal(findMatches(text, "", {}).length, 0);
});

test("findMatches: offsets stay in original-text coordinates", () => {
  // 不区分大小写时若先对全文做 toLowerCase()，个别字符会变长（`İ` U+0130 → `i` +
  // 组合上的一点），小写串里的下标就不再等于原文下标：轻则高亮切到隔壁字符，
  // 重则它之后的普通匹配全部错位、整片判成不存在。
  const text = "İstanbul\nfoo bar FOO\n";
  const m = findMatches(text, "foo", {});
  assert.equal(m.length, 2, JSON.stringify(m));
  for (const x of m) {
    assert.equal(text.slice(x.start, x.end).toLowerCase(), "foo", "start/end 不是原文坐标");
    assert.equal(text.split("\n")[x.line].slice(x.col, x.col + 3).toLowerCase(), "foo", "line/col 不对");
  }
  assert.deepEqual(m.map((x) => x.line), [1, 1]);
  assert.equal(findMatches(text, "FOO", { caseSensitive: true }).length, 1);
});

test("findMatches: the query is a literal, not a pattern", () => {
  // 界面把用户输入原样当查询串；按正则解释会让 `.`、`+`、`(` 这类常见输入
  // 匹配到别的东西，甚至抛出语法错误。
  assert.equal(findMatches("a.b", ".", {}).length, 1);
  assert.equal(findMatches("axb", ".", {}).length, 0);
  assert.equal(findMatches("x = a+b;", "+", {}).length, 1);
  assert.equal(findMatches("f(a|b)", "(a|b)", {}).length, 1);
  assert.equal(findMatches("a\\b", BS, {}).length, 1);
});

test("findMatches: stops at MAX_MATCHES", () => {
  const text = "ab".repeat(MAX_MATCHES + 50);
  const capped = findMatches(text, "ab", {});
  assert.equal(capped.length, MAX_MATCHES);
  assert.equal(capped.capped, true);
  const exact = findMatches("ab".repeat(MAX_MATCHES), "ab", {});
  assert.equal(exact.length, MAX_MATCHES);
  assert.equal(exact.capped, undefined, "恰好达到上限不应显示还有更多匹配");
});

test("spansOfLine: match overlay", () => {
  const segs = [{ text: "const ", cls: "c-kw" }, { text: "x = ", cls: "" }, { text: "1", cls: "c-num" }];
  const spans = spansOfLine("const x = 1", segs, [{ col: 6, end: 7 }], 0);
  const match = spans.find((s) => s.match);
  assert.ok(match !== undefined);
  assert.equal(match.text, "x");
  assert.equal(match.current, true);
});

test("spansOfLine: boundaries and degenerate input", () => {
  const segs = [{ text: "ab", cls: "c-ident" }, { text: "cd", cls: "" }];
  // 匹配横跨 token 边界 → 按边界切开，每段保留自己原本的 token 类别
  assert.deepEqual(
    spansOfLine("abcd", segs, [{ col: 1, end: 3 }], 0).map((s) => [s.text, s.cls, s.match === true, s.current === true]),
    [["a", "c-ident", false, false], ["b", "c-ident", true, true], ["c", "", true, true], ["d", "", false, false]]
  );
  // 同一行多处匹配：只有 currentIndex 指的那处标 current
  const two = spansOfLine("aXbXc", [{ text: "aXbXc", cls: "" }], [{ col: 1, end: 2 }, { col: 3, end: 4 }], 1);
  assert.deepEqual(two.filter((s) => s.match).map((s) => s.text), ["X", "X"]);
  assert.equal(two.filter((s) => s.current).length, 1);
  // 纯文本兜底视图（无 token）也要能出高亮
  assert.deepEqual(spansOfLine("abc", [], [{ col: 0, end: 3 }], 0), [{ text: "abc", cls: "", match: true, current: true }]);
  // 越界的匹配区间不该抛错，也不该产出空 span
  assert.deepEqual(spansOfLine("ab", [{ text: "ab", cls: "" }], [{ col: 2, end: 3 }], -1), [{ text: "ab", cls: "" }]);
});

// ---------- selection → draft ----------
test("selectionHeader: cwd-relative path with line spans", () => {
  const cwd = "C:\\repo\\app";
  assert.equal(selectionHeader("C:\\repo\\app\\src\\a.ts", cwd, { start: 12, end: 12 }), "src/a.ts:12");
  assert.equal(selectionHeader("C:\\repo\\app\\src\\a.ts", cwd, { start: 12, end: 15 }), "src/a.ts:12-15");
  // 行号不可得（纯文本兜底视图）→ 只写路径
  assert.equal(selectionHeader("C:\\repo\\app\\src\\a.ts", cwd, undefined), "src/a.ts");
  // cwd 之外 → 原样绝对路径
  assert.equal(selectionHeader("D:\\other\\b.ts", cwd, { start: 3, end: 3 }), "D:\\other\\b.ts:3");
  // cwd 未知 → 绝对路径
  assert.equal(selectionHeader("/repo/a.ts", undefined, { start: 1, end: 2 }), "/repo/a.ts:1-2");
  // 大小写不敏感的前缀匹配（Windows 盘符）
  assert.equal(selectionHeader("c:\\repo\\app\\x.ts", "C:\\repo\\App", undefined), "x.ts");
});

test("selectionHeader: relativeTo edge cases", () => {
  // 前缀必须落在**路径分隔符**上：只比 `cwd + "/"` 之外的写法会把兄弟目录
  // 误伤成子目录（`/repo/app` 与 `/repo/application` 只差一个字符）。
  assert.equal(selectionHeader("/repo/application/x.ts", "/repo/app", undefined), "/repo/application/x.ts");
  assert.equal(selectionHeader("/repo/app2/x.ts", "/repo/app", undefined), "/repo/app2/x.ts");
  // cwd 末尾的斜杠可有可无；两种分隔符混写也认（Windows 路径进 fsRead 后可能是反斜杠）
  assert.equal(selectionHeader("/repo/app/x.ts", "/repo/app/", undefined), "x.ts");
  assert.equal(selectionHeader("C:\\repo\\app\\x.ts", "C:/repo/app", undefined), "x.ts");
  // 正好选中 cwd 本身
  assert.equal(selectionHeader("/repo/app", "/repo/app", { start: 3, end: 3 }), ".:3");
  // cwd 缺失 / 空串：原样输出绝对路径，不抛错
  assert.equal(selectionHeader("/repo/a.ts", "", { start: 1, end: 1 }), "/repo/a.ts:1");
  assert.equal(selectionHeader("/repo/a.ts", null, { start: 1, end: 1 }), "/repo/a.ts:1");
});

test("buildSelectionInsert: fenced block within the limit", () => {
  const out = buildSelectionInsert("C:\\repo\\app\\src\\a.ts", "C:\\repo\\app", { start: 4, end: 6 }, "let x = 1\nlet y = 2");
  assert.equal(out, "```src/a.ts:4-6\nlet x = 1\nlet y = 2\n```");
});

test("buildSelectionInsert: over the limit keeps only the header", () => {
  const long = "x".repeat(SELECTION_LIMIT + 1);
  assert.equal(buildSelectionInsert("/repo/a.ts", "/repo", { start: 1, end: 1 }, long), "a.ts:1");
  // 边界：正好等于上限仍然带正文
  const edge = "y".repeat(SELECTION_LIMIT);
  assert.ok(buildSelectionInsert("/repo/a.ts", "/repo", undefined, edge).includes(edge));
});

// ---------- outline properties: 空白分隔 / 转义 / 续行奇偶 ----------
test("outline properties: whitespace is a legal separator", () => {
  // Java properties 规范：`=` `:` 与**空白**都是键值分隔符
  const s = outlineOf("server.port 8080\nname John\n", "properties");
  assert.deepEqual(symList(s), ["key:server.port", "key:name"], JSON.stringify(s));
  // Tab 同样合法
  const tab = outlineOf("server.port\t8080\n", "properties");
  assert.deepEqual(symList(tab), ["key:server.port"]);
  // 既有分隔符不受影响
  assert.deepEqual(symList(outlineOf("a=1\nb:2\n", "properties")), ["key:a", "key:b"]);
  // 无值的裸键仍然成条
  assert.deepEqual(symList(outlineOf("server.port\n", "properties")), ["key:server.port"]);
  // 分隔符前的空白不属于键
  assert.deepEqual(symList(outlineOf("port = 8080\n", "properties")), ["key:port"]);
});

test("outline properties: escaped separators stay inside the key", () => {
  // `key\:part=value` 的键名是 `key:part`（而不是 `key\`）
  const colon = outlineOf("key" + BS + ":part=value\n", "properties");
  assert.deepEqual(symList(colon), ["key:key:part"], JSON.stringify(colon));
  // 转义等号同理
  const eq = outlineOf("key" + BS + "=part:value\n", "properties");
  assert.deepEqual(symList(eq), ["key:key=part"], JSON.stringify(eq));
  // 转义空格不作为分隔符
  const sp = outlineOf("key" + BS + " with=1\n", "properties");
  assert.deepEqual(symList(sp), ["key:key with"], JSON.stringify(sp));
  // `\\` 是两个字符转义出的一个反斜杠
  const slash = outlineOf("key" + BS + BS + "=v\n", "properties");
  assert.deepEqual(symList(slash), ["key:key" + BS], JSON.stringify(slash));
  // `\uXXXX` 反转义成该字符
  const uni = outlineOf("k" + BS + "u003A=1\n", "properties");
  assert.deepEqual(symList(uni), ["key:k:"], JSON.stringify(uni));
  // 中文键（properties 的转义对非 ASCII 场景）
  const cn = outlineOf("\\u4e2d\\u6587=1\n", "properties");
  assert.deepEqual(symList(cn), ["key:\u4e2d\u6587"], JSON.stringify(cn));
});

test("outline properties: escaped bare keys (no separator) are recognised", () => {
  // Java properties 允许没有分隔符的键，且键名可含转义字符：
  // `key\:part` 的键是 `key:part`（空值）。上一版用标识符正则判断裸键，漏掉这类合法键。
  assert.deepEqual(symList(outlineOf("key" + BS + ":part\n", "properties")), ["key:key:part"]);
  assert.deepEqual(symList(outlineOf("key" + BS + "=part\n", "properties")), ["key:key=part"]);
  // 转义空格属于键名
  assert.deepEqual(symList(outlineOf("key" + BS + " sp\n", "properties")), ["key:key sp"]);
  // `\uXXXX` 反转义
  assert.deepEqual(symList(outlineOf("a" + BS + "u003Ab\n", "properties")), ["key:a:b"]);
  // 普通裸键与点分键仍正常
  assert.deepEqual(symList(outlineOf("plainkey\n", "properties")), ["key:plainkey"]);
  assert.deepEqual(symList(outlineOf("server.port\n", "properties")), ["key:server.port"]);
  // 转义裸键与带分隔符的写法得到同一个键
  assert.deepEqual(
    symList(outlineOf("key" + BS + ":part\n", "properties")),
    symList(outlineOf("key" + BS + ":part=1\n", "properties"))
  );
});

test("properties: bare-key highlight and outline agree", () => {
  // 高亮涂的是**源码文本**，大纲给出**反转义后的键名**；
  // 不变式：outline name === unescape(highlighted text)。
  const cases = [
    "plainkey", "server.port", "a=1", "a:1", "a 1",
    "key" + BS + ":part", "key" + BS + "=part", "key" + BS + " sp", "a" + BS + "u003Ab",
    "k" + BS + BS, "", "  x", "a", "#c", "!c"
  ];
  for (const line of cases) {
    const highlighted = tokenizeLines(line, "properties")[0].segs
      .filter((s) => s.cls === "c-key").map((s) => s.text).join("");
    const names = outlineOf(line, "properties").map((s) => s.name);
    const expected = highlighted === "" ? [] : [unescapePropertyKey(highlighted)];
    assert.deepEqual(names, expected, "mismatch for " + JSON.stringify(line));
    assert.equal(
      tokenizeLines(line, "properties")[0].segs.map((s) => s.text).join(""),
      line,
      "character loss on " + JSON.stringify(line)
    );
  }
});

test("ini: bare-key highlight and outline agree", () => {
  const cases = ["plainkey", "someword", "a=1", "123=4", "-not-a-key?"];
  for (const line of cases) {
    const highlighted = tokenizeLines(line, "ini")[0].segs
      .filter((s) => s.cls === "c-key").map((s) => s.text).join("");
    const names = outlineOf(line, "ini").map((s) => s.name);
    assert.deepEqual(names, highlighted === "" ? [] : [highlighted], "mismatch for " + JSON.stringify(line));
  }
  // 段头走 c-section，不是 c-key（与大纲的 section 对应）
  const segs = tokenizeLines("[s]", "ini")[0].segs;
  assert.equal(segs.filter((s) => s.cls === "c-section").map((s) => s.text).join(""), "s");
  assert.equal(segs.filter((s) => s.cls === "c-key").length, 0);
});

test("yaml: flow-mapping braces are not part of the key", () => {
  // `x: {a: 1}` 这类行内映射：键从 `{` / `[` 之后才开始。少了这一步定界符处理，
  // `{port` 会被整段涂成键，与大纲列出的 `port` 对不上。
  const keyOf = (line) => tokenizeLines(line, "yaml")[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  assert.equal(keyOf("{port: 8080}"), "port");
  assert.equal(keyOf("  {port: 8080}"), "port");
  assert.equal(keyOf("- {a: 1}"), "a");
  // 普通 `key: value` 不受影响
  assert.equal(keyOf("key: v"), "key");
});

test("toml: bare identifiers are not keys (no false highlighting)", () => {
  // TOML 没有裸键语法：`foo` 是语法错误，不该被涂成 c-key，也不能出现在大纲里。
  // 上一版用 `sectionLines === true` 推断「允许裸键」，把 TOML 误伤了。
  const keyHighlight = (line, lang) =>
    tokenizeLines(line, lang)[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  for (const line of ["foo", "foo.bar", "bare_ident", "x"]) {
    assert.equal(keyHighlight(line, "toml"), "", "TOML 无分隔符行不该上色: " + JSON.stringify(line));
    assert.deepEqual(outlineOf(line, "toml"), [], "TOML 无分隔符行不该有大纲: " + JSON.stringify(line));
  }
  // 真正带 `=` 的 TOML 键仍然正常
  assert.equal(keyHighlight("a = 1", "toml"), "a");
  assert.equal(keyHighlight("dotted.key = 1", "toml"), "dotted.key");
  assert.deepEqual(outlineOf("a = 1\n", "toml").map((s) => s.name), ["a"]);
  // 段头走 c-section
  assert.equal(keyHighlight("[t]", "toml"), "");
  assert.deepEqual(outlineOf("[t]\n", "toml").map((s) => s.name), ["t"]);
  // 元数据必须显式声明裸键能力，而不是从 sectionLines 推断
  assert.equal(LANG_META.toml.keyBare, undefined, "TOML 不应声明 keyBare");
  assert.equal(LANG_META.ini.keyBare, "ident");
  assert.equal(LANG_META.properties.keyBare, "properties");
});

test("properties: a trailing continuation backslash still highlights the key", () => {
  // 行尾孤立反斜杠是续行标记，不是键名的一部分：`a\` 的键是 `a`。
  // 上一版高亮要求 propertiesKeyEnd === -1，导致这类键大纲有条却不高亮。
  assert.equal(propertiesKeySlice("a" + BS), "a");
  assert.equal(propertiesKeySlice("key" + BS), "key");
  assert.equal(propertiesKeySlice("a"), "a");
  assert.equal(propertiesKeySlice("a=1" + BS), "a");
  assert.equal(propertiesKeySlice("a=1"), "a");
  assert.equal(propertiesKeySlice("=v"), "", "行首即分隔符 → 无键");
  // 偶数个反斜杠不是续行，`\\` 是转义出的一个字面反斜杠，属于键名
  assert.equal(propertiesKeySlice("a" + BS + BS), "a" + BS + BS);
  assert.equal(propertiesKeySlice("k" + BS + BS + ":v"), "k" + BS + BS);
  // 高亮与大纲对续行键给出同一结论
  for (const line of ["a" + BS, "key" + BS, "a=1" + BS, "x" + BS, "a", "a" + BS + BS, "key" + BS + ":part"]) {
    const highlighted = tokenizeLines(line, "properties")[0].segs
      .filter((s) => s.cls === "c-key").map((s) => s.text).join("");
    const names = outlineOf(line + "\n", "properties").map((s) => s.name);
    const expected = highlighted === "" ? [] : [unescapePropertyKey(highlighted)];
    assert.deepEqual(names, expected, "continuation mismatch for " + JSON.stringify(line));
    assert.equal(
      tokenizeLines(line, "properties")[0].segs.map((s) => s.text).join(""),
      line,
      "character loss on " + JSON.stringify(line)
    );
  }
});

test("outline properties: highlighting matches the outline key", () => {
  const keyHighlight = (line) =>
    tokenizeLines(line, "properties")[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  // 空白分隔
  assert.equal(keyHighlight("server.port 8080"), "server.port");
  assert.equal(keyHighlight("server.port\t8080"), "server.port");
  // 转义分隔符：整个 `key\:part` 都是键（含反斜杠本身，因为它属于键名文本）
  assert.equal(keyHighlight("key" + BS + ":part=value"), "key" + BS + ":part");
  assert.equal(keyHighlight("key" + BS + "=part:value"), "key" + BS + "=part");
  // 转义空格
  assert.equal(keyHighlight("key" + BS + " with=1"), "key" + BS + " with");
  // 值里的 `!` 仍是值（既有行为不回归）
  assert.equal(keyHighlight("a=hello!world"), "a");
  // 其他语言不受 properties 的新分隔规则影响
  const dotenvKey = (line) =>
    tokenizeLines(line, "dotenv")[0].segs.filter((s) => s.cls === "c-key").map((s) => s.text).join("");
  assert.equal(dotenvKey("A 1"), "", "dotenv 不认空白分隔");
  assert.equal(
    tokenizeLines("A 1", "properties")[0].segs.map((s) => s.text).join(""),
    "A 1",
    "高亮不能丢字符"
  );
});

test("outline properties: continuation requires an odd number of backslashes", () => {
  // 偶数个反斜杠 = 转义出的字面反斜杠，本行结束 → 下一行是独立属性
  for (const n of [2, 4]) {
    const code = "a=foo" + BS.repeat(n) + "\nb=2\n";
    assert.deepEqual(symList(outlineOf(code, "properties")), ["key:a", "key:b"], "n=" + n);
  }
  // 奇数个反斜杠 = 续行 → 续行内容归上一键，不产生假键
  for (const n of [1, 3]) {
    const code = "a=foo" + BS.repeat(n) + "\nb=2\n";
    assert.deepEqual(symList(outlineOf(code, "properties")), ["key:a"], "n=" + n);
  }
  // 多行连续续行：只有最后一行是偶数个反斜杠时链条才结束
  const chain = "a=1" + BS + "\n  cont" + BS + BS + "\nb=2\n";
  assert.deepEqual(symList(outlineOf(chain, "properties")), ["key:a", "key:b"], JSON.stringify(chain));
});

// ---------- outline yaml: anchor / tag 不破坏容器关系 ----------
test("outline yaml: anchors and tags keep the container relationship", () => {
  // 带 anchor 的映射值是子块 → 键仍是段，子键挂在它下面
  const anchor = outlineOf("defaults: &defaults\n  adapter: postgres\n", "yaml");
  assert.deepEqual(symList(anchor), ["section:defaults", "key:adapter"], JSON.stringify(anchor));
  assert.equal(symNamed(anchor, "adapter").container, "defaults");

  // 带类型标签的映射同病同治
  const tag = outlineOf("mapping: !!map\n  a: 1\n", "yaml");
  assert.deepEqual(symList(tag), ["section:mapping", "key:a"], JSON.stringify(tag));
  assert.equal(symNamed(tag, "a").container, "mapping");

  // 自定义标签（`!foo`）与 `!<...>` 形式
  const custom = outlineOf("m: !myType\n  a: 1\n", "yaml");
  assert.equal(symNamed(custom, "m").kind, "section", JSON.stringify(custom));
  assert.equal(symNamed(custom, "a").container, "m");
  const verbatim = outlineOf("m: !<tag:yaml.org,2002:map>\n  a: 1\n", "yaml");
  assert.equal(symNamed(verbatim, "m").kind, "section", JSON.stringify(verbatim));

  // anchor + tag 同时出现
  const both = outlineOf("m: &a !!map\n  a: 1\n", "yaml");
  assert.equal(symNamed(both, "m").kind, "section", JSON.stringify(both));
  assert.equal(symNamed(both, "a").container, "m");

  // 标量值不会被误判成段
  const scalar = outlineOf("x: &a 5\ny: 1\n", "yaml");
  assert.deepEqual(symList(scalar), ["key:x", "key:y"], JSON.stringify(scalar));
  const tagScalar = outlineOf("x: !!str 5\ny: 1\n", "yaml");
  assert.deepEqual(symList(tagScalar), ["key:x", "key:y"], JSON.stringify(tagScalar));
  // 别名 `*a` 是值引用，不是空值
  const alias = outlineOf("x: *a\ny: 1\n", "yaml");
  assert.deepEqual(symList(alias), ["key:x", "key:y"], JSON.stringify(alias));
});

// ---------- 渲染窗口：搜索 / 大纲 与可跳转行号保持一致 ----------
test("render window: line count and membership", () => {
  assert.equal(renderedLineCount(0), 0);
  assert.equal(renderedLineCount(10), 10);
  assert.equal(renderedLineCount(RENDER_MAX_LINES), RENDER_MAX_LINES);
  assert.equal(renderedLineCount(RENDER_MAX_LINES + 1), RENDER_MAX_LINES);
  assert.equal(renderedLineCount(20050), RENDER_MAX_LINES);
  // 显式上限（测试 / 复用）
  assert.equal(renderedLineCount(100, 10), 10);
  assert.equal(inRenderWindow(1, 10), true);
  assert.equal(inRenderWindow(10, 10), true);
  assert.equal(inRenderWindow(11, 10), false);
  assert.equal(inRenderWindow(0, 10), false, "行号是 1 基");
});

test("render window: a >20000-line file cannot advertise unjumpable hits", () => {
  // 复现原缺陷：搜索与大纲基于完整内容，DOM 只渲染前 20000 行
  const total = RENDER_MAX_LINES + 50;
  const lines = [];
  for (let n = 1; n <= total; n++) {
    if (n === RENDER_MAX_LINES + 10) lines.push("def late_symbol():");
    else if (n === RENDER_MAX_LINES + 30) lines.push("NEEDLE_MARKER = 1");
    else if (n === 5) lines.push("def early():");
    else lines.push("# filler " + n);
  }
  const content = lines.join("\n");
  const tokens = tokenizeLines(content, "python");
  assert.equal(tokens.length, total);

  const renderedCount = renderedLineCount(tokens.length);
  assert.equal(renderedCount, RENDER_MAX_LINES);

  // 客户端现在按窗口裁剪（复用 __cn 里同一对 helper，见 client.template.js）
  const symbols = clipToRenderWindow(outlineOf(content, "python"), renderedCount);
  const matches = clipZeroBasedToRenderWindow(findMatches(content, "NEEDLE_MARKER", {}), renderedCount);

  // 窗口内的符号保留，窗口外的被裁掉 → 列表里的每一项都能跳转
  assert.deepEqual(symList(symbols), ["function:early"], JSON.stringify(symbols));
  assert.ok(symbols.every((s) => inRenderWindow(s.line, renderedCount)));
  // 窗口外的匹配不再计入 n/m → 不会出现「数得到却点不动」
  assert.deepEqual(matches, [], JSON.stringify(matches));

  // 反证：不经裁剪时缺陷确实存在（窗口外的行没有任何 DOM 行）
  const rawSymbols = outlineOf(content, "python");
  const rawMatches = findMatches(content, "NEEDLE_MARKER", {});
  assert.ok(rawSymbols.some((s) => !inRenderWindow(s.line, renderedCount)), "未裁剪时确有窗口外符号");
  assert.ok(rawMatches.some((m) => !inRenderWindow(m.line + 1, renderedCount)), "未裁剪时确有窗口外匹配");
  // 每一个被保留的符号 / 匹配都必须在窗口内（不变式）
  for (const s of symbols) assert.ok(inRenderWindow(s.line, renderedCount), s.name);
  for (const m of matches) assert.ok(inRenderWindow(m.line + 1, renderedCount));
});

test("built client bundle wires search and outline through the render window", () => {
  // lib/client.js 是实际运行的产物：模板改了但忘了 build 时，这个断言会失败。
  const bundle = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  // 渲染行数只能来自 renderedLineCount，不能再有写死的 20000
  assert.ok(bundle.includes("__cn.renderedLineCount("), "客户端未使用 renderedLineCount");
  assert.ok(!/Math\.min\([^)]*20000\)/.test(bundle), "客户端仍有写死的 20000 行上限");
  // 搜索与大纲都必须过裁剪函数
  assert.ok(bundle.includes("__cn.clipToRenderWindow("), "大纲未按渲染窗口裁剪");
  assert.ok(bundle.includes("__cn.clipZeroBasedToRenderWindow("), "搜索未按渲染窗口裁剪");
  // 行数上限被截断时要给出提示（否则用户无法理解为何找不到后面的内容）
  assert.ok(bundle.includes("lineCapped"), "缺少行数截断提示");
  // 新导出的纯函数确实被内联进 bundle
  for (const name of ["RENDER_MAX_LINES", "renderedLineCount", "inRenderWindow", "clipToRenderWindow", "clipZeroBasedToRenderWindow"]) {
    assert.ok(bundle.includes(name), "bundle 缺少导出 " + name);
  }
});

test("built client bundle keys its <style> tag by the full package name", () => {
  // client-modules 的 HMR 记账以**包名**为 key：失效/替换一个插件时它调用
  // removeOwnedStyles(id)，即删掉 data-plugin === <包名> 的 <style>。若这里写成
  // 短名（曾为 "dsh-code-nav"），那条查询永远匹配不到本插件的标签，卸载/HMR 后
  // 样式表会遗留在 document.head 里越积越多 —— 表现为「界面串味、要重启才干净」。
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const bundle = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.equal(pkg.name, "@whybebabo/dsh-code-nav", "包名变了，下面的断言要一起改");
  // 注册 id 与样式归属 key 都必须是完整包名
  assert.ok(
    bundle.includes(`id: ${JSON.stringify(pkg.name)}`),
    "bundle 未用完整包名注册（__ModuleLoader__.load 的 id）"
  );
  assert.ok(
    bundle.includes(`tag.dataset.plugin = PACKAGE_NAME`) || bundle.includes(`dataset.plugin = ${JSON.stringify(pkg.name)}`),
    "样式标签未用完整包名标记 data-plugin"
  );
  assert.ok(
    bundle.includes(`"${pkg.name}/styles.css"`) || bundle.includes(`PACKAGE_NAME + "/styles.css"`),
    "样式标签的 data-plugin-css 未以完整包名开头"
  );
  // 短名不能再出现在 data-plugin 赋值里
  assert.ok(
    !/dataset\.plugin = "dsh-code-nav"/.test(bundle),
    "样式标签仍以短名标记，HMR 无法回收该 <style>"
  );
  // 构建令牌必须已被替换（模板改了忘了 build 时立刻失败）
  assert.ok(!bundle.includes("__CN_PACKAGE_NAME__"), "bundle 残留未替换的包名令牌");
});

// ---------- 构建：产物新鲜度与共享作用域的四道校验 ----------
test("build: the committed bundle equals a fresh build", () => {
  // lib/client.js 是产物。之前只断言「里面含某段文本」，源码改了忘了构建时
  // 那些断言照样绿 —— 直接逐字比对才能钉住「产物 == 源码」。
  const { code } = buildBundle();
  const committed = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.equal(committed, code, "lib/client.js 已与源码不同步：跑 npm run build（node scripts/build.mjs）");
});

test("build: the real modules pass every scope guard", () => {
  const sources = MODULES.map((name) => ({
    module: name,
    source: readFileSync(new URL("../src/" + name + ".js", import.meta.url), "utf8")
  }));
  // 拼进同一个函数作用域：顶层重名 = 后者静默覆盖前者，单测全绿而 bundle 行为不对
  assert.deepEqual(findCollisions(sources), [], "src 模块间存在顶层重名");
  // 剥离只认单行写法；残留的 import/export 内联后就是语法错误
  for (const { module, source } of sources) {
    assert.deepEqual(stripModule(source).leftovers, [], "src/" + module + " 有剥不掉的模块语法");
  }
  const declared = new Set();
  for (const { source } of sources) for (const n of topLevelNames(source)) declared.add(n);
  for (const name of EXPORTS) assert.ok(declared.has(name), "EXPORTS 列了 src 里没有的 " + name);
  // 模板用到的每个 __cn.X 都在导出面里
  const template = readFileSync(new URL("../scripts/client.template.js", import.meta.url), "utf8");
  for (const name of cnUsage(template)) {
    assert.ok(EXPORTS.includes(name), "模板用了未导出的 " + name);
  }
});

test("build: each scope guard actually fires", () => {
  // 校验本身失效（永远不报）比没有校验更糟：那会让人以为重名/漏导出是安全的。
  assert.deepEqual(
    findCollisions([
      { module: "a", source: "export function helper() {}\n" },
      { module: "b", source: "const helper = 1;\n" }
    ]).map((c) => c.name + ":" + c.first + ">" + c.again),
    ["helper:a>b"]
  );
  // 缩进的声明不是顶层声明，不该误报
  assert.deepEqual(findCollisions([
    { module: "a", source: "function outer() {\n  const inner = 1;\n}\n" },
    { module: "b", source: "function other() {\n  const inner = 2;\n}\n" }
  ]), []);
  // 多行 import 剥不掉 → 必须报残留
  assert.ok(stripModule('import {\n  a\n} from "x.js";\nexport const k = 1;\n').leftovers.length > 0);
  assert.deepEqual(stripModule('import { a } from "x.js";\nexport const k = 1;\n').leftovers, []);

  // 用一份最小 fixture 驱动 buildBundle 的四类失败
  const root = mkdtempSync(join(tmpdir(), "cn-build-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@t/pkg" }), "utf8");
  writeFileSync(join(root, "scripts", "client.template.js"), '// __CN_PURE__\nconst p = "__CN_PACKAGE_NAME__";\nvoid __cn.alpha; void __cn.beta;\n', "utf8");
  const src = (name, body) => writeFileSync(join(root, "src", name + ".js"), body, "utf8");
  src("m", "export const alpha = 1;\nexport function beta() { return alpha; }\n");
  const throwsWith = (opts, needle) => {
    let message = "";
    try { buildBundle(opts); } catch (e) { message = String(e && e.message); }
    assert.ok(message.includes(needle), "应当失败并提到 " + needle + "，实际：" + (message || "（没抛错）"));
  };
  throwsWith({ root, modules: ["m"], exportsList: ["alpha", "ghost"] }, "ghost");
  throwsWith({ root, modules: ["m"], exportsList: ["alpha"] }, "beta");
  src("dup", "export const alpha = 2;\n");
  throwsWith({ root, modules: ["m", "dup"], exportsList: ["alpha"] }, "重名");
  src("bad", 'import {\n  q\n} from "./m.js";\nexport const solo = 1;\n');
  throwsWith({ root, modules: ["bad"], exportsList: ["solo"] }, "未剥离");

  // 回归：源码里的 `$&` 必须原样进产物。字符串形式的 replace 会把替换文本里的
  // `$&` / `` $` `` / `$'` 当成特殊模式展开 —— escapeRegExp 这类正则转义写法会被
  // 静默改写成标记本身，产物照样通过语法检查，只在运行时给出错误的转义结果。
  const dlr = 'return s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");';
  src("dlr", "export function esc(s) {\n  " + dlr + "\n}\nexport const alpha = esc(\"x\");\nexport const beta = 1;\n");
  const kept = buildBundle({ root, modules: ["dlr"], exportsList: ["alpha", "beta", "esc"] });
  assert.ok(kept.code.includes(dlr), "产物改写了源码里的 $&（内联替换必须用函数形式）");

  // 「产物逐行含有源码」这道校验本身要能报：内容被替换掉时必须失败，而不是静默放行。
  src("token", 'export const alpha = "__CN_PACKAGE_NAME__";\nexport const beta = 1;\n');
  throwsWith({ root, modules: ["token"], exportsList: ["alpha", "beta"] }, "改写");

  // 正常路径：产物带包名、令牌已替换
  const built = buildBundle({ root, modules: ["m"], exportsList: ["alpha", "beta"] });
  assert.ok(built.code.includes('"@t/pkg"') && !built.code.includes("__CN_PACKAGE_NAME__"));
});

test("built client bundle ships the lifecycle and a11y fixes", () => {
  const bundle = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  // 静默上限必须在界面上说出来，否则用户以为「就这么多」
  assert.ok(bundle.includes("__cn.MAX_MATCHES"), "匹配数封顶未提示");
  assert.ok(bundle.includes("__cn.OUTLINE_MAX_SYMBOLS"), "符号数封顶未提示");
  assert.ok(bundle.includes("symbols.capped") && bundle.includes("search.aria"), "缺少新增文案键");
  // 行节点要 memo：否则开关符号列表都会重建整篇代码
  assert.ok(bundle.includes("const rows = react.useMemo("), "行节点未 memo 化");
  // 卸载要清闪烁定时器
  assert.ok(bundle.includes("react.useEffect(() => () => {"), "卸载未清理定时器");
  // 键盘可达：符号行是 div，必须显式给 role/tabIndex
  assert.ok(bundle.includes('role: "button"') && bundle.includes("tabIndex: 0"), "符号行不可键盘操作");
  assert.ok(bundle.includes('"aria-expanded"') && bundle.includes('"aria-pressed"'), "按钮缺少状态语义");
  // 大文件查找输入要跟手：查询值延后一帧（宿主 React 太旧时降级直通）
  assert.ok(bundle.includes("useDeferredValue"), "查找未做延后计算");
  // rangeCount 为 0 时 getRangeAt(0) 会抛 IndexSizeError
  assert.ok(bundle.includes("sel.rangeCount === 0"), "选区未判空");
});

test("READMEs stay in sync with package.json and the documented workflow", () => {
  // README 里的版本号曾经过期（包已 0.2.2、文档还写 0.2.1），升级示例也跟着失真。
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const zh = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const en = readFileSync(new URL("../README_EN.md", import.meta.url), "utf8");
  assert.ok(zh.includes("当前版本 **" + pkg.version + "**"), "README.md 的版本号已过期（" + pkg.version + "）");
  assert.ok(en.includes("current version **" + pkg.version + "**"), "README_EN.md 的版本号已过期（" + pkg.version + "）");
  assert.ok(zh.includes("@whybebabo/dsh-code-nav@" + pkg.version), "README.md 的精确版本升级示例已过期");
  assert.ok(en.includes("@whybebabo/dsh-code-nav@" + pkg.version), "README_EN.md 的精确版本升级示例已过期");
  // 改完 src 忘了重新构建是这个仓库最常见的错，文档必须给出口
  for (const [label, doc] of [["README.md", zh], ["README_EN.md", en]]) {
    assert.ok(doc.includes("npm run build") && doc.includes("npm test"), label + " 未写 npm run build / npm test");
  }
  for (const name of ["build", "check", "test", "prepack", "release"]) {
    assert.ok(pkg.scripts && pkg.scripts[name], "package.json 缺少 scripts." + name);
  }
  // prepack 是 npm 发布前的钩子：不在这儿构建，就可能把旧产物打进 tarball
  assert.ok(pkg.scripts.prepack.includes("scripts/build.mjs"), "scripts.prepack 未触发构建");
  assert.ok(pkg.scripts.test.includes("node --check lib/client.js"), "scripts.test 未做产物语法校验");
});

test("CI workflow builds, checks, tests and refuses a stale bundle", () => {
  // CI 是这个仓库唯一的「产物没过期」强制点；步骤丢了就等于门禁没了。
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const step of [
    "node scripts/build.mjs",
    "node --check lib/client.js",
    "node test/code-nav.test.mjs",
    "git diff --exit-code -- lib/client.js",
    "npm pack",
    "node scripts/release-code-nav.mjs --dry-run"
  ]) {
    assert.ok(ci.includes(step), "CI 缺少步骤：" + step);
  }
  // 事件上下文绝不插进 shell（`${{ }}` 注入是 workflow 里的经典 RCE）
  assert.ok(!/\$\{\{\s*(github\.event|env)\b[^}]*\}\}/.test(ci.split("jobs:")[1] || ""), "CI 把事件上下文放进 shell");
  // 冒号哨兵：CI 没有第三方 YAML 解析器可用，而未加引号、值里带「: 」的标量（step 名里
  // 写「dry run: …」就是这样）会让 workflow 直接解析失败 —— GitHub 那边只留下一个
  // 「名字是文件路径、0 个 job、结论 failure」的运行，本地一切照旧绿。
  const unquoted = [];
  for (const [i, line] of ci.split("\n").entries()) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    const m = /^(?:-\s+)?(name|run|uses|id|if):(.*)$/.exec(t);
    if (m === null) continue;
    const value = m[2];
    if (/^\s*[|>&*]/.test(value)) continue;              // 块标量 / 锚点 / 别名
    const plain = value.trim();
    if (/^"[^"]*"$/.test(plain) || /^'[^']*'$/.test(plain)) continue;
    if (/: /.test(value)) unquoted.push((i + 1) + ": " + t);
  }
  assert.deepEqual(unquoted, [], "存在未加引号且含「: 」的标量，workflow 会解析失败");
});

test("README states the real test count", () => {
  // README 里的「N 例 / N cases」曾经过期（写 61、实际更多）。
  // 直接数本文件的顶层 test() 数量（与 node:test 的计数一致），再和 README 对齐，
  // 这样新增测试却忘了改文档时会立刻失败。
  const self = readFileSync(new URL("./code-nav.test.mjs", import.meta.url), "utf8");
  const actual = (self.match(/^test\(/gm) || []).length;
  assert.ok(actual > 0, "未数到测试");
  const zh = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const en = readFileSync(new URL("../README_EN.md", import.meta.url), "utf8");
  const zhClaim = /纯逻辑单测（(\d+)\s*例/.exec(zh);
  const enClaim = /unit tests \((\d+)\s*cases/.exec(en);
  assert.ok(zhClaim !== null, "README.md 未找到测试数量声明");
  assert.ok(enClaim !== null, "README_EN.md 未找到测试数量声明");
  assert.equal(Number(zhClaim[1]), actual, "README.md 的测试数量已过期");
  assert.equal(Number(enClaim[1]), actual, "README_EN.md 的测试数量已过期");
});

// ---------- properties 键规则（大纲与高亮共用） ----------
test("properties-key: escape-aware key scanning", () => {
  // 返回分隔符下标；-1 表示整行都是键
  assert.equal(propertiesKeyEnd("a=1"), 1);
  assert.equal(propertiesKeyEnd("a:1"), 1);
  assert.equal(propertiesKeyEnd("server.port 8080"), 11);
  assert.equal(propertiesKeyEnd("key" + BS + ":part"), -1, "转义的 : 不是分隔符");
  assert.equal(propertiesKeyEnd("key" + BS + "=part"), -1, "转义的 = 不是分隔符");
  assert.equal(propertiesKeyEnd("key" + BS + " sp"), -1, "转义的空格不是分隔符");
  assert.equal(propertiesKeyEnd("plainkey"), -1);
  assert.equal(propertiesKeyEnd("a"), -1);
  // 转义只在成对时生效：`\\:` 的 `:` 仍是分隔符（`\\` 是一个字面反斜杠）
  // k \ \ : v → 下标 0:k 1:\ 2:\ 3:: 4:v，转义吃掉下标 2，故分隔符在下标 3
  assert.equal(propertiesKeyEnd("k" + BS + BS + ":v"), 3);
  assert.deepEqual(symList(outlineOf("k" + BS + BS + ":v\n", "properties")), ["key:k" + BS]);
  // 裸键（整行都是键名）就是「没有分隔符」那一支：propertiesKeyEnd 返回 -1
  assert.equal(propertiesKeyEnd("key" + BS + ":part"), -1, "转义分隔符的裸键整行是键名");
  assert.equal(propertiesKeyEnd("a=1") >= 0, true, "有分隔符的行不是裸键行");
  // 与反斜杠奇偶规则一致：行尾孤立反斜杠属于续行标记，不是键名一部分
  assert.equal(propertiesKeyEnd("a" + BS), 1);
});

test("properties-key: unescape covers documented escapes", () => {
  assert.equal(unescapePropertyKey("key" + BS + ":part"), "key:part");
  assert.equal(unescapePropertyKey("key" + BS + "=part"), "key=part");
  assert.equal(unescapePropertyKey("key" + BS + " sp"), "key sp");
  assert.equal(unescapePropertyKey("k" + BS + BS), "k" + BS);
  assert.equal(unescapePropertyKey("a" + BS + "tb"), "a\tb");
  assert.equal(unescapePropertyKey("a" + BS + "nb"), "a\nb");
  assert.equal(unescapePropertyKey("a" + BS + "u003Ab"), "a:b");
  assert.equal(unescapePropertyKey("a" + BS + "uZZZZb"), "auZZZZb", "非法 \\u 序列退化处理");
  assert.equal(unescapePropertyKey("trailing" + BS), "trailing" + BS, "末尾孤立反斜杠按字面保留");
  assert.equal(unescapePropertyKey("plain"), "plain");
});

// ---------- 发布脚本：仓库 / 版本 / 产物名派生（防止误发到上游） ----------
test("release-config: repo, tag and asset name derive from package.json", async () => {
  const mod = await import("../scripts/release-config.mjs");
  const pkg = mod.readPkg();
  // 必须是本 fork，而不是上游 AnakinCao/dsh-code-nav
  assert.equal(mod.repoOf(pkg), "whybebabo/dsh-code-nav");
  assert.equal(mod.tagOf(pkg), "v" + pkg.version);
  // 产物名必须与 npm pack 的实际命名规则一致（scoped 包 → scope-name）
  assert.equal(mod.tgzNameOf(pkg), "whybebabo-dsh-code-nav-" + pkg.version + ".tgz");
  assert.equal(mod.tgzNameOf({ name: "@a/b", version: "1.2.3" }), "a-b-1.2.3.tgz");
  assert.equal(mod.tgzNameOf({ name: "plain", version: "9.0.0" }), "plain-9.0.0.tgz");
  // 无 repository / version 时必须抛错，而不是静默回落到错误仓库
  assert.throws(() => mod.repoOf({}));
  assert.throws(() => mod.repoOf({ repository: { url: "https://gitlab.com/a/b.git" } }));
  assert.throws(() => mod.tagOf({}));
  // URL 形态覆盖
  assert.equal(mod.repoOf({ repository: "https://github.com/o/r.git" }), "o/r");
  assert.equal(mod.repoOf({ repository: { url: "git+https://github.com/o/r.git" } }), "o/r");
  assert.equal(mod.repoOf({ repository: { url: "git@github.com:o/r.git" } }), "o/r");
});

test("release scripts: no hardcoded upstream repo or version", async () => {
  const mod = await import("../scripts/release-config.mjs");
  const pkg = mod.readPkg();
  const expected = mod.repoOf(pkg);
  // 这些脚本会真的推送 / 发 Release：源码里不得残留指向其它仓库的写死引用
  for (const f of ["release-code-nav.mjs", "repo-topics.mjs"]) {
    const src = readFileSync(new URL("../scripts/" + f, import.meta.url), "utf8");
    const warnings = mod.hardcodedRepoWarnings(src, expected, mod.DOC_LINK_REPOS);
    assert.deepEqual(warnings, [], f + " 仍写死了其它仓库: " + warnings.join(", "));
    assert.ok(!/dsh-code-nav-0\.1\.\d\.tgz/.test(src), f + " 仍引用旧版本产物名");
    assert.ok(!/["'`]v0\.1\.\d["'`]/.test(src), f + " 仍写死旧 tag");
  }
  // pr-better-sidebar.mjs 本来就操作 omdsh-dev/DSH-better-sidebar，属主需派生自本包
  const pr = readFileSync(new URL("../scripts/pr-better-sidebar.mjs", import.meta.url), "utf8");
  const prWarnings = mod.hardcodedRepoWarnings(pr, expected, mod.DOC_LINK_REPOS);
  assert.deepEqual(prWarnings, [], "pr-better-sidebar.mjs 写死了其它仓库: " + prWarnings.join(", "));
  assert.ok(!/AnakinCao/.test(pr), "pr-better-sidebar.mjs 仍写死上游属主");
  // 克隆目录必须是可配置 / 跨平台的（曾经写死某个本机盘符路径）
  assert.ok(pr.includes("tmpdir()"), "pr-better-sidebar.mjs 未使用系统临时目录");
  assert.ok(!/["'`][A-Za-z]:[\\/]/.test(pr), "pr-better-sidebar.mjs 仍写死本机绝对路径");
});

test("pr script: initialises a missing clone and never hard-resets the worktree", () => {
  const src = readFileSync(new URL("../scripts/pr-better-sidebar.mjs", import.meta.url), "utf8");
  // 默认 clone 目录在系统临时目录：全新环境并不存在，脚本必须自己 clone 出来
  assert.ok(/existsSync\(CLONE\)/.test(src), "未检查 clone 目录是否存在");
  assert.ok(/"clone"/.test(src), "缺少自动 git clone");
  // 目录存在但不是仓库 / 缺 origin 时须明确报错，而不是继续 fetch
  assert.ok(src.includes("--is-inside-work-tree"), "未校验 clone 是有效仓库");
  assert.ok(src.includes("is-shallow-repository"), "未判断是否浅克隆就直接 --unshallow");
  // 曾经：checkout 失败 → git reset --hard，会删掉未提交改动
  assert.ok(!/reset",\s*"--hard"/.test(src), "pr-better-sidebar.mjs 仍会 hard reset 销毁未提交修改");
  assert.ok(src.includes("PATCH_FILES"), "未集中声明待提交文件");
  assert.ok(/没有待提交的改动/.test(src), "缺少「无改动」的显式失败");
});

test("release-config: hardcodedRepoWarnings detects every reference form", async () => {
  const mod = await import("../scripts/release-config.mjs");
  const want = "whybebabo/dsh-code-nav";
  const other = "AnakinCao/dsh-code-nav";
  // 原始缺陷的形态：赋给仓库语义变量的裸字符串（old scanner 漏掉了这一种）
  for (const src of [
    'const REPO = "AnakinCao/dsh-code-nav";',
    "const REPO = 'AnakinCao/dsh-code-nav';",
    "const REPO = `AnakinCao/dsh-code-nav`;",
    'const FORK = "AnakinCao/dsh-code-nav";',
    'fetch("https://api.github.com/repos/AnakinCao/dsh-code-nav/topics")',
    'fetch("https://uploads.github.com/repos/AnakinCao/dsh-code-nav/releases/1/assets")',
    'const u = "https://github.com/AnakinCao/dsh-code-nav.git";',
    'const u = "git+https://github.com/AnakinCao/dsh-code-nav.git";',
    'const u = "git@github.com:AnakinCao/dsh-code-nav.git";',
  ]) {
    assert.deepEqual(mod.hardcodedRepoWarnings(src, want), [other], "missed: " + src);
  }
  // 不误报：分支名 / 文件路径 / MIME / 文档里链接的依赖仓库 / 注释
  assert.deepEqual(mod.hardcodedRepoWarnings('const BRANCH = "feat/dsh-code-nav-catalog";', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('git add "tests/plugin-list.spec.ts"', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('"application/gzip"', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('"text/plain"', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('// see AnakinCao/dsh-code-nav for context', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('"omdsh-dev/DSH-better-sidebar"', want, mod.DOC_LINK_REPOS), []);
  // 当前仓库本身不算问题（不误报）
  assert.deepEqual(mod.hardcodedRepoWarnings('"whybebabo/dsh-code-nav"', want), []);
  assert.deepEqual(mod.hardcodedRepoWarnings('"https://github.com/whybebabo/dsh-code-nav.git"', want), []);
  // api.github.com 的 `/repos/o/r` 不得被误切成 `repos/o`
  assert.deepEqual(mod.hardcodedRepoWarnings('"https://api.github.com/repos/a/b/x"', want), ["a/b"]);
  // DOC_LINK_REPOS 覆盖运行期依赖仓库
  assert.ok(mod.DOC_LINK_REPOS.includes("omdsh-dev/DSH-better-sidebar"));
});

test("release script: refuses to target a remote that is not the derived repo", () => {
  // release-code-nav.mjs 的 remote 校验必须拒绝指向上游的 remote（真实执行验证过）。
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("--dry-run"), "缺少 --dry-run 演练开关");
  assert.ok(src.includes("拒绝推送"), "缺少 remote 不一致的拒绝逻辑");
  // 不得再静默改写用户的 remote 配置（曾经会 set-url origin 到上游）
  assert.ok(!/remote",\s*"set-url"/.test(src), "仍会静默改写 remote url");
  assert.ok(!/remote",\s*"add",\s*"origin"/.test(src), "仍会静默新建 origin");
});

test("release-config: remote URLs normalise across HTTPS / SSH / git+ forms", async () => {
  const mod = await import("../scripts/release-config.mjs");
  // 同一仓库的等价写法必须归一到同一个 owner/repo
  for (const url of [
    "https://github.com/o/r.git", "https://github.com/o/r", "http://github.com/o/r.git",
    "git+https://github.com/o/r.git", "git@github.com:o/r.git", "git@github.com:o/r",
    "ssh://git@github.com/o/r.git", "git://github.com/o/r.git", "git@github.com:o/r/",
    // GitHub 官方的 443 端口 SSH 端点（禁止 github.com:22 的网络只能用这条通道）
    "ssh://git@ssh.github.com:443/o/r.git", "ssh://git@ssh.github.com/o/r.git", "git@ssh.github.com:o/r.git",
  ]) {
    assert.equal(mod.normalizeRemoteRepo(url), "o/r", "normalise failed: " + url);
    assert.equal(mod.isSameRepo(url, "o/r"), true, "isSameRepo failed: " + url);
  }
  assert.equal(mod.normalizeRemoteRepo("https://github.com/O/R.git"), "O/R");
  assert.equal(mod.isSameRepo("https://github.com/O/R.git", "o/r"), true, "大小写不敏感");
  // 非 GitHub / 无法识别的一律 null（不误判成同一仓库）
  for (const bad of ["https://gitlab.com/o/r.git", "https://api.github.com/repos/o/r", "", "not a url"]) {
    assert.equal(mod.normalizeRemoteRepo(bad), null, "should not normalise: " + bad);
    assert.equal(mod.isSameRepo(bad, "o/r"), false);
  }
  assert.equal(mod.isSameRepo("https://github.com/x/y.git", "o/r"), false);
  // 发布脚本必须走规范化比较，而不是字符串相等
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("isSameRepo"), "release-code-nav.mjs 未使用规范化比较");
  assert.ok(!/remoteUrl !== url/.test(src), "仍用字符串相等比较 remote URL");
});

test("release script: the artifact is a precondition checked before any write", () => {
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  // gather the index of key operations; the artifact check must come first
  const idx = (needle) => src.indexOf(needle);
  const check = idx("发布前置条件不满足");
  assert.ok(check > 0, "缺少「产物存在」前置校验");
  for (const [label, needle] of [
    ["git push 分支", '"push", "-u"'],
    ["git tag", '"tag", TAG'],
    ["git push tag", '"push", remoteName, TAG'],
    ["创建 Release", '"/releases"'],
    ["上传资产", "uploads.github.com"],
  ]) {
    const at = idx(needle);
    assert.ok(at > 0, "找不到 " + label);
    assert.ok(check < at, "产物校验必须早于「" + label + "」（否则会留下空 Release / 远端 tag）");
  }
});

// ---------- 发布脚本：tag 不得被重写 ----------
test("decideTagAction: reuse the same commit, refuse a moved tag", async () => {
  const mod = await import("../scripts/release-config.mjs");
  // 远端与本地都没有该 tag → 创建
  assert.equal(mod.decideTagAction(null, "abc").action, "create");
  assert.equal(mod.decideTagAction("", "abc").action, "create");
  assert.equal(mod.decideTagAction(null, "abc", null).action, "create");
  assert.equal(mod.decideTagAction(null, "abc", "").action, "create");
  // 同一提交 → 复用（幂等重跑）
  assert.equal(mod.decideTagAction("abc", "abc").action, "reuse");
  // 不同提交 → 拒绝（绝不 tag -f / push -f 改写已发布版本）
  const conflict = mod.decideTagAction("aaa111", "bbb222");
  assert.equal(conflict.action, "conflict");
  assert.ok(conflict.reason.length > 0);
  // 比较前 trim（git 输出常带空白）
  assert.equal(mod.decideTagAction("abc\n", "abc").action, "reuse");
  // 本地残留 tag（上次推到一半失败）：同提交只补推，绝不再 `git tag`（会 fatal）
  assert.equal(mod.decideTagAction(null, "abc", "abc").action, "push");
  // 本地残留 tag 指向别处 → 不能推（推上去等于把错误提交发布成该版本）
  assert.equal(mod.decideTagAction(null, "abc", "zzz").action, "conflict");
  // 远端存在时优先看远端，远端不同一律拒绝（本地一致也不能救）
  assert.equal(mod.decideTagAction("aaa", "bbb", "bbb").action, "conflict");
});

test("parseRemoteTagCommit: annotated tags resolve to the commit, not the tag object", async () => {
  const mod = await import("../scripts/release-config.mjs");
  const light = "1111111111111111111111111111111111111111\trefs/tags/v0.2.0\n";
  assert.equal(mod.parseRemoteTagCommit(light, "v0.2.0"), "1".repeat(40));
  // 附注 tag：普通行是 tag 对象 SHA，必须优先取 ^{} 的提交 SHA
  const annotated = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v0.2.0",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v0.2.0^{}",
    "",
  ].join("\n");
  assert.equal(mod.parseRemoteTagCommit(annotated, "v0.2.0"), "b".repeat(40), "附注 tag 必须取 peeled 提交");
  // 其它 tag / 无匹配 → null（不能把别的 tag 当成目标 tag）
  assert.equal(mod.parseRemoteTagCommit("1111111111111111111111111111111111111111\trefs/tags/v9.9.9\n", "v0.2.0"), null);
  assert.equal(mod.parseRemoteTagCommit("", "v0.2.0"), null);
  assert.equal(mod.parseRemoteTagCommit("garbage", "v0.2.0"), null);
  // 前缀相近的 tag 不得被误认为目标 tag
  assert.equal(mod.parseRemoteTagCommit("1111111111111111111111111111111111111111\trefs/tags/v0.2.0-rc.1\n", "v0.2.0"), null);
});

test("release script: never force-rewrites an existing tag", () => {
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  // 曾经：git tag -f + 无条件 git push -f
  assert.ok(!/"tag",\s*"-f"/.test(src), "仍会 git tag -f 重写 tag");
  assert.ok(!/"push",\s*"-f"/.test(src), "仍会 git push -f 强推 tag");
  assert.ok(src.includes("decideTagAction"), "未使用 decideTagAction 判定 tag");
  assert.ok(src.includes("parseRemoteTagCommit"), "未读取远端 tag 指向的提交");
  // 本地残留 tag 也要判定，否则 `git tag TAG` 会以 fatal 崩掉
  assert.ok(src.includes("localTagCommit"), "未处理本地已存在的同名 tag");
  assert.ok(src.includes("TAG EXISTS at same commit"), "缺少 tag 复用日志");
  // tag 校验是只读的，必须早于分支 push（否则失败时分支已被推上去）
  assert.ok(
    src.indexOf("decideTagAction(remoteTagCommit, headCommit)") < src.indexOf('"push", "-u"'),
    "tag 校验必须早于分支 push"
  );
  // ls-remote 失败不能被当成「tag 不存在」
  assert.ok(src.includes("gitStrict"), "ls-remote 失败未与「tag 不存在」区分");
  assert.ok(src.includes("无法查询远端 tag"), "缺少 ls-remote 失败的显式失败");
});

// ---------- 发布脚本：资产上传幂等 ----------
test("decideAssetAction: skip identical assets, never blind-POST a duplicate", async () => {
  const mod = await import("../scripts/release-config.mjs");
  const local = { sha256: "a".repeat(64), size: 100 };
  // 无同名资产 → 上传
  assert.equal(mod.decideAssetAction(null, local).action, "upload");
  assert.equal(mod.decideAssetAction(undefined, local).action, "upload");
  // digest 一致 → 跳过（幂等重跑的关键路径）
  assert.equal(mod.decideAssetAction({ name: "x", digest: "sha256:" + "a".repeat(64) }, local).action, "skip");
  // digest 大小写 / 前缀差异不影响判定
  assert.equal(mod.decideAssetAction({ name: "x", digest: "SHA256:" + "A".repeat(64) }, local).action, "skip");
  // digest 不同 → 替换（同名重复上传只会 422，替换才能收敛）
  assert.equal(mod.decideAssetAction({ name: "x", digest: "sha256:" + "b".repeat(64) }, local).action, "replace");
  // 只有 size：**不能**因为大小相等就跳过。GitHub 资产的 digest 经常是 null，
  // 而「同大小不同内容」完全可能 —— skip 会把错产物永久留在已发布版本上。
  assert.equal(mod.decideAssetAction({ name: "x", size: 100 }, local).action, "replace");
  assert.equal(mod.decideAssetAction({ name: "x", size: 101 }, local).action, "replace");
  // 只有本地 size、远端没给 → 同样替换
  assert.equal(mod.decideAssetAction({ name: "x", size: 100 }, { size: 100 }).action, "replace");
  // 什么都没给 → 不能盲传（只能替换）
  assert.equal(mod.decideAssetAction({ name: "x" }, local).action, "replace");
  assert.equal(mod.decideAssetAction({ name: "x" }, {}).action, "replace");
});

test("release script: re-running a published release does not fail on the asset", () => {
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("decideAssetAction"), "资产上传未做幂等判定");
  assert.ok(src.includes("createHash"), "未计算本地产物 sha256");
  // 必须先查已有资产，再决定是否上传
  assert.ok(/releases\/" \+ releaseId \+ "\/assets\?per_page/.test(src), "未列出现有资产");
  assert.ok(src.includes("ASSET DECISION"), "缺少资产决策日志");
  assert.ok(src.includes('"skip"'), "缺少跳过分支");
  assert.ok(src.includes('method: "DELETE"'), "替换时未删除旧资产（会 422 already_exists）");
});

// ---------- 发布脚本：凭据获取与远端写入的门禁 ----------
test("release scripts: one credential helper, and the token never reaches the log", async () => {
  const mod = await import("../scripts/release-config.mjs");
  assert.equal(typeof mod.readGithubToken, "function", "共享的取 token helper 缺失");
  const scripts = ["release-code-nav.mjs", "pr-better-sidebar.mjs", "repo-topics.mjs"];
  for (const name of scripts) {
    const src = readFileSync(new URL("../scripts/" + name, import.meta.url), "utf8");
    assert.ok(src.includes("readGithubToken()"), name + " 没有走共享 helper");
    // 三个脚本原先各抄一遍 credential fill，失败分支各自 `console.error(e.message)`：
    // git 的报错里可能带凭据助手的路径与提示。现在任何脚本都不许直接问 git、
    // 也不许把 credential 的输出/异常原文打出来。（注释里提到 git credential 是允许的，
    // 所以查的是「作为参数传给 execFileSync 的引号字符串」。）
    assert.ok(!src.includes('"credential"'), name + " 仍在脚本里直接调 git credential");
    assert.ok(!/console\.(log|error)\([^)]*\bout\b/.test(src), name + " 可能打印 credential fill 的输出");
  }
  const helper = readFileSync(new URL("../scripts/release-config.mjs", import.meta.url), "utf8");
  assert.ok(/throw new Error\(/.test(helper), "取不到 token 时必须抛错而不是回落到匿名请求");
  assert.ok(!helper.includes("console.log(out"), "helper 不得打印 credential 输出");
});

test("release script: creating a public repository requires an explicit --yes", () => {
  const src = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  assert.ok(src.includes('argv.includes("--yes")'), "没有 --yes 开关");
  // 404 也可能是「仓库存在但当前 token 看不见」，此时新建同名公开仓库会把内容暴露出去
  const gate = src.indexOf("/user/repos");
  const guard = src.lastIndexOf("if (!YES)", gate);
  assert.ok(gate > 0 && guard >= 0 && guard < gate, "建仓前没有 --yes 门禁");
  assert.ok(src.includes("本次未推送分支、未打 tag、未创建 Release"), "门禁分支要说明本次没写任何东西");
  // --dry-run 必须在取凭据之前退出
  assert.ok(src.indexOf("if (DRY)") < src.indexOf("readGithubToken()"), "dry run 仍应先取凭据（不对）");
});

test("pr script: dry run stops before any clone, commit or push", () => {
  const src = readFileSync(new URL("../scripts/pr-better-sidebar.mjs", import.meta.url), "utf8");
  assert.ok(src.includes('includes("--dry-run")'), "PR 脚本没有 --dry-run");
  const dryExit = src.indexOf("if (DRY)");
  assert.ok(dryExit > 0, "缺少 dry-run 分支");
  // 退出点必须早于取凭据、clone、push 与建 PR
  for (const needle of ["readGithubToken()", 'sh("git", ["clone"', 'sh("git", ["-C", CLONE, "push"', "/pulls"]) {
    const at = src.indexOf(needle);
    assert.ok(at > dryExit, needle + " 发生在 dry-run 退出之前");
  }
});
