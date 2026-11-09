/**
 * dsh-code-nav — 大文件分块（纯函数，浏览器/node 通用）。
 *
 * 查看器不再一次性 tokenize 整个文件：按行边界把 content 切成 CHUNK_CHARS 大小的
 * 块，每块单独分词后追加到行数组。内存与主线程开销因此与「用户已经看过多少」
 * 成正比，而不是与文件大小成正比。
 *
 * 超过 5MB 的文件宿主不给 content（只给 `{size, largeFile}`）：同一套分块模型下
 * 由客户端用 `sidebar/api/fs.readPage` 逐页拉取（宿主页 128KiB），再用 chunkFromRead
 * 归一成同样的 `{text, raw, lines, nextOffset, eof, pending}` 形状。
 *
 * **页边界不保证对齐整行**：宿主把窗口裁到最后一个换行，但「整页一个换行都没有」
 * （单行 > 128KiB，例如压缩后的 JS / JSON.stringify 结果）时**不裁剪**，原样返回
 * 并期望客户端把连续几页拼回同一行（dsh-better-sidebar `readPage` / PAGE_BYTES 注释）。
 * chunkFromRead 因此多一个 `pending`（跨页半行）：非 eof 页只有最后一个换行之前的
 * 内容算整行，后面那段留给下一页；eof 时才把 pending 补成最后一行。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/** 内存态每次切出的字符数（按字符而非字节；纯 ASCII 文件两者相同）。 */
export const CHUNK_CHARS = 256 * 1024;

/** 首次打开时连续加载的目标字符数（约两页），让首屏不必立刻触底。 */
export const INITIAL_CHUNK_CHARS = 512 * 1024;

/** 预览允许累积的行数上限（DOM 与内存的双重兜底）。 */
export const MAX_PREVIEW_LINES = 50000;

/**
 * 单块超过这个字符数、且整块只有一行时跳过分词：超长单行的 tokenize 成本
 * 比同体积多行高一个数量级，而渲染端本来就会把这种行降级成纯文本。
 */
export const PLAIN_CHUNK_CHARS = 200000;

/**
 * 文本行数（与客户端「共 N 行」及 tokenize 的 `\r?\n` 切分一致）。
 * 空文本按 0 行处理。
 * @param {unknown} text
 * @returns {number}
 */
export function lineCountOf(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	let count = 1;
	for (let i = 0; i < text.length; i += 1) {
		if (text.charCodeAt(i) === 10) count += 1;
	}
	return count;
}

/** 按 `\r?\n` 切行；空文本返回空数组（不是 [""]）。 */
function splitRawLines(text) {
	if (text === "") return [];
	return text.split(/\r?\n/);
}

/**
 * 把「一次读到的新文本」归一成一个分块。
 *
 * - eof 分块保留末尾换行产生的空行（它与文件的行数口径一致）。
 * - 非 eof 分块只把**最后一个换行之前**的内容当成整行：那个 `\n` 是分隔符，
 *   不是一行；下一块从 nextOffset 开始，行号因此不会重复或跳号。`\r\n` 一并
 *   去掉，行内文本与 `content.split(/\r?\n/)` 的结果保持一致。
 * - `carry`（上一块留下的 `pending`）先拼到本页文本前面再切行。宿主遇到
 *   「单行 > 页大小」时返回**未裁剪**的窗口，此时本页可能整页没有换行 ——
 *   那一段不是一行，而是同一行的一部分，必须留给下一页；否则一个 5MB 的长行
 *   会被切成 40 多行，之后每一行的行号（以及查找行号、chip 行号）全部错位。
 * - 输入本来就是整行对齐时（carry 为空、页以换行结尾）`pending` 为 `""`，
 *   行为与加 carry 之前逐字一致。
 *
 * @param {unknown} text 宿主 readPage 返回的 text（可能带末尾换行）
 * @param {unknown} nextOffset 下一块的起始偏移（字节/字符由调用方决定）
 * @param {unknown} eof 是否已读到文件末尾
 * @param {unknown} [carry] 上一块返回的 pending（跨页半行）
 * @returns {{text:string, raw:string, lines:string[], nextOffset:number, eof:boolean, endsWithBreak:boolean, pending:string}}
 */
export function chunkFromRead(text, nextOffset, eof, carry) {
	const page = typeof text === "string" ? text : "";
	const tail = typeof carry === "string" && carry.length > 0 ? carry : "";
	const raw = tail + page;
	const end = typeof nextOffset === "number" && nextOffset > 0 ? nextOffset : 0;
	const isEof = eof === true;
	if (raw === "") {
		return { text: "", raw: "", lines: [], nextOffset: end, eof: isEof, endsWithBreak: false, pending: "" };
	}
	const endsWithBreak = raw.charCodeAt(raw.length - 1) === 10;
	if (isEof) {
		// 文件末尾：pending 在这里补成最后一行（没有换行也是完整的一行）。
		return { text: raw, raw: raw, lines: splitRawLines(raw), nextOffset: end, eof: true, endsWithBreak: endsWithBreak, pending: "" };
	}
	// 非 eof：最后换行之后是跨页半行。整页没有换行时一行都不产出（全部 pending）。
	const breakAt = raw.lastIndexOf("\n");
	if (breakAt === -1) {
		return { text: "", raw: raw, lines: [], nextOffset: end, eof: false, endsWithBreak: false, pending: raw };
	}
	const complete = raw.slice(0, breakAt + 1);
	const pending = raw.slice(breakAt + 1);
	let body = complete;
	// 去掉末尾那一个行分隔符（`\r\n` 两个字符一起）：它是分隔符，不是一行。
	if (complete.length > 1 && complete.charCodeAt(complete.length - 2) === 13) body = complete.slice(0, -2);
	else body = complete.slice(0, -1);
	const lines = splitRawLines(complete);
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return { text: body, raw: raw, lines: lines, nextOffset: end, eof: false, endsWithBreak: pending === "", pending: pending };
}

/**
 * 从内存中的完整文本切出下一块。
 *
 * 结束点尽量落在整行边界上（含该行换行）；窗口内一个换行都没有时向后延长到
 * 下一行结尾 —— 宁可一块超预算，也不能把一行劈成两段，否则行号、划选和
 * 「跳转到第 N 行」全部错位。
 *
 * @param {unknown} text 完整文件内容
 * @param {unknown} offset 起始偏移（字符）
 * @param {number} [maxChars] 单块字符预算
 * @returns {{text:string, raw:string, lines:string[], nextOffset:number, eof:boolean, endsWithBreak:boolean, pending:string}}
 */
export function planChunk(text, offset, maxChars) {
	const source = typeof text === "string" ? text : "";
	const len = source.length;
	const start = typeof offset === "number" && offset > 0 ? offset : 0;
	if (start >= len) {
		return { text: "", raw: "", lines: [], nextOffset: start, eof: true, endsWithBreak: false, pending: "" };
	}
	const budget = typeof maxChars === "number" && maxChars > 0 ? maxChars : CHUNK_CHARS;
	const limit = Math.min(start + budget, len);
	let end = limit;
	let eof = limit >= len;
	if (!eof) {
		const lastBreak = source.lastIndexOf("\n", end - 1);
		if (lastBreak >= start) {
			end = lastBreak + 1;
		} else {
			const nextBreak = source.indexOf("\n", end);
			end = nextBreak === -1 ? len : nextBreak + 1;
		}
		eof = end >= len;
	}
	return chunkFromRead(source.slice(start, end), end, eof);
}

/**
 * 该块是否应跳过分词（超长单行）。
 * @param {unknown} text
 * @returns {boolean}
 */
export function chunkNeedsPlain(text) {
	if (typeof text !== "string" || text.length === 0) return false;
	const body = text.charCodeAt(text.length - 1) === 10
		? text.slice(0, text.length - 1)
		: text;
	return body.length > PLAIN_CHUNK_CHARS && body.indexOf("\n") === -1;
}
