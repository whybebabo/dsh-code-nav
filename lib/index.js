/**
 * @whybebabo/dsh-code-nav — host half（占位插件）。
 *
 * fork 自 AnakinCao/dsh-code-nav，差异见 README 的 fork 说明。
 *
 * 本插件是纯浏览器端扩展：所有逻辑在 lib/client.js，通过
 * dsh-better-sidebar 暴露的 ctx.betterSidebar 服务注册一个代码文件预览器
 * （语法高亮 + 符号大纲 + 文件内查找 + 选中文字添加到对话）。
 *
 * 宿主侧只需要一个能正常 import 的空插件，让 loader entry 挂载成功
 * （client-modules 依据 entry.name 注册并下发客户端 bundle）。
 *
 * 这里的 `name` 只是 cordis 的插件标签，与包名无关；module table 的 key 取自
 * loader entry 的 name（完整包名），由 lib/client.js 的注册 id 对齐。
 *
 * @module dsh-code-nav
 */

export const name = "dsh-code-nav";
export const inject = [];
export function apply() {}
