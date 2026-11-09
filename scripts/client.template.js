/**
 * dsh-code-nav — client bundle（由 scripts/build.mjs 从 src/*.js 内联生成，
 * 勿手改 lib/client.js 的「pure modules」区段）。
 *
 * 依赖 dsh-better-sidebar 的 ctx.betterSidebar 服务，注册一个代码文件预览器：
 *  - 按扩展名识别语言 → 轻量语法高亮
 *  - 符号大纲（class / method / variable 筛选 + 跳转）
 *  - 文件内查找（高亮全部匹配、上/下一处、大小写切换）
 *  - 选中文字 → 浮动「添加到对话」按钮（落成一枚可点击的引用 chip，
 *    发送时展开为与内置查看器同一形状的围栏块）
 *
 * @module dsh-code-nav/client
 */
window.__ModuleLoader__.load({
	// 由 scripts/build.mjs 从 package.json 的 name 注入：client-modules 的
	// module table key 就是包名，二者必须逐字一致，否则客户端 bundle 加载后
	// 会「loaded without registering "<id>"」。
	id: "__CN_PACKAGE_NAME__",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let jsx = react_jsx_runtime.jsx;
		let jsxs = react_jsx_runtime.jsxs;
		// 「添加到对话」浮层 portal 到 document.body：面板本身可能带 transform
		// （收起时被平移出屏），position:fixed 挂在面板里会跟着一起跑。
		let createPortal = require("react-dom").createPortal;

		//#region pure modules (inlined by scripts/build.mjs)
		// __CN_PURE__
		//#endregion

		//#region styles
		const css = [
			".cn-root{position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;line-height:20px;color:var(--cn-plain);--cn-match-bg:rgba(255,213,0,.45);--cn-match-cur:rgba(255,170,0,.6)}",
			".cn-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px 0;min-width:0}",
			".cn-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--cn-fg)}",
			".cn-badge{flex:none;border:1px solid var(--cn-border);background:var(--cn-badge-bg);color:var(--cn-badge-fg);border-radius:9px;padding:1px 7px;font-size:11px;line-height:16px;white-space:nowrap}",
			".cn-bar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px 0;flex-wrap:wrap}",
			".cn-chip{border:1px solid var(--cn-border);background:transparent;color:var(--cn-dim);border-radius:8px;padding:1px 8px;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}",
			".cn-chip:hover{color:var(--cn-fg)}",
			".cn-chip.on{background:var(--cn-accent-bg);border-color:var(--cn-accent);color:var(--cn-accent);font-weight:500}",
			".cn-symbtn{border:1px solid var(--cn-border);background:transparent;color:var(--cn-fg);border-radius:8px;padding:1px 8px;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}",
			".cn-symbtn:hover{border-color:var(--cn-accent);color:var(--cn-accent)}",
			".cn-search{flex:1;min-width:80px;display:flex;align-items:center;gap:4px;border:1px solid var(--cn-border);border-radius:8px;padding:1px 4px 1px 8px;background:var(--cn-input-bg)}",
			".cn-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--cn-fg);font-size:12px;line-height:20px;padding:0}",
			".cn-search input::placeholder{color:var(--cn-dim3)}",
			".cn-count{flex:none;color:var(--cn-dim);font-size:11px;white-space:nowrap;min-width:34px;text-align:center}",
			".cn-mini{border:none;background:transparent;color:var(--cn-dim);cursor:pointer;border-radius:5px;font-size:12px;line-height:18px;padding:0 4px}",
			".cn-mini:hover{color:var(--cn-accent)}",
			".cn-mini.on{color:var(--cn-accent)}",
			// 宿主的全局样式常把 outline:none 套在 button 上，键盘用户就没了落点
			".cn-chip:focus-visible,.cn-symbtn:focus-visible,.cn-mini:focus-visible,.cn-symclose:focus-visible,.cn-search input:focus-visible{outline:2px solid var(--cn-accent);outline-offset:1px}",
			".cn-ico{width:14px;height:14px;display:inline-block;vertical-align:-2px;fill:currentColor}",
			".cn-warn{flex:none;color:var(--cn-warn);background:var(--cn-warn-bg);border-radius:6px;padding:3px 10px;font-size:12px;line-height:16px;margin:6px 10px 0}",
			".cn-body{position:relative;flex:1;min-height:0;overflow:auto;margin-top:6px;border-top:1px solid var(--cn-border)}",
			// 代码区可聚焦：键盘用户要能用 Shift+方向键选代码、再用 Tab 到「添加到对话」
			// （滚动区域本身也应该能 Tab 进去用方向键滚动）。
			".cn-body:focus-visible{outline:2px solid var(--cn-accent);outline-offset:-2px}",
			// 读屏专用文本：视觉上隐藏但不从无障碍树里移除（aria-live 播报用）。
			".cn-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
			".cn-code{min-width:max-content;padding:4px 0 16px}",
			// 窗口化后 DOM 里只有视口附近的行，`min-width:max-content` 会跟着窗口
			// 变化 → 横向滚动条宽度随滚动抖动。这条 0 高的隐藏行始终承载「已加载
			// 行里最宽的一行」，把横向宽度钉住（高 0 + overflow:hidden 不影响滚动高度）。
			".cn-ruler{height:0;overflow:hidden;visibility:hidden}",
			".cn-line{display:flex;padding:0 10px 0 0}",
			".cn-line:hover{background:var(--cn-line-hover)}",
			".cn-line.flash{background:var(--cn-flash);animation:cn-flash 1.4s ease-out}",
			"@keyframes cn-flash{0%{background:var(--cn-flash-strong)}100%{background:var(--cn-flash)}}",
			".cn-ln{flex:none;width:44px;padding-right:10px;text-align:right;color:var(--cn-ln);user-select:none;font-size:12px;line-height:20px}",
			".cn-code-wrap{flex:1;white-space:pre;min-width:0}",
			".cn-code-wrap .cn-c{color:var(--cn-comment);font-style:italic}",
			".cn-code-wrap .cn-s{color:var(--cn-string)}",
			".cn-code-wrap .cn-k{color:var(--cn-kw)}",
			".cn-code-wrap .cn-t{color:var(--cn-type)}",
			".cn-code-wrap .cn-n{color:var(--cn-num)}",
			".cn-code-wrap .cn-f{color:var(--cn-fn)}",
			".cn-code-wrap .cn-i{color:var(--cn-ident)}",
			".cn-code-wrap .cn-key{color:var(--cn-key)}",
			".cn-code-wrap .cn-sec{color:var(--cn-section)}",
			".cn-code-wrap .cn-tag{color:var(--cn-tag)}",
			".cn-code-wrap .cn-attr{color:var(--cn-attr)}",
			".cn-code-wrap .cn-m{background:var(--cn-match-bg);border-radius:2px}",
			".cn-code-wrap .cn-cu{background:var(--cn-match-cur);outline:1px solid var(--cn-match-cur);border-radius:2px}",
			".cn-plain{white-space:pre;padding:8px 12px;color:var(--cn-ident);font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px}",
			".cn-sympop{position:absolute;top:30px;right:10px;left:10px;z-index:60;max-height:calc(100% - 46px);overflow:auto;border:1px solid var(--cn-border);border-radius:10px;background:var(--cn-pop-bg);box-shadow:0 8px 28px rgba(0,0,0,.28);padding:4px}",
			".cn-symhead{display:flex;align-items:center;gap:8px;padding:4px 8px 6px;font-size:12px;color:var(--cn-dim);border-bottom:1px solid var(--cn-border);margin-bottom:4px}",
			".cn-symclose{margin-left:auto;border:none;background:transparent;color:var(--cn-dim);cursor:pointer;font-size:14px;line-height:16px;border-radius:5px;padding:0 6px}",
			".cn-symclose:hover{color:var(--cn-accent)}",
			".cn-symrow{display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:7px;cursor:pointer;font-size:12px;line-height:18px}",
			".cn-symrow:hover{background:var(--cn-line-hover)}",
			".cn-symrow:focus-visible{outline:2px solid var(--cn-accent);outline-offset:-2px;background:var(--cn-line-hover)}",
			".cn-symkind{flex:none;font-size:10px;line-height:14px;border-radius:5px;padding:0 5px;color:var(--cn-accent);border:1px solid var(--cn-accent);opacity:.9}",
			".cn-symname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cn-fg)}",
			".cn-symname .cn-symcont{color:var(--cn-dim)}",
			".cn-symline{flex:none;color:var(--cn-dim3);font-size:11px}",
			".cn-empty{padding:24px 16px;text-align:center;color:var(--cn-dim3);font-size:12px}",
			// 分页 / 分块加载：顶部说明 + 底部「加载更多 / 全部加载 / 下载」条
			".cn-note{flex:none;margin:6px 10px 0;font-size:12px;line-height:16px;color:var(--cn-dim)}",
			".cn-more{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 10px 18px;border-top:1px solid var(--cn-border);margin-top:8px}",
			".cn-more-text{font-size:12px;line-height:16px;color:var(--cn-dim)}",
			".cn-more-err{font-size:12px;line-height:16px;color:var(--cn-warn)}",
			".cn-more-link{font-size:12px;line-height:16px;color:var(--cn-accent);text-decoration:none;border-radius:4px}",
			".cn-more-link:hover{text-decoration:underline}",
			".cn-more-link:focus-visible{outline:2px solid var(--cn-accent);outline-offset:2px}",
			".cn-shade{position:absolute;inset:0;z-index:59;background:transparent}",
			// 选中文字浮层：与 better-sidebar 内置查看器的 .selectionPopup 同一观感
			// （dsw 令牌优先，缺失时回落到本插件调色板变量）。
			".cn-selpop{position:fixed;z-index:60;transform:translate(-50%,calc(-100% - 8px));display:inline-flex;align-items:center;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,var(--cn-selpop-border));border-radius:6px;background:var(--dsw-alias-bg-layer-2,var(--cn-selpop-bg));color:var(--dsw-alias-label-primary,var(--cn-selpop-fg));font-size:11px;font-weight:500;line-height:16px;white-space:nowrap;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.24)}",
			".cn-selpop:hover{background:var(--dsw-alias-interactive-bg-hover,var(--cn-selpop-hover))}"
		].join("");
		// 样式标签的两个标记都必须用**完整包名**，而不是短名：
		// client-modules 的 HMR 记账以包名为 key —— 失效/替换一个插件时它执行
		// `removeOwnedStyles(id)`，即 `querySelectorAll("style[data-plugin]")` 里
		// 删掉 `data-plugin === <包名>` 的标签。写成短名（"dsh-code-nav"）时
		// 这条查询永远匹配不到本插件的 <style>，于是卸载/HMR 后样式表被遗留在
		// document.head 里，越积越多。同生态的其它插件（dsh-better-sidebar、
		// @whybebabo/dsh-file-review-tab）都用完整包名，这里对齐。
		const PACKAGE_NAME = "__CN_PACKAGE_NAME__";
		const tagId = PACKAGE_NAME + "/styles.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = PACKAGE_NAME;
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region palette
		/**
		 * 采集宿主当前配色信号，交给纯函数 `__cn.themeIsDark` 判定。
		 *
		 * 宿主 ThemePresenter 把 token 写在 `<body>` 的 inline style 上，并用
		 * `html { color-scheme }` + `body[data-ds-dark-theme]` 表达最终决定 ——
		 * 从 `<html>` 上读 `--dsw-alias-*` 永远读不到（custom property 只向下继承）。
		 * 所以顺序是：color-scheme 权威 → 系统偏好 → 背景色（透明不算深色）。
		 */
		function detectDark() {
			try {
				const docEl = document.documentElement;
				const colorScheme = docEl !== null && typeof docEl.style === "object" && docEl.style !== null
					&& typeof docEl.style.colorScheme === "string" ? docEl.style.colorScheme : "";
				const body = document.body;
				const bodyDark = body !== null && body !== undefined && typeof body.hasAttribute === "function"
					? body.hasAttribute("data-ds-dark-theme") : false;
				let prefersDark;
				try {
					prefersDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : undefined;
				} catch (error) {
					prefersDark = undefined;
				}
				let background = "";
				try {
					background = body === null || body === undefined ? "" : getComputedStyle(body).backgroundColor;
				} catch (error) {
					background = "";
				}
				return __cn.themeIsDark({ colorScheme, bodyDark, prefersDark, background });
			} catch {
				return false;
			}
		}
		//#endregion

		//#region selection → draft
		/**
		 * 选区端点所在的行元素（`data-cn-line` 行容器）。
		 * @param {Node|null} node
		 * @param {HTMLElement} host 代码区容器
		 * @returns {HTMLElement|null}
		 */
		function lineElementOf(node, host) {
			let el = node === null || node === undefined ? null : (node.nodeType === 1 ? node : node.parentElement);
			while (el !== null && el !== host) {
				if (typeof el.getAttribute === "function" && el.getAttribute("data-cn-line") !== null) return el;
				el = el.parentElement;
			}
			return null;
		}

		/**
		 * 选区端点在某一行的代码列里的列偏移（0 起）；端点不在该列内返回 null。
		 * @param {HTMLElement} wrap 该行的 `.cn-code-wrap`
		 * @param {Node} node
		 * @param {number} offset
		 * @returns {number|null}
		 */
		function columnInLine(wrap, node, offset) {
			if (node === null || !wrap.contains(node)) return null;
			try {
				const probe = document.createRange();
				probe.selectNodeContents(wrap);
				probe.setEnd(node, offset);
				return probe.toString().length;
			} catch {
				return null;
			}
		}

		/**
		 * 选区 → 源码文本 + 行区间。文本按行的代码列（`.cn-code-wrap`，即原始
		 * 行文本）逐行切片，而不是 `Selection.toString()`：后者会把行号槽（
		 * `user-select:none`，各浏览器处理不一致）和块级换行算进来。取不到行容器
		 * （纯文本兜底视图）或端点在行号槽里时回落到 `Selection.toString()`。
		 *
		 * 端点正好落在末行行首时该行其实没被选中：丢掉这一空行并把行号收窄一行，
		 * 与编辑器里向下拖一行的观感一致。
		 *
		 * @param {HTMLElement} host 代码区容器
		 * @param {Selection} sel 非折叠选区
		 * @returns {{text:string, lines:{start:number,end:number}|undefined}}
		 */
		function selectionOfDom(host, sel) {
			const fallback = { text: sel.toString(), lines: undefined };
			const range = sel.getRangeAt(0);
			const startEl = lineElementOf(range.startContainer, host);
			const endEl = lineElementOf(range.endContainer, host);
			if (startEl === null || endEl === null) return fallback;
			const all = Array.prototype.slice.call(host.querySelectorAll("[data-cn-line]"));
			// 窗口化后 DOM 里只有视口附近的行：不能再按数组下标取 `all[no - 1]`
			// （行号是全局的，数组是局部的）。按 data-cn-line 建索引。
			const byNo = new Map();
			for (const el of all) byNo.set(el.getAttribute("data-cn-line"), el);
			const i0 = all.indexOf(startEl);
			const i1 = all.indexOf(endEl);
			if (i0 === -1 || i1 === -1) return fallback;
			// 文档顺序上的首/末行（向上拖拽时 anchor 在 focus 之后）
			const forward = i0 <= i1;
			const firstEl = forward ? startEl : endEl;
			const lastEl = forward ? endEl : startEl;
			const firstNode = forward ? range.startContainer : range.endContainer;
			const firstOffset = forward ? range.startOffset : range.endOffset;
			const lastNode = forward ? range.endContainer : range.startContainer;
			const lastOffset = forward ? range.endOffset : range.startOffset;
			const firstNo = Number(firstEl.getAttribute("data-cn-line"));
			const lastNo = Number(lastEl.getAttribute("data-cn-line"));
			if (!Number.isFinite(firstNo) || !Number.isFinite(lastNo)) return fallback;
			const firstWrap = firstEl.querySelector(".cn-code-wrap");
			const lastWrap = lastEl.querySelector(".cn-code-wrap");
			if (firstWrap === null || lastWrap === null) return fallback;
			const startCol = columnInLine(firstWrap, firstNode, firstOffset);
			const endCol = columnInLine(lastWrap, lastNode, lastOffset);
			if (startCol === null || endCol === null) return fallback;
			const parts = [];
			for (let no = firstNo; no <= lastNo; no++) {
				const el = byNo.get(String(no));
				const wrap = el === undefined ? null : el.querySelector(".cn-code-wrap");
				if (wrap === null) return fallback;
				const raw = wrap.textContent;
				if (no === firstNo && no === lastNo) parts.push(raw.slice(startCol, endCol));
				else if (no === firstNo) parts.push(raw.slice(startCol));
				else if (no === lastNo) parts.push(raw.slice(0, endCol));
				else parts.push(raw);
			}
			let endLine = lastNo;
			if (parts.length > 1 && parts[parts.length - 1] === "") {
				parts.pop();
				endLine -= 1;
			}
			return { text: parts.join("\n"), lines: { start: firstNo, end: endLine } };
		}

		/**
		 * 会话输入框的 `<textarea>`：优先对话列里带 `data-phase` 标记的那个，
		 * 再退到列内任意 textarea，最后退到全页面带标记的 textarea。
		 * @returns {HTMLTextAreaElement|null}
		 */
		function findComposerTextarea() {
			if (typeof document === "undefined") return null;
			const column = document.querySelector('#root [data-slot="conversation"]');
			const find = (scope) => scope.querySelector("textarea[data-phase]") ?? scope.querySelector("textarea");
			return column !== null ? find(column) : document.querySelector("textarea[data-phase]");
		}

		/**
		 * 从输入框 DOM 读当前光标/选区（草稿 store 没有光标 API）。做值同步校验：
		 * 读到的光标必须是对着同一份草稿量的，否则丢弃（宁可追加到末尾）。
		 * @param {string} draft 当前草稿
		 * @returns {{start:number, end:number}|null}
		 */
		function probeComposerCaret(draft) {
			const el = findComposerTextarea();
			if (el === null || el.disabled || el.readOnly || el.value !== draft) return null;
			const start = el.selectionStart;
			const end = el.selectionEnd;
			if (typeof start !== "number" || typeof end !== "number") return null;
			if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
			const s = Math.max(0, Math.min(start, draft.length));
			const e = Math.max(s, Math.min(end, draft.length));
			return { start: s, end: e };
		}

		/**
		 * 把文本插进草稿（覆盖当前选区），并给出插入文本之后的光标位置；
		 * 光标未知（caret === null）时追加到末尾。两侧按需补一个空格，且不与
		 * 已有空白重复 —— 与手工在句子中间输入的手感一致。
		 * @param {string} draft
		 * @param {string} text
		 * @param {{start:number, end:number}|null} caret
		 * @returns {{draft:string, caretAfter:number}}
		 */
		function spliceInsert(draft, text, caret) {
			if (caret === null || draft === "") {
				const next = draft.trim() === "" ? text : draft + " " + text;
				return { draft: next, caretAfter: next.length };
			}
			const prefix = draft.slice(0, caret.start);
			const suffix = draft.slice(caret.end);
			if (prefix === "" && suffix === "") return { draft: text, caretAfter: text.length };
			const left = prefix === "" || /\s$/.test(prefix) ? "" : " ";
			const right = suffix === "" || /^\s/.test(suffix) ? "" : " ";
			return {
				draft: prefix + left + text + right + suffix,
				caretAfter: prefix.length + left.length + text.length
			};
		}

		/**
		 * 程序化改草稿会把受控 textarea 的光标重置到开头，于是下一次插入会以
		 * 重置位置为基准、连续插入错位。这里在值提交后（最多两帧内、且值仍然
		 * 是自己写的那份）把光标放回插入文本之后。
		 * @param {string} expectedDraft
		 * @param {number} caretIndex
		 */
		function placeCaretAfterInsert(expectedDraft, caretIndex) {
			let remaining = 2;
			let scheduled = false;
			const schedule = (fn) => {
				if (scheduled) return;
				scheduled = true;
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
				else setTimeout(fn, 0);
			};
			const place = () => {
				scheduled = false;
				if (remaining <= 0) return;
				remaining -= 1;
				const el = findComposerTextarea();
				if (el === null || el.disabled || el.readOnly) return;
				if (el.value !== expectedDraft) {
					schedule(place);
					return;
				}
				const at = Math.max(0, Math.min(caretIndex, el.value.length));
				el.setSelectionRange(at, at);
			};
			schedule(place);
		}

		/** 读一次输入面板快照（接口缺失 / 抛错时 undefined）。 */
		function readSnapshot(input) {
			try {
				if (input === undefined || input === null) return undefined;
				const state = input.state;
				if (state === undefined || state === null || typeof state.getSnapshot !== "function") return undefined;
				const snapshot = state.getSnapshot();
				if (typeof snapshot !== "object" || snapshot === null) return undefined;
				return snapshot;
			} catch (error) {
				return undefined;
			}
		}

		/**
		 * 读当前草稿（clipboard 投影：每个引用 chip 展开成它的 clipboardText）。
		 * @param {object} input 会话输入面板（SessionInput）
		 * @returns {string}
		 */
		function readDraft(input) {
			const snapshot = readSnapshot(input);
			return snapshot !== undefined && typeof snapshot.draft === "string" ? snapshot.draft : "";
		}

		/**
		 * 把引用 chip（`occurrences`）与 quote（`quotes`）两套 clipboard 区间合并成
		 * 一份按 offset 升序的折叠表。
		 *
		 * 宿主 `DetectProjection.quotes` 与 `occurrences` 是**分开**的两个数组
		 * （projection.ts：quote 进 `quotes[]`，occurrences 只收 reference chip），
		 * 但在 clipboard 坐标里同样是互不重叠的区间；detect 投影里两类都只占
		 * 1 个 U+FFFC。合并时只保留 offset/length，detectTextOf 不关心节点类型。
		 * @param {ReadonlyArray<{offset:number, length:number}>} occurrences
		 * @param {ReadonlyArray<{offset:number, length:number}>} quotes
		 * @returns {Array<{offset:number, length:number}>}
		 */
		function mergeProjectionUnits(occurrences, quotes) {
			const out = [];
			for (const unit of occurrences) {
				if (unit === null || unit === undefined) continue;
				out.push({ offset: Number(unit.offset), length: Number(unit.length) });
			}
			for (const unit of quotes) {
				if (unit === null || unit === undefined) continue;
				out.push({ offset: Number(unit.offset), length: Number(unit.length) });
			}
			out.sort((a, b) => a.offset - b.offset);
			return out;
		}

		/**
		 * 草稿的 detect 投影（含 command chip / quote 折叠）。
		 *
		 * 宿主把斜杠命令落成一枚 chip：chip 的 clipboardText 是 `claim.token.trimEnd()`，
		 * 而 token 去掉 trimEnd 的那段 separator（通常是 1 个空格）是 chip **之后
		 * 另一个独立的 TextNode**（`runtime.ts` 的 insertCommand：chip + TextNode(separator)）。
		 * 两个投影因此是：
		 *   clipboard = spelling + separator + rest（如 `/goal ship`）
		 *   detect    = U+FFFC + separator + rest（如 `\uFFFC ship`，共 6 字符）
		 * 直接 `detectTextOf(draft)` 会把 token 的每个字符都算进去、插入点整体右移；
		 * 这里按宿主规则还原。separator 被用户删掉（draft 只以 spelling 开头）时
		 * detect 里也没有它，只折 chip。claimed / submitting 两个相位都带 claim，
		 * 检测事件的 replaceText 又没有相位守卫，所以只按 claim 是否存在判断。
		 *
		 * quote 节点（对话区「引用」一段消息）在 detect 投影里同样只占 1 个 U+FFFC，
		 * 但当前 `InputState` **没有** `quotes` 字段（宿主内部 `EditorProjection`
		 * 有，契约尚未转发）。看不到 quotes 时按 occurrences 折出来的文本会把
		 * quote 正文整段算进去 → 比真实 detect 长，插入点两侧的空白判断跟着错位。
		 * 于是返回 `trusted`：quotes 可用 → 精确折叠（true）；草稿里出现了
		 * quote 的 clipboard 痕迹（`^> ` 行，见 `hasQuoteMarkers`）→ false，
		 * 调用方按「宁可多一个空格」保守补偿；其余情况 true。
		 * @param {object|undefined} snapshot InputState 快照
		 * @returns {{text:string, command:boolean, trusted:boolean}} text 的长度是文档末尾 detect 坐标的上界
		 */
		function detectProjectionOf(snapshot) {
			const draft = snapshot !== undefined && typeof snapshot.draft === "string" ? snapshot.draft : "";
			const occurrences = snapshot !== undefined && Array.isArray(snapshot.occurrences) ? snapshot.occurrences : [];
			const quotes = snapshot !== undefined && snapshot !== null && Array.isArray(snapshot.quotes)
				? snapshot.quotes
				: undefined;
			const claim = snapshot !== undefined && snapshot.claim !== undefined && snapshot.claim !== null
				? snapshot.claim
				: undefined;
			// quotes 可用时投影是精确的；看不到 quotes 时只能靠草稿里的 `> ` 行推断
			const trusted = quotes !== undefined || !__cn.hasQuoteMarkers(draft);
			const units = quotes === undefined ? occurrences : mergeProjectionUnits(occurrences, quotes);
			const token = claim !== undefined && typeof claim.token === "string" ? claim.token : "";
			const spelling = token.trimEnd();
			const separator = token.slice(spelling.length);
			if (spelling.length === 0 || !draft.startsWith(spelling)) {
				return { text: __cn.detectTextOf(draft, units), command: false, trusted: trusted };
			}
			/** 把折叠单元的 offset 从 clipboard 坐标平移到 `rest` 的局部坐标。 */
			const rebase = (from) => {
				const rest = draft.slice(from);
				const rebased = [];
				for (const unit of units) {
					if (unit === null || unit === undefined) continue;
					const offset = Number(unit.offset);
					const length = Number(unit.length);
					if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
					if (offset < from) continue;
					rebased.push({ offset: offset - from, length: length });
				}
				return __cn.detectTextOf(rest, rebased);
			};
			// draft 里还在 separator：chip 折成 1 个字符，separator 原样算回 detect。
			if (draft.startsWith(token)) {
				return { text: __cn.CHIP_PLACEHOLDER + separator + rebase(token.length), command: true, trusted: trusted };
			}
			// separator 已被删掉：chip 后面直接是用户内容。
			return { text: __cn.CHIP_PLACEHOLDER + rebase(spelling.length), command: true, trusted: trusted };
		}

		/**
		 * 按插入区间两侧的空白情况给载荷补分隔空格。
		 *
		 * 区间与文本都必须是 **detect 投影**（chip 折成 1 个 U+FFFC）：拿 clipboard
		 * 投影的 draft 去切 detect 坐标，草稿里有 chip 时前缀长度会整体错位，前后
		 * 空格判断跟着错（F11）。
		 *
		 * `trusted === false` 时投影里可能漏折了 quote（宿主没暴露 quotes），
		 * 前缀/后缀从哪里切开都是错位的：此时**只要那一侧有内容就补空格**
		 * ——多一个空格无害，少一个才会和前面的文字粘连（C-2 保守补偿）。
		 * @param {string} detectText detect 投影草稿
		 * @param {{start:number,end:number}} span
		 * @param {string} text
		 * @param {boolean} [trusted] 投影是否可信（缺省 true，兼容旧调用）
		 * @returns {string}
		 */
		function paddedInsert(detectText, span, text, trusted) {
			const source = typeof detectText === "string" ? detectText : "";
			const rawStart = typeof span.start === "number" ? span.start : 0;
			const rawEnd = typeof span.end === "number" ? span.end : rawStart;
			const start = Math.max(0, Math.min(rawStart, source.length));
			const end = Math.max(start, Math.min(rawEnd, source.length));
			const prefix = source.slice(0, start);
			const suffix = source.slice(end);
			if (prefix === "" && suffix === "") return text;
			const exact = trusted !== false;
			const left = prefix === "" ? "" : (exact && /\s$/.test(prefix) ? "" : " ");
			const right = suffix === "" ? "" : (exact && /^\s/.test(suffix) ? "" : " ");
			return left + text + right;
		}

		/**
		 * 私有 composer actions 的能力探测：捕获与插入两件都齐全才算可用。缺一件
		 * 时绝不能当成「宿主拒绝」—— 那是旧版宿主，应该继续走公开事件通道（F5）。
		 * @param {object|undefined} actions
		 * @returns {boolean}
		 */
		function canUseInsertActions(actions) {
			return actions !== undefined && actions !== null
				&& typeof actions.captureInsertion === "function"
				&& typeof actions.insertText === "function";
		}

		/**
		 * 官方插入路径：DSH 的会话输入面板公开 `actions.captureInsertion()` /
		 * `actions.insertText(text, span)`（一次可撤销的纯文本编辑，带草稿版本
		 * 守卫，会保留引用 chip 与用户的后续编辑）。比 DOM 探光标 + setDraft 整串
		 * 回写稳得多，因此优先走它。
		 * @param {object} input
		 * @param {string} text
		 * @returns {boolean} 是否插入成功
		 */
		function insertViaActions(input, text) {
			const actions = input.actions;
			if (!canUseInsertActions(actions)) return false;
			const attempt = () => {
				const span = actions.captureInsertion();
				if (span === undefined || span === null) return false;
				if (typeof span.start !== "number" || typeof span.end !== "number") return false;
				const projection = detectProjectionOf(readSnapshot(input));
				return actions.insertText(paddedInsert(projection.text, span, text, projection.trusted), span) === true;
			};
			// 点击即插，正常一次就中；被拒说明捕获之后草稿又被改动、或编辑器正在
			// 提交 —— 重捕一次再试。
			return attempt() || attempt();
		}

		/**
		 * 公开插入路径：`actx.emit("slash/input-insert-text", {text, span})`。
		 *
		 * 不依赖 `input.actions` 这类宿主私有实现（F5）：只走会话 scope 上公开的
		 * 事件通道。事件只能追加到 detect 文档末尾，坐标用同一套 command-chip 折叠
		 * 公式；emit 后再读一次快照，以 `draftRev` 是否前进判定成功。
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @param {string} text
		 * @returns {boolean} 是否已插入
		 */
		function insertTextViaEvent(ctx, sessionId, text) {
			try {
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined || actx === null || typeof actx.emit !== "function") return false;
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined || conversation === null) return false;
				const input = conversation.input.for(actx);
				if (typeof input !== "object" || input === null) return false;
				const before = readSnapshot(input);
				if (before === undefined || typeof before.draftRev !== "number" || !Number.isFinite(before.draftRev)) return false;
				const draft = typeof before.draft === "string" ? before.draft : "";
				const projection = detectProjectionOf(before);
				const at = projection.text.length;
				// 事件通道只能追加到末尾：左侧补分隔空格；尾部空格由宿主 / 后续内容负责。
				// 投影不可信（草稿里可能有未折的 quote）时看不见前一个字符是什么，
				// 只要草稿非空就补一个空格 —— 多一个空格无害，粘连才是错的。
				const lead = draft.trim() === ""
					? ""
					: projection.trusted === false || !/\s$/.test(draft) ? " " : "";
				actx.emit("slash/input-insert-text", {
					text: lead + text,
					span: { draftRev: before.draftRev, start: at, end: at }
				});
				const after = readSnapshot(input);
				return after !== undefined && typeof after.draftRev === "number" && after.draftRev !== before.draftRev;
			} catch (error) {
				console.warn("[dsh-code-nav] draft insert event failed:", error);
				return false;
			}
		}

		/**
		 * 最近一次 appendToDraft 失败是否属于「宿主明确拒绝」（F15 诊断用）。
		 * 只在同步调用链里置位，insertSelection 在 appendToDraft 返回后立即读取。
		 */
		let lastDraftRefusal = false;

		/**
		 * 把一段文本插进当前会话的输入框草稿，按可用性逐级选择通道：
		 *  1. 私有 `input.actions.captureInsertion()` / `insertText()`（能力齐全时）；
		 *  2. 公开的 `actx.emit("slash/input-insert-text", ...)`（不依赖私有实现）；
		 *  3. 旧版 DSH 的「DOM 探光标 + setDraft」整串回写（最后手段）。
		 * conversation 服务按名取（与宿主自身插件同一读法），取不到只告警、不抛出
		 * —— 预览器不能因为一次插入失败而崩掉。
		 * @param {object} ctx 客户端插件上下文
		 * @param {string} sessionId
		 * @param {string} text
		 * @returns {boolean} 是否写入成功
		 */
		function appendToDraft(ctx, sessionId, text) {
			lastDraftRefusal = false;
			try {
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) {
					console.warn("[dsh-code-nav] draft insert skipped: no session scope", sessionId);
					return false;
				}
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined || conversation === null) {
					console.warn("[dsh-code-nav] draft insert skipped: conversation service unavailable");
					return false;
				}
				const input = conversation.input.for(actx);
				if (typeof input !== "object" || input === null) return false;
				if (canUseInsertActions(input.actions)) {
					let refused = false;
					try {
						if (insertViaActions(input, text)) return true;
						refused = true;
					} catch (error) {
						// actions 自身抛错：当作该能力不可用，继续走后面的通道（不吞掉插入）。
						console.warn("[dsh-code-nav] composer actions threw; falling back:", error);
					}
					if (refused) {
						// 官方接口明确拒绝：草稿正忙或被改过。不动用户的草稿，留给他自己
						// 重试（这正是 insertText 的契约：结果由调用方保留）。
						lastDraftRefusal = true;
						console.warn("[dsh-code-nav] draft insert refused: draft is busy or moved");
						return false;
					}
				}
				// 公开事件通道：宿主自己按 detect 坐标落文本；旧版 actions 缺失时也能用（F5）。
				if (insertTextViaEvent(ctx, sessionId, text)) return true;
				// 旧版 DSH 回退：既没有可用的 actions 也没有事件通道时才整串回写草稿。
				const draft = readDraft(input);
				const spliced = spliceInsert(draft, text, probeComposerCaret(draft));
				input.setDraft(spliced.draft);
				placeCaretAfterInsert(spliced.draft, spliced.caretAfter);
				return true;
			} catch (error) {
				console.warn("[dsh-code-nav] draft insert failed:", error);
				return false;
			}
		}

		/** 本实例累计发出的插入提示数（commitSelPop 据此判断是否已说过具体原因）。 */
		let insertNoticeCount = 0;

		/**
		 * 插入降级 / 失败时向输入框送一条带原因的提示（F15）。
		 * 与 `selection.conflict` 的 generic 提示互斥：commitSelPop 只在
		 * insertSelection(false) 且一条具体提示都没发过时才补 generic。
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @param {"info"|"error"} level
		 * @param {string} key 文案键
		 * @returns {boolean} 是否送达
		 */
		function announceInsertNotice(ctx, sessionId, level, key) {
			insertNoticeCount += 1;
			return notifyComposer(ctx, sessionId, level, ctxLocale(ctx)(key));
		}

		/**
		 * 把一次选区写进会话草稿：可点击引用 chip → 本插件自己的纯文本 chip →
		 * 纯文本围栏块 —— 绝不静默丢载荷。
		 *
		 * 失败要分级（F15）：chip 通道缺失导致降级成纯文本时说清楚；composer 明确
		 * 拒绝时说「输入框忙/草稿变了」；两者都不混成同一句「输入框正忙」。
		 * @param {object} ctx 客户端插件上下文
		 * @param {string} sessionId
		 * @param {{path:string, cwd?:string, lines?:{start:number,end:number}, text:string}} sel
		 * @returns {boolean} 是否写入成功
		 */
		function insertSelection(ctx, sessionId, sel) {
			if (insertQuoteChip(ctx, sessionId, sel)) return true;
			if (insertFallbackChip(ctx, sessionId, sel)) return true;
			const text = __cn.selectionPayload(sel.path, sel.cwd, sel.lines, sel.text).text;
			if (appendToDraft(ctx, sessionId, text)) {
				// 两档 chip 都没落成：告知「已按纯文本插入」，别让点击看起来毫无反应。
				announceInsertNotice(ctx, sessionId, "info", "selection.noChipChannel");
				return true;
			}
			announceInsertNotice(
				ctx,
				sessionId,
				"error",
				lastDraftRefusal ? "selection.insertRefused" : "selection.noChipChannel"
			);
			return false;
		}

		/**
		 * 通过官方 `SessionInput.notify(level, text)` 往该会话的输入框送一条提示
		 * （接口缺失/会话未绑定时静默跳过）。
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @param {"info"|"error"} level
		 * @param {string} text
		 * @returns {boolean} 是否送达
		 */
		function notifyComposer(ctx, sessionId, level, text) {
			try {
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined || conversation === null) return false;
				const input = conversation.input.for(actx);
				if (input === undefined || input === null || typeof input.notify !== "function") return false;
				input.notify(level, text);
				return true;
			} catch (error) {
				return false;
			}
		}
		//#endregion

		//#region quote source
		/**
		 * 引用 chip 的 input-trigger source 名。chip 只借 `@` 通道存在，不参与
		 * @ 菜单（candidates 恒空），只回答点击（openReference）与发送时展开
		 * （codec.serialize）—— 与 better-sidebar 的 `betterSidebarQuote` 同构，
		 * 两个插件各用各的 source 名，互不冲突。
		 */
		const QUOTE_SOURCE = "codeNavQuote";
		/**
		 * 纯文本 chip 的第二个 source 名（F8）。宿主内置的 `reference` source
		 * 不是每个版本都有；插件自带一个恒等 codec 的 source，发送时把 ref 原样
		 * 展开成文本，于是中间降级档不再依赖宿主的实现。
		 */
		const QUOTE_TEXT_SOURCE = "codeNavQuoteText";
		/** 自包含 ref 的前缀：ref 里直接携带发送 / 展示 / 点击所需的全部字段。 */
		const QUOTE_REF_PREFIX = "cnq1:";
		/** 旧版引用记录的 localStorage key（只读兼容；新 chip 不再写存储）。 */
		const QUOTE_STORE_KEY = "dsh-code-nav:quote-refs";
		/** 宿主 input-trigger 服务晚于插件 apply 就绪时的重试次数与间隔。 */
		const QUOTE_REGISTER_RETRIES = 20;
		const QUOTE_RETRY_MS = 500;

		/** 旧版记录 id → 记录（只读缓存；新 chip 的 ref 自包含，不落这里）。 */
		const quoteRecords = new Map();
		let quoteStoreLoaded = false;

		/** 旧版持久化记录的长度上限：超出视为损坏数据，整条跳过（F16）。 */
		const QUOTE_TEXT_MAX_CHARS = 1024 * 1024;
		const QUOTE_CLIPBOARD_MAX_CHARS = 8192;
		const QUOTE_PAYLOAD_MAX_CHARS = 4096;

		/**
		 * 一条**旧版**持久化记录的形状校验。新 chip 的 ref 自包含，走
		 * {@link parseQuoteRef}；这里只服务存储里遗留的 q… 记录：字段缺失 / 类型
		 * 不对 / 长度离谱就整条跳过（存储损坏时宁可不显示，也不要在点击或发送时
		 * 抛错）。cwd / lines 是可选字段，出现时必须形状正确。
		 * @param {*} value
		 * @returns {boolean}
		 */
		function isQuoteRecord(value) {
			if (typeof value !== "object" || value === null) return false;
			const record = value;
			if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 200) return false;
			if (typeof record.sessionId !== "string" || record.sessionId.length > 200) return false;
			if (typeof record.n !== "number" || !Number.isFinite(record.n)) return false;
			if (typeof record.path !== "string" || record.path.length === 0 || record.path.length > QUOTE_PAYLOAD_MAX_CHARS) return false;
			if (typeof record.label !== "string" || record.label.length > QUOTE_CLIPBOARD_MAX_CHARS) return false;
			if (typeof record.clipboardText !== "string" || record.clipboardText.length > QUOTE_CLIPBOARD_MAX_CHARS) return false;
			if (typeof record.text !== "string" || record.text.length > QUOTE_TEXT_MAX_CHARS) return false;
			if (record.cwd !== undefined && (typeof record.cwd !== "string" || record.cwd.length > QUOTE_PAYLOAD_MAX_CHARS)) return false;
			if (record.lines !== undefined) {
				if (typeof record.lines !== "object" || record.lines === null) return false;
				const start = record.lines.start;
				const end = record.lines.end;
				if (typeof start !== "number" || !Number.isFinite(start)) return false;
				if (typeof end !== "number" || !Number.isFinite(end)) return false;
			}
			return true;
		}

		/**
		 * 生成自包含 ref：`cnq1:` + JSON。发送展开（text）、剪贴板投影
		 * （clipboardText）、点击落地（path/cwd/lines）所需的字段都在 ref 里，
		 * 于是刷新、换标签页、清空 localStorage 都不会把它变成「死 chip」——
		 * 旧实现把载荷放存储，FIFO 淘汰或写入被拒后就再也解析不到了。
		 * cwd / lines 缺省不写：JSON 少一个键就是「没有会话 cwd / 没有行区间」。
		 * @param {{path:string, cwd?:string, lines?:{start:number,end:number}, label:string, clipboardText:string, text:string}} record
		 * @returns {string}
		 */
		function makeQuoteRef(record) {
			const payload = {
				v: 1,
				path: record.path,
				label: record.label,
				clipboardText: record.clipboardText,
				text: record.text
			};
			if (typeof record.cwd === "string") payload.cwd = record.cwd;
			if (record.lines !== undefined && record.lines !== null) {
				payload.lines = { start: record.lines.start, end: record.lines.end };
			}
			return QUOTE_REF_PREFIX + JSON.stringify(payload);
		}

		/**
		 * 解析自包含 ref。任何解析失败 / 版本不符 / 关键字段缺失都返回 undefined，
		 * 让调用方回退旧 store 路径（而不是在发送时抛解析异常）。
		 * @param {*} ref
		 * @returns {{v:number, path:string, cwd?:string, lines?:{start:number,end:number}, label:string, clipboardText:string, text:string}|undefined}
		 */
		function parseQuoteRef(ref) {
			if (typeof ref !== "string" || !ref.startsWith(QUOTE_REF_PREFIX)) return undefined;
			try {
				const parsed = JSON.parse(ref.slice(QUOTE_REF_PREFIX.length));
				if (typeof parsed !== "object" || parsed === null) return undefined;
				if (parsed.v !== 1) return undefined;
				if (typeof parsed.text !== "string") return undefined;
				if (typeof parsed.path !== "string" || parsed.path.length === 0) return undefined;
				if (typeof parsed.label !== "string") return undefined;
				if (typeof parsed.clipboardText !== "string") return undefined;
				const out = {
					v: 1,
					path: parsed.path,
					label: parsed.label,
					clipboardText: parsed.clipboardText,
					text: parsed.text
				};
				if (parsed.cwd !== undefined) {
					if (typeof parsed.cwd !== "string") return undefined;
					out.cwd = parsed.cwd;
				}
				if (parsed.lines !== undefined) {
					if (typeof parsed.lines !== "object" || parsed.lines === null) return undefined;
					const start = parsed.lines.start;
					const end = parsed.lines.end;
					if (typeof start !== "number" || !Number.isFinite(start)) return undefined;
					if (typeof end !== "number" || !Number.isFinite(end)) return undefined;
					out.lines = { start: start, end: end };
				}
				return out;
			} catch (error) {
				return undefined;
			}
		}

		/**
		 * 把存储里的旧记录合并进内存（只读兼容；新 chip 不再写存储）。
		 * 同一 id 只保留第一次读到的版本；形状不合法的条目整条跳过。
		 */
		function readQuoteStoreIntoMemory() {
			try {
				if (typeof localStorage === "undefined") return;
				const raw = localStorage.getItem(QUOTE_STORE_KEY);
				if (raw === null) return;
				const parsed = JSON.parse(raw);
				if (!Array.isArray(parsed)) return;
				for (const entry of parsed) {
					if (!isQuoteRecord(entry)) continue;
					if (!quoteRecords.has(entry.id)) quoteRecords.set(entry.id, entry);
				}
			} catch (error) {
				// 存储损坏按空处理：旧 chip 点不动时 openReference 会给出明确提示。
			}
		}

		/** 首次读取旧记录存储。 */
		function loadQuoteStore() {
			if (quoteStoreLoaded) return;
			quoteStoreLoaded = true;
			readQuoteStoreIntoMemory();
		}

		/** 按旧版 chip ref 解析记录（每次都重读存储：记录可能由另一份实例写入）。 */
		function resolveQuote(ref) {
			loadQuoteStore();
			readQuoteStoreIntoMemory();
			return quoteRecords.get(ref);
		}

		/**
		 * 旧版 chip 的 id 生成器（F16）：优先 `crypto.randomUUID()`，退化为
		 * `n + 8 位随机`。新 chip 的 ref 自包含、不再分配 id；这里保留并固定
		 * 唯一性规则（同时供仍在外面的旧数据夹具使用）。
		 * @param {number} n
		 * @returns {string}
		 */
		function quoteId(n) {
			try {
				if (typeof crypto !== "undefined" && crypto !== null && typeof crypto.randomUUID === "function") {
					return "q" + n + "-" + crypto.randomUUID();
				}
			} catch (error) {
				// 宿主禁用了 crypto：落到下面的随机后缀。
			}
			let suffix = "";
			for (let i = 0; i < 8; i++) suffix += Math.floor(Math.random() * 36).toString(36);
			return "q" + n + "-" + suffix;
		}

		/**
		 * 宿主 input-trigger source：只回答 chip 点击与发送展开，不进 @ 菜单。
		 *
		 * ref 有两种：新 chip 是自包含的 `cnq1:` JSON（不依赖存储）；旧草稿里
		 * 遗留的 q… ref 仍从只读存储解析。点击一律用**当前会话**的 scope 打开
		 * （F17）：记录不再属于创建它的会话，跨会话点击也不该被拒 —— 只有记录
		 * 真的解析不到时才提示。
		 */
		function createQuoteSource(ctx) {
			return {
				trigger: "@",
				name: QUOTE_SOURCE,
				showGroupTitle: false,
				candidates: () => Promise.resolve([]),
				onPick: () => "handled",
				openReference: (session, reference) => {
					// 宿主点击路径可能传入 undefined session（旧版 / 已销毁的会话槽）：
					// 提示通道拿不到 sessionId 时只是不发，绝不能在通知里再抛一次。
					const sessionId = session !== undefined && session !== null && typeof session.sessionId === "string"
						? session.sessionId
						: undefined;
					try {
						const ref = reference === undefined || reference === null ? undefined : reference.ref;
						const payload = parseQuoteRef(ref);
						const target = payload !== undefined ? payload : resolveQuote(ref);
						if (target === undefined) {
							// 记录被存储淘汰 / ref 损坏：说清楚，别让点击静默无反应。
							notifyComposer(ctx, sessionId, "error", ctxLocale(ctx)("selection.chipMissing"));
							return false;
						}
						const scope = target.cwd === undefined
							? { sessionId: sessionId }
							: { sessionId: sessionId, cwd: target.cwd };
						// better-sidebar 的 openFile 会把 line/lineEnd 交给本预览器：
						// 后者滚动到起始行并把整段被引行闪一下（见 CodePreviewView）。
						ctx.betterSidebar.openFile(
							scope,
							target.path,
							undefined,
							target.lines === undefined ? undefined : { line: target.lines.start, lineEnd: target.lines.end }
						);
						return true;
					} catch (error) {
						// openFile 抛错（服务缺失 / 路径不被接受 / 面板异常）时宿主会让点击
						// 落回普通编辑器行为：只打 warn 用户什么都看不到，必须走同一提示通道（C-4）。
						console.warn("[dsh-code-nav] quote open failed:", error);
						notifyComposer(ctx, sessionId, "error", ctxLocale(ctx)("selection.chipOpenFailed"));
						return false;
					}
				},
				codec: {
					clipboardText: (ref) => {
						const payload = parseQuoteRef(ref);
						if (payload !== undefined) return payload.clipboardText;
						const record = resolveQuote(ref);
						return record === undefined ? ref : record.clipboardText;
					},
					serialize: async (ref) => {
						const payload = parseQuoteRef(ref);
						// 解析失败 / text 不是字符串：回退旧 store；仍找不到就 throw，
						// 让宿主拒绝发送（绝不静默降级成剪贴板文字）。
						if (payload !== undefined && typeof payload.text === "string") return payload.text;
						const record = resolveQuote(ref);
						if (record === undefined) {
							throw new Error('[dsh-code-nav] quote reference "' + ref + '" is no longer available');
						}
						return record.text;
					}
				}
			};
		}

		/**
		 * 纯文本 chip 的 source（F8）：恒等 codec —— ref 就是发送时要插入的
		 * 文本，clipboardText 也原样返回。不再依赖宿主是否提供内置 ui-reference。
		 */
		function createQuoteTextSource() {
			return {
				trigger: "@",
				name: QUOTE_TEXT_SOURCE,
				showGroupTitle: false,
				candidates: () => Promise.resolve([]),
				onPick: () => "handled",
				codec: {
					clipboardText: (ref) => ref,
					serialize: (ref) => Promise.resolve(ref)
				}
			};
		}

		/**
		 * 两个 source 的注册状态（F8）：各自独立，任一注册失败只影响对应降级档。
		 * disposer === undefined 表示「已被另一份实例注册」，每次使用前重探以便接管。
		 */
		const quoteSource = { ready: false, disposer: undefined, borrowed: false };
		const quoteTextSource = { ready: false, disposer: undefined, borrowed: false };

		/**
		 * 重复注册检测（F14）。宿主会抛 Error，消息文本是跨包字符串契约：不同
		 * 版本分别写 "already registered" / "duplicate"，有的只回显 source 名。
		 * 除了正则，再接受消息里出现任一 source 名 —— 这是字符串匹配，不是结构化
		 * 能力，宿主换文案时这里会退化为「不认」，只会多一条 warn。
		 * @param {*} error
		 * @returns {boolean}
		 */
		function isDuplicateSourceError(error) {
			if (!(error instanceof Error)) return false;
			const message = error.message;
			return /already registered|duplicate/i.test(message)
				|| message.includes(QUOTE_SOURCE)
				|| message.includes(QUOTE_TEXT_SOURCE);
		}

		/**
		 * 同步注册一个 source。重复注册在宿主那里是硬错误；这里把「已被另一份
		 * 实例注册」当作可用（两者 codec 等价），并在每次插入前重新探测 —— 对方
		 * 随 fiber 释放后本实例会接管。
		 * @param {object} ctx
		 * @param {string} name source 名（日志 / 去重用）
		 * @param {{ready:boolean, disposer:(()=>void)|undefined, borrowed:boolean}} state
		 * @param {() => object} createSource
		 * @returns {boolean} source 是否可用
		 */
		function ensureSource(ctx, name, state, createSource) {
			if (state.ready && state.disposer !== undefined) return true;
			try {
				const triggers = typeof ctx.get === "function" ? ctx.get("inputTriggers") : undefined;
				if (triggers === undefined || triggers === null || typeof triggers.registerSource !== "function") return false;
				state.disposer = triggers.registerSource(createSource());
				state.ready = true;
				state.borrowed = false;
				console.info("[dsh-code-nav] " + name + " ready");
				return true;
			} catch (error) {
				if (isDuplicateSourceError(error)) {
					state.ready = true;
					if (!state.borrowed) {
						state.borrowed = true;
						console.info("[dsh-code-nav] " + name + " already registered by another bundle instance");
					}
					return true;
				}
				console.warn("[dsh-code-nav] " + name + " registration failed:", error);
				return false;
			}
		}

		/** 引用 chip 的 source（自包含 ref：发送展开 + 点击落地）。 */
		function ensureQuoteSource(ctx) {
			return ensureSource(ctx, QUOTE_SOURCE, quoteSource, () => createQuoteSource(ctx));
		}

		/** 纯文本 chip 的 source（恒等 codec）。 */
		function ensureQuoteTextSource(ctx) {
			return ensureSource(ctx, QUOTE_TEXT_SOURCE, quoteTextSource, () => createQuoteTextSource());
		}

		/**
		 * 插件启动时注册两个 source；宿主服务晚到则短暂重试。任一 source 注册
		 * 失败只影响对应降级档，另一个照常可用。
		 * @param {object} ctx
		 * @returns {() => void} 幂等 disposer
		 */
		function registerQuoteSources(ctx) {
			let retries = 0;
			let timer;
			let disposed = false;
			const attempt = () => {
				if (disposed) return;
				ensureQuoteSource(ctx);
				ensureQuoteTextSource(ctx);
				if (quoteSource.ready && quoteTextSource.ready) return;
				if (++retries > QUOTE_REGISTER_RETRIES) {
					console.info("[dsh-code-nav] quote chips unavailable: no input-trigger service");
					return;
				}
				timer = setTimeout(attempt, QUOTE_RETRY_MS);
			};
			attempt();
			return () => {
				disposed = true;
				if (timer !== undefined) clearTimeout(timer);
				for (const state of [quoteSource, quoteTextSource]) {
					if (state.disposer !== undefined) {
						state.ready = false;
						state.disposer();
						state.disposer = undefined;
						state.borrowed = false;
					}
				}
			};
		}

		/** 读一次官方的插入 span（detect 坐标 + 草稿版本）。 */
		function captureChipSpan(input) {
			try {
				if (input.actions === undefined || input.actions === null) return null;
				if (typeof input.actions.captureInsertion !== "function") return null;
				const span = input.actions.captureInsertion();
				if (span === undefined || span === null) return null;
				if (typeof span.start !== "number" || typeof span.end !== "number" || typeof span.draftRev !== "number") return null;
				if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || !Number.isFinite(span.draftRev)) return null;
				const start = Math.max(0, Math.floor(span.start));
				const end = Math.max(start, Math.floor(span.end));
				return { start: start, end: end, draftRev: span.draftRev };
			} catch (error) {
				return null;
			}
		}

		/** 草稿版本是否已越过 `revision`（异常吞掉宿主返回值时的唯一成功证据）。 */
		function revisionMoved(ctx, sessionId, revision) {
			try {
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				const input = conversation === undefined || conversation === null ? undefined : conversation.input.for(actx);
				const snapshot = input === undefined || input === null || input.state === undefined || input.state === null
					? undefined
					: input.state.getSnapshot();
				return snapshot !== undefined && typeof snapshot.draftRev === "number" && snapshot.draftRev !== revision;
			} catch (error) {
				return false;
			}
		}

		/**
		 * 私有 actions 路径的 chip 插入：`captureInsertion()` 取光标，按 detect
		 * 投影（含 command chip 折叠）判断要不要补分隔空格，再 `insertReference()`。
		 * @param {object} input
		 * @param {object} chip
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @param {{start:number,end:number,draftRev:number}} span
		 * @returns {boolean}
		 */
		function insertChipViaCaret(input, chip, ctx, sessionId, span) {
			const actions = input.actions;
			let target = span;
			const projection = detectProjectionOf(readSnapshot(input));
			// 投影可信时按 detect 投影判断前一个字符；不可信（草稿里有未折的 quote）
			// 时看不见真实的前一个字符，插入点不在开头就保守补一个空格（C-2）。
			const needsSpace = projection.trusted === false
				? target.start > 0
				: __cn.needsLeadingSpace(projection.text, target.start);
			if (needsSpace) {
				if (actions.insertText(" ", target) !== true) return false;
				const after = captureChipSpan(input);
				if (after === null) return false;
				// 编辑器没把光标挪到空格之后时，按插入长度自己推进一位。
				const at = after.start <= target.start ? target.start + 1 : after.start;
				target = { start: at, end: at, draftRev: after.draftRev };
			}
			try {
				return input.insertReference(chip, target) === true;
			} catch (error) {
				// 宿主可能先应用了编辑再从监听器抛错：版本动了就算已落地。
				console.warn("[dsh-code-nav] reference chip insert threw:", error);
				return revisionMoved(ctx, sessionId, target.draftRev);
			}
		}

		/**
		 * 公开事件通道的 chip 插入（F5）：不依赖私有 `captureInsertion()`，追加
		 * 到 detect 文档末尾。需要分隔空格时先 emit 一次空格事件（末尾坐标 +
		 * 当时 draftRev），再用**新** draftRev / 新末尾坐标调 `insertReference`。
		 * 尾部空格由宿主的 insertReference 负责，这里不重复补。
		 * @param {object} input
		 * @param {object} chip
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @returns {boolean}
		 */
		function insertChipViaEvent(input, chip, ctx, sessionId) {
			try {
				if (typeof input.insertReference !== "function") return false;
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined || actx === null || typeof actx.emit !== "function") return false;
				const before = readSnapshot(input);
				if (before === undefined || typeof before.draftRev !== "number" || !Number.isFinite(before.draftRev)) return false;
				const draft = typeof before.draft === "string" ? before.draft : "";
				let draftRev = before.draftRev;
				const projection = detectProjectionOf(before);
				let end = projection.text.length;
				// 投影不可信（草稿里有未折的 quote）时看不见尾部字符，非空草稿一律补空格。
				const needsSpace = draft.trim() !== ""
					&& (projection.trusted === false || !/\s$/.test(draft));
				if (needsSpace) {
					actx.emit("slash/input-insert-text", {
						text: " ",
						span: { draftRev: draftRev, start: end, end: end }
					});
					const after = readSnapshot(input);
					if (after === undefined || typeof after.draftRev !== "number" || after.draftRev === draftRev) return false;
					draftRev = after.draftRev;
					end = detectProjectionOf(after).text.length;
				}
				try {
					return input.insertReference(chip, { draftRev: draftRev, start: end, end: end }) === true;
				} catch (error) {
					console.warn("[dsh-code-nav] reference chip insert threw:", error);
					return revisionMoved(ctx, sessionId, draftRev);
				}
			} catch (error) {
				return false;
			}
		}

		/**
		 * 把一枚 chip 插到草稿：官方 `captureInsertion()` 可用时走光标路径；
		 * 该私有接口缺失 / 拿不到可用 span 时改走公开事件通道追加到末尾，不再
		 * 让整档失败（F5）。
		 * @param {object} input 会话输入面板
		 * @param {object} chip ReferenceInsert
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @returns {boolean} 是否插入成功
		 */
		function insertChipAtCaret(input, chip, ctx, sessionId) {
			if (canUseInsertActions(input.actions)) {
				const span = captureChipSpan(input);
				if (span !== null) return insertChipViaCaret(input, chip, ctx, sessionId, span);
			}
			return insertChipViaEvent(input, chip, ctx, sessionId);
		}

		/**
		 * 把一次选区落成一枚引用 chip 写进会话草稿。
		 *
		 * ref 自包含（`cnq1:` + JSON，见 {@link makeQuoteRef}），**不写
		 * localStorage**：刷新 / 换标签页 / 存储被清空 / 配额写满都不会再产生
		 * 「能插不能发」的死 chip。于是插入失败时也无需回滚存储 —— 没有副作用
		 * 可回滚，直接交给调用方走下一档降级。
		 * @param {object} ctx 客户端插件上下文
		 * @param {string} sessionId 目标会话
		 * @param {{path:string, cwd?:string, lines?:{start:number,end:number}, text:string}} sel
		 * @returns {boolean} 是否插入成功（false 时调用方回退纯文本载荷）
		 */
		function insertQuoteChip(ctx, sessionId, sel) {
			try {
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				// 自愈：fiber 释放 / HMR 会注销 source，而这次提交可能不会重新 apply。
				// 借用的 source（disposer === undefined）也要重探：持有它的另一份实例
				// 可能刚刚随 fiber 释放，不重探就会留下一个能插不能发的死 source。
				if (!ensureQuoteSource(ctx)) return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined || conversation === null) return false;
				const input = conversation.input.for(actx);
				if (typeof input !== "object" || input === null) return false;
				if (typeof input.insertReference !== "function") return false;

				const payload = __cn.selectionPayload(sel.path, sel.cwd, sel.lines, sel.text);
				// 用函数形式替换：路径里的 `$&` / `$'` / `` $` `` / `$$` 在字符串形式的
				// replace 里是替换模式，会把标签弄花（build 脚本里同类问题已有注释）。
				const label = ctxLocale(ctx)("selection.chip").replace("{where}", () => payload.where);
				const ref = makeQuoteRef({
					path: sel.path,
					cwd: sel.cwd,
					lines: sel.lines,
					label: label,
					clipboardText: payload.header,
					text: payload.text
				});
				const chip = {
					source: QUOTE_SOURCE,
					ref: ref,
					label: label,
					appearance: "file",
					clipboardText: payload.header
				};
				return insertChipAtCaret(input, chip, ctx, sessionId);
			} catch (error) {
				console.warn("[dsh-code-nav] quote chip insert failed:", error);
				return false;
			}
		}

		/**
		 * 中间降级档：本插件自己的纯文本 chip（source = codeNavQuoteText，恒等
		 * codec，见 {@link createQuoteTextSource}）。输入框里仍是一枚紧凑 chip
		 * （不可点击），发送时 ref 原样展开 —— 正好是同一段围栏块。
		 *
		 * 不再依赖宿主内置的 ui-reference / `source: "reference"` 通道（F8）：
		 * 没有 input-trigger 服务时整档跳过，调用方直接落纯文本。
		 * @param {object} ctx
		 * @param {string} sessionId
		 * @param {{path:string, cwd?:string, lines?:{start:number,end:number}, text:string}} sel
		 * @returns {boolean}
		 */
		function insertFallbackChip(ctx, sessionId, sel) {
			try {
				if (ctx === undefined || ctx === null || typeof sessionId !== "string") return false;
				if (!ensureQuoteTextSource(ctx)) return false;
				if (typeof ctx.sessions === "undefined" || ctx.sessions === null) return false;
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				const conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined || conversation === null) return false;
				const input = conversation.input.for(actx);
				if (typeof input !== "object" || input === null) return false;
				if (typeof input.insertReference !== "function") return false;
				const payload = __cn.selectionPayload(sel.path, sel.cwd, sel.lines, sel.text);
				return insertChipAtCaret(input, {
					source: QUOTE_TEXT_SOURCE,
					ref: payload.text,
					label: payload.header,
					clipboardText: payload.header
				}, ctx, sessionId);
			} catch (error) {
				return false;
			}
		}
		//#endregion

		//#region locale
		const NS = "code-nav";
		const zh = {
			"viewer.title": "代码预览导航",
			"filter.all": "全部",
			"filter.class": "类",
			"filter.method": "方法",
			"filter.variable": "变量",
			"symbols": "符号",
			"symbols.close": "关闭符号列表 (Esc)",
			"symbols.empty": "未识别到符号",
			"symbols.capped": "符号过多，仅列出前 {n} 个",
			"symbols.jump": "跳转到第 {line} 行",
			"search.placeholder": "在文件中查找…",
			"search.aria": "查找内容",
			"search.case": "区分大小写",
			"search.prev": "上一个",
			"search.next": "下一个",
			"search.noMatch": "无匹配",
			"search.scanning": "正在搜索整个文件…已扫描 {percent}%",
			"search.scanningBytes": "正在搜索整个文件…已扫描 {mb}",
			"search.scanCapped": "全文搜索只扫描了前 {mb}：更靠后的匹配未列出（可下载后搜索）",
			"search.scanError": "全文搜索读取失败：{message}（已找到的匹配仍可跳转）",
			"search.pendingJump": "当前匹配在第 {line} 行（已加载 {n} 行）：按 Enter 或「下一个」定位",
			"search.jumping": "正在读取到第 {line} 行…（已加载 {n} 行）",
			"search.beyondCap": "另有 {n} 处匹配在第 {cap} 行之后（超出预览上限），无法跳转",
			"selection.add": "添加到对话",
			"selection.added": "已添加到对话",
			"selection.conflict": "输入框正忙或草稿已改动，请再点一次",
			"selection.noChipChannel": "宿主未提供引用 chip 通道，本次引用已按纯文本插入",
			"selection.insertRefused": "插入被拒绝：输入框正忙或草稿刚刚改动，请再试一次",
			"selection.chip": "引用 {where}",
			"selection.chipMissing": "这条引用已失效，请重新划选后再加一次",
			"selection.chipOpenFailed": "无法打开这条引用：文件面板没有响应，请重试或从文件树中打开",
			"truncated": "文件过大，仅显示前 500KB",
			"truncatedLines": "内容已截断到前 500KB（完整文件共 {total} 行）：查找与大纲只覆盖前 {n} 行",
			"fileTooLarge": "文件过大（{size}），当前宿主既没有内联内容、也不支持分页读取",
			"lineCapped": "文件过长，只渲染了前 {n} 行（共 {total} 行）：查找覆盖全文，大纲只覆盖已加载的行",
			"paging.remote": "超大文件（{size}），只读分页预览",
			"paging.loadMore": "加载更多",
			"paging.loadAll": "全部加载",
			"paging.loading": "正在加载…",
			"paging.progress": "已加载 {n} / {total} 行",
			"paging.loaded": "已加载 {n} 行",
			"paging.capped": "已加载 {n} 行（达到预览上限）：下载后可查看完整内容",
			"paging.error": "读取下一页失败：{message}",
			"paging.retry": "重试",
			"paging.download": "下载文件",
			"linePlain": "有 {n} 行过长，已关闭这些行的语法高亮以保证滚动流畅（内容仍完整、可选中/查找）",
			"lineNotRendered": "无法跳转到第 {line} 行：当前只加载了前 {n} 行",
			"symbols.filteredEmpty": "当前筛选下没有符号",
			"symbols.outsideWindow": "符号都在未加载的行里（大纲只覆盖前 {n} 行）",
			"code.aria": "代码内容",
			"lang.unknown": "未知类型"
		};
		const en = {
			"viewer.title": "Code Preview Navigator",
			"filter.all": "All",
			"filter.class": "Class",
			"filter.method": "Method",
			"filter.variable": "Variable",
			"symbols": "Symbols",
			"symbols.close": "Close symbols (Esc)",
			"symbols.empty": "No symbols found",
			"symbols.capped": "Too many symbols — listing the first {n}",
			"symbols.jump": "Jump to line {line}",
			"search.placeholder": "Find in file…",
			"search.aria": "Find query",
			"search.case": "Match case",
			"search.prev": "Previous",
			"search.next": "Next",
			"search.noMatch": "No matches",
			"search.scanning": "Searching the whole file… {percent}% scanned",
			"search.scanningBytes": "Searching the whole file… {mb} scanned",
			"search.scanCapped": "Whole-file search only scanned the first {mb}: later matches are not listed (download the file to search it all)",
			"search.scanError": "Whole-file search failed to read: {message} (matches found so far can still be jumped to)",
			"search.pendingJump": "This match is on line {line} ({n} lines loaded): press Enter or Next to go there",
			"search.jumping": "Reading up to line {line}… ({n} lines loaded)",
			"search.beyondCap": "{n} more match(es) are past line {cap} (beyond the preview limit) and cannot be jumped to",
			"selection.add": "Add to conversation",
			"selection.added": "Added to conversation",
			"selection.conflict": "The composer is busy or the draft changed — click again",
			"selection.noChipChannel": "The host has no quote-chip channel — the quote was inserted as plain text",
			"selection.insertRefused": "Insert refused: the composer is busy or the draft just changed — try again",
			"selection.chip": "Quote {where}",
			"selection.chipMissing": "This quote is no longer available — select the text again",
			"selection.chipOpenFailed": "Could not open this quote: the file panel did not respond — try again or open the file from the tree",
			"truncated": "File too large — showing first 500KB",
			"truncatedLines": "Content truncated to the first 500KB (the file has {total} lines): find and outline cover the first {n} lines only",
			"fileTooLarge": "File is too large ({size}): the host provided no content and has no paged reader",
			"lineCapped": "File is long — only the first {n} of {total} lines are rendered; find covers the whole file, the outline covers loaded lines only",
			"paging.remote": "Large file ({size}) — read-only paged preview",
			"paging.loadMore": "Load more",
			"paging.loadAll": "Load all",
			"paging.loading": "Loading…",
			"paging.progress": "{n} / {total} lines loaded",
			"paging.loaded": "{n} lines loaded",
			"paging.capped": "{n} lines loaded (preview limit) — download the file to see the rest",
			"paging.error": "Could not read the next page: {message}",
			"paging.retry": "Retry",
			"paging.download": "Download",
			"linePlain": "{n} line(s) are too long, so syntax highlighting is off for them to keep scrolling responsive (content is intact and still selectable/searchable)",
			"lineNotRendered": "Cannot jump to line {line}: only the first {n} lines are loaded",
			"symbols.filteredEmpty": "No symbols match the current filter",
			"symbols.outsideWindow": "All symbols are outside the loaded lines (outline covers the first {n} lines)",
			"code.aria": "Code content",
			"lang.unknown": "Unknown"
		};
		//#endregion

		//#region component
		const KIND_META = {
			class: "C", interface: "I", struct: "S", enum: "E", impl: "I",
			trait: "T", method: "M", function: "F", constructor: "C",
			variable: "V", field: "F", constant: "K",
			// 配置文件：段 / 键 / XML 元素 / XML 属性
			section: "§", key: "K", element: "E", attribute: "A"
		};
		const FILTERS = ["all", "class", "method", "variable"];

		/** 深浅色 CSS 变量组。 */
		const PALETTES = {
			dark: {
				fg: "#e8e8e8", plain: "#d4d4d4", ident: "#d4d4d4",
				comment: "#6a9955", string: "#ce9178", kw: "#569cd6",
				type: "#4ec9b0", num: "#b5cea8", fn: "#dcdcaa",
				key: "#9cdcfe", section: "#c586c0", tag: "#569cd6", attr: "#9cdcfe",
				ln: "#6e6e6e", dim: "#9a9a9a", dim3: "#6e6e6e",
				border: "rgba(255,255,255,.14)", badgeBg: "rgba(255,255,255,.08)", badgeFg: "#b8d7ff",
				accent: "#4da3ff", accentBg: "rgba(77,163,255,.14)",
				inputBg: "rgba(255,255,255,.05)", lineHover: "rgba(255,255,255,.05)",
				flash: "rgba(77,163,255,.18)", flashStrong: "rgba(77,163,255,.4)",
				popBg: "#232323", warn: "#e8b34b", warnBg: "rgba(232,179,75,.12)"
			},
			light: {
				fg: "#1f1f1f", plain: "#1f1f1f", ident: "#1f1f1f",
				comment: "#008000", string: "#a31515", kw: "#0000ff",
				type: "#267f99", num: "#098658", fn: "#795e26",
				key: "#0451a5", section: "#af00db", tag: "#0000ff", attr: "#0451a5",
				ln: "#9c9c9c", dim: "#6f6f6f", dim3: "#a0a0a0",
				border: "rgba(0,0,0,.16)", badgeBg: "rgba(38,127,153,.1)", badgeFg: "#0b5c70",
				accent: "#0b6fd6", accentBg: "rgba(11,111,214,.1)",
				inputBg: "rgba(0,0,0,.03)", lineHover: "rgba(0,0,0,.045)",
				flash: "rgba(11,111,214,.14)", flashStrong: "rgba(11,111,214,.32)",
				popBg: "#ffffff", warn: "#9a6700", warnBg: "rgba(154,103,0,.1)"
			}
		};

		/**
		 * React 18 的 useDeferredValue；宿主是更旧的 React 时退化成直通。
		 * 插件不能因为一个可选的调度 API 缺失而整个不加载。
		 */
		const useDeferredValue = react.useDeferredValue ?? ((v) => v);

		/**
		 * 字节数 → 人类可读大小（B / KB / MB，保留一位小数）。只服务于「文件
		 * 过大」提示，单位符号各语言一致，不再为此做大一统的本地化。
		 * @param {number|undefined} bytes
		 * @returns {string} 无法识别时返回空串
		 */
		function formatBytes(bytes) {
			if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
			if (bytes < 1024) return bytes + " B";
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
			return (bytes / (1024 * 1024)).toFixed(1) + " MB";
		}

		/** 没有匹配的行共享同一个空数组：memo 浅比较时这些行的 props 才能保持稳定。 */
		const EMPTY_MATCHES = [];

		/** 每个预览器实例一个独立 id（同一页面可能同时挂着多个常驻页签）。 */
		let symPopSeq = 0;

		/**
		 * 一行代码（行号槽 + 代码列）。
		 *
		 * 性能关键：父组件在每次查询 / 上下一处 / 闪烁时都会重建 `rows`，如果每行
		 * 都在父组件里算 spans，20k 行文件每步要创建 ~189k 个元素。这里用
		 * `React.memo` 拦住 props 没变的行 —— props 里只有该行自己的 token 段、
		 * 该行匹配数组（未变化时保持同一引用）、是否当前行与是否闪烁，所以一次
		 * 步进只重渲两行，查询只重渲有变化的行。
		 * @param {object} props
		 * @param {number} props.lineNo 1 基行号
		 * @param {string} props.raw 原始行文本
		 * @param {Array<{text:string, cls:string}>} props.segs 该行 token
		 * @param {Array<{col:number, end:number}>} props.matches 该行匹配区间（0 基列）
		 * @param {boolean} props.isCurrentLine 当前匹配是否在本行
		 * @param {number|null} props.currentCol 当前匹配在本行的列（不在本行为 null）
		 * @param {boolean} props.flashing 是否处于跳转闪烁区间
		 * @param {boolean} props.plain 该行过长，已关闭逐 token 高亮（纯文本渲染）
		 */
		const LineRow = react.memo(function LineRow(props) {
			const { lineNo, raw, segs, matches, isCurrentLine, currentCol, flashing, plain } = props;
			const lineNodes = [];
			if (plain) {
				// 超长行：一个文本节点（或当前匹配处的三段）代替上万个 span。
				// Chromium 对「同一行几十万个内联盒」的布局/绘制会卡死（见
				// src/render-window.js 的 lineIsPlain）；纯文本仍可选中、可搜索跳转，
				// 只是没有逐 token 着色。textContent 必须逐字等于 raw —— 选区载荷
				// 直接读 .cn-code-wrap 的文本。
				if (isCurrentLine && currentCol !== null && currentCol >= 0 && currentCol < raw.length) {
					if (currentCol > 0) lineNodes.push(jsx("span", { children: raw.slice(0, currentCol) }, "b"));
					lineNodes.push(jsx("span", { className: "cn-cu", "data-cn-cur": "1", children: raw[currentCol] }, "c"));
					if (currentCol + 1 < raw.length) lineNodes.push(jsx("span", { children: raw.slice(currentCol + 1) }, "a"));
				} else {
					lineNodes.push(jsx("span", { children: raw }, "t"));
				}
			} else {
				let currentHere = -1;
				if (isCurrentLine && currentCol !== null) {
					currentHere = matches.findIndex((m) => m.col === currentCol);
				}
				const spans = __cn.spansOfLine(raw, segs, matches, currentHere);
				for (let s = 0; s < spans.length; s++) {
					const sp = spans[s];
					const cls = sp.cls === "c-comment" ? "cn-c" : sp.cls === "c-string" ? "cn-s" : sp.cls === "c-kw" ? "cn-k" : sp.cls === "c-type" ? "cn-t" : sp.cls === "c-num" ? "cn-n" : sp.cls === "c-fn" ? "cn-f" : sp.cls === "c-ident" ? "cn-i" : sp.cls === "c-key" ? "cn-key" : sp.cls === "c-section" ? "cn-sec" : sp.cls === "c-tag" ? "cn-tag" : sp.cls === "c-attr" ? "cn-attr" : "";
					const extra = sp.match ? (sp.current ? " cn-cu" : " cn-m") : "";
					lineNodes.push(jsx("span", { className: cls + extra, "data-cn-cur": sp.current ? "1" : undefined, children: sp.text }, s));
				}
			}
			return jsxs("div", {
				className: "cn-line" + (flashing ? " flash" : "") + (plain ? " cn-line-plain" : ""),
				"data-cn-line": lineNo,
				"data-cn-plain": plain ? "1" : undefined,
				children: [
					jsx("span", { className: "cn-ln", children: lineNo }, "ln"),
					jsx("span", { className: "cn-code-wrap", children: lineNodes }, "code")
				]
			});
		});

		/**
		 * IME 组合期间的按键：Chrome/Edge 在候选词上按 Enter 也会发 keydown，
		 * `isComposing` 为真（旧的 keyCode 是 229）。这种 Enter/Space/Esc 属于
		 * 输入法而不是控件，必须原样放行。
		 * @param {KeyboardEvent|undefined} event
		 * @returns {boolean}
		 */
		function isComposingEvent(event) {
			if (event === null || event === undefined) return false;
			if (event.isComposing === true) return true;
			const native = event.nativeEvent;
			if (native !== null && native !== undefined && native.isComposing === true) return true;
			return event.keyCode === 229;
		}

		/**
		 * 两行的匹配区间是否一致（用于跨匹配重算复用数组引用，保住 LineRow 的 memo）。
		 * @param {Array<{col:number, end:number}>} a
		 * @param {Array<{col:number, end:number}>} b
		 * @returns {boolean}
		 */
		function sameLineMatches(a, b) {
			if (a === b) return true;
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (a[i].col !== b[i].col || a[i].end !== b[i].end) return false;
			}
			return true;
		}

		/**
		 * 解析宿主路由（better-sidebar 0.25+ 的 hostRouteUrl）。返回值是带反代前缀的
		 * 绝对 URL；旧宿主没有这个方法、或解析抛错时返回 null，调用方回退到静态提示。
		 * @param {object} ctx
		 * @param {string} route
		 * @returns {string|null}
		 */
		function hostRoute(ctx, route) {
			const service = ctx === null || ctx === undefined ? null : ctx.betterSidebar;
			if (service === null || service === undefined || typeof service.hostRouteUrl !== "function") return null;
			try {
				const url = service.hostRouteUrl(route);
				return typeof url === "string" && url !== "" ? url : null;
			} catch {
				return null;
			}
		}

		/**
		 * 下载 URL：`sidebar/file?sessionId=&path=&cwd=&download=1`，与宿主的
		 * api.fileUrl 同构。没有 hostRouteUrl 时返回 null（不显示下载链接）。
		 * @param {object} ctx
		 * @param {object} scope
		 * @param {string} path
		 * @returns {string|null}
		 */
		function hostDownloadUrl(ctx, scope, path) {
			const base = hostRoute(ctx, "sidebar/file");
			if (base === null) return null;
			const params = new URLSearchParams();
			const sessionId = scope === null || scope === undefined ? undefined : scope.sessionId;
			if (sessionId !== undefined && sessionId !== null && sessionId !== "") params.set("sessionId", String(sessionId));
			const cwd = scope === null || scope === undefined ? undefined : scope.cwd;
			if (typeof cwd === "string" && cwd !== "") params.set("cwd", cwd);
			params.set("path", path);
			params.set("download", "1");
			return base + (base.indexOf("?") === -1 ? "?" : "&") + params.toString();
		}

		/** 已加载分块里累积的行数。 */
		function chunkLineCount(chunks) {
			let n = 0;
			for (let i = 0; i < chunks.length; i += 1) n += chunks[i].lines.length;
			return n;
		}

		/**
		 * 把一块文本切成行 token。
		 *
		 * - 超长单行跳过分词：渲染端本来就会按纯文本渲染，分词只会白烧主线程。
		 * - 语言未知（tokenizeLines 返回 null）退化为逐行纯文本。
		 * - 非末页的 raw 以行分隔符结束，tokenize 会多切出一个空行；那是块边界，
		 *   不是文件里的一行，必须去掉，否则每块的接缝处会多出一行空行。
		 * @param {{raw:string, lines:string[], eof:boolean, endsWithBreak:boolean}} piece
		 * @param {string} lang
		 * @returns {Array<{raw:string, segs:Array<{text:string, cls:string}>}>}
		 */
		function tokenizeChunk(piece, lang) {
			if (piece.raw === "") return [];
			const plain = () => {
				const out = [];
				for (let i = 0; i < piece.lines.length; i += 1) out.push({ raw: piece.lines[i], segs: [] });
				return out;
			};
			if (__cn.chunkNeedsPlain(piece.raw)) return plain();
			const tokens = __cn.tokenizeLines(piece.raw, lang);
			if (tokens === null) return plain();
			if (piece.eof !== true && piece.endsWithBreak === true && tokens.length > 0) {
				return tokens.slice(0, tokens.length - 1);
			}
			return tokens;
		}

		function CodePreviewView(props) {
			const { ctx, scope, path, title, content, truncated: truncatedProp, size, largeFile, line, lineEnd, onLineConsumed, onToolbarState } = props;
			// 声明先于使用：commitSelPop 等回调都引用 t，原来放在函数末尾只是历史顺序，
			// 任何人把回调提前调用一次就会撞上 TDZ。
			const t = ctxLocale(ctx);
			// better-sidebar 0.30 对超过内联上限（5MB）的文件**不传 content**，只给
			// `{ size, largeFile: { size } }`，也没有 truncated 标记。以前这里会渲染
			// 一个空 <pre>，查找框却仍然像能用 —— 必须给一条明确提示。旧版宿主的
			// truncated 标记继续兼容（那种情况 content 仍是字符串）。
			const hasContent = typeof content === "string";
			const sizeBytes = typeof size === "number"
				? size
				: largeFile !== undefined && largeFile !== null && typeof largeFile.size === "number"
					? largeFile.size
					: undefined;
			const readableSize = formatBytes(sizeBytes);
			const tooLargeSize = readableSize === "" ? "?" : readableSize;
			// 超过内联上限（5MB）时宿主不给 content、只给 `{size, largeFile}`。
			// 先看宿主有没有分页路由：有就自己读页做只读预览，没有才退回静态提示。
			const pageUrl = react.useMemo(() => hostRoute(ctx, "sidebar/api/fs.readPage"), [ctx]);
			const downloadHref = react.useMemo(() => hostDownloadUrl(ctx, scope, path), [ctx, scope, path]);
			const paging = !hasContent && pageUrl !== null;
			const tooLarge = !hasContent && !paging && ((largeFile !== undefined && largeFile !== null) || sizeBytes !== undefined);
			const browsable = hasContent || paging;
			const codeRef = react.useRef(null);
			const [dark, setDark] = react.useState(() => detectDark());
			const [filter, setFilter] = react.useState("all");
			const [symOpen, setSymOpen] = react.useState(false);
			// 大纲是懒解析的：用户从不打开符号列表就不付整文件 tokenize 的成本。
			const [symReady, setSymReady] = react.useState(false);
			const [flashRange, setFlashRange] = react.useState(null);
			/** 越界行跳转的提示（`{line, rendered}`），null = 无提示。 */
			const [lineNotice, setLineNotice] = react.useState(null);
			const [query, setQuery] = react.useState("");
			const [caseSensitive, setCaseSensitive] = react.useState(false);
			const [cur, setCur] = react.useState(0);
			// 「上一处 / 下一处」的显式步进计数：单匹配时 curIndex 恒为 0，
			// 只依赖序号的话 Enter 永远不滚（C-3）。
			const [searchStep, setSearchStep] = react.useState(0);
			/** 当前匹配还没加载到时的提示 / 续读进度（null = 无提示）。 */
			const [searchJump, setSearchJump] = react.useState(null);
			/** 上一轮 effect 见到的 searchStep：区分「用户按了上/下一处」与「只是改了查询」。 */
			const lastStepRef = react.useRef(0);
			/** 正在为哪一行续读（1 基；null = 没有在续读）。 */
			const pendingJumpRef = react.useRef(null);
			/** 插入成功后给读屏的播报文本（空串 = 无播报）。 */
			const [insertAnnounce, setInsertAnnounce] = react.useState("");
			const announceTimer = react.useRef(null);
			const flashTimer = react.useRef(null);
			// 大文件里逐字符重算「全部匹配 + 每行高亮区间」会吃掉输入延迟：只有派生
			// 结果需要延后，输入框本身保持受控即时。
			const deferredQuery = useDeferredValue(query);
			/** 选中文字浮层（视口锚定；null = 隐藏）。 */
			const [selPop, setSelPop] = react.useState(null);
			/** 浮层数据的实时镜像：全局监听器只注册一次，必须读 ref 而非闭包。 */
			const selPopRef = react.useRef(null);
			/** portal 出去的那个按钮本身（用于「按钮自己的 mousedown 不算外部点击」）。 */
			const selBtnRef = react.useRef(null);
			/** 代码区可见性观察器（切页签/收面板时浮层必须跟着消失）。 */
			const selObserverRef = react.useRef(null);
			/** 已经落地过的 chip 导航（`path#line#lineEnd`）：同一行再次到达也要能重新闪。 */
			const landedAtRef = react.useRef(null);
			/** 符号弹层的触发器与弹层本身（焦点进出 / aria-controls）。 */
			const symBtnRef = react.useRef(null);
			const symPopRef = react.useRef(null);
			/** 每个实例独立的弹层 id（多个常驻页签会同时挂载）。 */
			const [symPopId] = react.useState(() => { symPopSeq += 1; return "cn-sympop-" + symPopSeq; });
			// 行匹配表的上一版：用于给未变化的行复用同一个数组引用（LineRow memo）。
			const prevLineMatchesRef = react.useRef(null);
			/** 已加载的分块（append-only）：text 供查找，lines 是分词后的行。 */
			const [chunks, setChunks] = react.useState([]);
			const chunksRef = react.useRef([]);
			/** 下一块正在读取 / 读取失败的提示（footer 展示，可重试）。 */
			const [loading, setLoading] = react.useState(false);
			const [loadError, setLoadError] = react.useState(null);
			/** 是否已读到文件末尾（footer 据此收起「加载更多」）。 */
			const [atEnd, setAtEnd] = react.useState(false);
			/** 读取游标 + 代际：换文件时 gen++，在途响应据此丢弃。 */
			const pageRef = react.useRef({ gen: 0, offset: 0, inflight: false });
			const loadRef = react.useRef(null);
			/**
			 * 分页态的后台全文扫描（只有 >5 MB、宿主只给 `{size, largeFile}` 时用）：
			 * 按页读完文件、把命中攒起来，查找因此不必等用户滚动加载。null = 未扫描。
			 */
			const [scan, setScan] = react.useState(null);
			const scanSeq = react.useRef(0);
			/**
			 * 渲染窗口（虚拟滚动）：只把视口附近的行挂进 DOM，其余行用 padding 撑高。
			 * 大文件全部挂 DOM 时，宿主每次整页样式重算要为十几万个元素买单 ——
			 * 实测 16k 行 ≈ 168k 元素，一次样式重算 ~10s（打开即卡死）。
			 */
			const [scrollTop, setScrollTop] = react.useState(0);
			const [viewHeight, setViewHeight] = react.useState(0);

			const hideSelPop = () => {
				// 键盘用户 Tab 到了浮层按钮上再关闭（Esc / 外部点击）时，别把焦点
				// 丢给 body：退回代码区，还能继续 Shift+方向键选下一段。
				const btn = selBtnRef.current;
				const hadFocus = btn !== null && btn !== undefined
					&& typeof document !== "undefined" && document.activeElement === btn;
				selPopRef.current = null;
				setSelPop(null);
				if (hadFocus) {
					const host = codeRef.current;
					if (host !== null && host !== undefined && typeof host.focus === "function") host.focus();
				}
			};

			/** 插入成功后播报一次（先清空再写入，连续两次插入也能触发 aria-live）。 */
			const announceInserted = () => {
				if (announceTimer.current !== null) clearTimeout(announceTimer.current);
				setInsertAnnounce("");
				announceTimer.current = setTimeout(() => {
					announceTimer.current = null;
					setInsertAnnounce(t("selection.added"));
				}, 30);
			};

			// 播报读完就清空：live region 保持存在，下次插入才有新的文本变化可播。
			react.useEffect(() => {
				if (insertAnnounce === "") return undefined;
				const timer = setTimeout(() => setInsertAnnounce(""), 1500);
				return () => clearTimeout(timer);
			}, [insertAnnounce]);

			/** 关闭符号弹层并把焦点还给触发按钮（跳转 / Esc / 遮罩 / ✕ 共用）。 */
			const closeSymbols = () => {
				setSymOpen(false);
				const btn = symBtnRef.current;
				if (btn !== null && btn !== undefined && typeof btn.focus === "function") btn.focus();
			};

			// 宿主 header 的刷新按钮只在 viewer 上报过 toolbar 状态时出现；预览器
			// 没有编辑/保存能力，报一个只读的稳定状态即可（卸载时收回）。
			react.useEffect(() => {
				if (typeof onToolbarState !== "function") return undefined;
				onToolbarState({ modes: false, mode: "preview", dirty: false, editable: false, saveState: "idle" });
				return () => { onToolbarState(null); };
			}, [onToolbarState]);

			// 弹层打开后把焦点移进去（第一行；没有符号时是关闭按钮），关闭时
			// closeSymbols 负责还原到触发按钮 —— 键盘用户不会被丢到 body。
			react.useEffect(() => {
				if (!symOpen) return;
				const pop = symPopRef.current;
				if (pop === null || pop === undefined) return;
				const target = pop.querySelector(".cn-symrow") ?? pop.querySelector(".cn-symclose");
				if (target !== null && typeof target.focus === "function") target.focus();
			}, [symOpen]);

			const showSelPop = (selection, left, top) => {
				const next = {
					selection: selection,
					left: Math.min(Math.max(left, 80), window.innerWidth - 80),
					// 按钮用 translate(-100% - 8px) 挂在选区上方：top 小于「高 28 + 间距 8」
					// 时会整块翻到视口外，选中最顶行时点不到。
					top: Math.max(top, 36)
				};
				selPopRef.current = next;
				setSelPop(next);
			};

			/** 点击浮层：把选区落成引用 chip（失败回退围栏块），写成功才收起浮层。 */
			const commitSelPop = () => {
				const current = selPopRef.current;
				if (current === null) return;
				const sessionId = scope === undefined || scope === null ? undefined : scope.sessionId;
				const noticesBefore = insertNoticeCount;
				if (insertSelection(ctx, sessionId, current.selection)) {
					hideSelPop();
					announceInserted();
					return;
				}
				// 插入失败时按契约保留载荷：浮层不收起，用户可以直接再点一次。
				// insertSelection 已经发过具体原因（F15：无 chip 通道 / composer 拒绝）
				// 时不要再覆盖成「输入框正忙」。
				if (insertNoticeCount === noticesBefore) {
					notifyComposer(ctx, sessionId, "error", t("selection.conflict"));
				}
			};

			// 主题跟随（body / html 的 class、style 与 body[data-ds-dark-theme] 变化 → 重判深浅色）
			react.useEffect(() => {
				const observer = new MutationObserver(() => setDark(detectDark()));
				const targets = [document.body, document.documentElement];
				for (const el of targets) observer.observe(el, { attributes: true, attributeFilter: ["class", "style", "data-ds-dark-theme"] });
				return () => observer.disconnect();
			}, []);

			// 浮层的兜底关闭：侧边栏的每个页签都是常驻挂载的（切页签只是把面板
			// 格子 display:none、收面板只是把它平移出屏），portal 出去的
			// position:fixed 按钮两者都感知不到，所以除滚动/选区塌陷之外还要有
			// 这些全局信号。按钮自己的 mousedown 不算外部点击（preventDefault
			// 保住选区，等 click 提交）。
			react.useEffect(() => {
				const onMouseDown = (e) => {
					if (selPopRef.current === null) return;
					const btn = selBtnRef.current;
					if (btn !== null && (btn === e.target || btn.contains(e.target))) return;
					hideSelPop();
				};
				const onKeyDown = (e) => {
					if (e.key === "Escape" && selPopRef.current !== null) hideSelPop();
				};
				const onVisibilityChange = () => {
					if (document.hidden) hideSelPop();
				};
				const onWindowBlur = () => hideSelPop();
				// 窗口/侧栏 resize 会把代码挪到 fixed 定位的按钮底下：直接收起，
				// 不做重新锚定（选区本身也可能已经不在视口里）。
				const onResize = () => hideSelPop();
				document.addEventListener("mousedown", onMouseDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				document.addEventListener("visibilitychange", onVisibilityChange);
				window.addEventListener("blur", onWindowBlur);
				window.addEventListener("resize", onResize);
				return () => {
					document.removeEventListener("mousedown", onMouseDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					document.removeEventListener("visibilitychange", onVisibilityChange);
					window.removeEventListener("blur", onWindowBlur);
					window.removeEventListener("resize", onResize);
					if (selObserverRef.current !== null) selObserverRef.current.disconnect();
					selObserverRef.current = null;
				};
			}, []);

			// 浮层打开时盯住代码区：面板一离开视口（切页签的 display:none、收面板
			// 的平移）就收起来 —— 这两种路径没有自己的 DOM 事件，几何信号是唯一
			// 可靠依据。关闭时必须 disconnect（effect cleanup），否则每个关掉的
			// 浮层都留下一个观察器，直到下次打开或组件卸载。
			const selPopOpen = selPop !== null;
			react.useEffect(() => {
				if (!selPopOpen) return undefined;
				if (typeof IntersectionObserver === "undefined") return undefined;
				const surface = codeRef.current;
				if (surface === null) return undefined;
				const observer = new IntersectionObserver((entries) => {
					for (const entry of entries) {
						if (!entry.isIntersecting) hideSelPop();
					}
				}, { threshold: 0 });
				selObserverRef.current = observer;
				observer.observe(surface);
				return () => {
					observer.disconnect();
					if (selObserverRef.current === observer) selObserverRef.current = null;
				};
			}, [selPopOpen]);

			// 换文件（内容换）→ 浮层失效
			react.useEffect(() => {
				hideSelPop();
			}, [content, path]);

			// 卸载时清掉闪烁定时器：跳完行立刻关面板/换插件时，回调还会在 1.6s 后
			// 攥着这个组件的 setState 闭包跑一次。读屏播报的延时同理。
			react.useEffect(() => () => {
				if (flashTimer.current !== null) clearTimeout(flashTimer.current);
				flashTimer.current = null;
				if (announceTimer.current !== null) clearTimeout(announceTimer.current);
				announceTimer.current = null;
			}, []);

			/**
			 * 代码区里选中文字 → 在其上方锚定「添加到对话」按钮。行号直接读
			 * `data-cn-line` 行容器（比 markdown 预览的文本反查精确）。
			 *
			 * 鼠标（mouseup）与键盘（Shift+方向键的 keyup）共用这一条路径：
			 * 选区在代码区外、为空、或几何不可测时一律收起浮层。
			 */
			const revealSelPop = () => {
				const sel = window.getSelection();
				const host = codeRef.current;
				// rangeCount 为 0 时 isCollapsed 也返回 true，但 getRangeAt(0) 是抛
				// IndexSizeError 的 —— 显式判一次，别把安全性压在 isCollapsed 的规范细节上。
				if (sel === null || sel.rangeCount === 0 || sel.isCollapsed
					|| sel.anchorNode === null || sel.focusNode === null || host === null) {
					hideSelPop();
					return;
				}
				if (!host.contains(sel.anchorNode) || !host.contains(sel.focusNode)) {
					hideSelPop();
					return;
				}
				const text = sel.toString();
				if (text.trim() === "") {
					hideSelPop();
					return;
				}
				const rect = sel.getRangeAt(0).getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) {
					hideSelPop();
					return;
				}
				const picked = selectionOfDom(host, sel);
				showSelPop(
					{
						path: path,
						cwd: scope === undefined || scope === null ? undefined : scope.cwd,
						lines: picked.lines,
						text: picked.text
					},
					rect.left + rect.width / 2,
					rect.top
				);
			};

			const onCodeMouseUp = () => revealSelPop();

			// 「添加到对话」的键盘入口（C-5）：Shift+方向键 / Home / End / PageUp /
			// PageDown / Ctrl+A 改完选区后，keyup 时按与 mouseup 完全相同的逻辑弹层。
			// 只认会改变选区的键 —— 否则 Esc 关闭浮层后 keyup 又会把它打开。
			const onCodeKeyUp = (event) => {
				if (event === null || event === undefined) return;
				if (isComposingEvent(event)) return;
				const key = typeof event.key === "string" ? event.key : "";
				const selectionKey = event.shiftKey === true
					|| key.indexOf("Arrow") === 0
					|| key === "Home" || key === "End" || key === "PageUp" || key === "PageDown"
					|| ((event.ctrlKey === true || event.metaKey === true) && (key === "a" || key === "A"));
				if (!selectionKey) return;
				revealSelPop();
			};

			const lang = react.useMemo(() => __cn.langOf(path), [path]);
			const langLabel = __cn.langLabel(lang);
			// 行数组 = 已加载分块的行拼接。行号全局连续（i + 1），所以引用 chip 的
			// 行号、大纲跳转、查找行号都不受分块边界影响。
			const tokens = react.useMemo(() => {
				const out = [];
				for (let c = 0; c < chunks.length; c += 1) {
					const lines = chunks[c].lines;
					for (let i = 0; i < lines.length; i += 1) out.push(lines[i]);
				}
				return out;
			}, [chunks]);

			/** 远端读一页（>5MB）：结果与 planChunk 同形状，供同一套加载器消费。 */
			const readRemotePage = async (offset) => {
				const sessionId = scope === null || scope === undefined ? undefined : scope.sessionId;
				if (sessionId === undefined || sessionId === null || sessionId === "") throw new Error("no session");
				const body = { sessionId: sessionId, path: path, offset: offset };
				if (typeof scope.cwd === "string" && scope.cwd !== "") body.cwd = scope.cwd;
				if (typeof scope.repoRoot === "string" && scope.repoRoot !== "") body.repoRoot = scope.repoRoot;
				const res = await fetch(pageUrl, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				if (res === null || res === undefined || res.ok !== true) {
					throw new Error("HTTP " + (res === null || res === undefined ? "?" : res.status));
				}
				const envelope = await res.json();
				if (envelope === null || envelope === undefined || envelope.ok !== true) {
					const error = envelope === null || envelope === undefined ? null : envelope.error;
					throw new Error(error !== null && error !== undefined && typeof error.code === "string" ? error.code : "read failed");
				}
				const page = envelope.value;
				if (page === null || page === undefined || page.kind !== "text") throw new Error("unexpected page");
				return __cn.chunkFromRead(page.text, page.nextOffset, page.eof === true);
			};

			const appendPiece = (piece, gen) => {
				if (pageRef.current.gen !== gen) return;
				const lines = tokenizeChunk(piece, lang);
				if (lines.length === 0) return;
				const next = chunksRef.current.concat({ text: piece.text, lines: lines });
				chunksRef.current = next;
				setChunks(next);
			};

			/**
			 * 顺序读取若干块。maxChunks 是预算：1 = 加载更多，Infinity = 全部加载，
			 * 首屏一次读两页。inflight + gen 守卫：滚动、跳转、footer 同时触发时
			 * 不会重复读同一页，也不会把上一个文件的页追加到新文件里。
			 */
			const loadMore = async (gen, maxChunks) => {
				const state = pageRef.current;
				if (state.inflight || state.gen !== gen) return;
				state.inflight = true;
				setLoading(true);
				setLoadError(null);
				try {
					for (let n = 0; n < maxChunks; n += 1) {
						if (state.gen !== gen) return;
						if (chunkLineCount(chunksRef.current) >= __cn.MAX_PREVIEW_LINES) break;
						const piece = hasContent
							? __cn.planChunk(content, state.offset, __cn.CHUNK_CHARS)
							: await readRemotePage(state.offset);
						if (state.gen !== gen) return;
						appendPiece(piece, gen);
						state.offset = piece.nextOffset;
						if (piece.eof) { setAtEnd(true); break; }
					}
				} catch (error) {
					if (state.gen === gen) {
						const message = error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error);
						setLoadError(message);
					}
				} finally {
					if (state.gen === gen) { state.inflight = false; setLoading(false); }
				}
			};
			loadRef.current = loadMore;

			// 分页态（>5 MB，宿主只给 `{size, largeFile}`）的**后台全文扫描**：
			// 查找不能只覆盖「用户滚动加载到的那几行」——没人愿意为了搜一个词先滚到
			// 底。这里按页把整个文件读一遍、把命中攒起来，命中数随扫描进度增长。
			//
			// - 已加载的块先直接搜（用户可能已经滚过一段：已读过的页不再重读，命中
			//   也能立刻出现），后台扫描只负责它后面的部分；
			// - 输入停顿 180 ms 再开扫：否则每敲一个字符都从头重来；
			// - 查询 / 大小写 / 文件变化时取消上一轮（seq 代际）；
			// - SCAN_MAX_BYTES（默认 64 MB）是预算，扫到就停并让界面说明；
			// - 扫描只收集「行/列」，不保留页文本，内存只与命中数相关。
			react.useEffect(() => {
				const seq = scanSeq.current + 1;
				scanSeq.current = seq;
				if (!paging || deferredQuery === "") {
					setScan(null);
					return undefined;
				}
				let cancelled = false;
				let timerId = null;
				const state = { matches: [], capped: false, lines: 0, offset: pageRef.current.offset };
				// 已加载块逐块搜（不在拼接文本上搜：块边界是换行，拼接会制造跨块假命中）
				for (const chunk of chunksRef.current) {
					const found = __cn.findMatches(chunk.text, deferredQuery, { caseSensitive });
					const merged = __cn.appendScannedMatches(state.matches, found, state.lines, __cn.MAX_MATCHES);
					state.matches = merged.matches;
					state.capped = state.capped || merged.capped;
					state.lines += chunk.lines.length;
				}
				const reachedEnd = typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && state.offset >= sizeBytes;
				const initialDone = reachedEnd || state.capped;
				setScan({ matches: state.matches.slice(), capped: state.capped, scannedBytes: state.offset, done: initialDone, error: null });
				if (initialDone) return undefined;
				timerId = setTimeout(() => {
					void (async () => {
						for (;;) {
							if (cancelled || scanSeq.current !== seq) return;
							if (state.offset >= __cn.SCAN_MAX_BYTES) {
								setScan({ matches: state.matches.slice(), capped: true, scannedBytes: state.offset, done: true, error: null });
								return;
							}
							let piece;
							try {
								piece = await readRemotePage(state.offset);
							} catch (error) {
								if (cancelled || scanSeq.current !== seq) return;
								const message = error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error);
								setScan({ matches: state.matches.slice(), capped: state.capped, scannedBytes: state.offset, done: true, error: message });
								return;
							}
							if (cancelled || scanSeq.current !== seq) return;
							const found = __cn.findMatches(piece.text, deferredQuery, { caseSensitive });
							const merged = __cn.appendScannedMatches(state.matches, found, state.lines, __cn.MAX_MATCHES);
							state.matches = merged.matches;
							state.capped = state.capped || merged.capped;
							state.lines += piece.lines.length;
							state.offset = piece.nextOffset;
							const finished = piece.eof === true || state.capped;
							setScan({ matches: state.matches.slice(), capped: state.capped, scannedBytes: state.offset, done: finished, error: null });
							if (finished) return;
						}
					})();
				}, 180);
				return () => {
					cancelled = true;
					if (timerId !== null) clearTimeout(timerId);
					// 让在途的下一页结果作废：只认自己这一轮
					scanSeq.current += 1;
				};
			}, [paging, deferredQuery, caseSensitive, path, pageUrl]);

			// 换文件 / 换路径：清空分块并加载首屏。这个 effect 在 paint 之后跑，
			// 首屏会短暂显示「正在加载」—— 代价换来的是内存只与已加载的块成正比。
			react.useEffect(() => {
				const state = pageRef.current;
				state.gen += 1;
				const gen = state.gen;
				state.offset = 0;
				state.inflight = false;
				chunksRef.current = [];
				setChunks([]);
				setAtEnd(false);
				setLoadError(null);
				setLoading(false);
				// 新文件从顶部开始：滚动位置与窗口一起归零，别把上一个文件的
				// scrollTop 留给新的（更短的）内容。
				const bodyEl = codeRef.current;
				if (bodyEl !== null) bodyEl.scrollTop = 0;
				setScrollTop(0);
				// 换文件后旧的查找定位目标不再有效
				pendingJumpRef.current = null;
				setSearchJump(null);
				if (!hasContent && pageUrl === null) {
					setAtEnd(true);
					return;
				}
				const initialChunks = hasContent
					? Math.max(1, Math.ceil(__cn.INITIAL_CHUNK_CHARS / __cn.CHUNK_CHARS))
					: 1;
				void loadRef.current(gen, initialChunks);
			}, [content, path, pageUrl, hasContent]);

			// 量出滚动区高度并跟随尺寸变化（侧栏拖宽、页签切换后重新 layout）。
			// 没有 ResizeObserver 的环境退化成「每次 tokens 变化时量一次」。
			react.useEffect(() => {
				const body = codeRef.current;
				if (body === null) return undefined;
				const sync = () => {
					setViewHeight((prev) => (body.clientHeight > 0 && body.clientHeight !== prev ? body.clientHeight : prev));
					// 内容变短时浏览器会自己 clamp scrollTop，状态要跟上，否则窗口
					// 会停在已经不存在的行区间上。
					setScrollTop((prev) => (body.scrollTop === prev ? prev : body.scrollTop));
				};
				sync();
				if (typeof ResizeObserver === "function") {
					const observer = new ResizeObserver(sync);
					observer.observe(body);
					return () => observer.disconnect();
				}
				return undefined;
			}, [tokens.length]);

			// 完整 content 的真实行数（内存态）；分页态要读到 EOF 才知道总数。
			const totalLines = react.useMemo(() => {
				if (hasContent) return __cn.lineCountOf(content);
				if (atEnd) return tokens.length;
				return null;
			}, [hasContent, content, atEnd, tokens.length]);
			const totalForText = totalLines === null ? tokens.length : totalLines;
			// 渲染窗口是「能跳转的行号范围」的唯一来源：搜索与大纲都按它裁剪，
			// 否则窗口外的匹配会被计入 n/m；窗口外的符号会出现在列表里却点不动。
			const renderedCount = react.useMemo(
				() => __cn.renderedLineCount(tokens.length, __cn.MAX_PREVIEW_LINES),
				[tokens.length]
			);
			// DOM 渲染窗口：只挂视口附近的 ~100 行，其余用上下 padding 撑出滚动高度。
			// 行高固定（CSS line-height:20px），所以行区间与占位高度都能纯算出来。
			const view = react.useMemo(
				() => __cn.rowWindow(scrollTop, viewHeight, renderedCount),
				[scrollTop, viewHeight, renderedCount]
			);
			// 已加载行里最宽的一行（按「CJK/emoji 记 2、tab 记 4」估算，仅用于挑样本）：
			// 窗口化时把它放进 0 高的隐藏行，横向滚动宽度才不会随窗口抖动。
			const widestLine = react.useMemo(() => {
				let best = "";
				let bestScore = 0;
				for (let i = 0; i < tokens.length; i += 1) {
					const raw = tokens[i].raw;
					let score = 0;
					for (let c = 0; c < raw.length; c += 1) {
						const code = raw.charCodeAt(c);
						score += code === 9 ? 4 : code >= 0x2e80 ? 2 : 1;
					}
					if (score > bestScore) { bestScore = score; best = raw; }
				}
				return best;
			}, [tokens]);
			// 只有真的窗口化了才需要那条「宽度尺」；小文件全量渲染时它没有意义。
			const windowed = view.start > 0 || view.end < renderedCount;
			// 分块后每个块都远小于 tokenizeLines 的 500KB 防御上限，本插件不再自己
			// 截断内容；只有旧宿主会手传 props.truncated。
			const truncated = truncatedProp === true;
			// 大纲懒解析：用户从不打开符号列表时不该为整文件 outline 付一次
			// tokenize 的成本（20k 行约 90ms）。第一次打开才把 symReady 置真；
			// 之后列表常驻，cap 提示也就能继续显示。
			const symbols = react.useMemo(() => {
				if (!symReady || tokens.length === 0) return { list: [], capped: false, ready: false, hasSymbols: false };
				// 复用已经算好的 tokens：outlineOfTokens 不会再整文件分词一次
				// （Vue/Svelte 没有块边界，函数内部会回退成文本入口）。
				const all = __cn.outlineOfTokens(tokens, lang);
				// capped 必须看裁剪前的长度：大纲静默截断到 OUTLINE_MAX_SYMBOLS，
				// 不告诉用户就会以为「符号」按钮漏了。
				return {
					list: __cn.clipToRenderWindow(all, renderedCount),
					capped: all.capped === true,
					ready: true,
					// 「大纲本身是否为空」看裁剪前：渲染窗口外有符号时不能谎报「未识别到符号」。
					hasSymbols: all.length > 0
				};
			}, [symReady, tokens, lang, renderedCount]);
			// 查找覆盖**整个文件**，而不是「已经滚动加载到的那几行」：
			// - ≤5 MB：宿主给了完整正文，直接在内存里搜（正文本来就在，没有任何理由
			//   只搜已加载的部分）；
			// - >5 MB：正文不在客户端，后台按页扫描（见上面的 scan effect），命中
			//   随扫描进度增长。
			// 命中还要再按「预览上限」裁一次：超过 MAX_PREVIEW_LINES 的行根本不会
			// 被加载，列出来也跳不过去 —— 单独计数并提示（beyondCapCount）。
			const rawMatches = react.useMemo(() => {
				if (deferredQuery === "") return EMPTY_MATCHES;
				if (hasContent) {
					if (typeof content !== "string") return EMPTY_MATCHES;
					return __cn.findMatches(content, deferredQuery, { caseSensitive });
				}
				return scan === null ? EMPTY_MATCHES : scan.matches;
			}, [hasContent, content, deferredQuery, caseSensitive, scan]);
			const matches = react.useMemo(() => {
				const visible = __cn.clipZeroBasedToRenderWindow(rawMatches, __cn.MAX_PREVIEW_LINES);
				if (rawMatches.capped === true) Object.defineProperty(visible, "capped", { value: true, enumerable: false });
				return visible;
			}, [rawMatches]);
			const beyondCapCount = rawMatches.length - matches.length;
			const scanning = paging && deferredQuery !== "" && scan !== null && scan.done !== true;
			const scanError = scan !== null && scan.error !== null && scan.error !== undefined ? scan.error : null;
			const scanCapped = scan !== null && scan.done === true && scan.capped === true;
			const scanInfo = __cn.scanProgress(scan === null ? 0 : scan.scannedBytes, sizeBytes);
			const curIndex = matches.length > 0 ? Math.min(cur, matches.length - 1) : -1;
			// findMatches 只在确实探测到第 N+1 条时标记 capped。
			const matchCapped = matches.capped === true;
			// 计数口径：分母是可导航（裁剪后）条数；命中上限与预览上限两个裁剪
			// 分开表达，不能再把「窗口外还有」说成 n/2000+ 或「无匹配」。
			const matchState = __cn.matchWindowState(matches.length, matchCapped, __cn.MAX_MATCHES);
			// 内容行数超出渲染窗口：文件被截断显示，搜索与大纲只覆盖窗口内
			const lineCapped = tokens !== null && renderedCount < tokens.length;

			/** 行 → 该行匹配区间表（未变化的行复用上一版数组，保住 LineRow 的 memo）。 */
			const lineMatches = react.useMemo(() => {
				const map = new Map();
				for (let i = 0; i < matches.length; i++) {
					const m = matches[i];
					let arr = map.get(m.line);
					if (arr === undefined) { arr = []; map.set(m.line, arr); }
					arr.push({ col: m.col, end: m.col + (m.end - m.start) });
				}
				const prev = prevLineMatchesRef.current;
				if (prev !== null) {
					for (const entry of map) {
						const old = prev.get(entry[0]);
						if (old !== undefined && sameLineMatches(old, entry[1])) map.set(entry[0], old);
					}
				}
				prevLineMatchesRef.current = map;
				return map;
			}, [matches]);

			/**
			 * 滚到某一行（1 基）并让窗口跟着挪。
			 *
			 * 不能再用 `querySelector('[data-cn-line=N]')` + scrollIntoView：窗口化后
			 * 目标行多半还没有 DOM 元素。按行号 × 行高算出 scrollTop 是确定性的，
			 * 设置后这一次 setScrollTop 就会把目标行渲染进窗口。
			 */
			const scrollRowIntoView = (lineNo) => {
				const body = codeRef.current;
				if (body === null) return;
				const next = __cn.rowScrollTop(lineNo, body.clientHeight || viewHeight);
				if (next === body.scrollTop) return;
				body.scrollTop = next;
				setScrollTop(body.scrollTop);
			};

			/** 闪一段行区间并滚到起始行（引用 chip 落地 / 符号跳转共用）。 */
			const flashLines = (start, end) => {
				setFlashRange({ start: start, end: end });
				if (flashTimer.current !== null) clearTimeout(flashTimer.current);
				flashTimer.current = setTimeout(() => setFlashRange(null), 1600);
				scrollRowIntoView(start);
			};

			const jumpToLine = (line) => flashLines(line, line);

			// 引用 chip 的点击落地：better-sidebar 的 openFile 把 line / lineEnd 交给
			// 预览器，这里滚到起始行并把整段被引行闪一下；onLineConsumed 告诉宿主
			// 「这一跳用过了」，否则它会在每次快照刷新时重复下发。line 变回 undefined
			// （普通打开 / 已消费）时清空记忆，所以同一行再点一次仍会重新落地。
			// 渲染窗口之外的请求只提示、不闪、也不消费：clamp 到窗口末尾会让用户
			// 以为跳到了错误的位置，而 onLineConsumed 会让这一跳彻底丢失。
			react.useEffect(() => {
				if (line === undefined || line === null) {
					landedAtRef.current = null;
					setLineNotice(null);
					return;
				}
				if (!browsable) return;
				const key = path + "#" + line + "#" + (lineEnd === undefined || lineEnd === null ? "" : lineEnd);
				if (landedAtRef.current === key) return;
				const win = __cn.lineWindowState(line, lineEnd, renderedCount);
				if (!win.inWindow) {
					// 行号可能还没加载到：继续读块，tokens 变化后这个 effect 会重跑。
					// 只有确实到不了（EOF / 上限 / 读取失败）才提示并记下这一跳。
					if (!atEnd && renderedCount < __cn.MAX_PREVIEW_LINES && loadError === null) {
						void loadRef.current(pageRef.current.gen, 1);
						return;
					}
					landedAtRef.current = key;
					setLineNotice({ line: win.requestedLine, rendered: win.renderedCount });
					return;
				}
				landedAtRef.current = key;
				setLineNotice(null);
				flashLines(win.start, win.end);
				if (typeof onLineConsumed === "function") onLineConsumed();
			}, [content, browsable, path, line, lineEnd, renderedCount, onLineConsumed, atEnd, loadError]);

			// 当前匹配变化 → 定位到该匹配（C-3 查找跟随）。
			// 依赖「当前匹配是谁」（行:列）而不是序号：继续输入收紧查询时几乎总是
			// curIndex 0→0，只依赖序号会让 matches 换了、当前匹配挪了行、视口却
			// 停在旧位置。单匹配时 step() 的序号恒为 0，searchStep 显式再触发一次。
			//
			// 匹配可能在**还没加载**的行里（查找现在覆盖整个文件）：
			// - 用户只是继续输入：只提示「第 N 行还没加载，按 Enter/下一个定位」，
			//   不自动续读 —— 否则每敲一个字符都要读一轮分块；
			// - 用户明确按了上/下一处 / Enter：逐块续读直到目标行已加载（每渲染一轮
			//   读一块，界面不会卡），再滚过去。
			const currentMatch = curIndex >= 0 ? matches[curIndex] : null;
			const currentLine = currentMatch === null ? -1 : currentMatch.line;
			const currentCol = currentMatch === null ? null : currentMatch.col;
			const currentMatchKey = currentMatch === null ? "" : currentMatch.line + ":" + currentMatch.col;
			react.useEffect(() => {
				if (curIndex < 0 || currentMatchKey === "") {
					pendingJumpRef.current = null;
					setSearchJump(null);
					return;
				}
				const target = currentLine + 1;
				const explicit = lastStepRef.current !== searchStep;
				lastStepRef.current = searchStep;
				if (target <= renderedCount) {
					pendingJumpRef.current = null;
					setSearchJump(null);
					scrollRowIntoView(target);
					return;
				}
				if (explicit) pendingJumpRef.current = target;
				if (pendingJumpRef.current !== target) {
					pendingJumpRef.current = null;
					setSearchJump({ line: target, loaded: renderedCount, loading: false });
					return;
				}
				if (!atEnd && renderedCount < __cn.MAX_PREVIEW_LINES && loadError === null) {
					setSearchJump({ line: target, loaded: renderedCount, loading: true });
					void loadRef.current(pageRef.current.gen, 1);
					return;
				}
				pendingJumpRef.current = null;
				setSearchJump({ line: target, loaded: renderedCount, loading: false });
			}, [curIndex, currentMatchKey, searchStep, renderedCount, atEnd, loadError]);

			// 下拉打开期间：全局 Esc 关闭（capture 阶段，不依赖焦点位置）。
			// 关闭时把焦点还给触发按钮；IME 组合中的 Esc 属于输入法，不在这里吞掉。
			// 弹层是 role="dialog" + aria-modal="true"：Tab / Shift+Tab 必须在弹层内
			// 循环（焦点陷阱），否则焦点会跑到 .cn-shade 后面的工具条上。
			react.useEffect(() => {
				if (!symOpen) return undefined;
				const onGlobalKey = (e) => {
					if (isComposingEvent(e)) return;
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						closeSymbols();
						return;
					}
					if (e.key !== "Tab") return;
					const pop = symPopRef.current;
					if (pop === null || pop === undefined) return;
					// 只收可聚焦且未被禁用/隐藏的子元素；查询顺序即 DOM（即 Tab）顺序。
					const items = [];
					const candidates = pop.querySelectorAll("button, [tabindex]");
					for (const el of candidates) {
						if (el.disabled === true) continue;
						if (typeof el.tabIndex === "number" && el.tabIndex < 0) continue;
						items.push(el);
					}
					if (items.length === 0) return;
					const first = items[0];
					const last = items[items.length - 1];
					const active = typeof document === "undefined" ? null : document.activeElement;
					const inside = active !== null && active !== undefined && pop.contains(active);
					if (!inside) {
						e.preventDefault();
						first.focus();
					} else if (e.shiftKey === true && active === first) {
						e.preventDefault();
						last.focus();
					} else if (e.shiftKey !== true && active === last) {
						e.preventDefault();
						first.focus();
					}
				};
				window.addEventListener("keydown", onGlobalKey, true);
				return () => window.removeEventListener("keydown", onGlobalKey, true);
			}, [symOpen]);

			const step = (delta) => {
				if (matches.length === 0) return;
				// 当前匹配还没加载（查找覆盖整个文件之后很常见）：先把**这一条**
				// 定位过来，不要直接跳到下一条 —— 用户看到的 n/m 会从「未定位」
				// 悄悄变成另一处，反而更困惑。
				const pendingLine = searchJump === null ? 0 : searchJump.line;
				if (pendingLine > renderedCount) {
					pendingJumpRef.current = pendingLine;
					setSearchStep((n) => n + 1);
					return;
				}
				setCur((c) => (c + delta + matches.length) % matches.length);
				// 单匹配 / 同一处再按一次：序号不变也要滚（C-3）
				setSearchStep((n) => n + 1);
			};
			const onQuery = (v) => {
				setQuery(v);
				setCur(0);
				// 新查询从「未定位」开始：旧的 pending 续读目标不再有效
				pendingJumpRef.current = null;
				setSearchJump(null);
			};
			const onKeyDown = (e) => {
				// IME 组合中的 Enter 属于输入法（Chrome 的 keyCode 229）：放行，
				// 既不 preventDefault 也不跳匹配。
				if (isComposingEvent(e)) return;
				if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
				else if (e.key === "Escape") { setSymOpen(false); }
			};

			const filtered = symbols.list.filter((s) => filter === "all" || __cn.kindGroup(s.kind) === filter);

			const palette = PALETTES[dark ? "dark" : "light"];
			const rootStyle = {};
			for (const k of Object.keys(palette)) {
				// 驼峰键 → kebab-case CSS 变量（popBg → --cn-pop-bg）
				const cssKey = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
				rootStyle["--cn-" + cssKey] = palette[k];
			}

			// 行元素是**轻量**的 LineRow 元素：每行只把该行需要的数据作为 props，
			// 真正的 spans / DOM 由 React.memo(LineRow) 在 props 未变时跳过。
			// 一次查询/步进只重渲有变化的行，而不是 20000 行。
			// 只构建窗口内的行：`view.start`~`view.end`（外面由 padding 撑高）。
			const rows = react.useMemo(() => {
				const out = [];
				for (let i = view.start; i < view.end; i++) {
					const isCurrentLine = currentLine === i;
					out.push(jsx(LineRow, {
						lineNo: i + 1,
						raw: tokens[i].raw,
						segs: tokens[i].segs,
						matches: lineMatches.get(i) ?? EMPTY_MATCHES,
						isCurrentLine: isCurrentLine,
						currentCol: isCurrentLine ? currentCol : null,
						flashing: flashRange !== null && i + 1 >= flashRange.start && i + 1 <= flashRange.end,
						// 单行过长 / token 段太多 → 纯文本渲染，避免同一行里上万个
						// 内联盒把 Chromium 的布局/绘制卡死（见 __cn.lineIsPlain）。
						plain: __cn.lineIsPlain(tokens[i].raw, tokens[i].segs.length)
					}, i));
				}
				return out;
			}, [tokens, view.start, view.end, lineMatches, currentLine, currentCol, flashRange]);

			// 有多少行因为过长而关闭了高亮：顶部提示一下，别让用户以为高亮坏了。
			const plainLineCount = react.useMemo(() => {
				let n = 0;
				for (let i = 0; i < renderedCount; i++) {
					if (__cn.lineIsPlain(tokens[i].raw, tokens[i].segs.length)) n++;
				}
				return n;
			}, [tokens, renderedCount]);

			const symNodes = [];
			// 三态：大纲本身为空 / 有符号但被筛选挡掉 / 符号全在渲染窗口外。
			// 第三个参数必须是「窗口内、筛选前」的条数：hasSymbols 是裁剪前基数，
			// filtered.length 是裁剪+筛选后基数，两者直接比较会把「窗口外」误报成
			// 「筛选无结果」（C-7 / 审查 02-outline P2-7）。
			const symbolsEmpty = __cn.symbolsEmptyKind(symbols.hasSymbols, filtered.length, symbols.list.length);
			const symbolsEmptyText = symbolsEmpty === "filtered"
				? t("symbols.filteredEmpty")
				: symbolsEmpty === "window"
					? t("symbols.outsideWindow").replace("{n}", String(renderedCount))
					: t("symbols.empty");
			// 弹层关闭时不构建行元素：列表可能有 500 条，没必要在每次搜索输入时
			// 都重建一遍（它们只在 symOpen 为真时才会被渲染）。
			if (symOpen) {
				if (symbolsEmpty !== "ok") {
					symNodes.push(jsx("div", {
						className: "cn-empty",
						children: symbolsEmptyText
					}, "empty"));
				} else {
					// 跳转后弹层卸载，焦点必须回到触发按钮，否则键盘用户被丢到 body。
					const pickSymbol = (s) => { jumpToLine(s.line); closeSymbols(); };
					for (let i = 0; i < filtered.length; i++) {
						const s = filtered[i];
						symNodes.push(jsxs("div", {
							className: "cn-symrow",
							// 行是 div，键盘够不着：声明成 button 并接 Enter/Space，
							// 否则「符号」列表对只用键盘的人等于不存在。
							role: "button",
							tabIndex: 0,
							"aria-label": t("symbols.jump").replace("{line}", String(s.line)),
							onClick: (e) => { e.stopPropagation(); pickSymbol(s); },
							onKeyDown: (e) => {
								if (isComposingEvent(e)) return;
								if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pickSymbol(s); }
							},
							children: [
								jsx("span", { className: "cn-symkind", children: KIND_META[s.kind] ?? "?" }, "kind"),
								jsx("span", { className: "cn-symname", children: s.container === undefined ? s.name : jsxs(react.Fragment, { children: [s.name, jsx("span", { className: "cn-symcont", children: " — " + s.container }, "cont")] }) }, "name"),
								jsx("span", { className: "cn-symline", children: s.line }, "line")
							]
						}, i));
					}
				}
			}

			// footer：进度 + 加载更多 / 全部加载 / 重试 / 下载。只在还有后续内容、
			// 正在读、失败或到达上限时出现；普通小文件读完就不显示这条。
			const showMore = !atEnd && !loading && loadError === null && renderedCount < __cn.MAX_PREVIEW_LINES;
			const atCap = !atEnd && renderedCount >= __cn.MAX_PREVIEW_LINES;
			const progressText = totalLines === null
				? t("paging.loaded").replace("{n}", String(tokens.length))
				: t("paging.progress").replace("{n}", String(tokens.length)).replace("{total}", String(totalLines));
			const footer = browsable && (showMore || loading || loadError !== null || atCap || (paging && downloadHref !== null))
				? jsxs("div", {
					className: "cn-more",
					children: [
						jsx("span", { className: "cn-more-text", children: progressText }, "text"),
						loadError === null ? null : jsx("span", { className: "cn-more-err", children: t("paging.error").replace("{message}", loadError) }, "err"),
						loadError !== null
							? jsx("button", {
								type: "button",
								className: "cn-mini",
								onClick: () => { void loadRef.current(pageRef.current.gen, 1); },
								children: t("paging.retry")
							}, "retry")
							: showMore
								? jsx("button", {
									type: "button",
									className: "cn-mini",
									onClick: () => { void loadRef.current(pageRef.current.gen, 1); },
									children: t("paging.loadMore")
								}, "more")
								: null,
						showMore
							? jsx("button", {
								type: "button",
								className: "cn-mini",
								onClick: () => { void loadRef.current(pageRef.current.gen, Infinity); },
								children: t("paging.loadAll")
							}, "all")
							: null,
						atCap
							? jsx("span", { className: "cn-more-err", children: t("paging.capped").replace("{n}", String(renderedCount)) }, "cap")
							: null,
						downloadHref === null
							? null
							: jsx("a", { className: "cn-more-link", href: downloadHref, download: "", children: t("paging.download") }, "dl")
					]
				}, "more")
				: null;

			// 未渲染的行用上下 padding 补足高度：滚动高度、滚动条比例与「全部渲染」
			// 完全一致（topPad + 窗口行数 + bottomPad === 已加载行数 × 行高）。
			const codeStyle = {
				paddingTop: 4 + view.topPad,
				paddingBottom: 16 + view.bottomPad
			};
			// 0 高的隐藏行承载「已加载行里最宽的一行」，把横向宽度钉住；
			// 只有真的窗口化了才需要它（小文件全量渲染时宽度本来就是全的）。
			// 刻意不套 LineRow：那条会带 data-cn-line，划选解析会把它当成一行代码。
			const ruler = windowed && widestLine !== ""
				? jsx("div", {
					className: "cn-ruler",
					"aria-hidden": "true",
					children: jsxs("div", {
						className: "cn-line",
						children: [
							jsx("span", { className: "cn-ln", children: "" }, "ln"),
							jsx("span", { className: "cn-code-wrap", children: widestLine }, "code")
						]
					})
				}, "ruler")
				: null;

			const body = tooLarge
				// 大文件且宿主没有分页路由：给一条可见提示，而不是一个空 <pre>。
				? jsx("div", { className: "cn-warn", role: "status", children: t("fileTooLarge").replace("{size}", tooLargeSize) }, "toolarge")
				: tokens.length === 0 && (loading || !atEnd)
					? jsx("div", { className: "cn-empty", role: "status", children: t("paging.loading") }, "loading")
					: jsx("div", {
						className: "cn-code",
						style: codeStyle,
						children: ruler === null ? rows : [ruler].concat(rows)
					}, "code");

			// 计数文案：分母是可导航条数；outsideOnly 不再冒充「无匹配」，
			// 由下面的「预览上限之外」提示说明。
			const matchCounterText = matchState.kind === "empty"
				// 延后的查询值还没追上时别说「无匹配」；后台还在扫描时也不能说；
				// 命中全在预览上限之外时由下面的 beyondCap 提示说明，同样不冒充「无匹配」
				? (deferredQuery.length > 0 && !scanning && beyondCapCount === 0 ? t("search.noMatch") : "")
				: matchState.kind === "outsideOnly"
					? ""
					: (curIndex + 1) + "/" + matchState.total + (matchState.kind === "countCapped" ? "+" : "");

			return jsxs("div", {
				className: "cn-root",
				style: rootStyle,
				children: [
					jsxs("div", {
						className: "cn-head",
						children: [
							jsx("span", { className: "cn-title", title: path, children: title ?? path }, "title"),
							jsx("span", { className: "cn-badge", children: langLabel }, "lang"),
							paging ? jsx("span", { className: "cn-badge", children: tooLargeSize }, "size") : null
						]
					}, "head"),
					// 没有正文时（大文件且宿主没有分页路由）这两条工具条都是空转的，
					// 收起来；标题与语言徽标保留，用户仍知道打开的是哪个文件。
					browsable ? jsxs("div", {
						className: "cn-bar",
						children: [
							...FILTERS.map((f) => jsx("button", {
								type: "button",
								className: "cn-chip" + (filter === f ? " on" : ""),
								"aria-pressed": filter === f,
								onClick: () => { setFilter(f); setSymOpen(false); },
								children: t("filter." + f)
							}, f)),
							jsx("button", {
								type: "button",
								ref: symBtnRef,
								className: "cn-symbtn",
								"aria-expanded": symOpen,
								"aria-haspopup": "dialog",
								"aria-controls": symPopId,
								// 第一次打开才解析大纲；未解析前不显示条数（那会是假的 0）。
								onClick: () => { setSymReady(true); setSymOpen((v) => !v); },
								children: t("symbols") + (symbols.ready ? " (" + filtered.length + ")" : "")
							}, "symbtn")
						]
					}, "filters") : null,
					browsable ? jsxs("div", {
						className: "cn-bar",
						children: [
							jsxs("div", {
								className: "cn-search",
								children: [
									jsx("input", {
										type: "text",
										value: query,
										placeholder: t("search.placeholder"),
										"aria-label": t("search.aria"),
										onChange: (e) => onQuery(e.target.value),
										onKeyDown: onKeyDown,
										spellCheck: false
									}, "input"),
									jsx("span", {
										className: "cn-count",
										// 结果数变化需要被读屏播报（n/m、无匹配、窗口外提示）
										role: "status",
										"aria-live": "polite",
										children: matchCounterText
									}, "count"),
									jsx("button", {
										type: "button",
										className: "cn-mini" + (caseSensitive ? " on" : ""),
										title: t("search.case"),
										"aria-label": t("search.case"),
										"aria-pressed": caseSensitive,
										onClick: () => { setCaseSensitive((v) => !v); setCur(0); },
										children: "Aa"
									}, "case"),
									jsx("button", {
										type: "button",
										className: "cn-mini",
										title: t("search.prev"),
										"aria-label": t("search.prev"),
										onClick: () => step(-1),
										children: "↑"
									}, "prev"),
									jsx("button", {
										type: "button",
										className: "cn-mini",
										title: t("search.next"),
										"aria-label": t("search.next"),
										onClick: () => step(1),
										children: "↓"
									}, "next")
								]
							})
						]
					}, "searchbar") : null,
					// 超 5MB：宿主不给正文，这里用 sidebar/api/fs.readPage 只读分页。
					paging
						? jsx("div", { className: "cn-note", role: "status", children: t("paging.remote").replace("{size}", tooLargeSize) }, "remote")
						: null,
					// 旧版宿主会手传 truncated（它的 readLimit 截断）：说清楚只拿到前 500KB。
					truncated === true
						? jsx("div", { className: "cn-warn", children: t("truncated") }, "truncated")
						: null,
					// 行数到达预览上限：正文只渲染到上限，大纲只覆盖已加载的行
					// （查找仍然覆盖整个文件，见下面的搜索提示）。
					lineCapped === true
						? jsx("div", { className: "cn-warn", children: t("lineCapped").replace("{n}", String(renderedCount)).replace("{total}", String(totalForText)) }, "linecapped")
						: null,
					// 有超长行被降级为纯文本：说明原因，避免被当成高亮/渲染 bug。
					plainLineCount > 0
						? jsx("div", { className: "cn-warn", role: "status", children: t("linePlain").replace("{n}", String(plainLineCount)) }, "plainline")
						: null,
					// 窗口外的行跳转：说清楚没跳，不闪错误的行、也不消费这一跳。
					lineNotice !== null
						? jsx("div", { className: "cn-warn", role: "status", children: t("lineNotRendered").replace("{line}", String(lineNotice.line)).replace("{n}", String(lineNotice.rendered)) }, "linenotice")
						: null,
					// 分页态后台搜索：进度 / 预算截断 / 读页失败。
					scanning
						? jsx("div", {
							className: "cn-note",
							role: "status",
							children: sizeBytes === undefined
								? t("search.scanningBytes").replace("{mb}", formatBytes(scan === null ? 0 : scan.scannedBytes))
								: t("search.scanning").replace("{percent}", String(scanInfo.percent))
						}, "scanning")
						: null,
					scanCapped === true
						? jsx("div", { className: "cn-warn", role: "status", children: t("search.scanCapped").replace("{mb}", formatBytes(scanInfo.limitBytes)) }, "scancapped")
						: null,
					scanError === null
						? null
						: jsx("div", { className: "cn-warn", role: "status", children: t("search.scanError").replace("{message}", scanError) }, "scanerror"),
					// 匹配位于预览上限之外：列出来也跳不过去，单独计数（不冒充「无匹配」）。
					beyondCapCount > 0
						? jsx("div", { className: "cn-warn", role: "status", children: t("search.beyondCap").replace("{n}", String(beyondCapCount)).replace("{cap}", String(__cn.MAX_PREVIEW_LINES)) }, "beyondcap")
						: null,
					// 当前匹配还没加载：提示按 Enter / 下一个定位，或正在续读到的进度。
					searchJump === null
						? null
						: jsx("div", {
							className: searchJump.loading ? "cn-note" : "cn-warn",
							role: "status",
							children: searchJump.loading
								? t("search.jumping").replace("{line}", String(searchJump.line)).replace("{n}", String(searchJump.loaded))
								: t("search.pendingJump").replace("{line}", String(searchJump.line)).replace("{n}", String(searchJump.loaded))
						}, "searchjump"),
					symbols.capped === true
						? jsx("div", { className: "cn-warn", children: t("symbols.capped").replace("{n}", String(__cn.OUTLINE_MAX_SYMBOLS)) }, "symcapped")
						: null,
					jsxs("div", {
						className: "cn-body",
						ref: codeRef,
						// 可聚焦：键盘用户先 Tab 到这里，再用 Shift+方向键选代码；
						// keyup 走与 mouseup 相同的弹层路径（C-5）。
						tabIndex: 0,
						role: "region",
						"aria-label": t("code.aria"),
						onMouseUp: onCodeMouseUp,
						onKeyUp: onCodeKeyUp,
						// 滚动会挪走锚点（按钮是 position:fixed）→ 直接收起；
						// 同时接近底部就预读下一块（分块加载的自动续读入口）。
						onScroll: (event) => {
							hideSelPop();
							const el = event === null || event === undefined ? null : event.currentTarget;
							if (el === null || el === undefined) return;
							// 窗口跟着滚动走：只重算「这几十行渲染哪一段」，不重建整个文件。
							setScrollTop((prev) => (el.scrollTop === prev ? prev : el.scrollTop));
							setViewHeight((prev) => (el.clientHeight > 0 && el.clientHeight !== prev ? el.clientHeight : prev));
							if (atEnd || loading || loadError !== null) return;
							if (tokens.length >= __cn.MAX_PREVIEW_LINES) return;
							if (el.scrollTop + el.clientHeight >= el.scrollHeight - 480) {
								void loadRef.current(pageRef.current.gen, 1);
							}
						},
						children: footer === null ? [body] : [body, footer]
					}, "body"),
					symOpen ? jsx(react.Fragment, { children: [
						jsx("div", {
							className: "cn-shade",
							"aria-hidden": "true",
							onClick: (e) => { e.stopPropagation(); closeSymbols(); }
						}, "shade"),
						jsx("div", {
							ref: symPopRef,
							id: symPopId,
							className: "cn-sympop",
							role: "dialog",
							// 模态语义：弹层遮挡了背后的工具条，Tab 只应在弹层内循环
							"aria-modal": "true",
							"aria-label": t("symbols"),
							onClick: (e) => e.stopPropagation(),
							children: [
								jsxs("div", {
									className: "cn-symhead",
									children: [
										jsx("span", { children: t("symbols") + (symbols.ready ? " (" + filtered.length + ")" : "") }, "label"),
										jsx("button", {
											type: "button",
											className: "cn-symclose",
											title: t("symbols.close"),
											"aria-label": t("symbols.close"),
											onClick: (e) => { e.stopPropagation(); closeSymbols(); },
											children: "✕"
										}, "close")
									]
								}, "head"),
								...symNodes
							]
						}, "pop")
					] }, "sympop") : null,
					selPop === null || typeof document === "undefined" ? null : createPortal(jsx("button", {
						type: "button",
						ref: selBtnRef,
						className: "cn-selpop",
						// 与可见文案同一句：鼠标悬停 / 读屏都拿到同一个动作名
						title: t("selection.add"),
						"aria-label": t("selection.add"),
						style: {
							left: selPop.left,
							top: selPop.top,
							// portal 到了 body 上，拿不到 .cn-root 的 --cn-* 变量 → 内联兜底色
							"--cn-selpop-bg": palette.popBg,
							"--cn-selpop-fg": palette.fg,
							"--cn-selpop-border": palette.border,
							"--cn-selpop-hover": palette.lineHover
						},
						// 保住选区：按钮一 mousedown 选区就塌，click 也就不用提交了
						onMouseDown: (e) => { e.preventDefault(); },
						onClick: commitSelPop,
						children: t("selection.add")
					}), document.body, "cn-selpop"),
					// 插入成功的读屏播报：live region 常驻（不能只在插入时才挂，
					// 否则部分读屏不会播），这里只改文本（C-5）。
					jsx("div", {
						className: "cn-sr",
						role: "status",
						"aria-live": "polite",
						children: insertAnnounce
					}, "announce")
				]
			});
		}

		/** 从 ctx 读取命名空间翻译函数。 */
		function ctxLocale(ctx) {
			try {
				return ctx.locale.bind(NS);
			} catch {
				return (k) => (zh[k] ?? en[k] ?? k);
			}
		}
		//#endregion

		//#region plugin
		const inject = ["betterSidebar", "locale"];

		/**
		 * 客户端插件主体：注册代码文件预览器 + 引用 chip 的两个 input-trigger source。
		 * @param ctx - client root context。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-code-nav: dictionaries");
			// 「添加到对话」落成引用 chip 的前提：宿主的 input-trigger 服务。
			// 服务缺失（旧版 DSH）时 registerQuoteSources 只是重试后放弃，插入会
			// 自动回退到纯文本围栏块。
			ctx.effect(() => registerQuoteSources(ctx), "dsh-code-nav: quote sources");
			ctx.effect(() => ctx.betterSidebar.registerFileViewer({
				id: "dsh-code-nav:outline",
				title: () => ctxLocale(ctx)("viewer.title"),
				exts: Object.keys(__cn.LANG_EXT),
				priority: 10,
				fetchStrategy: "fsRead",
				component: CodePreviewView
			}), "dsh-code-nav: viewer");
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
