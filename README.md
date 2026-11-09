# @whybebabo/dsh-code-nav

<div align="center">🌏 <a href="./README_EN.md"><b>English</b></a> · 中文</div>

> **这是 [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) 的 fork。**
> 上游目前未发布到 npm，本 fork 补上了「选中文字 → 添加到对话」（v0.1.2 起）、
> **常见配置文件支持**（v0.2.0 起）、**Protocol Buffers 支持**（v0.3.0 起）、
> **可点击的引用 chip**（v0.4.0 起）与**大文件分块 / 分页预览**（v0.5.0 起），并以
> [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav)
> 发布到 npm（当前版本 **0.5.0**；npm 上此前的最新版是 0.4.0）。
> 差异见下方[**Fork 说明**](#fork-说明)；v0.1.2 的改动已作为 PR
> [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 提交上游。

DSH（DeepSeek Harness）Web 插件 —— **dsh-better-sidebar 代码预览导航**扩展。

在侧边栏打开代码文件时，自动按文件类型识别语言并接管预览，提供：

- 🎨 **按类型语法高亮** —— 扩展名 → 语言识别，轻量自研分词器（注释 / 字符串 / 关键字 / 类型 / 数字 / 函数），深浅色主题自动跟随
- 🧭 **符号大纲切换** —— 解析 class / interface / struct / enum / impl、方法 / 函数、变量 / 字段 / 常量；按「全部 / 类 / 方法 / 变量」筛选，下拉符号列表一键跳转定位（行闪烁，符号行可用 Tab 聚焦 + `Enter` / `Space` 触发）；单次最多列出 500 个符号，到达上限时在代码区上方提示「符号过多，仅列出前 500 个」
- 🔍 **文件内查找** —— 高亮全部匹配、当前匹配强调、`n/m` 计数、↑/↓ 或 `Enter` / `Shift+Enter` 上下跳转、区分大小写开关；按**字面子串**匹配（`.` `*` `(` 等正则元字符就是它自己），最多 2000 条匹配，超出时计数显示为 `2000+`；查找覆盖**整个文件**（≤5 MB 直接在内存正文里搜；>5 MB 后台按页扫描并显示进度），**不必先滚动加载到目标位置** —— 命中行还没加载时按 Enter / 下一个会自动续读到该行再跳过去
- 🖱️ **选中文字 → 添加到对话** —— 在预览里划选任意代码，选区上方浮出「添加到对话」按钮，点击即把选区落成一枚可点击的 **引用 chip**（`引用 文件 L起-止`，与 better-sidebar 0.30 的 quote chip 同形）：输入框里只占一枚 chip，**发送时展开**为 `相对路径:起止行` 围栏代码块（超过 500 字的选区只留路径行）；点击 chip 跳回源文件并闪烁被引行段。宿主没有 chip 通道 / 记录写不进存储时按 better-sidebar 的降级链回退：内置 `reference` chip → 直接插入围栏块
- 🗂️ **常见配置文件支持** —— JSON / YAML / TOML / XML / INI / properties / dotenv 等配置格式同样有高亮与大纲：键、段头、XML 元素与属性分别上色，段头归「类」、键与属性归「变量」，嵌套层级在符号列表里显示为 `键 — 所属段`
- 🧾 **大文件不再 500 KB 截断** —— 预览内容超过首屏预算时按 256 KiB 分块加载（首屏 2 块，滚动近底自动续读，也可「加载更多 / 全部加载」），行号全局连续，默认最多 50,000 行（可点「加载全部（解除上限）」继续加载到文件末尾）；DOM 只保留视口附近的几十行（虚拟滚动，其余用占位高度撑出滚动条），打开 16k 行文件不再卡死；超过宿主 5 MB 内联上限的文件改走 `fs.readPage` 只读分页（128 KiB / 页；宿主把页尾裁到整行，单行超过一页时返回未裁剪窗口，本插件会把连续页拼回同一行），带进度、重试与下载；**查找覆盖全文**（≤5 MB 搜内存正文，>5 MB 后台按页扫描），大纲只覆盖已加载的行并在界面说明

## 前置

- DSH `dsh web` 可正常运行
- 已安装 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar)（含聚合包 `@linxin666/dsh-web-ui-all` 带入的场景）；引用 chip 的点击落地需要 **0.30.0+**（更旧版本仍能落 chip 并正确展开，只是点击不定位行）

## 安装

```sh
dsh plugin --profile web add @whybebabo/dsh-code-nav
```

装完**重启 `dsh web`**（新增 bundle 需 host 侧重载），再硬刷新浏览器（Cmd/Ctrl+Shift+R）。

> 提示：better-sidebar 设置页「侧边卡片」中可看到本插件的预览器开关（代码预览导航 / Code Preview Navigator），关闭即回退到内置 CodeMirror 编辑器。

> ⚠️ **不要与上游 `dsh-code-nav` 同时安装** —— 两者注册同一个预览器 id（`dsh-code-nav:outline`），会互相冲突。

### 升级到新版本

已经装过本插件时，请**指定精确版本**，不要只依赖 `^` 范围（版本号见上方「当前版本」或 `npm view @whybebabo/dsh-code-nav version`）：

```
@whybebabo/dsh-code-nav@0.5.0
```

原因：pnpm 11 的供应链防护默认值 `minimumReleaseAge: 1440` 表示"发布满 24 小时的版本才优先安装"。由于这是**内置默认值**（非显式配置），`minimumReleaseAgeStrict` 默认为 `false` —— pnpm 不会报错，而是退回安装一个"够老"的版本。于是已装 0.1.1 的人再执行 `^0.1.1`，pnpm 会认为 0.1.1 够老、新版本太新，**命令显示成功、版本却停在原地**。

写成精确版本后，范围内只剩一个候选，pnpm 会安装它并把该版本记入 `minimumReleaseAgeExclude`。或者等新版本发布满 24 小时后再用 `^` 升级。

> 从 0.1.x 升到 0.2.0 是**纯新增**：只多了配置格式的识别与上色，代码文件的既有行为不变。
>
> 0.2.1 是**修复版**：样式标签改用完整包名标记（`data-plugin`），
> 修掉卸载 / 热替换后 `<style>` 残留导致的界面串味 —— 详见下方 Fork 说明表的最后两行。
>
> 0.2.2 是**修复 + 加固版**（不加新功能，主要是把「看着对、实际错」的坑堵掉，另外把原本静默生效的限制说清楚）：
> Vue / Svelte 的多个 `<script>` 块（`<script>` + `<script setup>`）现在都会被解析且行号正确；
> 大小写不敏感查找的行列坐标不再错位（含 `İ` 这类 `toLowerCase()` 后长度变化的字符）；
> JSON 大纲的键会还原 `\n` `\"` `\uXXXX` 转义；查找 / 大纲的静默上限（2000 条匹配、500 个符号）
> 现在会在界面上说明；符号行改为键盘可达；构建内联改用函数形式替换，修掉源码里的 `$&`
> 被当成替换模式而**静默改写产物**的问题。详见[**开发**](#开发)与[**已知限制**](#已知限制)。
>
> 0.3.0 是**新增语言版**：支持 Protocol Buffers（`.proto`，proto2 / proto3）——
> message / enum / oneof / service / extend 连同嵌套层级进大纲，rpc 成方法、
> 字段（含 `optional` / `repeated` / `required` 标签与 `map<...>`）与枚举值成变量；
> proto2 的 `group` 组体挂在组名下；`.foo.Bar` 这类全限定名也识别。
> 详见下方[**支持的语言**](#支持的语言)。
>
> 0.4.0 是**引用 chip 版**：「添加到对话」不再把整段围栏块塞进输入框，而是落成
> 一枚与 better-sidebar 0.30 同形的引用 chip（`引用 文件 L起-止`）——输入框保持
> 紧凑，**发送时**才展开成同一段围栏块（载荷逐字节不变）；点击 chip 跳回源文件并
> 闪烁被引行段。引用数据直接存在 chip 自己的 ref 里（`cnq1:` + JSON），**不写 storage**，
> 刷新 / 换标签页 / 清空站点数据都不会把 chip 变死；宿主没有 chip 通道（旧版 DSH /
> 没有 `inputTriggers`）时回退到本插件自带的纯文本 chip，再回退为直接插入围栏块，
> 能力不丢失。
>
> 0.5.0 是**大文件版**：不再受 500 KB 限制 —— ≤5 MB 按 **256 KiB** 分块加载（首屏
> 2 块，滚动近底自动续读），>5 MB 走宿主 `fs.readPage` 只读分页（**128 KiB / 页**，
> 单行超过一页时把连续页拼回整行），行号全局连续；DOM 只挂视口附近的行（虚拟滚动，
> 视口外按行高占位），8k+ 行文件打开/滚动不再卡死；查找覆盖**整个文件**（≤5 MB 搜
> 内存正文，>5 MB 后台按页扫描，64 MB 预算），命中行未加载时按 Enter / 下一个会自动
> 续读再跳转；默认 **50,000 行**软上限可点「加载全部（解除上限）」读到文件末尾；
> 超长单行（>8,000 字符或 >500 段）关闭逐 token 高亮以保证滚动流畅。同时修复分页
> 长行拼接、跨块分词状态、Kotlin `enum class`、上限解除入口、冻结输入框插入等
> 正确性问题。

## Fork 说明

**来源**：[AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav)（上游，MIT），fork 基线 commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27)。本 fork 仓库：[whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav)。

**为什么 fork**：上游以 `priority: 10` 注册预览器，`.ts` 等扩展名被它接管后，内置 `TextEditor` 不再挂载 —— 而 better-sidebar 的「选中文字 → 添加到对话」浮层只实现在 `TextEditor` 内部，`betterSidebar` 服务面也没有任何选区 / 浮层 / 草稿 API，导致这些文件直接失去该能力。上游暂无此功能，且有本地使用需求。

**相对上游的差异**（v0.1.2 的改动即 PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 的内容；v0.2.0 追加配置文件支持；v0.2.1 修样式归属；v0.2.2 修正确性并加固构建/发布链路；v0.3.0 新增 Protocol Buffers；v0.4.0 引用 chip 可点击；v0.5.0 大文件分块 / 分页预览）：

| 项 | 上游 `dsh-code-nav@0.1.0` | 本 fork `@whybebabo/dsh-code-nav@0.5.0` |
|---|---|---|
| 选中文字 → 添加到对话 | ❌ 无（接管后该能力消失） | ✅ 选区上方浮层按钮 → 会话输入框里落成一枚引用 chip |
| 草稿形态 | — | 与 better-sidebar 0.30 同形：`引用 文件 L起-止` 的紧凑 chip；点击跳回源文件并闪烁被引行段 |
| 插入载荷 | — | 发送时由 codec 展开为 `相对路径:起止行` 围栏块（与内置查看器逐字节相同）；>500 字只留路径行 |
| 行号精度 | — | 取自行容器 + 逐行代码列，`user-select:none` 的行号槽不会混入；终点落在下一行行首时区间自动收窄 |
| 插入实现 | — | 自有 `@` input-trigger source（`codeNavQuote`）+ codec + `insertReference()`；宿主没有 chip 通道 / ref 解析失败时回退本插件自带的纯文本 chip（`codeNavQuoteText`），再回退官方 `insertText()`，旧版宿主回退 `setDraft` |
| 浮层关闭 | — | 沿用 better-sidebar 的关闭契约：外部点击 / Esc / 页面隐藏 / 失焦 / 滚动 / 面板离开视口 |
| 配置文件支持 | ❌ 无（json / yaml / toml / xml 等落到内置查看器，无高亮与大纲） | ✅ JSON / YAML / TOML / XML / INI / properties / dotenv 的高亮 + 结构大纲 |
| 新增语言 | ❌ 无 `.proto` | ✅ Protocol Buffers（`.proto`）高亮 + 大纲：message / enum / oneof / 字段 / service / rpc / extend |
| 大文件预览 | ❌ 500 KB 后截断 | ✅ ≤5 MB 按 256 KiB 分块、>5 MB 走 `fs.readPage` 只读分页；虚拟滚动只挂视口附近行；查找覆盖整个文件；50,000 行软上限可解除 |
| 大纲 / 查找的正确性 | — | Vue / Svelte 多个 `<script>` 块都解析且行号回加原文坐标；大小写不敏感匹配的行列位置用原文坐标（`toLowerCase()` 后长度变化的字符不再错位）；JSON 键还原 `\uXXXX` 等转义；查找覆盖整个文件（≤5 MB 内存正文 / >5 MB 后台按页扫描，扫描预算 64 MB），上限（默认加载 50,000 行、可手动解除 / 2000 条匹配 / 500 个符号）在界面上说明 |
| 包名 | `dsh-code-nav` | `@whybebabo/dsh-code-nav`（避免占用上游名称） |
| 版本 | 0.1.0（未发布 npm） | 0.4.x（发布到 npm；版本号以 `package.json` 为准） |
| 构建产物 id | 硬编码 `dsh-code-nav` | 由 `scripts/build.mjs` 从 `package.json` 注入，改名不再漂移；构建期校验顶层重名 / 残留 import / 导出面 / 产物逐行等于源码 |
| `<style>` 归属标记 | — | 以**完整包名**标记 `data-plugin`（v0.2.1 修）：client-modules 卸载 / 热替换时按包名回收样式，短名会让 `<style>` 残留、界面串味 |
| 其余（高亮 / 大纲 / 查找） | 同上 | **无差异**，与上游一致 |


## 支持的语言

| 家族 | 扩展名 |
|---|---|
| JavaScript / TypeScript | `.js` `.mjs` `.cjs` `.ts` `.jsx` `.tsx` |
| Python | `.py` |
| Java / C# | `.java` `.cs` |
| C / C++ | `.c` `.h` `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` |
| Go / Rust | `.go` `.rs` |
| PHP / Ruby | `.php` `.rb` |
| Swift / Kotlin | `.swift` `.kt` `.kts` |
| Lua / Shell | `.lua` `.sh` `.bash` `.zsh` |
| Vue / Svelte | `.vue` `.svelte`（取各个 `<script>` 块解析：`<script>` 与 `<script setup>` 同时存在时都会列出符号，行号回加原文件坐标） |
| SQL | `.sql`（表 / 视图 / 函数等结构对象） |
| Protobuf | `.proto`（message / enum / 枚举值 / oneof / 字段 / service / rpc / extend 都进大纲） |
| JSON | `.json` `.jsonc` `.json5` `.jsonl` `.ndjson` `.geojson` `.webmanifest` `.har` |
| YAML | `.yaml` `.yml` |
| TOML | `.toml` |
| XML | `.xml` `.xsd` `.xsl` `.xslt` `.plist` `.csproj` `.vbproj` `.fsproj` `.props` `.targets` `.resx` `.nuspec` `.wsdl` `.xaml` |
| INI | `.ini` `.cfg` `.conf` `.service` `.desktop`，以及点文件 `.editorconfig` `.gitconfig` `.npmrc` |
| Java properties / dotenv | `.properties`、`.env` |

**配置格式的大纲语义**：段头 / XML 元素归「类」筛选，键 / XML 属性归「变量」筛选，嵌套层级在符号列表里显示为 `键 — 所属段`。JSON 的键按文档结构扫描（注释与字符串里的假键不计入），YAML 只认「冒号后接空白」的映射，TOML 的段头按绝对路径（`[a.b]` 不会挂到上一个段下）。

**有意不收 HTML / SVG**：前者归内置 HTML 预览、后者归图片预览，而本预览器 `priority` 高于它们 —— 收进来会把「渲染预览」降级成源码视图。

非代码文件（markdown / images / pdf 等）仍由 better-sidebar 内置查看器处理，不受影响。

## 开发

```sh
npm run build          # = node scripts/build.mjs，把 src/*.js 内联进 lib/client.js
npm run check          # = node --check lib/client.js && node --check lib/index.js
npm test               # = 上面两项 + node --test（自动发现并跑 test/ 下全部测试文件）
npm run release        # 发布演练（--dry-run，不写 git、不发网络请求）
```

`lib/client.js` 是**产物**，改了 `src/**` 或 `scripts/client.template.js` 都必须重新 `npm run build`，
否则单测里的「产物 == 源码」逐字比对会失败（CI 同样会失败）。无第三方依赖，全程只用 node。
`test/` 下是纯逻辑单测（395 例：分词 + 各语言大纲 + 配置格式 + 查找 + 全文扫描 + 渲染窗口 + 虚拟滚动窗口 + 文件分块 + 选区载荷 + 草稿坐标 + 引用 chip 运行时 + 视图派生状态 + 构建/发布校验），
其中一例会数 `test/` 下所有测试文件的 `test()` 数量并与两份 README 对齐 —— 加测试却忘改文档会直接失败。

- `src/lang-registry.js` —— 扩展名映射 + 语言元数据（关键字 / 注释语法 / 字符串引号 / 配置格式的上色指令）
- `src/properties-key.js` —— Java properties 的键扫描与反转义规则（大纲与高亮**共用同一套**，避免两者口径漂移）
- `src/tokenize.js` —— 跨行状态机分词器（块注释、Python 三引号、C# 逐字字符串、XML CDATA、转义；配置键 / 段头 / XML 元素与属性上色）
- `src/config-outline.js` —— 配置格式的结构大纲（JSON 文档扫描器 + YAML / TOML / INI / properties / dotenv / XML 提取器）
- `src/outline.js` —— 括号深度 / 缩进驱动的大纲解析（Allman 大括号换行风格已支持；Vue / Svelte 抽各 `<script>` 块并回加行偏移；符号上限 500 在此裁剪）
- `src/search.js` —— 文件内查找（字面子串匹配，位置一律为原文坐标）与 token×匹配区间合并渲染；匹配上限 2000；分页态的增量扫描累加与进度/预算计算（`appendScannedMatches` / `scanProgress`）
- `src/render-window.js` —— 渲染窗口（客户端传入 50,000 行预览上限、可手动解除；纯函数默认 20,000 仅作兜底）：搜索与大纲共用同一裁剪口径，保证「能列出来的都能跳过去」
- `src/file-chunks.js` —— 分块加载（256 KiB / 块）：按整行切块、行号全局连续、超长单行跳过分词；分页态把 `fs.readPage` 的页归一成同样的形状，**跨页半行会拼回同一行**
- `src/virtual-rows.js` —— 虚拟滚动窗口：只把视口附近的行挂进 DOM，其余行用上下占位高度撑出同样的滚动高度；行号 → scrollTop 的跳转定位也在这里
- `src/selection.js` —— 选区 → 草稿载荷（`相对路径:起止行` 围栏块 / chip 标签 / 剪贴板投影；超长选区只留路径行）
- `src/draft-coords.js` —— 草稿两个投影的纯换算：clipboard → detect（每个引用 chip 折成 U+FFFC）与插入点前的分隔空格判定
- `scripts/client.template.js` —— React 预览组件模板（构建时注入纯模块；含选区浮层、引用 chip 的 input-trigger source / 自包含 ref 编解码 / 落地闪烁）
- `scripts/build.mjs` —— 内联构建 + 四道构建期校验：顶层重名（后者静默覆盖前者）、剥不掉的 import/export（内联后语法错误）、导出面与模板用量对不上、以及**产物逐行含有源码内容**（内联必须用函数形式的 `replace` —— 字符串形式会把替换文本里的 `$&`、`` $` `` 当特殊模式展开，静默改写产物却仍能通过语法检查）
- `scripts/release-config.mjs` —— 发布脚本共享的仓库 / 版本 / 产物名派生（一律取自 `package.json`，避免写死上游）、tag / 资产的幂等判定、`readGithubToken()`

## 发布与 CI

```sh
node scripts/release-code-nav.mjs --dry-run   # 只打印计划（含产物新鲜度），不写 git、不发请求
node scripts/release-code-nav.mjs --yes       # 真正发布：建仓(如缺) → push → tag → release → 上传 tgz
node scripts/release-code-nav.mjs --yes --notes-file release-notes/v0.5.0.md
                                             # Release 正文来自该 Markdown；标题取首个标题行
                                             # （可用 --title 覆盖），已存在的 Release 会同步更新
node scripts/pr-better-sidebar.mjs --dry-run  # 上游 PR 流程演练（取 token / clone / commit / push 之前就会退出）
node scripts/repo-topics.mjs [topic...]       # 合并式设置本仓库 topics（目标仓库同样从 package.json 派生）
```

不带 `--dry-run` / `--yes` 的裸命令只会打印用法并 `exit 1`：`--yes` 是 live 发布的唯一开关（仓库不存在时会新建公开仓库，所以必须先看清计划）。

安全边界（都写在脚本里、并由单测钉住）：目标仓库 / 版本 / tag / 产物名一律从 `package.json` 派生；
live 发布在取 token、push、打 tag 之前会先跑完整单测，并校验**工作区 `lib/client.js` 与产物里的一致**
（tarball 的 `package/lib/client.js` 必须等于当前源码构建结果，版本必须等于 `package.json`）——「pack
之后又改了代码」会在这一步失败，而不是把旧包传上去；
已存在的 tag 若指向别的 commit 则**拒绝推送**，不覆盖、不强推、不 `git reset --hard`；
release 资产按 digest 判定 skip / replace，重复执行不会失败；GitHub token 经 `git credential fill`
进程内获取，**只留在内存、不写日志、不落盘**（取不到时只报「无法从 git 凭据助手取到 GitHub token」，
不回显 git 的错误对象）。

`.github/workflows/ci.yml` 在 push / PR 上跑：`node scripts/build.mjs` → `node --check lib/client.js` →
单测（`npm test`，含入口 `lib/index.js` 的语法检查与 `node --test` 全量测试）→
`node scripts/verify-pack.mjs`（打包内容非空、必需文件齐全）→ `git diff --exit-code -- lib/client.js`
（产物必须已提交且与源码一致）→ `npm pack` + 发布演练。

> `lib/client.js` 的注册 id 由 `scripts/build.mjs` 从 `package.json` 的 `name` 注入 —— client-modules 以**完整包名**作 module table key，改名后必须重新构建，否则浏览器端会报 `loaded without registering "<id>"`。

## 已知限制

- 高亮与大纲为轻量正则 / 手写扫描解析，非编译器级精度（复杂泛型、宏、模板元编程等场景可能漏检/误检）
- 接管代码预览为**只读**；需要编辑时可在 better-sidebar 设置中关闭本插件回退内置编辑器
- 「添加到对话」按会话 cwd 取相对路径；纯文本兜底视图（无行号行容器）不带行号
- 新 chip 的引用数据存在 chip 自己的 ref 里（`cnq1:` + JSON：路径 / 行段 / 展示标签 / 打开位置），**不写 localStorage**：刷新、换标签页、清空站点数据都不会让新 chip 失效。只有旧版本留下的 `q…` 记录仍从 `dsh-code-nav:quote-refs`（只读）解析，清空站点数据后这些旧 chip 会失效 —— 点击会提示重新划选，发送会被宿主拦下，不会静默发出错误文本
- 点击 chip 的「跳回 + 行段闪烁」需要 better-sidebar 0.30.0+ 把 `line` / `lineEnd` 交给预览器；更旧的 better-sidebar 仍能落 chip 并正确展开，只是点击只能打开文件、不定位行。宿主完全没有 chip 通道（无 `inputTriggers`）时按降级链回退：本插件自带的纯文本 chip（`codeNavQuoteText`，仍是一枚紧凑 chip、发送时原样展开）→ 直接插入围栏块
- 单文件正文由 better-sidebar 的 5 MB 内联上限决定，但本插件不再受 **500 KB** 限制：
  - **≤ 5 MB**：宿主给出正文，本插件按 **256 KiB** 分块加载（首屏 2 块；滚动近底、或点 footer 的「加载更多 / 全部加载」续读），行号全局连续，默认最多 **50,000 行**（软上限；可点「加载全部（解除上限）」继续读到文件末尾）
  - **> 5 MB**：宿主只传 `largeFile`（没有正文），本插件通过 `ctx.betterSidebar.hostRouteUrl('sidebar/api/fs.readPage')` 只读分页（每页 **128 KiB**；宿主把页尾裁到整行，单行超过一页时返回未裁剪窗口，本插件会把连续页拼回同一行），footer 提供已加载行数 / 加载更多 / 全部加载 / 重试 / 下载，说明行右侧也有「全部加载」按钮，一次读完整个文件（解除默认的 50,000 行预览上限）；宿主没有 `hostRouteUrl`（更旧版本）时仍回退为「无法内联预览」提示
- 查找覆盖**整个文件**，不必先滚动加载到目标位置：
  - **≤ 5 MB**：正文本来就在客户端，直接搜完整正文，`n/m` 是全文计数；命中行还没加载时按 Enter / 下一个会自动逐块续读并跳过去（只是输入查询不会自动续读，避免每敲一个字符读一轮）。
  - **> 5 MB**：正文不在客户端，查找会在**后台按页扫描**整个文件（每页 128 KiB，带进度），命中随扫描增长；扫描预算 **64 MB**，超出时界面说明「只扫描了前 64 MB」。换查询 / 换文件会取消上一轮扫描。
  - 预览上限 **50,000 行**之外的命中只计数、不可跳转，界面单独提示并提供「加载全部（解除上限）」按钮：点一下就把剩余行读完（分页态逐页读、带进度），这些命中随即变成可跳转的。
- 大纲只覆盖**已加载**的行（顶部会说明），加载上限 50,000 行同样会在界面提示。跨行注释 / 字符串状态会**跨分块边界传递**（块边界不会重置）；Vue / Svelte 的 `<script>` 在累计已加载内容 ≤500 KB 时整体重分词，更大的 SFC 退回逐块分词（第二块起 `<script>` 内可能不着色，但行号、查找与引用不受影响）
- 已加载的行只有**视口附近**的会真正挂进 DOM（虚拟滚动，视口外按行高补齐占位）：这不是省内存的优化，而是不卡死的必要条件 —— 桌面端把一个 8,148 行的 C++ 文件全部挂进 DOM 时，宿主一次样式重算要 ~10 秒（十几万元素 × 上百张宿主样式表），表现就是「打开大文件直接卡死」。滚动条长度、行号、跳转与「全部渲染」完全一致；代价是原生划选跨过窗口边界时会在边缘断开，选中后「添加到对话」仍按行号精确取文本，查找 / 大纲 / 引用跳转会先把目标行滚进窗口再闪烁
- 单行过长（超过 **8,000 字符**或 **500 个高亮片段**）的行会关闭逐 token 语法高亮、按纯文本显示（内容完整、可选中 / 可查找，跳转与闪烁仍定位到该行）：一行里塞进上万个 `<span>` 会让浏览器布局/绘制卡死（实测 928 KB 单行 JSON = 54,508 个片段，Chromium 首帧都不出现）
- 四条上限都会在界面上说出来：单文件默认加载 **50,000 行**（footer 提示已加载行数，达到上限时提供「加载全部（解除上限）」按钮；解除后内存/分词时间随行数增长），全文扫描最多 **64 MB**（字节预算用尽时提示只扫描了前 64 MB；命中先到 2,000 条时改为提示达到计数上限），查找最多 **2,000 条**匹配（计数显示为 `2000+`），大纲最多 **500 个**符号（提示「符号过多，仅列出前 500 个」）
- 查找是**字面子串**匹配，不是正则：`.` `*` `(` `\` 都是它们自己，没有正则语法可学、也不会因括号不配对报错。代价是不支持模式匹配
- 大纲名字有 80 字符上限（代码与配置格式一致）：超出视为误匹配，不进列表，避免把一整行「名字」塞进侧栏
- Vue / Svelte 高亮按各个 `<script>` 块内的 JS/TS 处理，模板部分不高亮；多个 `<script>`（如 `<script>` + `<script setup>`）都会解析，符号行号回加到原文件坐标
- 配置格式只做**语法级**解析：JSON 不校验 schema、YAML 不展开锚点 / 别名与多行折叠（但保留 anchor / tag 所在的容器关系）、XML 不解析命名空间语义与 DTD；同名键会各自成条（不做去重）
- JSON 注释（jsonc）与 TOML / YAML 的高级语法按「宽容识别」处理，展示优先于严格校验 —— 故意写坏的文件不会报错，只是大纲可能少几条
- 除已列出的配置扩展名外，其余配置类文件（`.htaccess`、`.gitignore`、无扩展名的 `Makefile` 等）仍走内置查看器
- 上游若合并了 [PR #1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 并发布，建议改用上游包；本 fork 会继续跟进上游更新

## 许可

MIT（继承上游）。上游版权归 [AnakinCao](https://github.com/AnakinCao) 所有，本 fork 的改动同样以 MIT 发布。

## License

MIT
