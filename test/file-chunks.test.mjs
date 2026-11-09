/**
 * dsh-code-nav — file-chunks 纯函数的不变量。
 *
 * 分块是「行号全局连续」的唯一保证：块边界必须落在整行上、块间不重不漏、
 * 行数合计等于文件行数。这里用各种尾巴（LF / CRLF / 无尾换行 / 连续空行 /
 * 超长单行）把 planChunk 与 chunkFromRead 的约定钉死。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/build.mjs";
import {
	CHUNK_CHARS,
	INITIAL_CHUNK_CHARS,
	MAX_PREVIEW_LINES,
	PLAIN_CHUNK_CHARS,
	lineCountOf,
	planChunk,
	chunkFromRead,
	chunkNeedsPlain
} from "../src/file-chunks.js";

/** 按 planChunk 一直切到 EOF。 */
function cutAll(text, budget) {
	const pieces = [];
	let offset = 0;
	for (let guard = 0; guard < 10000; guard += 1) {
		const piece = planChunk(text, offset, budget);
		pieces.push(piece);
		if (piece.eof) break;
		assert.ok(piece.nextOffset > offset, "planChunk must advance the offset");
		offset = piece.nextOffset;
	}
	return pieces;
}

test("file-chunks: limits are ordered so first paint stays cheap", () => {
	assert.ok(CHUNK_CHARS > 64 * 1024);
	assert.ok(INITIAL_CHUNK_CHARS >= CHUNK_CHARS);
	assert.ok(MAX_PREVIEW_LINES >= 20000);
	assert.ok(PLAIN_CHUNK_CHARS > 0 && PLAIN_CHUNK_CHARS < CHUNK_CHARS);
});

test("file-chunks: lineCountOf counts what split(/\\r?\\n/) produces", () => {
	assert.equal(lineCountOf(""), 0);
	assert.equal(lineCountOf("a"), 1);
	assert.equal(lineCountOf("a\n"), 2);
	assert.equal(lineCountOf("a\nb"), 2);
	assert.equal(lineCountOf("a\r\nb\r\n"), 3);
	assert.equal(lineCountOf("\n\n"), 3);
	assert.equal(lineCountOf("x".repeat(3) + "\n" + "y"), 2);
});

test("file-chunks: planChunk reconstructs the file exactly and never splits a line", () => {
	const samples = [
		"",
		"no trailing newline",
		"one\ntwo\nthree\n",
		"crlf\r\nfile\r\n",
		"blank\n\nlines\n\n",
		"\n",
		"\n\n",
		"single long line " + "x".repeat(3000) + "\nshort\n",
		"中文行\n第二行\n",
		"emoji: 🚀🚀🚀\nsecond\n"
	];
	for (const text of samples) {
		const pieces = cutAll(text, 8);
		assert.equal(pieces.map((p) => p.raw).join(""), text, "raw slices must cover the file");
		let lines = 0;
		for (const piece of pieces) {
			lines += piece.lines.length;
			if (!piece.eof) {
				assert.ok(piece.raw.endsWith("\n"), "non-eof chunk must end at a line break");
				// text 只去掉末尾那一个分隔符；行内容里的空行仍以 \n 结尾
				const expected = piece.raw.endsWith("\r\n") ? piece.raw.slice(0, -2) : piece.raw.slice(0, -1);
				assert.equal(piece.text, expected, "chunk text must not carry the final separator only");
			}
		}
		assert.equal(lines, lineCountOf(text), "line numbers must add up");
	}
});

test("file-chunks: a window without a line break extends to the next break", () => {
	const long = "x".repeat(1000);
	const text = long + "\nshort";
	const first = planChunk(text, 0, 64);
	assert.equal(first.eof, false);
	assert.equal(first.text, long);
	assert.equal(first.raw, long + "\n");
	assert.equal(first.lines.length, 1);
	assert.equal(first.nextOffset, long.length + 1);
	const second = planChunk(text, first.nextOffset, 64);
	assert.equal(second.eof, true);
	assert.equal(second.text, "short");
});

test("file-chunks: long single line is flagged for plain-text rendering", () => {
	const text = "y".repeat(PLAIN_CHUNK_CHARS + 1);
	const piece = planChunk(text, 0, 64);
	assert.equal(piece.eof, true);
	assert.equal(piece.lines.length, 1);
	assert.equal(chunkNeedsPlain(piece.raw), true);
	assert.equal(chunkNeedsPlain("y\n" + "z".repeat(10)), false);
	assert.equal(chunkNeedsPlain("short line\n"), false);
	assert.equal(chunkNeedsPlain(""), false);
});

test("file-chunks: chunkFromRead drops the boundary separator but keeps EOF's final empty line", () => {
	const mid = chunkFromRead("a\nb\n", 4, false);
	assert.equal(mid.text, "a\nb");
	assert.deepEqual(mid.lines, ["a", "b"]);
	assert.equal(mid.endsWithBreak, true);
	assert.equal(mid.pending, "");

	const crlf = chunkFromRead("a\r\nb\r\n", 6, false);
	assert.equal(crlf.text, "a\r\nb");
	assert.deepEqual(crlf.lines, ["a", "b"]);
	assert.equal(crlf.pending, "");

	const tail = chunkFromRead("a\nb\n", 4, true);
	assert.equal(tail.text, "a\nb\n");
	assert.deepEqual(tail.lines, ["a", "b", ""]);
	assert.equal(tail.pending, "");

	// 非 eof 页不以换行结尾 = 页面停在一行中间（宿主只在页里没有换行时才这样返回）：
	// 最后那段不是一行，不能当成整行产出，否则行号从接缝处开始漂（PREVIEW-1）。
	const noBreak = chunkFromRead("a\nb", 3, false);
	assert.equal(noBreak.text, "a", "只有最后一个换行之前的 'a' 是完整行");
	assert.deepEqual(noBreak.lines, ["a"]);
	assert.equal(noBreak.endsWithBreak, false);
	assert.equal(noBreak.pending, "b", "跨页半行必须留给下一页");
});

test("file-chunks: a carry from the previous page completes the line once the break arrives", () => {
	// 上一页停在 "ab" 中间，下一页从 "c\n" 开始：拼起来才是完整的一行 "abc"。
	const paged = chunkFromRead("c\nnext\n", 8, false, "ab");
	assert.equal(paged.raw, "abc\nnext\n", "raw 是拼好的本块文本（含 carry）");
	assert.deepEqual(paged.lines, ["abc", "next"]);
	assert.equal(paged.text, "abc\nnext");
	assert.equal(paged.pending, "");

	// 整页依然没有换行：一行都不产出，全部继续留给下一页。
	const still = chunkFromRead("def", 6, false, "abc");
	assert.deepEqual(still.lines, []);
	assert.equal(still.text, "");
	assert.equal(still.pending, "abcdef");

	// EOF 时才把 pending 补成最后一行（没有结尾换行也是完整的一行）。
	const done = chunkFromRead("def", 6, true, "abc");
	assert.deepEqual(done.lines, ["abcdef"]);
	assert.equal(done.pending, "");

	// CRLF 恰好被页边界劈开：carry 带 "\r"，下一页以 "\n" 开头，拼起来仍是 CRLF。
	const crlf = chunkFromRead("\nb\r\n", 5, false, "a\r");
	assert.deepEqual(crlf.lines, ["a", "b"]);
	assert.equal(crlf.pending, "");
});

test("file-chunks: empty and out-of-range reads stay EOF", () => {
	assert.deepEqual(planChunk("", 0, 8), { text: "", raw: "", lines: [], nextOffset: 0, eof: true, endsWithBreak: false, pending: "" });
	const past = planChunk("abc", 99, 8);
	assert.equal(past.eof, true);
	assert.deepEqual(past.lines, []);
	assert.equal(past.pending, "");
	assert.equal(chunkFromRead("", 12, true).eof, true);
	assert.deepEqual(chunkFromRead("", 12, true).lines, []);
	// 空页 + 非空 carry：不能把 carry 丢掉，也不能多产出一行
	const kept = chunkFromRead("", 12, false, "half");
	assert.deepEqual(kept.lines, []);
	assert.equal(kept.pending, "half");
});

/** 复刻宿主 `fs.readPage`：128 KiB 窗口，裁到最后一个换行；窗口里没有换行就原样返回。 */
function hostReadPage(bytes, offset, pageBytes) {
	const size = bytes.length;
	if (offset >= size) return { text: "", nextOffset: size, eof: true };
	const length = Math.min(pageBytes, size - offset);
	let slice = bytes.subarray(offset, offset + length);
	let nextOffset = offset + length;
	if (nextOffset < size) {
		const lastBreak = slice.lastIndexOf(0x0a);
		if (lastBreak >= 0) {
			slice = slice.subarray(0, lastBreak + 1);
			nextOffset = offset + lastBreak + 1;
		}
	}
	return { text: slice.toString("utf8"), nextOffset: nextOffset, eof: nextOffset >= size };
}

/** 修复前的 chunkFromRead：不认「页停在一行中间」，每个未裁剪的页都当完整行。 */
function legacyChunkFromRead(text, eof) {
	const raw = typeof text === "string" ? text : "";
	if (raw === "") return [];
	if (eof === true) return raw.split(/\r?\n/);
	const lines = raw.split(/\r?\n/);
	if (raw.charCodeAt(raw.length - 1) === 10 && lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

test("file-chunks: a >5MB paged file with a 300 KiB single line keeps every line and line number", () => {
	const PAGE_BYTES = 128 * 1024;
	// > 5 MiB（宿主走分页）且含 300 KiB 单行 + 更长的 4.8 MiB 单行：两行都比一页大，
	// 每页都「整页没有换行」，宿主原样返回、由客户端拼接（PREVIEW-1 的最小复现）。
	const content = "a".repeat(Math.ceil(4.8 * 1024 * 1024))
		+ "\n" + "b".repeat(300 * 1024)
		+ "\nshort line\nlast\n";
	const bytes = Buffer.from(content, "utf8");
	assert.ok(bytes.length > 5 * 1024 * 1024, "夹具必须真的超过 5MiB，否则生产上走的是内存路径");

	const truth = content.split(/\r?\n/);
	const lines = [];
	const naive = [];
	let offset = 0;
	let pending = "";
	let eof = false;
	let pages = 0;
	while (!eof) {
		const page = hostReadPage(bytes, offset, PAGE_BYTES);
		const piece = chunkFromRead(page.text, page.nextOffset, page.eof === true, pending);
		// 旧逻辑：不接 carry，把每个「无换行的页」当成完整行
		naive.push(...legacyChunkFromRead(page.text, page.eof === true));
		pages += 1;
		pending = piece.pending;
		lines.push(...piece.lines);
		assert.ok(piece.nextOffset > offset, "偏移必须严格前进（否则分页器会原地打转）");
		offset = piece.nextOffset;
		eof = piece.eof;
	}
	assert.ok(pages > 40, ">5MiB 且含两行超页长的行：至少几十页，实际 " + pages);
	assert.deepEqual(lines, truth, "拼接后的行内容/行数必须与整文件 split(/\\r?\\n/) 完全一致");
	assert.equal(lines.length, truth.length);
	// before/after：旧逻辑把两行超长行拆成 40 多段假行、后面每一行的行号整体后移
	assert.ok(naive.length > truth.length, "旧逻辑（不拼 carry）会把长行拆成假行：" + naive.length + " vs " + truth.length);
	const naiveShortLine = naive.indexOf("short line") + 1;
	assert.ok(naiveShortLine > 3, "旧逻辑把「short line」显示成第 " + naiveShortLine + " 行（真实是第 3 行）");
	assert.equal(lines.indexOf("short line") + 1, 3, "拼接后「short line」是第 3 行");
	assert.equal(lines.indexOf("last") + 1, 4, "拼接后「last」是第 4 行");
});

test("file-chunks: bundle ships the pager wiring, not whole-file tokenization", () => {
	const bundle = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
	assert.match(bundle, /__cn\.planChunk\(/);
	assert.match(bundle, /__cn\.chunkFromRead\(/);
	assert.match(bundle, /__cn\.MAX_PREVIEW_LINES/);
	assert.match(bundle, /sidebar\/api\/fs\.readPage/);
	assert.match(bundle, /paging\.loadMore/);
	// 整文件 tokenize 的老路径必须已经消失（否则 5MB 文件会重新卡死主线程）
	assert.doesNotMatch(bundle, /tokenizeLines\(content, lang\)/);
});
