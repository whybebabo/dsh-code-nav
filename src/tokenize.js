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

const _kwSets = new Map();
const _typeSets = new Map();

function wordSet(meta, key) {
  if (!_kwSets.has(key)) _kwSets.set(key, new Set(meta.keywords || []));
  return _kwSets.get(key);
}
function typeSet(meta, key) {
  if (!_typeSets.has(key)) _typeSets.set(key, new Set(meta.types || []));
  return _typeSets.get(key);
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
  const tys = typeSet(meta, key);
  const hasTypeHeuristic = (meta.types || []).length > 0;
  while (i < n) {
    const ch = code[i];
    if (ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      RE_IDENT.lastIndex = i;
      const m = RE_IDENT.exec(code);
      const word = m[0];
      let cls = "c-ident";
      if (kws.has(word)) cls = "c-kw";
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
 * XML 行内 run 分词器。保留「标签内 / 标签外」与「下一个名字是元素名」两个状态
 * （闭包按行创建，故状态只在行内有效）：元素名 → c-tag，属性名 → c-attr，
 * 引号里的属性值由外层状态机切成 c-string，标签外的文本内容留白。
 * @returns {(code:string)=>Array<{text:string, cls:string}>}
 */
function makeXmlRunner() {
  let inTag = false;
  let expectName = false;
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
 * @returns {boolean}
 */
function commentAllowedAt(raw, j, meta) {
  if (meta.commentLineStart === true) return raw.slice(0, j).trim().length === 0;
  if (meta.commentNeedsSpace === true) {
    if (j === 0) return true;
    const prev = raw[j - 1];
    return prev === " " || prev === "\t";
  }
  return true;
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
    const body = rest.replace(/\s+$/, "");
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
      const keyText = rest.replace(/\s+$/, "");
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
  const head = raw.replace(/^\s+/, "");
  for (const marker of commentMarkers(meta)) {
    if (marker.length > 0 && head.startsWith(marker)) return;
  }
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
    // [section] / [[array-of-table]] 段头
    const ms = /^\s*\[+([^\]]*?)\]+/.exec(raw);
    if (ms !== null && ms[1].trim().length > 0) {
      const at = raw.indexOf(ms[1], raw.indexOf("["));
      if (at >= 0) markRange(segs, at, at + ms[1].length, "c-section");
    }
  }
}

/**
 * 分词整个文件。
 * @param {string} text 文件内容
 * @param {string} lang 语言 id（LANG_META 键）
 * @returns {Array<{raw:string, segs:Array<{text:string, cls:string}>}> | null} 每行结果；语言未知或内容非法返回 null
 */
export function tokenizeLines(text, lang) {
  const meta = LANG_META[lang];
  if (!meta || typeof text !== "string") return null;
  if (text.length > 500000) text = text.slice(0, 500000); // 防御性上限
  const lines = text.split(/\r?\n/);
  const out = new Array(lines.length);
  const key = lang;
  const lineCmts = commentMarkers(meta);
  const bStart = meta.blockComment ? meta.blockComment[0] : null;
  const bEnd = meta.blockComment ? meta.blockComment[1] : null;
  const strings = meta.strings || [];
  // 跨行「长字符串」定界符：字符串项（`"""`，开闭相同）或 [开, 闭] 对
  // （XML CDATA 的 `<![CDATA[` … `]]>`）。
  const triples = (meta.tripleStrings || []).map((t) => (Array.isArray(t) ? t : [t, t]));
  // XML 的标签内/外状态要跨行保持（属性可以换行写），故 runner 建在循环外
  const xmlRun = meta.xmlTags === true ? makeXmlRunner() : null;
  // 配置文件是否需要对「键 / 段头」补上色
  const decorate = meta.keySep !== undefined || meta.sectionLines === true;
  let inBlock = false;          // 块注释进行中
  let inTriple = false;         // 长字符串 / CDATA 进行中
  let tripleEnd = "";           // 其结束定界符
  // 跨行普通字符串（XML 属性值允许换行）：只有声明了 multilineStrings 的语言才保持
  let inString = false;
  let stringEnd = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const segs = [];
    // 本行是否为「跨行长字符串的续行」：此时整行都是字符串内容，
    // 既不参与键 / 段头上色，也不应被大纲当成新的一行键值
    const longStringContinuation = inTriple || inString;
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
      // 跨行普通字符串续行（XML 属性值可换行写）：整段直到闭合引号都属于字符串，
      // 其中的 `<` `>` 与名字都不参与标签 / 属性判定
      if (inString) {
        const e = raw.indexOf(stringEnd, j);
        if (e === -1) {
          segs.push({ text: raw.slice(j), cls: "c-string" });
          j = raw.length;
        } else {
          segs.push({ text: raw.slice(j, e + 1), cls: "c-string" });
          j = e + 1;
          inString = false;
          stringEnd = "";
        }
        continue;
      }
      if (inBlock) {
        const e = raw.indexOf(bEnd, j);
        if (e === -1) {
          segs.push({ text: raw.slice(j), cls: "c-comment" });
          j = raw.length;
        } else {
          segs.push({ text: raw.slice(j, e + bEnd.length), cls: "c-comment" });
          j = e + bEnd.length;
          inBlock = false;
        }
        continue;
      }
      if (inTriple) {
        const e = raw.indexOf(tripleEnd, j);
        if (e === -1) {
          segs.push({ text: raw.slice(j), cls: "c-string" });
          j = raw.length;
        } else {
          segs.push({ text: raw.slice(j, e + tripleEnd.length), cls: "c-string" });
          j = e + tripleEnd.length;
          inTriple = false;
        }
        continue;
      }
      // 块注释开始
      if (bStart !== null && raw.startsWith(bStart, j)) {
        flush();
        const e = raw.indexOf(bEnd, j + bStart.length);
        if (e === -1) {
          segs.push({ text: raw.slice(j), cls: "c-comment" });
          j = raw.length;
          inBlock = true;
        } else {
          segs.push({ text: raw.slice(j, e + bEnd.length), cls: "c-comment" });
          j = e + bEnd.length;
        }
        continue;
      }
      // 行注释（配置语言可有多个标记：ini 的 # 与 ;、properties 的 # 与 !）
      let commented = false;
      for (let c = 0; c < lineCmts.length; c++) {
        const marker = lineCmts[c];
        if (marker.length > 0 && raw.startsWith(marker, j) && commentAllowedAt(raw, j, meta)) {
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
          segs.push({ text: raw.slice(j), cls: "c-string" });
          j = raw.length;
          inTriple = true;
          tripleEnd = close;
        } else {
          segs.push({ text: raw.slice(j, e + close.length), cls: "c-string" });
          j = e + close.length;
        }
        tripled = true;
        break;
      }
      if (tripled) continue;
      // 普通字符串
      let strd = false;
      // XML 标签外的引号只是普通文本，只有标签内才可能是属性值定界符。
      const startsQuote = strings.some((quote) => quote.length > 0 && raw.startsWith(quote, j));
      if (xmlRun !== null && startsQuote) flush();
      const allowString = xmlRun === null || xmlRun.isInTag();
      for (let q = 0; allowString && q < strings.length; q++) {
        const quote = strings[q];
        if (quote.length === 0 || !raw.startsWith(quote, j)) continue;
        flush();
        const verbatim = quote === "@\""; // C# 逐字字符串："" 转义、反斜杠不转义
        let k = j + quote.length;
        if (verbatim) {
          for (; k < raw.length; k++) {
            if (raw[k] === '"') {
              if (raw[k + 1] === '"') { k++; continue; }
              break;
            }
          }
        } else {
          let esc = false;
          for (; k < raw.length; k++) {
            const ch = raw[k];
            // XML 属性值没有反斜杠转义（`\` 是普通字符），跨行时不能按转义跳过引号
            if (esc) { esc = false; continue; }
            if (!meta.multilineStrings && ch === "\\") { esc = true; continue; }
            if (ch === quote) break;
          }
        }
        const end = k < raw.length ? k + 1 : raw.length;
        segs.push({ text: raw.slice(j, end), cls: "c-string" });
        // XML：引号未在本行闭合 → 字符串状态延到下一行（属性值可跨行）
        if (meta.multilineStrings && k >= raw.length) {
          inString = true;
          stringEnd = quote;
        }
        j = end;
        strd = true;
        break;
      }
      if (strd) continue;
      code += raw[j];
      j++;
    }
    flush();
    if (decorate && !longStringContinuation) decorateConfigLine(raw, segs, meta);
    out[i] = { raw, segs, str: longStringContinuation === true };
  }
  return out;
}
