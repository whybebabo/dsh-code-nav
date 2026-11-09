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

	const crlf = chunkFromRead("a\r\nb\r\n", 6, false);
	assert.equal(crlf.text, "a\r\nb");
	assert.deepEqual(crlf.lines, ["a", "b"]);

	const tail = chunkFromRead("a\nb\n", 4, true);
	assert.equal(tail.text, "a\nb\n");
	assert.deepEqual(tail.lines, ["a", "b", ""]);

	const noBreak = chunkFromRead("a\nb", 3, false);
	assert.equal(noBreak.text, "a\nb");
	assert.deepEqual(noBreak.lines, ["a", "b"]);
	assert.equal(noBreak.endsWithBreak, false);
});

test("file-chunks: empty and out-of-range reads stay EOF", () => {
	assert.deepEqual(planChunk("", 0, 8), { text: "", raw: "", lines: [], nextOffset: 0, eof: true, endsWithBreak: false });
	const past = planChunk("abc", 99, 8);
	assert.equal(past.eof, true);
	assert.deepEqual(past.lines, []);
	assert.equal(chunkFromRead("", 12, true).eof, true);
	assert.deepEqual(chunkFromRead("", 12, true).lines, []);
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
