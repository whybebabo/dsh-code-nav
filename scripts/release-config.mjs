/**
 * dsh-code-nav — 发布脚本共享的仓库 / 版本 / 产物派生（node 专用，仅 scripts/ 使用）。
 *
 * 这些脚本会真的向 GitHub 推送、打 tag、发 Release。把目标仓库与版本写死在脚本里
 * 曾导致：fork 之后脚本仍指向上游 `AnakinCao/dsh-code-nav`、推送 `v0.1.0`、
 * 读取不存在的旧 tgz —— 先向上游推送、再在上传阶段失败，存在误发布风险。
 *
 * 因此一律从权威来源派生：
 * - 仓库：`package.json` 的 `repository.url`
 * - 版本 / tag：`package.json` 的 `version` → `v<version>`
 * - 产物名：`npm pack` 的实际文件名规则 `<name>-<version>.tgz`（scoped 包去掉 `@scope/`）
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录。 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 允许在发布/PR 脚本文案里出现的**其它**仓库（不是发布目标）：
 * better-sidebar 是运行期依赖，文档正文里链接它是正常的。
 */
export const DOC_LINK_REPOS = ["omdsh-dev/DSH-better-sidebar"];

/** 读取 package.json。 */
export function readPkg(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/**
 * 从 `repository.url` 解析出 `owner/repo`。
 * 支持 `git+https://github.com/owner/repo.git`、`https://…`、`git@github.com:owner/repo.git`。
 * @param {object} [pkg]
 * @returns {string} `owner/repo`
 * @throws 无法解析时抛错（宁可失败也不要回落到错误仓库）
 */
export function repoOf(pkg = readPkg()) {
  const raw = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository && pkg.repository.url);
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("package.json 缺少 repository.url，无法确定发布目标仓库");
  }
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(raw);
  if (m === null) throw new Error("无法从 repository.url 解析 owner/repo: " + raw);
  return m[1] + "/" + m[2];
}

/**
 * 把任意 GitHub remote URL 规范成 `owner/repo`（无法识别返回 null）。
 *
 * 同一个仓库有多种等价写法，直接字符串比较会把它们判成不同仓库：
 * - `https://github.com/o/r.git` / `https://github.com/o/r`
 * - `git+https://github.com/o/r.git`（package.json 的常见写法）
 * - `git@github.com:o/r.git`（SSH，最常见的推送配置）
 * - `ssh://git@github.com/o/r.git`
 *
 * @param {string} url
 * @returns {string|null} `owner/repo`，或 null
 */
export function normalizeRemoteRepo(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (s.length === 0) return null;
  // 去掉 scheme：https:// git+https:// ssh:// git://
  const noScheme = s.replace(/^(?:git\+)?(?:https?|ssh|git):\/\//i, "");
  // 去掉 user@（git@ / ssh 形式）
  const noUser = noScheme.replace(/^[^@/]+@/, "");
  // github.com 后的分隔符可能是 `/`（URL）或 `:`（scp-like）
  const m = /^github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(noUser);
  if (m === null) return null;
  return m[1] + "/" + m[2];
}

/**
 * 该 URL 是否指向给定仓库（`owner/repo`），忽略 HTTPS / SSH / `git+` 等形式差异。
 * @param {string} url
 * @param {string} expectedRepo
 */
export function isSameRepo(url, expectedRepo) {
  const got = normalizeRemoteRepo(url);
  return got !== null && got.toLowerCase() === String(expectedRepo).toLowerCase();
}

/** `v<version>` tag。 */
export function tagOf(pkg = readPkg()) {
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json 缺少 version");
  }
  return "v" + pkg.version;
}

/**
 * `npm pack` 的产物文件名：`<name>-<version>.tgz`。
 * scoped 包按 npm 规则把 `@scope/name` 转成 `scope-name`（去掉 `@`、`/`→`-`），
 * 而不是丢掉 scope。
 * 例：`@whybebabo/dsh-code-nav@0.2.0` → `whybebabo-dsh-code-nav-0.2.0.tgz`
 */
export function tgzNameOf(pkg = readPkg()) {
  const base = String(pkg.name).replace(/^@/, "").replace(/\//g, "-");
  return base + "-" + pkg.version + ".tgz";
}

/** 产物绝对路径。 */
export function tgzPathOf(pkg = readPkg(), root = ROOT) {
  return join(root, tgzNameOf(pkg));
}

/**
 * 校验脚本里**没有**残留写死的其它仓库引用，避免误操作别人的仓库。
 *
 * 覆盖三种写法（原始缺陷正是 `const REPO = "AnakinCao/dsh-code-nav"` 这种裸字符串）：
 * 1. 裸的引号包字符串 `"owner/repo"`；
 * 2. GitHub URL：`https://github.com/owner/repo[.git]`、`git+https://…`、`git@github.com:…`；
 * 3. REST / 上传 API 路径：`/repos/owner/repo`、`api.github.com/repos/…`。
 *
 * @param {string} source 脚本源码
 * @param {string} expectedRepo 期望的当前仓库（owner/repo）
 * @param {string[]} [allowed] 允许出现的其它仓库（例如确实要操作的上游仓库）
 * @returns {string[]} 可疑的写死仓库引用（空数组 = 没问题）
 */
/** MIME 顶级类型：`application/gzip` 这类字符串形状与 `owner/repo` 相同，需排除。 */
const MIME_TOP_LEVEL = new Set([
  "application", "text", "image", "audio", "video", "multipart",
  "message", "font", "model", "example", "chemical",
]);

/** 去掉行注释与块注释（注释里提到某个仓库名不是风险，避免误报）。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * 校验脚本里**没有**残留写死的其它仓库引用，避免误操作别人的仓库。
 *
 * 判定三类「真的会被当作仓库用」的写法（注释已剔除）：
 * 1. 赋给仓库语义变量的裸字符串：`const REPO = "owner/repo"` —— 原始缺陷正是这种；
 * 2. GitHub URL：`https://github.com/owner/repo[.git]`、`git+https://…`、`git@github.com:…`；
 * 3. REST / 上传 API 路径：`/repos/owner/repo`。
 *
 * 刻意不把**任意**引号里的 `x/y` 当仓库：分支名（`feat/x`）、文件路径
 * （`tests/a.spec.ts`）、MIME 类型（`application/gzip`）形状相同，全量匹配只会制造噪音。
 *
 * @param {string} source 脚本源码
 * @param {string} expectedRepo 期望的当前仓库（owner/repo）
 * @param {string[]} [allowed] 允许出现的其它仓库（例如文档里链接的运行期依赖）
 * @returns {string[]} 可疑的写死仓库引用（空数组 = 没问题）
 */
export function hardcodedRepoWarnings(source, expectedRepo, allowed = []) {
  const ok = new Set([expectedRepo, ...allowed]);
  const found = new Set();
  const add = (repo) => {
    if (ok.has(repo)) return;
    if (MIME_TOP_LEVEL.has(repo.split("/")[0])) return;   // application/gzip 等不是仓库
    found.add(repo);
  };
  const text = stripComments(source);
  const OWNER = "[A-Za-z0-9][A-Za-z0-9._-]*";
  const NAME = "[A-Za-z0-9][A-Za-z0-9._-]*";
  const PAIR = "(" + OWNER + "/" + NAME + ")";
  const patterns = [
    // 1) 赋给仓库语义变量的裸字符串（变量名限定，避免分支名 / 文件路径误报）
    new RegExp(
      "\\b[A-Za-z_$]*(?:REPO|FORK|UPSTREAM|OWNER|REMOTE|ORIGIN)[A-Za-z_$]*\\s*[:=]\\s*[\"'`]" + PAIR + "[\"'`]",
      "gi"
    ),
    // 2) 裸 github.com URL。lookbehind 排除 api. / uploads. 子域
    //    （它们的 `/repos/owner/repo` 由 3) 负责，否则会把 `repos/owner` 误当仓库）
    new RegExp("(?<![\\w.-])github\\.com[/:]" + PAIR + "(?:\\.git)?", "g"),
    // 3) REST / 上传 API 路径
    new RegExp("/(?:repos|users)/" + PAIR, "g"),
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) add(m[1].replace(/\.git$/, ""));
  }
  return [...found];
}

/**
 * 决定**同名 Release 资产**该怎么处理 —— 发布脚本幂等性的核心判定。
 *
 * 背景：Release 会按 tag 复用，但资产上传曾经是无条件 `POST /assets?name=<name>`。
 * 同名资产已存在时 GitHub 返回 422 `already_exists`，于是「成功发布后再跑一次」
 * 必然在最后一步失败。
 *
 * 判定顺序（先强后弱，宁可替换也不重复上传）：
 * 1. 远端无同名资产 → 上传；
 * 2. 远端给了 `digest`（`sha256:…`）→ 与本地 sha256 比较：相同跳过，不同替换；
 * 3. 只有 `size` → 比较大小：相同跳过，不同替换；
 * 4. 完全无法比较 → 替换（重复上传只会 422，替换是唯一能收敛的选择）。
 *
 * @param {{name?:string, size?:number, digest?:string}|null|undefined} existing 远端同名资产
 * @param {{sha256?:string, size?:number}} local 本次要上传的产物
 * @returns {{action:"upload"|"skip"|"replace", reason:string}}
 */
export function decideAssetAction(existing, local) {
  if (existing === null || existing === undefined) {
    return { action: "upload", reason: "远端无同名资产" };
  }
  const remoteDigest = typeof existing.digest === "string"
    ? existing.digest.replace(/^sha256:/i, "").toLowerCase()
    : null;
  const localDigest = local && typeof local.sha256 === "string" ? local.sha256.toLowerCase() : null;
  if (remoteDigest !== null && localDigest !== null) {
    return remoteDigest === localDigest
      ? { action: "skip", reason: "同名资产 sha256 一致" }
      : { action: "replace", reason: "同名资产 sha256 不一致" };
  }
  if (typeof existing.size === "number" && local && typeof local.size === "number") {
    return existing.size === local.size
      ? { action: "skip", reason: "同名资产大小一致（远端未提供 digest）" }
      : { action: "replace", reason: "同名资产大小不一致（远端未提供 digest）" };
  }
  return { action: "replace", reason: "无法比较同名资产（缺少 digest / size）" };
}

/**
 * 决定 tag 该怎么处理 —— 防止**重写已发布 tag**。
 *
 * 背景：原实现是 `try { git tag TAG } catch { git tag -f TAG }`，随后无条件
 * `git push -f remote TAG`。对已发布版本重跑脚本时，会把 tag 从原提交悄悄移到当前
 * 提交，而 Release 仍按 tag 复用 —— Release、tag 指向的源码、附件三者版本不一致。
 *
 * 规则（先看远端，再看本地残留 tag）：
 * - 远端已有该 tag：同提交 → `reuse`；不同 → `conflict`（拒绝，绝不 `push -f`）。
 * - 远端没有：本地已有该 tag 且指向 HEAD → `push`（补推上次失败留下的本地 tag）；
 *   本地 tag 指向别处 → `conflict`（推上去就是把错误的提交发布成该版本）。
 * - 两边都没有 → `create`。
 *
 * 比较用**提交 SHA**，因此附注 tag（annotated）也能正确判定 —— 调用方须传
 * `refs/tags/<tag>^{}`（peeled）的值，而不是 tag 对象自身的 SHA。
 *
 * @param {string|null} remoteCommit 远端 tag 指向的提交（不存在为 null / ""）
 * @param {string} localCommit 本地将要发布的提交（HEAD）
 * @param {string|null} [localTagCommit] 本地已存在的同名 tag 指向的提交（不存在为 null / ""）
 * @returns {{action:"create"|"reuse"|"push"|"conflict", reason:string}}
 */
export function decideTagAction(remoteCommit, localCommit, localTagCommit = null) {
  const head = String(localCommit).trim();
  const remote = typeof remoteCommit === "string" ? remoteCommit.trim() : "";
  const local = typeof localTagCommit === "string" ? localTagCommit.trim() : "";
  if (remote !== "") {
    if (remote === head) return { action: "reuse", reason: "远端 tag 已指向同一提交" };
    return {
      action: "conflict",
      reason: "远端 tag 已存在且指向其它提交（" + remote.slice(0, 12) + " ≠ " + head.slice(0, 12) + "）",
    };
  }
  if (local !== "") {
    if (local === head) return { action: "push", reason: "本地 tag 已指向同一提交，仅需补推" };
    return {
      action: "conflict",
      reason: "本地 tag 指向其它提交（" + local.slice(0, 12) + " ≠ " + head.slice(0, 12) + "）",
    };
  }
  return { action: "create", reason: "远端与本地的无此 tag" };
}

/**
 * 从 `git ls-remote --tags <remote> refs/tags/<tag> refs/tags/<tag>^{}` 的输出里
 * 取出该 tag 指向的**提交** SHA（不存在返回 null）。
 *
 * 必须优先取 `^{}`（peeled）行：附注 tag 的普通行给的是 **tag 对象**的 SHA，
 * 不是提交 SHA，直接比较会把「同一个提交」误判成冲突。轻量 tag 则只有普通行。
 *
 * @param {string} stdout ls-remote 输出
 * @param {string} tag 例如 `v0.2.0`
 * @returns {string|null}
 */
export function parseRemoteTagCommit(stdout, tag) {
  if (typeof stdout !== "string") return null;
  const want = "refs/tags/" + tag;
  let plain = null;
  let peeled = null;
  for (const line of stdout.split("\n")) {
    const m = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line.trim());
    if (m === null) continue;
    if (m[2] === want + "^{}") peeled = m[1];
    else if (m[2] === want) plain = m[1];
  }
  return peeled ?? plain;
}
