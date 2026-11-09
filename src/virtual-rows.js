/**
 * dsh-code-nav — 可视行窗口（纯函数，浏览器/node 通用）。
 *
 * 分块把「读文件」的代价摊到了滚动上，但如果每次把**已加载的行全部挂进 DOM**，
 * 宿主每次整页样式重算仍要为这些行买单：实测 8,148 行的 C++ 文件会让桌面端
 * 一帧样式重算多花 ~10 秒（16,301 行 / 168,545 个元素 × 宿主上百张样式表），
 * 表现就是「打开大文件直接卡死」。所以渲染也要窗口化：
 *
 * - DOM 里只保留视口附近（上下各 OVERSCAN_ROWS 行）的行；
 * - 视口之外的行用 `.cn-code` 的上下 padding 撑出同样的高度，滚动条长度、
 *   `scrollHeight`、跳转定位都与「全部渲染」一致；
 * - 行高固定（CSS `.cn-root` line-height:20px，行容器不换行），所以偏移可以直接
 *   用行号 × 行高算出来，不需要测量每一行。
 *
 * 与 `file-chunks.js` 的分工：那边决定「加载到内存的行」，这边决定「挂进 DOM 的行」。
 * 查找到的行、大纲符号仍按已加载行裁剪（render-window.js 的 renderedCount），
 * 只是不在视口里的行不生成元素。
 */

/** 一行的高度（px）。必须与 CSS 的 line-height / .cn-line 实际高度一致。 */
export const ROW_HEIGHT = 20;

/** 视口上下各多渲染的行数：滚动时先看到的内容不会闪白。 */
export const OVERSCAN_ROWS = 24;

/** 还没量到滚动区高度时（首帧、无布局环境）的估计视口高度。 */
export const NOMINAL_VIEW_HEIGHT = 600;

/**
 * 由滚动位置算出要渲染的行区间与上下占位高度。
 *
 * 返回的 `topPad` / `bottomPad` 是「未渲染行 × 行高」，调用方把它们加到
 * 代码容器的上下 padding 上，滚动高度就与全量渲染时一致：
 * `topPad + (end - start) * ROW_HEIGHT + bottomPad === totalRows * ROW_HEIGHT`。
 *
 * @param {number} scrollTop 滚动容器的 scrollTop（px）
 * @param {number} viewHeight 滚动容器的 clientHeight（px）
 * @param {number} totalRows 已加载的行数（既是滚动高度基准，也是行号上限）
 * @param {number} [rowHeight] 行高（默认 {@link ROW_HEIGHT}）
 * @param {number} [overscan] 上下各多渲染的行数（默认 {@link OVERSCAN_ROWS}）
 * @returns {{start:number, end:number, topPad:number, bottomPad:number}}
 *   `start` 含、`end` 不含（0 基行下标）。
 */
export function rowWindow(scrollTop, viewHeight, totalRows, rowHeight = ROW_HEIGHT, overscan = OVERSCAN_ROWS) {
	const total = typeof totalRows === "number" && Number.isFinite(totalRows) && totalRows > 0
		? Math.floor(totalRows)
		: 0;
	if (total === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
	const row = typeof rowHeight === "number" && Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : ROW_HEIGHT;
	const view = typeof viewHeight === "number" && Number.isFinite(viewHeight) && viewHeight > 0
		? viewHeight
		: NOMINAL_VIEW_HEIGHT;
	const top = typeof scrollTop === "number" && Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
	const over = typeof overscan === "number" && Number.isFinite(overscan) && overscan >= 0
		? Math.floor(overscan)
		: OVERSCAN_ROWS;
	const firstVisible = Math.floor(top / row);
	// +1：视口底边压在两行之间时，两行都算可见。
	const span = Math.ceil(view / row) + 1;
	const start = Math.max(0, Math.min(total - 1, firstVisible - over));
	const end = Math.max(start, Math.min(total, firstVisible + span + over));
	return { start: start, end: end, topPad: start * row, bottomPad: (total - end) * row };
}

/**
 * 把 1 基行号换算成「该行居中」的 scrollTop。
 *
 * 跳转（引用 chip 落地、大纲、搜索结果）用它代替 `scrollIntoView()`：
 * 窗口化后目标行可能还没有 DOM 元素，元素查询会扑空；按行号算出的位置是
 * 确定性的，滚动后下一帧目标行就在窗口里。
 *
 * @param {number} lineNo 1 基行号
 * @param {number} viewHeight 滚动容器的 clientHeight（px）
 * @param {number} [rowHeight] 行高（默认 {@link ROW_HEIGHT}）
 * @returns {number} 建议的 scrollTop（已 clamp 到 >= 0）
 */
export function rowScrollTop(lineNo, viewHeight, rowHeight = ROW_HEIGHT) {
	const row = typeof rowHeight === "number" && Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : ROW_HEIGHT;
	const view = typeof viewHeight === "number" && Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : 0;
	const line = typeof lineNo === "number" && Number.isFinite(lineNo) && lineNo >= 1 ? Math.floor(lineNo) : 1;
	const target = (line - 1) * row - Math.max(0, (view - row) / 2);
	return target > 0 ? target : 0;
}
