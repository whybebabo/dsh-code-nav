/**
 * dsh-code-nav — 预览器 UI 派生状态单测（src/view-state.js）。
 *
 * 覆盖三个曾出过真实缺陷的边界：
 *  - 深色判定：宿主 `html.color-scheme` 权威 vs 系统偏好 vs 透明背景（不能被当黑）；
 *  - 行跳转窗口：窗口外必须标记出来，不能 clamp 后假装落地；
 *  - 查找计数：可导航条数 vs MAX_MATCHES / 渲染窗口的两个裁剪口径。
 * 以及筛选空大纲的文案选择。零依赖，`node --test` 直接跑。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
	capControls,
	matchWindowState,
	scanStopState,
	symbolsEmptyKind,
	themeIsDark,
	lineWindowState
} from "../src/view-state.js";
import { clipToRenderWindow, lineIsPlain, PLAIN_LINE_MAX_CHARS, PLAIN_LINE_MAX_SEGS } from "../src/render-window.js";

// ---------- themeIsDark ----------

test("theme: host color-scheme wins over the OS preference", () => {
	assert.equal(themeIsDark({ colorScheme: "dark", bodyDark: true, prefersDark: false }), true);
	assert.equal(themeIsDark({ colorScheme: "light", bodyDark: false, prefersDark: true }), false);
	// 用户选了浅色、系统是深色：以宿主的 color-scheme 为准
	assert.equal(themeIsDark({ colorScheme: "light", bodyDark: false, prefersDark: true, background: "rgb(0, 0, 0)" }), false);
});

test("theme: an empty color-scheme means the presenter has not run yet", () => {
	assert.equal(themeIsDark({ colorScheme: "", bodyDark: true, prefersDark: false }), false);
	assert.equal(themeIsDark({ colorScheme: "   ", bodyDark: false, prefersDark: true }), true);
	assert.equal(themeIsDark({ prefersDark: true }), true);
	assert.equal(themeIsDark({ prefersDark: false }), false);
});

test("theme: background fallback classifies light and dark", () => {
	assert.equal(themeIsDark({ background: "rgb(247, 248, 250)" }), false);
	assert.equal(themeIsDark({ background: "rgb(15, 17, 21)" }), true);
	assert.equal(themeIsDark({ background: "#ffffff" }), false);
	assert.equal(themeIsDark({ background: "#000000" }), true);
	assert.equal(themeIsDark({ background: "rgba(15, 17, 21, 0.9)" }), true);
});

test("theme: a transparent background is unknown, never dark", () => {
	// 浏览器把 transparent 算成 rgba(0,0,0,0)：旧实现按 RGB 取黑 → 浅色皮肤被判成深色
	assert.equal(themeIsDark({ background: "rgba(0, 0, 0, 0)" }), false);
	assert.equal(themeIsDark({ background: "transparent" }), false);
	assert.equal(themeIsDark({ background: "#00000000" }), false);
	assert.equal(themeIsDark({ background: "rgb(0 0 0 / 0%)" }), false);
});

test("theme: unparseable / missing backgrounds fall back to light", () => {
	assert.equal(themeIsDark({}), false);
	assert.equal(themeIsDark({ background: "" }), false);
	assert.equal(themeIsDark({ background: "oklch(0.2 0.1 250)" }), false);
	assert.equal(themeIsDark({ background: 42 }), false);
});

test("theme: modern rgb space syntax and percent alpha", () => {
	assert.equal(themeIsDark({ background: "rgb(15 17 21)" }), true);
	assert.equal(themeIsDark({ background: "rgb(247 248 250 / 100%)" }), false);
	assert.equal(themeIsDark({ background: "#0f1115" }), true);
	assert.equal(themeIsDark({ background: "#0f1115ff" }), true);
});

// ---------- lineWindowState ----------

test("line window: an in-window single line lands as itself", () => {
	assert.deepEqual(lineWindowState(20, undefined, 100), {
		requestedLine: 20, renderedCount: 100, inWindow: true, outOfWindow: false, start: 20, end: 20
	});
});

test("line window: lineEnd is clamped into the window and never precedes start", () => {
	assert.deepEqual(lineWindowState(20, 30, 100), {
		requestedLine: 20, renderedCount: 100, inWindow: true, outOfWindow: false, start: 20, end: 30
	});
	// 末行越界 → 夹到窗口末尾（引用段落在窗口内仍应闪到可用范围）
	assert.equal(lineWindowState(20, 500, 100).end, 100);
	// 反向区间（lineEnd < line）拉正为单行
	assert.equal(lineWindowState(20, 3, 100).end, 20);
	// 非数字 lineEnd 当作单行
	assert.equal(lineWindowState(20, "30", 100).end, 20);
	assert.equal(lineWindowState(20, NaN, 100).end, 20);
});

test("line window: a request beyond renderedCount is reported, not clamped", () => {
	assert.deepEqual(lineWindowState(25000, 25010, 20000), {
		requestedLine: 25000, renderedCount: 20000, inWindow: false, outOfWindow: true, start: 0, end: 0
	});
	assert.equal(lineWindowState(20001, undefined, 20000).inWindow, false);
	// 窗口有内容、请求刚好多一行
	assert.equal(lineWindowState(20001, undefined, 20000).outOfWindow, true);
});

test("line window: boundary line renderedCount is still in the window", () => {
	assert.equal(lineWindowState(20000, undefined, 20000).inWindow, true);
	assert.equal(lineWindowState(1, undefined, 1).inWindow, true);
});

test("line window: nothing rendered (empty content) cannot land", () => {
	const state = lineWindowState(5, undefined, 0);
	assert.equal(state.inWindow, false);
	assert.equal(state.outOfWindow, true);
	assert.equal(state.start, 0);
	assert.equal(state.end, 0);
});

test("line window: an invalid request is not reported as out-of-window", () => {
	for (const line of [undefined, null, 0, -3, NaN, "12", Infinity]) {
		const state = lineWindowState(line, undefined, 100);
		assert.equal(state.inWindow, false, "inWindow for " + String(line));
		assert.equal(state.outOfWindow, false, "outOfWindow for " + String(line));
	}
});

test("line window: a missing/invalid renderedCount is treated as 0", () => {
	for (const rendered of [undefined, null, -1, NaN, Infinity, "100"]) {
		assert.equal(lineWindowState(5, undefined, rendered).outOfWindow, true);
	}
});

test("line window: floors fractional line numbers", () => {
	assert.equal(lineWindowState(20.9, 30.9, 100).start, 20);
	assert.equal(lineWindowState(20.9, 30.9, 100).end, 30);
	assert.equal(lineWindowState(99.9, 300, 100.5).end, 100);
});

// ---------- matchWindowState ----------

test("match window: empty search is just empty", () => {
	assert.deepEqual(matchWindowState(0, false, 2000), {
		kind: "empty", total: 0, capped: false, outside: false
	});
	assert.deepEqual(matchWindowState(0, undefined, 2000).kind, "empty");
});

test("match window: capped but everything navigable up to the cap keeps the plus", () => {
	assert.deepEqual(matchWindowState(2000, true, 2000), {
		kind: "countCapped", total: 2000, capped: true, outside: false
	});
});

test("match window: capped and clipped below the cap reports the outside window", () => {
	// 100 条在渲染窗口内、1900 条被窗口裁掉：旧界面显示 1/2000+
	assert.deepEqual(matchWindowState(100, true, 2000), {
		kind: "countOutside", total: 100, capped: true, outside: true
	});
});

test("match window: capped with zero navigable matches must not say 'no matches'", () => {
	assert.deepEqual(matchWindowState(0, true, 2000), {
		kind: "outsideOnly", total: 0, capped: true, outside: true
	});
});

test("match window: uncapped counts use the navigable length as the denominator", () => {
	assert.deepEqual(matchWindowState(7, false, 2000), {
		kind: "count", total: 7, capped: false, outside: false
	});
});

test("match window: invalid inputs degrade to empty/count without throwing", () => {
	assert.equal(matchWindowState(NaN, true, 2000).kind, "outsideOnly");
	assert.equal(matchWindowState(3, true, 0).kind, "count");
	assert.equal(matchWindowState(3, true, undefined).outside, false);
	assert.equal(matchWindowState(3.9, false, 2000).total, 3);
	assert.equal(matchWindowState(-2, false, 2000).kind, "empty");
});

// ---------- symbolsEmptyKind ----------

test("symbols empty kind: distinguishes an empty outline from an empty filter", () => {
	assert.equal(symbolsEmptyKind(false, 0), "none");
	assert.equal(symbolsEmptyKind(true, 0), "filtered");
	assert.equal(symbolsEmptyKind(true, 3), "ok");
	assert.equal(symbolsEmptyKind(false, 3), "ok");
});

test("symbols empty kind: invalid counts are treated as zero", () => {
	assert.equal(symbolsEmptyKind(false, NaN), "none");
	assert.equal(symbolsEmptyKind(true, undefined), "filtered");
	assert.equal(symbolsEmptyKind(true, -1), "filtered");
	assert.equal(symbolsEmptyKind(undefined, 0), "none");
});

test("symbols empty kind: symbols outside the render window are not a filter miss", () => {
	// 客户端第三参是「窗口内、筛选前」的条数（symbols.list.length）
	assert.equal(symbolsEmptyKind(true, 0, 0), "window");
	assert.equal(symbolsEmptyKind(true, 0, 5), "filtered");
	assert.equal(symbolsEmptyKind(true, 2, 5), "ok");
	assert.equal(symbolsEmptyKind(false, 0, 0), "none");
	assert.equal(symbolsEmptyKind(false, 0, 5), "none");
	// 缺省 / 非法第三参保持旧语义（向后兼容既有调用）
	assert.equal(symbolsEmptyKind(true, 0, undefined), "filtered");
	assert.equal(symbolsEmptyKind(true, 0, NaN), "filtered");
	assert.equal(symbolsEmptyKind(true, 0, Infinity), "filtered");
	assert.equal(symbolsEmptyKind(true, 0, -1), "filtered");
});

test("symbols empty kind: the client's clipped list length distinguishes window from filter", () => {
	// 复刻 client 的两个基数：hasSymbols 用裁剪前长度，filtered 用裁剪后长度，
	// 第三参用「窗口内、筛选前」的条数。>20000 行且符号全在窗口外时，
	// 旧调用（两参）会误报 "filtered"，三参必须给出 "window"。
	const renderedCount = 20000;
	const all = [
		{ kind: "function", name: "late", line: 20006 },
		{ kind: "function", name: "later", line: 30001 }
	];
	const list = clipToRenderWindow(all, renderedCount);
	assert.equal(list.length, 0, "两个符号都在渲染窗口外");
	const hasSymbols = all.length > 0;
	const filtered = list.length;
	assert.equal(symbolsEmptyKind(hasSymbols, filtered), "filtered", "两参旧语义会误报成筛选空");
	assert.equal(symbolsEmptyKind(hasSymbols, filtered, list.length), "window");

	// 窗口内还有符号、只是被筛选挡掉 → 仍然是 "filtered"
	const mixed = [...list, { kind: "class", name: "early", line: 3 }];
	assert.equal(symbolsEmptyKind(true, 0, mixed.length), "filtered");
	assert.equal(symbolsEmptyKind(true, 1, mixed.length), "ok");
});

// ---------- capControls（PREVIEW-3：上限在 EOF 处生效时不能把解除入口藏起来） ----------

test("cap controls: 50k+ loaded at EOF still offers the lift control", () => {
	// EOF 正好落在越过上限的那一块：loaded=50001 但只渲染 50000。
	// 旧实现 atCap = !atEnd && ... 在 atEnd 时把所有解除入口都藏了起来。
	const atEof = capControls({ tokensLength: 50001, renderedCount: 50000, lineCap: 50000, capLifted: false, atEnd: true, paging: true });
	assert.deepEqual(atEof, { hiddenLines: 1, showLift: true, showHeaderLoadAll: true, footerAtCap: true });
	// 内存态（≤5MB）同样会 overshoot：没有 header 按钮，但 footer 的解除入口必须在。
	const inMemory = capControls({ tokensLength: 100001, renderedCount: 50000, lineCap: 50000, capLifted: false, atEnd: true, paging: false });
	assert.deepEqual(inMemory, { hiddenLines: 50001, showLift: true, showHeaderLoadAll: false, footerAtCap: true });
});

test("cap controls: exactly at the cap mid-file keeps the lift control", () => {
	// renderedCount 顶到 lineCap、还有后续内容：没有「被挡住的行」，仍需解除入口。
	const midFile = capControls({ tokensLength: 50000, renderedCount: 50000, lineCap: 50000, capLifted: false, atEnd: false, paging: true });
	assert.deepEqual(midFile, { hiddenLines: 0, showLift: true, showHeaderLoadAll: true, footerAtCap: true });
	const midInMemory = capControls({ tokensLength: 50000, renderedCount: 50000, lineCap: 50000, capLifted: false, atEnd: false, paging: false });
	assert.deepEqual(midInMemory, { hiddenLines: 0, showLift: true, showHeaderLoadAll: false, footerAtCap: true });
});

test("cap controls: a normal small file shows no cap control at all", () => {
	const small = capControls({ tokensLength: 10, renderedCount: 10, lineCap: 50000, capLifted: false, atEnd: true, paging: false });
	assert.deepEqual(small, { hiddenLines: 0, showLift: false, showHeaderLoadAll: false, footerAtCap: false });
	// 分页小文件读完（atEnd）也不需要「全部加载」了
	const pagedDone = capControls({ tokensLength: 10, renderedCount: 10, lineCap: 50000, capLifted: false, atEnd: true, paging: true });
	assert.deepEqual(pagedDone, { hiddenLines: 0, showLift: false, showHeaderLoadAll: false, footerAtCap: false });
});

test("cap controls: after lifting the cap there is nothing left to lift", () => {
	const liftedAtEof = capControls({ tokensLength: 300000, renderedCount: 300000, lineCap: Number.MAX_SAFE_INTEGER, capLifted: true, atEnd: true, paging: true });
	assert.deepEqual(liftedAtEof, { hiddenLines: 0, showLift: false, showHeaderLoadAll: false, footerAtCap: false });
	// 解除后还在加载：进度提示旁边不该再挂一个同名的「全部加载」
	const lifting = capControls({ tokensLength: 60000, renderedCount: 60000, lineCap: Number.MAX_SAFE_INTEGER, capLifted: true, atEnd: false, paging: true });
	assert.deepEqual(lifting, { hiddenLines: 0, showLift: false, showHeaderLoadAll: false, footerAtCap: false });
});

test("cap controls: invalid inputs never invent a control", () => {
	const empty = capControls();
	assert.deepEqual(empty, { hiddenLines: 0, showLift: false, showHeaderLoadAll: false, footerAtCap: false });
	for (const bad of [Number.NaN, -1, "50000", null, undefined, Infinity]) {
		const state = capControls({ tokensLength: bad, renderedCount: bad, lineCap: bad, atEnd: true, paging: true });
		assert.equal(state.hiddenLines, 0, String(bad));
		assert.equal(state.showLift, false, String(bad));
	}
	// renderedCount 不允许超过 tokensLength（否则会算出负的 hiddenLines）
	const clamped = capControls({ tokensLength: 10, renderedCount: 999, lineCap: 50000, atEnd: true, paging: true });
	assert.equal(clamped.hiddenLines, 0);
});

// ---------- scanStopState（PREVIEW-4：命中上限 vs 字节预算） ----------

test("scan stop: the hit cap and the byte budget are different stops", () => {
	// 找到 MAX_MATCHES 条就停：文案是「已找到 N 处（达到上限）」，计数要带 +
	const hits = { done: true, capped: true, cappedReason: "hits" };
	assert.deepEqual(scanStopState(hits), {
		stopped: true, reason: "hits", noticeKey: "search.scanHitCap", counterCapped: true
	});
	// 64MB 预算扫完：文案是「只扫描了前 {limitBytes}」，命中数组没有被截断到上限
	const bytes = { done: true, capped: true, cappedReason: "bytes" };
	assert.deepEqual(scanStopState(bytes), {
		stopped: true, reason: "bytes", noticeKey: "search.scanCapped", counterCapped: false
	});
});

test("scan stop: reaching EOF is a complete scan, not a capped one", () => {
	assert.deepEqual(scanStopState({ done: true, capped: false, cappedReason: null }), {
		stopped: false, reason: null, noticeKey: null, counterCapped: false
	});
	// 还在扫（done=false）：命中已经封顶也不用解释「停下来了」
	assert.equal(scanStopState({ done: false, capped: true, cappedReason: "hits" }).stopped, false);
	assert.equal(scanStopState({ done: false, capped: false, cappedReason: null }).noticeKey, null);
});

test("scan stop: the old capped-without-reason state is read as the byte budget", () => {
	// 兼容上一次构建留下的状态形状（没有 cappedReason 字段）
	assert.deepEqual(scanStopState({ done: true, capped: true }), {
		stopped: true, reason: "bytes", noticeKey: "search.scanCapped", counterCapped: false
	});
});

test("scan stop: invalid input degrades to 'not stopped'", () => {
	for (const value of [undefined, null, {}, { done: "true", capped: true }, { done: true, cappedReason: "hits ", capped: false }]) {
		const state = scanStopState(value);
		assert.equal(state.stopped, false, JSON.stringify(value));
		assert.equal(state.noticeKey, null, JSON.stringify(value));
		assert.equal(state.counterCapped, false, JSON.stringify(value));
	}
});

test("scan stop: the hit cap makes the counter render 2000+", () => {
	// 客户端：matches = 扫描攒出来的普通数组，capped 由 scanStopState 补上
	const state = scanStopState({ done: true, capped: true, cappedReason: "hits" });
	const capped = state.counterCapped;
	const windowed = matchWindowState(2000, capped, 2000);
	assert.equal(windowed.kind, "countCapped");
	assert.equal("1/" + windowed.total + (windowed.kind === "countCapped" ? "+" : ""), "1/2000+");
	// 字节预算停下时不能谎报还有更多
	const bytes = scanStopState({ done: true, capped: true, cappedReason: "bytes" });
	assert.equal(matchWindowState(1500, bytes.counterCapped, 2000).kind, "count");
});

// ---------- lineIsPlain（超长行关闭逐 token 高亮） ----------

test("lineIsPlain: long lines / too many segments fall back to plain text", () => {
	// 正常行：字符数与段数都远低于上限
	assert.equal(lineIsPlain("const x = 1;", 5), false);
	assert.equal(lineIsPlain("", 0), false);
	// 恰好在上限上仍然高亮，超过一格才降级
	assert.equal(lineIsPlain("x".repeat(PLAIN_LINE_MAX_CHARS), 1), false);
	assert.equal(lineIsPlain("x".repeat(PLAIN_LINE_MAX_CHARS + 1), 1), true);
	assert.equal(lineIsPlain("x", PLAIN_LINE_MAX_SEGS), false);
	assert.equal(lineIsPlain("x", PLAIN_LINE_MAX_SEGS + 1), true);
});

test("lineIsPlain: the real 928KB one-line JSON is plain (54k spans would freeze Chromium)", () => {
	// 实测：500,000 字符 / 54,508 个 token 段被渲染成同一行时，Chromium 首帧都不出现、
	// mousemove 300s 不返回；改成纯文本后 1.1s 内完成且 hover 流畅。
	assert.equal(lineIsPlain("y".repeat(500000), 54508), true);
	// 超长但只有一段（例如被外部工具压成一行且无 token）也只按字符数判定
	assert.equal(lineIsPlain("z".repeat(500000), 1), true);
	// 短行即使 token 再多也不会误伤（例如 400 段）
	assert.equal(lineIsPlain("a".repeat(100), 400), false);
	// 非法输入不抛、不误判
	assert.equal(lineIsPlain(undefined, undefined), false);
	assert.equal(lineIsPlain(null, 10), false);
	assert.equal(lineIsPlain("ok", NaN), false);
});
