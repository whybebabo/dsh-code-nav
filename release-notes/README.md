# Release notes

每个 GitHub Release 的正文源文件放在这里，文件名就是 tag：`vX.Y.Z.md`。

发布时把对应文件交给发布脚本：

```bash
node scripts/release-code-nav.mjs --yes --notes-file release-notes/vX.Y.Z.md
```

- 正文第一行的 Markdown 标题（例如 `## v0.5.0 — 大文件预览…`）会作为 Release 标题；需要覆盖时加 `--title`。
- 已存在的 Release 会同步更新正文与标题（重跑发布脚本不会留下旧正文）。
- 没有传 `--notes-file` 时脚本仍生成一份最小正文（安装 / 产物 / 验证），但正式版本建议总是提供本目录下的说明，保持与 better-workspace 一致的完整中英双语格式。
- 发布说明按版本记录：亮点、行为变化、验证结果（测试数量、产物 md5 / 大小）、安装命令，以及完整的 English 段落。
