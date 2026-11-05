/**
 * dsh-code-nav — 「选中文字 → 添加到对话」的插入载荷（纯函数，浏览器/node 通用）。
 *
 * 载荷形状与 dsh-better-sidebar 内置查看器（markdown 预览 / CodeMirror 编辑器）
 * 完全一致，两条入口粘出来的草稿文本无差别：
 *  - 选区 ≤ SELECTION_LIMIT 个字符：围栏代码块，信息行为 `相对路径:起止行`，
 *    正文为选中文本；
 *  - 超过上限：只留一行纯文本 `相对路径:起止行`（不带围栏、不带正文）；
 *  - 路径相对会话 cwd（与资源管理器的 @ 按钮同一投影），cwd 未知时用绝对路径；
 *  - 行号：单行写 `path:12`，多行写 `path:12-15`，行号不可得时只写路径。
 *
 * 除围栏块本身，这里还给出草稿里那枚引用 chip 的两半：`where` 是可见标签
 * （`文件名 L12-15`），`header` 是剪贴板 / 持久化投影（`相对路径:12-15`）。
 * 发送时 codec 展开回 `text`，与 better-sidebar 的 quote chip 同形。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** 插入草稿的选区长度上限（UTF-16 码元，即 JS `.length`）。 */
export const SELECTION_LIMIT = 500;

/**
 * 会话 cwd 下的相对路径（与 better-sidebar 的 paths.relativeTo 同一语义）。
 * @param {string} cwd 会话工作目录（绝对路径）
 * @param {string} path 文件绝对路径
 * @returns {string} 以 `/` 分隔的相对路径；不在 cwd 内时原样返回
 */
function relativeTo(cwd, path) {
  const base = cwd.replace(/[\\/]+$/, "");
  const norm = (value) => value.replace(/\\/g, "/");
  const nBase = norm(base);
  const nPath = norm(path);
  if (nPath === nBase) return ".";
  // 前缀比较不区分大小写：Windows 盘符大小写可能与 cwd 行不一致，
  // 但返回的相对文本保留调用方自己的大小写。
  if (nPath.toLowerCase().startsWith(nBase.toLowerCase() + "/")) return nPath.slice(nBase.length + 1);
  return path;
}

/**
 * 围栏信息行：`相对路径[:起始行[-结束行]]`；行号不可得时省略整个行号段。
 * @param {string} path
 * @param {string|undefined} cwd
 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
 * @returns {string}
 */
export function selectionHeader(path, cwd, lines) {
  const rel = typeof cwd === "string" && cwd.length > 0 ? relativeTo(cwd, path) : path;
  if (lines === undefined || lines === null) return rel;
  if (lines.end > lines.start) return rel + ":" + lines.start + "-" + lines.end;
  return rel + ":" + lines.start;
}

/**
 * 引用 chip 的显示文字：`文件名 L起[-止]`（与 dsh-better-sidebar 的
 * `引用 {where}` 同一身份；行号不可得时只写文件名）。
 * @param {string} path 文件绝对路径
 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
 * @returns {string}
 */
export function selectionWhere(path, lines) {
  const parts = path.replace(/\\/g, "/").split("/");
  const file = parts.length > 0 && parts[parts.length - 1] !== "" ? parts[parts.length - 1] : path;
  if (lines === undefined || lines === null) return file;
  if (lines.end > lines.start) return file + " L" + lines.start + "-" + lines.end;
  return file + " L" + lines.start;
}

/**
 * 一次选区的结构化载荷。
 *  - `header`：围栏信息行 / chip 的剪贴板投影（`相对路径:起止行`）；
 *  - `where`：chip 的显示文字（`文件名 L起止`）；
 *  - `text`：模型最终收到的文本（围栏块；超过上限只留 header）。
 * @param {string} path 文件绝对路径
 * @param {string|undefined} cwd 会话工作目录
 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
 * @param {string} selected 选中文本
 * @returns {{header:string, where:string, text:string}}
 */
export function selectionPayload(path, cwd, lines, selected) {
  const header = selectionHeader(path, cwd, lines);
  const where = selectionWhere(path, lines);
  if (selected.length > SELECTION_LIMIT) return { header, where, text: header };
  return { header, where, text: "```" + header + "\n" + selected + "\n```" };
}

/**
 * 一次选区的完整插入文本（纯文本回退路径的载荷）。
 * @param {string} path 文件绝对路径
 * @param {string|undefined} cwd 会话工作目录
 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
 * @param {string} selected 选中文本
 * @returns {string}
 */
export function buildSelectionInsert(path, cwd, lines, selected) {
  return selectionPayload(path, cwd, lines, selected).text;
}
