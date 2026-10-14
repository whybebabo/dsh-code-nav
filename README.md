# @whybebabo/dsh-code-nav

<div align="center">🌏 <a href="./README_EN.md"><b>English</b></a> · 中文</div>

> **这是 [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) 的 fork。**
> 上游目前未发布到 npm，本 fork 补上了「选中文字 → 添加到对话」（v0.1.2 起）、
> **常见配置文件支持**（v0.2.0 起）与 **Protocol Buffers 支持**（v0.3.0 起），并以
> [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav)
> 发布到 npm（当前版本 **0.3.0**）。
> 差异见下方[**Fork 说明**](#fork-说明)；v0.1.2 的改动已作为 PR
> [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 提交上游。

DSH（DeepSeek Harness）Web 插件 —— **dsh-better-sidebar 代码预览导航**扩展。

在侧边栏打开代码文件时，自动按文件类型识别语言并接管预览，提供：

- 🎨 **按类型语法高亮** —— 扩展名 → 语言识别，轻量自研分词器（注释 / 字符串 / 关键字 / 类型 / 数字 / 函数），深浅色主题自动跟随
- 🧭 **符号大纲切换** —— 解析 class / interface / struct / enum / impl、方法 / 函数、变量 / 字段 / 常量；按「全部 / 类 / 方法 / 变量」筛选，下拉符号列表一键跳转定位（行闪烁，符号行可用 Tab 聚焦 + `Enter` / `Space` 触发）；单次最多列出 500 个符号，到达上限时在代码区上方提示「符号过多，仅列出前 500 个」
- 🔍 **文件内查找** —— 高亮全部匹配、当前匹配强调、`n/m` 计数、↑/↓ 或 `Enter` / `Shift+Enter` 上下跳转、区分大小写开关；按**字面子串**匹配（`.` `*` `(` 等正则元字符就是它自己），最多 2000 条匹配，超出时计数显示为 `2000+`
- 🖱️ **选中文字 → 添加到对话** —— 在预览里划选任意代码，选区上方浮出「添加到对话」按钮，点击即把选中内容按 `相对路径:起止行` 围栏代码块插进当前会话输入框（与 better-sidebar 内置查看器同一载荷形状；超过 500 字的选区只插路径行）
- 🗂️ **常见配置文件支持** —— JSON / YAML / TOML / XML / INI / properties / dotenv 等配置格式同样有高亮与大纲：键、段头、XML 元素与属性分别上色，段头归「类」、键与属性归「变量」，嵌套层级在符号列表里显示为 `键 — 所属段`

## 前置

- DSH `dsh web` 可正常运行
- 已安装 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar)（含聚合包 `@linxin666/dsh-web-ui-all` 带入的场景）

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
@whybebabo/dsh-code-nav@0.3.0
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

## Fork 说明

**来源**：[AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav)（上游，MIT），fork 基线 commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27)。本 fork 仓库：[whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav)。

**为什么 fork**：上游以 `priority: 10` 注册预览器，`.ts` 等扩展名被它接管后，内置 `TextEditor` 不再挂载 —— 而 better-sidebar 的「选中文字 → 添加到对话」浮层只实现在 `TextEditor` 内部，`betterSidebar` 服务面也没有任何选区 / 浮层 / 草稿 API，导致这些文件直接失去该能力。上游暂无此功能，且有本地使用需求。

**相对上游的差异**（v0.1.2 的改动即 PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 的内容；v0.2.0 追加配置文件支持；v0.2.1 修样式归属；v0.2.2 修正确性并加固构建/发布链路；v0.3.0 新增 Protocol Buffers）：

| 项 | 上游 `dsh-code-nav@0.1.0` | 本 fork `@whybebabo/dsh-code-nav@0.3.0` |
|---|---|---|
| 选中文字 → 添加到对话 | ❌ 无（接管后该能力消失） | ✅ 选区上方浮层按钮 → 插入会话输入框 |
| 插入载荷 | — | 与 better-sidebar 内置查看器同形状：`相对路径:起止行` 围栏块；>500 字只插路径行 |
| 行号精度 | — | 取自行容器 + 逐行代码列，`user-select:none` 的行号槽不会混入；终点落在下一行行首时区间自动收窄 |
| 插入实现 | — | 优先官方 `captureInsertion()` / `insertText()`（一次可撤销、保留引用 chip、输入框忙时拒插且不动草稿），旧版宿主回退 `setDraft` |
| 浮层关闭 | — | 沿用 better-sidebar 的关闭契约：外部点击 / Esc / 页面隐藏 / 失焦 / 滚动 / 面板离开视口 |
| 配置文件支持 | ❌ 无（json / yaml / toml / xml 等落到内置查看器，无高亮与大纲） | ✅ JSON / YAML / TOML / XML / INI / properties / dotenv 的高亮 + 结构大纲 |
| 新增语言 | ❌ 无 `.proto` | ✅ Protocol Buffers（`.proto`）高亮 + 大纲：message / enum / oneof / 字段 / service / rpc / extend |
| 大纲 / 查找的正确性 | — | Vue / Svelte 多个 `<script>` 块都解析且行号回加原文坐标；大小写不敏感匹配的行列位置用原文坐标（`toLowerCase()` 后长度变化的字符不再错位）；JSON 键还原 `\uXXXX` 等转义；静默上限（2000 条匹配 / 500 个符号）在界面上说明 |
| 包名 | `dsh-code-nav` | `@whybebabo/dsh-code-nav`（避免占用上游名称） |
| 版本 | 0.1.0（未发布 npm） | 0.3.x（已发布 npm，见 `package.json`） |
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
npm test              # = node --check lib/client.js && node test/code-nav.test.mjs
npm run release       # 发布演练（--dry-run，不写 git、不发网络请求）
```

`lib/client.js` 是**产物**，改了 `src/**` 或 `scripts/client.template.js` 都必须重新 `npm run build`，
否则单测里的「产物 == 源码」逐字比对会失败（CI 同样会失败）。无第三方依赖，全程只用 node。
`test/code-nav.test.mjs` 是纯逻辑单测（117 例：分词 + 各语言大纲 + 配置格式 + 查找 + 渲染窗口 + 选区载荷 + 构建校验 + 发布脚本派生 + 样式归属），
其中一例会数本文件的 `test()` 数量并与两份 README 对齐 —— 加测试却忘改文档会直接失败。

- `src/lang-registry.js` —— 扩展名映射 + 语言元数据（关键字 / 注释语法 / 字符串引号 / 配置格式的上色指令）
- `src/properties-key.js` —— Java properties 的键扫描与反转义规则（大纲与高亮**共用同一套**，避免两者口径漂移）
- `src/tokenize.js` —— 跨行状态机分词器（块注释、Python 三引号、C# 逐字字符串、XML CDATA、转义；配置键 / 段头 / XML 元素与属性上色）
- `src/config-outline.js` —— 配置格式的结构大纲（JSON 文档扫描器 + YAML / TOML / INI / properties / dotenv / XML 提取器）
- `src/outline.js` —— 括号深度 / 缩进驱动的大纲解析（Allman 大括号换行风格已支持；Vue / Svelte 抽各 `<script>` 块并回加行偏移；符号上限 500 在此裁剪）
- `src/search.js` —— 文件内查找（字面子串匹配，位置一律为原文坐标）与 token×匹配区间合并渲染；匹配上限 2000
- `src/render-window.js` —— 渲染窗口（20,000 行上限）：搜索与大纲共用同一裁剪口径，保证「能列出来的都能跳过去」
- `src/selection.js` —— 选区 → 草稿载荷（`相对路径:起止行` 围栏块；超长选区只留路径行）
- `scripts/client.template.js` —— React 预览组件模板（构建时注入纯模块；含选区浮层与草稿插入）
- `scripts/build.mjs` —— 内联构建 + 四道构建期校验：顶层重名（后者静默覆盖前者）、剥不掉的 import/export（内联后语法错误）、导出面与模板用量对不上、以及**产物逐行含有源码内容**（内联必须用函数形式的 `replace` —— 字符串形式会把替换文本里的 `$&`、`` $` `` 当特殊模式展开，静默改写产物却仍能通过语法检查）
- `scripts/release-config.mjs` —— 发布脚本共享的仓库 / 版本 / 产物名派生（一律取自 `package.json`，避免写死上游）、tag / 资产的幂等判定、`readGithubToken()`

## 发布与 CI

```sh
node scripts/release-code-nav.mjs --dry-run   # 只打印计划：目标仓库 / tag / 产物，不写 git 不发请求
node scripts/release-code-nav.mjs             # 建仓(如缺) → push → tag → release → 上传 tgz
node scripts/release-code-nav.mjs --yes       # 允许在仓库不存在时新建（远端 404 也可能是「存在但 token 看不到」）
node scripts/pr-better-sidebar.mjs --dry-run  # 上游 PR 流程演练（取 token / clone / commit / push 之前就会退出）
node scripts/repo-topics.mjs [topic...]       # 合并式设置本仓库 topics（目标仓库同样从 package.json 派生）
```

安全边界（都写在脚本里、并由单测钉住）：目标仓库 / 版本 / tag / 产物名一律从 `package.json` 派生；
已存在的 tag 若指向别的 commit 则**拒绝推送**，不覆盖、不强推、不 `git reset --hard`；
release 资产按 digest 判定 skip / replace，重复执行不会失败；GitHub token 经 `git credential fill`
进程内获取，**只留在内存、不写日志、不落盘**（取不到时只报「无法从 git 凭据助手取到 GitHub token」，
不回显 git 的错误对象）。

`.github/workflows/ci.yml` 在 push / PR 上跑：`node scripts/build.mjs` → `node --check lib/client.js` →
单测 → `git diff --exit-code -- lib/client.js`（产物必须已提交且与源码一致）→ `npm pack` + 发布演练。

> `lib/client.js` 的注册 id 由 `scripts/build.mjs` 从 `package.json` 的 `name` 注入 —— client-modules 以**完整包名**作 module table key，改名后必须重新构建，否则浏览器端会报 `loaded without registering "<id>"`。

## 已知限制

- 高亮与大纲为轻量正则 / 手写扫描解析，非编译器级精度（复杂泛型、宏、模板元编程等场景可能漏检/误检）
- 接管代码预览为**只读**；需要编辑时可在 better-sidebar 设置中关闭本插件回退内置编辑器
- 「添加到对话」按会话 cwd 取相对路径；纯文本兜底视图（500KB 截断时无行号行容器）不带行号
- 单文件内容上限 500KB（与宿主截断一致，超出显示提示）
- 单文件最多渲染前 **20,000 行**（DOM 规模保护）。超出时查找与大纲**只覆盖已渲染的行**并在顶部提示 —— 窗口外的匹配不计入 `n/m`、窗口外的符号不进列表，故不会出现「数得到却跳不过去」的错位
- 另有两个静默上限，都会在界面上说出来：查找最多 **2,000 条**匹配（计数显示为 `2000+`），大纲最多 **500 个**符号（提示「符号过多，仅列出前 500 个」）
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
