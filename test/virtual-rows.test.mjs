/**
 * dsh-code-nav — 虚拟滚动窗口的不变量。
 *
 * 分块（file-chunks）决定「加载进内存的行」，窗口（virtual-rows）决定「挂进
 * DOM 的行」。两者必须拼出**完全一样**的滚动高度与行号，否则滚动条长度会随
 * 滚动变化、跳转定位也会漂。这里把行区间 / 占位高度 / 行号→scrollTop 的约定
 * 钉死，并用构建产物断言「不再全量渲染已加载行」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/build.mjs";
import {
	ROW_HEIGHT,
	OVERSCAN_ROWS,
	rowWindow,
	rowScrollTop
} from "../src/virtual-rows.js";

test("virtual-rows: a short file renders every line (no windowing)", () => {
	const view = rowWindow(0, 608, 40);
	assert.deepEqual(view, { start: 0, end: 40, topPad: 0, bottomPad: 0 });
});

test("virtual-rows: placeholders keep the scroll height exact at any position", () => {
	const viewHeight = 608;
	const maxRows = Math.ceil(viewHeight / ROW_HEIGHT) + 1 + 2 * OVERSCAN_ROWS;
	for (const total of [1, 2, 41, 8148, 27949, 50000]) {
		const positions = [0, 7, 123, 4000, (total - 1) * ROW_HEIGHT, total * ROW_HEIGHT];
		for (const scrollTop of positions) {
			if (!Number.isFinite(scrollTop) || scrollTop < 0) continue;
			const view = rowWindow(scrollTop, viewHeight, total);
			const rendered = (view.end - view.start) * ROW_HEIGHT;
			assert.equal(
				view.topPad + rendered + view.bottomPad,
				total * ROW_HEIGHT,
				`scroll height drifted at scrollTop=${scrollTop} total=${total}`
			);
			assert.ok(view.start >= 0 && view.end <= total, "window stays inside the file");
			assert.ok(view.start <= view.end, "window is ordered");
			assert.ok(view.end - view.start <= maxRows, "window stays bounded (this is the freeze fix)");
			// 视口最上面那行必须在窗口里，否则滚动会看到空白
			const topRow = Math.floor(Math.min(scrollTop, (total - 1) * ROW_HEIGHT) / ROW_HEIGHT);
			assert.ok(topRow >= view.start && topRow < view.end, `top row ${topRow} not in window`);
		}
	}
});

test("virtual-rows: empty / absurd input stays empty and never negative", () => {
	assert.deepEqual(rowWindow(0, 0, 0), { start: 0, end: 0, topPad: 0, bottomPad: 0 });
	assert.deepEqual(rowWindow(Number.NaN, Number.NaN, Number.NaN), { start: 0, end: 0, topPad: 0, bottomPad: 0 });
	assert.deepEqual(rowWindow(-50, -10, 3), { start: 0, end: 3, topPad: 0, bottomPad: 0 });
	assert.deepEqual(rowWindow(-50, 0, 2.9), { start: 0, end: 2, topPad: 0, bottomPad: 0 });
});

test("virtual-rows: the last line is rendered at maximum scroll", () => {
	const total = 16301;
	const viewHeight = 608;
	const view = rowWindow(total * ROW_HEIGHT - viewHeight, viewHeight, total);
	assert.equal(view.end, total);
	assert.equal(view.bottomPad, 0);
	assert.ok(view.start > 0, "a 16k-line file must not render from row 0 at the bottom");
});

test("virtual-rows: rowScrollTop centers the target line and clamps at zero", () => {
	assert.equal(rowScrollTop(1, 608), 0);
	assert.equal(rowScrollTop(2, 608), 0);
	assert.equal(rowScrollTop(101, 608), 100 * ROW_HEIGHT - 294);
	assert.equal(rowScrollTop(5000, 0), 4999 * ROW_HEIGHT);
	assert.equal(rowScrollTop(Number.NaN, 608), 0);
	assert.equal(rowScrollTop(0, 608), 0);
});

test("virtual-rows: bundle renders a window, not every loaded line", () => {
	const bundle = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
	assert.match(bundle, /__cn\.rowWindow\(/);
	assert.match(bundle, /__cn\.rowScrollTop\(/);
	assert.match(bundle, /cn-ruler/);
	// 旧实现是 `for (i = 0; i < renderedCount; i++)` 全量建行 —— 16k 行 = 16.8 万个
	// 元素，宿主一次整页样式重算要 ~10s（打开即卡死）。这条老路径必须消失。
	assert.doesNotMatch(bundle, /const maxLines = renderedCount;/);
});
