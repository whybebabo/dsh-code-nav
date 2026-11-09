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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录。 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 跨平台地拼出「如何执行 npm」。
 *
 * Windows 上 `execFileSync("npm.cmd", …)` 会直接 EINVAL —— CreateProcess 不能执行
 * 批处理文件。按可靠性从高到低选：
 * 1. `process.env.npm_execpath`：由 npm 自己注入（`npm run …` / `npm exec` 内），
 *    是 npm-cli.js 的绝对路径，用当前 node 执行它即可，完全可移植；
 * 2. Node 安装目录自带的 `node_modules/npm/bin/npm-cli.js`（官方安装器布局）；
 * 3. Windows 退回 `cmd.exe /d /s /c npm …`；其它平台直接 `npm`。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [execPath]
 * @returns {{cmd:string, args:string[]}}
 */
export function npmInvocation(env = process.env, platform = process.platform, execPath = process.execPath) {
  const npmExecPath = env.npm_execpath;
  if (typeof npmExecPath === "string" && npmExecPath.length > 0) {
    return { cmd: execPath, args: [npmExecPath] };
  }
  if (platform === "win32") {
    const bundled = join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(bundled)) return { cmd: execPath, args: [bundled] };
    return { cmd: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm"] };
  }
  return { cmd: "npm", args: [] };
}

/**
 * 同步执行一次 npm 子命令；失败时抛错（调用方决定是否继续/退出）。
 * 默认工作目录是仓库根目录，stdio 继承（npm 自己的输出可见）。
 * @param {string[]} args 例如 `["test"]` / `["pack", "--dry-run", "--json"]`
 * @param {object} [options] 透传给 execFileSync（可覆盖 cwd/stdio/encoding）
 * @returns {string|Buffer} execFileSync 的 stdout（覆盖 encoding 时是字符串）
 */
export function runNpm(args, options = {}) {
  const invocation = npmInvocation();
  return execFileSync(invocation.cmd, [...invocation.args, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  });
}

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
 * 统计 `test/*.test.mjs` 里全部顶层 `test(` 的数量，供 Release 正文派生。
 * 不能只数 `code-nav.test.mjs`：测试已经拆到多个文件，只数一个会在 Release
 * 正文里写出远小于实际数量的「N/N unit tests pass」。
 * @param {string} [root]
 * @returns {number|null} 读不到 test/ 时返回 null
 */
export function countTests(root = ROOT) {
  try {
    const dir = join(root, "test");
    let total = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".test.mjs")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      total += (source.match(/^test\(/gm) || []).length;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * 经 `git credential fill` 取 GitHub token（沙箱阻断了 GCM 的凭据管道，所以要在
 * 进程内直接问 git，而不是依赖环境变量）。
 *
 * 三个脚本原先各自抄了一遍这段代码，其中「拿不到 token」的分支写法不一致：
 * 有的只 `console.error(e.message)`（可能把带 token 的 git 报错原样打进日志），
 * 有的静默 `process.exit(1)`。统一到这里，并且**只抛错、不打印**：调用方要报告
 * 失败也只允许报告这句话本身，绝不回显 credential 输出。
 *
 * @returns {string} token
 * @throws 取不到 token 时抛错（调用方据此停下，不要回落到匿名请求）
 */
export function readGithubToken() {
  let out = "";
  try {
    out = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
    });
  } catch {
    // 不回显 execFileSync 的错误对象：git 的报错里可能带上凭据助手的路径与提示。
    throw new Error("无法从 git 凭据助手取到 GitHub token（git credential fill 失败）");
  }
  const m = /^password=(.+)$/m.exec(out);
  if (m === null) throw new Error("git 凭据助手没有返回 GitHub token");
  const token = m[1].trim();
  if (token.length === 0) throw new Error("git 凭据助手返回了空的 GitHub token");
  return token;
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
 * - `ssh://git@ssh.github.com:443/o/r.git`（GitHub 官方的 443 端口 SSH 端点；
 *   禁止 github.com:22 出站的网络只能用这条通道，本机的 origin 即是此形式）
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
  // ssh.github.com 是 GitHub 自己的备用 SSH 端点，与 github.com 同一仓库。
  // 端口可有可无（`:443` / `:22`），分隔符可为 `/`（ssh URL）或 `:`（scp-like）。
  const noAlias = noUser.replace(/^ssh\.github\.com(?::\d+)?[/:]/i, "github.com/");
  // github.com 后的分隔符可能是 `/`（URL）或 `:`（scp-like）
  const m = /^github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(noAlias);
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

/**
 * 打印 remote URL 前脱敏：`https://x-access-token:ghp_…@github.com/o/r.git`
 * 这类 URL 的 userinfo 里可能带 PAT，原样打印会进终端历史 / CI 日志。
 * scp 形式（`git@github.com:o/r.git`）没有 `://`，保持不变。
 * @param {string} url
 * @returns {string}
 */
export function redactRemoteUrl(url) {
  if (typeof url !== "string") return url;
  return url
    .replace(/(:\/\/)[^/@\s]+@/g, "$1***@")
    // 兜底：即使 token 出现在别处（例如错误信息拼接），也按常见前缀脱敏。
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, "***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, "***");
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

// ── npm pack 产物（.tgz）的零依赖读取与「新鲜度」校验 ──────────────────────────
//
// 曾经发布脚本只检查同名 `.tgz` 是否存在，于是 pack 之后任何一次源码/文档改动
// 都会让上传的 Release 附件与 tag 指向的源码不一致，而 `npm test` 照样全绿
// （见审查 P0-1）。这里用 **零依赖** 的方式读 tarball：`node:zlib` gunzip +
// 512 字节 ustar 头遍历，不引入 tar 依赖。

/** tar 头块大小。 */
const TAR_BLOCK = 512;

/** 读固定长度字段里的 C 字符串（NUL 截断；超长时截到字段末尾）。 */
function tarString(buffer, start, length) {
  const limit = Math.min(buffer.length, start + length);
  const nul = buffer.indexOf(0, start);
  const end = nul === -1 || nul > limit ? limit : nul;
  return buffer.toString("utf8", start, end);
}

/** 读八进制数字字段（ustar 的 size / mode 等）；空字段或非法值按 0 处理。 */
function tarOctal(buffer, start, length) {
  const text = tarString(buffer, start, length).replace(/\0/g, "").trim();
  if (text.length === 0) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 零依赖解析 `.tar.gz`，返回 `Map<成员名, Buffer>`。
 *
 * 支持 ustar 的 `prefix` 字段（长路径）与 `typeflag`：
 * - `'0'` / `'\0'`（普通文件）：记录内容；
 * - `'x'` / `'g'` / `'K'`（PAX 扩展头 / 全局头 / 长链接名）：跳过，继续读真实条目；
 * - `'L'`（GNU 长文件名）：把下一块的 name 换成它的内容。
 * 目录 / 链接等其它条目直接忽略 —— 发布校验只关心文件内容。
 *
 * @param {Buffer} tgzBuffer `.tar.gz` 的完整字节
 * @returns {Map<string, Buffer>} 成员路径 → 内容
 * @throws 不是有效 gzip / tarball 被截断时抛错
 */
export function readTgzEntries(tgzBuffer) {
  if (!Buffer.isBuffer(tgzBuffer)) throw new TypeError("readTgzEntries 需要 Buffer");
  const tar = gunzipSync(tgzBuffer);
  const entries = new Map();
  let offset = 0;
  let longName = null;
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    // 连续两个全零块是归档结束标记（读到第一个就够了）。
    if (header.every((byte) => byte === 0)) break;
    const size = tarOctal(header, 124, 12);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const dataStart = offset + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error("tarball 被截断：条目 " + tarString(header, 0, 100) + " 需要 " + size + " 字节，实际只剩 " + (tar.length - dataStart));
    }
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (type === "x" || type === "g" || type === "K") continue;   // PAX / 长链接名：不是文件内容
    if (type === "L") { longName = tarString(data, 0, data.length).replace(/\0+$/, ""); continue; }
    if (type !== "0" && type !== "7") continue;                    // 目录 / 链接等不参与校验
    let name = longName !== null ? longName : tarString(header, 0, 100);
    longName = null;
    const prefix = tarString(header, 345, 155);
    if (prefix.length > 0) name = prefix + "/" + name;
    entries.set(name.replace(/^\.\//, ""), data);
  }
  return entries;
}

/**
 * 从 `.tar.gz` 里读一个成员；不存在返回 null。
 * @param {Buffer} tgzBuffer `.tar.gz` 的完整字节
 * @param {string} member 成员路径，例如 `package/package.json`
 * @returns {Buffer|null}
 */
export function readTgzEntry(tgzBuffer, member) {
  if (typeof member !== "string" || member.length === 0) {
    throw new TypeError("readTgzEntry 需要成员路径字符串");
  }
  const wanted = member.replace(/^\.\//, "").replace(/^\//, "");
  const found = readTgzEntries(tgzBuffer).get(wanted);
  return found === undefined ? null : found;
}

/** 字符串 / Buffer 的 sha256（hex 小写）。 */
function sha256Of(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** 文本判定：含 NUL 字节视为二进制；本仓库打包的运行期文件都是 UTF-8 文本。 */
function isTextBuffer(buffer) {
  return buffer.indexOf(0) === -1;
}

/**
 * 文件内容是否等价：文本按 CRLF/CR→LF 归一后比较（同一份内容在 Windows 的
 * `core.autocrlf` / 编辑器下是 CRLF，而 npm pack 原样打包工作区字节，不归一就会
 * 把「只是换行符不同」误判成不一致）；二进制（含 NUL）按原始字节比较。
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
function sameFileContent(a, b) {
  if (isTextBuffer(a) && isTextBuffer(b)) {
    const normalize = (buffer) => buffer.toString("utf8").replace(/\r\n?/g, "\n");
    return normalize(a) === normalize(b);
  }
  return a.equals(b);
}

/**
 * 校验发布产物是否由**当前这棵树**生成（审查 P0-1 / REL-1 的正式修复）。
 *
 * 检查三件事：
 * 1. tarball 内 `package/package.json` 的 `version` 必须等于 `version` 参数
 *    （挡住「把旧版本的包改名成当前版本」）；
 * 2. tarball 内 `package/lib/client.js` 的 sha256 必须等于 `buildCode` 的 sha256
 *    （挡住「pack 之后又改了源码/模板」）；
 * 3. 传入 `root` 时，tarball 内**每一个普通文件**（不只 lib/client.js）都必须与
 *    工作区同名文件内容一致，文本按 CRLF→LF 归一后比较。只比对 client.js 时，
 *    pack 之后修改 `lib/index.js`（host 入口）/ `cordis.patch.yml`（bundle 补丁）/
 *    两份 README 会漏检：产物照样报 fresh，但附件里的入口或补丁已与 tag 指向的
 *    源码不一致（REL-1）。
 *
 * 刻意**不抛业务错误**：返回 `{fresh, reasons}`，调用方决定打印/退出 ——
 * live 发布必须据此拒绝，dry-run 只打印而不改变 exit 0。只有参数类型错误才抛。
 *
 * `root` 可选：fixture / 纯函数测试没有工作区可比，省略时只做第 1、2 项，保持
 * 旧调用方式与返回字段不变（`tarballSha256` 仍是 client.js 的哈希）。
 *
 * @param {{tgzPath:string, version:string, buildCode:string, root?:string|null}} options
 * @returns {{fresh:boolean, reasons:string[], tgzPath:string, expectedVersion:string,
 *   tarballVersion:string|null, expectedSha256:string, tarballSha256:string|null,
 *   worktreeRoot:string|null, files:Array<{path:string,tarballSha256:string,
 *   worktreeSha256:string,status:"same"|"different"}>, mismatchedFiles:string[]}}
 */
export function checkArtifactFreshness({ tgzPath, version, buildCode, root = null } = {}) {
  if (typeof tgzPath !== "string" || tgzPath.length === 0) throw new TypeError("checkArtifactFreshness: tgzPath 必须是非空字符串");
  if (typeof version !== "string" || version.length === 0) throw new TypeError("checkArtifactFreshness: version 必须是非空字符串");
  if (typeof buildCode !== "string" || buildCode.length === 0) throw new TypeError("checkArtifactFreshness: buildCode 必须是非空字符串");
  if (root !== null && root !== undefined && (typeof root !== "string" || root.length === 0)) {
    throw new TypeError("checkArtifactFreshness: root 如果传入，必须是非空字符串");
  }
  const worktreeRoot = root === null || root === undefined ? null : resolve(root);
  const result = {
    fresh: false,
    reasons: [],
    tgzPath,
    expectedVersion: version,
    tarballVersion: null,
    expectedSha256: sha256Of(buildCode),
    tarballSha256: null,
    worktreeRoot,
    files: [],
    mismatchedFiles: [],
  };
  let tgzBuffer;
  try {
    tgzBuffer = readFileSync(tgzPath);
  } catch (error) {
    result.reasons.push("无法读取产物 " + tgzPath + "：" + String(error && error.message ? error.message : error));
    return result;
  }
  let entries;
  try {
    entries = readTgzEntries(tgzBuffer);
  } catch (error) {
    result.reasons.push("无法解开 tarball（不是有效的 .tar.gz）：" + String(error && error.message ? error.message : error));
    return result;
  }
  const pkgEntry = entries.get("package/package.json") ?? null;
  if (pkgEntry === null) {
    result.reasons.push("tarball 里缺少 package/package.json");
  } else {
    try {
      const meta = JSON.parse(pkgEntry.toString("utf8"));
      if (typeof meta.version === "string") result.tarballVersion = meta.version;
    } catch {
      result.reasons.push("tarball 里的 package/package.json 不是合法 JSON");
    }
    if (result.tarballVersion === null) {
      result.reasons.push("tarball 里的 package/package.json 缺少 version 字段");
    } else if (result.tarballVersion !== version) {
      result.reasons.push("tarball 版本 " + result.tarballVersion + " 与 package.json 版本 " + version + " 不一致");
    }
  }
  const clientEntry = entries.get("package/lib/client.js") ?? null;
  if (clientEntry === null) {
    result.reasons.push("tarball 里缺少 package/lib/client.js");
  } else {
    result.tarballSha256 = sha256Of(clientEntry);
    if (result.tarballSha256 !== result.expectedSha256) {
      result.reasons.push(
        "tarball 内 lib/client.js 与当前构建不一致（tarball " + result.tarballSha256.slice(0, 12) +
        "… ≠ 当前 " + result.expectedSha256.slice(0, 12) + "…）"
      );
    }
  }
  // 3) 逐文件校验：tarball 里每个普通文件都必须与工作区同名文件一致。
  //    这是 REL-1 的修复：只比 client.js 会漏掉 lib/index.js / cordis.patch.yml /
  //    README 等「没有内联进 bundle」的文件，pack 之后再改它们仍会被判 fresh。
  //    readTgzEntries 只收普通文件（typeflag '0'/'7'），目录 / 链接 / PAX 头已过滤。
  if (worktreeRoot !== null) {
    const members = [...entries.keys()]
      .filter((name) => name === "package" || name.startsWith("package/"))
      .map((name) => ({ member: name, path: name.replace(/^package\/?/, "") }))
      .filter(({ path }) => path.length > 0)
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const { member, path } of members) {
      const absolute = resolve(worktreeRoot, path);
      const fromRoot = relative(worktreeRoot, absolute);
      // 防目录穿越：tarball 成员路径解析后必须仍在工作区内。
      if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
        result.reasons.push("tarball 里的成员路径越出包根：" + member);
        result.mismatchedFiles.push(path);
        continue;
      }
      const tarballBuffer = entries.get(member);
      let worktreeBuffer;
      try {
        worktreeBuffer = readFileSync(absolute);
      } catch (error) {
        result.reasons.push(
          "tarball 里的 " + path + " 在工作区不存在（" +
          String(error && error.code ? error.code : error) + "）"
        );
        result.mismatchedFiles.push(path);
        continue;
      }
      const record = {
        path,
        tarballSha256: sha256Of(tarballBuffer),
        worktreeSha256: sha256Of(worktreeBuffer),
        status: "same",
      };
      if (!sameFileContent(tarballBuffer, worktreeBuffer)) {
        record.status = "different";
        result.mismatchedFiles.push(path);
        result.reasons.push(
          "tarball 里的 " + path + " 与工作区不一致（tarball " + record.tarballSha256.slice(0, 12) +
          "… ≠ 工作区 " + record.worktreeSha256.slice(0, 12) + "…）"
        );
      }
      result.files.push(record);
    }
  }
  result.fresh = result.reasons.length === 0;
  return result;
}

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
 * 判定顺序（先强后弱，宁可替换也不留错产物）：
 * 1. 远端无同名资产 → 上传；
 * 2. 远端给了 `digest`（`sha256:…`）→ 与本地 sha256 比较：相同跳过，不同替换；
 * 3. 只有 `size` → **替换**：大小相等证明不了内容相同，而 GitHub 的资产 `digest`
 *    经常是 null（尤其是经 UI / 旧接口上传的），拿大小当「已经一样」会把错产物
 *    永久留在已发布版本上 —— 重传一次是幂等的，留错文件不是。
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
    // 大小相等**不能**证明内容相同，且远端 digest 常常缺失；替换才能收敛，
    // skip 会把可能不同的产物永久挂在已发布版本上。
    return existing.size === local.size
      ? { action: "replace", reason: "远端未提供 digest，大小一致不足以判定内容相同（替换）" }
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

/**
 * 从发布说明正文里推导 Release 标题：取第一个 Markdown 标题（`#` … `######`），
 * 去掉井号；没有标题时回退到调用方给的 fallback（通常是 tag）。
 *
 * better-workspace 的 Release 标题形如 `v0.1.10 — 一句话总结`，正文第一行是
 * 同名 `##` 标题。让脚本从 notes 文件推导标题，发布时就不会出现「正文很完整、
 * 标题仍只有 tag」的半成品；需要覆盖时仍可用 `--title` 显式指定。
 *
 * @param {unknown} notes 发布说明 Markdown
 * @param {string} [fallback]
 * @returns {string}
 */
export function releaseTitleFromNotes(notes, fallback = "") {
  if (typeof notes !== "string") return typeof fallback === "string" ? fallback.trim() : "";
  for (const line of notes.split(/\r?\n/)) {
    const text = line.trim();
    const match = /^#{1,6}\s+(.+)$/.exec(text);
    if (match !== null) {
      const title = match[1].trim();
      if (title !== "") return title;
    }
  }
  return typeof fallback === "string" ? fallback.trim() : "";
}
