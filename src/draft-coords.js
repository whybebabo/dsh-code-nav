/**
 * 会话草稿的两个投影之间的纯换算（浏览器 / node 通用）。
 *
 * 宿主同时维护两套坐标：
 *  - **clipboard 投影**（`InputState.draft`、`occurrences`）：每个引用 chip
 *    展开成它的 `clipboardText`；
 *  - **detect 投影**：同一个 chip 折成 1 个占位字符（U+FFFC），
 *    `captureInsertion()` / `insertReference()` 的 span 都在这套坐标里。
 *
 * 插件只拿到 clipboard 投影的草稿，却要在 detect 坐标的插入点前判断「要不要
 * 补分隔空格」——直接拿 `draft.slice(0, span.start)` 比较会在草稿里已有 chip
 * 时错位。这里给出唯一的折叠实现。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** detect 投影里一个引用 chip 占的单个字符（与宿主内部一致）。 */
export const CHIP_PLACEHOLDER = "\uFFFC";

/**
 * 把 clipboard 投影的草稿折叠成 detect 投影。
 * `occurrences` 按宿主契约以 offset 升序排列、互不重叠；越界 / 倒序 / 长度非正的
 * 条目一律跳过（宁可不折叠，也不造出负索引的乱序文本）。
 * @param {string} draft clipboard 投影草稿
 * @param {ReadonlyArray<{offset:number, length:number}>|undefined} occurrences
 * @returns {string}
 */
export function detectTextOf(draft, occurrences) {
  if (typeof draft !== "string" || draft.length === 0) return "";
  const list = Array.isArray(occurrences) ? occurrences : [];
  let out = "";
  let cursor = 0;
  for (const occurrence of list) {
    if (occurrence === null || occurrence === undefined) continue;
    const offset = Number(occurrence.offset);
    const length = Number(occurrence.length);
    if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) continue;
    if (offset < cursor || offset > draft.length) continue;
    out += draft.slice(cursor, offset) + CHIP_PLACEHOLDER;
    cursor = Math.min(offset + length, draft.length);
  }
  out += draft.slice(cursor);
  return out;
}

/**
 * 草稿里是否可能存在宿主**没告诉我们**的 quote 节点。
 *
 * 宿主 `InputState` 目前不暴露 `quotes`（`DetectProjection.quotes` 只在内部
 * 投影里出现），而 quote 在 clipboard 投影里的形状是 `formatQuoteText`
 * —— 每行加 `> ` 前缀（`ui-primitives/src/markdown/quote-text.ts`）。于是
 * 每个 quote 的 clipboard 投影必有一行以 `> ` 开头：看到这种行就说明草稿里
 * 可能有未计入 `occurrences` 的原子节点，此时按 `occurrences` 折叠出的 detect
 * 投影**不可信**（会多出 quote 正文的长度）。
 *
 * 保守起见宁可误报：用户手打的 Markdown 引用也会命中，代价只是多一个空格。
 * @param {string} draft clipboard 投影草稿
 * @returns {boolean}
 */
export function hasQuoteMarkers(draft) {
  if (typeof draft !== "string" || draft.length === 0) return false;
  return /^> /m.test(draft);
}

/**
 * 在 detect 坐标的 `start` 处插入内容前，左侧是否需要一个分隔空格：
 * 草稿非空、插入点不在开头、且前一个字符不是空白。
 * @param {string} detectText detect 投影草稿
 * @param {number} start 插入点（0 起）
 * @returns {boolean}
 */
export function needsLeadingSpace(detectText, start) {
  if (typeof detectText !== "string" || detectText.length === 0) return false;
  if (typeof start !== "number" || !Number.isFinite(start) || start <= 0) return false;
  const at = Math.min(Math.max(Math.floor(start), 0), detectText.length);
  if (at === 0) return false;
  return !/\s/u.test(detectText.slice(at - 1, at));
}
