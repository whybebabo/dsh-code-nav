/**
 * dsh-code-nav — 文件内查找匹配（纯函数，浏览器/node 通用）。
 *
 * findMatches 返回按位置排序的匹配数组（0 基 line/col，含 start/end 绝对偏移）。
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** 单次查找返回的匹配上限（界面据此提示「还有更多」，避免看起来只有 2000 处）。 */
export const MAX_MATCHES = 2000;

/** 在不改变数组内容 / deepEqual 结果的前提下标记确实存在第 N+1 条匹配。 */
function markSearchCapped(items) {
  if (items.capped !== true) Object.defineProperty(items, "capped", { value: true, enumerable: false });
  return items;
}

/**
 * 转义正则元字符，让查询串按字面量匹配。
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在文本中查找 query 的全部出现位置。
 *
 * 匹配走正则而不是「小写化后再 indexOf」：`toLowerCase()` 对个别字符会**改变码元数**
 * （`İ` U+0130 → `i` + 组合上的一点），于是小写串里的下标不再等于原文下标 ——
 * 按它切高亮区间会串位，按它回查原文又会把 İ 之后的普通匹配整片丢掉。正则直接在原文
 * 上匹配，start/end 天然就是原文坐标；代价是个别大小写折叠对（İ/i）不再互相命中，
 * 这是可接受的保守取舍。
 * @param {string} text
 * @param {string} query 空串返回 []
 * @param {{ caseSensitive?: boolean }} opts
 * @returns {Array<{start:number, end:number, line:number, col:number}>}
 */
export function findMatches(text, query, opts = {}) {
  if (typeof text !== "string" || typeof query !== "string" || query.length === 0) return [];
  const re = new RegExp(escapeRegExp(query), opts.caseSensitive === true ? "g" : "gi");
  const out = [];
  let line = 0;
  let lineStart = 0;
  let m;
  while (out.length < MAX_MATCHES && (m = re.exec(text)) !== null) {
    const at = m.index;
    // 计算 at 所在行（增量扫描）
    while (lineStart <= at) {
      const nl = text.indexOf("\n", lineStart);
      if (nl === -1 || nl >= at) break;
      line++;
      lineStart = nl + 1;
    }
    out.push({ start: at, end: at + m[0].length, line, col: at - lineStart });
    // 查询串非空且已全部转义成字面量，匹配长度必然 >= 1；这里只是防止 lastIndex 卡住。
    if (re.lastIndex === at) re.lastIndex = at + 1;
  }
  // 循环在达到上限时停在最后一条匹配之后；只额外探测一条，区分「恰好 N 条」
  // 与「至少 N+1 条」，避免界面把恰好达到上限的结果误报成还有更多。
  if (out.length === MAX_MATCHES && re.exec(text) !== null) markSearchCapped(out);
  return out;
}

/**
 * 把一行文本按 token 边界与匹配区间切成渲染 span。
 * @param {string} lineText 原始行文本
 * @param {Array<{text:string, cls:string}>} segs 该行 token
 * @param {Array<{start:number, col:number, end:number}>} lineMatches 该行匹配（相对行首）
 * @param {number} currentIndex 当前匹配在该行匹配中的序号（-1 表示不在本行）
 * @returns {Array<{text:string, cls:string, match?:boolean, current?:boolean}>}
 */
export function spansOfLine(lineText, segs, lineMatches, currentIndex) {
  if (lineMatches.length === 0) {
    return segs.length > 0 ? segs : (lineText.length > 0 ? [{ text: lineText, cls: "" }] : []);
  }
  // 合并边界点
  const cuts = new Set([0, lineText.length]);
  let pos = 0;
  for (const s of segs) {
    pos += s.text.length;
    cuts.add(pos);
  }
  for (const m of lineMatches) {
    cuts.add(m.col);
    cuts.add(m.end);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const spans = [];
  // segs 索引推进
  let si = 0;
  let segPos = 0;
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (a >= b) continue;
    // 找该区间命中的 token 类别
    while (si < segs.length && segPos + segs[si].text.length <= a) {
      segPos += segs[si].text.length;
      si++;
    }
    let cls = "";
    if (si < segs.length) cls = segs[si].cls;
    const text = lineText.slice(a, b);
    if (text.length === 0) continue;
    const matchIdx = lineMatches.findIndex((m) => m.col <= a && m.end >= b);
    const span = { text, cls };
    if (matchIdx !== -1) {
      span.match = true;
      if (matchIdx === currentIndex) span.current = true;
    }
    spans.push(span);
  }
  return spans;
}
