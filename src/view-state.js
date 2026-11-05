/**
 * dsh-code-nav — 预览器 UI 的派生状态（纯函数，浏览器 / node 通用）。
 *
 * 这些判断原本散在 `scripts/client.template.js` 的组件里，浏览器单测够不着；
 * 抽到这里后既能在 CI 里逐条断言语义，也让模板只负责把「宿主给的信号」翻译成
 * 参数。四个函数都不得访问 DOM / window：调用方负责采集信号。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/**
 * 解析 `getComputedStyle` 实际会返回的颜色写法，得到 RGBA 四元组。
 * 支持 `rgb()/rgba()`（逗号与空格语法、可带 `/ alpha`、百分号 alpha）、
 * `#rgb/#rgba/#rrggbb/#rrggbbaa` 与关键字 `transparent`。
 * 命名色、`color()`、`oklch()` 等无法可靠换算的格式返回 null。
 * @param {unknown} value
 * @returns {[number, number, number, number] | null} [r, g, b, alpha(0..1)]
 */
function parseCssColor(value) {
	if (typeof value !== "string") return null;
	const text = value.trim().toLowerCase();
	if (text === "") return null;
	if (text === "transparent") return [0, 0, 0, 0];
	const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)$/.exec(text);
	if (fn !== null) {
		const alphaRaw = fn[4];
		let alpha = 1;
		if (alphaRaw !== undefined) {
			const n = Number(alphaRaw);
			alpha = Number.isFinite(n) ? (fn[5] === "%" ? n / 100 : n) : 1;
		}
		return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Math.max(0, Math.min(1, alpha))];
	}
	const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
	if (hex === null) return null;
	const digits = hex[1];
	if (digits.length === 3 || digits.length === 4) {
		const r = parseInt(digits[0] + digits[0], 16);
		const g = parseInt(digits[1] + digits[1], 16);
		const b = parseInt(digits[2] + digits[2], 16);
		const a = digits.length === 4 ? parseInt(digits[3] + digits[3], 16) / 255 : 1;
		return [r, g, b, a];
	}
	if (digits.length === 6 || digits.length === 8) {
		const r = parseInt(digits.slice(0, 2), 16);
		const g = parseInt(digits.slice(2, 4), 16);
		const b = parseInt(digits.slice(4, 6), 16);
		const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
		return [r, g, b, a];
	}
	return null;
}

/**
 * 判定宿主当前的配色是否为深色。
 *
 * 优先采用宿主 ThemePresenter 的权威规则（见 dsh-client-ui-layout/theme.ts）：
 * `html { color-scheme }` 一旦被写出，深浅就由 `body[data-ds-dark-theme]`
 * 决定，**不再**回看系统偏好（用户显式选了浅色时系统偏好是干扰项）。
 * Presenter 尚未运行时退回 `prefers-color-scheme`；两者都不可用才看背景色。
 * 背景色透明（alpha = 0）说明颜色画在祖先元素上、这里的信息不足 —— 按浅色处理，
 * 绝不能把 `rgba(0,0,0,0)` 当成黑色。
 * @param {{ colorScheme?: unknown, bodyDark?: unknown, prefersDark?: unknown, background?: unknown }} [signals]
 * @returns {boolean}
 */
export function themeIsDark(signals = {}) {
	const colorScheme = signals.colorScheme;
	// 宿主只写 "light" | "dark"；任何非空值都代表「已经决定」。
	if (typeof colorScheme === "string" && colorScheme.trim() !== "") return signals.bodyDark === true;
	if (typeof signals.prefersDark === "boolean") return signals.prefersDark;
	const rgba = parseCssColor(signals.background);
	if (rgba === null || rgba[3] === 0) return false;
	const lum = (0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2]) / 255;
	return lum < 0.5;
}

/**
 * 把一次行跳转请求换算成可执行的行区间。
 *
 * `renderedCount` 是真正生成了 `[data-cn-line]` 行容器的行数（渲染窗口）。请求行
 * 落在窗口之外时 `inWindow=false`：调用方只能提示，不能 clamp 到窗口末尾去闪一行
 * 用户没请求的代码，也不能对宿主说「这一跳已落地」。
 *
 * 窗口内行为保持原样：`lineEnd` 缺省等于 `line`，起点不小于 1、终点不越过窗口且
 * 不小于起点（向下的反向区间也会被拉正）。
 * @param {unknown} line 1 基请求行号
 * @param {unknown} lineEnd 1 基区间末行（可缺省）
 * @param {unknown} renderedCount 已渲染行数
 * @returns {{requestedLine:number, renderedCount:number, inWindow:boolean, outOfWindow:boolean, start:number, end:number}}
 */
export function lineWindowState(line, lineEnd, renderedCount) {
	const requested = typeof line === "number" && Number.isFinite(line) ? Math.floor(line) : 0;
	const rendered = typeof renderedCount === "number" && Number.isFinite(renderedCount) && renderedCount > 0
		? Math.floor(renderedCount)
		: 0;
	if (requested < 1) {
		return { requestedLine: requested, renderedCount: rendered, inWindow: false, outOfWindow: false, start: 0, end: 0 };
	}
	if (rendered === 0 || requested > rendered) {
		return { requestedLine: requested, renderedCount: rendered, inWindow: false, outOfWindow: true, start: 0, end: 0 };
	}
	const endRequested = typeof lineEnd === "number" && Number.isFinite(lineEnd) ? Math.floor(lineEnd) : requested;
	const start = Math.max(1, requested);
	const end = Math.max(start, Math.min(endRequested, rendered));
	return { requestedLine: requested, renderedCount: rendered, inWindow: true, outOfWindow: false, start, end };
}

/**
 * 查找计数在「被渲染窗口裁剪」之后该怎么显示。
 *
 * `findMatches` 的上限（MAX_MATCHES）与渲染窗口是两个不同的裁剪：前者限制总数，
 * 后者决定**能跳过去**的条数。旧界面把分母固定成 `MAX_MATCHES +`，于是窗口内只有
 * 100 条可导航匹配时仍显示 `1/2000+`；全部匹配都在窗口外时甚至显示「无匹配」。
 *
 * 返回语义：
 * - `empty`：搜索没有命中（空查询也走这里，由调用方区别对待）；
 * - `outsideOnly`：命中了，但全部在渲染窗口之外 —— 不能说「无匹配」；
 * - `countOutside`：窗口内有可导航匹配，窗口外还有（命中上限被裁掉）—— 计数用
 *   可导航条数，另给一条「窗口外还有」提示；
 * - `countCapped`：可导航条数正好顶到 MAX_MATCHES，分母保留 `+`（确实可能还有更多）；
 * - `count`：普通情况，分母就是可导航条数。
 * @param {unknown} matchesLength 裁剪后（可导航）的匹配数
 * @param {unknown} capped 裁剪**前** findMatches 是否探测到第 N+1 条
 * @param {unknown} maxMatches MAX_MATCHES
 * @returns {{kind:"empty"|"outsideOnly"|"countOutside"|"countCapped"|"count", total:number, capped:boolean, outside:boolean}}
 */
export function matchWindowState(matchesLength, capped, maxMatches) {
	const total = typeof matchesLength === "number" && Number.isFinite(matchesLength) && matchesLength > 0
		? Math.floor(matchesLength)
		: 0;
	const cap = typeof maxMatches === "number" && Number.isFinite(maxMatches) && maxMatches > 0
		? Math.floor(maxMatches)
		: 0;
	const cappedFlag = capped === true && cap > 0;
	if (total === 0) {
		return { kind: cappedFlag ? "outsideOnly" : "empty", total: 0, capped: cappedFlag, outside: cappedFlag };
	}
	if (cappedFlag && total < cap) {
		return { kind: "countOutside", total, capped: true, outside: true };
	}
	if (cappedFlag && total >= cap) {
		return { kind: "countCapped", total, capped: true, outside: false };
	}
	return { kind: "count", total, capped: false, outside: false };
}

/**
 * 符号下拉为空时该说哪句话：大纲本身空 / 当前筛选没有命中 / 符号全在渲染窗口外。
 *
 * 第三个参数是「按渲染窗口裁剪后、按筛选裁剪前」的条数（客户端里是
 * `symbols.list.length`）。旧实现拿裁剪前的 `hasSymbols` 与裁剪后的
 * `filtered.length` 两个不同基数比较：文件超过 RENDER_MAX_LINES 且所有符号
 * 都在窗口外时 `hasSymbols=true, filtered=0` 会被判成 "filtered"（用户根本
 * 没有筛选，改筛选也没用）。传入窗口内条数后，0 条才区分成 "window"。
 * 不传（undefined / 非数字）时保持旧语义，兼容既有调用与测试。
 * @param {unknown} hasSymbols 大纲是否有符号（未按筛选 / 窗口裁剪）
 * @param {unknown} filteredLength 筛选后的条数
 * @param {unknown} [inWindowLength] 渲染窗口内、筛选前的符号条数
 * @returns {"ok"|"filtered"|"window"|"none"}
 */
export function symbolsEmptyKind(hasSymbols, filteredLength, inWindowLength) {
	const filtered = typeof filteredLength === "number" && Number.isFinite(filteredLength) ? filteredLength : 0;
	if (filtered > 0) return "ok";
	if (hasSymbols !== true) return "none";
	const inWindow = typeof inWindowLength === "number" && Number.isFinite(inWindowLength) ? inWindowLength : -1;
	return inWindow === 0 ? "window" : "filtered";
}
