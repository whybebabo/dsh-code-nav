/**
 * dsh-code-nav — 符号大纲解析（纯函数，浏览器/node 通用）。
 *
 * 基于 tokenizeLines 的结果剥离注释/字符串后，对"干净行"跑每语言规则，
 * 输出：{ kind, name, line, container? }（line 为 1 基）。
 * kind: class | interface | struct | enum | impl | trait | method | function |
 *       constructor | variable | field | constant | section | key | element |
 *       attribute
 * 构建时由 scripts/build.mjs 内联进 lib/client.js（import/export 行被剥离）。
 */

import { LANG_META } from "./lang-registry.js";
import { tokenizeLines } from "./tokenize.js";
import { outlineOfConfig } from "./config-outline.js";

/** 配置文件语言 id（走 config-outline.js 的提取器，而不是括号/缩进规则）。 */
const CONFIG_LANGS = new Set(["json", "yaml", "toml", "xml", "ini", "properties", "dotenv"]);

/** kind → 筛选分组（全部 / 类 / 方法 / 变量）。 */
export function kindGroup(kind) {
  switch (kind) {
    case "class": case "interface": case "struct": case "enum": case "impl": case "trait":
      return "class";
    case "method": case "function": case "constructor":
      return "method";
    case "variable": case "field": case "constant":
      return "variable";
    // 配置语言：段头（对象 / 表 / 元素层级）归「类」，键与属性归「变量」
    case "section":
      return "class";
    case "key": case "attribute":
      return "variable";
    case "element":
      return "class";
    default:
      return "other";
  }
}

const KWS_OF = (lang) => new Set(LANG_META[lang]?.keywords ?? []);

/** 取干净行（去掉注释与字符串片段）。 */
function cleanOf(tokens, i) {
  const segs = tokens[i].segs;
  let out = "";
  for (const s of segs) {
    if (s.cls === "c-comment" || s.cls === "c-string") continue;
    out += s.text;
  }
  return out;
}

/** 取只剥注释、保留字符串的行（SQL 的双引号标识符在 tokenize 里是字符串）。 */
function codeOf(tokens, i) {
  const segs = tokens[i].segs;
  let out = "";
  for (const s of segs) {
    if (s.cls === "c-comment") continue;
    out += s.text;
  }
  return out;
}

function countBraces(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return d;
}

/** `(` `[` `{` 的配平增量；Python 用它区分类体直属层与 dict / 参数列表续行。 */
function bracketDelta(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") d++;
    else if (ch === ")" || ch === "]" || ch === "}") d--;
  }
  return d;
}

/** 圆括号配平：跨行参数列表据此判断声明是否还没结束。 */
function parenBalance(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") d++;
    else if (ch === ")") d--;
  }
  return d;
}

/** 跨行声明最多向后拼接的行数（Prettier/ESLint 换行的参数列表远小于此）。 */
const MAX_DECL_CONTINUATION = 40;

/** 语句开头的行（return / throw / …）不可能是字段或方法声明。 */
const STATEMENT_LEAD = /^\s*(?:return|throw|goto|break|continue|case|else|do|while|for|if|switch|try|catch|finally|new|delete|yield|await|assert|using|lock|foreach|super|this)\b/;

/** 修饰词集合：`hasReturnTypeBefore` 用它区分「返回类型」与纯修饰词。 */
const DECL_MODIFIERS = new Set([
  "public", "private", "protected", "internal", "static", "abstract", "virtual",
  "override", "async", "readonly", "final", "sealed", "synchronized", "native",
  "const", "volatile", "transient", "open", "data", "lateinit", "external",
  "suspend", "inline", "tailrec", "operator", "infix", "mutating", "nonmutating",
  "fileprivate", "set", "get"
]);

/**
 * 关键字过滤的判断口径（见 extractBrace 内联过滤与 outlineOfTokens 末尾兜底）：
 * 「直接位于容器体内的成员」豁免关键字过滤 —— `class A { get() {} }` 是合法 JS，
 * Swift `init()` / Kotlin `constructor()` 也是成员；方法体 / 对象字面量里的同名
 * 关键字（`if (`、`while (`）拿不到容器，仍然被剔除。
 */

/** 方法名之前是否真的还有返回类型（`void draw(` 是，裸调用 `doStuff(` 不是）。 */
function hasReturnTypeBefore(m, name) {
  const at = m[0].lastIndexOf(name);
  if (at <= 0) return false;
  const words = m[0].slice(0, at).replace(/[*&\s]+/g, " ").trim().split(/\s+/);
  for (const w of words) {
    if (w.length === 0) continue;
    if (!DECL_MODIFIERS.has(w)) return true;
  }
  return false;
}

/** 语言分组：无函数体声明的判定方式不同。 */
const C_FAMILY = new Set(["java", "csharp", "c", "cpp"]);
const TS_FAMILY = new Set(["typescript", "tsx"]);

/** 能拥有「成员（方法/字段）」的容器 kind。 */
const MEMBER_CONTAINER_KINDS = new Set(["class", "interface", "struct", "enum", "impl", "trait"]);
/** JS/TS 里能直属类成员的容器（`class` 与 TS `interface`）。 */
const CLASS_BODY_KINDS = new Set(["class", "interface"]);

/**
 * 当前虚拟行是否「直接位于某个容器体的一层」。
 * 只有直属层才能把声明算成成员（field/method/constructor）；方法体里的
 * 局部变量 / 嵌套函数因深度更深而拿不到容器。返回容器或 null。
 */
function directMember(ctx, kinds) {
  const stack = ctx.stack;
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (top === null || ctx.depthBefore !== top.depth + 1) return null;
  if (kinds !== undefined && !kinds.has(top.kind)) return null;
  return top;
}

/**
 * 名字后（紧邻 `<`）的类型参数表：返回配平 `>` 之后的下标；不是合法
 * 泛型参数表（含 `(`/`)`/`;` 等语句字符、或没有配平 `>`）返回 -1。
 * 用于代替 `[^>]*` 这类贪心正则，`Map<string, Array<T>>` 的 `>>` 也能配平。
 */
function scanGenericParams(text, from) {
  if (text[from] !== "<") return -1;
  // 类型参数表不可能很长：限长扫描，避免压缩/畸形长行里大量 `<` 触发 O(n²)
  const max = Math.min(text.length, from + 200);
  let depth = 0;
  for (let i = from; i < max; i++) {
    const ch = text[i];
    if (ch === "<") depth++;
    else if (ch === ">") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === "(" || ch === ")" || ch === ";" || ch === "{" || ch === "}") {
      return -1;
    }
  }
  return -1;
}

/** `<` 前若是这些词，说明 `<>` 属于表达式 / 箭头函数，不是声明名后的类型参数表。 */
const NOT_DECL_NAME_BEFORE_GENERIC = new Set([
  "async", "await", "function", "return", "typeof", "new", "extends", "implements",
  "in", "of", "yield", "throw", "case", "const", "let", "var", "else", "do", "delete"
]);

/**
 * 抹掉「声明名后的泛型参数表」：`walk<T extends Map<K, V>>(` → `walk(`。
 * 只抹「前一个词是标识符名、`<...>` 配平后紧跟 `(`」的形态，因此
 * `a < b`、泛型返回类型 `Map<String, Int> walk(`、箭头 `<T,>(x) =>` 都不受影响。
 * 目的：让 METHOD_RE / function 规则仍能直接拿到方法名（`>>` 嵌套也配平）。
 */
function stripMemberGenerics(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "<") { out += ch; continue; }
    // 向前找 `<` 前最近的非空白字符 / 词（不做整串 trim，长行才不会是 O(n²)）
    let k = i - 1;
    while (k >= 0 && (text[k] === " " || text[k] === "\t")) k--;
    if (k < 0 || !/[A-Za-z0-9_$>]/.test(text[k])) { out += ch; continue; }
    let w = k;
    while (w >= 0 && /[A-Za-z0-9_$]/.test(text[w])) w--;
    const word = text.slice(w + 1, k + 1);
    if (NOT_DECL_NAME_BEFORE_GENERIC.has(word)) { out += ch; continue; }
    const end = scanGenericParams(text, i);
    if (end < 0 || !/^\s*\(/.test(text.slice(end, end + 40))) { out += ch; continue; }
    i = end - 1; // 跳过整个泛型参数表
  }
  return out;
}

/**
 * 方法 / 函数没有函数体时是否仍算符号：接口成员、abstract、C++ 纯虚 / `const;`
 * 方法、C 家族原型、TS 类里的重载签名。必须直接位于容器体里（或文件顶层）——
 * 方法体里的 `doStuff();` 不能被当成方法。
 */
function acceptBodyless(rule, text, m, ctx) {
  if (!rule.bodyless) return false;
  if (STATEMENT_LEAD.test(text)) return false;
  const name = m[rule.nameGroup];
  if (typeof name !== "string" || name.length === 0) return false;
  const top = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1] : null;
  // Swift protocol 的「要求」可以既没有函数体、也没有 `;`：
  //   protocol P { func f(id: Int) -> User? }
  // 只接受「容器体直属层 + 名字后配平的参数表 + 只剩 throws/-> T 尾巴」。
  if (rule.bodyless === "swiftMember") {
    if (top === null || top.kind !== "interface" || ctx.depthBefore !== top.depth + 1) return false;
    const nameEnd = m.index + m[0].lastIndexOf(name) + name.length;
    const openIdx = text.indexOf("(", nameEnd);
    if (openIdx < 0) return false;
    const close = matchParenClose(text, openIdx);
    if (close < 0) return false;
    const tail = text.slice(close + 1);
    return !/[{};=]/.test(tail);
  }
  // TS/JS 的 `semi: false`（Prettier 选项 / Standard 风格）：接口成员可以只靠换行
  // 结束，没有 `;`。只接受「接口体直属层 + 该虚拟行是物理行末尾 + 参数表配平后
  // 只剩 `: Type` 尾巴（可跨行参数）」；带 `;` / `=` / 函数体的行仍走后面的通用
  // 规则，行为不变。
  if (rule.bodyless === "tsInterfaceMember") {
    if (ctx.endsLine !== true) return false;
    if (top === null || top.kind !== "interface" || ctx.depthBefore !== top.depth + 1) return false;
    const nameEnd = m.index + m[0].lastIndexOf(name) + name.length;
    const openIdx = text.indexOf("(", nameEnd);
    if (openIdx < 0) return false;
    const close = matchParenClose(text, openIdx);
    if (close < 0) return false;
    const tail = text.slice(close + 1);
    return /^\s*(?::[^{};]*)?$/.test(tail);
  }
  if (!/;\s*$/.test(text)) return false;
  if (rule.bodyless === "prototype") {
    return top === null && ctx.depthBefore === 0 && hasReturnTypeBefore(m, name);
  }
  if (top === null || ctx.depthBefore !== top.depth + 1) return false;
  if (top.kind === "interface") return true;
  if (/\babstract\b/.test(text)) return true;
  if (C_FAMILY.has(ctx.lang)) {
    // 构造函数 `A(...)` / 析构函数 `~A(...)` 没有返回类型，名字等于容器名即成员
    if (name === top.name || name === "~" + top.name) return true;
    if (/\)\s*(?:const|override|final|noexcept|&|&&)\s*;\s*$/.test(text)) return true;
    if (/\)\s*=\s*(?:0|default|delete)\s*;\s*$/.test(text)) return true;
    return hasReturnTypeBefore(m, name);
  }
  if (TS_FAMILY.has(ctx.lang)) return true;
  return false;
}

/**
 * 方法名后第一个 `(` 的配对 `)` 下标（跳过参数里的嵌套括号）；找不到返回 -1。
 */
function matchParenClose(text, openIdx) {
  let d = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") d++;
    else if (ch === ")") {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

/**
 * 参数列表之后是否紧跟函数体：从方法名之后的 `(` 找到配对 `)`，只允许
 * 返回类型 / throws / const / -> / where 等声明尾巴，然后是 `{` 或 `=>`。
 * 这样 `foo(a, { b: 1 })` 这类调用不会因为参数里有对象字面量被误判成方法。
 */
function inlineBodyAfter(text, nameEnd) {
  const openIdx = text.indexOf("(", nameEnd);
  if (openIdx < 0) return false;
  const close = matchParenClose(text, openIdx);
  if (close < 0) return false;
  const tail = text.slice(close + 1);
  if (/^[\w:<>[\],.&*?\-+|\s]*?(?:\{|=>)/.test(tail)) return true;
  // C++ 构造函数初始化列表：`) : base(x), member_(y) {`（括号是初值，不是新调用）
  return /^\s*:\s*[\w:<>[\],.&*\s]*\([^)]*\)[^{;]*\{/.test(tail);
}

/**
 * 把一行按 `{` / `}` / 同级 `;` 切成多个虚拟行：同一行里的内联类体 / 方法体 /
 * 多个成员（`class A { x = 1; m() {} }`）也能逐段解析。
 * 只切「括号外」的分号：`for (int i = 0; i < n; i++)`、数组字面量里的 `;` 不动。
 * 字符串与注释在 cleanOf 里已经剥掉，不会切到它们内部。
 */
function splitBraceSegments(clean, lineNo, cleans, srcLines) {
  let start = 0;
  let cut = false;
  let paren = 0;
  for (let j = 0; j < clean.length; j++) {
    const ch = clean[j];
    if (ch === "(" || ch === "[") { paren++; continue; }
    if (ch === ")" || ch === "]") { if (paren > 0) paren--; continue; }
    if (ch === "{" || ch === "}" || (ch === ";" && paren === 0)) {
      cleans.push(clean.slice(start, j + 1));
      srcLines.push(lineNo);
      start = j + 1;
      cut = true;
    }
  }
  if (start < clean.length || !cut) {
    cleans.push(clean.slice(start));
    srcLines.push(lineNo);
  }
}

/**
 * 判断规则的函数体条件是否成立。
 * 返回 { ok, end }：end 是判定用到的最后一个虚拟行（跨行参数时 > i）。
 */
function bodyAccepted(rule, clean, i, cleans, m, ctx) {
  if (rule.endsWith === null || rule.endsWith === undefined) return { ok: true, end: i };
  const name = m[rule.nameGroup];
  const nameEnd = m.index + m[0].lastIndexOf(name) + name.length;
  // 标识符形式的箭头函数（`const f = x => …`）在正则匹配里已经吃到 `=>`
  if (/=>/.test(m[0]) || inlineBodyAfter(clean, nameEnd)) return { ok: true, end: i };
  let text = clean;
  let end = i;
  if (parenBalance(clean) > 0) {
    // 参数跨行：沿括号配平把后续行拼成一条逻辑声明
    let bal = parenBalance(clean);
    const max = Math.min(cleans.length, i + 1 + MAX_DECL_CONTINUATION);
    for (let k = i + 1; k < max && bal > 0; k++) {
      const c2 = cleans[k];
      if (c2.trim().length === 0) continue;
      text += " " + c2.trim();
      bal += parenBalance(c2);
      end = k;
    }
    if (bal > 0) return { ok: false, end: i }; // 括号始终没配平：不是可判定的声明
    // 「换行即结束」的判定要跟着拼接后的最后一段走：`run(opts: { a: number }): void`
    // 会被 `{`/`}` 切段，只有拼完才知道声明确实止于物理行末。
    if (ctx.lineEnds !== undefined) ctx.endsLine = ctx.lineEnds[end] === true;
    if (inlineBodyAfter(text, nameEnd)) return { ok: true, end };
  }
  if (acceptBodyless(rule, text, m, ctx)) return { ok: true, end };
  // 大括号另起一行（Allman 风格）：声明行不以 ; 结尾，且其后首个非空行以 { 开头
  if (!/;\s*$/.test(text)) {
    const max = Math.min(cleans.length, end + 8);
    for (let k = end + 1; k < max; k++) {
      const c2 = cleans[k];
      if (c2.trim().length === 0) continue;
      if (/^\s*\{/.test(c2)) return { ok: true, end };
      break;
    }
  }
  return { ok: false, end };
}

/**
 * C / C++ 的 `typedef struct { … } Alias;` / `typedef enum { … } Alias;`：
 * 开行没有标签名，真正的名字在收尾的 `} Alias;` 段。这里先做一次前向扫描，
 * 把开行重写成 `typedef struct Alias {`，后续规则与容器栈就与「有标签」的
 * 写法完全一致；收尾段（`} Alias;`）不含声明形状，不会产生第二个符号。
 * 收尾不是「标识符 + 可选分号」时（函数指针 / `__attribute__` 等）不猜名字，
 * 保持原样（这类 typedef 依旧不出符号，见 README 已知限制）。
 */
const TYPEDEF_OPEN_RE = /^(\s*typedef\s+)(struct|enum|union)\s*\{\s*$/;
const TYPEDEF_ALIAS_RE = /^\s*([A-Za-z_]\w*)\s*;?\s*$/;
/** 匿名 typedef 体最多向后找多少段（防畸形输入把整份文件扫成 O(n²)）。 */
const MAX_TYPEDEF_BODY_SEGMENTS = 20000;
function resolveTypedefNames(cleans) {
  for (let i = 0; i < cleans.length; i++) {
    const m = TYPEDEF_OPEN_RE.exec(cleans[i]);
    if (m === null) continue;
    let depth = countBraces(cleans[i]);
    let close = -1;
    const max = Math.min(cleans.length, i + MAX_TYPEDEF_BODY_SEGMENTS);
    for (let k = i + 1; k < max; k++) {
      depth += countBraces(cleans[k]);
      if (depth === 0) { close = k; break; }
      if (depth < 0) break; // 不配平：放弃
    }
    if (close < 0 || close + 1 >= cleans.length) continue;
    const ma = TYPEDEF_ALIAS_RE.exec(cleans[close + 1]);
    if (ma === null) continue;
    cleans[i] = m[1] + m[2] + " " + ma[1] + " {";
  }
}

/**
 * C 家族括号深度通用提取器。
 * rules: [{ re, kind, nameGroup, depth: 'any'|'gt0', container, endsWith, when, bodyless }]
 */
function extractBrace(lang, tokens, rules, lineCount) {
  const out = [];
  const kws = KWS_OF(lang);
  const stack = []; // 容器 { name, depth, kind }
  let depth = 0;
  const cleans = [];
  const srcLines = []; // 虚拟行 → 0 基原始行号
  for (let i = 0; i < lineCount; i++) splitBraceSegments(cleanOf(tokens, i), i, cleans, srcLines);
  // 泛型参数表会挡在名字与 `(` 之间：先统一抹掉（见 stripMemberGenerics），
  // 规则里就能继续用「名字 + (」的简单形态，`>>` 嵌套也不会被贪心正则带偏。
  for (let i = 0; i < cleans.length; i++) {
    if (cleans[i].includes("<")) cleans[i] = stripMemberGenerics(cleans[i]);
  }
  // 匿名 typedef 的别名在收尾行：补进开行，容器栈才能用上真名（C/C++ 专用）
  if (lang === "c" || lang === "cpp") resolveTypedefNames(cleans);
  /** 该虚拟行是否是所在物理行的最后一段（TS/JS「换行即结束」的成员判定用）。 */
  const endsSourceLine = (i) => {
    for (let k = i + 1; k < cleans.length && srcLines[k] === srcLines[i]; k++) {
      if (cleans[k].trim().length > 0) return false;
    }
    return true;
  };
  const lineEnds = cleans.map((_, k) => endsSourceLine(k));
  const consumed = new Set();
  for (let i = 0; i < cleans.length; i++) {
    const clean = cleans[i];
    if (clean.trim().length === 0) continue;
    const depthBefore = depth;
    if (!consumed.has(i)) {
      let matched = null;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        if (rule.depth === "gt0" && depthBefore === 0) continue;
        const m = rule.re.exec(clean);
        if (m === null) continue;
        const name = m[rule.nameGroup];
        if (typeof name !== "string" || name.length === 0 || name.length > 80) continue;
        const ctx = { m, depthBefore, stack, clean, lang, endsLine: lineEnds[i] === true, lineEnds };
        if (rule.when && !rule.when(ctx)) continue;
        const kind = typeof rule.kind === "function" ? rule.kind(m, depthBefore, ctx) : rule.kind;
        const ruleContainer = typeof rule.containerOf === "function" ? rule.containerOf(m) : undefined;
        // 关键字先行剔除：避免 `if (` / `while (` 触发跨行拼接并吞掉后续声明。
        // 但 `get()` / Swift `init()` / Kotlin `constructor()` 这类「直接位于容器体内、
        // 名字后紧跟 `(`」的成员必然是真成员（控制语句不会出现在类体直属层），
        // 因此豁免关键字过滤；非直属层（方法体/对象字面量里）仍然照旧丢弃。
        if ((kind === "function" || kind === "method" || kind === "constructor") && kws.has(name)) {
          const direct = directMember(ctx) !== null;
          const explicit = typeof ruleContainer === "string" && ruleContainer.length > 0;
          if (!(direct || explicit)) continue;
        }
        let bodyEnd = i;
        if (rule.endsWith !== null && rule.endsWith !== undefined) {
          const body = bodyAccepted(rule, clean, i, cleans, m, ctx);
          if (!body.ok) continue;
          bodyEnd = body.end;
        }
        matched = { rule, name, m, kind, ruleContainer };
        for (let k = i + 1; k <= bodyEnd; k++) consumed.add(k);
        break;
      }
      if (matched !== null) {
        const kind = matched.kind;
        const sym = { kind, name: matched.name, line: srcLines[i] + 1 };
        // 规则显式给出的归属（Kotlin receiver / Rust trait impl / C++ A::method）优先
        if (typeof matched.ruleContainer === "string" && matched.ruleContainer.length > 0) {
          sym.container = matched.ruleContainer;
        } else if ((kind === "method" || kind === "field" || kind === "constructor" || kind === "constant") && stack.length > 0) {
          // 方法 / 字段 / 常量归属容器（proto 的枚举值、类常量都要显示所属结构）
          sym.container = stack[stack.length - 1].name;
        }
        out.push(sym);
        if (matched.rule.container) {
          stack.push({ name: matched.name, depth: depthBefore, kind, fresh: true });
        }
      }
    }
    depth += countBraces(clean);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      // 容器声明行本身（尤其 Allman 风格）在本行还没吃到它的 `{`，别立刻弹掉
      if (top.fresh === true) { top.fresh = false; break; }
      if (top.depth >= depth) stack.pop();
      else break;
    }
  }
  return out;
}

/** Python 缩进：tab 视作 8 空格（只需能区分层级，不必换算成真实列）。 */
function pyIndentOf(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === " ") n++;
    else if (ch === "\t") n += 8;
    else break;
  }
  return n;
}

/** Python：缩进驱动（类 / 函数作用域都用栈保存，tab 缩进与嵌套类都能正确归属）。 */
function extractPython(tokens, lineCount) {
  const out = [];
  const scopes = []; // { type: "class"|"def", indent, name }
  const RE_CLASS = /^\s*class\s+([A-Za-z_]\w*)/;
  const RE_DEF = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/;
  // 赋值 / 带注解的赋值：`name =`、`name: Type =`（dataclass / Pydantic 的常见写法）
  const RE_VAR = /^\s*([A-Za-z_]\w*)\s*(?::\s*[^=]+?)?\s*=(?!=)/;
  // 只有注解没有初值的声明：`name: Type`（dataclass 必填字段 / 纯类型声明）。
  // 注解必须以非空白字符开头，避免把「被剥掉字符串后的 dict 值」当成字段。
  const RE_ANN = /^\s*([A-Za-z_]\w*)\s*:\s*\S[^=]*$/;
  /** 类体直属层 → field + container；模块级（缩进 0）→ variable；方法体内不进大纲。 */
  const emitBinding = (name, line, indent) => {
    const top = scopes.length > 0 ? scopes[scopes.length - 1] : null;
    if (top !== null && top.type === "class") {
      out.push({ kind: "field", name, line, container: top.name });
    } else if (top === null && indent === 0) {
      out.push({ kind: "variable", name, line });
    }
  };
  let bracket = 0; // 行首括号深度：区分「类体直属层」与 dict / 参数列表续行
  for (let i = 0; i < lineCount; i++) {
    const clean = cleanOf(tokens, i);
    if (clean.trim().length === 0) continue;
    const bracketBefore = bracket;
    bracket += bracketDelta(clean);
    const indent = pyIndentOf(clean);
    // 缩进回到声明所在层级：该类 / 函数（及其嵌套作用域）已经结束
    while (scopes.length > 0 && indent <= scopes[scopes.length - 1].indent) scopes.pop();
    const mC = RE_CLASS.exec(clean);
    if (mC !== null) {
      out.push({ kind: "class", name: mC[1], line: i + 1 });
      scopes.push({ type: "class", indent, name: mC[1] });
      continue;
    }
    const mD = RE_DEF.exec(clean);
    if (mD !== null) {
      // 只有「直接位于类体」的 def 才是方法；函数体里再 def 是嵌套函数
      const top = scopes.length > 0 ? scopes[scopes.length - 1] : null;
      const cls = top !== null && top.type === "class" ? top.name : null;
      out.push({
        kind: cls !== null ? "method" : "function",
        name: mD[1],
        line: i + 1,
        ...(cls !== null ? { container: cls } : {})
      });
      scopes.push({ type: "def", indent });
      continue;
    }
    // 裸赋值 / 带注解的赋值 / 纯注解声明：类体直属层的 `name = "x"`、`x: int`、
    // `x: int = 0` 都是类属性（field + container）；模块级（无作用域、缩进 0）是
    // 变量；方法体内的局部声明不进入大纲。
    const mV = RE_VAR.exec(clean);
    if (mV !== null) {
      emitBinding(mV[1], i + 1, indent);
      continue;
    }
    const mA = RE_ANN.exec(clean);
    if (mA !== null && bracketBefore === 0) emitBinding(mA[1], i + 1, indent);
  }
  return out;
}

/**
 * Ruby：`end` 界定作用域（花括号深度恒为 0，extractBrace 的栈在这里不适用）。
 * 用块栈记录 class/module/def 与其它块，def 的容器取最近的 class/module，
 * 因此 `attr_accessor` 之后的方法、类里第二个及以后的方法都能正确归属。
 */
function extractRuby(tokens, lineCount) {
  const out = [];
  const scopes = []; // { type: "class"|"def"|"other", name? }
  const RE_CLASS = /^(?:class|module)\s+([A-Za-z_:][\w:]*)/;
  const RE_CLASS_SELF = /^class\s*<</;
  const RE_DEF = /^def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/;
  const RE_ATTR = /^attr_(?:reader|writer|accessor)\s+:?([A-Za-z_]\w*)/;
  /** 行首开启新块的关键字（行尾修饰语 `x if y` / `x unless y` 不算）。 */
  const OPENS_BLOCK = /^(?:if|unless|while|until|for|case|begin)\b/;
  /** `each do |x|` / `begin do` 等行尾块（含 block 参数）。 */
  const DO_BLOCK = /\bdo\s*(?:\|[^|]*\|)?\s*$/;
  const ownerOf = () => {
    for (let k = scopes.length - 1; k >= 0; k--) {
      if (scopes[k].type === "class") return scopes[k].name;
    }
    return null;
  };
  for (let i = 0; i < lineCount; i++) {
    const line = cleanOf(tokens, i).trim();
    if (line.length === 0) continue;
    // Ruby 允许 `;` 分隔语句（`class Foo; def a; end; end`）：逐段当独立语句处理
    for (const piece of line.split(";")) {
      const text = piece.trim();
      if (text.length === 0) continue;
      if (/^end\b/.test(text)) {
        scopes.pop();
        continue;
      }
      const mCls = RE_CLASS.exec(text);
      if (mCls !== null) {
        out.push({ kind: "class", name: mCls[1], line: i + 1 });
        scopes.push({ type: "class", name: mCls[1] });
        continue;
      }
      if (RE_CLASS_SELF.test(text)) { scopes.push({ type: "other" }); continue; }
      const mDef = RE_DEF.exec(text);
      if (mDef !== null) {
        const owner = ownerOf();
        out.push({
          kind: "method",
          name: mDef[1],
          line: i + 1,
          ...(owner !== null ? { container: owner } : {})
        });
        scopes.push({ type: "def" });
        continue;
      }
      const mAttr = RE_ATTR.exec(text);
      if (mAttr !== null) {
        const owner = ownerOf();
        out.push({
          kind: "field",
          name: mAttr[1],
          line: i + 1,
          ...(owner !== null ? { container: owner } : {})
        });
        continue;
      }
      if (OPENS_BLOCK.test(text) || DO_BLOCK.test(text)) {
        // 单行块（`if x then y end` / `items.each do |x| ... end`）已经自带 end，
        // 不再压栈，否则块栈整体错位、后面的类归属会被带偏。
        if (!/\bend\b/.test(text)) scopes.push({ type: "other" });
      }
    }
  }
  return out;
}

/** Go：func / type / var / const（含泛型与 `type (` / `const (` / `var (` 分组）。 */
function extractGo(tokens, lineCount) {
  const out = [];
  const RE_TYPE = /^\s*type\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s+(struct|interface)\b/;
  // `type Alias = User`：类型别名（含泛型 `type Alias[T any] = User[T]`）
  const RE_TYPE_ALIAS = /^\s*type\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=/;
  const RE_FUNC = /^\s*func\s+(?:\(([^)]*)\)\s+)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/;
  const RE_VAR = /^\s*(?:var|const)\s+([A-Za-z_]\w*)/;
  const RE_GROUP = /^\s*(type|const|var)\s*\(\s*$/;
  const RE_GROUP_TYPE = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s+(struct|interface)\b/;
  const RE_GROUP_TYPE_ALIAS = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=/;
  // 分组内「省略值」的成员也算符号：`B`（const 组，值同上一行）与 `Y string`
  // （var 组，省略初值）——所以终结符是 `=` 或行尾，而不是必须 `=`。
  const RE_GROUP_VALUE = /^\s*([A-Za-z_]\w*)(?:\s+[\w.\[\]*<>]+)?\s*(?:=|$)/;
  /** `*List[T]` / `List[T]` → `List`（方法容器用基础类型名）。 */
  const recvType = (recv) => recv.replace(/\*/g, "").replace(/\[[^\]]*\]/g, "").trim().split(/\s+/).pop();
  let group = null; // 'type' | 'const' | 'var'
  for (let i = 0; i < lineCount; i++) {
    const clean = cleanOf(tokens, i);
    if (clean.trim().length === 0) continue;
    if (group !== null) {
      if (/^\s*\)/.test(clean)) { group = null; continue; }
      const mGT = RE_GROUP_TYPE.exec(clean);
      if (group === "type" && mGT !== null) {
        out.push({ kind: mGT[2] === "struct" ? "struct" : "interface", name: mGT[1], line: i + 1 });
        continue;
      }
      if (group === "type") {
        const mGA = RE_GROUP_TYPE_ALIAS.exec(clean);
        if (mGA !== null) {
          out.push({ kind: "class", name: mGA[1], line: i + 1 });
          continue;
        }
      }
      const mGV = RE_GROUP_VALUE.exec(clean);
      if (mGV !== null && group !== "type") {
        out.push({ kind: group === "const" ? "constant" : "variable", name: mGV[1], line: i + 1 });
      }
      continue;
    }
    const mG = RE_GROUP.exec(clean);
    if (mG !== null) {
      group = mG[1];
      continue;
    }
    const mT = RE_TYPE.exec(clean);
    if (mT !== null) {
      out.push({ kind: mT[2] === "struct" ? "struct" : "interface", name: mT[1], line: i + 1 });
      continue;
    }
    const mA = RE_TYPE_ALIAS.exec(clean);
    if (mA !== null) {
      out.push({ kind: "class", name: mA[1], line: i + 1 });
      continue;
    }
    const mF = RE_FUNC.exec(clean);
    if (mF !== null) {
      if (mF[1] !== undefined) {
        out.push({ kind: "method", name: mF[2], line: i + 1, container: recvType(mF[1]) });
      } else {
        out.push({ kind: "function", name: mF[2], line: i + 1 });
      }
      continue;
    }
    const mV = RE_VAR.exec(clean);
    if (mV !== null) out.push({ kind: mV[0].trim().startsWith("const") ? "constant" : "variable", name: mV[1], line: i + 1 });
  }
  return out;
}

/** Lua：function / local。 */
function extractLua(tokens, lineCount) {
  const out = [];
  const RE_FN = /^\s*(?:local\s+)?function\s+([A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)/;
  const RE_LOCAL = /^\s*local\s+([A-Za-z_]\w*)\s*=/;
  for (let i = 0; i < lineCount; i++) {
    const clean = cleanOf(tokens, i);
    if (clean.trim().length === 0) continue;
    const mF = RE_FN.exec(clean);
    if (mF !== null) {
      const full = mF[1];
      const lastDot = Math.max(full.lastIndexOf("."), full.lastIndexOf(":"));
      const name = lastDot >= 0 ? full.slice(lastDot + 1) : full;
      out.push({ kind: lastDot >= 0 && full[lastDot] === ":" ? "method" : "function", name, line: i + 1, container: lastDot >= 0 ? full.slice(0, lastDot) : undefined });
      continue;
    }
    const mV = RE_LOCAL.exec(clean);
    if (mV !== null) out.push({ kind: "variable", name: mV[1], line: i + 1 });
  }
  return out;
}

/** Shell：name() / name=。 */
function extractShell(tokens, lineCount) {
  const out = [];
  const RE_FN = /^\s*(?:function\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*\(\s*\))/;
  const RE_VAR = /^\s*([A-Za-z_]\w*)\s*=/;
  for (let i = 0; i < lineCount; i++) {
    const clean = cleanOf(tokens, i);
    if (clean.trim().length === 0) continue;
    const mF = RE_FN.exec(clean);
    if (mF !== null && (mF[1] !== undefined || mF[2] !== undefined)) {
      out.push({ kind: "function", name: mF[1] ?? mF[2], line: i + 1 });
      continue;
    }
    const mV = RE_VAR.exec(clean);
    if (mV !== null && !/^(if|then|else|fi|for|while|do|done|case|esac|function)$/.test(mV[1])) {
      out.push({ kind: "variable", name: mV[1], line: i + 1 });
    }
  }
  return out;
}

/** SQL：主要结构对象（表/视图/索引/函数）。 */
function extractSql(tokens, lineCount) {
  const out = [];
  // 修饰词（UNIQUE / OR REPLACE / TEMP / MATERIALIZED …）顺序任意且可叠加，
  // IF [NOT] EXISTS 跟在对象关键字之后，对象名可带任意层 schema 前缀。
  const RE = /^\s*(?:create|drop|alter)\s+(?:(?:unique|or\s+replace|temp(?:orary)?|materialized|external|unlogged|global|local|recursive)\s+)*(table|view|index|function|procedure|trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:[\w".`[\]]+\.)*([\w"`[\]]+)/i;
  for (let i = 0; i < lineCount; i++) {
    const clean = codeOf(tokens, i);
    if (clean.trim().length === 0) continue;
    const m = RE.exec(clean);
    if (m !== null) {
      const kindMap = { table: "class", view: "interface", index: "class", function: "function", procedure: "function", trigger: "method" };
      out.push({ kind: kindMap[m[1].toLowerCase()] ?? "class", name: m[2].replace(/["`[\]]/g, ""), line: i + 1 });
    }
  }
  return out;
}

/** `<script` 开始标签判定（`<scriptx` 不算）。 */
function isScriptTagAt(text, i) {
  if (text.slice(i, i + 7).toLowerCase() !== "<script") return false;
  const next = text[i + 7];
  return next === ">" || next === "/" || next === undefined || /\s/.test(next);
}

/**
 * 正则字面量只能出现在表达式位置：这些关键字之后可以，`a / b` 的 `a` 之后不行。
 * 与 tokenize.js 的 `JS_REGEX_KEYWORDS` 同一清单（两边内联进同一 bundle，但各自
 * 自包含 —— 顶层重名会被 scripts/build.mjs 判为构建错误）。
 */
const SFC_REGEX_KEYWORDS = new Set(
  "return case throw typeof instanceof in of new delete void yield await".split(" ")
);

/** JS 标识符字符（用于维护「上一个有效词」）。 */
function sfcWordChar(ch) {
  return ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

/**
 * 前一个有效字符 / 关键字是否处于「可以跟正则字面量」的表达式位置。
 * 字符集与 tokenize.js 的 `jsRegexAllowedAfter` 完全一致：
 * `= ( : , [ { ! & | ? + - * % ^ ~ < > ;`（含 `{`，`if (x) {/re/.test(y)}` 可起正则）。
 * 行首（prevChar === ""）视为表达式位置。
 */
function sfcRegexAllowedAfter(prevChar, prevWord) {
  if (prevChar === "") return true;
  if ("=(:,[{!&|?+-*%^~<>;".includes(prevChar)) return true;
  return prevWord !== "" && SFC_REGEX_KEYWORDS.has(prevWord);
}

/**
 * 从脚本正文里找真正的 `</script>`。与 tokenize.js 的 `sfcFindScriptClose`
 * **同一算法**（两边内联进同一 bundle，但各自自包含；顶层重名会被 build 判错，
 * 故 outline 侧用 `SFC_` / `sfc*` 前缀名）：
 *
 *   状态：none / 引号字符串（`'` `"` `` ` ``）/ 行注释 / 块注释 / 正则字面量。
 *   **只有 state === none 时遇到的 `</script` 才是收尾标签** —— 字符串、
 *   模板字符串、行 / 块注释、正则字面量（`/["']/`、`/it's/`）里的 `</script`
 *   都不算。
 *
 *   正则起始用经典 prior-token 启发式（见 sfcRegexAllowedAfter）：行首 /
 *   前一个有效字符是 `= ( [ { , ; : ! & | ? + - * % < > ~ ^` 之一 /
 *   前一个完整单词是 return / typeof / case / throw / … → 可起正则；
 *   前一个有效 token 是标识符 / 数字 / 字符串 / 右括号 → `/` 是除法。
 *   注释透明（不刷新 prior token）；换行复位 prior token；正则不能跨行
 *   （行内找不到闭合 `/` 就按除法处理，绝不吞掉后面的行）。
 *
 * 扫描不到收尾标签时返回 null，调用方保持旧行为（`bodyEnd = n`）。**不会**回退
 * 成盲目 `indexOf("</script")` —— 那会把字符串 / 正则里的同名文本当收尾标签。
 * @returns {{index:number, end:number}|null}
 */
function findScriptClose(text, from) {
  let i = from;
  const n = text.length;
  let prevChar = "";
  let prevWord = "";
  const noteChar = (ch) => {
    if (ch === " " || ch === "\t" || ch === "\r") return;
    prevChar = ch;
    if (sfcWordChar(ch)) prevWord = (prevWord + ch).slice(-16);
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
      prevChar = quote; // 字符串是值：后面的 `/` 是除法
      prevWord = "";
      continue;
    }
    // 正则字面量：行内扫描 `[...]` 字符类与转义；不闭合就按除法继续
    if (ch === "/" && sfcRegexAllowedAfter(prevChar, prevWord)) {
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
 * Vue/Svelte：抽取 `<script>` 块交给 JS/TS 规则，行号按各块的起始偏移回加。
 * 开标签的 `>` 跳过引号内的字符（`<script data-x="a>b">` 不提前结束）；
 * 自闭合 `<script src="./x.ts" />` 不产生正文块（否则剩余文件会被当脚本）。
 */
function extractScriptBlocks(text) {
  const blocks = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    // HTML 注释里的 <script> 不是真的脚本块
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (isScriptTagAt(text, i)) {
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
      // 自闭合 / 无正文的 script：不找收尾标签，否则整个剩余文件都会被当脚本正文
      if (text[p - 1] === "/") {
        i = p + 1;
        continue;
      }
      const attrs = text.slice(i + 7, p);
      const bodyStart = p + 1;
      const close = findScriptClose(text, bodyStart);
      const body = text.slice(bodyStart, close === null ? n : close.index);
      // 与 tokenize.js 的 sfcScriptRanges 同口径：引号可省、大小写不敏感
      const isTs = /lang\s*=\s*(?:"(?:ts|typescript)"|'(?:ts|typescript)'|(?:ts|typescript)(?=[\s/>]|$))/i.test(attrs);
      // 偏移取「内容起点之前的换行数」，于是「块内 1 基行号 + 偏移」恰好等于文件行号。
      const offset = (text.slice(0, bodyStart).match(/\n/g) || []).length;
      blocks.push({ code: body, offset, subLang: isTs ? "typescript" : "javascript" });
      i = close === null ? n : close.end;
      continue;
    }
    i++;
  }
  return blocks;
}

/** 符号数量上限（挡住巨型文件的大纲开销，也用于界面提示「仅前 N 个」）。 */
export const OUTLINE_MAX_SYMBOLS = 500;

/** 在不改变数组内容 / deepEqual 结果的前提下标记确实被截断。 */
function markOutlineCapped(items) {
  if (items.capped !== true) Object.defineProperty(items, "capped", { value: true, enumerable: false });
  return items;
}

/** 裁到符号上限；调用方据此判断列表是否被截断。 */
function capSymbols(symbols) {
  return symbols.length > OUTLINE_MAX_SYMBOLS
    ? markOutlineCapped(symbols.slice(0, OUTLINE_MAX_SYMBOLS))
    : symbols;
}

/** 映射行号时保留子列表是否已经触及截断。 */
function remapLines(symbols, offset) {
  const mapped = symbols.map((s) => ({ ...s, line: s.line + offset }));
  return symbols.capped === true ? markOutlineCapped(mapped) : mapped;
}

/** 主入口：文本 + 语言 id → 符号列表（失败返回 []）。 */
export function outlineOf(text, lang) {
  if (typeof text !== "string" || text.length === 0) return [];
  try {
    if (lang === "vue" || lang === "svelte") {
      const blocks = extractScriptBlocks(text);
      if (blocks.length === 0) return [];
      if (blocks.length === 1) {
        const { code, offset, subLang } = blocks[0];
        return remapLines(outlineOf(code, subLang), offset);
      }
      // 多块：各块内部已按语言规则解析，合并后按行号排回文档顺序
      const merged = [];
      let capped = false;
      for (const b of blocks) {
        const blockSymbols = outlineOf(b.code, b.subLang);
        if (blockSymbols.capped === true) capped = true;
        for (const s of blockSymbols) merged.push({ ...s, line: s.line + b.offset });
      }
      merged.sort((a, b) => a.line - b.line);
      const result = capSymbols(merged);
      return capped ? markOutlineCapped(result) : result;
    }
    const tokens = tokenizeLines(text, lang);
    if (tokens === null) return [];
    return outlineOfTokens(tokens, lang);
  } catch {
    return [];
  }
}

/**
 * 已分词入口：复用调用方的 tokens，避免大纲再做一次整文件分词。
 * Vue/Svelte 的 tokens 没有 script 块边界信息，回退为 join 文本再走 outlineOf。
 */
export function outlineOfTokens(tokens, lang) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  try {
    if (lang === "vue" || lang === "svelte") {
      return outlineOf(tokens.map((t) => t.raw).join("\n"), lang);
    }
    const lineCount = tokens.length;
    const kws = KWS_OF(lang);
    let out;
    if (CONFIG_LANGS.has(lang)) {
      // 用 tokenize 之后的文本（可能已按防御性上限截断），保证 JSON 扫描器与
      // 其余提取器、以及渲染出的行号三者看到的是同一份内容
      out = outlineOfConfig(tokens.map((t) => t.raw).join("\n"), lang, tokens, lineCount);
    } else if (lang === "python") {
      out = extractPython(tokens, lineCount);
    } else if (lang === "ruby") {
      out = extractRuby(tokens, lineCount);
    } else if (lang === "go") {
      out = extractGo(tokens, lineCount);
    } else if (lang === "lua") {
      out = extractLua(tokens, lineCount);
    } else if (lang === "shell") {
      out = extractShell(tokens, lineCount);
    } else if (lang === "sql") {
      out = extractSql(tokens, lineCount);
    } else {
      // C 家族括号规则（按语言细分）
      const MODS = "(?:(?:public|private|protected|internal|static|abstract|virtual|override|async|readonly|final|sealed|synchronized|native|const|volatile|transient|open|data|lateinit|external|suspend|inline|tailrec|operator|infix|mutating|nonmutating|fileprivate|set|get|\\*)\\s+)*";
      const JS_DECL = /^\s*(?:export\s+|default\s+|declare\s+)*/;
      // C++ 同行模板声明 `template <typename T> class Box {`：模板头里允许至多
      // 三层嵌套的 `<...>`（`std::map<int, std::map<int, std::vector<int>>>` 这类
      // 实参已经够用）；换行写法本来就走「模板行不命中、下一行 class 命中」。
      // 只对 cpp 启用（其他语言出现 `template` 不会被误伤）。
      const ANGLE_L1 = "[^<>]*(?:<[^<>]*>[^<>]*)*";
      const ANGLE_L2 = "[^<>]*(?:<" + ANGLE_L1 + ">[^<>]*)*";
      const ANGLE_L3 = "[^<>]*(?:<" + ANGLE_L2 + ">[^<>]*)*";
      const TEMPLATE_HEAD = "(?:template\\s*<" + ANGLE_L3 + ">\\s*)?";
      const CLASS_RE = new RegExp(JS_DECL.source + (lang === "cpp" ? TEMPLATE_HEAD : "") + MODS + "(class|interface|enum|struct|record|trait)\\s+([A-Za-z_$][\\w$]*)(?:\\s*<[^>]*>)?(?:\\s+extends\\s+[\\w$.<>]+)?(?:\\s+implements\\s+[\\w$.,\\s<>]+)?\\s*\\{?");
      const kindOfClass = (k) => k === "interface" ? "interface" : k === "enum" ? "enum" : k === "struct" ? "struct" : k === "trait" ? "interface" : "class";
      const jsLike = lang === "javascript" || lang === "typescript" || lang === "jsx" || lang === "tsx";
      const rules = [
        { re: CLASS_RE, kind: (m) => kindOfClass(m[1]), nameGroup: 2, depth: "any", container: true, endsWith: null }
      ];
      // 方法：修饰符 + 可选返回类型 + 名称 + (；需要函数体（判定见 bodyAccepted）。
      // 名字与 `(` 之间的泛型参数表已由 stripMemberGenerics 在进入规则前抹掉。
      const TILDE = lang === "cpp" ? "~?" : "";
      const METHOD_RE = new RegExp("^\\s*" + MODS + "(?:[\\w<>\\[\\],\\s&*]+\\s+)?(" + TILDE + "[A-Za-z_$][\\w$]*)\\s*\\(");
      // 非 null 即表示该规则需要函数体；null 表示无需函数体（如 class / 字段 / 配置规则）
      const needsBody = true;
      const kindOfMethod = (m) => (m[1] === "constructor" ? "constructor" : "method");
      if (jsLike) {
        // 函数声明规则排到通用方法规则之前：`function inner()` 在方法体里
        // 是嵌套函数（function），不是外层类的方法。
        rules.push({
          re: /^\s*(?:export\s+|default\s+)*(?:async\s+)*function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
          kind: "function", nameGroup: 1, depth: "any", container: false, endsWith: needsBody
        });
      }
      if (lang === "rust") {
        // Rust 的 `pub fn` 也要排在 METHOD_RE 之前：否则 `mod util { pub fn helper() }`
        // 里的 helper 会先被通用方法规则吃掉（变成 method）；这里按容器种类判定。
        rules.push({
          re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
          kind: (m, d, ctx) => directMember(ctx, MEMBER_CONTAINER_KINDS) !== null ? "method" : "function",
          nameGroup: 1, depth: "any", container: false, endsWith: null
        });
      }
      if (jsLike) {
        // TS/JS `semi: false`：接口方法签名可以只靠换行结束（没有 `;`）。
        // 放在通用方法规则之前，只接管「接口体直属层 + 物理行末尾 + 无 `;`」的
        // 签名（判定见 acceptBodyless）；带 `;` / 函数体的行继续走通用规则。
        rules.push({
          re: METHOD_RE, kind: kindOfMethod, nameGroup: 1, depth: "gt0", container: false,
          endsWith: needsBody, bodyless: "tsInterfaceMember"
        });
      }
      rules.push({
        re: METHOD_RE, kind: kindOfMethod, nameGroup: 1, depth: "gt0", container: false,
        endsWith: needsBody, bodyless: "member"
      });
      if (jsLike) {
        // 泛型箭头：`.ts` 允许 `<T>` / `<T,>`；`.tsx` 只认尾逗号的 `<T,>`（避开 JSX）
        const ARROW_GENERIC = lang === "tsx"
          ? "(?:<[^<>()]*,\\s*>\\s*)?"
          : lang === "typescript" ? "(?:<[^<>()]*>\\s*)?" : "";
        rules.push({
          // 单行箭头函数（含 IIFE）：`=>` 必须与参数在同一行
          re: new RegExp("^\\s*(?:export\\s+)*const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?" + ARROW_GENERIC + "(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>"),
          kind: "function", nameGroup: 1, depth: "any", container: false, endsWith: null
        });
        rules.push({
          // 多行参数：`(` 之后可能换行，函数体由 bodyAccepted 沿括号配平判定
          re: new RegExp("^\\s*(?:export\\s+)*const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?" + ARROW_GENERIC + "(?:\\(|[A-Za-z_$][\\w$]*\\s*=>)"),
          kind: "function", nameGroup: 1, depth: "any", container: false, endsWith: needsBody
        });
        rules.push({
          re: /^\s*(?:export\s+)*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
          kind: "function", nameGroup: 1, depth: "any", container: false, endsWith: null
        });
        // TS `semi: false`：只有类型注解、没有初值 / 分号的类属性（`foo: string`、
        // `bar?: number`）。只接「类 / 接口体直属层 + 物理行末尾 + 行内没有 `=`」，
        // 带 `=` / `;` 的行仍由下面的规则处理，行为不变。
        rules.push({
          re: /^\s*(?:(?:public|private|protected|readonly|static|declare|override|abstract|accessor)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*[^=;{}]+$/,
          kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null,
          when: ({ depthBefore, stack, clean, endsLine }) => {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            return endsLine === true && top !== null && depthBefore === top.depth + 1 &&
              CLASS_BODY_KINDS.has(top.kind) && !STATEMENT_LEAD.test(clean);
          }
        });
        // TS/JS 类属性 / 箭头字段：只在类（或接口）体直属层匹配，
        // 因此方法体里的局部赋值不会变成字段，方法本身（name(）也不会被抢走。
        rules.push({
          re: /^\s*(?:(?:public|private|protected|readonly|static|declare|override|abstract|accessor)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(?::\s*[^=;{]+?)?\s*(?:=[^=]|;)/,
          kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null,
          when: ({ depthBefore, stack, clean }) => {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            return top !== null && depthBefore === top.depth + 1 &&
              (top.kind === "class" || top.kind === "interface") &&
              !STATEMENT_LEAD.test(clean);
          }
        });
        // 局部 `const/let/var`：只有在类/接口体直属层才是字段，否则是变量
        // （方法体里的 `const url = …` 不能再变成外层类的 field）。
        rules.push({
          re: /^\s*(?:export\s+)*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:[,=]|\s*$)/,
          kind: (m, d, ctx) => directMember(ctx, CLASS_BODY_KINDS) !== null ? "field" : "variable",
          nameGroup: 1, depth: "any", container: false, endsWith: null
        });
      } else if (lang === "java" || lang === "csharp" || lang === "c" || lang === "cpp") {
        if (lang === "c" || lang === "cpp") {
          // C 的 `typedef struct Named { … }` / `typedef enum Named { … }`。
          // 匿名形式（`typedef struct { … } Alias;`）的名字已由 resolveTypedefNames
          // 在扫描前补到开行上，这里只看「typedef struct|enum|union Name」的形态；
          // 收尾的 `} Alias;` 不是声明形状，不会再产生第二个符号。
          rules.unshift({
            re: /^\s*typedef\s+(struct|enum|union)\s+([A-Za-z_]\w*)\s*\{?/,
            kind: (m) => (m[1] === "enum" ? "enum" : "struct"),
            nameGroup: 2, depth: "any", container: true, endsWith: null
          });
        }
        if (lang === "csharp") {
          // C# 自动属性 `public int X { get; set; }` / 表达式属性 `public int Y => 1;`。
          // 行内大括号会被切成分段，故 `{\s*$` 也算属性体开始。
          rules.push({
            re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|required|new|readonly)\s+)*(?:[\w<>\[\],.?]+\s+)?([A-Za-z_]\w*)\s*(?:\{\s*(?:get|set|init)\b|=>|\{\s*$)/,
            kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null,
            when: ({ depthBefore, stack }) => {
              const top = stack.length > 0 ? stack[stack.length - 1] : null;
              return top !== null && depthBefore === top.depth + 1;
            }
          });
        }
        if (lang === "cpp") {
          // C++ 类外定义：`void A::draw() {}`、`int Ns::A::area() {}`。
          // 名字取最后一段；container 取 `::` 前的最后一段类型（如 Ns::A::draw → A）。
          rules.push({
            re: /^\s*(?:[\w<>\[\],&*:\s]+?\s+)?((?:[A-Za-z_]\w*::)+)([A-Za-z_]\w*)\s*\(/,
            kind: "method", nameGroup: 2, depth: "any", container: false, endsWith: needsBody,
            containerOf: (m) => m[1].replace(/::$/, "").split("::").filter(Boolean).pop()
          });
        }
        // 文件级函数（C 家族，类外）；`;` 结尾的原型声明也算（头文件常用）
        rules.push({
          re: /^\s*[A-Za-z_][\w:<>*&[\],\s]*?\s+([A-Za-z_][\w]*)\s*\(/,
          kind: "function", nameGroup: 1, depth: "any", container: false, endsWith: needsBody, bodyless: "prototype"
        });
        // 字段：必须直接位于类体（深度恰好比容器深 1），方法体里的局部变量
        // 和 `return x;` 不能变成字段。
        rules.push({
          re: /^\s*[A-Za-z_][\w:<>*&[\],\s]*?\s+([A-Za-z_][\w]*)\s*(?:=(?![=>])|;)/,
          kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null,
          when: ({ depthBefore, stack, clean }) => {
            const top = stack[stack.length - 1];
            return stack.length > 0 && depthBefore === top.depth + 1 && !STATEMENT_LEAD.test(clean);
          }
        });
        // 常量 / 宏
        if (lang === "c" || lang === "cpp") {
          rules.push({
            re: /^\s*#\s*define\s+([A-Za-z_][\w]*)/,
            kind: "constant", nameGroup: 1, depth: "any", container: false, endsWith: null
          });
        }
      } else if (lang === "php") {
        rules.push({
          re: /^\s*(?:public|private|protected|static|abstract|final|async)?\s*function\s+([A-Za-z_]\w*)/,
          kind: (m, d) => d > 0 ? "method" : "function", nameGroup: 1, depth: "any", container: false, endsWith: needsBody
        });
        rules.push({ re: /^\s*const\s+([A-Za-z_]\w*)/, kind: "constant", nameGroup: 1, depth: "any", container: false, endsWith: null });
        // 可见性属性：`private $name;` / `public int $age = 0;` / `var $x;`
        rules.push({
          re: /^\s*(?:(?:public|private|protected|static|readonly|var)\s+)+(?:[A-Za-z_\\?][\w\\|?<>\[\], ]*\s+)?\$([A-Za-z_]\w*)/,
          kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null,
          when: ({ depthBefore, stack }) => {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            return top !== null && depthBefore === top.depth + 1;
          }
        });
        rules.push({ re: /^\s*\$([A-Za-z_]\w*)\s*=\s*(?:\[|array\s*\()/, kind: "variable", nameGroup: 1, depth: "any", container: false, endsWith: null });
      } else if (lang === "swift") {
        rules.push({ re: /^\s*(?:public|private|internal|fileprivate|open|final|actor)?\s*(class|struct|enum|protocol|extension)\s+([A-Za-z_]\w*)/, kind: (m) => m[1] === "class" ? "class" : m[1] === "struct" ? "struct" : m[1] === "enum" ? "enum" : m[1] === "protocol" ? "interface" : "class", nameGroup: 2, depth: "any", container: true, endsWith: null });
        rules.push({ re: /^\s*(?:public|private|internal|fileprivate|static|class|mutating|nonmutating|async|open)?\s*func\s+([A-Za-z_]\w*)/, kind: (m, d) => d > 0 ? "method" : "function", nameGroup: 1, depth: "any", container: false, endsWith: needsBody, bodyless: "swiftMember" });
        // `init(...)` / `subscript(...)` 是 Swift 关键字，但不是语句：直接位于容器体
        // 内时由通用 METHOD_RE 命中（关键字过滤已按「容器直属层」豁免）。
        rules.push({ re: /^\s*(?:public|private|internal|fileprivate|static|open)?\s*(?:var|let)\s+([A-Za-z_]\w*)/, kind: (m, d, ctx) => directMember(ctx, MEMBER_CONTAINER_KINDS) !== null ? "field" : "variable", nameGroup: 1, depth: "any", container: false, endsWith: null });
      } else if (lang === "kotlin") {
        // Kotlin 的枚举只有 `enum class X` 一种写法（`enum` 是修饰词）。通用
        // CLASS_RE 会把 `enum class Color` 读成关键字 enum + 名字 class，且它排在
        // 规则最前、Kotlin 分支永远轮不到；这里把定向规则插到 rules[0]。
        const KT_MODS = "(?:(?:public|private|protected|internal|data|sealed|abstract|open|final|annotation|value|expect|actual|override|suspend|inline|tailrec|operator|infix|external)\\s+)*";
        rules.unshift({
          re: new RegExp("^\\s*" + KT_MODS + "enum\\s+class\\s+([A-Za-z_]\\w*)"),
          kind: "enum", nameGroup: 1, depth: "any", container: true, endsWith: null
        });
        rules.push({ re: /^\s*(?:public|private|internal|protected|data|sealed|enum|abstract|open|final|annotation|value|expect|actual)?\s*(?:enum\s+)?(?:class|interface|object)\s+([A-Za-z_]\w*)/, kind: (m) => m[0].includes("interface") ? "interface" : "class", nameGroup: 1, depth: "any", container: true, endsWith: null });
        // 扩展函数：`fun String.pad()` → 方法 pad，container String
        rules.push({ re: /^\s*(?:public|private|internal|protected|suspend|inline|tailrec|operator|infix|override|abstract|open|final|external)?\s*(?:<[^>]*>\s*)?fun\s+(?:<[^>]*>\s*)?(?:([A-Za-z_][\w.]*(?:<[^>]*>)?)\.)?([A-Za-z_]\w*)/, kind: (m, d) => d > 0 ? "method" : "function", nameGroup: 2, depth: "any", container: false, endsWith: null, containerOf: (m) => m[1] });
        // 次构造器 `constructor(...)` 是 Kotlin 关键字，通用 METHOD_RE 会命中原名
        // （kind 输出 constructor），关键字过滤按「容器直属层」豁免。
        rules.push({ re: /^\s*(?:public|private|internal|protected|const|lateinit)?\s*(?:val|var)\s+([A-Za-z_]\w*)/, kind: (m, d, ctx) => directMember(ctx, MEMBER_CONTAINER_KINDS) !== null ? "field" : "variable", nameGroup: 1, depth: "any", container: false, endsWith: null });
      } else if (lang === "rust") {
        rules.push({ re: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, kind: (m) => m[0].includes("struct") ? "struct" : m[0].includes("enum") ? "enum" : "interface", nameGroup: 1, depth: "any", container: true, endsWith: null });
        // impl 允许 `impl<T> Wrapper<T>`（泛型可无空格）与 `impl Trait for Type`；
        // 符号名用被实现的类型，trait 名放 container。
        rules.push({ re: /^\s*(?:pub\s+)?impl\s*(?:<[^>]*>\s*)?(?:([A-Za-z_]\w*(?:::\w+)*)\s*(?:<[^>]*>)?\s+for\s+)?([A-Za-z_]\w*(?:::\w+)*)/, kind: "impl", nameGroup: 2, depth: "any", container: true, endsWith: null, containerOf: (m) => m[1] });
        // `fn` 规则已排在 METHOD_RE 之前（见上），这里只留常量 / 静态量。
        rules.push({ re: /^\s*(?:pub\s+)?(?:const|static)\s+([A-Za-z_]\w*)/, kind: "constant", nameGroup: 1, depth: "any", container: false, endsWith: null });
      } else if (lang === "protobuf") {
        // Protocol Buffers：结构头 / rpc / group / 字段 / 枚举值。
        // 字段是「类型 名 = 号」两个标识符、枚举值是「名 = 号」一个，字段规则在前即可分开两者；
        // syntax / package / import / option / reserved / extensions 行凑不出这个形状
        // （字符串与注释已被 cleanOf 剥掉），故不会误报成符号。
        // 类型与被 extend 的目标允许前导点：`.foo.Bar` 是官方的全限定引用写法。
        rules.push({
          re: /^\s*(message|enum|oneof|service|extend)\s+\.?([A-Za-z_][\w.]*)/,
          kind: (m) => m[1] === "enum" ? "enum" : m[1] === "oneof" ? "section" : m[1] === "extend" ? "impl" : "class",
          nameGroup: 2, depth: "any", container: true, endsWith: null
        });
        rules.push({ re: /^\s*rpc\s+([A-Za-z_]\w*)\s*\(/, kind: "method", nameGroup: 1, depth: "gt0", container: false, endsWith: null });
        // proto2 group：符号按字段展示，但组体是独立作用域，组内字段要挂到组名上
        rules.push({
          re: /^\s*(?:(?:repeated|optional|required)\s+)?group\s+([A-Za-z_]\w*)\s*=/,
          kind: "field", nameGroup: 1, depth: "gt0", container: true, endsWith: null
        });
        rules.push({
          re: /^\s*(?:(?:repeated|optional|required)\s+)?(?:map\s*<[^>]*>|\.?[A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*-?\d+/,
          kind: "field", nameGroup: 1, depth: "gt0", container: false, endsWith: null
        });
        rules.push({ re: /^\s*([A-Za-z_]\w*)\s*=\s*-?\d+/, kind: "constant", nameGroup: 1, depth: "gt0", container: false, endsWith: null });
      } else {
        // 兜底：走通用 JS 规则
        rules.push({ re: METHOD_RE, kind: kindOfMethod, nameGroup: 1, depth: "gt0", container: false, endsWith: needsBody, bodyless: "member" });
        rules.push({
          re: /^\s*(?:export\s+)*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:[,=]|\s*$)/,
          kind: (m, d, ctx) => directMember(ctx, CLASS_BODY_KINDS) !== null ? "field" : "variable",
          nameGroup: 1, depth: "any", container: false, endsWith: null
        });
      }
      out = extractBrace(lang, tokens, rules, lineCount);
    }
    // 关键词误报过滤：`if (` / `while (` 等语句关键字不能成为符号；
    // 但 `class A { get() {} }` / Swift `init()` / Kotlin `constructor()` 这类
    // 「容器成员」要保留——有 container 说明它来自容器体直属层的成员规则。
    const final = [];
    for (const s of out) {
      if (s.kind === "function" || s.kind === "method" || s.kind === "constructor") {
        if (kws.has(s.name) && s.container === undefined) continue;
      }
      final.push(s);
    }
    return capSymbols(final);
  } catch {
    return [];
  }
}
