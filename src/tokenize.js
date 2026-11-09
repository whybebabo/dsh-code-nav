/**
 * dsh-code-nav — 轻量多语言语法高亮分词器（纯函数，浏览器/node 通用）。
 *
 * 逐行扫描，状态跨行保持（块注释、Python 三引号字符串）。
 * 每行输出：{ raw, segs: [{ text, cls }] }，cls 取值为：
 *   ""（普通）| c-comment | c-string | c-kw | c-type | c-num | c-ident | c-fn
 * 构建时由 scripts/build.mjs 内联进 lib/client.js（import/export 行被剥离，
 * 内联后共享同一函数作用域）。
 */

import { LANG_META } from "./lang-registry.js";
import { propertiesKeySlice } from "./properties-key.js";

const RE_IDENT = /[A-Za-z_$][\w$]*/y;
const RE_NUM = /\d[\w.]*|0[xX][0-9a-fA-F]+|\.\d[\w.]*/y;
/** XML 名字：允许命名空间前缀与连字符（`xsl:template` / `my-tag`）。 */
const RE_XMLNAME = /[A-Za-z_][\w.:-]*/y;
/**
 * Rust 字符字面量：`'x'` / `'\n'` / `'\x41'` / `'\u{1F600}'`。
 * Rust 的 `'` 同时用于生命周期（`'a`），后者没有闭合引号，不能用普通字符串扫描。
 */
const RE_CHAR_LITERAL = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^'\\\n])'/;

const _kwSets = new Map();
const _kwLowerSets = new Map();
const _typeSets = new Map();

function wordSet(meta, key) {
  if (!_kwSets.has(key)) _kwSets.set(key, new Set(meta.keywords || []));
  return _kwSets.get(key);
}
/** 小写关键字集合：SQL / PHP 的关键字大小写不敏感。 */
function lowerWordSet(meta, key) {
  if (!_kwLowerSets.has(key)) {
    _kwLowerSets.set(key, new Set((meta.keywords || []).map((w) => w.toLowerCase())));
  }
  return _kwLowerSets.get(key);
}
function typeSet(meta, key) {
  if (!_typeSets.has(key)) _typeSets.set(key, new Set(meta.types || []));
  return _typeSets.get(key);
}

/** 正则字面量只能出现在表达式位置：这些关键字之后可以，`a / b` 的 `a` 之后不行。 */
const JS_REGEX_KEYWORDS = new Set(
  "return case throw typeof instanceof in of new delete void yield await".split(" ")
);

/**
 * 前一个「有效」字符 / 关键字是否处于可以跟正则字面量的表达式位置。
 * 注释被视为透明（不刷新状态），字符串 / 数字之后则是值，`/` 是除法。
 * @param {string} prevChar 上一个有效字符（空串表示行首 / 文件开头）
 * @param {string} prevWord prevChar 所在单词的尾部（用于 return / typeof 等）
 * @returns {boolean}
 */
function jsRegexAllowedAfter(prevChar, prevWord) {
  if (prevChar === "") return true;
  if ("=(:,[{!&|?+-*%^~<>;".includes(prevChar)) return true;
  return prevWord !== "" && JS_REGEX_KEYWORDS.has(prevWord);
}

/**
 * 扫描行内正则字面量（跳过 `[...]` 字符类与转义），返回结束偏移；不像正则时返回 -1。
 * 正则不能跨行，故本行找不到未转义的 `/` 就落回普通标点 / 除法。
 * @param {string} raw
 * @param {number} start `/` 所在列
 * @returns {number}
 */
function jsRegexLiteralEnd(raw, start) {
  let k = start + 1;
  let inClass = false;
  for (; k < raw.length; k++) {
    const ch = raw[k];
    if (ch === "\\") { k++; continue; }
    if (inClass) { if (ch === "]") inClass = false; continue; }
    if (ch === "[") { inClass = true; continue; }
    if (ch === "/") {
      k++;
      while (k < raw.length && /[A-Za-z]/.test(raw[k])) k++; // 标志位
      return k;
    }
  }
  return -1;
}

/** JS 标识符字符：正则上下文启发式（`prevWord` 累积 / SFC 扫描）共用。 */
function isJsWordChar(ch) {
  return ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

/**
 * 从 j 起扫描块注释（j 已在开定界符之后），返回 { end, depth }。
 * depth 是扫描结束后剩余的嵌套深度：0 表示本行已闭合。只有声明了
 * `nestedBlockComments` 的语言才会数内层 `bStart`（Rust / Swift / Kotlin）。
 * @returns {{end:number, depth:number}}
 */
function scanBlockComment(raw, j, bStart, bEnd, nested, depth) {
  if (!nested) {
    const e = raw.indexOf(bEnd, j);
    return e === -1 ? { end: raw.length, depth } : { end: e + bEnd.length, depth: 0 };
  }
  // 嵌套语言逐字符前进：如果每层都重新 indexOf(bEnd)，深度嵌套会退化成二次方
  let k = j;
  while (k < raw.length) {
    if (raw.startsWith(bStart, k)) {
      depth++;
      k += bStart.length;
      continue;
    }
    if (raw.startsWith(bEnd, k)) {
      depth--;
      k += bEnd.length;
      if (depth === 0) return { end: k, depth: 0 };
      continue;
    }
    k++;
  }
  return { end: raw.length, depth };
}

/**
 * 该位置的 `--[=*[` 是否是 Lua 长注释开头；是则返回开 / 闭定界符。
 * @returns {{open:string, close:string}|null}
 */
function luaLongCommentAt(raw, j) {
  if (raw[j] !== "-" || raw[j + 1] !== "-" || raw[j + 2] !== "[") return null;
  let p = j + 3;
  while (raw[p] === "=") p++;
  if (raw[p] !== "[") return null;
  const eq = p - (j + 3);
  return { open: raw.slice(j, p + 1), close: "]" + "=".repeat(eq) + "]" };
}

/** YAML 行首缩进（空格 / Tab 各记 1 列）。 */
function yamlIndentOf(raw) {
  let i = 0;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) i++;
  return i;
}

/**
 * 去掉 YAML 行尾注释（旧写法 `body.replace(/\s+#.*$/, "")` 的线性等价实现）。
 *
 * 旧正则不在行尾锚定：行内有一段长空白时，引擎会从每个空白起点贪婪吃完整段
 * 再逐字符回退去找 `#` → O(空白长度²)（40k 空白 ≈ 470ms，见 review P2-3）。
 * 这里一次从左到右扫过，命中的 `#` 才回退它前面那段连续空白。
 * @param {string} body 已去掉行首空白的单行文本
 * @returns {string}
 */
function stripYamlLineComment(body) {
  for (let k = 1; k < body.length; k++) {
    if (body[k] !== "#") continue;
    const prev = body[k - 1];
    if (prev !== " " && prev !== "\t") continue;
    let start = k - 1;
    while (start > 0 && (body[start - 1] === " " || body[start - 1] === "\t")) start--;
    return body.slice(0, start);
  }
  return body;
}

/**
 * 该行是否是 YAML 块标量头（`key: |` / `- >-` / `key: |2` 等）。
 * 是则返回父键的缩进（正文行缩进 <= 它时块结束），否则返回 -1。
 * @param {string} raw
 * @returns {number}
 */
function yamlBlockScalarHeader(raw) {
  // trimEnd 是线性的；不再用 `/\s+$/`（长空白 + 非空尾时 O(n²)）
  const trimmed = raw.trimEnd();
  if (trimmed.length === 0) return -1;
  const body = trimmed.replace(/^\s+/, "");
  if (body.startsWith("#")) return -1;
  // 行尾注释不属于值（`key: | # note`）
  const noComment = stripYamlLineComment(body);
  // 指标必须紧跟 `:` 的值位置（或整行 / 列表项之后），且后面只能有 `-` `+` 数字
  if (!/(?:^|:\s+|^-\s+)[|>][-+\d]*\s*$/.test(noComment)) return -1;
  return yamlIndentOf(raw);
}

/**
 * 跨行普通字符串规则：`{ open, close, escape, doubled }`。
 * - `escape` 默认 true：反斜杠转义下一个字符；
 * - `doubled`：闭合定界符连写表示一个字面定界符（C# 逐字字符串 `""`）。
 * @returns {Array<{open:string, close:string, escape:boolean, doubled:boolean}>}
 */
function normalizeMultilineRules(meta) {
  const raw = meta.multilineStrings;
  if (!Array.isArray(raw)) return [];
  const rules = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || typeof item.open !== "string" || item.open.length === 0) continue;
    const close = typeof item.close === "string" && item.close.length > 0 ? item.close : item.open;
    rules.push({
      open: item.open,
      close,
      escape: item.escape !== false,
      doubled: item.doubled === true
    });
  }
  return rules;
}

/** 找到与开定界符对应的跨行字符串规则（没有则说明该引号不跨行）。 */
function multilineRuleFor(rules, quote) {
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].open === quote) return rules[i];
  }
  return null;
}

/**
 * 把一段"代码 run"切成带类别的片段。
 * @param {string} code
 * @param {object} meta 语言元数据
 * @param {string} key 语言 id
 */
function tokenizeRun(code, meta, key) {
  const segs = [];
  const n = code.length;
  let i = 0;
  const kws = wordSet(meta, key);
  const lowerKws = meta.caseInsensitiveKeywords === true ? lowerWordSet(meta, key) : null;
  const tys = typeSet(meta, key);
  const hasTypeHeuristic = (meta.types || []).length > 0;
  while (i < n) {
    const ch = code[i];
    if (ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      RE_IDENT.lastIndex = i;
      const m = RE_IDENT.exec(code);
      const word = m[0];
      let cls = "c-ident";
      const kwHit = lowerKws === null ? kws.has(word) : lowerKws.has(word.toLowerCase());
      if (kwHit) cls = "c-kw";
      else if (tys.has(word)) cls = "c-type";
      else if (hasTypeHeuristic && word.length > 1 && word[0] >= "A" && word[0] <= "Z") cls = "c-type";
      segs.push({ text: word, cls });
      i = RE_IDENT.lastIndex;
    } else if (ch >= "0" && ch <= "9") {
      RE_NUM.lastIndex = i;
      const m = RE_NUM.exec(code);
      segs.push({ text: m[0], cls: "c-num" });
      i = RE_NUM.lastIndex;
    } else {
      let j = i;
      while (j < n && !(code[j] === "_" || code[j] === "$" || (code[j] >= "a" && code[j] <= "z") || (code[j] >= "A" && code[j] <= "Z") || (code[j] >= "0" && code[j] <= "9"))) j++;
      segs.push({ text: code.slice(i, j), cls: "" });
      i = j;
    }
  }
  // 标识符紧跟 ( → 视为函数（声明与调用都上色，便于扫读）
  for (let k = 0; k < segs.length - 1; k++) {
    if (segs[k].cls === "c-ident" && /^\s*\(/.test(segs[k + 1].text)) segs[k].cls = "c-fn";
  }
  return segs;
}

/** XML 名字首字符。 */
function isXmlNameStart(ch) {
  return ch === "_" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/**
 * XML 行内 run 分词器。保留「标签内 / 标签外」与「下一个名字是元素名」两个状态：
 * 元素名 → c-tag，属性名 → c-attr，引号里的属性值由外层状态机切成 c-string，
 * 标签外的文本内容留白。
 *
 * 状态以 `{ inTag, expectName }` 传入 / 读出，因此可以跨行、也可以跨 chunk
 * （属性可以换行写、开标签可以在块边界处被切开）。
 * @param {{inTag?:boolean, expectName?:boolean}} [initial]
 * @returns {(code:string)=>Array<{text:string, cls:string}>}
 */
function makeXmlRunner(initial) {
  let inTag = initial !== undefined && initial !== null && initial.inTag === true;
  let expectName = initial !== undefined && initial !== null && initial.expectName === true;
  const run = (code) => {
    const segs = [];
    const n = code.length;
    let i = 0;
    while (i < n) {
      if (!inTag) {
        // 标签外：整段文本内容原样留白，直到下一个 '<'
        const at = code.indexOf("<", i);
        const end = at === -1 ? n : at;
        if (end > i) {
          segs.push({ text: code.slice(i, end), cls: "" });
          i = end;
          continue;
        }
      }
      const ch = code[i];
      if (ch === "<") {
        const two = code.slice(i, i + 2);
        const len = two === "</" || two === "<?" ? 2 : 1;
        segs.push({ text: code.slice(i, i + len), cls: "" });
        i += len;
        inTag = true;
        expectName = true;
        continue;
      }
      if (ch === ">") {
        segs.push({ text: ">", cls: "" });
        i += 1;
        inTag = false;
        expectName = false;
        continue;
      }
      if (ch === "/" || ch === "?") {
        // 自闭合 "/>"、处理指令 "?>"、以及 DOCTYPE 里的标点
        segs.push({ text: ch, cls: "" });
        i += 1;
        continue;
      }
      if (isXmlNameStart(ch)) {
        RE_XMLNAME.lastIndex = i;
        const m = RE_XMLNAME.exec(code);
        segs.push({ text: m[0], cls: expectName ? "c-tag" : "c-attr" });
        i = RE_XMLNAME.lastIndex;
        expectName = false;
        continue;
      }
      // 标签内的空白 / "=" / 数字等标点
      let j = i;
      while (j < n && code[j] !== "<" && code[j] !== ">" && code[j] !== "/" && code[j] !== "?" && !isXmlNameStart(code[j])) j++;
      if (j === i) j = i + 1; // 防御：保证推进
      segs.push({ text: code.slice(i, j), cls: "" });
      i = j;
    }
    return segs;
  };
  run.isInTag = () => inTag;
  run.expectName = () => expectName;
  return run;
}

/** 按绝对偏移 [start,end) 把 segs 切开，并把该区间标成 cls。 */
function markRange(segs, start, end, cls) {
  if (end <= start) return;
  const out = [];
  let pos = 0;
  for (const s of segs) {
    const s0 = pos;
    const s1 = pos + s.text.length;
    pos = s1;
    if (s1 <= start || s0 >= end || s.cls === "c-comment") {
      out.push(s);
      continue;
    }
    const a = Math.max(s0, start);
    const b = Math.min(s1, end);
    if (a > s0) out.push({ text: s.text.slice(0, a - s0), cls: s.cls });
    out.push({ text: s.text.slice(a - s0, b - s0), cls });
    if (b < s1) out.push({ text: s.text.slice(b - s0), cls: s.cls });
  }
  segs.length = 0;
  for (const s of out) segs.push(s);
}

/** 该语言的注释起始标记列表（lineComment 是单值写法，lineComments 是配置语言的多值写法）。 */
function commentMarkers(meta) {
  if (Array.isArray(meta.lineComments)) return meta.lineComments;
  return meta.lineComment === null || meta.lineComment === undefined ? [] : [meta.lineComment];
}

/**
 * 注释标记在该位置是否真的能起注释。
 * 配置语言的注释起始位置是有规定的，不能见字符就切：
 * - `commentLineStart`（Java properties）：`#` / `!` 只在行首（含缩进后）起注释，
 *   行内不存在注释语法，故 `a=hello!world` 的 `!world` 是值；
 * - `commentNeedsSpace`（YAML / INI / dotenv）：标记必须位于行首或紧跟在空白之后，
 *   故 `url: http://x/a#frag` 的 `#frag` 是值、`KEY=x#y` 的 `#y` 是值；TOML
 *   的 `#` 则可直接跟在未加引号的值后。
 * - 其余语言（`//` 等）：C 系语法允许出现在任意位置，保持原行为。
 * @param {string} raw 原始行
 * @param {number} j 标记起始列
 * @param {object} meta
 * @param {string} marker 命中的注释标记（用于 `#[` 这类按标记区分的例外）
 * @returns {boolean}
 */
function commentAllowedAt(raw, j, meta, marker) {
  // PHP 8 属性：`#[Route('/x')]` 的 `#` 后紧跟 `[`，是 attribute 不是行注释
  // （review P2-4；真正注释行 `# note` / `# [x]` 不受影响）。
  if (meta.commentHashAttribute === true && marker === "#" && raw[j + 1] === "[") return false;
  if (meta.commentLineStart === true) return raw.slice(0, j).trim().length === 0;
  if (meta.commentNeedsSpace === true) {
    if (j === 0) return true;
    const prev = raw[j - 1];
    return prev === " " || prev === "\t";
  }
  // shell：`#` 在 `; & | (` 之后也能起注释（命令分隔符后），但 URL 片段 `x#frag` 不行
  if (meta.commentExtraBefore !== undefined) {
    if (j === 0) return true;
    return meta.commentExtraBefore.includes(raw[j - 1]);
  }
  return true;
}

/** 该行（去行首空白后）是否以注释标记开头。 */
function isCommentOnlyLine(raw, meta) {
  const head = raw.replace(/^\s+/, "");
  for (const marker of commentMarkers(meta)) {
    if (marker.length > 0 && head.startsWith(marker)) return true;
  }
  return false;
}

/**
 * 行尾连续反斜杠个数（忽略行尾空白）。Java properties 规定**奇数**个才是续行。
 * @param {string} line
 * @returns {number}
 */
function trailingBackslashCount(line) {
  const t = line.trimEnd();
  let count = 0;
  while (count < t.length && t[t.length - 1 - count] === "\\") count++;
  return count;
}

/**
 * 该行是否以「续行反斜杠」结尾。与 `config-outline.js` 的 `endsWithContinuation`
 * 完全同口径（`a=foo\\` 的 `\\` 是转义出的字面反斜杠，不续行）。
 * @param {string} line
 * @returns {boolean}
 */
function propertiesEndsWithContinuation(line) {
  return trailingBackslashCount(line) % 2 === 1;
}

/**
 * 找出配置行里「键」的 [start,end) 区间；找不到返回 null。
 * - `=` 系列（toml / ini / properties / dotenv）：分隔符后可紧接值（`a=1`）；
 * - `:` 在 YAML 里必须后接空白或行尾（`a:1` 是标量不是映射），故按语言区分；
 * - 行首允许缩进与 `- ` 列表符号（YAML 的 `- name: x`）；
 * - 段头行（`[a.b]`）单独处理，不算键。
 * - `escape`（Java properties）打开时 `\` 后的字符不算分隔符，故 `key\:part`
 *   的整个 `key\:part` 都是键名；
 * - `spaceSep`（Java properties）打开时空白也算分隔符，故 `server.port 8080`
 *   的键是 `server.port`。
 * - `exportPrefix`（dotenv）打开时行首 `export ` 只是前缀，键从其后开始，
 *   故 `export EXTRA=1` 的键是 `EXTRA`（与 config-outline.js 的大纲口径一致）。
 * @param {string} raw
 * @param {string} sep 候选分隔符字符集
 * @param {boolean} colonNeedsSpace `:` 是否必须后接空白
 * @param {object} [opts]
 * @param {boolean} [opts.escape] 反斜杠是否为转义符
 * @param {boolean} [opts.spaceSep] 空白是否也算分隔符
 * @param {boolean} [opts.exportPrefix] 是否跳过行首 `export ` 前缀
 * @returns {{start:number,end:number}|null}
 */
function keyRangeOf(raw, sep, colonNeedsSpace, opts) {
  const escape = opts !== undefined && opts.escape === true;
  const spaceSep = opts !== undefined && opts.spaceSep === true;
  const exportPrefix = opts !== undefined && opts.exportPrefix === true;
  let lead = /^\s*(?:-\s+)*/.exec(raw)[0].length;
  // dotenv 的 `export FOO=1`：`export` 不是键的一部分，键从其后开始
  if (exportPrefix) {
    const m = /^export\s+/.exec(raw.slice(lead));
    if (m !== null) lead += m[0].length;
  }
  const rest = raw.slice(lead);
  // properties：键的截断规则与大纲共用 properties-key.js（含裸键、转义、行尾续行反斜杠）。
  // 走单独分支，避免两处各写一套判定而漂移。
  if (opts !== undefined && opts.bare === "properties") {
    // trimEnd 是线性的（`/\s+$/` 在长空白 + 非空尾时是 O(n²)，review P2-3）
    const body = rest.trimEnd();
    const keyText = propertiesKeySlice(body);
    if (keyText.length === 0) return null;
    const at = body.indexOf(keyText);
    if (at < 0) return null;
    return { start: lead + at, end: lead + at + keyText.length };
  }
  let best = -1;
  let quote = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (quote !== "") {
      if (quote === '"' && ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    // 转义符吃掉下一个字符：`key\:part` 的 `:` 不是分隔符
    if (escape && ch === "\\") { i++; continue; }
    if (sep.indexOf(ch) === -1) {
      // properties 的空白分隔（`server.port 8080`）；转义空格不属于此列
      if (spaceSep && (ch === " " || ch === "\t")) { best = i; break; }
      continue;
    }
    if (ch === ":" && colonNeedsSpace) {
      const after = rest[i + 1];
      if (after !== undefined && after !== " " && after !== "\t") continue;
    }
    best = i;
    break;
  }
  if (best < 0) {
    // 无分隔符的裸键行（INI）：整行就是键。
    // 必须与 config-outline.js 的 `opts.bare` 判定一致，否则会出现
    // 「大纲能列出、却不高亮」的不一致。
    const bare = opts === undefined ? undefined : opts.bare;
    if (bare === "ident") {
      const keyText = rest.trimEnd();
      if (keyText.length > 0 && /^[A-Za-z_][\w.-]*$/.test(keyText)) {
        return { start: lead, end: lead + keyText.length };
      }
    }
    return null;
  }
  const keyText = rest.slice(0, best);
  if (keyText.trim().length === 0) return null;
  // 值里才出现的分隔符不算键（例如 `json: {"a":1}` 已由上面的 first-match 语义排除）
  if (/^[>|]/.test(keyText.trim())) return null;  // YAML 块标量头
  // 分隔符前的空白不属于键（`port = 8080` 只给 `port` 上色）
  const prefix = rest.slice(0, best);
  const structural = /^[{[,]\s*/.exec(prefix);
  if (structural !== null) lead += structural[0].length;
  const end = lead + best - (keyText.length - keyText.trimEnd().length)
    - (structural === null ? 0 : structural[0].length);
  return { start: lead, end };
}

/**
 * 配置语言的「键 / 段头」上色（json / yaml / toml / ini / properties / dotenv）。
 * 注释行整行不参与；键区间与注释重叠时由 markRange 跳过注释段。
 * @param {string} raw 原始行
 * @param {Array<{text:string, cls:string}>} segs 该行已有 token（原地修改）
 * @param {object} meta
 */
function decorateConfigLine(raw, segs, meta) {
  const sep = meta.keySep;
  if (sep === undefined || raw.trim().length === 0) return;
  // 注释行整行不参与（properties 续行行首的 `#` 已在续行分支里按值处理）
  if (isCommentOnlyLine(raw, meta)) return;
  if (meta.keyQuoted === true) {
    // JSON / jsonc / json5：键是**字符串或裸标识符**，其后紧跟 ':'。
    // 按 token 逐个判断（而不是取「本行第一个分隔符」），故一行里写多个键也能全部上色，
    // 且 `x = {a: 1}` 这种行不会把 `x = {` 一起涂成键。
    let marked = false;
    for (let k = 0; k < segs.length; k++) {
      if (segs[k].cls !== "c-string" && segs[k].cls !== "c-ident" && segs[k].cls !== "c-kw") continue;
      let rest = "";
      for (let t = k + 1; t < segs.length; t++) {
        rest += segs[t].text;
        if (rest.replace(/^\s+/, "").length > 0) break;
      }
      if (rest.replace(/^\s+/, "").startsWith(":")) {
        segs[k].cls = "c-key";
        marked = true;
      }
    }
    if (marked) return;
  }
  const range = keyRangeOf(raw, sep, meta.keyColonSpace === true, {
    escape: meta.keyEscape === true,
    spaceSep: meta.keySpaceSep === true,
    exportPrefix: meta.keyExportPrefix === true,
    // 裸键行的口径，必须与 config-outline.js 的 `opts.bare` 一一对应：
    //   "properties" = properties 的转义扫描（含转义分隔符与续行反斜杠）
    //   "ident"      = INI 的标识符形状
    //   undefined    = 不支持裸键（TOML 的 `foo` 是语法错误，不该上色成键）
    bare: meta.keyBare
  });
  if (range !== null) {
    markRange(segs, range.start, range.end, "c-key");
    return;
  }
  if (meta.sectionLines === true) {
    // [section] / [[array-of-table]] 段头。手写线性扫描：正则 `/^\s*\[+([^\]]*?)\]+/`
    // 在「一长串 `[` 且没有 `]`」时会灾难性回溯（二次方 / 指数级），50k 个 `[` 直接卡死。
    let p = 0;
    while (p < raw.length && (raw[p] === " " || raw[p] === "\t")) p++;
    if (raw[p] === "[") {
      while (p < raw.length && raw[p] === "[") p++;   // 开括号（`[[bin]]` 有两个）
      const contentStart = p;
      let q = p;
      while (q < raw.length && raw[q] !== "]") q++;
      // 必须有闭括号（与旧正则的 `\]+` 一致）；区间保持旧行为：`  [ x ]` 连空格一起标
      if (q < raw.length && raw.slice(contentStart, q).trim().length > 0) {
        markRange(segs, contentStart, q, "c-section");
      }
    }
  }
}

/** `<script` 标签名后的边界（`<scriptx` 不是 script 标签）。 */
function sfcTagBoundary(ch) {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

/**
 * 从脚本正文里找真正的 `</script>`。实现一个自包含的「JS 词法感知」扫描：
 *
 * 状态：none / 引号字符串（`'` `"` `` ` ``）/ 行注释 / 块注释 / 正则字面量。
 * **只有 state === none 时遇到的 `</script` 才是收尾标签** —— 字符串、
 * 模板字符串、行 / 块注释、正则字面量（`/["']/`、`/it's/`）里的 `</script` 都不算。
 *
 * 正则起始用经典 prior-token 启发式（与 `tokenizeRun` 共用 `jsRegexAllowedAfter`）：
 *   - 行首 / 前一个有效字符是 ``= ( [ { , ; : ! & | ? + - * % < > ~ ^`` → 可起正则；
 *   - 前一个完整单词是 `return` / `typeof` / `case` / `throw` / … → 可起正则；
 *   - 前一个有效 token 是标识符 / 数字 / 字符串 / 右括号 → `/` 是除法。
 * 注释透明（不刷新 prior token）；换行复位 prior token；正则不能跨行（行内找不到
 * 闭合 `/` 就按除法处理，绝不吞掉后面的行）。
 *
 * 扫描不到收尾标签时返回 null，调用方保持旧行为（`bodyEnd = n`）。**不会**回退成
 * 盲目 `indexOf("</script")` —— 那会把字符串 / 正则里的同名文本当收尾标签（正是
 * 本 bug 的反面）。
 * @returns {{index:number, end:number}|null}
 */
function sfcFindScriptClose(text, from) {
  let i = from;
  const n = text.length;
  let prevChar = "";
  let prevWord = "";
  const noteChar = (ch) => {
    if (ch === " " || ch === "\t" || ch === "\r") return;
    prevChar = ch;
    if (isJsWordChar(ch)) prevWord = (prevWord + ch).slice(-16);
    else prevWord = "";
  };
  while (i < n) {
    const ch = text[i];
    // 行注释：直到行尾（注释透明，prior token 不刷新）
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      i = nl < 0 ? n : nl + 1;
      prevChar = "";
      prevWord = "";
      continue;
    }
    // 块注释：可跨行，同样透明；未闭合则后面不可能有真正的收尾标签
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      // 注释跨行时相当于 tokenizeRun 在新行复位 prior token
      if (text.lastIndexOf("\n", end) >= i) { prevChar = ""; prevWord = ""; }
      i = end + 2;
      continue;
    }
    // 引号字符串 / 模板字符串：引号内的 `</script` 不算收尾
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        const c = text[i];
        if (c === "\\") { i += 2; continue; }
        if (c === quote) { i++; break; }
        // 普通字符串不能跨行：源码不合法时在行尾放弃，别吞掉后续收尾标签
        if (c === "\n" && quote !== "`") break;
        i++;
      }
      prevChar = quote;   // 字符串是值：后面的 `/` 是除法
      prevWord = "";
      continue;
    }
    // 正则字面量：行内扫描 `[...]` 字符类与转义；不闭合就按除法继续
    if (ch === "/" && jsRegexAllowedAfter(prevChar, prevWord)) {
      let k = i + 1;
      let inClass = false;
      let closed = false;
      for (; k < n; k++) {
        const c = text[k];
        if (c === "\n" || c === "\r") break;
        if (c === "\\") { k++; continue; }
        if (inClass) { if (c === "]") inClass = false; continue; }
        if (c === "[") { inClass = true; continue; }
        if (c === "/") { closed = true; k++; break; }
      }
      if (closed) {
        while (k < n && /[A-Za-z]/.test(text[k])) k++; // 标志位
        prevChar = "/";
        prevWord = "";
        i = k;
        continue;
      }
    }
    // 真正的收尾标签：只有走到这里（不在任何字符串 / 注释 / 正则里）才算。
    // 手写扫描而不是 16 字符窗口正则，`</script   >` 允许任意多空白 / 换行。
    if (ch === "<" && text[i + 1] === "/" && text.slice(i + 2, i + 8).toLowerCase() === "script") {
      let k = i + 8;
      while (k < n) {
        const c = text[k];
        if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") { k++; continue; }
        break;
      }
      if (text[k] === ">") return { index: i, end: k + 1 };
    }
    if (ch === "\n") {
      prevChar = "";
      prevWord = "";
      i++;
      continue;
    }
    noteChar(ch);
    i++;
  }
  return null;
}

/**
 * 抽取 Vue/Svelte 的 `<script>` 正文区间（绝对偏移）。
 * - 开标签的 `>` 要跳过引号内的字符（`<script data-x="a>b">` 不提前结束）；
 * - 标签名 / 关闭标签大小写不敏感；
 * - HTML 注释里的 `<script>` 不算；支持多个 script 块。
 * @returns {Array<{start:number, end:number, lang:string}>}
 */
function sfcScriptRanges(text) {
  const ranges = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== "<") {
      i++;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.slice(i, i + 7).toLowerCase() !== "<script" || !sfcTagBoundary(text[i + 7])) {
      i++;
      continue;
    }
    // 找开标签的 `>`（引号里的 `>` 不算）
    let quote = "";
    let p = i + 7;
    for (; p < n; p++) {
      const ch = text[p];
      if (quote !== "") {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === ">") break;
    }
    if (p >= n) break; // 开标签没闭合：忽略
    // 自闭合 / 无正文的 script（`<script src="./main.ts" />`）：不找收尾标签，
    // 否则整个剩余文件都会被当成脚本区间（review P2-2 第二形态）。
    if (text[p - 1] === "/") {
      i = p + 1;
      continue;
    }
    const attrs = text.slice(i + 7, p);
    const bodyStart = p + 1;
    const close = sfcFindScriptClose(text, bodyStart);
    const bodyEnd = close === null ? n : close.index;
    const isTs = /lang\s*=\s*(?:"(?:ts|typescript)"|'(?:ts|typescript)'|(?:ts|typescript)(?=[\s/>]|$))/i.test(attrs);
    ranges.push({ start: bodyStart, end: bodyEnd, lang: isTs ? "typescript" : "javascript" });
    i = close === null ? n : close.end;
  }
  return ranges;
}

/** 在已算好的行首偏移表里定位绝对偏移所在行（二分查找）。 */
function sfcLineIndexOf(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Vue/Svelte 单文件组件分词：只有 `<script>` 块内按 JS / TS 分词，块外每行留白。
 * 行号 / raw / str 都按原文件坐标保留；开 / 闭标签与脚本正文同行时按列切开。
 * @param {string} text
 * @param {string[]} lines
 */
function tokenizeScriptBlocks(text, lines) {
  const ranges = sfcScriptRanges(text);
  const lineStarts = [0];
  for (let p = text.indexOf("\n"); p !== -1; p = text.indexOf("\n", p + 1)) lineStarts.push(p + 1);
  const merged = new Array(lines.length).fill(null);
  const mergedStr = new Array(lines.length).fill(false);
  for (const range of ranges) {
    const content = text.slice(range.start, range.end);
    const sub = tokenizeLines(content, range.lang);
    if (sub === null) continue;
    const firstLine = sfcLineIndexOf(lineStarts, range.start);
    for (let k = 0; k < sub.length; k++) {
      const L = firstLine + k;
      if (L >= lines.length) break;
      let segs = sub[k].segs;
      if (k === 0) {
        const prefixLen = range.start - lineStarts[L];
        if (prefixLen > 0) segs = [{ text: lines[L].slice(0, prefixLen), cls: "" }].concat(segs);
      }
      if (k === sub.length - 1) {
        const suffix = lines[L].slice(range.end - lineStarts[L]);
        if (suffix.length > 0) segs = segs.concat([{ text: suffix, cls: "" }]);
      }
      mergedStr[L] = mergedStr[L] || sub[k].str === true;
      merged[L] = merged[L] === null ? segs : merged[L].concat(segs);
    }
  }
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    let segs = merged[i];
    // 块外（或多个块共享同一行等极端排版）：整行原样留白，保证不丢字符
    if (segs === null || segs.map((s) => s.text).join("") !== lines[i]) {
      segs = [{ text: lines[i], cls: "" }];
    }
    out[i] = { raw: lines[i], segs, str: mergedStr[i] === true };
  }
  return out;
}

/**
 * 在不改变数组内容 / `deepEqual` 结果的前提下标记「内容超过 500 KB 上限、
 * 尾部没有分词」。非枚举属性，与 `search.js` 的 `capped` / `outline.js` 的
 * `capped` 同一惯例；客户端据此把截断事实显示出来（G2）。
 * @template T
 * @param {T} lines
 * @returns {T}
 */
function markTokenizeTruncated(lines) {
  if (lines.truncated !== true) Object.defineProperty(lines, "truncated", { value: true, enumerable: false });
  return lines;
}

/** 跨块分词状态的版本号。结构变化时递增；旧版本状态按「无效」处理，重新从文件开头开始。 */
const TOKENIZE_STATE_VERSION = 1;

/**
 * 新建一个「文件开头」的跨块分词状态。
 *
 * 所有字段都是 JSON 可序列化的原始值：不含函数 / DOM / Map，也不持有任何 chunk
 * 文本的引用（Lua 长注释的闭定界符是普通字符串值，不是原文本的切片视图）。
 * @returns {{
 *   v:number, blockDepth:number, luaLongEnd:string,
 *   inTriple:boolean, tripleEnd:string,
 *   inString:boolean, stringEnd:string, stringEscape:boolean, stringDoubled:boolean,
 *   xmlInTag:boolean, xmlExpectName:boolean,
 *   yamlScalarIndent:number, propertiesContinued:boolean
 * }}
 */
function freshTokenizeState() {
  return {
    v: TOKENIZE_STATE_VERSION,
    blockDepth: 0,             // 块注释嵌套深度（0 表示不在注释里）
    luaLongEnd: "",            // Lua 长注释进行中时其闭定界符
    inTriple: false,           // 跨行长字符串 / CDATA 进行中
    tripleEnd: "",             // 其闭定界符
    inString: false,           // 跨行普通字符串进行中
    stringEnd: "",             // 其闭定界符
    stringEscape: false,       // 续行中反斜杠是否转义
    stringDoubled: false,      // 续行中连写闭定界符是否表示字面定界符（C# `""`）
    xmlInTag: false,           // XML：是否在标签内
    xmlExpectName: false,      // XML：下一个名字是否元素名
    yamlScalarIndent: -1,      // YAML 块标量父键缩进（-1 表示不在块标量正文里）
    propertiesContinued: false // properties 续行（行尾奇数个反斜杠）
  };
}

/**
 * 调用方传入的状态是否可用。
 *
 * 除了字段类型，还要拒绝「进行中但闭定界符为空」的组合：`inTriple` / `inString`
 * 的闭定界符为空时，`indexOf("")` 会一直命中当前列，行扫描原地死循环。
 * 非普通对象（Map / 数组 / class 实例）与旧版本一律视为无效 → 从文件开头开始。
 * @param {unknown} state
 * @returns {boolean}
 */
function isValidTokenizeState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
  const proto = Object.getPrototypeOf(state);
  if (proto !== Object.prototype && proto !== null) return false;
  if (state.v !== TOKENIZE_STATE_VERSION) return false;
  return Number.isInteger(state.blockDepth) && state.blockDepth >= 0
    && typeof state.luaLongEnd === "string"
    && typeof state.inTriple === "boolean"
    && typeof state.tripleEnd === "string"
    && (!state.inTriple || state.tripleEnd.length > 0)
    && typeof state.inString === "boolean"
    && typeof state.stringEnd === "string"
    && (!state.inString || state.stringEnd.length > 0)
    && typeof state.stringEscape === "boolean"
    && typeof state.stringDoubled === "boolean"
    && typeof state.xmlInTag === "boolean"
    && typeof state.xmlExpectName === "boolean"
    && Number.isInteger(state.yamlScalarIndent)
    && typeof state.propertiesContinued === "boolean";
}

/**
 * 分词实现：`tokenizeLines` 与 `tokenizeLinesWithState` 共用同一条状态机。
 *
 * @param {unknown} text
 * @param {unknown} lang
 * @param {unknown} inputState `undefined` / 无效 → 从「文件开头」开始
 * @returns {{lines:Array<{raw:string, segs:Array<{text:string, cls:string}>}>, state:object} | null}
 */
function tokenizeWithState(text, lang, inputState) {
  if (typeof text !== "string" || !Object.hasOwn(LANG_META, lang)) return null;
  const meta = LANG_META[lang];
  const truncated = text.length > 500000; // 防御性上限（每次调用单独计算）
  if (truncated) text = text.slice(0, 500000);
  const lines = text.split(/\r?\n/);
  // Vue/Svelte 单文件组件：只有 script 块按 JS/TS 分词，模板 / 样式行留白。
  // 流式状态不覆盖 SFC（整文件布局要先看到全部文本），按整块处理后返回空状态。
  if (meta.scriptBlocks === true) {
    const out = tokenizeScriptBlocks(text, lines);
    return { lines: truncated ? markTokenizeTruncated(out) : out, state: {} };
  }
  const st = isValidTokenizeState(inputState) ? inputState : freshTokenizeState();
  const out = new Array(lines.length);
  const key = lang;
  const lineCmts = commentMarkers(meta);
  const bStart = meta.blockComment ? meta.blockComment[0] : null;
  const bEnd = meta.blockComment ? meta.blockComment[1] : null;
  const nestedBlocks = meta.nestedBlockComments === true;
  const luaLong = meta.luaLongComments === true;
  const strings = meta.strings || [];
  // 跨行「长字符串」定界符：字符串项（`"""`，开闭相同）或 [开, 闭] 对
  // （XML CDATA 的 `<![CDATA[` … `]]>`）。
  const triples = (meta.tripleStrings || []).map((t) => (Array.isArray(t) ? t : [t, t]));
  // 跨行普通字符串规则（`{open, close, escape, doubled}`）：JS 模板串、Go 原始串、
  // C# 逐字串、XML 属性值。`close` 与开定界符可以不同（C# 开 `@"`、闭 `"`）。
  const multilineRules = normalizeMultilineRules(meta);
  // XML 的标签内/外状态要跨行保持（属性可以换行写），故 runner 建在循环外，
  // 并以传入状态（上一个 chunk 结束时的 XML 状态）初始化。
  const xmlRun = meta.xmlTags === true
    ? makeXmlRunner({ inTag: st.xmlInTag, expectName: st.xmlExpectName })
    : null;
  // 配置文件是否需要对「键 / 段头」补上色
  const decorate = meta.keySep !== undefined || meta.sectionLines === true;
  let blockDepth = st.blockDepth;           // 块注释嵌套深度（0 表示不在注释里）
  let luaLongEnd = st.luaLongEnd;           // Lua 长注释进行中时其结束定界符
  let inTriple = st.inTriple;               // 长字符串 / CDATA 进行中
  let tripleEnd = st.tripleEnd;             // 其结束定界符
  let inString = st.inString;
  let stringEnd = st.stringEnd;             // 续行字符串的闭定界符
  let stringEscape = st.stringEscape;       // 续行中反斜杠是否转义
  let stringDoubled = st.stringDoubled;     // 续行中连写闭定界符是否表示字面定界符（C# `""`）
  // YAML 块标量：父键缩进（>=0 表示正文中），正文行不参与键装饰
  let yamlScalarIndent = st.yamlScalarIndent;
  // properties 续行（Java properties：行尾奇数个反斜杠 → 下一行是上一键的值）。
  // 与 config-outline.js 的 `continued` 状态完全同口径，避免「大纲算值、高亮算键」。
  const trackContinuation = meta.keyContinuation === true;
  let propertiesContinued = st.propertiesContinued;
  /** 当前状态快照（新对象；跨 chunk 调用方拿到的是值拷贝，不是内部引用）。 */
  const readState = () => ({
    v: TOKENIZE_STATE_VERSION,
    blockDepth,
    luaLongEnd,
    inTriple,
    tripleEnd,
    inString,
    stringEnd,
    stringEscape,
    stringDoubled,
    xmlInTag: xmlRun === null ? false : xmlRun.isInTag(),
    xmlExpectName: xmlRun === null ? false : xmlRun.expectName(),
    yamlScalarIndent,
    propertiesContinued
  });
  // 分块调用的常见形态是「块文本以行分隔符结尾」：split 会多出一个尾随空行
  // （调用方通常像客户端 tokenizeChunk 那样把它丢掉）。那个空行在全文里并不存在，
  // 若让它参与状态推进，properties 续行态会被误清除，所以状态取「最后一个真实行
  // 结束时」的快照；返回的 lines 仍与 tokenizeLines 完全一致。
  const endsWithBreak = text.length > 0 && text.charCodeAt(text.length - 1) === 10;
  let stateBeforeLastLine = null;
  // JS 正则判定需要的「前一个有效字符 / 关键字」。`code` 是 rope，不能对每个 `/`
  // 做随机下标（会反复摊平字符串，长行退化成二次方），故增量维护；
  // 注释视为透明，字符串 / 数字之后视为值（`/` 是除法）。
  const trackRegex = meta.regexLiterals === true;
  let prevChar = "";
  let prevWord = "";
  const noteChar = trackRegex
    ? (ch) => {
      if (ch === " " || ch === "\t") return;
      prevChar = ch;
      if (isJsWordChar(ch)) prevWord = (prevWord + ch).slice(-16);
      else prevWord = "";
    }
    : () => {};
  const noteSegment = trackRegex
    ? (text) => {
      if (text.length === 0) return;
      prevChar = text[text.length - 1];
      prevWord = "";
    }
    : () => {};
  for (let i = 0; i < lines.length; i++) {
    // 尾随空行之前的状态快照（见上方 endsWithBreak 注释）
    if (endsWithBreak && i === lines.length - 1) stateBeforeLastLine = readState();
    const raw = lines[i];
    // 行首本身是表达式位置（`/re/.test(x)` 常见于行首），故正则上下文按行重置
    if (trackRegex) { prevChar = ""; prevWord = ""; }
    // properties 续行：上一行以奇数个反斜杠结尾 → 本行是上一键的值的一部分
    // （Java properties 语义）。整行按值处理：不再找键、行首的 `#` / `!` 也不是
    // 注释；`str: true` 与 YAML 块标量正文同义，消费方不会把它当新的键值行。
    // 空行 / 不带续行反斜杠的行结束续行态（与 config-outline.js 一致）。
    if (propertiesContinued) {
      propertiesContinued = propertiesEndsWithContinuation(raw);
      out[i] = { raw, segs: raw.length > 0 ? [{ text: raw, cls: "c-string" }] : [], str: true };
      continue;
    }
    const segs = [];
    // 本行是否为「跨行长字符串的续行」：此时整行都是字符串内容，
    // 既不参与键 / 段头上色，也不应被大纲当成新的一行键值
    const longStringContinuation = inTriple || inString;
    // YAML 块标量正文：缩进比父键更深（或空行）的行整行是标量内容，
    // 既不能当键 / 段头装饰，也不能把正文里的 `#` 当注释。
    if (meta.yamlBlockScalars === true && yamlScalarIndent >= 0) {
      const isContent = raw.trim().length === 0 || yamlIndentOf(raw) > yamlScalarIndent;
      if (isContent) {
        out[i] = { raw, segs: raw.length > 0 ? [{ text: raw, cls: "c-string" }] : [], str: true };
        continue;
      }
      yamlScalarIndent = -1; // 缩进回退 → 块结束，本行照常解析
    }
    let code = "";
    const flush = () => {
      if (code.length > 0) {
        const run = xmlRun === null ? tokenizeRun(code, meta, key) : xmlRun(code);
        for (const s of run) segs.push(s);
        code = "";
      }
    };
    let j = 0;
    while (j < raw.length) {
      // 跨行普通字符串续行：整段直到真正的闭定界符都属于字符串，
      // 其中的 `<` `>`、注释标记、引号都不参与其它判定。
      if (inString) {
        let done = -1;
        let k = j;
        if (stringDoubled) {
          // C# 逐字字符串：连写的 `""` 是字面引号，单个 `"` 才闭合
          for (; k < raw.length; k++) {
            if (raw[k] !== stringEnd) continue;
            if (raw[k + 1] === stringEnd) { k++; continue; }
            done = k;
            break;
          }
        } else {
          let esc = false;
          for (; k < raw.length; k++) {
            const ch = raw[k];
            if (esc) { esc = false; continue; }
            if (stringEscape && ch === "\\") { esc = true; continue; }
            if (raw.startsWith(stringEnd, k)) break;
          }
          done = k < raw.length ? k : -1;
        }
        if (done === -1) {
          const text = raw.slice(j);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = raw.length;
        } else {
          const closeLen = stringDoubled ? 1 : stringEnd.length;
          const text = raw.slice(j, done + closeLen);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = done + closeLen;
          inString = false;
          stringEnd = "";
          stringDoubled = false;
        }
        continue;
      }
      if (luaLongEnd !== "") {
        const e = raw.indexOf(luaLongEnd, j);
        if (e === -1) {
          segs.push({ text: raw.slice(j), cls: "c-comment" });
          j = raw.length;
        } else {
          segs.push({ text: raw.slice(j, e + luaLongEnd.length), cls: "c-comment" });
          j = e + luaLongEnd.length;
          luaLongEnd = "";
        }
        continue;
      }
      if (blockDepth > 0) {
        const scan = scanBlockComment(raw, j, bStart, bEnd, nestedBlocks, blockDepth);
        segs.push({ text: raw.slice(j, scan.end), cls: "c-comment" });
        blockDepth = scan.depth;
        j = scan.end;
        continue;
      }
      if (inTriple) {
        const e = raw.indexOf(tripleEnd, j);
        if (e === -1) {
          const text = raw.slice(j);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = raw.length;
        } else {
          const text = raw.slice(j, e + tripleEnd.length);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = e + tripleEnd.length;
          inTriple = false;
        }
        continue;
      }
      // Lua 长注释开始：`--[[ … ]]` / `--[=*[ … ]=*]`（等级决定闭定界符）
      if (luaLong && raw.startsWith("--[", j)) {
        const lc = luaLongCommentAt(raw, j);
        if (lc !== null) {
          flush();
          const e = raw.indexOf(lc.close, j + lc.open.length);
          if (e === -1) {
            segs.push({ text: raw.slice(j), cls: "c-comment" });
            j = raw.length;
            luaLongEnd = lc.close;
          } else {
            segs.push({ text: raw.slice(j, e + lc.close.length), cls: "c-comment" });
            j = e + lc.close.length;
          }
          continue;
        }
      }
      // 块注释开始（声明了 nestedBlockComments 的语言按深度配对）
      if (bStart !== null && raw.startsWith(bStart, j)) {
        flush();
        const scan = scanBlockComment(raw, j + bStart.length, bStart, bEnd, nestedBlocks, 1);
        segs.push({ text: raw.slice(j, scan.end), cls: "c-comment" });
        blockDepth = scan.depth;
        j = scan.end;
        continue;
      }
      // 行注释（配置语言可有多个标记：ini 的 # 与 ;、properties 的 # 与 !）
      let commented = false;
      for (let c = 0; c < lineCmts.length; c++) {
        const marker = lineCmts[c];
        if (marker.length > 0 && raw.startsWith(marker, j) && commentAllowedAt(raw, j, meta, marker)) {
          flush();
          segs.push({ text: raw.slice(j), cls: "c-comment" });
          j = raw.length;
          commented = true;
          break;
        }
      }
      if (commented) continue;
      // 长字符串 / CDATA 开始（定界符可跨行：Python 三引号、XML CDATA）
      let tripled = false;
      for (let t = 0; t < triples.length; t++) {
        const open = triples[t][0];
        const close = triples[t][1];
        if (!raw.startsWith(open, j)) continue;
        flush();
        const e = raw.indexOf(close, j + open.length);
        if (e === -1) {
          const text = raw.slice(j);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = raw.length;
          inTriple = true;
          tripleEnd = close;
        } else {
          const text = raw.slice(j, e + close.length);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = e + close.length;
        }
        tripled = true;
        break;
      }
      if (tripled) continue;
      // JS 正则字面量：`/[/*]/` 不能被当成 `/*` 块注释开头。
      // 只有在表达式位置（前一个有效字符 / 关键字）才尝试，除法 `a / b` 不受影响。
      if (meta.regexLiterals === true && raw[j] === "/" && jsRegexAllowedAfter(prevChar, prevWord)) {
        const end = jsRegexLiteralEnd(raw, j);
        if (end > 0) {
          flush();
          const text = raw.slice(j, end);
          segs.push({ text, cls: "c-string" });
          noteSegment(text);
          j = end;
          continue;
        }
      }
      // 普通字符串
      let strd = false;
      // XML 标签外的引号只是普通文本，只有标签内才可能是属性值定界符。
      const startsQuote = strings.some((quote) => quote.length > 0 && raw.startsWith(quote, j));
      if (xmlRun !== null && startsQuote) flush();
      const allowString = xmlRun === null || xmlRun.isInTag();
      for (let q = 0; allowString && q < strings.length; q++) {
        const quote = strings[q];
        if (quote.length === 0 || !raw.startsWith(quote, j)) continue;
        // Rust：`'` 既可能是字符字面量，也可能是生命周期标注。只有形如字符字面量的
        // 才当字符串；`'a` / `'static` 这类没有闭合引号，落回普通标点，
        // 否则 `fn f<'a>(s: &'a str)` 整行都会被涂成字符串。
        if (meta.charLiteralOnly === true && quote === "'" && !RE_CHAR_LITERAL.test(raw.slice(j))) continue;
        // 该引号若声明了跨行规则，闭合用规则的 close（C# 开 `@"`、闭 `"`）
        const rule = multilineRuleFor(multilineRules, quote);
        const verbatim = rule !== null && rule.doubled === true;
        const closeDelim = rule !== null ? rule.close : quote;
        const escapes = !verbatim && (rule === null || rule.escape !== false);
        flush();
        let k = j + quote.length;
        if (verbatim) {
          // C# 逐字字符串：`""` 是转义出来的字面引号
          for (; k < raw.length; k++) {
            if (!raw.startsWith(closeDelim, k)) continue;
            if (raw.startsWith(closeDelim, k + closeDelim.length)) {
              k += closeDelim.length;
              continue;
            }
            break;
          }
        } else {
          let esc = false;
          for (; k < raw.length; k++) {
            const ch = raw[k];
            if (esc) { esc = false; continue; }
            // XML 属性值 / Go 原始字符串里的反斜杠不是转义符
            if (escapes && ch === "\\") { esc = true; continue; }
            if (raw.startsWith(closeDelim, k)) break;
          }
        }
        const end = k < raw.length ? k + closeDelim.length : raw.length;
        const text = raw.slice(j, end);
        segs.push({ text, cls: "c-string" });
        noteSegment(text);
        // 引号未在本行闭合 → 若该定界符支持跨行，字符串状态延到下一行
        if (k >= raw.length && rule !== null) {
          inString = true;
          stringEnd = rule.close;
          stringEscape = !verbatim && rule.escape !== false;
          stringDoubled = verbatim;
        }
        j = end;
        strd = true;
        break;
      }
      if (strd) continue;
      noteChar(raw[j]);
      code += raw[j];
      j++;
    }
    flush();
    if (decorate && !longStringContinuation) decorateConfigLine(raw, segs, meta);
    // 本行是 YAML 块标量头 → 后续更深缩进的行按正文处理
    if (meta.yamlBlockScalars === true) {
      const headerIndent = yamlBlockScalarHeader(raw);
      if (headerIndent >= 0) yamlScalarIndent = headerIndent;
    }
    // properties：本行是键值行且行尾奇数个反斜杠 → 下一行进续行态。
    // 注释行不开启续行（config-outline.js 在注释行上 continue，不会置 continued）。
    if (trackContinuation && raw.trim().length > 0 && propertiesEndsWithContinuation(raw)
      && !isCommentOnlyLine(raw, meta)) {
      propertiesContinued = true;
    }
    out[i] = { raw, segs, str: longStringContinuation === true };
  }
  const state = stateBeforeLastLine !== null ? stateBeforeLastLine : readState();
  return { lines: truncated ? markTokenizeTruncated(out) : out, state };
}

/**
 * 分词整个文件。
 *
 * 超过 500,000 字符只分词前面部分（防御性上限，宿主已经把文件大小当自己的
 * 职责，这一刀是本插件自己的），但返回数组上会挂非枚举 `truncated: true`
 * —— 客户端必须能说出「文件尾部没有参与渲染 / 查找 / 大纲」。
 * @param {string} text 文件内容
 * @param {string} lang 语言 id（LANG_META 键）
 * @returns {Array<{raw:string, segs:Array<{text:string, cls:string}>}> | null} 每行结果
 *   （`truncated === true` 表示内容被 500KB 上限截断）；语言未知或内容非法返回 null
 */
export function tokenizeLines(text, lang) {
  const result = tokenizeWithState(text, lang, undefined);
  return result === null ? null : result.lines;
}

/**
 * 带跨块状态的分词：大文件按块（行对齐）分词时，把上一块返回的 `state` 传进来，
 * 块边界就不会重置跨行状态机（块注释 / 嵌套块注释 / 模板字符串 / 三引号 /
 * C# 逐字串 / Go 原始串 / Lua 长注释 / XML 注释、CDATA、标签与属性 /
 * YAML 块标量 / properties 续行）。
 *
 * `state` 是普通、JSON 可序列化的对象（可以 `JSON.parse(JSON.stringify(state))`
 * 之后继续用），字段见 `freshTokenizeState()`；它只保存原始值与定界符字符串，
 * 不引用任何 chunk 文本。传 `undefined` / 非法对象（非普通对象、旧版本、字段类型
 * 不对、进行中却缺少闭定界符）时从「文件开头」开始。
 *
 * 分块约定（与 `src/file-chunks.js` 的 `planChunk` / `chunkFromRead` 一致）：
 * - 块边界必须落在整行边界上（块之间不切开行文本）；
 * - 非末块文本通常以行分隔符结尾。此时 `lines` 与 `tokenizeLines` 一样会多出
 *   一个尾随空行（调用方按既有逻辑丢弃即可，客户端 `tokenizeChunk` 就是这么做的），
 *   而返回的 `state` 是最后一个**真实行**结束时的状态——尾随空行在全文里并不存在，
 *   不能让它推进状态（否则 properties 续行态会被误清除）；
 * - 末块（eof）不再有「下一块」，直接使用完整返回的 `lines`。
 *
 * 对同一段文本，`tokenizeLinesWithState(text, lang).lines` 与
 * `tokenizeLines(text, lang)` 完全一致（含 `.truncated` 标记）；差异只有状态。
 *
 * Vue/Svelte（SFC）不在流式范围内：仍按整块现有行为分词（`scriptBlocks` 需要看到
 * 整个文件布局），并返回 `{}` 作为状态（客户端需另行处理 SFC 的块边界）。
 *
 * @param {string} text 本块文本（行对齐）
 * @param {string} lang 语言 id（LANG_META 键）
 * @param {object} [state] 上一块返回的状态；省略 / 非法 → 从文件开头开始
 * @returns {{lines:Array<{raw:string, segs:Array<{text:string, cls:string}>, str?:boolean}>, state:object} | null}
 *   语言未知或内容非法返回 null
 */
export function tokenizeLinesWithState(text, lang, state) {
  return tokenizeWithState(text, lang, state);
}
