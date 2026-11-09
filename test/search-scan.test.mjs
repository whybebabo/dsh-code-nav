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
	// 新路径：只按「预览上限」裁剪（超过上限的行根本不会被加载）
	assert.match(bundle, /clipZeroBasedToRenderWindow\(rawMatches, __cn\.MAX_PREVIEW_LINES\)/);
});
