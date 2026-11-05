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
	id: "@whybebabo/dsh-code-nav",
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
		const __cn = (() => {
	"use strict";
	//#region module: lang-registry
	/**
	 * dsh-code-nav — 语言注册表（纯函数，浏览器/node 通用）。
	 *
	 * 共享作用域约定：本文件与 tokenize.js / outline.js / search.js 由
	 * scripts/build.mjs 按依赖顺序拼接内联进 lib/client.js（去掉 export 前缀），
	 * 故模块间直接引用彼此声明，不写 import 语句。
	 */

	/** 扩展名（小写、无点）→ 语言 id。 */
	const LANG_EXT = {
	  // JavaScript / TypeScript 家族
	  js: "javascript", mjs: "javascript", cjs: "javascript",
	  ts: "typescript", jsx: "jsx", tsx: "tsx",
	  // 脚本
	  py: "python",
	  // JVM / .NET
	  java: "java", cs: "csharp",
	  // C 家族
	  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
	  // 系统 / 服务端
	  go: "go", rs: "rust", php: "php", rb: "ruby",
	  // Apple / Android
	  swift: "swift", kt: "kotlin", kts: "kotlin",
	  // 脚本 / 模板
	  lua: "lua", sh: "shell", bash: "shell", zsh: "shell",
	  vue: "vue", svelte: "svelte",
	  // 数据
	  sql: "sql",
	  // IDL：Protocol Buffers 的 schema
	  proto: "protobuf",
	  // 配置：JSON 家族（jsonc 注释、json5 单引号 / 裸键由 json 元数据容忍）
	  json: "json", jsonc: "json", json5: "json", jsonl: "json", ndjson: "json",
	  geojson: "json", webmanifest: "json", har: "json",
	  // 配置：YAML / TOML
	  yaml: "yaml", yml: "yaml", toml: "toml",
	  // 配置：XML 家族。HTML / SVG 有意不收 —— 前者归内置 HTML 预览、后者归图片预览，
	  // 本预览器 priority 高于它们，收了会把「渲染预览」降级成源码视图。
	  xml: "xml", xsd: "xml", xsl: "xml", xslt: "xml", plist: "xml",
	  csproj: "xml", vbproj: "xml", fsproj: "xml", props: "xml", targets: "xml",
	  resx: "xml", nuspec: "xml", wsdl: "xml", xaml: "xml",
	  // 配置：INI 家族。点文件（.env / .editorconfig / .gitconfig / .npmrc）取「点后
	  // 即扩展名」，故 langOf 允许分隔点就是首个字符。
	  ini: "ini", cfg: "ini", conf: "ini", service: "ini", desktop: "ini",
	  editorconfig: "ini", gitconfig: "ini", npmrc: "ini",
	  // 配置：Java properties（`!` 也是注释）与 dotenv（`#` 才是，`;` 是合法值）
	  properties: "properties", env: "dotenv"
	};

	/**
	 * 根据文件路径（或纯文件名）推断语言 id；未知返回 null。
	 * 点文件按「点后即扩展名」识别（`.env` → `env`、`.editorconfig` → `editorconfig`），
	 * 与 better-sidebar 的 `extOf()` 取法一致 —— 否则点文件永远匹配不上预览器。
	 */
	function langOf(path) {
	  if (typeof path !== "string" || path.length === 0) return null;
	  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	  const base = slash >= 0 ? path.slice(slash + 1) : path;
	  const dot = base.lastIndexOf(".");
	  if (dot < 0 || dot === base.length - 1) return null;
	  const ext = base.slice(dot + 1).toLowerCase();
	  // 不要用 `LANG_EXT[ext] ?? null`：`__proto__` / `constructor` 之类会命中原型链上的
	  // 继承属性（返回对象 / 函数而不是语言 id），必须只认自有属性。
	  return Object.hasOwn(LANG_EXT, ext) ? LANG_EXT[ext] : null;
	}

	/** 语言元数据：标签、注释语法、字符串引号、关键字、内建类型、额外高亮规则。 */
	const LANG_META = {
	  javascript: {
	    label: "JavaScript",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    // 模板字符串可跨行；反斜杠仍然是转义符
	    multilineStrings: [{ open: "`", close: "`", escape: true }],
	    regexLiterals: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await null true false undefined NaN Infinity".split(" "),
	    types: "Array BigInt Boolean Date Error Function Map Number Object Promise Proxy RegExp Set String Symbol WeakMap WeakSet JSON Math Intl ArrayBuffer DataView Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array".split(" ")
	  },
	  typescript: {
	    label: "TypeScript",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    multilineStrings: [{ open: "`", close: "`", escape: true }],
	    regexLiterals: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace module satisfies keyof infer is as asserts unknown never null true false undefined NaN".split(" "),
	    types: "any boolean number string symbol object bigint void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit Exclude Extract ReturnType Parameters ConstructorParameters Awaited".split(" ")
	  },
	  jsx: {
	    label: "JSX",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    multilineStrings: [{ open: "`", close: "`", escape: true }],
	    regexLiterals: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await null true false undefined NaN".split(" "),
	    types: "Array Boolean Date Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math".split(" ")
	  },
	  tsx: {
	    label: "TSX",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    multilineStrings: [{ open: "`", close: "`", escape: true }],
	    regexLiterals: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace satisfies keyof infer is as asserts unknown never null true false undefined NaN".split(" "),
	    types: "any boolean number string symbol object bigint void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit".split(" ")
	  },
	  python: {
	    label: "Python",
	    lineComment: "#", blockComment: null,
	    strings: ["'", '"'],
	    tripleStrings: ["'''", '"""'],
	    keywords: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False match case".split(" "),
	    types: "int float bool str bytes list tuple dict set frozenset complex object type range slice enumerate zip map filter any all min max len print super".split(" ")
	  },
	  java: {
	    label: "Java",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"'],
	    keywords: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while record sealed permits non-sealed var yield true false null".split(" "),
	    types: "String Object Integer Long Double Float Short Boolean Byte Character Void Math System Exception RuntimeException ArrayList HashMap HashSet LinkedHashMap LinkedList Optional Stream List Map Set Collection Iterator StringBuilder".split(" ")
	  },
	  csharp: {
	    label: "C#",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "@\""],
	    // 逐字字符串：开 `@"`、闭 `"`，`""` 表示一个字面引号，可跨行
	    multilineStrings: [{ open: '@"', close: '"', escape: false, doubled: true }],
	    keywords: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await record init required file partial get set value when where yield".split(" "),
	    types: "String Object Int32 Int64 Double Single Decimal Boolean Byte Char DateTime TimeSpan Guid Exception Console Math Task Task<T> IEnumerable List Dictionary HashSet StringBuilder Stream StreamReader StreamWriter HttpClient CancellationToken CancellationTokenSource".split(" ")
	  },
	  c: {
	    label: "C",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"'],
	    keywords: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Generic _Noreturn _Static_assert _Thread_local true false NULL".split(" "),
	    types: "size_t ssize_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t FILE va_list ptrdiff_t wchar_t bool".split(" ")
	  },
	  cpp: {
	    label: "C++",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    // 原始字符串（`R"(x)"` / `R"d(...)d"`）会退化成 `R` 标识符 + 普通 `"..."` 字符串：
	    // 平铺 strings 里的定界符必须是「单字符」引号，多字符项永远合不上（会吞掉整行）。
	    strings: ["'", '"'],
	    keywords: "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq".split(" "),
	    types: "string vector map unordered_map set unordered_set list deque queue stack pair tuple optional variant any shared_ptr unique_ptr weak_ptr string_view size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t ostream istream fstream ifstream ofstream".split(" ")
	  },
	  go: {
	    label: "Go",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    // 反引号原始字符串可跨行；其中反斜杠不是转义符
	    multilineStrings: [{ open: "`", close: "`", escape: false }],
	    keywords: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false iota nil".split(" "),
	    types: "int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune string error any comparable".split(" ")
	  },
	  rust: {
	    label: "Rust",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    // `r"..."` / `r#"..."#` 退化成 `r` 标识符 + 普通字符串（多字符定界符会吞行）。
	    // `'` 同时是字符字面量和生命周期标记，故只把字符字面量当字符串，
	    // `fn f<'a>(s: &'a str)` 这类生命周期不会被涂成字符串。
	    strings: ["'", '"'],
	    charLiteralOnly: true,
	    // Rust 的块注释可以嵌套：`/* a /* b */ c */` 只在外层闭合时结束
	    nestedBlockComments: true,
	    keywords: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while".split(" "),
	    types: "u8 u16 u32 u64 u128 i8 i16 i32 i64 i128 f32 f64 usize isize bool char str String Vec Option Some None Result Ok Err Box Rc Arc HashMap HashSet VecDeque BTreeMap BTreeSet Cow".split(" ")
	  },
	  php: {
	    label: "PHP",
	    blockComment: ["/*", "*/"],
	    // PHP 的 `#` 也是行注释；但 PHP 8 起 `#[...]` 是 attribute（见 commentHashAttribute）
	    lineComments: ["//", "#"],
	    commentHashAttribute: true,   // `#[Route('/x')]` 不是注释（PHP 8 attribute）
	    strings: ["'", '"'],
	    // SQL 风格的关键字大小写不敏感：`SELECT` / `select` 都是关键字
	    caseInsensitiveKeywords: true,
	    keywords: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null".split(" "),
	    types: "int float string bool array object iterable mixed void never resource null self parent".split(" ")
	  },
	  ruby: {
	    label: "Ruby",
	    lineComment: "#", blockComment: ["=begin", "=end"],
	    strings: ["'", '"', "`"],
	    keywords: "alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield".split(" "),
	    types: "Array Hash String Integer Float Symbol Proc Object Class Module Range Time Date Regexp NilClass TrueClass FalseClass Exception StandardError".split(" ")
	  },
	  swift: {
	    label: "Swift",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"'],
	    // Swift 的三引号字符串是真实语法（可跨行）
	    tripleStrings: ['"""'],
	    // Swift 的块注释可以嵌套
	    nestedBlockComments: true,
	    keywords: "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript super switch throws try typealias var weak where async await actor some any guard defer repeat case default break continue fallthrough return if else for while do in is as true false nil Self".split(" "),
	    types: "Int Int8 Int16 Int32 Int64 UInt UInt8 UInt16 UInt32 UInt64 Float Double Bool String Character Array Dictionary Set Optional Error Result Void Any AnyObject".split(" ")
	  },
	  kotlin: {
	    label: "Kotlin",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"'],
	    // 三引号原始字符串复用跨行长字符串状态机（平铺 strings 里不能放多字符定界符）
	    tripleStrings: ['"""'],
	    // Kotlin 的块注释可以嵌套
	    nestedBlockComments: true,
	    keywords: "as as? break class continue do else false for fun if in !in interface is !is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg".split(" "),
	    types: "Int Long Short Byte Double Float Boolean Char String Any Unit Nothing Array List MutableList Map MutableMap Set MutableSet Pair Triple Result".split(" ")
	  },
	  lua: {
	    label: "Lua",
	    lineComment: "--", blockComment: ["--[[", "]]"],
	    // `--[=*[ … ]=*]` 长注释（等级由 `=` 个数决定）
	    luaLongComments: true,
	    strings: ["'", '"'],
	    keywords: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" "),
	    types: "string number boolean table function thread userdata nil".split(" ")
	  },
	  shell: {
	    label: "Shell",
	    lineComment: "#", blockComment: null,
	    strings: ["'", '"', "`"],
	    // `#` 只在行首或空白 / `; & | (` 之后才起注释：`curl http://x#frag` 的 #frag 是 URL 片段
	    commentExtraBefore: " \t;&|(",
	    keywords: "if then else elif fi case esac for while until do done function in select time coproc declare typeset local export readonly unset set shift source return break continue exit trap echo printf read test true false".split(" "),
	    types: []
	  },
	  vue: {
	    label: "Vue",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    // 单文件组件：只有 `<script>` 块按 JS/TS 分词，模板 / 样式行原样留白
	    scriptBlocks: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace null true false undefined NaN".split(" "),
	    types: "any boolean number string symbol object void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit".split(" ")
	  },
	  svelte: {
	    label: "Svelte",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ["'", '"', "`"],
	    scriptBlocks: true,
	    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace null true false undefined NaN".split(" "),
	    types: "any boolean number string symbol object void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit".split(" ")
	  },
	  sql: {
	    label: "SQL",
	    lineComment: "--", blockComment: ["/*", "*/"],
	    strings: ["'", '"'],
	    // SQL 关键字大小写不敏感：`SELECT` / `select` 都是关键字
	    caseInsensitiveKeywords: true,
	    keywords: "select from where insert into values update set delete create table view index alter drop truncate join inner left right full outer on group by order having limit offset union all distinct as asc desc and or not null primary key foreign references unique check default constraint begin commit rollback transaction case when then else end exists in like between is cast".split(" "),
	    types: "int integer bigint smallint tinyint numeric decimal float real double money char varchar nvarchar text ntext binary varbinary bit date datetime timestamp time boolean json xml".split(" ")
	  },
	  protobuf: {
	    label: "Protobuf",
	    lineComment: "//", blockComment: ["/*", "*/"],
	    strings: ['"'],
	    keywords: "syntax import package option message enum oneof map repeated optional required reserved extensions extend service rpc returns stream group public to max true false".split(" "),
	    // 标量类型；message / enum 名是大写开头，由 tokenize 的类型启发式上色
	    types: "double float int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 bool string bytes".split(" ")
	  },

	  // ---- 配置文件 ----
	  // 配置语言的 `types` 一律留空：大写开头的词在配置里是数据（键名 / 枚举值），
	  // 走类型启发式只会把它们误标成内建类型。
	  // keySep / keyLine / keyQuoted / sectionLines / xmlTags 是给 tokenize.js 的
	  // 上色指令，含义见该文件。
	  json: {
	    label: "JSON",
	    lineComment: "//", blockComment: ["/*", "*/"],   // 顺带覆盖 jsonc / json5
	    strings: ['"', "'"],
	    keywords: "true false null".split(" "),
	    types: [],
	    keySep: ":", keyQuoted: true
	  },
	  yaml: {
	    label: "YAML",
	    lineComment: "#", blockComment: null,
	    strings: ['"', "'"],
	    keywords: "true false null yes no on off True False Null Yes No".split(" "),
	    types: [],
	    // `#` 只有位于行首或空白之后才是注释（`url: http://x/a#frag` 的 #frag 是值）
	    commentNeedsSpace: true,
	    // `:` 必须后接空白才是映射（`a:1` 在 YAML 里是标量字符串）
	    keySep: ":", keyColonSpace: true,
	    // `|` / `>` 块标量的正文行不参与键装饰（正文里的 `a: 1` / `#` 都是内容）
	    yamlBlockScalars: true
	  },
	  toml: {
	    label: "TOML",
	    lineComment: "#", blockComment: null,
	    strings: ['"', "'"], tripleStrings: ['"""', "'''"],
	    keywords: "true false".split(" "),
	    types: [],
	    // TOML 的 `#` 在未被字符串包裹时即可开始注释（包括 `a = 1#comment`）。
	    keySep: "=", sectionLines: true
	  },
	  ini: {
	    label: "INI",
	    lineComments: ["#", ";"], blockComment: null,
	    strings: ['"', "'"],
	    keywords: [], types: [],
	    commentNeedsSpace: true,   // `a=x;y` 的 `;y` 是值（`;` 需在行首/空白后）
	    keySep: "=:", sectionLines: true,
	    keyBare: "ident"           // INI 支持裸键（`plainkey`）；TOML 的 sectionLines 不隐含裸键
	  },
	  properties: {
	    label: "Properties",
	    lineComments: ["#", "!"], blockComment: null,   // Java properties：! 亦为注释
	    strings: ['"', "'"],
	    keywords: [], types: [],
	    commentLineStart: true,    // `#` / `!` 仅在行首起注释，故 `a=hello!world` 的 !world 是值
	    keySep: "=:",
	    keyEscape: true,           // `\` 是转义符：`key\:part` 的键是 `key:part`，`\:` 不是分隔符
	    keySpaceSep: true,         // 空白也是分隔符：`server.port 8080` 的键是 `server.port`
	    keyBare: "properties",     // 无分隔符时整行即键（`key\:part`、行尾续行反斜杠的 `a\`）
	    keyContinuation: true      // 行尾奇数个反斜杠 → 下一行是上一键的值（与 config-outline 同口径）
	  },
	  dotenv: {
	    label: "dotenv",
	    lineComments: ["#"], blockComment: null,        // 与 properties 不同：`;` 是普通值
	    strings: ['"', "'"],
	    keywords: [], types: [],
	    commentNeedsSpace: true,   // `KEY=x#y` 的 `#y` 是值
	    keySep: "=",
	    keyExportPrefix: true      // `export FOO=1` 的键是 `FOO`，`export` 不上色为键
	  },
	  xml: {
	    label: "XML",
	    lineComment: null, blockComment: ["<!--", "-->"],
	    // CDATA 复用跨行长字符串状态机（定界符不同，故写成 [开, 闭] 对）
	    tripleStrings: [["<![CDATA[", "]]>"]],
	    strings: ['"', "'"],
	    keywords: [], types: [],
	    xmlTags: true,
	    // 属性值允许换行写（`attr="a\n b"`），故字符串状态跨行保持；
	    // XML 属性值也没有反斜杠转义
	    multilineStrings: [
	      { open: '"', close: '"', escape: false },
	      { open: "'", close: "'", escape: false }
	    ]
	  }
	};

	/** 语言 id → 标签（未知语言兜底）。 */
	function langLabel(lang) {
	  const meta = LANG_META[lang];
	  return meta ? meta.label : (lang ?? "Text");
	}
	//#endregion
	//#region module: properties-key
	/**
	 * dsh-code-nav — Java properties 键名规则（纯函数，浏览器/node 通用）。
	 *
	 * properties 的键扫描规则与其它行式配置不同，且**大纲（config-outline.js）与
	 * 高亮（tokenize.js）必须同口径**，否则会出现「大纲能列出、但不高亮」这类
	 * 不一致。故把规则集中在这里，两边都调用它：
	 *
	 * - `=` `:` 与**空白**都是键值分隔符（`server.port 8080`）；
	 * - `\` 是转义符，`\:` / `\=` / `\ ` 中的分隔符属于键名本身（`key\:part`）；
	 * - 转义符不能是行尾最后一个字符（那属于续行语法，见 config-outline.js）。
	 *
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/**
	 * 找出 properties 键在 `body` 中的结束位置。
	 *
	 * 返回 `-1` 表示**整行都是键**（没有分隔符的裸键，例如 `key\:part`、`plainkey`）。
	 * 返回 `0` 表示第一个字符就是分隔符（`=value`），调用方应视为无键。
	 *
	 * @param {string} body 去掉行首空白后的行内容
	 * @returns {number} 分隔符下标，或 -1（整行是键）
	 */
	function propertiesKeyEnd(body) {
	  for (let k = 0; k < body.length; k++) {
	    const ch = body[k];
	    if (ch === "\\") {
	      // 转义吃掉下一个字符；行尾孤立反斜杠不属于键名（续行标记）
	      if (k + 1 >= body.length) return k;
	      k++;
	      continue;
	    }
	    if (ch === "=" || ch === ":" || ch === " " || ch === "\t") return k;
	  }
	  return -1;
	}

	/**
	 * 取出 properties 行的**键文本**（未反转义），没有键时返回 ""。
	 *
	 * 这是大纲与高亮共用的唯一截断规则，因此两者不可能对同一行给出不同结论：
	 * - 找到分隔符（下标 > 0）→ 键是分隔符之前的部分（去掉尾随空白）；
	 * - 整行都是键（返回 -1）→ 键是整行；
	 * - 行首就是分隔符（下标 0，例如 `=v`）→ 没有键。
	 *
	 * 行尾的孤立反斜杠是**续行标记**而非键名的一部分，故 `a\` 的键是 `a`
	 * （上一版高亮要求「必须返回 -1」，导致这类键大纲有条却不高亮）。
	 *
	 * @param {string} body 去掉行首空白后的行内容
	 * @returns {string} 键文本（未反转义），无键返回 ""
	 */
	function propertiesKeySlice(body) {
	  const cut = propertiesKeyEnd(body);
	  if (cut === -1) return body;
	  if (cut > 0) return body.slice(0, cut).trim();
	  return "";
	}

	/**
	 * Java properties 键名反转义：`\:`→`:`、`\\`→`\`、`\t`、`\uXXXX`，未知转义取字面。
	 * @param {string} name 原始（未反转义）键名
	 * @returns {string}
	 */
	function unescapePropertyKey(name) {
	  let out = "";
	  for (let i = 0; i < name.length; i++) {
	    const ch = name[i];
	    if (ch !== "\\") { out += ch; continue; }
	    const next = name[i + 1];
	    if (next === undefined) { out += ch; continue; }   // 末尾孤立反斜杠按字面保留
	    i++;
	    if (next === "t") out += "\t";
	    else if (next === "n") out += "\n";
	    else if (next === "r") out += "\r";
	    else if (next === "f") out += "\f";
	    else if (next === "u") {
	      const hex = name.slice(i + 1, i + 5);
	      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
	      else out += "u";
	    } else out += next;                                // \: \= \\ \# \! 以及未知转义
	  }
	  return out;
	}
	//#endregion
	//#region module: tokenize
	/**
	 * dsh-code-nav — 轻量多语言语法高亮分词器（纯函数，浏览器/node 通用）。
	 *
	 * 逐行扫描，状态跨行保持（块注释、Python 三引号字符串）。
	 * 每行输出：{ raw, segs: [{ text, cls }] }，cls 取值为：
	 *   ""（普通）| c-comment | c-string | c-kw | c-type | c-num | c-ident | c-fn
	 * 构建时由 scripts/build.mjs 内联进 lib/client.js（import/export 行被剥离，
	 * 内联后共享同一函数作用域）。
	 */

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
	function tokenizeLines(text, lang) {
	  if (typeof text !== "string" || !Object.hasOwn(LANG_META, lang)) return null;
	  const meta = LANG_META[lang];
	  const truncated = text.length > 500000; // 防御性上限
	  if (truncated) text = text.slice(0, 500000);
	  const lines = text.split(/\r?\n/);
	  // Vue/Svelte 单文件组件：只有 script 块按 JS/TS 分词，模板 / 样式行留白
	  if (meta.scriptBlocks === true) {
	    const out = tokenizeScriptBlocks(text, lines);
	    return truncated ? markTokenizeTruncated(out) : out;
	  }
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
	  // XML 的标签内/外状态要跨行保持（属性可以换行写），故 runner 建在循环外
	  const xmlRun = meta.xmlTags === true ? makeXmlRunner() : null;
	  // 配置文件是否需要对「键 / 段头」补上色
	  const decorate = meta.keySep !== undefined || meta.sectionLines === true;
	  let blockDepth = 0;           // 块注释嵌套深度（0 表示不在注释里）
	  let luaLongEnd = "";          // Lua 长注释进行中时其结束定界符
	  let inTriple = false;         // 长字符串 / CDATA 进行中
	  let tripleEnd = "";           // 其结束定界符
	  let inString = false;
	  let stringEnd = "";           // 续行字符串的闭定界符
	  let stringEscape = false;     // 续行中反斜杠是否转义
	  let stringDoubled = false;    // 续行中连写闭定界符是否表示字面定界符（C# `""`）
	  // YAML 块标量：父键缩进（>=0 表示正文中），正文行不参与键装饰
	  let yamlScalarIndent = -1;
	  // properties 续行（Java properties：行尾奇数个反斜杠 → 下一行是上一键的值）。
	  // 与 config-outline.js 的 `continued` 状态完全同口径，避免「大纲算值、高亮算键」。
	  const trackContinuation = meta.keyContinuation === true;
	  let propertiesContinued = false;
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
	  return truncated ? markTokenizeTruncated(out) : out;
	}
	//#endregion
	//#region module: config-outline
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
	function outlineOfConfig(text, lang, tokens, lineCount) {
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
	//#endregion
	//#region module: outline
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

	/** 配置文件语言 id（走 config-outline.js 的提取器，而不是括号/缩进规则）。 */
	const CONFIG_LANGS = new Set(["json", "yaml", "toml", "xml", "ini", "properties", "dotenv"]);

	/** kind → 筛选分组（全部 / 类 / 方法 / 变量）。 */
	function kindGroup(kind) {
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
	        const ctx = { m, depthBefore, stack, clean, lang };
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
	  const RE_VAR = /^\s*([A-Za-z_]\w*)\s*=/;
	  for (let i = 0; i < lineCount; i++) {
	    const clean = cleanOf(tokens, i);
	    if (clean.trim().length === 0) continue;
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
	    // 裸赋值：类体直属层的 `name = "x"` 是类属性（field + container）；
	    // 模块级（无作用域、缩进 0）是变量；方法体内的局部赋值不进入大纲。
	    const mV = RE_VAR.exec(clean);
	    if (mV !== null) {
	      const top = scopes.length > 0 ? scopes[scopes.length - 1] : null;
	      if (top !== null && top.type === "class") {
	        out.push({ kind: "field", name: mV[1], line: i + 1, container: top.name });
	      } else if (top === null && indent === 0) {
	        out.push({ kind: "variable", name: mV[1], line: i + 1 });
	      }
	    }
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
	const OUTLINE_MAX_SYMBOLS = 500;

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
	function outlineOf(text, lang) {
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
	function outlineOfTokens(tokens, lang) {
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
	//#endregion
	//#region module: search
	/**
	 * dsh-code-nav — 文件内查找匹配（纯函数，浏览器/node 通用）。
	 *
	 * findMatches 返回按位置排序的匹配数组（0 基 line/col，含 start/end 绝对偏移）。
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/** 单次查找返回的匹配上限（界面据此提示「还有更多」，避免看起来只有 2000 处）。 */
	const MAX_MATCHES = 2000;

	/** 在不改变数组内容 / deepEqual 结果的前提下标记确实存在第 N+1 条匹配。 */
	function markSearchCapped(items) {
	  if (items.capped !== true) Object.defineProperty(items, "capped", { value: true, enumerable: false });
	  return items;
	}

	/**
	 * 转义正则元字符，让查询串按字面量匹配。
	 * @param {string} s
	 * @returns {string}
	 */
	function escapeRegExp(s) {
	  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	/**
	 * 在文本中查找 query 的全部出现位置。
	 *
	 * 匹配走正则而不是「小写化后再 indexOf」：`toLowerCase()` 对个别字符会**改变码元数**
	 * （`İ` U+0130 → `i` + 组合上的一点），于是小写串里的下标不再等于原文下标 ——
	 * 按它切高亮区间会串位，按它回查原文又会把 İ 之后的普通匹配整片丢掉。正则直接在原文
	 * 上匹配，start/end 天然就是原文坐标；代价是个别大小写折叠对（İ/i）不再互相命中，
	 * 这是可接受的保守取舍。
	 * @param {string} text
	 * @param {string} query 空串返回 []
	 * @param {{ caseSensitive?: boolean }} opts
	 * @returns {Array<{start:number, end:number, line:number, col:number}>}
	 */
	function findMatches(text, query, opts = {}) {
	  if (typeof text !== "string" || typeof query !== "string" || query.length === 0) return [];
	  const re = new RegExp(escapeRegExp(query), opts.caseSensitive === true ? "g" : "gi");
	  const out = [];
	  let line = 0;
	  let lineStart = 0;
	  let m;
	  while (out.length < MAX_MATCHES && (m = re.exec(text)) !== null) {
	    const at = m.index;
	    // 计算 at 所在行（增量扫描）
	    while (lineStart <= at) {
	      const nl = text.indexOf("\n", lineStart);
	      if (nl === -1 || nl >= at) break;
	      line++;
	      lineStart = nl + 1;
	    }
	    out.push({ start: at, end: at + m[0].length, line, col: at - lineStart });
	    // 查询串非空且已全部转义成字面量，匹配长度必然 >= 1；这里只是防止 lastIndex 卡住。
	    if (re.lastIndex === at) re.lastIndex = at + 1;
	  }
	  // 循环在达到上限时停在最后一条匹配之后；只额外探测一条，区分「恰好 N 条」
	  // 与「至少 N+1 条」，避免界面把恰好达到上限的结果误报成还有更多。
	  if (out.length === MAX_MATCHES && re.exec(text) !== null) markSearchCapped(out);
	  return out;
	}

	/**
	 * 把一行文本按 token 边界与匹配区间切成渲染 span。
	 * @param {string} lineText 原始行文本
	 * @param {Array<{text:string, cls:string}>} segs 该行 token
	 * @param {Array<{start:number, col:number, end:number}>} lineMatches 该行匹配（相对行首）
	 * @param {number} currentIndex 当前匹配在该行匹配中的序号（-1 表示不在本行）
	 * @returns {Array<{text:string, cls:string, match?:boolean, current?:boolean}>}
	 */
	function spansOfLine(lineText, segs, lineMatches, currentIndex) {
	  if (lineMatches.length === 0) {
	    return segs.length > 0 ? segs : (lineText.length > 0 ? [{ text: lineText, cls: "" }] : []);
	  }
	  // 合并边界点
	  const cuts = new Set([0, lineText.length]);
	  let pos = 0;
	  for (const s of segs) {
	    pos += s.text.length;
	    cuts.add(pos);
	  }
	  for (const m of lineMatches) {
	    cuts.add(m.col);
	    cuts.add(m.end);
	  }
	  const sorted = [...cuts].sort((a, b) => a - b);
	  const spans = [];
	  // segs 索引推进
	  let si = 0;
	  let segPos = 0;
	  for (let k = 0; k < sorted.length - 1; k++) {
	    const a = sorted[k];
	    const b = sorted[k + 1];
	    if (a >= b) continue;
	    // 找该区间命中的 token 类别
	    while (si < segs.length && segPos + segs[si].text.length <= a) {
	      segPos += segs[si].text.length;
	      si++;
	    }
	    let cls = "";
	    if (si < segs.length) cls = segs[si].cls;
	    const text = lineText.slice(a, b);
	    if (text.length === 0) continue;
	    const matchIdx = lineMatches.findIndex((m) => m.col <= a && m.end >= b);
	    const span = { text, cls };
	    if (matchIdx !== -1) {
	      span.match = true;
	      if (matchIdx === currentIndex) span.current = true;
	    }
	    spans.push(span);
	  }
	  return spans;
	}
	//#endregion
	//#region module: selection
	/**
	 * dsh-code-nav — 「选中文字 → 添加到对话」的插入载荷（纯函数，浏览器/node 通用）。
	 *
	 * 载荷形状与 dsh-better-sidebar 内置查看器（markdown 预览 / CodeMirror 编辑器）
	 * 完全一致，两条入口粘出来的草稿文本无差别：
	 *  - 选区 ≤ SELECTION_LIMIT 个字符：围栏代码块，信息行为 `相对路径:起止行`，
	 *    正文为选中文本；
	 *  - 超过上限：只留一行纯文本 `相对路径:起止行`（不带围栏、不带正文）；
	 *  - 路径相对会话 cwd（与资源管理器的 @ 按钮同一投影），cwd 未知时用绝对路径；
	 *  - 行号：单行写 `path:12`，多行写 `path:12-15`，行号不可得时只写路径。
	 *
	 * 除围栏块本身，这里还给出草稿里那枚引用 chip 的两半：`where` 是可见标签
	 * （`文件名 L12-15`），`header` 是剪贴板 / 持久化投影（`相对路径:12-15`）。
	 * 发送时 codec 展开回 `text`，与 better-sidebar 的 quote chip 同形。
	 *
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/** 插入草稿的选区长度上限（UTF-16 码元，即 JS `.length`）。 */
	const SELECTION_LIMIT = 500;

	/**
	 * 会话 cwd 下的相对路径（与 better-sidebar 的 paths.relativeTo 同一语义）。
	 * @param {string} cwd 会话工作目录（绝对路径）
	 * @param {string} path 文件绝对路径
	 * @returns {string} 以 `/` 分隔的相对路径；不在 cwd 内时原样返回
	 */
	function relativeTo(cwd, path) {
	  const base = cwd.replace(/[\\/]+$/, "");
	  const norm = (value) => value.replace(/\\/g, "/");
	  const nBase = norm(base);
	  const nPath = norm(path);
	  if (nPath === nBase) return ".";
	  // 前缀比较不区分大小写：Windows 盘符大小写可能与 cwd 行不一致，
	  // 但返回的相对文本保留调用方自己的大小写。
	  if (nPath.toLowerCase().startsWith(nBase.toLowerCase() + "/")) return nPath.slice(nBase.length + 1);
	  return path;
	}

	/**
	 * 围栏信息行：`相对路径[:起始行[-结束行]]`；行号不可得时省略整个行号段。
	 * @param {string} path
	 * @param {string|undefined} cwd
	 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
	 * @returns {string}
	 */
	function selectionHeader(path, cwd, lines) {
	  const rel = typeof cwd === "string" && cwd.length > 0 ? relativeTo(cwd, path) : path;
	  if (lines === undefined || lines === null) return rel;
	  if (lines.end > lines.start) return rel + ":" + lines.start + "-" + lines.end;
	  return rel + ":" + lines.start;
	}

	/**
	 * 引用 chip 的显示文字：`文件名 L起[-止]`（与 dsh-better-sidebar 的
	 * `引用 {where}` 同一身份；行号不可得时只写文件名）。
	 * @param {string} path 文件绝对路径
	 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
	 * @returns {string}
	 */
	function selectionWhere(path, lines) {
	  const parts = path.replace(/\\/g, "/").split("/");
	  const file = parts.length > 0 && parts[parts.length - 1] !== "" ? parts[parts.length - 1] : path;
	  if (lines === undefined || lines === null) return file;
	  if (lines.end > lines.start) return file + " L" + lines.start + "-" + lines.end;
	  return file + " L" + lines.start;
	}

	/**
	 * 一次选区的结构化载荷。
	 *  - `header`：围栏信息行 / chip 的剪贴板投影（`相对路径:起止行`）；
	 *  - `where`：chip 的显示文字（`文件名 L起止`）；
	 *  - `text`：模型最终收到的文本（围栏块；超过上限只留 header）。
	 * @param {string} path 文件绝对路径
	 * @param {string|undefined} cwd 会话工作目录
	 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
	 * @param {string} selected 选中文本
	 * @returns {{header:string, where:string, text:string}}
	 */
	function selectionPayload(path, cwd, lines, selected) {
	  const header = selectionHeader(path, cwd, lines);
	  const where = selectionWhere(path, lines);
	  if (selected.length > SELECTION_LIMIT) return { header, where, text: header };
	  return { header, where, text: "```" + header + "\n" + selected + "\n```" };
	}

	/**
	 * 一次选区的完整插入文本（纯文本回退路径的载荷）。
	 * @param {string} path 文件绝对路径
	 * @param {string|undefined} cwd 会话工作目录
	 * @param {{start:number, end:number}|undefined} lines 1 起闭区间
	 * @param {string} selected 选中文本
	 * @returns {string}
	 */
	function buildSelectionInsert(path, cwd, lines, selected) {
	  return selectionPayload(path, cwd, lines, selected).text;
	}
	//#endregion
	//#region module: draft-coords
	/**
	 * 会话草稿的两个投影之间的纯换算（浏览器 / node 通用）。
	 *
	 * 宿主同时维护两套坐标：
	 *  - **clipboard 投影**（`InputState.draft`、`occurrences`）：每个引用 chip
	 *    展开成它的 `clipboardText`；
	 *  - **detect 投影**：同一个 chip 折成 1 个占位字符（U+FFFC），
	 *    `captureInsertion()` / `insertReference()` 的 span 都在这套坐标里。
	 *
	 * 插件只拿到 clipboard 投影的草稿，却要在 detect 坐标的插入点前判断「要不要
	 * 补分隔空格」——直接拿 `draft.slice(0, span.start)` 比较会在草稿里已有 chip
	 * 时错位。这里给出唯一的折叠实现。
	 *
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/** detect 投影里一个引用 chip 占的单个字符（与宿主内部一致）。 */
	const CHIP_PLACEHOLDER = "\uFFFC";

	/**
	 * 把 clipboard 投影的草稿折叠成 detect 投影。
	 * `occurrences` 按宿主契约以 offset 升序排列、互不重叠；越界 / 倒序 / 长度非正的
	 * 条目一律跳过（宁可不折叠，也不造出负索引的乱序文本）。
	 * @param {string} draft clipboard 投影草稿
	 * @param {ReadonlyArray<{offset:number, length:number}>|undefined} occurrences
	 * @returns {string}
	 */
	function detectTextOf(draft, occurrences) {
	  if (typeof draft !== "string" || draft.length === 0) return "";
	  const list = Array.isArray(occurrences) ? occurrences : [];
	  let out = "";
	  let cursor = 0;
	  for (const occurrence of list) {
	    if (occurrence === null || occurrence === undefined) continue;
	    const offset = Number(occurrence.offset);
	    const length = Number(occurrence.length);
	    if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) continue;
	    if (offset < cursor || offset > draft.length) continue;
	    out += draft.slice(cursor, offset) + CHIP_PLACEHOLDER;
	    cursor = Math.min(offset + length, draft.length);
	  }
	  out += draft.slice(cursor);
	  return out;
	}

	/**
	 * 草稿里是否可能存在宿主**没告诉我们**的 quote 节点。
	 *
	 * 宿主 `InputState` 目前不暴露 `quotes`（`DetectProjection.quotes` 只在内部
	 * 投影里出现），而 quote 在 clipboard 投影里的形状是 `formatQuoteText`
	 * —— 每行加 `> ` 前缀（`ui-primitives/src/markdown/quote-text.ts`）。于是
	 * 每个 quote 的 clipboard 投影必有一行以 `> ` 开头：看到这种行就说明草稿里
	 * 可能有未计入 `occurrences` 的原子节点，此时按 `occurrences` 折叠出的 detect
	 * 投影**不可信**（会多出 quote 正文的长度）。
	 *
	 * 保守起见宁可误报：用户手打的 Markdown 引用也会命中，代价只是多一个空格。
	 * @param {string} draft clipboard 投影草稿
	 * @returns {boolean}
	 */
	function hasQuoteMarkers(draft) {
	  if (typeof draft !== "string" || draft.length === 0) return false;
	  return /^> /m.test(draft);
	}

	/**
	 * 在 detect 坐标的 `start` 处插入内容前，左侧是否需要一个分隔空格：
	 * 草稿非空、插入点不在开头、且前一个字符不是空白。
	 * @param {string} detectText detect 投影草稿
	 * @param {number} start 插入点（0 起）
	 * @returns {boolean}
	 */
	function needsLeadingSpace(detectText, start) {
	  if (typeof detectText !== "string" || detectText.length === 0) return false;
	  if (typeof start !== "number" || !Number.isFinite(start) || start <= 0) return false;
	  const at = Math.min(Math.max(Math.floor(start), 0), detectText.length);
	  if (at === 0) return false;
	  return !/\s/u.test(detectText.slice(at - 1, at));
	}
	//#endregion
	//#region module: render-window
	/**
	 * dsh-code-nav — 渲染窗口（纯函数，浏览器/node 通用）。
	 *
	 * 客户端为了控制 DOM 规模，只把文件的前 RENDER_MAX_LINES 行渲染成行容器。
	 * 搜索与大纲若基于**完整内容**计算，就会出现「找得到、数得到，却跳不过去」的
	 * 状态：`n/m` 把窗口外的匹配也算进去、符号列表里点窗口外的符号毫无反应
	 * （jumpToLine 找不到对应的 [data-cn-line] 行）。故两者都必须按同一窗口裁剪。
	 *
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/** 单次渲染的行数上限（与客户端的行容器数量一致）。 */
	const RENDER_MAX_LINES = 20000;

	/**
	 * 实际会生成 DOM 行的行数：合法行号范围是 1..renderedLineCount(lineCount, max)。
	 * @param {number} lineCount 文件总行数
	 * @param {number} [maxLines] 行数上限，默认 RENDER_MAX_LINES
	 * @returns {number}
	 */
	function renderedLineCount(lineCount, maxLines) {
	  const cap = typeof maxLines === "number" && maxLines > 0 ? maxLines : RENDER_MAX_LINES;
	  if (!(lineCount > 0)) return 0;
	  return Math.min(lineCount, cap);
	}

	/**
	 * 该 1 基行号是否落在渲染窗口内（即能否被跳转 / 闪烁定位）。
	 * @param {number} line 1 基行号
	 * @param {number} renderedCount renderedLineCount 的结果
	 * @returns {boolean}
	 */
	function inRenderWindow(line, renderedCount) {
	  return line >= 1 && line <= renderedCount;
	}

	/**
	 * 单行「逐 token 高亮」的保护上限。
	 *
	 * 一行里塞进上万个 `<span>` 会让 Chromium 的布局/绘制卡死（实测：928 KB 单行 JSON
	 * → 54,508 个 span 在同一行，隔离 Chromium 里首帧永不出现、mousemove 300 s 不返回；
	 * 同一内容按一个文本节点渲染则 1.1 s 完成、hover 流畅）。超过任一上限的行改为
	 * **纯文本渲染**：仍显示完整内容、可选中、可搜索跳转（行闪烁/当前匹配列），只是
	 * 该行不做逐 token 着色 —— 用一次高亮换整页可用性。
	 */
	const PLAIN_LINE_MAX_CHARS = 8000;

	/** 单行 token 段数上限（超长行往往同时命中字符数与段数，二者取「或」）。 */
	const PLAIN_LINE_MAX_SEGS = 500;

	/**
	 * 该行是否应关闭逐 token 高亮、按纯文本渲染。
	 * @param {unknown} raw 该行原始文本
	 * @param {unknown} segCount 该行 token 段数
	 * @returns {boolean}
	 */
	function lineIsPlain(raw, segCount) {
		if (typeof raw === "string" && raw.length > PLAIN_LINE_MAX_CHARS) return true;
		return typeof segCount === "number" && Number.isFinite(segCount) && segCount > PLAIN_LINE_MAX_SEGS;
	}

	/**
	 * 把「带 1 基行号的对象」裁到渲染窗口内。
	 * 搜索匹配与大纲符号都走这一个函数，二者的可跳转性与 DOM 行集合就不会漂移。
	 * @template {{line:number}} T
	 * @param {T[]} items
	 * @param {number} renderedCount renderedLineCount 的结果
	 * @returns {T[]} 仅含窗口内的项（原本就在窗口内时返回新数组，不改动入参）
	 */
	function clipToRenderWindow(items, renderedCount) {
	  if (!Array.isArray(items) || items.length === 0) return [];
	  const out = [];
	  for (let i = 0; i < items.length; i++) {
	    const item = items[i];
	    if (inRenderWindow(item.line, renderedCount)) out.push(item);
	  }
	  return out;
	}

	/**
	 * 裁到渲染窗口，并且把 0 基行号转成 1 基后再判定（搜索匹配用）。
	 * @template {{line:number}} T
	 * @param {T[]} items
	 * @param {number} renderedCount
	 * @returns {T[]}
	 */
	function clipZeroBasedToRenderWindow(items, renderedCount) {
	  if (!Array.isArray(items) || items.length === 0) return [];
	  const out = [];
	  for (let i = 0; i < items.length; i++) {
	    const item = items[i];
	    if (inRenderWindow(item.line + 1, renderedCount)) out.push(item);
	  }
	  return out;
	}
	//#endregion
	//#region module: view-state
	/**
	 * dsh-code-nav — 预览器 UI 的派生状态（纯函数，浏览器 / node 通用）。
	 *
	 * 这些判断原本散在 `scripts/client.template.js` 的组件里，浏览器单测够不着；
	 * 抽到这里后既能在 CI 里逐条断言语义，也让模板只负责把「宿主给的信号」翻译成
	 * 参数。四个函数都不得访问 DOM / window：调用方负责采集信号。
	 *
	 * 共享作用域约定见 lang-registry.js 文件头。
	 */

	/**
	 * 解析 `getComputedStyle` 实际会返回的颜色写法，得到 RGBA 四元组。
	 * 支持 `rgb()/rgba()`（逗号与空格语法、可带 `/ alpha`、百分号 alpha）、
	 * `#rgb/#rgba/#rrggbb/#rrggbbaa` 与关键字 `transparent`。
	 * 命名色、`color()`、`oklch()` 等无法可靠换算的格式返回 null。
	 * @param {unknown} value
	 * @returns {[number, number, number, number] | null} [r, g, b, alpha(0..1)]
	 */
	function parseCssColor(value) {
		if (typeof value !== "string") return null;
		const text = value.trim().toLowerCase();
		if (text === "") return null;
		if (text === "transparent") return [0, 0, 0, 0];
		const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)$/.exec(text);
		if (fn !== null) {
			const alphaRaw = fn[4];
			let alpha = 1;
			if (alphaRaw !== undefined) {
				const n = Number(alphaRaw);
				alpha = Number.isFinite(n) ? (fn[5] === "%" ? n / 100 : n) : 1;
			}
			return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Math.max(0, Math.min(1, alpha))];
		}
		const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
		if (hex === null) return null;
		const digits = hex[1];
		if (digits.length === 3 || digits.length === 4) {
			const r = parseInt(digits[0] + digits[0], 16);
			const g = parseInt(digits[1] + digits[1], 16);
			const b = parseInt(digits[2] + digits[2], 16);
			const a = digits.length === 4 ? parseInt(digits[3] + digits[3], 16) / 255 : 1;
			return [r, g, b, a];
		}
		if (digits.length === 6 || digits.length === 8) {
			const r = parseInt(digits.slice(0, 2), 16);
			const g = parseInt(digits.slice(2, 4), 16);
			const b = parseInt(digits.slice(4, 6), 16);
			const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
			return [r, g, b, a];
		}
		return null;
	}

	/**
	 * 判定宿主当前的配色是否为深色。
	 *
	 * 优先采用宿主 ThemePresenter 的权威规则（见 dsh-client-ui-layout/theme.ts）：
	 * `html { color-scheme }` 一旦被写出，深浅就由 `body[data-ds-dark-theme]`
	 * 决定，**不再**回看系统偏好（用户显式选了浅色时系统偏好是干扰项）。
	 * Presenter 尚未运行时退回 `prefers-color-scheme`；两者都不可用才看背景色。
	 * 背景色透明（alpha = 0）说明颜色画在祖先元素上、这里的信息不足 —— 按浅色处理，
	 * 绝不能把 `rgba(0,0,0,0)` 当成黑色。
	 * @param {{ colorScheme?: unknown, bodyDark?: unknown, prefersDark?: unknown, background?: unknown }} [signals]
	 * @returns {boolean}
	 */
	function themeIsDark(signals = {}) {
		const colorScheme = signals.colorScheme;
		// 宿主只写 "light" | "dark"；任何非空值都代表「已经决定」。
		if (typeof colorScheme === "string" && colorScheme.trim() !== "") return signals.bodyDark === true;
		if (typeof signals.prefersDark === "boolean") return signals.prefersDark;
		const rgba = parseCssColor(signals.background);
		if (rgba === null || rgba[3] === 0) return false;
		const lum = (0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2]) / 255;
		return lum < 0.5;
	}

	/**
	 * 把一次行跳转请求换算成可执行的行区间。
	 *
	 * `renderedCount` 是真正生成了 `[data-cn-line]` 行容器的行数（渲染窗口）。请求行
	 * 落在窗口之外时 `inWindow=false`：调用方只能提示，不能 clamp 到窗口末尾去闪一行
	 * 用户没请求的代码，也不能对宿主说「这一跳已落地」。
	 *
	 * 窗口内行为保持原样：`lineEnd` 缺省等于 `line`，起点不小于 1、终点不越过窗口且
	 * 不小于起点（向下的反向区间也会被拉正）。
	 * @param {unknown} line 1 基请求行号
	 * @param {unknown} lineEnd 1 基区间末行（可缺省）
	 * @param {unknown} renderedCount 已渲染行数
	 * @returns {{requestedLine:number, renderedCount:number, inWindow:boolean, outOfWindow:boolean, start:number, end:number}}
	 */
	function lineWindowState(line, lineEnd, renderedCount) {
		const requested = typeof line === "number" && Number.isFinite(line) ? Math.floor(line) : 0;
		const rendered = typeof renderedCount === "number" && Number.isFinite(renderedCount) && renderedCount > 0
			? Math.floor(renderedCount)
			: 0;
		if (requested < 1) {
			return { requestedLine: requested, renderedCount: rendered, inWindow: false, outOfWindow: false, start: 0, end: 0 };
		}
		if (rendered === 0 || requested > rendered) {
			return { requestedLine: requested, renderedCount: rendered, inWindow: false, outOfWindow: true, start: 0, end: 0 };
		}
		const endRequested = typeof lineEnd === "number" && Number.isFinite(lineEnd) ? Math.floor(lineEnd) : requested;
		const start = Math.max(1, requested);
		const end = Math.max(start, Math.min(endRequested, rendered));
		return { requestedLine: requested, renderedCount: rendered, inWindow: true, outOfWindow: false, start, end };
	}

	/**
	 * 查找计数在「被渲染窗口裁剪」之后该怎么显示。
	 *
	 * `findMatches` 的上限（MAX_MATCHES）与渲染窗口是两个不同的裁剪：前者限制总数，
	 * 后者决定**能跳过去**的条数。旧界面把分母固定成 `MAX_MATCHES +`，于是窗口内只有
	 * 100 条可导航匹配时仍显示 `1/2000+`；全部匹配都在窗口外时甚至显示「无匹配」。
	 *
	 * 返回语义：
	 * - `empty`：搜索没有命中（空查询也走这里，由调用方区别对待）；
	 * - `outsideOnly`：命中了，但全部在渲染窗口之外 —— 不能说「无匹配」；
	 * - `countOutside`：窗口内有可导航匹配，窗口外还有（命中上限被裁掉）—— 计数用
	 *   可导航条数，另给一条「窗口外还有」提示；
	 * - `countCapped`：可导航条数正好顶到 MAX_MATCHES，分母保留 `+`（确实可能还有更多）；
	 * - `count`：普通情况，分母就是可导航条数。
	 * @param {unknown} matchesLength 裁剪后（可导航）的匹配数
	 * @param {unknown} capped 裁剪**前** findMatches 是否探测到第 N+1 条
	 * @param {unknown} maxMatches MAX_MATCHES
	 * @returns {{kind:"empty"|"outsideOnly"|"countOutside"|"countCapped"|"count", total:number, capped:boolean, outside:boolean}}
	 */
	function matchWindowState(matchesLength, capped, maxMatches) {
		const total = typeof matchesLength === "number" && Number.isFinite(matchesLength) && matchesLength > 0
			? Math.floor(matchesLength)
			: 0;
		const cap = typeof maxMatches === "number" && Number.isFinite(maxMatches) && maxMatches > 0
			? Math.floor(maxMatches)
			: 0;
		const cappedFlag = capped === true && cap > 0;
		if (total === 0) {
			return { kind: cappedFlag ? "outsideOnly" : "empty", total: 0, capped: cappedFlag, outside: cappedFlag };
		}
		if (cappedFlag && total < cap) {
			return { kind: "countOutside", total, capped: true, outside: true };
		}
		if (cappedFlag && total >= cap) {
			return { kind: "countCapped", total, capped: true, outside: false };
		}
		return { kind: "count", total, capped: false, outside: false };
	}

	/**
	 * 符号下拉为空时该说哪句话：大纲本身空 / 当前筛选没有命中 / 符号全在渲染窗口外。
	 *
	 * 第三个参数是「按渲染窗口裁剪后、按筛选裁剪前」的条数（客户端里是
	 * `symbols.list.length`）。旧实现拿裁剪前的 `hasSymbols` 与裁剪后的
	 * `filtered.length` 两个不同基数比较：文件超过 RENDER_MAX_LINES 且所有符号
	 * 都在窗口外时 `hasSymbols=true, filtered=0` 会被判成 "filtered"（用户根本
	 * 没有筛选，改筛选也没用）。传入窗口内条数后，0 条才区分成 "window"。
	 * 不传（undefined / 非数字）时保持旧语义，兼容既有调用与测试。
	 * @param {unknown} hasSymbols 大纲是否有符号（未按筛选 / 窗口裁剪）
	 * @param {unknown} filteredLength 筛选后的条数
	 * @param {unknown} [inWindowLength] 渲染窗口内、筛选前的符号条数
	 * @returns {"ok"|"filtered"|"window"|"none"}
	 */
	function symbolsEmptyKind(hasSymbols, filteredLength, inWindowLength) {
		const filtered = typeof filteredLength === "number" && Number.isFinite(filteredLength) ? filteredLength : 0;
		if (filtered > 0) return "ok";
		if (hasSymbols !== true) return "none";
		const inWindow = typeof inWindowLength === "number" && Number.isFinite(inWindowLength) ? inWindowLength : -1;
		return inWindow === 0 ? "window" : "filtered";
	}
	//#endregion
	return { langOf, langLabel, LANG_EXT, LANG_META, tokenizeLines, outlineOf, outlineOfTokens, kindGroup, OUTLINE_MAX_SYMBOLS, findMatches, spansOfLine, MAX_MATCHES, SELECTION_LIMIT, selectionHeader, selectionWhere, selectionPayload, buildSelectionInsert, CHIP_PLACEHOLDER, detectTextOf, needsLeadingSpace, hasQuoteMarkers, RENDER_MAX_LINES, renderedLineCount, inRenderWindow, lineIsPlain, clipToRenderWindow, clipZeroBasedToRenderWindow, themeIsDark, lineWindowState, matchWindowState, symbolsEmptyKind };
})();

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
		const PACKAGE_NAME = "@whybebabo/dsh-code-nav";
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
				const el = all[no - 1];
				const wrap = el === undefined || el.getAttribute("data-cn-line") !== String(no)
					? null
					: el.querySelector(".cn-code-wrap");
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
			"fileTooLarge": "文件过大（{size}），超出宿主内联预览上限",
			"lineCapped": "文件过长，仅渲染前 {n} 行（共 {total} 行）：查找与大纲只覆盖已渲染的行",
			"linePlain": "有 {n} 行过长，已关闭这些行的语法高亮以保证滚动流畅（内容仍完整、可选中/查找）",
			"lineNotRendered": "无法跳转到第 {line} 行：当前只渲染了前 {n} 行",
			"search.outsideWindow": "有匹配位于未渲染的行（查找仅覆盖前 {n} 行）",
			"symbols.filteredEmpty": "当前筛选下没有符号",
			"symbols.outsideWindow": "符号都在未渲染的行里（大纲只覆盖前 {n} 行）",
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
			"fileTooLarge": "File is too large ({size}) for the inline preview",
			"lineCapped": "File is long — only the first {n} of {total} lines are rendered; find and outline cover rendered lines only",
			"linePlain": "{n} line(s) are too long, so syntax highlighting is off for them to keep scrolling responsive (content is intact and still selectable/searchable)",
			"lineNotRendered": "Cannot jump to line {line}: only the first {n} lines are rendered",
			"search.outsideWindow": "Matches exist outside the rendered lines (find covers the first {n} lines only)",
			"symbols.filteredEmpty": "No symbols match the current filter",
			"symbols.outsideWindow": "All symbols are outside the rendered lines (outline covers the first {n} lines)",
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
			const tooLarge = !hasContent && ((largeFile !== undefined && largeFile !== null) || sizeBytes !== undefined);
			const readableSize = formatBytes(sizeBytes);
			const tooLargeSize = readableSize === "" ? "?" : readableSize;
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
			const tokens = react.useMemo(() => (typeof content === "string" ? __cn.tokenizeLines(content, lang) : null), [content, lang]);
			// 完整 content 的真实行数：tokens.length 在 >500KB 截断后偏小，不能再拿来
			// 当「共 N 行」（否则顶栏会报一个截断后的假总数）。只数换行符，不切数组。
			const contentLineCount = react.useMemo(() => {
				if (typeof content !== "string") return 0;
				let count = 1;
				for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) count += 1;
				return count;
			}, [content]);
			// better-sidebar 0.30 的 FileViewerProps 没有 truncated 字段：不能只信宿主。
			// 本插件自己的 500KB 上限由 tokenizeLines 在返回数组上挂非枚举标记，
			// 旧版宿主手传的 props.truncated 继续兼容（G2）。
			const contentTruncated = tokens !== null && tokens.truncated === true;
			const truncated = truncatedProp === true || contentTruncated;
			// 渲染窗口是「能跳转的行号范围」的唯一来源：搜索与大纲都按它裁剪，
			// 否则窗口外的匹配会被计入 n/m、窗口外的符号会出现在列表里却点不动。
			const renderedCount = react.useMemo(
				() => __cn.renderedLineCount(tokens === null ? 0 : tokens.length),
				[tokens]
			);
			// 大纲懒解析：用户从不打开符号列表时不该为整文件 outline 付一次
			// tokenize 的成本（20k 行约 90ms）。第一次打开才把 symReady 置真；
			// 之后列表常驻，cap 提示也就能继续显示。
			const symbols = react.useMemo(() => {
				if (!symReady || tokens === null) return { list: [], capped: false, ready: false, hasSymbols: false };
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
			const matches = react.useMemo(() => {
				if (typeof content !== "string") return [];
				const all = __cn.findMatches(content, deferredQuery, { caseSensitive });
				const visible = __cn.clipZeroBasedToRenderWindow(all, renderedCount);
				if (all.capped === true) Object.defineProperty(visible, "capped", { value: true, enumerable: false });
				return visible;
			}, [content, deferredQuery, caseSensitive, renderedCount]);
			const curIndex = matches.length > 0 ? Math.min(cur, matches.length - 1) : -1;
			// findMatches 只在确实探测到第 N+1 条时标记 capped。
			const matchCapped = matches.capped === true;
			// 计数口径：分母是可导航（裁剪后）条数；命中上限与渲染窗口两个裁剪
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

			/** 闪一段行区间并滚到起始行（引用 chip 落地 / 符号跳转共用）。 */
			const flashLines = (start, end) => {
				setFlashRange({ start: start, end: end });
				if (flashTimer.current !== null) clearTimeout(flashTimer.current);
				flashTimer.current = setTimeout(() => setFlashRange(null), 1600);
				requestAnimationFrame(() => {
					const el = codeRef.current === null ? null : codeRef.current.querySelector('[data-cn-line="' + start + '"]');
					if (el !== null) el.scrollIntoView({ block: "center", behavior: "smooth" });
				});
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
				if (typeof content !== "string") return;
				const key = path + "#" + line + "#" + (lineEnd === undefined || lineEnd === null ? "" : lineEnd);
				if (landedAtRef.current === key) return;
				landedAtRef.current = key;
				const win = __cn.lineWindowState(line, lineEnd, renderedCount);
				if (!win.inWindow) {
					setLineNotice({ line: win.requestedLine, rendered: win.renderedCount });
					return;
				}
				setLineNotice(null);
				flashLines(win.start, win.end);
				if (typeof onLineConsumed === "function") onLineConsumed();
			}, [content, path, line, lineEnd, renderedCount, onLineConsumed]);

			// 当前匹配变化 → 滚动到该匹配（C-3 查找跟随）。
			// 依赖「当前匹配是谁」（start）而不是序号：继续输入收紧查询时几乎总是
			// curIndex 0→0，只依赖序号会让 matches 换了、当前匹配挪了行、视口却
			// 停在旧位置。单匹配时 step() 的序号恒为 0，searchStep 显式再触发一次。
			const currentMatch = curIndex >= 0 ? matches[curIndex] : null;
			const currentLine = currentMatch === null ? -1 : currentMatch.line;
			const currentCol = currentMatch === null ? null : currentMatch.col;
			const currentMatchStart = currentMatch === null ? -1 : currentMatch.start;
			react.useEffect(() => {
				if (curIndex < 0) return;
				const el = codeRef.current === null ? null : codeRef.current.querySelector('[data-cn-cur="1"]');
				if (el !== null) el.scrollIntoView({ block: "center", behavior: "smooth" });
			}, [curIndex, currentMatchStart, searchStep]);

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
				setCur((c) => (c + delta + matches.length) % matches.length);
				// 单匹配 / 同一处再按一次：序号不变也要滚（C-3）
				setSearchStep((n) => n + 1);
			};
			const onQuery = (v) => { setQuery(v); setCur(0); };
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
			// 这样一次查询/步进只重渲有变化的行，而不是 20000 行。
			const rows = react.useMemo(() => {
				if (tokens === null) return [];
				const out = [];
				const maxLines = renderedCount;
				for (let i = 0; i < maxLines; i++) {
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
			}, [tokens, renderedCount, lineMatches, currentLine, currentCol, flashRange]);

			// 有多少行因为过长而关闭了高亮：顶部提示一下，别让用户以为高亮坏了。
			const plainLineCount = react.useMemo(() => {
				if (tokens === null) return 0;
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

			const body = tooLarge
				// 大文件没有正文：给一条可见提示，而不是一个空 <pre>（那会让人以为
				// 文件本来就是空的，还配着一个像能用的查找框）。
				? jsx("div", { className: "cn-warn", role: "status", children: t("fileTooLarge").replace("{size}", tooLargeSize) }, "toolarge")
				: tokens === null
					? jsx("pre", { className: "cn-plain", children: content ?? "" }, "plain")
					: jsxs("div", { className: "cn-code", children: rows }, "code");

			// 计数文案：分母是可导航条数；outsideOnly 不再冒充「无匹配」，
			// 由下面的「窗口外还有匹配」提示说明。
			const matchCounterText = matchState.kind === "empty"
				// 延后的查询值还没追上时别说「无匹配」
				? (deferredQuery.length > 0 ? t("search.noMatch") : "")
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
							jsx("span", { className: "cn-badge", children: langLabel }, "lang")
						]
					}, "head"),
					// 没有正文时（大文件被宿主拦下）这两条工具条都是空转的，收起来；
					// 标题与语言徽标保留，用户仍知道打开的是哪个文件。
					hasContent ? jsxs("div", {
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
					hasContent ? jsxs("div", {
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
					// 500KB 字符上限截断（本插件自己的第二刀）：必须说出来。total 用
					// 完整 content 的真实行数，不能用截断后的 tokens.length；旧宿主
					// 只传 props.truncated 时退回旧文案，兼容语义不变。
					truncated === true
						? jsx("div", { className: "cn-warn", children: contentTruncated ? t("truncatedLines").replace("{total}", String(contentLineCount)).replace("{n}", String(renderedCount)) : t("truncated") }, "truncated")
						: null,
					// 行数超出渲染窗口（20000 行）。字符上限截断时上面那条已经解释了
					// 覆盖范围，不再重复刷两条。
					lineCapped === true && truncated !== true
						? jsx("div", { className: "cn-warn", children: t("lineCapped").replace("{n}", String(renderedCount)).replace("{total}", String(contentLineCount)) }, "linecapped")
						: null,
					// 有超长行被降级为纯文本：说明原因，避免被当成高亮/渲染 bug。
					plainLineCount > 0
						? jsx("div", { className: "cn-warn", role: "status", children: t("linePlain").replace("{n}", String(plainLineCount)) }, "plainline")
						: null,
					// 窗口外的行跳转：说清楚没跳，不闪错误的行、也不消费这一跳。
					lineNotice !== null
						? jsx("div", { className: "cn-warn", role: "status", children: t("lineNotRendered").replace("{line}", String(lineNotice.line)).replace("{n}", String(lineNotice.rendered)) }, "linenotice")
						: null,
					// 命中上限被渲染窗口裁掉：分母只数可导航的，窗口外的事实单独说。
					matchState.outside === true
						? jsx("div", { className: "cn-warn", role: "status", children: t("search.outsideWindow").replace("{n}", String(renderedCount)) }, "outside")
						: null,
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
						// 滚动会挪走锚点（按钮是 position:fixed）→ 直接收起
						onScroll: hideSelPop,
						children: [body]
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
