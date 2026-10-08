# @whybebabo/dsh-code-nav

<div align="center">🌏 <a href="./README_EN.md"><b>English</b></a> · 中文</div>

> **这是 [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) 的 fork。**
> 上游目前未发布到 npm，本 fork 补上了「选中文字 → 添加到对话」并发布为
> [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav)（v0.1.1）。
> 差异见下方[**Fork 说明**](#fork-说明)；改动已作为 PR
> [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 提交上游。

DSH（DeepSeek Harness）Web 插件 —— **dsh-better-sidebar 代码预览导航**扩展。

在侧边栏打开代码文件时，自动按文件类型识别语言并接管预览，提供：

- 🎨 **按类型语法高亮** —— 扩展名 → 语言识别，轻量自研分词器（注释 / 字符串 / 关键字 / 类型 / 数字 / 函数），深浅色主题自动跟随
- 🧭 **符号大纲切换** —— 解析 class / interface / struct / enum / impl、方法 / 函数、变量 / 字段 / 常量；按「全部 / 类 / 方法 / 变量」筛选，下拉符号列表一键跳转定位（行闪烁）
- 🔍 **文件内查找** —— 高亮全部匹配、当前匹配强调、`n/m` 计数、↑/↓ 或 `Enter` / `Shift+Enter` 上下跳转、区分大小写开关
- 🖱️ **选中文字 → 添加到对话** —— 在预览里划选任意代码，选区上方浮出「添加到对话」按钮，点击即把选中内容按 `相对路径:起止行` 围栏代码块插进当前会话输入框（与 better-sidebar 内置查看器同一载荷形状；超过 500 字的选区只插路径行）

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

## Fork 说明

**来源**：[AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav)（上游，MIT），fork 基线 commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27)。本 fork 仓库：[whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav)。

**为什么 fork**：上游以 `priority: 10` 注册预览器，`.ts` 等扩展名被它接管后，内置 `TextEditor` 不再挂载 —— 而 better-sidebar 的「选中文字 → 添加到对话」浮层只实现在 `TextEditor` 内部，`betterSidebar` 服务面也没有任何选区 / 浮层 / 草稿 API，导致这些文件直接失去该能力。上游暂无此功能，且有本地使用需求。

**相对上游的差异**（v0.1.1，即 PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 的内容）：

| 项 | 上游 `dsh-code-nav@0.1.0` | 本 fork `@whybebabo/dsh-code-nav@0.1.1` |
|---|---|---|
| 选中文字 → 添加到对话 | ❌ 无（接管后该能力消失） | ✅ 选区上方浮层按钮 → 插入会话输入框 |
| 插入载荷 | — | 与 better-sidebar 内置查看器同形状：`相对路径:起止行` 围栏块；>500 字只插路径行 |
| 行号精度 | — | 取自行容器 + 逐行代码列，`user-select:none` 的行号槽不会混入；终点落在下一行行首时区间自动收窄 |
| 插入实现 | — | 优先官方 `captureInsertion()` / `insertText()`（一次可撤销、保留引用 chip、输入框忙时拒插且不动草稿），旧版宿主回退 `setDraft` |
| 浮层关闭 | — | 沿用 better-sidebar 的关闭契约：外部点击 / Esc / 页面隐藏 / 失焦 / 滚动 / 面板离开视口 |
| 包名 | `dsh-code-nav` | `@whybebabo/dsh-code-nav`（避免占用上游名称） |
| 版本 | 0.1.0（未发布 npm） | 0.1.1（已发布 npm） |
| 构建产物 id | 硬编码 `dsh-code-nav` | 由 `scripts/build.mjs` 从 `package.json` 注入，改名不再漂移 |
| 其余（高亮 / 大纲 / 查找 / 语言表） | 同上 | **无差异**，与上游一致 |


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
| Vue / Svelte | `.vue`（取 `<script>` 块解析，行号偏移正确）`.svelte` |
| SQL | `.sql`（表 / 视图 / 函数等结构对象） |

非代码文件（markdown / html / 图片 / pdf 等）仍由 better-sidebar 内置查看器处理，不受影响。

## 开发

```sh
node test/code-nav.test.mjs   # 纯逻辑单测（28 例：分词 + 各语言大纲 + 查找 + 选区载荷）
node scripts/build.mjs        # 把 src/*.js 内联进 lib/client.js（无第三方 bundler）
node --check lib/client.js    # 语法校验
```

- `src/lang-registry.js` —— 扩展名映射 + 语言元数据（关键字 / 注释语法 / 字符串引号）
- `src/tokenize.js` —— 跨行状态机分词器（块注释、Python 三引号、C# 逐字字符串、转义）
- `src/outline.js` —— 括号深度 / 缩进驱动的大纲解析（Allman 大括号换行风格已支持）
- `src/search.js` —— 文件内查找与 token×匹配区间合并渲染
- `src/selection.js` —— 选区 → 草稿载荷（`相对路径:起止行` 围栏块；超长选区只留路径行）
- `scripts/client.template.js` —— React 预览组件模板（构建时注入纯模块；含选区浮层与草稿插入）

> `lib/client.js` 的注册 id 由 `scripts/build.mjs` 从 `package.json` 的 `name` 注入 —— client-modules 以**完整包名**作 module table key，改名后必须重新构建，否则浏览器端会报 `loaded without registering "<id>"`。

## 已知限制

- 高亮与大纲为轻量正则解析，非编译器级精度（复杂泛型、宏、模板元编程等场景可能漏检/误检）
- 接管代码预览为**只读**；需要编辑时可在 better-sidebar 设置中关闭本插件回退内置编辑器
- 「添加到对话」按会话 cwd 取相对路径；纯文本兜底视图（500KB 截断时无行号行容器）不带行号
- 单文件内容上限 500KB（与宿主截断一致，超出显示提示）
- Vue / Svelte 高亮按 `<script>` 内 JS/TS 处理，模板部分不高亮
- 上游若合并了 [PR #1](https://github.com/AnakinCao/dsh-code-nav/pull/1) 并发布，建议改用上游包；本 fork 会继续跟进上游更新

## 许可

MIT（继承上游）。上游版权归 [AnakinCao](https://github.com/AnakinCao) 所有，本 fork 的改动同样以 MIT 发布。

## License

MIT
