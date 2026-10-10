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
      keyText = raw.endsWith(quote) ? raw.slice(0, -1) : raw;
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
 * YAML：缩进驱动的映射键；值为空（后随子块）的键视为段。
 * 只认「后接空白 / 行尾」的冒号，故 `url: http://x` 不会把 `http` 当成键。
 * `|` / `>` 块标量的正文按缩进跳过，故正文里的 `fake: value` 不会成为键。
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
    if (trimmed.startsWith("---") || trimmed.startsWith("...")) continue;   // 文档分隔符
    const indent = indentOf(raw);
    let body = raw.slice(indent);
    const listItem = /^-\s+/.test(body);
    if (listItem) body = body.replace(/^-\s+/, "");
    if (body.startsWith("#")) continue;
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
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const container = stack.length > 0 ? stack[stack.length - 1].name : undefined;
    const sym = { kind: valueText.length === 0 ? "section" : "key", name, line: i + 1 };
    if (container !== undefined) sym.container = container;
    out.push(sym);
    if (valueText.length === 0) stack.push({ indent, name });
    // `|` / `>`（可带 `-` `+` 与缩进指示数字）→ 后续更深缩进的行是字面正文
    if (/^[|>][-+\d]*$/.test(valueText)) blockIndent = indent;
  }
  return out;
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
    const ms = /^\[+([^\]]+)\]+/.exec(trimmed);
    if (ms !== null) {
      const name = ms[1].trim();
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
 */
function extractKeyValue(tokens, lineCount, opts) {
  const out = [];
  let section = null;
  let continued = false;
  for (let i = 0; i < lineCount; i++) {
    const raw = tokens[i].raw;
    const trimmed = raw.trim();
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
    if (opts.escape === true && opts.spaceSep === true) {
      // properties：与高亮共用 properties-key.js 的截断规则
      // （含转义裸键 `key\:part` 与行尾续行反斜杠 `a\`），两边不可能漂移。
      const keyText = propertiesKeySlice(body);
      if (keyText.length > 0) name = keyText;
    } else if (opts.sep !== null) {
      const cut = keyEndOf(body, opts.sep, opts);
      if (cut > 0) name = body.slice(0, cut).trim();
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
        const at = stack.lastIndexOf(buf);
        if (at >= 0) stack.length = at;   // 连同匹配项一起弹出
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
      out.push({ kind: "attribute", name: buf, line: li + 1, container: element });
      buf = "";
      continue;
    }
    if (ch === "/") { selfClose = true; ci++; continue; }
    if (ch === ">") {
      if (!selfClose) stack.push(element);
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
    return extractKeyValue(tokens, lineCount, { comment: ["#"], sep: "=", sections: false, bare: false, continuation: false, exportPrefix: true });
  }
  return [];
}
