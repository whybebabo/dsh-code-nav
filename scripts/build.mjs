#!/usr/bin/env node
/**
 * dsh-code-nav — 构建脚本：把 src/*.js（纯函数模块）内联进
 * scripts/client.template.js 的 // __CN_PURE__ 标记处，生成 lib/client.js。
 *
 * 用法：node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = ["lang-registry", "properties-key", "tokenize", "config-outline", "outline", "search", "selection", "render-window"];
const EXPORTS = [
  "langOf", "langLabel", "LANG_EXT", "LANG_META",
  "tokenizeLines", "outlineOf", "kindGroup",
  "findMatches", "spansOfLine",
  "SELECTION_LIMIT", "selectionHeader", "buildSelectionInsert",
  "RENDER_MAX_LINES", "renderedLineCount", "inRenderWindow",
  "clipToRenderWindow", "clipZeroBasedToRenderWindow"
];

const parts = [];
for (const name of MODULES) {
  const file = join(ROOT, "src", name + ".js");
  if (!existsSync(file)) {
    // 缺源文件时给出可行动的提示（而不是裸 ENOENT）：新加的模块必须随
    // package.json 的 files / 版本控制一起提交，否则别的检出环境无法构建。
    console.error(`[build] missing source module: src/${name}.js`);
    console.error("[build] MODULES requires every file to be committed (git add src/" + name + ".js and un-ignore it)");
    process.exit(1);
  }
  const src = readFileSync(file, "utf8");
  const stripped = src
    .replace(/^export\s+/gm, "")
    .replace(/^import\s+[^\n]+from\s+"[^"]+";?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  parts.push(`//#region module: ${name}\n${stripped}\n//#endregion`);
}

const wrapped = [
  "const __cn = (() => {",
  '	"use strict";',
  ...parts.map((p) => p.split("\n").map((l) => /^\s*$/.test(l) ? "" : "\t" + l).join("\n")),
  `\treturn { ${EXPORTS.join(", ")} };`,
  "})();",
  ""
].join("\n");

const template = readFileSync(join(ROOT, "scripts", "client.template.js"), "utf8");
const marker = "// __CN_PURE__";
if (!template.includes(marker)) {
  console.error("[build] template marker not found:", marker);
  process.exit(1);
}

// 客户端 bundle 的注册 id 必须等于包名（client-modules 以包名作为 module
// table key），所以从 package.json 注入而不是在模板里写死，避免改名后漂移。
const NAME_TOKEN = "__CN_PACKAGE_NAME__";
if (!template.includes(NAME_TOKEN)) {
  console.error("[build] template name token not found:", NAME_TOKEN);
  process.exit(1);
}
const pkgName = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
if (typeof pkgName !== "string" || pkgName === "") {
  console.error("[build] package.json has no usable name");
  process.exit(1);
}

const out = template
  .replace(marker, wrapped)
  .replaceAll(`"${NAME_TOKEN}"`, JSON.stringify(pkgName));
mkdirSync(join(ROOT, "lib"), { recursive: true });
writeFileSync(join(ROOT, "lib", "client.js"), out, "utf8");
console.log(`[build] lib/client.js written (${out.length} bytes, ${EXPORTS.length} exports, id "${pkgName}").`);
