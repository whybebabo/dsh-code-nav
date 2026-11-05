/**
 * dsh-code-nav — 配置文件结构大纲（纯函数，浏览器/node 通用）。
 *
 * 覆盖 JSON（含 jsonc / json5 / jsonl）、YAML、TOML、INI、Java properties、
 * dotenv 与 XML。输出与 outline.js 同形：{ kind, name, line, container? }，
 * line 为 1 基，container 为所属段 / 元素（供 UI 显示 `name — container`）。
 *
 * kind：section（段 / 表 / 对象）、key（键）、element（XML 元素）、
 *       attribute（XML 属性）。
 *
 * 与代码语言不同，配置语言的「键」本身就是字符串，故这些提取器读原始行
 * （tokens[i].raw）而不是 outline.js 的 cleanOf()——后者会把键连同值一起剔掉。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

import { propertiesKeySlice, unescapePropertyKey } from "./properties-key.js";

/** 名字长度上限（与代码大纲一致，挡住误匹配出来的超长"名字"）。 */
const CFG_NAME_MAX = 80;

/** 去掉包裹键名的引号（JSON `"a"` / YAML `"a b"` / TOML `'a'`）。 */
function unquoteKey(name) {
  if (name.length >= 2) {
    const first = name[0];
    const last = name[name.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return name.slice(1, -1);
  }
  return name;
}

/**
 * 解码 JSON 键名里的字符串转义（`"a\\nb"` 的键显示为 `a`↵`b` 而不是字面 `a\nb`）。
 * 未识别的转义按字面保留 —— 与 properties 侧的 unescapePropertyKey 同一宽容口径，
 * 也保证「展示优先于严格校验」：故意写坏的键名照样能列出来。
 * @param {string} raw 已去掉外层引号的键名
 * @returns {string}
 */
function unescapeJsonKey(raw) {
  if (raw.indexOf("\\") === -1) return raw;
  const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[i + 1];
    if (next === undefined) { out += ch; continue; }
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
      out += next; i += 1; continue;
    }
    out += ESCAPES[next] !== undefined ? ESCAPES[next] : next;
    i += 1;
  }
  return out;
}

/** 行首缩进列数（空格与 Tab 均按 1 计）。 */
function indentOf(raw) {
  let i = 0;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) i++;
  return i;
}

/** 找出不在引号里的 YAML 映射冒号。 */
function yamlColonOf(body) {
  let quote = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote !== "") {
      if (quote === '"' && ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch !== ":") continue;
    const after = body[i + 1];
    if (after === undefined || after === " " || after === "\t") return i;
  }
  return -1;
}

/** 找出不在引号里的 TOML 等号。 */
function tomlEqualsOf(text) {
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== "") {
      if (quote === '"' && ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "=") return i;
  }
  return -1;
}

/** 更新 TOML 多行数组 / inline table 的括号深度，忽略字符串和注释。 */
function tomlBracketDepth(text, depth) {
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== "") {
      if (quote === '"' && ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "#") break;
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** 按已分词片段更新 TOML 括号深度，字符串 / 注释中的括号不参与配对。 */
function tomlBracketDepthOfToken(token, depth) {
  for (const seg of token.segs) {
    if (seg.cls === "c-string" || seg.cls === "c-comment") continue;
    depth = tomlBracketDepth(seg.text, depth);
  }
  return depth;
}

/**
 * TOML 段的父段：名字的点分前缀里出现过的最长者（`a.b.c` → `a.b`）。
 * 没有匹配的父段返回 null。
 * @param {string} name 段路径
 * @param {Set<string>} seen 已出现过的段路径
 * @returns {string|null}
 */
function parentTableOf(name, seen) {
  let cut = name.lastIndexOf(".");
  while (cut > 0) {
    const candidate = name.slice(0, cut);
    if (seen.has(candidate)) return candidate;
    cut = candidate.lastIndexOf(".");
  }
  return null;
}

/**
 * 该行是否为注释行（配置语言的注释标记可能不止一个）。
 * 只看行首：行内的标记能否起注释由 tokenize.js 的 commentAllowedAt 判定，
 * 大纲这边不把行内 `#` / `;` / `!` 当注释，二者规则保持一致。
 */
function isCommentLine(raw, markers) {
  const head = raw.replace(/^\s+/, "");
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (m.length > 0 && head.startsWith(m)) return true;
  }
  return false;
}

/** 去掉值里的行尾注释（仅当标记位于空白之后才算注释，与 tokenize 对齐）。 */
function stripTrailingComment(value, markers) {
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (markers.indexOf(ch) === -1) continue;
    const prev = i === 0 ? "" : value[i - 1];
    if (prev === " " || prev === "\t") return value.slice(0, i);
  }
  return value;
}

/**
 * JSON / jsonc / json5 / jsonl：按文档结构（而非行正则）扫出对象键。
 * 自写字符扫描器负责字符串转义与括号配对，于是嵌套层级、行号与
 * 「值是对象/数组 → section，否则 → key」的判定都准确。
 * @param {string} text
 * @returns {Array<{kind:string,name:string,line:number,container?:string}>}
 */
function extractJson(text) {
  const out = [];
  const stack = [];        // 容器名栈（匿名容器记 null）
  let pendingName = null;  // 下一个 '{' / '[' 所属的键名
  let i = 0;
  let line = 1;
  const n = text.length;
  const nearest = () => {
    for (let s = stack.length - 1; s >= 0; s--) if (stack[s] !== null) return stack[s];
    return undefined;
  };
  /** 跳过空白与注释（jsonc / json5 的 // 与 /* *\/），并维护行号。 */
  const skipSpace = () => {
    while (i < n) {
      const c = text[i];
      if (c === "\n") { line++; i++; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
          if (text[i] === "\n") line++;
          i++;
        }
        i += 2;
        continue;
      }
      break;
    }
  };
  while (i < n) {
    skipSpace();
    if (i >= n) break;
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      stack.push(pendingName);
      pendingName = null;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (stack.length > 0) stack.pop();
      i++;
      continue;
    }
    if (ch === "," || ch === ":") { i++; continue; }
    let keyText = null;
    const keyLine = line;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      while (i < n) {
        const c = text[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "\n") { line++; i++; continue; }
        if (c === quote) { i++; break; }
        i++;
      }
      const raw = text.slice(start + 1, Math.min(i, n));
      keyText = unescapeJsonKey(raw.endsWith(quote) ? raw.slice(0, -1) : raw);
    } else if (ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      // json5 裸键 / true / false / null 等字面量
      const start = i;
      while (i < n && (text[i] === "_" || text[i] === "$" || (text[i] >= "a" && text[i] <= "z") || (text[i] >= "A" && text[i] <= "Z") || (text[i] >= "0" && text[i] <= "9"))) i++;
      keyText = text.slice(start, i);
    } else {
      i++;
      continue;
    }
    // lookahead（可能跨空白/注释，但不改变上面的行号推进）
    const saveI = i;
    const saveLine = line;
    skipSpace();
    if (text[i] !== ":") {
      // 是值（字符串 / 字面量 / 数组元素），不是键
      i = saveI;
      line = saveLine;
      continue;
    }
    i++;                       // 跳过 ':'
    skipSpace();
    const vch = text[i];
    const isContainer = vch === "{" || vch === "[";
    if (keyText.length > 0 && keyText.length <= CFG_NAME_MAX) {
      const container = nearest();
      const sym = { kind: isContainer ? "section" : "key", name: keyText, line: keyLine };
      if (container !== undefined) sym.container = container;
      out.push(sym);
    }
    if (isContainer) pendingName = keyText;
    // 游标停在值首字符上：容器由主循环的 '{' / '[' 分支压栈
  }
  return out;
}

/**
 * 剥掉值开头的 YAML 节点属性（anchor `&a` 与 tag `!t` / `!!t` / `!<...>`）。
 * 这些只是给**紧随其后的节点**起名 / 标类型，不改变它是标量还是映射，
 * 故 `defaults: &defaults` 与 `mapping: !!map` 都应当按「值为空、后随子块」处理。
 * 别名 `*a` 是真正的值引用，不在此列。
 * @param {string} valueText
 * @returns {string} 去掉节点属性后的剩余值
 */
function stripYamlNodeProps(valueText) {
  let rest = valueText;
  for (;;) {
    const before = rest;
    if (rest.startsWith("&")) rest = rest.replace(/^&[^\s]+/, "");
    else if (rest.startsWith("!")) rest = rest.replace(/^!<[^>]*>/, "").replace(/^![^\s]*/, "");
    rest = rest.replace(/^\s+/, "");
    if (rest === before) return rest;
  }
}

/**
 * 读一个 YAML flow 标量：带引号的整段（含引号），或到 `,` `}` `]` `{` `[`
 * 或「后接分隔符的 `:`」为止的纯量。不跨行；引号在行尾仍未闭合时返回 null
 * （调用方据此放弃整次 flow 扫描，退回逐行解析）。
 * @returns {{text:string, line:number, col:number}|null}
 */
function readYamlFlowToken(tokens, line, col) {
  const text = tokens[line].raw;
  if (col >= text.length) return { text: "", line, col };
  const first = text[col];
  if (first === '"' || first === "'") {
    for (let i = col + 1; i < text.length; i++) {
      const ch = text[i];
      if (first === '"' && ch === "\\") { i++; continue; }
      if (ch === first) return { text: text.slice(col, i + 1), line, col: i + 1 };
    }
    return null;
  }
  let i = col;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "," || ch === "}" || ch === "]" || ch === "{" || ch === "[") break;
    if (ch === ":") {
      const next = text[i + 1];
      if (next === undefined || next === " " || next === "\t" || next === "," ||
          next === "}" || next === "]" || next === "[") break;
    }
  }
  return { text: text.slice(col, i), line, col: i };
}

/**
 * flow 键名：去掉包裹引号；双引号键按 JSON 风格解码转义（`"a\nb"` 显示为两行，
 * 与 JSON 侧的 `unescapeJsonKey` 同口径），单引号 / 裸键只去引号。
 * @param {string} text 原始键文本（可能带引号）
 * @returns {string}
 */
function unquoteFlowKey(text) {
  const t = text.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return unescapeJsonKey(t.slice(1, -1));
  return unquoteKey(t);
}

/**
 * 扫描一个 YAML flow 节点（`{…}` / `[…]`，可跨行），把其中的映射键收集出来。
 *
 * 只在「块映射的值以 `{` / `[` 开头」或「整行（列表项）本身就是 flow 节点」时调用。
 * 支持嵌套容器、`{a: 1, b: 2}`、`[a: 1, b: 2]`（单键映射元素）、引号键与行内注释。
 * 解析不完整（引号跨行未闭合 / 括号没配平）时返回 `closed: false`，调用方丢弃
 * 已收集的符号并退回原来的逐行行为 —— 保证畸形输入不会吞掉后续内容。
 *
 * @param {Array<{raw:string}>} tokens 每行 token
 * @param {number} lineCount 行数
 * @param {number} startLine 起始行（0 基）
 * @param {number} startCol 起始列（指向 `{` / `[`）
 * @param {string|undefined} owner 该 flow 节点自身的名字（根节点 / 列表项为 undefined）
 * @returns {{closed:boolean, endLine:number, syms:Array}} `line` 均为 1 基
 */
function scanYamlFlow(tokens, lineCount, startLine, startCol, owner) {
  const syms = [];
  const stack = [];        // { owner, open } —— flow 容器上下文
  const currentOwner = () => (stack.length > 0 ? stack[stack.length - 1].owner : owner);
  const failed = () => ({ closed: false, endLine: startLine, syms: [] });
  let line = startLine;
  let col = startCol;
  let guard = 0;
  while (line < lineCount) {
    if (guard++ > 1000000) return failed();   // 防御：异常输入不至于卡死
    const text = tokens[line].raw;
    if (col >= text.length) { line++; col = 0; continue; }
    const ch = text[col];
    if (ch === "#" && (col === 0 || /\s/.test(text[col - 1]))) { line++; col = 0; continue; }
    if (ch === " " || ch === "\t" || ch === ",") { col++; continue; }
    if (ch === "{" || ch === "[") {
      stack.push({ owner: currentOwner() });
      col++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (stack.length === 0) return failed();
      stack.pop();
      col++;
      if (stack.length === 0) return { closed: true, endLine: line, syms };
      continue;
    }
    // 一个 entry：`键: 值` 或裸值（如 `[1, 2]` 里的 1）
    const entryLine = line;
    const token = readYamlFlowToken(tokens, line, col);
    if (token === null) return failed();
    if (token.line === line && token.col <= col) { col++; continue; }   // 理论上的零进展保护
    line = token.line;
    col = token.col;
    const entryText = tokens[line].raw;
    let probe = col;
    while (probe < entryText.length && (entryText[probe] === " " || entryText[probe] === "\t")) probe++;
    if (entryText[probe] !== ":") continue;      // 裸值：已消费，交给后续 `,` / `}` 处理
    // 跳过 `:` 之后的空白（允许换行），定位值的首字符
    let vl = line;
    let vc = probe + 1;
    for (;;) {
      if (vl >= lineCount) return failed();
      const vt = tokens[vl].raw;
      if (vc >= vt.length) { vl++; vc = 0; continue; }
      if (vt[vc] === " " || vt[vc] === "\t") { vc++; continue; }
      break;
    }
    const valueCh = tokens[vl].raw[vc];
    const name = unquoteFlowKey(token.text);
    if (name.length === 0 || name.length > CFG_NAME_MAX || name.startsWith("#")) {
      line = vl;
      col = vc;
      continue;
    }
    const flowOwner = currentOwner();
    const isContainer = valueCh === "{" || valueCh === "[";
    const sym = { kind: isContainer ? "section" : "key", name, line: entryLine + 1 };
    if (flowOwner !== undefined) sym.container = flowOwner;
    syms.push(sym);
    if (isContainer) {
      stack.push({ owner: name });
      line = vl;
      col = vc + 1;
      continue;
    }
    line = vl;
    col = vc;
  }
  return failed();
}

/**
 * YAML：缩进驱动的映射键；值为空（后随子块）的键视为段。
 * 只认「后接空白 / 行尾」的冒号，故 `url: http://x` 不会把 `http` 当成键。
 * `|` / `>` 块标量的正文按缩进跳过，故正文里的 `fake: value` 不会成为键。
 * `---` / `...` 是文档分隔符：新文档从零开始（段栈清空），第二文档的键不会挂到
 * 第一文档的段上。flow 节点（`{…}` / `[…]`，可跨行）里的键也会入大纲。
 */
function extractYaml(tokens, lineCount) {
  const out = [];
  const stack = [];   // { indent, name }
  let blockIndent = -1;   // >= 0 表示正处于块标量正文中，其值为父键的缩进
  for (let i = 0; i < lineCount; i++) {
    const raw = tokens[i].raw;
    const trimmed = raw.trim();
    // 块标量正文：缩进比父键更深（或空行）的行都属于正文，整行跳过
    if (blockIndent >= 0) {
      if (trimmed.length === 0) continue;
      if (indentOf(raw) > blockIndent) continue;
      blockIndent = -1;                      // 缩进回退 → 块结束，本行照常解析
    }
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    // 文档分隔符：`---` 开始新文档、`...` 结束当前文档 —— 段栈与块标量状态都要重置
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(trimmed)) {
      stack.length = 0;
      blockIndent = -1;
      continue;
    }
    const indent = indentOf(raw);
    let body = raw.slice(indent);
    let keyIndent = indent;
    const listLead = /^-\s+/.exec(body);
    const listItem = listLead !== null;
    if (listItem) {
      body = body.slice(listLead[0].length);
      // 序列与父键同缩进是合法的（`key:\n- item`）：用「键真正开始的列」参与
      // 容器栈比较，否则父键会在同缩进的列表项处被误弹出。
      keyIndent = indent + listLead[0].length;
    }
    if (body.length === 0 || body.startsWith("#")) continue;
    const bodyCol = raw.length - body.length;
    // 整行 / 列表项本身就是一个 flow 节点：`{a: 1}` / `- {a: 1}` / 根 flow 映射
    if (body[0] === "{" || body[0] === "[") {
      // 先在不动块段栈的前提下算出 flow 子键的归属：解析成功才真正弹栈
      let keep = stack.length - 1;
      while (keep >= 0 && stack[keep].indent >= keyIndent) keep--;
      const container = keep >= 0 ? stack[keep].name : undefined;
      const flow = scanYamlFlow(tokens, lineCount, i, bodyCol, container);
      if (flow.closed) {
        stack.length = keep + 1;
        for (const s of flow.syms) out.push(s);
        i = flow.endLine;
        continue;
      }
      // 解析不完整：退回逐行逻辑（与修复前一致）
    }
    // 第一个「后接空白或行尾」且不在引号里的冒号才是映射分隔符
    const ci = yamlColonOf(body);
    if (ci <= 0) {
      // 列表形式的块标量（`- |` / `- >`）没有键值分隔符，
      // 但后续更深缩进的行仍须整体跳过。
      if (listItem && /^[|>][-+\d]*$/.test(body.trim())) blockIndent = indent;
      continue;                                  // 纯列表标量 / 无键行
    }
    const name = unquoteKey(body.slice(0, ci).trim());
    if (name.length === 0 || name.length > CFG_NAME_MAX) continue;
    if (name.startsWith("#")) continue;
    // `defaults: &defaults` / `mapping: !!map` 的节点属性只是修饰紧随其后的节点，
    // 剥掉后若已无剩余内容，说明该键的值就是后随的子块 → 仍是段。
    const valueText = stripYamlNodeProps(stripTrailingComment(body.slice(ci + 1), "#").trim());
    while (stack.length > 0 && stack[stack.length - 1].indent >= keyIndent) stack.pop();
    const container = stack.length > 0 ? stack[stack.length - 1].name : undefined;
    const sym = { kind: valueText.length === 0 ? "section" : "key", name, line: i + 1 };
    if (container !== undefined) sym.container = container;
    out.push(sym);
    // 值是 flow 节点（`key: {…}` / `key: […]`）：把子键也列出来，多行 flow 的
    // 后续行由扫描器整段吃掉，不会再被当成顶层块键。
    if (valueText.length > 0 && (valueText[0] === "{" || valueText[0] === "[")) {
      const flowStart = body.indexOf(valueText[0], ci + 1);
      if (flowStart >= 0) {
        const flow = scanYamlFlow(tokens, lineCount, i, bodyCol + flowStart, name);
        if (flow.closed) {
          for (const s of flow.syms) out.push(s);
          i = flow.endLine;
          continue;
        }
      }
    }
    if (valueText.length === 0) stack.push({ indent: keyIndent, name });
    // `|` / `>`（可带 `-` `+` 与缩进指示数字）→ 后续更深缩进的行是字面正文
    if (/^[|>][-+\d]*$/.test(valueText)) blockIndent = indent;
  }
  return out;
}

/**
 * 取 TOML 段头（`[a]` / `[[a.b]]`）里的段路径；不是段头 / 段头没闭合返回 null。
 * 名字可以带引号键，所以不能简单按第一个 `]` 截断 —— `[a."b]c"]` 的 `]` 在引号里。
 * @param {string} trimmed 去掉行首空白后的整行
 * @returns {string|null}
 */
function tomlSectionNameOf(trimmed) {
  let open = 0;
  while (open < trimmed.length && trimmed[open] === "[") open++;
  if (open === 0) return null;
  let quote = "";
  for (let i = open; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote !== "") {
      if (quote === '"' && ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "]") return trimmed.slice(open, i).trim();
  }
  return null;
}

/**
 * TOML：`[table]` / `[[array]]` 段头 + `key = value`。
 * 段头是**绝对路径**（`[a.b]` 并不表示嵌在上一个段里），故父段只在「名字是它的
 * 点分前缀」时才算数 —— 否则 `[dependencies]` 后面的 `[[bin]]` 会错误地挂到
 * `dependencies` 下。
 */
function extractToml(tokens, lineCount) {
  const out = [];
  const seen = new Set();   // 出现过的段路径
  let table = null;
  let valueDepth = 0;
  for (let i = 0; i < lineCount; i++) {
    const raw = tokens[i].raw;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (valueDepth > 0) {
      valueDepth = tomlBracketDepthOfToken(tokens[i], valueDepth);
      continue;
    }
    // `"""` / `'''` 多行字符串的正文与收尾行整行都是字符串内容，不是键
    if (tokens[i].str === true) continue;
    const sectionName = trimmed[0] === "[" ? tomlSectionNameOf(trimmed) : null;
    if (sectionName !== null) {
      const name = sectionName;
      if (name.length === 0 || name.length > CFG_NAME_MAX) continue;
      const sym = { kind: "section", name, line: i + 1 };
      const parent = parentTableOf(name, seen);
      if (parent !== null) sym.container = parent;
      out.push(sym);
      seen.add(name);
      table = name;
      continue;
    }
    const eq = tomlEqualsOf(trimmed);
    if (eq <= 0) continue;
    const name = unquoteKey(trimmed.slice(0, eq).trim().replace(/^"(.*)"$/, "$1"));
    if (name.length === 0 || name.length > CFG_NAME_MAX) continue;
    const sym = { kind: "key", name, line: i + 1 };
    if (table !== null) sym.container = table;
    out.push(sym);
    valueDepth = tomlBracketDepthOfToken(tokens[i], 0);
  }
  return out;
}

/** 行尾连续反斜杠的个数（忽略行尾空白）。 */
function trailingBackslashes(line) {
  const t = line.trimEnd();
  let n = 0;
  while (n < t.length && t[t.length - 1 - n] === "\\") n++;
  return n;
}

/**
 * 该行是否以「续行反斜杠」结尾。
 * Java properties 规定**奇数**个反斜杠才是续行，故 `a=foo\\` 的 `\\` 是一个转义出
 * 的字面反斜杠、本行已结束，下一行是独立属性（偶数个 → 不续行）。
 */
function endsWithContinuation(line) {
  return trailingBackslashes(line) % 2 === 1;
}

/**
 * 找出键在 body 中的结束位置（无分隔符返回 -1）。
 * `escape` 打开时 `\` 后的字符不参与判定；
 * `spaceSep` 打开时空白也算分隔符（Java properties 的 `key value` 写法）。
 *
 * 注意：properties（`escape` + `spaceSep`）不走这里，而是共用 properties-key.js
 * 的 `propertiesKeySlice`，以免与高亮侧各写一套判定。
 */
function keyEndOf(body, sep, opts) {
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (opts.escape === true && ch === "\\") { k++; continue; }
    if (sep.indexOf(ch) !== -1) return k;
    if (opts.spaceSep === true && (ch === " " || ch === "\t")) return k;
  }
  return -1;
}

/**
 * 值以引号开头、且在同一行内没有闭合时返回那个引号字符；否则返回 ""。
 * dotenv 的引号值可以跨行（`KEY="line1\nline2"`），续行整行都属于值。
 * @param {string} valueText 已去掉首尾空白的值文本
 * @returns {string} `"` / `'` / ""
 */
function openQuoteOf(valueText) {
  const quote = valueText[0];
  if (quote !== '"' && quote !== "'") return "";
  for (let i = 1; i < valueText.length; i++) {
    const ch = valueText[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (ch === quote) return "";
  }
  return quote;
}

/** 引号值续行：本行是否把它闭合（未闭合返回原引号字符，闭合返回 ""）。 */
function continueQuoteOn(line, quote) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (ch === quote) return "";
  }
  return quote;
}

/**
 * 行式键值配置（INI / Java properties / dotenv）。
 * @param {object} opts
 * @param {string[]} opts.comment 注释标记
 * @param {string|null} opts.sep 键值分隔符字符集；null = 只认裸键
 * @param {boolean} opts.sections 是否解析 `[section]` 段头
 * @param {boolean} opts.bare 是否接受无分隔符的裸键行
 * @param {boolean} opts.continuation 是否按行尾奇数个 `\` 跳过续行
 * @param {boolean} opts.exportPrefix 是否剥离行首 `export `
 * @param {boolean} [opts.spaceSep] 空白是否也算分隔符（Java properties）
 * @param {boolean} [opts.escape] 反斜杠是否为转义符（Java properties）
 * @param {boolean} [opts.quoteContinuation] 引号值是否可跨行（dotenv）
 */
function extractKeyValue(tokens, lineCount, opts) {
  const out = [];
  let section = null;
  let continued = false;
  let openQuote = "";   // 非空表示当前行仍在上一个跨行引号值内部
  for (let i = 0; i < lineCount; i++) {
    const raw = tokens[i].raw;
    const trimmed = raw.trim();
    // 跨行引号值内部：整行都是值，既不是键、也不参与段头 / 注释判定
    if (openQuote !== "") {
      openQuote = continueQuoteOn(raw, openQuote);
      continue;
    }
    // 续行归属上一键；续行自身行尾也可能再次续行（同样只看奇数个反斜杠）
    if (continued) { continued = opts.continuation && endsWithContinuation(raw); continue; }
    if (trimmed.length === 0 || isCommentLine(raw, opts.comment)) continue;
    if (opts.sections) {
      const ms = /^\[([^\]]+)\]/.exec(trimmed);
      if (ms !== null) {
        const name = ms[1].trim();
        if (name.length > 0 && name.length <= CFG_NAME_MAX) {
          out.push({ kind: "section", name, line: i + 1 });
          section = name;
        }
        continue;
      }
    }
    let body = trimmed;
    if (opts.exportPrefix && /^export\s+/.test(body)) body = body.replace(/^export\s+/, "");
    let name = null;
    let sepCut = -1;
    if (opts.escape === true && opts.spaceSep === true) {
      // properties：与高亮共用 properties-key.js 的截断规则
      // （含转义裸键 `key\:part` 与行尾续行反斜杠 `a\`），两边不可能漂移。
      const keyText = propertiesKeySlice(body);
      if (keyText.length > 0) name = keyText;
    } else if (opts.sep !== null) {
      const cut = keyEndOf(body, opts.sep, opts);
      if (cut > 0) {
        name = body.slice(0, cut).trim();
        sepCut = cut;
      }
    }
    // dotenv：值以引号开头且本行没闭合 → 后续行都是这个值的内容（本行照常出键）
    if (opts.quoteContinuation && sepCut >= 0) {
      openQuote = openQuoteOf(body.slice(sepCut + 1).trim());
    }
    // 裸键行：INI 的 `key`
    if (name === null && opts.bare && /^[A-Za-z_][\w.-]*$/.test(body)) name = body;
    if (name === null || name.length === 0) continue;
    name = opts.escape === true ? unescapePropertyKey(name) : unquoteKey(name);
    if (name.length === 0 || name.length > CFG_NAME_MAX) continue;
    const sym = { kind: "key", name, line: i + 1 };
    if (section !== null) sym.container = section;
    out.push(sym);
    if (opts.continuation && endsWithContinuation(raw)) continued = true;
  }
  return out;
}

/** XML 名字字符。 */
function isXmlNameChar(ch) {
  return ch === "_" || ch === "." || ch === ":" || ch === "-"
    || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

/**
 * XML：元素树 + 属性。先在 tokenize 结果上把注释与字符串（含 CDATA）抹白，
 * 结构解析就只在元素名 / 属性名 / 标签标点上进行 —— 属性值里的 `<` `>` 与
 * 注释里的假标签都不会打乱配对。标签可跨行，故扫描是全文一次通过的。
 */
function extractXml(tokens, lineCount) {
  const masked = new Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    const raw = tokens[i].raw;
    const segs = tokens[i].segs;
    let chars = null;
    let pos = 0;
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      const from = pos;
      pos += seg.text.length;
      if (seg.cls !== "c-comment" && seg.cls !== "c-string") continue;
      if (chars === null) chars = raw.split("");
      for (let k = from; k < pos && k < chars.length; k++) chars[k] = " ";
    }
    masked[i] = chars === null ? raw : chars.join("");
  }
  const out = [];
  const stack = [];          // 未闭合的元素名
  // 名字 → 它在 stack 里的下标（升序）。闭合标签找匹配项从 O(depth) 降到 O(1)；
  // 大量错配标签时旧实现是 O(n²)（500 KB 约 20 秒），这条路径必须保持近似线性。
  const openPositions = new Map();
  const positionsOf = (name) => {
    let list = openPositions.get(name);
    if (list === undefined) { list = []; openPositions.set(name, list); }
    return list;
  };
  /** 弹出 stack[index..]（含 index），同步维护 openPositions。 */
  const popTo = (index) => {
    for (let k = stack.length - 1; k >= index; k--) {
      const list = openPositions.get(stack[k]);
      if (list !== undefined) {
        list.pop();
        if (list.length === 0) openPositions.delete(stack[k]);
      }
    }
    stack.length = index;
  };
  let mode = "text";         // text | tag | close | skip
  let buf = "";
  let element = null;
  let selfClose = false;
  let dtdDepth = 0;          // DOCTYPE 内部子集 `[ ... ]` 的层数
  let li = 0;
  let ci = 0;
  while (li < lineCount) {
    const lineText = masked[li];
    if (ci >= lineText.length) { li++; ci = 0; continue; }
    const ch = lineText[ci];
    if (mode === "text") {
      if (ch === "<") {
        const next = lineText[ci + 1];
        if (next === "/") { mode = "close"; buf = ""; ci += 2; continue; }
        if (next === "!" || next === "?") { mode = "skip"; dtdDepth = 0; ci += 2; continue; }   // DOCTYPE / PI
        mode = "tag"; buf = ""; element = null; selfClose = false; ci += 1; continue;
      }
      ci++;
      continue;
    }
    if (mode === "skip") {
      // DOCTYPE 可带内部子集 `[ ... ]`，其中的 '>' 不结束声明
      if (ch === "[") { dtdDepth++; ci++; continue; }
      if (ch === "]") { if (dtdDepth > 0) dtdDepth--; ci++; continue; }
      if (ch === ">" && dtdDepth === 0) { mode = "text"; ci++; continue; }
      ci++;
      continue;
    }
    if (mode === "close") {
      if (isXmlNameChar(ch)) { buf += ch; ci++; continue; }
      if (buf.length > 0) {
        const list = openPositions.get(buf);
        if (list !== undefined && list.length > 0) popTo(list[list.length - 1]);   // 连同匹配项一起弹出
        buf = "";
        mode = "skip";                    // 名字读完，跳到 '>'（此处不会再有内部子集）
        continue;
      }
      ci++;
      continue;
    }
    // mode === "tag"：先取元素名，再取属性名
    if (element === null) {
      if (isXmlNameChar(ch)) { buf += ch; ci++; continue; }
      if (buf.length > 0) {
        element = buf.length > CFG_NAME_MAX ? buf.slice(0, CFG_NAME_MAX) : buf;
        buf = "";
        const sym = { kind: "element", name: element, line: li + 1 };
        if (stack.length > 0) sym.container = stack[stack.length - 1];
        out.push(sym);
        continue;               // 同一个字符继续按属性/结束符处理
      }
      ci++;
      continue;
    }
    if (isXmlNameChar(ch)) { buf += ch; ci++; continue; }
    if (buf.length > 0) {
      // 属性名与元素名同一口径：超长的「名字」几乎必然是解析跑偏（少见的引号未闭合等），
      // 代码大纲对 >CFG_NAME_MAX 的名字是直接丢弃，这里也丢弃而不是截断入列。
      if (buf.length <= CFG_NAME_MAX) {
        out.push({ kind: "attribute", name: buf, line: li + 1, container: element });
      }
      buf = "";
      continue;
    }
    if (ch === "/") { selfClose = true; ci++; continue; }
    if (ch === ">") {
      if (!selfClose && element !== null) {
        stack.push(element);
        positionsOf(element).push(stack.length - 1);
      }
      element = null;
      selfClose = false;
      mode = "text";
      ci++;
      continue;
    }
    ci++;
  }
  return out;
}

/**
 * 配置文件大纲入口。
 * @param {string} text 文件内容
 * @param {string} lang 语言 id
 * @param {Array<{raw:string,segs:Array}>} tokens tokenizeLines 的结果
 * @param {number} lineCount
 * @returns {Array<{kind:string,name:string,line:number,container?:string}>}
 */
export function outlineOfConfig(text, lang, tokens, lineCount) {
  if (lang === "json") return extractJson(text);
  if (lang === "yaml") return extractYaml(tokens, lineCount);
  if (lang === "toml") return extractToml(tokens, lineCount);
  if (lang === "xml") return extractXml(tokens, lineCount);
  if (lang === "ini") {
    return extractKeyValue(tokens, lineCount, { comment: ["#", ";"], sep: "=:", sections: true, bare: true, continuation: false, exportPrefix: false });
  }
  if (lang === "properties") {
    // Java properties：`=` `:` 以及**空白**都是合法分隔符；反斜杠是转义符
    // （`key\:part` 的键名是 `key:part`），行尾奇数个 `\` 才是续行。
    return extractKeyValue(tokens, lineCount, { comment: ["#", "!"], sep: "=:", sections: false, bare: true, continuation: true, exportPrefix: false, spaceSep: true, escape: true });
  }
  if (lang === "dotenv") {
    // dotenv 的引号值允许跨行：`KEY="line1\nline2"` 的续行属于值，不能当新键。
    return extractKeyValue(tokens, lineCount, { comment: ["#"], sep: "=", sections: false, bare: false, continuation: false, exportPrefix: true, quoteContinuation: true });
  }
  return [];
}
