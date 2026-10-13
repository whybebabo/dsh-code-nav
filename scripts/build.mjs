#!/usr/bin/env node
/**
 * dsh-code-nav — 构建脚本：把 src/*.js（纯函数模块）内联进
 * scripts/client.template.js 的 // __CN_PURE__ 标记处，生成 lib/client.js。
 *
 * 用法：node scripts/build.mjs            # 构建并写盘
 *       import { buildBundle } from ...   # 只取产物（测试用它校验「产物 == 源码」）
 *
 * 拼接方式是「去掉 export/import，全部塞进同一个函数作用域」，所以本脚本必须守住四件事：
 * 1. 顶层重名 —— 两个模块各写一个同名 helper 时，后者的声明会**静默覆盖**前者，
 *    表现为「单测全绿、bundle 里某个函数行为却来自另一个文件」，几乎无法定位；
 * 2. 残留的 import/export —— 剥离正则只认单行写法，多行 import 会把裸 `from "…"`
 *    留在产物里，直接语法错误；
 * 3. 导出面与用量对不上 —— 模板里写 `__cn.foo()` 而 foo 没进 EXPORTS，只会在
 *    浏览器加载时才炸；
 * 4. 产物逐行等于源码 —— 内联必须用函数形式的 replace；字符串形式会把替换文本里的
 *    `$&`、`` $` `` 当成特殊模式展开，静默改写源码行（语法检查照样通过）。
 * 四者都在构建期报错，而不是留给运行时。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** 拼接顺序即依赖顺序（被依赖者在前，共享作用域里声明在前才能被引用）。 */
export const MODULES = ["lang-registry", "properties-key", "tokenize", "config-outline", "outline", "search", "selection", "render-window"];
export const EXPORTS = [
  "langOf", "langLabel", "LANG_EXT", "LANG_META",
  "tokenizeLines", "outlineOf", "kindGroup", "OUTLINE_MAX_SYMBOLS",
  "findMatches", "spansOfLine", "MAX_MATCHES",
  "SELECTION_LIMIT", "selectionHeader", "buildSelectionInsert",
  "RENDER_MAX_LINES", "renderedLineCount", "inRenderWindow",
  "clipToRenderWindow", "clipZeroBasedToRenderWindow"
];

/** 顶层声明名（含被 export 修饰的），用于重名与导出面校验。 */
export function topLevelNames(source) {
  const names = [];
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = re.exec(source)) !== null) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * 找出跨模块重复的顶层声明名。
 * @param {Array<{module:string, source:string}>} sources
 * @returns {Array<{name:string, first:string, again:string}>}
 */
export function findCollisions(sources) {
  const owner = new Map();
  const collisions = [];
  for (const { module, source } of sources) {
    for (const name of topLevelNames(source)) {
      if (owner.has(name)) collisions.push({ name, first: owner.get(name), again: module });
      else owner.set(name, module);
    }
  }
  return collisions;
}

/** 模板里用到的 `__cn.X` 名字集合。 */
export function cnUsage(templateSource) {
  const used = [];
  const re = /__cn\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = re.exec(templateSource)) !== null) used.push(m[1]);
  return [...new Set(used)];
}

/** 剥离 export / 单行 import；返回 { code, leftovers } 供调用方校验。 */
export function stripModule(source) {
  const code = source
    .replace(/^export\s+/gm, "")
    .replace(/^import\s+[^\n]+from\s+"[^"]+";?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const leftovers = [];
  const re = /^\s*(?:import|export)\b[^\n]*/gm;
  let m;
  while ((m = re.exec(code)) !== null) leftovers.push(m[0].trim());
  return { code, leftovers };
}

/**
 * 生成客户端 bundle 源码（纯函数，不写盘）。
 * @param {{root?:string, modules?:string[], exportsList?:string[]}} [options]
 * @returns {{code:string, pkgName:string, bytes:number}}
 * @throws 源文件缺失 / 顶层重名 / 残留 import / 导出面与用量不符时抛错
 */
export function buildBundle(options = {}) {
  const root = options.root ?? ROOT;
  const modules = options.modules ?? MODULES;
  const exportsList = options.exportsList ?? EXPORTS;

  const pkgRaw = readFileSync(join(root, "package.json"), "utf8");
  // 客户端 bundle 的注册 id 必须等于包名（client-modules 以包名作为 module
  // table key），所以从 package.json 注入而不是在模板里写死，避免改名后漂移。
  const pkgName = JSON.parse(pkgRaw).name;
  if (typeof pkgName !== "string" || pkgName === "") throw new Error("[build] package.json has no usable name");

  const sources = [];
  const parts = [];
  const strippedList = [];
  for (const name of modules) {
    const file = join(root, "src", name + ".js");
    if (!existsSync(file)) {
      // 缺源文件时给出可行动的提示（而不是裸 ENOENT）：新加的模块必须随
      // package.json 的 files / 版本控制一起提交，否则别的检出环境无法构建。
      throw new Error(
        `[build] missing source module: src/${name}.js\n` +
        `[build] MODULES requires every file to be committed (git add src/${name}.js and un-ignore it)`
      );
    }
    const source = readFileSync(file, "utf8");
    sources.push({ module: name, source });
    const { code, leftovers } = stripModule(source);
    if (leftovers.length > 0) {
      throw new Error(
        `[build] src/${name}.js 仍有未剥离的模块语法，内联后会语法错误：\n  ` +
        leftovers.join("\n  ") +
        "\n[build] 拼接只支持单行的 import/from 写法。"
      );
    }
    strippedList.push({ module: name, code });
    parts.push(`//#region module: ${name}\n${code}\n//#endregion`);
  }

  const collisions = findCollisions(sources);
  if (collisions.length > 0) {
    const detail = collisions.map((c) => `  ${c.name}: src/${c.first}.js 与 src/${c.again}.js`).join("\n");
    throw new Error(
      `[build] 顶层声明重名，内联到同一作用域后会被静默覆盖：\n${detail}\n` +
      "[build] 给其中一个换个名字（或把共享的那份抽成独立模块）。"
    );
  }

  // 导出面：EXPORTS 里的名字必须在某个模块里真的声明了
  const declared = new Set();
  for (const { source } of sources) for (const n of topLevelNames(source)) declared.add(n);
  const unknown = exportsList.filter((n) => !declared.has(n));
  if (unknown.length > 0) {
    throw new Error(
      "[build] EXPORTS 列了源码里不存在的名字: " + unknown.join(", ") +
      "\n[build] 返回对象会在加载时抛 ReferenceError —— 删掉这些项，或把函数真的写出来。"
    );
  }

  const wrapped = [
    "const __cn = (() => {",
    '	"use strict";',
    ...parts.map((p) => p.split("\n").map((l) => /^\s*$/.test(l) ? "" : "\t" + l).join("\n")),
    `\treturn { ${exportsList.join(", ")} };`,
    "})();",
    ""
  ].join("\n");

  const templatePath = join(root, "scripts", "client.template.js");
  const template = readFileSync(templatePath, "utf8");
  const marker = "// __CN_PURE__";
  if (!template.includes(marker)) throw new Error("[build] template marker not found: " + marker);
  const NAME_TOKEN = "__CN_PACKAGE_NAME__";
  if (!template.includes(NAME_TOKEN)) throw new Error("[build] template name token not found: " + NAME_TOKEN);

  // 模板用到的每个 __cn.X 都要真的在导出面里
  const missing = cnUsage(template).filter((n) => !exportsList.includes(n));
  if (missing.length > 0) {
    throw new Error(
      "[build] 模板使用了未导出的纯函数: " + missing.join(", ") +
      "\n[build] 加进 build.mjs 的 EXPORTS 列表，否则浏览器端拿到的是 undefined。"
    );
  }

  const code = template
    // 替换必须用**函数**形式：字符串形式的 replace 会把替换文本里的 `$&`、`` $` ``、
    // `$'` 当成特殊模式展开。src 里出现 `s.replace(re, "\\$&")`（正则转义的经典写法）
    // 时，字符串形式会把它改写成标记本身 —— 产物照样能通过语法检查，只在运行时给出
    // 错误的转义结果，几乎不可能想到是构建环节动了内容。
    .replace(marker, () => wrapped)
    .replaceAll(`"${NAME_TOKEN}"`, () => JSON.stringify(pkgName));

  // 产物必须逐行含有源码内容：被替换模式吃掉/改写的那一行会在这里暴露。
  const rewritten = [];
  for (const { module, code: stripped } of strippedList) {
    for (const line of stripped.split("\n")) {
      const t = line.trim();
      if (t.length === 0 || /^[/*]/.test(t) || t.startsWith("//")) continue;
      if (!code.includes(t)) rewritten.push(module + ": " + t);
    }
  }
  if (rewritten.length > 0) {
    throw new Error(
      "[build] 产物里缺少（或被改写）源码内容：\n  " + rewritten.slice(0, 8).join("\n  ") +
      "\n[build] 内联替换用的是函数形式，出现这种情况说明拼接把某些字符当成了替换模式。"
    );
  }
  return { code, pkgName, bytes: code.length };
}

/** 被 `node scripts/build.mjs` 直接执行时才写盘（被 import 时只导出函数）。 */
const isCli = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  try {
    const { code, pkgName, bytes } = buildBundle();
    mkdirSync(join(ROOT, "lib"), { recursive: true });
    writeFileSync(join(ROOT, "lib", "client.js"), code, "utf8");
    console.log(`[build] lib/client.js written (${bytes} bytes, ${EXPORTS.length} exports, id "${pkgName}").`);
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    for (const line of text.split("\n")) console.error(line.startsWith("[build]") ? line : "[build] " + line);
    process.exit(1);
  }
}
