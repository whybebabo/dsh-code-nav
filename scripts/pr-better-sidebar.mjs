// 向 omdsh-dev/DSH-better-sidebar 提交「推荐文件预览插件目录」PR（dsh-code-nav）。
// 流程：本地校验并提交（clone 缺失时自动 clone 上游）→ fork（api.github.com）→ push fork → 创建 PR。
// 凭据经 git credential fill 进程内获取；须 danger-full-access 运行。
//
// 待提交的三个文件由人工在 clone 工作区里准备好；脚本只负责提交与推送，
// 绝不 `git reset --hard`（那会删掉正是要提交的未提交改动）。
//
// 本插件仓库与 better-sidebar fork 的属主都从 package.json 的 repository.url 派生，
// 不再写死上游属主（写死会把 PR 里的插件地址指向上游仓库，而不是本 fork）。
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { readPkg, repoOf } from "./release-config.mjs";

const pkg = readPkg();
const PLUGIN_REPO = repoOf(pkg);                                   // whybebabo/dsh-code-nav
const OWNER = PLUGIN_REPO.split("/")[0];                           // whybebabo
const UPSTREAM = "omdsh-dev/DSH-better-sidebar";
const FORK = process.env.DSH_BS_FORK || (OWNER + "/DSH-better-sidebar");
const BRANCH = "feat/dsh-code-nav-catalog";
// 临时克隆目录：默认落在系统临时目录（不再写死某台机器的固定盘符路径）
const CLONE = process.env.DSH_BS_CLONE || join(tmpdir(), ".tmp-bs-clone");
console.log("plugin repo:", PLUGIN_REPO, "| better-sidebar fork:", FORK, "| clone:", CLONE);

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

const H = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "User-Agent": "dsh-pr",
  "X-GitHub-Api-Version": "2022-11-28",
};
const gh = (path, init = {}) =>
  fetch("https://api.github.com" + path, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
function sh(cmd, args) {
  console.log("$", cmd, args.join(" "));
  return execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
}

// 1) 先做**纯本地**的前置校验与提交准备（不产生任何远端写入）
const UPSTREAM_URL = "https://github.com/" + UPSTREAM + ".git";
// 本脚本要提交的三个文件，改动由人工在此 clone 的工作区里准备好
const PATCH_FILES = ["src/client/plugins-viewers.ts", "src/client/locales.ts", "src/client/locales-ja.ts"];

/** 执行并返回 stdout；失败返回 null（用于「只想知道成不成」的查询）。 */
function gitQ(args) {
  try { return sh("git", ["-C", CLONE, ...args]); }
  catch { return null; }
}

// 2) 确保 clone 目录存在且是有效仓库
// 默认目录在系统临时目录，全新环境并不存在 —— 曾经直接 `git fetch` 会立刻失败。
// 现在目录缺失时自动 clone 上游；已存在则校验它确实是 git 仓库（不能是随便一个同名目录）。
if (!existsSync(CLONE)) {
  console.log("clone 目录不存在，自动克隆上游：", UPSTREAM_URL, "->", CLONE);
  mkdirSync(dirname(CLONE), { recursive: true });
  sh("git", ["clone", UPSTREAM_URL, CLONE]);
}
if (gitQ(["rev-parse", "--is-inside-work-tree"]) === null) {
  console.error("[pr] clone 目录不是有效的 git 仓库：" + CLONE);
  console.error("[pr] 请删除该目录后重跑（脚本会自动 clone），或用 DSH_BS_CLONE 指向正确的 clone。");
  console.error("[pr] 本次未做任何写入。");
  process.exit(1);
}
const cloneOrigin = (gitQ(["remote", "get-url", "origin"]) || "").trim();
if (cloneOrigin === "") {
  console.error("[pr] clone 缺少 origin remote：" + CLONE);
  console.error("[pr] 请设置：git -C \"" + CLONE + "\" remote add origin " + UPSTREAM_URL);
  console.error("[pr] 本次未做任何写入。");
  process.exit(1);
}

// 完整历史 + 取回 origin/main
// --unshallow 在**完整**仓库上是致命错误（exit 128），只在确实是浅克隆时才执行。
if ((gitQ(["rev-parse", "--is-shallow-repository"]) || "").trim() === "true") {
  sh("git", ["-C", CLONE, "fetch", "--unshallow", "origin"]);
}
sh("git", ["-C", CLONE, "fetch", "origin", "main"]);

// 切到 feat 分支（不销毁工作区改动）
// 曾经是 checkout 失败后 `git reset --hard origin/main`：那会删掉 clone 里所有未提交修改，
// 而 checkout 失败往往正是因为这些修改；且与下方「未提交修改随 checkout 保留」的注释自相矛盾。
// 现在只做 checkout，失败就停下并报告，绝不 hard reset。
const curBranch = (gitQ(["rev-parse", "--abbrev-ref", "HEAD"]) || "").trim();
if (curBranch !== BRANCH) {
  const hasLocal = gitQ(["rev-parse", "--verify", "--quiet", "refs/heads/" + BRANCH]) !== null;
  const args = hasLocal ? ["checkout", BRANCH] : ["checkout", "-b", BRANCH, "origin/main"];
  try {
    sh("git", ["-C", CLONE, ...args]);
  } catch {
    console.error("[pr] 切换分支失败：git " + args.join(" ") + "（目录 " + CLONE + "）");
    console.error("[pr] 拒绝执行 `git reset --hard`：工作区里的未提交改动正是本次要提交的内容，");
    console.error("[pr] 强重置会把它们删掉。当前工作区状态：");
    const st = (gitQ(["status", "--short"]) || "").trim();
    console.error(st === "" ? "  (干净)" : st.split("\n").map((l) => "  " + l).join("\n"));
    console.error("[pr] 请先自行处理（例如 git -C \"" + CLONE + "\" stash）后重跑。本次未提交、未推送。");
    process.exit(1);
  }
}

// 待提交的改动应已在工作区（未提交修改随 checkout 保留）。
// 用 `status --porcelain` 而非 `diff HEAD`，这样**新增**文件（untracked）也算数。
// 若工作区干净但分支已有相对 origin/main 的提交，说明上次已提交成功 —— 直接复用，
// 使重跑幂等。两者都没有才停下并给出可操作指引。
const dirty = new Set(
  (gitQ(["status", "--porcelain"]) || "")
    .split("\n").map((l) => l.slice(3).trim().replace(/^"|"$/g, "")).filter(Boolean)
);
const dirtyPatched = PATCH_FILES.filter((f) => dirty.has(f));
const aheadCommits = (gitQ(["rev-list", "--count", "origin/main..HEAD"]) || "0").trim();

if (dirtyPatched.length > 0) {
  sh("git", ["-C", CLONE, "add", ...PATCH_FILES]);
  sh("git", ["-C", CLONE, "commit", "-m", "Add dsh-code-nav to the file-viewer plugin catalog"]);
} else if (aheadCommits !== "0") {
  console.log("工作区干净，分支 " + BRANCH + " 已有 " + aheadCommits + " 个提交，复用（跳过 commit）");
} else {
  console.error("[pr] clone 工作区里没有待提交的改动，且 " + BRANCH + " 相对 origin/main 没有提交。");
  console.error("[pr] 期望改动的文件：" + PATCH_FILES.join(", "));
  console.error("[pr] clone 目录：" + CLONE);
  console.error("[pr] 本脚本只负责提交并推送**已准备好**的改动，不会自动改写上游源码。");
  console.error("[pr] 请在该 clone 中编辑下列文件后重跑：");
  console.error("[pr]   " + PATCH_FILES.join("\n[pr]   "));
  console.error("[pr] 本次未提交、未推送。");
  process.exit(1);
}

// 3) fork（已存在则忽略 422）—— 本地校验通过后才动远端
{
  const r = await gh(`/repos/${UPSTREAM}/forks`, { method: "POST" });
  const d = await r.json();
  if (r.ok) console.log("FORKED:", d.full_name);
  else if (r.status === 422) console.log("FORK EXISTS (or already forked)");
  else { console.error("fork failed", r.status, d.message || ""); process.exit(1); }
}

// 4) push 到 fork
const forkUrl = "https://github.com/" + FORK + ".git";
try { sh("git", ["-C", CLONE, "remote", "add", "fork", forkUrl]); }
catch { sh("git", ["-C", CLONE, "remote", "set-url", "fork", forkUrl]); }
sh("git", ["-C", CLONE, "push", "-u", "fork", BRANCH]);

// 5) PR
const body = [
  "Adds **dsh-code-nav** to the built-in file-viewer plugin catalog (the \"add preview plugin\" modal).",
  "",
  "### Entry",
  "- **id**: `dsh-code-nav` — code preview navigator for the better-sidebar editor",
  "- **url**: https://github.com/" + PLUGIN_REPO,
  "- **description** (zh/en/ja): per-language syntax highlighting + symbol outline (class/method/variable filter & jump) + in-file search; takes over code file preview",
  "- **install**: `dsh plugin --profile web add https://github.com/" + PLUGIN_REPO + ".git`",
  "",
  "### Files",
  "- `src/client/plugins-viewers.ts` — new catalog entry (alphabetical order)",
  "- `src/client/locales.ts` — `pluginCodeNavDesc` in zh + en (key-set kept equal)",
  "- `src/client/locales-ja.ts` — `pluginCodeNavDesc` in ja",
  "",
  "### Notes",
  "- The repo is tagged `dsh-better-sidebar` (GitHub topic) for ecosystem discoverability",
  "- `tests/plugin-list.spec.ts` shape rules are satisfied: unique id, GitHub URL, non-empty localized description, install starts with `cd ~/.dsh` and contains `dsh plugin`",
].join("\n");

const pr = await gh(`/repos/${UPSTREAM}/pulls`, {
  method: "POST",
  body: JSON.stringify({
    title: "Add dsh-code-nav to the file-viewer plugin catalog",
    head: FORK.split("/")[0] + ":" + BRANCH,
    base: "main",
    body,
  }),
});
const pd = await pr.json();
if (!pr.ok) { console.error("PR failed", pr.status, pd.message || "", pd.errors || ""); process.exit(1); }
console.log("PR CREATED:", pd.html_url);
console.log("DONE");
