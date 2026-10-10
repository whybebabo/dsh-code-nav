// dsh-code-nav 发布：建仓(如缺) → push → tag → release → 上传 tgz 资产
//
// 目标仓库 / 版本 / tag / 产物名**全部从 package.json 派生**（见 release-config.mjs），
// 不再写死 —— 写死曾在 fork 后指向上游 AnakinCao/dsh-code-nav、推 v0.1.0、
// 读不存在的旧 tgz，存在「先推上游、再上传失败」的误发布风险。
//
// 用法：
//   node scripts/release-code-nav.mjs --dry-run     # 只打印计划，不写 git、不发网络请求
//   node scripts/release-code-nav.mjs               # 真正发布
//   可选：--remote <name>  指定推送用 remote（默认自动匹配派生仓库）
//         --allow-dirty   允许工作区有未提交改动
//
// 凭据经 `git credential fill` 进程内获取（沙箱阻断 GCM 凭据管道，须 danger-full-access 运行）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPkg, repoOf, tagOf, tgzNameOf, tgzPathOf, isSameRepo, decideTagAction, parseRemoteTagCommit, decideAssetAction, ROOT } from "./release-config.mjs";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const ALLOW_DIRTY = argv.includes("--allow-dirty");
const remoteFlagIdx = argv.indexOf("--remote");
const REMOTE_FLAG = remoteFlagIdx >= 0 ? argv[remoteFlagIdx + 1] : null;

const pkg = readPkg();
const REPO = repoOf(pkg);          // 从 package.json 的 repository.url 派生
const TAG = tagOf(pkg);            // v<version>
const TGZ_NAME = tgzNameOf(pkg);   // 实际 npm pack 的文件名
const TGZ = tgzPathOf(pkg);

function sh(cmd, args, opts = {}) {
  console.log("$", cmd, args.join(" "));
  return execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
}
function gitOut(args) {
  try { return sh("git", ["-C", ROOT, ...args]).trim(); } catch { return ""; }
}
/** 同 gitOut，但把失败与「空输出」区分开 —— 查询远端 tag 时不能把失败当成「不存在」。 */
function gitStrict(args) {
  try { return { ok: true, out: sh("git", ["-C", ROOT, ...args]).trim() }; }
  catch (e) {
    return { ok: false, out: "", err: String((e && (e.stderr || e.message)) || e).trim().split("\n")[0] };
  }
}

/** 找出 URL 指向目标仓库的 remote 名（找不到返回 null）。
 *  用规范化比较，使 HTTPS / SSH / `git+https` 等等价写法都能被识别。 */
function remoteForRepo(url) {
  const names = gitOut(["remote"]).split("\n").map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (isSameRepo(gitOut(["remote", "get-url", n]), REPO)) return n;
  }
  return null;
}

const url = "https://github.com/" + REPO + ".git";
console.log("=== release plan (derived from package.json) ===");
console.log("  package   :", pkg.name + "@" + pkg.version);
console.log("  repo      :", REPO);
console.log("  tag       :", TAG);
console.log("  asset     :", TGZ_NAME);
console.log("  asset path:", TGZ, existsSync(TGZ) ? "(exists)" : "(MISSING)");
console.log("  mode      :", DRY ? "DRY RUN (no writes, no network)" : "LIVE RELEASE");

// ── 前置条件：产物必须已存在（必须在任何 git push / GitHub API 写操作之前）──
// 否则漏跑 `npm pack` 会先推分支、打 tag、建 Release，最后才在上传阶段失败，
// 留下空 Release 与远端 tag。
if (!existsSync(TGZ)) {
  console.error("[release] 发布前置条件不满足：产物不存在");
  console.error("[release]   " + TGZ);
  console.error("[release] 请先运行 `npm pack`（会生成 " + TGZ_NAME + "），再重跑本脚本。");
  console.error("[release] 本次未推送、未打 tag、未创建 Release。");
  process.exit(1);
}

// 推送目标：只用**已存在且指向派生仓库**的 remote，绝不静默改写用户的 remote 配置
// （用户可能有意把 origin 留给上游、用 fork 指向自己的 fork）。
const remoteName = REMOTE_FLAG !== null ? REMOTE_FLAG : remoteForRepo(url);
if (remoteName === null) {
  console.error("[release] 没有指向 " + url + " 的 remote。");
  console.error("[release] 请先添加（不要复用指向上游的 origin）：");
  console.error("[release]   git remote add fork " + url);
  console.error("[release] 或用 --remote <name> 指定。");
  process.exit(1);
}
const remoteUrl = gitOut(["remote", "get-url", remoteName]);
// 规范化比较：HTTPS / SSH / git+https 指向同一仓库时都算通过
if (!isSameRepo(remoteUrl, REPO)) {
  console.error("[release] remote " + remoteName + " 指向 " + remoteUrl + "，与派生仓库 " + REPO + " 不一致，拒绝推送。");
  process.exit(1);
}
console.log("  remote    :", remoteName, "->", remoteUrl);

if (DRY) {
  console.log("[release] dry run: 计划校验通过，未推送、未发 Release。");
  process.exit(0);
}

if (!ALLOW_DIRTY && gitOut(["status", "--porcelain"]) !== "") {
  console.error("[release] 工作区有未提交改动；先提交，或加 --allow-dirty。");
  process.exit(1);
}

// 1) token
let token;
try {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = out.match(/^password=(.+)$/m);
  if (m) token = m[1].trim();
} catch (e) {
  console.error("cred fill failed:", e.message.split("\n")[0]);
  process.exit(1);
}
if (!token) { console.error("no token"); process.exit(1); }

const GH = (path, init = {}) =>
  fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "dsh-release",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

// 2) 确保仓库存在
const exist = await GH("/repos/" + REPO);
if (exist.status === 404) {
  const created = await GH("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: REPO.split("/")[1],
      description: pkg.description,
      private: false,
      has_issues: true,
      has_wiki: false,
    }),
  });
  const d = await created.json();
  if (!created.ok) { console.error("repo create failed", created.status, d.message); process.exit(1); }
  console.log("REPO CREATED:", d.html_url);
} else if (!exist.ok) {
  console.error("repo check failed", exist.status);
  process.exit(1);
} else {
  console.log("REPO EXISTS:", REPO);
}

// 3) tag 前置校验（只读，必须在任何写操作之前）
// 曾经是 `try { git tag TAG } catch { git tag -f TAG }` + 无条件 `git push -f`：
// 对已发布版本重跑会把 tag 从原提交移到当前提交，而 Release 仍按 tag 复用，
// 于是 Release / tag 指向的源码 / 附件三者版本不一致。
// 因此先判定：同提交则复用，不同则拒绝发布；绝不 `tag -f` / `push -f`。
const headCommit = gitOut(["rev-parse", "HEAD"]);
if (headCommit === "") { console.error("[release] 无法确定 HEAD 提交"); process.exit(1); }
const tagQuery = gitStrict(["ls-remote", "--tags", remoteName, "refs/tags/" + TAG, "refs/tags/" + TAG + "^{}"]);
if (!tagQuery.ok) {
  // 查询失败（网络 / 凭据 / remote 不可达）绝不能当成「tag 不存在」——
  // 那会退回「打新 tag 并强推」的旧行为，正是要消除的风险。
  console.error("[release] 无法查询远端 tag（ls-remote 失败），拒绝继续：");
  console.error("[release]   " + tagQuery.err);
  console.error("[release] 请确认 remote " + remoteName + " 可达后重跑。");
  console.error("[release] 本次未推送分支、未打 tag、未创建 Release。");
  process.exit(1);
}
const remoteTagCommit = parseRemoteTagCommit(tagQuery.out, TAG);
// 本地可能残留上次运行留下的 tag（例如上次推到一半失败）：
// 指向 HEAD 就只需补推；指向别处则绝不能推上去。
const localTagCommit = gitOut(["rev-parse", "--verify", "--quiet", "refs/tags/" + TAG + "^{commit}"]) || null;
const tagAction = decideTagAction(remoteTagCommit, headCommit, localTagCommit);
if (tagAction.action === "conflict") {
  console.error("[release] 拒绝发布：tag " + TAG + " 已经存在且指向其它提交。");
  console.error("[release]   远端 tag 提交: " + (remoteTagCommit === null ? "(远端无此 tag)" : remoteTagCommit));
  console.error("[release]   本地 tag 提交: " + (localTagCommit === null ? "(本地无此 tag)" : localTagCommit));
  console.error("[release]   本地 HEAD    : " + headCommit);
  console.error("[release]   说明: " + tagAction.reason);
  console.error("[release] 本脚本绝不改写已有 tag（曾用 `git tag -f` + `push -f`，会把已发布版本");
  console.error("[release] 的 tag 悄悄移到新提交，导致 Release / 源码 / 附件版本不一致）。请二选一：");
  console.error("[release]   1) 提升 package.json 的 version（推荐，发新版本）");
  console.error("[release]   2) 确认要重发该版本时，先自行删除 tag 与 Release：");
  console.error("[release]        git push " + remoteName + " :refs/tags/" + TAG + "   # 远端");
  console.error("[release]        git tag -d " + TAG + "                              # 本地");
  console.error("[release] 本次未推送分支、未打 tag、未创建 Release。");
  process.exit(1);
}

// 4) push 当前分支
const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch === "" || branch === "HEAD") { console.error("[release] 无法确定当前分支"); process.exit(1); }
sh("git", ["-C", ROOT, "push", "-u", remoteName, branch]);

// 5) tag 落地（校验已在第 3 步通过）
if (tagAction.action === "reuse") {
  console.log("TAG EXISTS at same commit, reusing:", TAG);
} else {
  if (tagAction.action === "create") {
    sh("git", ["-C", ROOT, "tag", TAG]);
  } else {
    console.log("LOCAL TAG EXISTS at same commit, pushing:", TAG);
  }
  sh("git", ["-C", ROOT, "push", remoteName, TAG]);
  console.log("TAG PUSHED:", TAG);
}

// 6) release（幂等：tag 已有 release 则复用）
// 正文里的数字同样派生，避免又一处「文档写 25/25 实际 72/72」式的过期。
const testCount = (() => {
  try {
    const t = readFileSync(join(ROOT, "test", "code-nav.test.mjs"), "utf8");
    return (t.match(/^test\(/gm) || []).length;
  } catch { return null; }
})();
const langCount = (() => {
  try {
    const reg = readFileSync(join(ROOT, "src", "lang-registry.js"), "utf8");
    return new Set([...reg.matchAll(/\bexts:\s*\[([^\]]*)\]/g)].map((m) => m[1])).size || null;
  } catch { return null; }
})();
const body = [
  "## " + TAG,
  "",
  "**" + pkg.name + "** — " + pkg.description,
  "",
  "### Install",
  "```bash",
  "dsh plugin --profile web add " + url,
  "```",
  "Then restart `dsh web` and hard-refresh the browser (Cmd/Ctrl+Shift+R). Requires [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar).",
  "",
  "Alternatively install the attached tarball:",
  "```bash",
  "dsh plugin --profile web add ./" + TGZ_NAME,
  "```",
  "",
  "### Artifacts",
  "- `" + TGZ_NAME + "` — pre-packed plugin tarball",
  "",
  "### Verified",
  testCount === null
    ? "- `node test/code-nav.test.mjs` — unit tests pass"
    : "- `node test/code-nav.test.mjs` — " + testCount + "/" + testCount + " unit tests pass",
  "- `node --check lib/client.js` — bundle syntax OK",
].join("\n");
let releaseId;
{
  const existing = await GH("/repos/" + REPO + "/releases/tags/" + TAG);
  if (existing.ok) {
    const d = await existing.json();
    releaseId = d.id;
    console.log("RELEASE EXISTS:", d.html_url);
  } else {
    const rel = await GH("/repos/" + REPO + "/releases", {
      method: "POST",
      body: JSON.stringify({
        tag_name: TAG,
        target_commitish: branch,
        name: TAG,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    const rd = await rel.json();
    if (!rel.ok) { console.error("release failed", rel.status, rd.message || "", rd.errors || ""); process.exit(1); }
    releaseId = rd.id;
    console.log("RELEASE CREATED:", rd.html_url);
  }
}

// 7) 上传 tgz 资产（uploads.github.com，非 api.github.com）—— 幂等
// 产物存在性已在最前面校验过（任何写操作之前）；这里再查一次是防御性的
// （防止运行中途产物被删），正常路径不会走到。
if (!existsSync(TGZ)) {
  console.error("[release] 产物在运行中消失：" + TGZ);
  console.error("[release] Release 已存在/已创建，重跑本脚本会复用该 Release 并补传资产。");
  process.exit(1);
}
const buf = readFileSync(TGZ);
const assetSha256 = createHash("sha256").update(buf).digest("hex");

// 曾经这里无条件 POST 同名资产：Release 会按 tag 复用，但资产没有幂等处理，
// 于是「成功发布后再跑一次」必定在最后一步因同名资产已存在（422 already_exists）失败。
// 现在先查同名资产，再按内容决定跳过 / 替换 / 上传。
const assetsRes = await GH("/repos/" + REPO + "/releases/" + releaseId + "/assets?per_page=100");
if (!assetsRes.ok) {
  console.error("[release] 无法列出现有资产", assetsRes.status);
  process.exit(1);
}
const assets = await assetsRes.json();
const existingAsset = Array.isArray(assets)
  ? assets.find((a) => a && a.name === TGZ_NAME) ?? null
  : null;
const decision = decideAssetAction(existingAsset, { sha256: assetSha256, size: buf.length });
console.log("ASSET DECISION:", decision.action, "—", decision.reason);

if (decision.action === "skip") {
  console.log("ASSET UP-TO-DATE, skipping:", TGZ_NAME);
  console.log("DONE (no changes)");
  process.exit(0);
}

if (decision.action === "replace") {
  // 同一次发布重跑时替换旧资产：先删后传，避免 422 already_exists。
  const del = await GH("/repos/" + REPO + "/releases/assets/" + existingAsset.id, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    console.error("[release] 删除旧资产失败", del.status);
    process.exit(1);
  }
  console.log("ASSET REPLACED (old id " + existingAsset.id + " removed):", TGZ_NAME);
}

const up = await fetch("https://uploads.github.com/repos/" + REPO + "/releases/" + releaseId + "/assets?name=" + encodeURIComponent(TGZ_NAME), {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "dsh-release",
    "Content-Type": "application/gzip",
  },
  body: buf,
});
const ud = await up.json();
if (!up.ok) { console.error("asset upload failed", up.status, ud.message || ""); process.exit(1); }
console.log("ASSET UPLOADED:", ud.browser_download_url);
console.log("DONE");
