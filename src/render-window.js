/**
 * dsh-code-nav — 渲染窗口（纯函数，浏览器/node 通用）。
 *
 * 客户端为了控制 DOM 规模，只把文件的前 RENDER_MAX_LINES 行渲染成行容器。
 * 搜索与大纲若基于**完整内容**计算，就会出现「找得到、数得到，却跳不过去」的
 * 状态：`n/m` 把窗口外的匹配也算进去、符号列表里点窗口外的符号毫无反应
 * （jumpToLine 找不到对应的 [data-cn-line] 行）。故两者都必须按同一窗口裁剪。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** 单次渲染的行数上限（与客户端的行容器数量一致）。 */
export const RENDER_MAX_LINES = 20000;

/**
 * 实际会生成 DOM 行的行数：合法行号范围是 1..renderedLineCount(lineCount, max)。
 * @param {number} lineCount 文件总行数
 * @param {number} [maxLines] 行数上限，默认 RENDER_MAX_LINES
 * @returns {number}
 */
export function renderedLineCount(lineCount, maxLines) {
  const cap = typeof maxLines === "number" && maxLines > 0 ? maxLines : RENDER_MAX_LINES;
  if (!(lineCount > 0)) return 0;
  return Math.min(lineCount, cap);
}

/**
 * 该 1 基行号是否落在渲染窗口内（即能否被跳转 / 闪烁定位）。
 * @param {number} line 1 基行号
 * @param {number} renderedCount renderedLineCount 的结果
 * @returns {boolean}
 */
export function inRenderWindow(line, renderedCount) {
  return line >= 1 && line <= renderedCount;
}

/**
 * 把「带 1 基行号的对象」裁到渲染窗口内。
 * 搜索匹配与大纲符号都走这一个函数，二者的可跳转性与 DOM 行集合就不会漂移。
 * @template {{line:number}} T
 * @param {T[]} items
 * @param {number} renderedCount renderedLineCount 的结果
 * @returns {T[]} 仅含窗口内的项（原本就在窗口内时返回新数组，不改动入参）
 */
export function clipToRenderWindow(items, renderedCount) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (inRenderWindow(item.line, renderedCount)) out.push(item);
  }
  return out;
}

/**
 * 裁到渲染窗口，并且把 0 基行号转成 1 基后再判定（搜索匹配用）。
 * @template {{line:number}} T
 * @param {T[]} items
 * @param {number} renderedCount
 * @returns {T[]}
 */
export function clipZeroBasedToRenderWindow(items, renderedCount) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (inRenderWindow(item.line + 1, renderedCount)) out.push(item);
  }
  return out;
}
