/**
 * dsh-code-nav — host 入口（lib/index.js）的门禁测试。
 *
 * 背景：`package.json` 的 `main` / `exports["."]` 都指向 `lib/index.js`，这是 DSH
 * loader 真正 import 的入口；但它曾经不在任何一道门里 —— 写坏它（少一个 `}`），
 * `npm test` / `node --check lib/client.js` / `verify-pack` / stale 检查 / 发布演练
 * 全部为绿，用户装上后插件直接加载失败（审查 P1-1）。
 *
 * 本文件做两件事：
 * 1. 真的 `import` 一次入口，断言 loader 需要的导出形状（name / inject / apply）；
 *    import 本身就能拦住语法错误 —— 坏掉的入口会让本文件加载失败，`npm test` 立刻红；
 * 2. 断言 `main` 与 `exports["."]` 仍然指向 `lib/index.js`，防止入口被悄悄改到别处。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as entry from "../lib/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("entry: lib/index.js exports the host-half plugin shape the DSH loader needs", () => {
  // cordis loader 依据 entry.name 挂载插件；client-modules 也用它注册客户端 bundle。
  assert.equal(typeof entry.name, "string", "entry.name 必须是字符串");
  assert.ok(entry.name.length > 0, "entry.name 不能为空");
  // inject 必须存在且是数组（loader 会 for…of 它）。
  assert.ok(Array.isArray(entry.inject), "entry.inject 必须是数组");
  // apply 是插件生命周期入口；不是函数就挂不上。
  assert.equal(typeof entry.apply, "function", "entry.apply 必须是函数");
});

test("entry: package.json main and exports['.'] both point at lib/index.js", () => {
  assert.equal(pkg.main, "lib/index.js", "package.json 的 main 不再是 lib/index.js");
  assert.equal(pkg.exports?.["."], "./lib/index.js", 'package.json 的 exports["."] 不再是 lib/index.js');
});
