/**
 * dsh-code-nav — 全文查找的两个辅助不变量。
 *
 * 查找要覆盖**整个文件**（而不是只覆盖已经滚动加载的行）：
 * - ≤5 MB：正文在内存里，直接 findMatches；
 * - >5 MB：后台按页扫描，appendScannedMatches 把每页命中平移到文件全局行号，
 *   scanProgress 给出进度 / 预算截断。
 * 这里钉住行号平移、命中上限与预算语义，并断言构建产物里没有「按已加载行裁剪
 * 查找结果」的老路径。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/build.mjs";
import {
	MAX_MATCHES,
	SCAN_MAX_BYTES,
	appendScannedMatches,
	findMatches,
	scanProgress
} from "../src/search.js";
import { scanStopState } from "../src/view-state.js";

test("search scan: page matches are shifted to file-global line numbers", () => {
	const page = findMatches("a\nb\na\n", "a", {});
	assert.equal(page.length, 2);
	const merged = appendScannedMatches([], page, 100, MAX_MATCHES);
	assert.equal(merged.matches.length, 2);
	assert.deepEqual(merged.matches.map((m) => m.line), [100, 102]);
	assert.deepEqual(merged.matches.map((m) => m.col), [0, 0]);
	assert.equal(merged.capped, false);
	// 再叠一页：行号继续累加，前页结果原样保留
	const second = appendScannedMatches(merged.matches, findMatches("c\na", "a", {}), 200, MAX_MATCHES);
	assert.deepEqual(second.matches.map((m) => m.line), [100, 102, 201]);
	assert.deepEqual(second.matches.map((m) => m.col), [0, 0, 0]);
});

test("search scan: the match cap stops the merge and marks it", () => {
	const page = findMatches("x x x x", "x", {});
	const merged = appendScannedMatches([], page, 0, 2);
	assert.equal(merged.matches.length, 2);
	assert.equal(merged.capped, true);
	// 页内 findMatches 自己探测到上限时也要把 capped 传上去
	const cappedPage = findMatches("y ".repeat(MAX_MATCHES + 1), "y", {});
	assert.equal(cappedPage.length, MAX_MATCHES);
	assert.equal(appendScannedMatches([], cappedPage, 0, MAX_MATCHES).capped, true);
});

test("search scan: progress is a percentage of the bytes that will be scanned", () => {
	assert.deepEqual(scanProgress(0, 1000), { percent: 0, capped: false, limitBytes: 1000 });
	assert.deepEqual(scanProgress(250, 1000), { percent: 25, capped: false, limitBytes: 1000 });
	assert.deepEqual(scanProgress(1000, 1000), { percent: 100, capped: false, limitBytes: 1000 });
	// 文件比预算大：分母是预算，扫满预算就 capped
	const capped = scanProgress(SCAN_MAX_BYTES, SCAN_MAX_BYTES * 2);
	assert.equal(capped.percent, 100);
	assert.equal(capped.capped, true);
	assert.equal(capped.limitBytes, SCAN_MAX_BYTES);
	// 总大小未知（宿主没给 size）：按预算算进度，不把 0 当总大小
	const unknown = scanProgress(1024, undefined);
	assert.ok(unknown.percent >= 0 && unknown.percent <= 100);
	assert.equal(unknown.capped, false);
});

test("search scan: bad input never produces negative or NaN progress", () => {
	for (const value of [Number.NaN, -5, "10", null, undefined]) {
		const info = scanProgress(value, value);
		assert.ok(Number.isFinite(info.percent) && info.percent >= 0 && info.percent <= 100, String(value));
		assert.equal(info.capped, false);
		assert.ok(info.limitBytes > 0);
	}
	const merged = appendScannedMatches(undefined, undefined, Number.NaN, Number.NaN);
	assert.deepEqual(merged.matches, []);
	assert.equal(merged.capped, false);
});

test("search scan: a scan that hits MAX_MATCHES stops for 'hits', not for 'bytes'", () => {
	// 复刻扫描循环：命中攒到上限就停，并记下原因（PREVIEW-4）。
	const page = findMatches("Widget ".repeat(MAX_MATCHES + 5), "Widget", {});
	assert.equal(page.length, MAX_MATCHES);
	const merged = appendScannedMatches([], page, 0, MAX_MATCHES);
	assert.equal(merged.matches.length, MAX_MATCHES);
	assert.equal(merged.capped, true);
	const scan = { matches: [], capped: merged.capped, cappedReason: merged.capped ? "hits" : null, scannedBytes: 1_703_650, done: true };
	const stop = scanStopState(scan);
	assert.equal(stop.reason, "hits");
	assert.equal(stop.noticeKey, "search.scanHitCap", "命中上限不能再用「只扫描了前 N MB」的说法");
	assert.equal(stop.counterCapped, true, "命中上限停下的计数要显示 2000+");
	// 实际只读了 1.62 MB，提示里不能写 min(6.34MB, 64MB) = 6.3MB
	const info = scanProgress(scan.scannedBytes, 6_650_000);
	assert.ok(info.limitBytes > scan.scannedBytes, "旧的 {mb} 是「预算上限」而不是实际扫描量");

	// 字节预算停下：还是「只扫描了前 N MB」，计数不冒充 2000+
	const bytes = scanStopState({ capped: true, cappedReason: "bytes", done: true });
	assert.equal(bytes.reason, "bytes");
	assert.equal(bytes.noticeKey, "search.scanCapped");
	assert.equal(bytes.counterCapped, false);
});

test("search scan: the client records and renders the two stop reasons", () => {
	// bundle 是 Lead 构建的产物，这里断言模板源码（构建前的唯一事实来源）。
	const template = readFileSync(new URL("../scripts/client.template.js", import.meta.url), "utf8");
	assert.match(template, /cappedReason: state\.cappedReason/, "扫描状态必须带 cappedReason");
	assert.match(template, /state\.cappedReason = "hits"/, "命中上限要记成 hits");
	assert.match(template, /cappedReason: "bytes"/, "字节预算要记成 bytes");
	assert.match(template, /__cn\.scanStopState\(scan\)/, "客户端要用 scanStopState 派生提示/计数");
	assert.match(template, /scanStop\.counterCapped === true/, "命中上限要给 matches 补 capped 标记（2000+）");
	assert.match(template, /t\("search\.scanHitCap"\)/, "命中上限要有自己的文案键");
	// 旧的单一 capped 提示路径（一律按字节预算措辞）必须消失
	assert.doesNotMatch(template, /scan\.capped === true;\s*\n\s*const scanInfo/, "不能再用单一 capped 判断文案");
});

test("search scan: the bundle searches the whole file, not the loaded window", () => {
	const bundle = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
	// ≤5MB：直接搜完整正文
	assert.match(bundle, /__cn\.findMatches\(content, deferredQuery/);
	// >5MB：后台按页扫描
	assert.match(bundle, /__cn\.appendScannedMatches\(/);
	assert.match(bundle, /__cn\.scanProgress\(/);
	assert.match(bundle, /__cn\.SCAN_MAX_BYTES/);
	assert.match(bundle, /sidebar\/api\/fs\.readPage/);
	// 老路径：把匹配裁到「已加载的行数」—— 这正是「必须滚到才搜得到」的原因
	assert.doesNotMatch(bundle, /clipZeroBasedToRenderWindow\(all, renderedCount\)/);
	// 新路径：按「可加载的行数上限」裁剪（默认 50,000，可手动解除）
	assert.match(bundle, /clipZeroBasedToRenderWindow\(rawMatches, lineCap\)/);
	// 预览上限是软上限：超出上限的命中可点「加载全部（解除上限）」
	assert.match(bundle, /const liftCap = \(\) =>/);
	assert.match(bundle, /lineCapRef\.current = Number\.MAX_SAFE_INTEGER/);
	assert.match(bundle, /paging\.liftCap/);
	// 分页预览的说明行右侧也有「全部加载」（与宿主内置分页预览对齐）
	assert.match(bundle, /cn-note-row/);
	assert.match(bundle, /paging\.loadAllTitle/);
});
