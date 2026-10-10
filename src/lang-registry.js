/**
 * dsh-code-nav — 语言注册表（纯函数，浏览器/node 通用）。
 *
 * 共享作用域约定：本文件与 tokenize.js / outline.js / search.js 由
 * scripts/build.mjs 按依赖顺序拼接内联进 lib/client.js（去掉 export 前缀），
 * 故模块间直接引用彼此声明，不写 import 语句。
 */

/** 扩展名（小写、无点）→ 语言 id。 */
export const LANG_EXT = {
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
export function langOf(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return null;
  return LANG_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** 语言元数据：标签、注释语法、字符串引号、关键字、内建类型、额外高亮规则。 */
export const LANG_META = {
  javascript: {
    label: "JavaScript",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await null true false undefined NaN Infinity".split(" "),
    types: "Array BigInt Boolean Date Error Function Map Number Object Promise Proxy RegExp Set String Symbol WeakMap WeakSet JSON Math Intl ArrayBuffer DataView Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array".split(" ")
  },
  typescript: {
    label: "TypeScript",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace module satisfies keyof infer is as asserts unknown never null true false undefined NaN".split(" "),
    types: "any boolean number string symbol object bigint void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit Exclude Extract ReturnType Parameters ConstructorParameters Awaited".split(" ")
  },
  jsx: {
    label: "JSX",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await null true false undefined NaN".split(" "),
    types: "Array Boolean Date Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math".split(" ")
  },
  tsx: {
    label: "TSX",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
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
    strings: ["'", '"', "R\""],
    keywords: "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq".split(" "),
    types: "string vector map unordered_map set unordered_set list deque queue stack pair tuple optional variant any shared_ptr unique_ptr weak_ptr string_view size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t ostream istream fstream ifstream ofstream".split(" ")
  },
  go: {
    label: "Go",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false iota nil".split(" "),
    types: "int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune string error any comparable".split(" ")
  },
  rust: {
    label: "Rust",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "r\""],
    keywords: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while".split(" "),
    types: "u8 u16 u32 u64 u128 i8 i16 i32 i64 i128 f32 f64 usize isize bool char str String Vec Option Some None Result Ok Err Box Rc Arc HashMap HashSet VecDeque BTreeMap BTreeSet Cow".split(" ")
  },
  php: {
    label: "PHP",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"'],
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
    keywords: "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript super switch throws try typealias var weak where async await actor some any guard defer repeat case default break continue fallthrough return if else for while do in is as true false nil Self".split(" "),
    types: "Int Int8 Int16 Int32 Int64 UInt UInt8 UInt16 UInt32 UInt64 Float Double Bool String Character Array Dictionary Set Optional Error Result Void Any AnyObject".split(" ")
  },
  kotlin: {
    label: "Kotlin",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "\"\"\""],
    keywords: "as as? break class continue do else false for fun if in !in interface is !is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg".split(" "),
    types: "Int Long Short Byte Double Float Boolean Char String Any Unit Nothing Array List MutableList Map MutableMap Set MutableSet Pair Triple Result".split(" ")
  },
  lua: {
    label: "Lua",
    lineComment: "--", blockComment: ["--[[", "]]"],
    strings: ["'", '"'],
    keywords: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" "),
    types: "string number boolean table function thread userdata nil".split(" ")
  },
  shell: {
    label: "Shell",
    lineComment: "#", blockComment: null,
    strings: ["'", '"', "`"],
    keywords: "if then else elif fi case esac for while until do done function in select time coproc declare typeset local export readonly unset set shift source return break continue exit trap echo printf read test true false".split(" "),
    types: []
  },
  vue: {
    label: "Vue",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace null true false undefined NaN".split(" "),
    types: "any boolean number string symbol object void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit".split(" ")
  },
  svelte: {
    label: "Svelte",
    lineComment: "//", blockComment: ["/*", "*/"],
    strings: ["'", '"', "`"],
    keywords: "break case catch class const continue debugger default delete do else enum export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await interface type implements declare abstract readonly namespace null true false undefined NaN".split(" "),
    types: "any boolean number string symbol object void never unknown Array Boolean Error Function Map Number Object Promise RegExp Set String Symbol WeakMap WeakSet JSON Math Record Partial Required Readonly Pick Omit".split(" ")
  },
  sql: {
    label: "SQL",
    lineComment: "--", blockComment: ["/*", "*/"],
    strings: ["'", '"'],
    keywords: "select from where insert into values update set delete create table view index alter drop truncate join inner left right full outer on group by order having limit offset union all distinct as asc desc and or not null primary key foreign references unique check default constraint begin commit rollback transaction case when then else end exists in like between is cast".split(" "),
    types: "int integer bigint smallint tinyint numeric decimal float real double money char varchar nvarchar text ntext binary varbinary bit date datetime timestamp time boolean json xml".split(" ")
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
    keySep: ":", keyColonSpace: true
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
    keyBare: "properties"      // 无分隔符时整行即键（`key\:part`、行尾续行反斜杠的 `a\`）
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
    multilineStrings: true
  }
};

/** 语言 id → 标签（未知语言兜底）。 */
export function langLabel(lang) {
  const meta = LANG_META[lang];
  return meta ? meta.label : (lang ?? "Text");
}

/** 是否为已知代码语言（有高亮元数据）。 */
export function isCodeLang(lang) {
  return lang != null && Object.prototype.hasOwnProperty.call(LANG_META, lang);
}
