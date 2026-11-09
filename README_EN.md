# @whybebabo/dsh-code-nav

> **This is a fork of [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav).**
> Upstream is not published to npm; this fork adds "selection → add to conversation"
> (since v0.1.2), **common config-file support** (since v0.2.0), **Protocol Buffers
> support** (since v0.3.0), a **clickable quote chip** (since v0.4.0) and **chunked /
> paged large-file preview** (since v0.5.0), published to npm as
> [`@whybebabo/dsh-code-nav`](https://www.npmjs.com/package/@whybebabo/dsh-code-nav)
> (current version **0.5.0**; the previous registry version is 0.4.0).
> See [**Fork notes**](#fork-notes) below; the v0.1.2 change is open upstream as PR
> [AnakinCao/dsh-code-nav#1](https://github.com/AnakinCao/dsh-code-nav/pull/1).

DSH (DeepSeek Harness) web plugin — **code preview navigator** for [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar).

When you open a code file in the sidebar, it detects the language by file type and takes over the preview with:

- 🎨 **Per-language syntax highlighting** — extension → language detection with a lightweight hand-rolled tokenizer (comments / strings / keywords / types / numbers / functions); light & dark palettes follow the app theme automatically
- 🧭 **Symbol outline navigation** — parses `class` / `interface` / `struct` / `enum` / `impl`, methods / functions, variables / fields / constants; filter by **All / Class / Method / Variable** chips, or jump from a dropdown symbol list (line flash on jump; symbol rows are keyboard reachable via Tab + `Enter` / `Space`); at most 500 symbols per file, with a notice above the code when the list is capped
- 🔍 **In-file search** — highlights all matches, emphasizes the current one, shows `n/m` count, navigates with ↑/↓ buttons or `Enter` / `Shift+Enter`, with a match-case toggle; matches **literal substrings** (`.`, `*`, `(` are just themselves), up to 2000 matches, shown as `2000+` once capped; search covers the **whole file** (≤5 MB searches the in-memory content directly; >5 MB scans pages in the background with progress), so **you no longer have to scroll a match into memory first** — pressing Enter / Next on a match that is not loaded yet reads chunks until it is, then jumps there
- 🖱️ **Selection → add to conversation** — select code in the preview and an "Add to conversation" button floats above the selection; clicking it drops a clickable **quote chip** (`Quote <file> Lstart[-end]`, the same shape as the better-sidebar 0.30 quote chip) into the composer: the draft stays compact and the chip **expands on send** into a fenced block headed by `relative/path:start[-end]` (selections over 500 characters keep the path line only); clicking the chip jumps back to the source file and flashes the quoted lines. Hosts without a chip channel (or an unwritable record store) fall back along the better-sidebar chain: built-in `reference` chip → inserting the fenced block directly
- 🗂️ **Common config formats** — JSON / YAML / TOML / XML / INI / properties / dotenv get highlighting and a structural outline too: keys, section headers, XML elements and XML attributes are coloured separately, section headers group under **Class** while keys and attributes group under **Variable**, and nesting shows as `key — container` in the symbol list
- 🧾 **No more 500 KB truncation** — content beyond the first-paint budget is loaded in 256 KiB chunks (two chunks on first paint, more on scroll near the bottom or via **Load more / Load all**), with file-global line numbers and up to 50,000 lines by default (a **Load all (lift cap)** button reads the rest); only the rows near the viewport are actually mounted (virtual scrolling, the rest is spacer height), so opening a 16k-line file no longer freezes; files above the host's 5 MB inline limit switch to read-only paging through `fs.readPage` (128 KiB pages, normally trimmed to whole lines; a line longer than a page is stitched back together) with progress, retry and download; **search covers the whole file** (≤5 MB searches the in-memory text, >5 MB scans pages in the background) while the outline covers loaded lines and says so in the UI

## Prerequisites

- DSH (`dsh web`) running
- [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) installed (including the bundled scenario via the aggregate package `@linxin666/dsh-web-ui-all`); the quote chip's click-through needs **0.30.0+** (older versions still get the chip and the correct expansion, but a click does not land on the lines)

## Install

```sh
dsh plugin --profile web add @whybebabo/dsh-code-nav
```

Then **restart `dsh web`** (a new bundle needs a host-side reload) and **hard-refresh** the browser (Cmd/Ctrl+Shift+R).

> The plugin shows up as an enable/disable card in the better-sidebar settings ("Code Preview Navigator"); disabling it falls back to the built-in CodeMirror editor.

> ⚠️ **Do not install alongside the upstream `dsh-code-nav`** — both register the same viewer id (`dsh-code-nav:outline`) and will conflict.

### Upgrading an existing install

Name an **exact** version instead of relying only on the `^` range (take the number from the banner above, or `npm view @whybebabo/dsh-code-nav version`):

```
@whybebabo/dsh-code-nav@0.5.0
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
>
> 0.3.0 is a **new-language release**: Protocol Buffers (`.proto`, proto2 / proto3) —
> message / enum / oneof / service / extend and their nesting reach the outline, rpc
> entries become methods, fields (including `optional` / `repeated` / `required`
> labels and `map<...>`) and enum values become variables; proto2 `group` bodies nest
> under the group name; fully-qualified names like `.foo.Bar` are recognised.
> See [Supported languages](#supported-languages) below.
>
> 0.4.0 is the **quote-chip release**: "Add to conversation" no longer dumps the whole
> fenced block into the composer. It drops a quote chip shaped like the better-sidebar
> 0.30 one (`Quote <file> Lstart[-end]`), so the draft stays compact and the chip
> **expands on send** into the very same fenced block (byte-for-byte payload unchanged);
> clicking the chip jumps back to the source file and flashes the quoted lines. The quote
> payload lives in the chip's own ref (`cnq1:` + JSON) and is **never written to storage**,
> so a refresh, another tab or clearing site data cannot kill the chip. Hosts without a
> chip channel (older DSH, no `inputTriggers`) fall back to this plugin's own plain-text
> chip and then to inserting the fenced block directly, so the capability is never lost.
>
> 0.5.0 is the **large-file release**: the plugin no longer stops at 500 KB — files up to
> 5 MB load in **256 KiB** chunks (two on first paint, more on scroll), files above 5 MB
> use the host's read-only `fs.readPage` paging (**128 KiB** pages, stitching cross-page
> half-lines back into one line), with file-global line numbers; only rows near the
> viewport are mounted (virtual scrolling; spacer rows keep the scroll height), so
> opening or scrolling an 8k+-line file no longer freezes. Search covers the **whole
> file** (in-memory text ≤5 MB, background page scan with a 64 MB budget above), and
> Enter / Next reads chunks on demand to reach a match that is not loaded yet. The
> default **50,000-line** soft cap can be lifted with **Load all (lift cap)**, and
> over-long lines (>8,000 chars or >500 segments) render as plain text to keep scrolling
> responsive. This release also fixes cross-page long-line alignment, cross-chunk
> tokenizer state, Kotlin `enum class` names, the cap-at-EOF escape hatch, and inserting
> into a frozen composer.

## Fork notes

**Origin**: [AnakinCao/dsh-code-nav](https://github.com/AnakinCao/dsh-code-nav) (upstream, MIT), fork baseline commit [`0d34d27`](https://github.com/AnakinCao/dsh-code-nav/commit/0d34d27). This fork lives at [whybebabo/dsh-code-nav](https://github.com/whybebabo/dsh-code-nav).

**Why fork**: upstream registers its viewer with `priority: 10`, so for the extensions it handles the built-in `TextEditor` never mounts — and better-sidebar's "selection → add to conversation" popup lives inside `TextEditor` only, while the `betterSidebar` service exposes no selection / popup / draft API at all. Those files therefore lose the capability outright. Upstream has no such feature and there was a local need for it.

**Differences from upstream** (v0.1.2 is the content of PR [#1](https://github.com/AnakinCao/dsh-code-nav/pull/1); v0.2.0 adds config-file support; v0.2.1 fixes style ownership; v0.2.2 fixes correctness and hardens the build / release pipeline; v0.3.0 adds Protocol Buffers; v0.4.0 makes the quote chip clickable; v0.5.0 adds chunked / paged large-file preview):

| | upstream `dsh-code-nav@0.1.0` | this fork `@whybebabo/dsh-code-nav@0.5.0` |
|---|---|---|
| Selection → add to conversation | ❌ absent (lost once the viewer takes over) | ✅ floating button above the selection → a quote chip in the composer |
| Draft shape | — | same shape as better-sidebar 0.30: a compact `Quote <file> Lstart[-end]` chip; clicking it jumps back to the source file and flashes the quoted lines |
| Insert payload | — | the chip's codec expands it on send into a fenced block headed by `relative/path:start[-end]` (byte-for-byte the built-in viewers' payload); >500 chars keeps the path line only |
| Line accuracy | — | read from the line containers plus the per-line code column, so the `user-select: none` gutter never leaks in; a selection ending exactly at the next line start narrows the span |
| Insert mechanism | — | own `@` input-trigger source (`codeNavQuote`) + codec + `insertReference()`; falls back to this plugin's own plain-text chip (`codeNavQuoteText`) when the host has no chip channel or the ref cannot be resolved, then to the official `insertText()`, then to `setDraft` on older hosts |
| Popup dismissal | — | same contract as better-sidebar: outside mousedown / Escape / hidden document / blur / scroll / surface leaving the viewport |
| Config-file support | ❌ none (json / yaml / toml / xml … fall to the built-in viewer, no highlighting or outline) | ✅ highlighting + structural outline for JSON / YAML / TOML / XML / INI / properties / dotenv |
| Added language | ❌ no `.proto` | ✅ Protocol Buffers (`.proto`): highlighting + outline for message / enum / enum value / oneof / field / service / rpc / extend |
| Large-file preview | ❌ truncated after 500 KB | ✅ 256 KiB chunks up to 5 MB, read-only `fs.readPage` paging above; virtual-scrolled rows; whole-file search; liftable 50,000-line soft cap |
| Outline / search correctness | — | every `<script>` block of a Vue / Svelte file is parsed with line numbers mapped back to the original file; case-insensitive matches report original-text coordinates (characters whose lowercase form changes length no longer shift positions); JSON keys are unescaped (`\uXXXX` etc.); the caps (50,000 lines by default, liftable / 2000 matches / 500 symbols) are surfaced in the UI |
| Package name | `dsh-code-nav` | `@whybebabo/dsh-code-nav` (avoids claiming the upstream name) |
| Version | 0.1.0 (not on npm) | 0.4.x (published to npm; the version lives in `package.json`) |
| Built artifact id | hardcoded `dsh-code-nav` | injected by `scripts/build.mjs` from `package.json`, so a rename cannot drift; the build also checks top-level name collisions, un-stripped import/export, the export surface vs. template usage, and that the artifact contains every source line verbatim |
| `<style>` ownership tag | — | keyed by the **full package name** in `data-plugin` (fixed in v0.2.1): client-modules reclaims styles by package name on uninstall / hot-replace, so a short name leaks the `<style>` and stale styling bleeds into the UI |
| Everything else (highlighting / outline / search) | as above | **no difference from upstream** |


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
| Protobuf | `.proto` (message / enum / enum value / oneof / field / service / rpc / extend all reach the outline) |
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
npm run check           # = node --check lib/client.js && node --check lib/index.js
npm test                # = the two checks above + node --test (discovers every file under test/)
npm run release         # release rehearsal (--dry-run: no git writes, no network requests)
```

`lib/client.js` is a **generated artifact**: after touching `src/**` or `scripts/client.template.js`
you must re-run `npm run build`, otherwise the unit test that compares the committed bundle
byte-for-byte against a fresh build fails (so does CI). There are no third-party dependencies —
everything is plain node. `test/` holds the pure-logic unit tests (394 cases: tokenizer + per-language outline + config formats + search + whole-file scanning + render window + virtual-scroll row window + file chunking + selection payload + draft coordinates + quote-chip runtime + view-derived state + build/release guards); one of them counts the `test()` declarations across every `test/*.test.mjs` and compares them with both READMEs, so adding a test and forgetting to update the docs fails loudly.

- `src/lang-registry.js` — extension map + language metadata (keywords / comment syntax / string quotes / config colouring directives)
- `src/properties-key.js` — Java properties key scanning + unescaping rules (shared by outline **and** highlighting so the two cannot drift apart)
- `src/tokenize.js` — cross-line state-machine tokenizer (block comments, Python triple quotes, C# verbatim strings, XML CDATA, escapes; config key / section / XML element + attribute colouring)
- `src/config-outline.js` — structural outline for config formats (JSON document scanner + YAML / TOML / INI / properties / dotenv / XML extractors)
- `src/outline.js` — brace-depth / indent driven outline parser (Allman brace-on-next-line style supported; Vue / Svelte extract every `<script>` block and re-add line offsets; the 500-symbol cap is applied here)
- `src/search.js` — in-file matching (literal substrings, positions always in original-text coordinates) + token×match span merging; 2000-match cap; incremental paging-scan accumulator and progress/budget maths (`appendScannedMatches` / `scanProgress`)
- `src/render-window.js` — render window (the client passes the 50,000-line preview cap, which can be lifted; the pure-function default is 20,000 as a fallback): find and outline share one clipping rule, so everything listed is jumpable
- `src/file-chunks.js` — chunked loading (256 KiB per chunk): line-aligned cuts with file-global line numbers, over-long single lines skip tokenizing, and paged `fs.readPage` responses normalise to the same shape — with cross-page half-lines stitched back into one line
- `src/virtual-rows.js` — virtual-scroll row window: only rows near the viewport are mounted, the rest is spacer height so the scroll height stays identical; line number → scrollTop jump math lives here too
- `src/selection.js` — selection → draft payload (fenced `relative/path:start[-end]` block / chip label / clipboard projection; over-long selections keep the path line only)
- `src/draft-coords.js` — pure conversion between the draft's two projections: clipboard → detect (each reference chip folds to one U+FFFC), plus the separator-space decision before the insertion point
- `scripts/client.template.js` — React preview component template (pure modules injected at build time; owns the selection popup, the quote chip's input-trigger source / self-contained ref codec, and the landing flash)
- `scripts/build.mjs` — the inliner plus four build-time checks: top-level name collisions (the later declaration silently wins), import/export the stripper cannot remove (a syntax error once inlined), export surface vs. `__cn.*` usage in the template, and **every source line present verbatim in the artifact** — inlining must use function-form `replace`, because the string form expands `$&` / `` $` `` / `$'` inside the replacement text and rewrites the artifact while still passing `node --check`
- `scripts/release-config.mjs` — repo / version / asset-name derivation shared by the release scripts (always from `package.json`, never hardcoded), idempotent tag / asset decisions, and `readGithubToken()`

## Release and CI

```sh
node scripts/release-code-nav.mjs --dry-run   # print the plan only (incl. artifact freshness): no git writes, no requests
node scripts/release-code-nav.mjs --yes       # real release: create repo (if missing) → push → tag → release → upload tgz
node scripts/pr-better-sidebar.mjs --dry-run  # rehearse the upstream PR flow (exits before token / clone / commit / push)
node scripts/repo-topics.mjs [topic...]       # merge-style topics for this repo (target repo likewise derived from package.json)
```

A bare invocation (neither `--dry-run` nor `--yes`) only prints the usage and exits 1: `--yes` is the single
switch for a live release (it may create a public repo when the target does not exist, so read the plan first).

Safety boundaries (implemented in the scripts and pinned by unit tests): the target repo / version /
tag / asset name are always derived from `package.json`; before fetching a token, pushing or tagging, a live
release runs the full test suite and verifies that **the tarball matches this tree**
(`package/lib/client.js` must equal a fresh build of the current sources and `package/package.json` must carry
this version) — editing code after `npm pack` fails here instead of uploading a stale package; an existing tag pointing at another commit is
**refused** — nothing is overwritten, force-pushed or `git reset --hard`-ed; release assets are decided
by digest (skip vs. replace) so re-running a publish never fails; the GitHub token is fetched
in-process through `git credential fill` and is **kept in memory only — never logged, never written to
disk** (on failure you get "unable to obtain a GitHub token from the git credential helper", never a
dumped git error object).

`.github/workflows/ci.yml` runs on push / PR: `node scripts/build.mjs` → `node --check lib/client.js` →
the unit tests (`npm test`, which also syntax-checks the `lib/index.js` entry and runs every test file via
`node --test`) → `node scripts/verify-pack.mjs` (packed contents non-empty, all required files present)
→ `git diff --exit-code -- lib/client.js` (the artifact must be committed and in sync with the sources) →
`npm pack` + the release rehearsal.

> The registration id in `lib/client.js` is injected by `scripts/build.mjs` from the `name` in `package.json` — client-modules keys its module table by the **full package name**, so a rename must be followed by a rebuild or the browser reports `loaded without registering "<id>"`.

## Known limitations

- Highlighting and outline are lightweight regex / hand-written scanners, not compiler-grade (complex generics, macros, template metaprogramming may be missed or misdetected)
- Preview takeover is **read-only**; disable the plugin in better-sidebar settings to get the built-in editor back
- "Add to conversation" resolves the path relative to the session cwd; the plain-text fallback view (no line containers) carries no line numbers
- A new chip's quote payload lives in the chip's own ref (`cnq1:` + JSON: path / line span / display label / open target) and is **never written to `localStorage`** — a refresh, another tab or cleared site data cannot kill it. Only legacy `q…` records still resolve from `dsh-code-nav:quote-refs` (read-only); those old chips go stale after site data is cleared — clicking asks you to select the text again, and the host blocks the send instead of silently sending wrong text
- Click-through + line flash need better-sidebar 0.30.0+ to hand `line` / `lineEnd` to the viewer; older better-sidebar versions still get the chip and the correct send-time expansion, but a click only opens the file without landing. Hosts with no chip channel (`inputTriggers`) fall back along the chain: this plugin's own plain-text chip (`codeNavQuoteText`, still a compact chip that expands verbatim on send) → inserting the fenced block directly
- File content is still bounded by better-sidebar's 5 MB inline limit, but this plugin no longer stops at **500 KB**:
  - **≤ 5 MB**: the host hands over the content, and this plugin loads it in **256 KiB** chunks (two on first paint; more on scroll near the bottom or via the footer's **Load more / Load all**), with file-global line numbers and at most **50,000 lines** by default (soft cap; **Load all (lift cap)** reads the rest of the file)
  - **> 5 MB**: the host sends only `largeFile` (no content), so this plugin pages read-only through `ctx.betterSidebar.hostRouteUrl('sidebar/api/fs.readPage')` (each page **128 KiB**; the host trims pages back to whole lines, but a line longer than a page comes back untrimmed and this plugin stitches the pages back into one line); the footer shows loaded lines and offers load more / load all / retry / download, and the note row also has a **Load all** button that reads the whole file (lifting the default 50,000-line preview cap). Hosts without `hostRouteUrl` (older versions) still fall back to the "too large for the inline preview" notice
- Search covers the **whole file**, so you never have to scroll a match into memory first:
  - **≤ 5 MB**: the full text is already on the client, so it is searched directly and `n/m` is the whole-file count; when the match line is not loaded yet, Enter / Next reads chunks until it is and then jumps there (typing alone does not trigger reads — otherwise every keystroke would load a chunk).
  - **> 5 MB**: the client has no text, so search scans pages in the background (128 KiB each, with progress) and matches appear as the scan advances; the scan budget is **64 MB** and the UI says so when it is hit. Changing the query or the file cancels the previous scan.
  - Matches past the **50,000-line** preview cap are counted but cannot be jumped to while the cap is on; the UI says so separately and offers a **Load all (lift cap)** button that reads the remaining lines (page by page, with progress), after which those matches become jumpable.
- The outline covers **only the loaded lines** (the top notice says so), and the 50,000-line load cap is surfaced too. Multi-line comment / string state is now **carried across chunk boundaries** (chunk cuts no longer reset it); Vue / Svelte `<script>` blocks are re-tokenized as a whole while the loaded prefix is ≤500 KB, and larger SFCs fall back to per-chunk tokenization (script lines after the first chunk may lose highlighting; line numbers, search and quotes stay exact)
- Only the loaded lines **near the viewport** are mounted (virtual scrolling; rows outside it are replaced by spacer height). This is not a memory optimisation but the thing that keeps the preview alive: mounting all 8,148 lines of a C++ file made the desktop host spend ~10 s in a single style recalc (a hundred-plus thousand elements × the host's hundred-plus stylesheets) — which is exactly the "opening a large file freezes the app" report. Scroll height, line numbers, jumps and the all-rows layout stay identical; the trade-off is that a native drag-selection breaks at the window edge. "Add to conversation" still slices the text by line number, and find / outline / quote jumps scroll the target line into the window before flashing it
- Lines that are too long (over **8,000 characters** or **500 highlight segments**) drop per-token highlighting and render as plain text (content stays intact and selectable/searchable; jumping and flashing still land on the line): putting tens of thousands of `<span>` elements on one line freezes browser layout/paint (measured: a 928 KB single-line JSON = 54,508 segments, where Chromium never produced the first frame)
- Four caps are always stated in the UI: at most **50,000 lines** are loaded per file by default (the footer shows the loaded count and the total once complete, and a **Load all (lift cap)** button removes the cap — memory and tokenizing time then grow with the line count), whole-file scanning reads at most **64 MB** (past that it says only the first 64 MB was scanned; if the 2,000-match cap stops it first, it says so instead), search returns at most **2,000** matches (the counter shows `2000+`), and the outline lists at most **500** symbols ("Too many symbols — listing the first 500")
- Search matches **literal substrings**, not regular expressions: `.`, `*`, `(`, `\` are themselves, so there is nothing to learn and no unbalanced-parenthesis error — the trade-off is no pattern matching
- Outline names are capped at 80 characters (code and config formats alike): longer candidates are treated as misparses and dropped, so a whole line can never be rendered as a "name"
- Vue / Svelte highlight the JS/TS inside each `<script>` block; template sections are not highlighted. Several blocks in one file (`<script>` plus `<script setup>`) are all parsed, with symbol lines mapped back to the original file
- Config parsing is **syntax-level only**: JSON is not schema-validated, YAML does not expand anchors / aliases or folded scalars (but the container relationship at an anchor / tag is preserved), XML does not interpret namespace semantics or DTDs; duplicate keys each get their own entry (no deduplication)
- JSON comments (jsonc) and advanced TOML / YAML syntax are read leniently — display wins over strict validation, so a deliberately broken file never errors, it may just yield fewer outline entries
- Config files outside the listed extensions (`.htaccess`, `.gitignore`, extension-less `Makefile`, …) still go to the built-in viewer
- If upstream merges [PR #1](https://github.com/AnakinCao/dsh-code-nav/pull/1) and publishes, prefer the upstream package; this fork will keep tracking upstream

## License

MIT (inherited). Upstream copyright belongs to [AnakinCao](https://github.com/AnakinCao); this fork's changes are released under the same MIT terms.
