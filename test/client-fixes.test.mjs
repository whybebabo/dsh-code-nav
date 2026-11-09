/**
 * dsh-code-nav — 客户端大文件分页 / 块分词 / 预览上限 / 扫描停止原因的回归测试
 * （2026-11-09 代码审查 PREVIEW-1 / PREVIEW-2 / PREVIEW-3 / PREVIEW-4）。
 *
 * 被测逻辑在 `scripts/client.template.js` 里（构建时内联进 `lib/client.js`），
 * 单测不能直接 import。做法与 `test/chip-runtime.test.mjs` 相同：从模板里切出
 * `//#region chunk tokenize` 的**真实代码**，用 `new Function` 注入真的 src 纯函数
 * 后再求值 —— 测的是真正会发布的那份代码，而不是它的复制品。
 *
 * 覆盖：
 *  - PREVIEW-1：>5MB 分页文件里的 300 KiB 单行不再被拆成假行（行号 + 查找行号）；
 *  - PREVIEW-2：块注释 / 多行字符串的状态跨块接力（非 SFC 语言）；
 *  - PREVIEW-2：>256KB Vue SFC 的 `<script>` 跨块之后仍然着色（累计重分词）；
 *              超过累计上限时退化为逐块（已知退化，行数仍然正确）；
 *  - PREVIEW-3：上限正好在 EOF 处生效时，解除入口仍然可见；
 *  - PREVIEW-4：命中上限停下的计数是 `2000+`，文案与字节预算不同；
 *  - zh/en 词典完整性与模板接线（构建产物由 Lead 重新构建）。
 *
 * 零依赖，`node --test test/client-fixes.test.mjs` 可直接跑。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHUNK_CHARS, MAX_PREVIEW_LINES, chunkFromRead, chunkNeedsPlain, planChunk } from "../src/file-chunks.js";
import { tokenizeLinesWithState } from "../src/tokenize.js";
import { MAX_MATCHES, appendScannedMatches, findMatches } from "../src/search.js";
import { capControls, matchWindowState, scanStopState } from "../src/view-state.js";

// ---------- 从模板里抽取真实的分词代码 ----------

/** 切出 `//#region <label>` 到对应 `//#endregion` 之间的源码（与 chip-runtime 同款）。 */
function sliceRegion(source, label) {
	const start = source.indexOf("//#region " + label);
	assert.notEqual(start, -1, "模板里找不到 region: " + label);
	const end = source.indexOf("//#endregion", start);
	assert.notEqual(end, -1, "region 没有闭合: " + label);
	return source.slice(start, end);
}

const template = readFileSync(new URL("../scripts/client.template.js", import.meta.url), "utf8");
const tokenizeRegion = sliceRegion(template, "chunk tokenize");

/**
 * 用真实的 src 纯函数求值模板里的分词 region。
 * @returns {{tokenizeChunk:Function, tokenizePiece:Function, tokenizeSfcCumulative:Function, SFC_CUMULATIVE_MAX_CHARS:number}}
 */
function makeTemplateTokenizer() {
	const __cn = { chunkNeedsPlain, tokenizeLinesWithState };
	const factory = new Function(
		"__cn",
		tokenizeRegion + "\nreturn {tokenizeChunk, tokenizePiece, tokenizeSfcCumulative, isSfcLang, SFC_CUMULATIVE_MAX_CHARS};"
	);
	return factory(__cn);
}

/** 复刻 appendPiece 的累积过程：逐块 planChunk → tokenizePiece → 追加。 */
function collectChunks(tokenizer, content, lang, chunkChars = CHUNK_CHARS) {
	const chunks = [];
	let offset = 0;
	for (let guard = 0; guard < 10000; guard += 1) {
		const piece = planChunk(content, offset, chunkChars);
		const tokenized = tokenizer.tokenizePiece(chunks, piece, lang);
		if (tokenized.lines.length > 0) {
			chunks.push({ text: piece.text, lines: tokenized.lines, tokenState: tokenized.state });
		}
		if (piece.eof) return chunks;
		assert.ok(piece.nextOffset > offset, "planChunk 必须推进偏移");
		offset = piece.nextOffset;
	}
	throw new Error("planChunk never reached EOF");
}

/** 已加载分块拼成全局行数组（客户端 `tokens` 就是这么来的）。 */
function flatLines(chunks) {
	const out = [];
	for (const chunk of chunks) for (const line of chunk.lines) out.push(line);
	return out;
}

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

/**
 * 复刻分页读取循环（readRemotePage + 游标 + pending），返回每个 piece 与最终行数组。
 * @param {Buffer} bytes
 * @param {(piece:object, pending:string)=>void} [onPage]
 */
function readAllPages(bytes, pageBytes, onPage) {
	const lines = [];
	let offset = 0;
	let pending = "";
	let pages = 0;
	for (let guard = 0; guard < 10000; guard += 1) {
		const page = hostReadPage(bytes, offset, pageBytes);
		const piece = chunkFromRead(page.text, page.nextOffset, page.eof === true, pending);
		pages += 1;
		pending = piece.pending;
		for (const line of piece.lines) lines.push(line);
		if (onPage !== undefined) onPage(piece, pending);
		offset = piece.nextOffset;
		if (piece.eof) return { lines, pages };
		assert.ok(piece.nextOffset > 0, "偏移必须前进");
	}
	throw new Error("paged read never reached EOF");
}

// ---------- PREVIEW-1：>5MB 分页文件里的超长单行 ----------

test("PREVIEW-1：>5MB 分页文件的 300 KiB 单行不再拆行，查找行号与整文件一致", () => {
	const PAGE_BYTES = 128 * 1024;
	// 4.8 MiB 单行 + 300 KiB 单行 + 普通行：两行都比一页长，宿主每页都返回未裁剪窗口。
	const content = "a".repeat(Math.ceil(4.8 * 1024 * 1024))
		+ "\n" + "b".repeat(300 * 1024)
		+ "\nshort line\ntarget last line\n";
	const bytes = Buffer.from(content, "utf8");
	assert.ok(bytes.length > 5 * 1024 * 1024, "夹具必须真的超过 5MiB（生产上才走分页路径）");

	const truth = content.split(/\r?\n/);
	const read = readAllPages(bytes, PAGE_BYTES);
	assert.ok(read.pages > 40, "至少几十页，实际 " + read.pages);
	assert.deepEqual(read.lines, truth, "行内容与行数必须等于整文件 split(/\\r?\\n/)");

	// 查找：整文件 findMatches 的参考行号 vs 分页扫描累加出来的行号
	const QUERY = "target last line";
	const reference = findMatches(content, QUERY, {});
	assert.equal(reference.length, 1);
	assert.equal(reference[0].line, 3, "整文件里目标是 0 基第 3 行（1 基第 4 行）");
	assert.equal(read.lines.indexOf(QUERY), 3, "客户端行数组里同样是第 4 行");

	// 复刻后台扫描：逐页 findMatches + appendScannedMatches(行号平移)
	let collected = [];
	let offset = 0;
	let pending = "";
	let scannedLines = 0;
	for (let guard = 0; guard < 10000; guard += 1) {
		const page = hostReadPage(bytes, offset, PAGE_BYTES);
		const piece = chunkFromRead(page.text, page.nextOffset, page.eof === true, pending);
		pending = piece.pending;
		const merged = appendScannedMatches(collected, findMatches(piece.text, QUERY, {}), scannedLines, MAX_MATCHES);
		collected = merged.matches;
		scannedLines += piece.lines.length;
		offset = piece.nextOffset;
		if (piece.eof) break;
	}
	assert.equal(collected.length, 1);
	assert.equal(collected[0].line, reference[0].line, "分页扫描的行号必须与整文件一致");
	assert.equal(collected[0].col, reference[0].col);

	// before/after：修复前每个未裁剪的页都被当成一整行，目标行被报到 40 行之后
	const legacyLines = [];
	offset = 0;
	for (let guard = 0; guard < 10000; guard += 1) {
		const page = hostReadPage(bytes, offset, PAGE_BYTES);
		const raw = page.text;
		if (raw !== "") {
			const parts = raw.split(/\r?\n/);
			if (raw.charCodeAt(raw.length - 1) === 10 && parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
			legacyLines.push(...parts);
		}
		offset = page.nextOffset;
		if (page.eof) break;
	}
	assert.ok(legacyLines.length > truth.length, "旧逻辑把长行拆成假行：" + legacyLines.length + " vs " + truth.length);
	assert.ok(legacyLines.indexOf(QUERY) + 1 > 4, "旧逻辑把目标行报成第 " + (legacyLines.indexOf(QUERY) + 1) + " 行");
});

// ---------- PREVIEW-2：跨块的块注释 / 多行字符串 ----------

test("PREVIEW-2：块注释横跨 256 KiB 块边界时，后一块仍然按注释着色", () => {
	const head = "int a = 1;\n".repeat(20000); // ~200KB
	const content = head
		+ "/* start of a long commented-out block\n"
		+ "class Fake { }\n".repeat(4000)
		+ "*/\nint RealAfter = 1;\n";
	assert.ok(content.length > CHUNK_CHARS, "夹具必须真的跨越一个块边界");
	const tokenizer = makeTemplateTokenizer();
	const truth = content.split(/\r?\n/);
	const chunks = collectChunks(tokenizer, content, "cpp");
	const lines = flatLines(chunks);
	assert.ok(chunks.length >= 2, "至少两块，实际 " + chunks.length);
	assert.deepEqual(lines.map((line) => line.raw), truth, "行内容/行数与整文件一致");

	const firstComment = truth.findIndex((line) => line.startsWith("/* start"));
	const closeComment = truth.findIndex((line) => line.trim() === "*/");
	assert.ok(closeComment > firstComment);
	// 跨边界那一段（尤其是第二块里的）必须仍然是注释
	const misStyled = [];
	for (let i = firstComment; i < closeComment; i += 1) {
		const segs = lines[i].segs;
		if (!segs.some((seg) => seg.cls === "c-comment")) misStyled.push(i + 1);
	}
	assert.deepEqual(misStyled, [], "块注释内的行丢失了 c-comment：" + misStyled.slice(0, 5).join(","));

	// before/after：逐块重置状态时，第二块把注释内容当成代码（假符号的来源）
	const legacy = [];
	let offset = 0;
	for (let guard = 0; guard < 1000; guard += 1) {
		const piece = planChunk(content, offset, CHUNK_CHARS);
		legacy.push(...tokenizer.tokenizeChunk(piece, "cpp", null).lines);
		if (piece.eof) break;
		offset = piece.nextOffset;
	}
	let legacyMisStyled = 0;
	for (let i = firstComment; i < closeComment; i += 1) {
		if (!legacy[i].segs.some((seg) => seg.cls === "c-comment")) legacyMisStyled += 1;
	}
	assert.ok(legacyMisStyled > 1000, "旧逻辑（状态每块重置）会把整段注释算成代码：" + legacyMisStyled);
});

test("PREVIEW-2：多行字符串（JS 模板字符串）状态也跨块接力", () => {
	const head = "const pad = 1;\n".repeat(18000); // ~234KB
	const content = head
		+ "const text = `line one\n"
		+ "still inside the template literal\n".repeat(2000)
		+ "last line of the literal`;\n"
		+ "const after = 2;\n";
	assert.ok(content.length > CHUNK_CHARS);
	const tokenizer = makeTemplateTokenizer();
	const truth = content.split(/\r?\n/);
	const lines = flatLines(collectChunks(tokenizer, content, "javascript"));
	assert.deepEqual(lines.map((line) => line.raw), truth);

	const open = truth.findIndex((line) => line.includes("const text = `"));
	const close = truth.findIndex((line) => line.includes("last line of the literal`"));
	assert.ok(open >= 0 && close > open);
	const missing = [];
	for (let i = open + 1; i < close; i += 1) {
		if (!lines[i].segs.some((seg) => seg.cls === "c-string")) missing.push(i + 1);
	}
	assert.deepEqual(missing, [], "模板字符串内的行丢失了 c-string：" + missing.slice(0, 5).join(","));
});

// ---------- PREVIEW-2：Vue / Svelte SFC 的跨块 <script> ----------

test("PREVIEW-2：>256KB Vue SFC 的 <script> 跨块后仍然着色（累计重分词）", () => {
	const scriptLines = [];
	for (let i = 0; i < 12000; i += 1) scriptLines.push("const value_" + i + " = " + i + ";");
	const content = "<template>\n<div class=\"box\">hi</div>\n</template>\n<script>\n"
		+ scriptLines.join("\n")
		+ "\n</script>\n";
	assert.ok(content.length > CHUNK_CHARS, "必须真的跨越 256 KiB 块边界");
	assert.ok(content.length <= 500000, "夹具必须落在累计重分词的窗口内");
	const tokenizer = makeTemplateTokenizer();
	const truth = content.split(/\r?\n/);
	const chunks = collectChunks(tokenizer, content, "vue");
	assert.ok(chunks.length >= 2, "至少两块，实际 " + chunks.length);
	const lines = flatLines(chunks);
	assert.deepEqual(lines.map((line) => line.raw), truth, "行内容/行数与整文件一致");

	// 第二块起，<script> 内的每一行都必须有序言着色（不是整行一个空 cls 的纯文本段）
	const scriptAt = truth.findIndex((line) => line === "<script>");
	assert.ok(scriptAt >= 0);
	/** 该行是否真的被着色（至少一个带类名的 token 段）。 */
	const styled = (line) => line.segs.some((seg) => seg.cls !== "");
	/** <script> 里的普通语句行（空行 / </script> 行不算）。 */
	const isScriptLine = (text) => /^const value_\d+ = \d+;$/.test(text);
	let styledAfterBoundary = 0;
	let scriptAfterBoundary = 0;
	let cursor = 0;
	for (let c = 0; c < chunks.length; c += 1) {
		const from = cursor;
		cursor += chunks[c].lines.length;
		if (c === 0) continue;
		for (let i = from; i < cursor; i += 1) {
			if (!isScriptLine(truth[i])) continue;
			scriptAfterBoundary += 1;
			if (styled(chunks[c].lines[i - from])) styledAfterBoundary += 1;
		}
	}
	assert.ok(scriptAfterBoundary > 1000, "第二块里应该有很多 <script> 行：" + scriptAfterBoundary);
	assert.equal(styledAfterBoundary, scriptAfterBoundary, "第二块起 <script> 内的行必须着色");
	// 关键字与标识符类别都要在（不是只有空 segs）
	assert.ok(chunks[1].lines.some((line) => line.segs.some((seg) => seg.cls === "c-kw" && seg.text === "const")));
	assert.ok(chunks[1].lines.some((line) => line.segs.some((seg) => seg.cls === "c-ident")));

	// before/after：逐块分词时第二块看不到 <script> 开场，整块都无着色
	const legacy = [];
	let legacyOffset = 0;
	for (let guard = 0; guard < 1000; guard += 1) {
		const piece = planChunk(content, legacyOffset, CHUNK_CHARS);
		legacy.push(...tokenizer.tokenizeChunk(piece, "vue", null).lines);
		if (piece.eof) break;
		legacyOffset = piece.nextOffset;
	}
	const legacySecondChunk = legacy.slice(chunks[0].lines.length);
	assert.ok(legacySecondChunk.length > 0);
	// 旧逻辑每行只有一个 `{ text, cls: "" }` 段 —— 也就是「一行都不着色」。
	const legacyStyled = legacySecondChunk.filter((line) => line.segs.some((seg) => seg.cls !== "")).length;
	assert.equal(legacyStyled, 0, "旧逻辑（逐块分词）在第二块一行都不着色，实际 " + legacyStyled);
});

test("PREVIEW-2：SFC 超过累计上限时退回逐块分词，但行数永远正确", () => {
	const scriptLines = [];
	for (let i = 0; i < 30000; i += 1) scriptLines.push("const value_" + i + " = " + i + ";");
	const content = "<template>\n<div>hi</div>\n</template>\n<script>\n"
		+ scriptLines.join("\n")
		+ "\n</script>\n";
	assert.ok(content.length > 500000, "夹具必须超过累计重分词上限，实际 " + content.length);
	const tokenizer = makeTemplateTokenizer();
	const truth = content.split(/\r?\n/);
	const chunks = collectChunks(tokenizer, content, "vue");
	const lines = flatLines(chunks);
	assert.deepEqual(lines.map((line) => line.raw), truth, "退化路径也不能丢行/错位");
	// 已知退化：第二块起 <script> 内的行不着色（累计文本超上限后回退逐块分词）
	const laterScriptLines = [];
	for (let c = 1; c < chunks.length; c += 1) {
		for (const line of chunks[c].lines) {
			if (line.raw.startsWith("const ")) laterScriptLines.push(line);
		}
	}
	assert.ok(laterScriptLines.length > 0);
	const styledLater = laterScriptLines.filter((line) => line.segs.some((seg) => seg.cls !== "")).length;
	assert.equal(styledLater, 0, "超上限时文档化退化为不着色");
});

// ---------- PREVIEW-3：上限在 EOF 处生效 ----------

test("PREVIEW-3：分页文件读到最后时越过上限的行仍然能解除上限", () => {
	// 50301 行 × 120 字节 ≈ 6MB：加载器读页直到行数 >= 50,000 的那一页正好是 EOF。
	const line = "const value_xxxxxxxx = 1;".padEnd(120, " ");
	const content = (line + "\n").repeat(50300) + "\n";
	const bytes = Buffer.from(content, "utf8");
	assert.ok(bytes.length > 5 * 1024 * 1024);
	const PAGE_BYTES = 128 * 1024;
	let offset = 0;
	let pending = "";
	let loaded = 0;
	let atEnd = false;
	for (let guard = 0; guard < 10000 && loaded < MAX_PREVIEW_LINES; guard += 1) {
		const page = hostReadPage(bytes, offset, PAGE_BYTES);
		const piece = chunkFromRead(page.text, page.nextOffset, page.eof === true, pending);
		pending = piece.pending;
		loaded += piece.lines.length;
		offset = piece.nextOffset;
		if (piece.eof) { atEnd = true; break; }
	}
	const renderedCount = Math.min(loaded, MAX_PREVIEW_LINES);
	assert.ok(loaded > MAX_PREVIEW_LINES, "越过上限的行必须真的被加载了：" + loaded);
	assert.equal(atEnd, true, "这一页同时是 EOF —— 正是 atCap 旧判据失效的场景");
	const controls = capControls({
		tokensLength: loaded,
		renderedCount: renderedCount,
		lineCap: MAX_PREVIEW_LINES,
		capLifted: false,
		atEnd: atEnd,
		paging: true
	});
	assert.equal(controls.hiddenLines, loaded - MAX_PREVIEW_LINES);
	assert.equal(controls.showLift, true, "EOF 时也必须能解除上限");
	assert.equal(controls.showHeaderLoadAll, true, "分页文件的「全部加载」不能被 atEnd 藏起来");
	assert.equal(controls.footerAtCap, true, "footer 的上限行 + 解除按钮必须可见");
});

// ---------- PREVIEW-4：命中上限的计数与文案 ----------

test("PREVIEW-4：命中上限停下时计数是 2000+，且与字节预算用不同文案", () => {
	// 扫描攒满 2000 条就停在 1.62MB（文件 6.3MB）：旧实现同时报「只扫描了前 6.3MB」
	// 和「1/2000」（没有 +）。
	const chunk = findMatches("Widget ".repeat(MAX_MATCHES + 10), "Widget", {});
	const merged = appendScannedMatches([], chunk, 0, MAX_MATCHES);
	assert.equal(merged.matches.length, MAX_MATCHES);
	const hits = scanStopState({ done: true, capped: merged.capped, cappedReason: "hits" });
	assert.equal(hits.reason, "hits");
	assert.equal(hits.noticeKey, "search.scanHitCap");
	assert.equal(hits.counterCapped, true);
	const windowed = matchWindowState(merged.matches.length, hits.counterCapped, MAX_MATCHES);
	assert.equal(windowed.kind, "countCapped");
	assert.equal("1/" + windowed.total + "+", "1/2000+");
	// 字节预算停下：不同文案，计数不冒充「还有更多」
	const bytes = scanStopState({ done: true, capped: true, cappedReason: "bytes" });
	assert.equal(bytes.noticeKey, "search.scanCapped");
	assert.equal(bytes.counterCapped, false);
});

// ---------- 模板接线 + 词典完整性 ----------

test("客户端模板：分页 carry / 上限控件 / 扫描原因都接上了", () => {
	assert.match(template, /__cn\.chunkFromRead\(page\.text, page\.nextOffset, page\.eof === true, pending\)/, "readRemotePage 必须传 carry");
	assert.match(template, /state\.pending = hasContent \? "" :/, "加载器必须保存 pending");
	assert.match(template, /state\.pending = "";/, "换文件必须清空 pending");
	assert.match(template, /readRemotePage\(state\.offset, scanPending\)/, "后台扫描必须带自己的 pending");
	assert.match(template, /__cn\.capControls\(\{/, "上限控件必须由 capControls 派生");
	assert.match(template, /cap\.showHeaderLoadAll/, "header「全部加载」必须用 capControls");
	assert.match(template, /cap\.footerAtCap/, "footer 上限行必须用 capControls");
	assert.match(template, /const loadRest = \(\) => \{ liftCap\(\); \};/, "footer「全部加载」必须解除上限");
	assert.match(template, /__cn\.scanStopState\(scan\)/, "扫描停止原因必须由 scanStopState 派生");
	assert.match(template, /cappedReason/, "扫描状态必须记录停止原因");
	assert.match(template, /\[tokens\.length, lineCap\]/, "renderedCount 的 memo 必须依赖 lineCap");
	assert.match(template, /tokenizePiece\(chunksRef\.current, piece, lang\)/, "appendPiece 必须走带状态的 tokenizePiece");
	assert.match(template, /tokenState: tokenized\.state/, "分块对象必须保存跨行分词状态");
});

/** 从模板里取出 zh / en 词典的键（模板是唯一事实来源）。 */
function localeKeys(block) {
	const keys = [];
	for (const match of block.matchAll(/^\s*"([^"]+)"\s*:/gm)) keys.push(match[1]);
	return keys;
}

test("客户端模板：zh / en 词典键完全一致，且没有漏翻译的 t(\"...\")", () => {
	const zhStart = template.indexOf("\t\tconst zh = {");
	const enStart = template.indexOf("\t\tconst en = {");
	assert.notEqual(zhStart, -1, "找不到 zh 词典");
	assert.notEqual(enStart, -1, "找不到 en 词典");
	assert.ok(enStart > zhStart);
	const zh = localeKeys(template.slice(zhStart, enStart));
	const en = localeKeys(template.slice(enStart, template.indexOf("\t\t};", enStart)));
	assert.ok(zh.length > 50 && en.length > 50);
	assert.deepEqual([...zh].sort(), [...en].sort(), "zh / en 词典键必须完全一致");
	// 命中上限的新文案两边都要有
	assert.ok(zh.includes("search.scanHitCap"));
	assert.ok(en.includes("search.scanHitCap"));

	// 模板里所有字面量 t("…") 都必须能在两个词典里找到
	const used = new Set();
	for (const match of template.matchAll(/\bt\("([a-z][A-Za-z0-9.]*)"\)/g)) used.add(match[1]);
	const zhSet = new Set(zh);
	const enSet = new Set(en);
	const missingZh = [...used].filter((key) => !zhSet.has(key));
	const missingEn = [...used].filter((key) => !enSet.has(key));
	assert.deepEqual(missingZh, [], "zh 词典缺少：" + missingZh.join(", "));
	assert.deepEqual(missingEn, [], "en 词典缺少：" + missingEn.join(", "));
});
