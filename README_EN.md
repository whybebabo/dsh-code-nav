# @whybebabo/dsh-code-nav

> **This is a fork of [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav).**
> Upstream is not published to npm; this fork adds "selection → add to conversation"
> and is published as [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav) (v0.1.2).
> See [**Fork notes**](#fork-notes) below for the differences; the change is open
> upstream as PR [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1).

DSH (DeepSeek Harness) web plugin — **code preview navigator** for [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar).

When you open a code file in the sidebar, it detects the language by file type and takes over the preview with:

- 🎨 **Per-language syntax highlighting** — extension → language detection with a lightweight hand-rolled tokenizer (comments / strings / keywords / types / numbers / functions); light & dark palettes follow the app theme automatically
- 🧭 **Symbol outline navigation** — parses `class` / `interface` / `struct` / `enum` / `impl`, methods / functions, variables / fields / constants; filter by **All / Class / Method / Variable** chips, or jump from a dropdown symbol list (line flash on jump)
- 🔍 **In-file search** — highlights all matches, emphasizes the current one, shows `n/m` count, navigates with ↑/↓ buttons or `Enter` / `Shift+Enter`, with a match-case toggle
- 🖱️ **Selection → add to conversation** — select code in the preview and an "Add to conversation" button floats above the selection; clicking it inserts the selection into the current session's composer as a fenced block headed by `relative/path:start[-end]` (the same payload shape as the better-sidebar built-in viewers; selections over 500 characters insert the path line only)

## Prerequisites

- DSH (`dsh web`) running
- [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) installed (including the bundled scenario via the aggregate package `@linxin666/dsh-web-ui-all`)

## Install

```sh
dsh plugin --profile web add @whybebabo/dsh-code-nav
```

(Replace `web` with the profile you actually run.)

Then **restart `dsh web`** (a new bundle needs a host-side reload) and **hard-refresh** the browser (Cmd/Ctrl+Shift+R).

> The plugin shows up as an enable/disable card in the better-sidebar settings ("Code Preview Navigator"); disabling it falls back to the built-in CodeMirror editor.

> ⚠️ **Do not install alongside the upstream `dsh-code-nav`** — both register the same viewer id (`dsh-code-nav:outline`) and will conflict.

### Upgrading an existing install

Name an **exact** version instead of relying only on the `^` range:

```
@whybebabo/dsh-code-nav@0.1.2
```

pnpm 11's supply-chain guard defaults to `minimumReleaseAge: 1440`, i.e. only versions published at least 24 hours ago are preferred. Because that is a **built-in default** rather than an explicit setting, `minimumReleaseAgeStrict` defaults to `false`: pnpm does not fail, it falls back to a version old enough to satisfy the age gate. So with `^0.1.1` still recorded, installing again resolves 0.1.1 (mature) over 0.1.2 (too new) and **reports success while the installed version never changes**.

Naming an exact version leaves a single candidate in range, which pnpm installs and records in `minimumReleaseAgeExclude`. Alternatively, wait 24 hours after a release before upgrading with a `^` range.

## Fork notes

**Origin**: [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) (upstream, MIT), fork baseline commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27). This fork lives at [whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav).

**Why fork**: upstream registers its viewer with `priority: 10`, so for the extensions it handles the built-in `TextEditor` never mounts — and better-sidebar's "selection → add to conversation" popup lives inside `TextEditor` only, while the `betterSidebar` service exposes no selection / popup / draft API at all. Those files therefore lose the capability outright. Upstream has no such feature and there was a local need for it.

**Differences from upstream** (v0.1.2, i.e. the content of PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1)):

| | upstream `dsh-code-nav@0.1.0` | this fork `@whybebabo/dsh-code-nav@0.1.2` |
|---|---|---|
| Selection → add to conversation | ❌ absent (lost once the viewer takes over) | ✅ floating button above the selection → inserts into the composer |
| Insert payload | — | same shape as the built-in viewers: fenced block headed by `relative/path:start[-end]`; >500 chars inserts the path line only |
| Line accuracy | — | read from the line containers plus the per-line code column, so the `user-select: none` gutter never leaks in; a selection ending exactly at the next line start narrows the span |
| Insert mechanism | — | prefers the official `captureInsertion()` / `insertText()` (one undo step, reference chips preserved, refuses without touching the draft while the composer is busy); falls back to `setDraft` on older hosts |
| Popup dismissal | — | same contract as better-sidebar: outside mousedown / Escape / hidden document / blur / scroll / surface leaving the viewport |
| Package name | `dsh-code-nav` | `@whybebabo/dsh-code-nav` (avoids claiming the upstream name) |
| Version | 0.1.0 (not on npm) | 0.1.2 (published to npm) |
| Built artifact id | hardcoded `dsh-code-nav` | injected by `scripts/build.mjs` from `package.json`, so a rename cannot drift |
| Everything else (highlighting / outline / search / language table) | as above | **no difference from upstream** |


## Supported languages

| Family | Extensions |
|---|---|
| JavaScript / TypeScript | `.js` `.mjs` `.cjs` `.ts` `.jsx` `.tsx` |
| Python | `.py` |
| Java / C# | `.java` `.cs` |
| C / C++ | `.c` `.h` `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` |
| Go / Rust | `.go` `.rs` |
| PHP / Ruby | `.php` `.rb` |
| Swift / Kotlin | `.swift` `.kt` `.kts` |
| Lua / Shell | `.lua` `.sh` `.bash` `.zsh` |
| Vue / Svelte | `.vue` (parses the `<script>` block, line offsets preserved) `.svelte` |
| SQL | `.sql` (tables / views / functions etc.) |

Non-code files (markdown / html / images / pdf …) keep using the built-in viewers.

## Development

```sh
node test/code-nav.test.mjs   # unit tests (28 cases: tokenizer + per-language outline + search + selection payload)
node scripts/build.mjs        # inlines src/*.js into lib/client.js (no third-party bundler)
node --check lib/client.js    # syntax check
```

- `src/lang-registry.js` — extension map + language metadata (keywords / comment syntax / string quotes)
- `src/tokenize.js` — cross-line state-machine tokenizer (block comments, Python triple quotes, C# verbatim strings, escapes)
- `src/outline.js` — brace-depth / indent driven outline parser (Allman brace-on-next-line style supported)
- `src/search.js` — in-file match finder + token×match span merging
- `src/selection.js` — selection → draft payload (`relative/path:start[-end]` fence; over-long selections keep the path line only)
- `scripts/client.template.js` — React preview component template (pure modules injected at build time; owns the selection popup and the draft insert)

> The registration id in `lib/client.js` is injected by `scripts/build.mjs` from the `name` in `package.json` — client-modules keys its module table by the **full package name**, so a rename must be followed by a rebuild or the browser reports `loaded without registering "<id>"`.

## Known limitations

- Highlighting and outline are lightweight regex parsing, not compiler-grade (complex generics, macros, template metaprogramming may be missed or misdetected)
- Preview takeover is **read-only**; disable the plugin in better-sidebar settings to get the built-in editor back
- "Add to conversation" resolves the path relative to the session cwd; the plain-text fallback view (no line containers, e.g. a 500KB-truncated file) carries no line numbers
- Single-file content cap 500KB (matches host truncation; a notice is shown beyond it)
- Vue / Svelte highlight the `<script>` block as JS/TS; template sections are not highlighted
- If upstream merges [PR #1](https://github.com/AnakinCao/dsh-code-nav/pull/1) and publishes, prefer the upstream package; this fork will keep tracking upstream

## License

MIT (inherited). Upstream copyright belongs to [AnakinCao](https://github.com/AnakinCao); this fork's changes are released under the same MIT terms.
