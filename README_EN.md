# @whybebabo/dsh-code-nav

> **This is a fork of [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav).**
> Upstream is not published to npm; this fork adds "selection → add to conversation"
> (since v0.1.2) and **common config-file support** (since v0.2.0), published to npm as
> [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav)
> (current version **0.2.2**).
> See [**Fork notes**](#fork-notes) below; the v0.1.2 change is open upstream as PR
> [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1).

DSH (DeepSeek Harness) web plugin — **code preview navigator** for [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar).

When you open a code file in the sidebar, it detects the language by file type and takes over the preview with:

- 🎨 **Per-language syntax highlighting** — extension → language detection with a lightweight hand-rolled tokenizer (comments / strings / keywords / types / numbers / functions); light & dark palettes follow the app theme automatically
- 🧭 **Symbol outline navigation** — parses `class` / `interface` / `struct` / `enum` / `impl`, methods / functions, variables / fields / constants; filter by **All / Class / Method / Variable** chips, or jump from a dropdown symbol list (line flash on jump; symbol rows are keyboard reachable via Tab + `Enter` / `Space`); at most 500 symbols per file, with a notice above the code when the list is capped
- 🔍 **In-file search** — highlights all matches, emphasizes the current one, shows `n/m` count, navigates with ↑/↓ buttons or `Enter` / `Shift+Enter`, with a match-case toggle; matches **literal substrings** (`.`, `*`, `(` are just themselves), up to 2000 matches, shown as `2000+` once capped
- 🖱️ **Selection → add to conversation** — select code in the preview and an "Add to conversation" button floats above the selection; clicking it inserts the selection into the current session's composer as a fenced block headed by `relative/path:start[-end]` (the same payload shape as the better-sidebar built-in viewers; selections over 500 characters insert the path line only)
- 🗂️ **Common config formats** — JSON / YAML / TOML / XML / INI / properties / dotenv get highlighting and a structural outline too: keys, section headers, XML elements and XML attributes are coloured separately, section headers group under **Class** while keys and attributes group under **Variable**, and nesting shows as `key — container` in the symbol list

## Prerequisites

- DSH (`dsh web`) running
- [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) installed (including the bundled scenario via the aggregate package `@linxin666/dsh-web-ui-all`)

## Install

```sh
dsh plugin --profile web add @whybebabo/dsh-code-nav
```

This plugin is **web-only** (`dsh.profile.client.platform` is `web`). Use the `web`
profile: the `desktop` profile is owned exclusively by the Electron app and rejects
the CLI (`error: profile "desktop" is managed exclusively by the Electron application`).

Then **restart `dsh web`** (a new bundle needs a host-side reload) and **hard-refresh** the browser (Cmd/Ctrl+Shift+R).

> The plugin shows up as an enable/disable card in the better-sidebar settings ("Code Preview Navigator"); disabling it falls back to the built-in CodeMirror editor.

> ⚠️ **Do not install alongside the upstream `dsh-code-nav`** — both register the same viewer id (`dsh-code-nav:outline`) and will conflict.

### Upgrading an existing install

Name an **exact** version instead of relying only on the `^` range (take the number from the banner above, or `npm view @whybebabo/dsh-code-nav version`):

```
@whybebabo/dsh-code-nav@0.2.2
```

pnpm 11's supply-chain guard defaults to `minimumReleaseAge: 1440`, i.e. only versions published at least 24 hours ago are preferred. Because that is a **built-in default** rather than an explicit setting, `minimumReleaseAgeStrict` defaults to `false`: pnpm does not fail, it falls back to a version old enough to satisfy the age gate. So with `^0.1.1` still recorded, installing again resolves 0.1.1 (mature) over a newer release (too new) and **reports success while the installed version never changes**.

Naming an exact version leaves a single candidate in range, which pnpm installs and records in `minimumReleaseAgeExclude`. Alternatively, wait 24 hours after a release before upgrading with a `^` range.

> Going from 0.1.x to 0.2.0 is **purely additive**: config-format detection and colouring only; existing behaviour for code files is unchanged.
>
> 0.2.1 is a **fix release**: the style tag is now keyed by the full package name
> (`data-plugin`), fixing a leaked `<style>` after uninstall / hot-replace that made
> the UI pick up stale styling — see the last-but-one row of the fork table below.
>
> 0.2.2 is a **correctness + hardening release** (no new features; it removes cases that
> looked right but were wrong, and states limits that used to apply silently): Vue / Svelte
> files with several `<script>` blocks
> (`<script>` plus `<script setup>`) are now all parsed with correct line numbers;
> case-insensitive search reports original-text coordinates, so characters whose
> lowercase form changes UTF-16 length (`İ`) no longer shift the results; JSON outline
> keys are unescaped (`\n`, `\"`, `\uXXXX`); the silent caps (2000 matches, 500 symbols)
> are now stated in the UI; symbol rows are keyboard reachable; and the build inlines
> with function-form replacement, fixing source containing `$&` being **silently
> rewritten** in the produced bundle. See [Development](#development) and
> [Known limitations](#known-limitations).

## Fork notes

**Origin**: [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) (upstream, MIT), fork baseline commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27). This fork lives at [whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav).

**Why fork**: upstream registers its viewer with `priority: 10`, so for the extensions it handles the built-in `TextEditor` never mounts — and better-sidebar's "selection → add to conversation" popup lives inside `TextEditor` only, while the `betterSidebar` service exposes no selection / popup / draft API at all. Those files therefore lose the capability outright. Upstream has no such feature and there was a local need for it.

**Differences from upstream** (v0.1.2 is the content of PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1); v0.2.0 adds config-file support; v0.2.1 fixes style ownership; v0.2.2 fixes correctness and hardens the build / release pipeline):

| | upstream `dsh-code-nav@0.1.0` | this fork `@whybebabo/dsh-code-nav@0.2.2` |
|---|---|---|
| Selection → add to conversation | ❌ absent (lost once the viewer takes over) | ✅ floating button above the selection → inserts into the composer |
| Insert payload | — | same shape as the built-in viewers: fenced block headed by `relative/path:start[-end]`; >500 chars inserts the path line only |
| Line accuracy | — | read from the line containers plus the per-line code column, so the `user-select: none` gutter never leaks in; a selection ending exactly at the next line start narrows the span |
| Insert mechanism | — | prefers the official `captureInsertion()` / `insertText()` (one undo step, reference chips preserved, refuses without touching the draft while the composer is busy); falls back to `setDraft` on older hosts |
| Popup dismissal | — | same contract as better-sidebar: outside mousedown / Escape / hidden document / blur / scroll / surface leaving the viewport |
| Config-file support | ❌ none (json / yaml / toml / xml … fall to the built-in viewer, no highlighting or outline) | ✅ highlighting + structural outline for JSON / YAML / TOML / XML / INI / properties / dotenv |
| Outline / search correctness | — | every `<script>` block of a Vue / Svelte file is parsed with line numbers mapped back to the original file; case-insensitive matches report original-text coordinates (characters whose lowercase form changes length no longer shift positions); JSON keys are unescaped (`\uXXXX` etc.); the silent caps (2000 matches / 500 symbols) are surfaced in the UI |
| Package name | `dsh-code-nav` | `@whybebabo/dsh-code-nav` (avoids claiming the upstream name) |
| Version | 0.1.0 (not on npm) | 0.2.x (published to npm; see `package.json`) |
| Built artifact id | hardcoded `dsh-code-nav` | injected by `scripts/build.mjs` from `package.json`, so a rename cannot drift; the build also checks top-level name collisions, un-stripped import/export, the export surface vs. template usage, and that the artifact contains every source line verbatim |
| `<style>` ownership tag | — | keyed by the **full package name** in `data-plugin` (fixed in v0.2.1): client-modules reclaims styles by package name on uninstall / hot-replace, so a short name leaks the `<style>` and stale styling bleeds into the UI |
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
| Vue / Svelte | `.vue` `.svelte` (every `<script>` block is parsed — `<script>` together with `<script setup>` lists symbols from both, with line numbers mapped back to the original file) |
| SQL | `.sql` (tables / views / functions etc.) |
| JSON | `.json` `.jsonc` `.json5` `.jsonl` `.ndjson` `.geojson` `.webmanifest` `.har` |
| YAML | `.yaml` `.yml` |
| TOML | `.toml` |
| XML | `.xml` `.xsd` `.xsl` `.xslt` `.plist` `.csproj` `.vbproj` `.fsproj` `.props` `.targets` `.resx` `.nuspec` `.wsdl` `.xaml` |
| INI | `.ini` `.cfg` `.conf` `.service` `.desktop`, plus the dotfiles `.editorconfig` `.gitconfig` `.npmrc` |
| Java properties / dotenv | `.properties`, `.env` |

**Outline semantics for config formats**: section headers and XML elements group under **Class**, keys and XML attributes under **Variable**, and nesting renders as `key — container` in the symbol list. JSON keys are scanned from the document structure (fake keys inside comments or strings are ignored), YAML only treats a colon followed by whitespace as a mapping, and TOML headers are absolute paths (`[a.b]` is never nested under the previous header).

**HTML / SVG are deliberately excluded**: html belongs to the built-in HTML preview and svg to the image preview, and this viewer has a higher `priority` than both — claiming them would downgrade a rendered preview into a source view.

Non-code files (markdown / images / pdf …) keep using the built-in viewers.

## Development

```sh
npm run build           # = node scripts/build.mjs, inlines src/*.js into lib/client.js
npm test               # = node --check lib/client.js && node test/code-nav.test.mjs
npm run release        # release rehearsal (--dry-run: no git writes, no network requests)
```

`lib/client.js` is a **generated artifact**: after touching `src/**` or `scripts/client.template.js`
you must re-run `npm run build`, otherwise the unit test that compares the committed bundle
byte-for-byte against a fresh build fails (so does CI). There are no third-party dependencies —
everything is plain node. `test/code-nav.test.mjs` holds the pure-logic unit tests (111 cases: tokenizer + per-language outline + config formats + search + render window + selection payload + build guards + release-script derivation + style ownership); one of them counts the `test()` declarations in that file and compares them with both READMEs, so adding a test and forgetting to update the docs fails loudly.

- `src/lang-registry.js` — extension map + language metadata (keywords / comment syntax / string quotes / config colouring directives)
- `src/properties-key.js` — Java properties key scanning + unescaping rules (shared by outline **and** highlighting so the two cannot drift apart)
- `src/tokenize.js` — cross-line state-machine tokenizer (block comments, Python triple quotes, C# verbatim strings, XML CDATA, escapes; config key / section / XML element + attribute colouring)
- `src/config-outline.js` — structural outline for config formats (JSON document scanner + YAML / TOML / INI / properties / dotenv / XML extractors)
- `src/outline.js` — brace-depth / indent driven outline parser (Allman brace-on-next-line style supported; Vue / Svelte extract every `<script>` block and re-add line offsets; the 500-symbol cap is applied here)
- `src/search.js` — in-file matching (literal substrings, positions always in original-text coordinates) + token×match span merging; 2000-match cap
- `src/render-window.js` — render window (20,000-line cap): find and outline share one clipping rule, so everything listed is jumpable
- `src/selection.js` — selection → draft payload (`relative/path:start[-end]` fence; over-long selections keep the path line only)
- `scripts/client.template.js` — React preview component template (pure modules injected at build time; owns the selection popup and the draft insert)
- `scripts/build.mjs` — the inliner plus four build-time checks: top-level name collisions (the later declaration silently wins), import/export the stripper cannot remove (a syntax error once inlined), export surface vs. `__cn.*` usage in the template, and **every source line present verbatim in the artifact** — inlining must use function-form `replace`, because the string form expands `$&` / `` $` `` / `$'` inside the replacement text and rewrites the artifact while still passing `node --check`
- `scripts/release-config.mjs` — repo / version / asset-name derivation shared by the release scripts (always from `package.json`, never hardcoded), idempotent tag / asset decisions, and `readGithubToken()`

## Release and CI

```sh
node scripts/release-code-nav.mjs --dry-run   # print the plan only: repo / tag / artifact, no git writes, no requests
node scripts/release-code-nav.mjs             # create repo (if missing) → push → tag → release → upload tgz
node scripts/release-code-nav.mjs --yes       # allow creating the repo when it does not exist (a 404 can also mean "exists, token cannot see it")
node scripts/pr-better-sidebar.mjs --dry-run  # rehearse the upstream PR flow (exits before token / clone / commit / push)
node scripts/repo-topics.mjs [topic...]       # merge-style topics for this repo (target repo likewise derived from package.json)
```

Safety boundaries (implemented in the scripts and pinned by unit tests): the target repo / version /
tag / asset name are always derived from `package.json`; an existing tag pointing at another commit is
**refused** — nothing is overwritten, force-pushed or `git reset --hard`-ed; release assets are decided
by digest (skip vs. replace) so re-running a publish never fails; the GitHub token is fetched
in-process through `git credential fill` and is **kept in memory only — never logged, never written to
disk** (on failure you get "unable to obtain a GitHub token from the git credential helper", never a
dumped git error object).

`.github/workflows/ci.yml` runs on push / PR: `node scripts/build.mjs` → `node --check lib/client.js` →
the unit tests → `git diff --exit-code -- lib/client.js` (the artifact must be committed and in sync
with the sources) → `npm pack` + the release rehearsal.

> The registration id in `lib/client.js` is injected by `scripts/build.mjs` from the `name` in `package.json` — client-modules keys its module table by the **full package name**, so a rename must be followed by a rebuild or the browser reports `loaded without registering "<id>"`.

## Known limitations

- Highlighting and outline are lightweight regex / hand-written scanners, not compiler-grade (complex generics, macros, template metaprogramming may be missed or misdetected)
- Preview takeover is **read-only**; disable the plugin in better-sidebar settings to get the built-in editor back
- "Add to conversation" resolves the path relative to the session cwd; the plain-text fallback view (no line containers, e.g. a 500KB-truncated file) carries no line numbers
- Single-file content cap 500KB (matches host truncation; a notice is shown beyond it)
- At most the first **20,000 lines** of a file are rendered (DOM-size guard). Beyond that, find and outline cover **only the rendered lines** and a notice is shown at the top — matches outside the window are not counted in `n/m` and their symbols are not listed, so nothing is ever reported that cannot be jumped to
- Two further caps are also stated in the UI: search returns at most **2,000** matches (the counter shows `2000+`) and the outline lists at most **500** symbols ("Too many symbols — listing the first 500")
- Search matches **literal substrings**, not regular expressions: `.`, `*`, `(`, `\` are themselves, so there is nothing to learn and no unbalanced-parenthesis error — the trade-off is no pattern matching
- Outline names are capped at 80 characters (code and config formats alike): longer candidates are treated as misparses and dropped, so a whole line can never be rendered as a "name"
- Vue / Svelte highlight the JS/TS inside each `<script>` block; template sections are not highlighted. Several blocks in one file (`<script>` plus `<script setup>`) are all parsed, with symbol lines mapped back to the original file
- Config parsing is **syntax-level only**: JSON is not schema-validated, YAML does not expand anchors / aliases or folded scalars (but the container relationship at an anchor / tag is preserved), XML does not interpret namespace semantics or DTDs; duplicate keys each get their own entry (no deduplication)
- JSON comments (jsonc) and advanced TOML / YAML syntax are read leniently — display wins over strict validation, so a deliberately broken file never errors, it may just yield fewer outline entries
- Config files outside the listed extensions (`.htaccess`, `.gitignore`, extension-less `Makefile`, …) still go to the built-in viewer
- If upstream merges [PR #1](https://github.com/AnakinCao/dsh-code-nav/pull/1) and publishes, prefer the upstream package; this fork will keep tracking upstream

## License

MIT (inherited). Upstream copyright belongs to [AnakinCao](https://github.com/AnakinCao); this fork's changes are released under the same MIT terms.
