/**
 * dsh-code-nav — 文件内查找匹配（纯函数，浏览器/node 通用）。
 *
 * findMatches 返回按位置排序的匹配数组（0 基 line/col，含 start/end 绝对偏移）。
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** 单次查找返回的匹配上限（界面据此提示「还有更多」，避免看起来只有 2000 处）。 */
export const MAX_MATCHES = 2000;

/**
 * 分页态「后台全文扫描」的字节预算。
 *
 * >5 MB 的文件宿主只给 `{ size, largeFile }`，客户端没有正文；要让查找覆盖
 * 未滚动加载的行，只能按页读（`fs.readPage`，128 KiB / 页）。整份超大文件全扫
 * 会变成几百次宿主读取，所以设一个预算：扫到预算就停，界面明确说「只扫描了前
 * N MB」。64 MB ≈ 512 页，在本地主机上是秒级。
 */
export const SCAN_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 增量扫描的累加器：把一页的命中（行号相对该页、0 基）平移到文件全局行号后
 * 接进 `collected`；达到 `max` 条即停并标记 capped（还有没收集进来的命中）。
 *
 * 页是按整行对齐的（`fs.readPage` 的契约），所以「上一页累计行数」就是下一页
 * 的行号偏移，不需要按字节反推行号。
 *
 * @param {Array<{start:number,end:number,line:number,col:number}>} collected 已收集的命中
 * @param {Array<{start:number,end:number,line:number,col:number}>} pageMatches 本页命中（页内 0 基行号）
 * @param {number} lineOffset 本页首行在文件里的 0 基行号
 * @param {number} [max] 命中上限（默认 {@link MAX_MATCHES}）
 * @returns {{matches:Array<{start:number,end:number,line:number,col:number}>, capped:boolean}}
 */
export function appendScannedMatches(collected, pageMatches, lineOffset, max = MAX_MATCHES) {
	const base = Array.isArray(collected) ? collected : [];
	const offset = typeof lineOffset === "number" && Number.isFinite(lineOffset) ? Math.max(0, Math.floor(lineOffset)) : 0;
	const limit = typeof max === "number" && Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_MATCHES;
	const out = base.slice();
	let capped = false;
	const page = Array.isArray(pageMatches) ? pageMatches : [];
	for (const m of page) {
		if (out.length >= limit) { capped = true; break; }
		out.push({ start: m.start, end: m.end, line: m.line + offset, col: m.col });
	}
	// findMatches 在页内就探测到「还有第 N+1 条」时也要把 capped 传上去
	if (pageMatches !== null && pageMatches !== undefined && pageMatches.capped === true) capped = true;
	return { matches: out, capped };
}

/**
 * 全文扫描进度：百分比以「实际会扫描的字节数」为分母（总大小与预算取小），
 * `capped` 表示预算先到、文件还没扫完。
 * @param {unknown} scannedBytes 已扫描字节
 * @param {unknown} totalBytes 文件总字节（未知时传 undefined）
 * @param {number} [maxBytes] 扫描预算（默认 {@link SCAN_MAX_BYTES}）
 * @returns {{percent:number|null, capped:boolean, limitBytes:number}}
 */
export function scanProgress(scannedBytes, totalBytes, maxBytes = SCAN_MAX_BYTES) {
	const max = typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : SCAN_MAX_BYTES;
	const scanned = typeof scannedBytes === "number" && Number.isFinite(scannedBytes) && scannedBytes > 0
		? Math.min(scannedBytes, max)
		: 0;
	const total = typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
	const limitBytes = total === 0 ? max : Math.min(total, max);
	const capped = total === 0 ? scanned >= max : total > max && scanned >= max;
	const percent = limitBytes > 0 ? Math.max(0, Math.min(100, Math.round((scanned / limitBytes) * 100))) : 0;
	return { percent, capped, limitBytes };
}

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
