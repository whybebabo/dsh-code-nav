/**
 * dsh-code-nav — 发布 / CI 加固的回归测试（task-11）。
 *
 * 覆盖这些不需要网络的行为：
 *  1. `scripts/verify-pack.mjs` 的打包内容校验（纯函数 `verifyPackJson`，含非空/最小体积）；
 *  2. `scripts/repo-topics.mjs` 的参数解析（默认 dry-run / --yes / 未知 flag 报错）；
 *  3. `scripts/pr-better-sidebar.mjs` 的 PR 幂等判定、422 可读提示与 origin 脱敏；
 *  4. 发布脚本在「没有 tgz」时 `--dry-run` 仍打印计划并 exit 0（子进程 + 临时 fixture）；
 *  5. 零依赖 tar.gz 读取（`readTgzEntry`）与发布产物新鲜度（`checkArtifactFreshness`）。
 *
 * 所有 fixture 都写在系统临时目录；不触碰真实 network / 凭据 / 仓库。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { REQUIRED_FILES, parsePackJson, verifyPackJson } from "../scripts/verify-pack.mjs";
import { DEFAULT_TOPICS, mergeTopics, parseArgs } from "../scripts/repo-topics.mjs";
import { decidePrAction, explainPrCreateFailure, cloneOriginMatchesUpstream } from "../scripts/pr-better-sidebar.mjs";
import { npmInvocation, readTgzEntry, checkArtifactFreshness, releaseTitleFromNotes } from "../scripts/release-config.mjs";

const SCRIPT_DIR = fileURLToPath(new URL("../scripts/", import.meta.url));

/** 各必需文件在 fixture 里的「正常」体积：lib/client.js 有 100_000 字节下限。 */
const FILE_SIZES = {
  "lib/client.js": 215_749,
  "lib/index.js": 899,
  "package.json": 1_881,
  "cordis.patch.yml": 1_369,
  "README.md": 19_940,
  "README_EN.md": 22_085,
  "LICENSE": 1_073
};

/** 造一个 `npm pack --json` 形状的 fixture（files 可覆盖/删除）。 */
function packJsonOf(files, extra = {}) {
  return [{
    name: "@t/pkg",
    version: "1.2.3",
    filename: "t-pkg-1.2.3.tgz",
    files: files.map((path) => ({ path, size: FILE_SIZES[path] ?? 10, mode: 420 })),
    ...extra,
  }];
}

/** 改 fixture 里某个文件的 size（用于 0 字节 / 过小 / 缺 size 的用例）。 */
function withSize(json, path, size) {
  const entry = json[0].files.find((file) => file.path === path);
  assert.ok(entry, "fixture 里没有 " + path);
  if (size === undefined) delete entry.size;
  else entry.size = size;
  return json;
}

const ALL_FILES = [...REQUIRED_FILES, "LICENSE"];

// ---------- npm 调用（Windows 上 npm.cmd 不能被 execFileSync 直接 spawn） ----------

test("npm invocation: uses npm_execpath when present, otherwise a platform-appropriate command", () => {
  const explicit = npmInvocation({ npm_execpath: "C:/npm/npm-cli.js" }, "win32", "C:/node/node.exe");
  assert.deepEqual(explicit, { cmd: "C:/node/node.exe", args: ["C:/npm/npm-cli.js"] });
  assert.deepEqual(npmInvocation({}, "linux", "/usr/bin/node"), { cmd: "npm", args: [] });
  // Windows 且找不到随 Node 安装的 npm-cli.js → 退回 cmd.exe /c npm
  const fallback = npmInvocation({ ComSpec: "C:/Windows/System32/cmd.exe" }, "win32", "C:/definitely-missing/node.exe");
  assert.equal(fallback.cmd, "C:/Windows/System32/cmd.exe");
  assert.deepEqual(fallback.args, ["/d", "/s", "/c", "npm"]);
});

// ---------- verify-pack ----------

test("verify-pack: a complete tarball passes and reports its files", () => {
  const result = verifyPackJson(packJsonOf(ALL_FILES));
  assert.equal(result.name, "@t/pkg");
  assert.equal(result.version, "1.2.3");
  assert.deepEqual([...result.files].sort(), [...ALL_FILES].sort());
});

test("verify-pack: missing cordis.patch.yml fails loudly", () => {
  const files = ALL_FILES.filter((path) => path !== "cordis.patch.yml");
  assert.throws(
    () => verifyPackJson(packJsonOf(files)),
    (error) => {
      assert.match(String(error.message), /cordis\.patch\.yml/);
      assert.match(String(error.message), /缺少必需文件/);
      return true;
    }
  );
});

test("verify-pack: missing lib/client.js fails and names the file", () => {
  const files = ALL_FILES.filter((path) => path !== "lib/client.js");
  assert.throws(() => verifyPackJson(packJsonOf(files)), /lib\/client\.js/);
});

test("verify-pack: accepts a bare object and package/ prefixed paths", () => {
  const json = { files: REQUIRED_FILES.map((path) => ({ path: "package/" + path, size: FILE_SIZES[path] })) };
  const result = verifyPackJson(json);
  assert.deepEqual([...result.files].sort(), [...REQUIRED_FILES].sort());
  // size 同样要归一化到包根相对路径，供体积校验使用
  assert.equal(result.sizes.get("lib/client.js"), FILE_SIZES["lib/client.js"]);
});

test("verify-pack: a 0-byte lib/client.js fails instead of faking green", () => {
  // 审查 P2-1：`Set-Content lib/client.js ""` 之后旧校验仍输出 OK / exit 0。
  assert.throws(
    () => verifyPackJson(withSize(packJsonOf(ALL_FILES), "lib/client.js", 0)),
    (error) => {
      assert.match(String(error.message), /lib\/client\.js 0 字节/);
      assert.match(String(error.message), /最小 100000 字节/);
      return true;
    }
  );
});

test("verify-pack: a suspiciously small lib/client.js fails", () => {
  // 只要「存在」不要体积时，一个截断的 bundle（例如 1 KB）也能过。
  assert.throws(
    () => verifyPackJson(withSize(packJsonOf(ALL_FILES), "lib/client.js", 99_999)),
    /lib\/client\.js 99999 字节/
  );
});

test("verify-pack: any other required file must be non-empty", () => {
  assert.throws(
    () => verifyPackJson(withSize(packJsonOf(ALL_FILES), "README.md", 0)),
    /README\.md 0 字节/
  );
  assert.throws(
    () => verifyPackJson(withSize(packJsonOf(ALL_FILES), "lib/index.js", 0)),
    /lib\/index\.js 0 字节/
  );
});

test("verify-pack: a missing size is a failure, never a silent pass", () => {
  // 缺失 size 时不能假设「存在即合格」——那正是假绿的来源。
  assert.throws(
    () => verifyPackJson(withSize(packJsonOf(ALL_FILES), "cordis.patch.yml", undefined)),
    (error) => {
      assert.match(String(error.message), /未给出必需文件的 size/);
      assert.match(String(error.message), /cordis\.patch\.yml/);
      return true;
    }
  );
});

test("verify-pack: rejects a non-object / missing files payload", () => {
  assert.throws(() => verifyPackJson(null), /不是对象/);
  assert.throws(() => verifyPackJson({ filename: "x.tgz" }), /files/);
});

test("verify-pack: parsePackJson tolerates surrounding noise, rejects empty", () => {
  const json = packJsonOf(ALL_FILES);
  const parsed = parsePackJson("noise line\n" + JSON.stringify(json) + "\ntrailing");
  assert.deepEqual(parsed, json);
  assert.throws(() => parsePackJson("   "), /没有输出/);
});

// ---------- 发布产物解析（零依赖 tar.gz）与产物新鲜度 ----------

/**
 * 手工构造一个最小 ustar tarball 再 gzip，专供解析测试（零依赖，不引 tar 包）。
 * 每项 `{name, data, prefix?, type?}`：type 省略即普通文件；prefix 用于 ustar 的
 * prefix 字段（>100 字符的路径会用到）。
 */
function tgzOf(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "", "utf8");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(0x20, 148, 156);                     // 校验和字段先填空格
    header.write(entry.type ?? "0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    if (entry.prefix) header.write(entry.prefix, 345, 155, "utf8");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));                   // 结束标记
  return gzipSync(Buffer.concat(chunks));
}

/** 造一个带 package.json + lib/client.js 的真实形状 tarball 文件。 */
function freshnessFixture(version = "1.2.3", clientCode = "const bundle = 1;\n") {
  const dir = mkdtempSync(join(tmpdir(), "cn-fresh-"));
  const tgzPath = join(dir, "t-pkg-1.2.3.tgz");
  writeFileSync(tgzPath, tgzOf([
    { name: "package/package.json", data: JSON.stringify({ name: "@t/pkg", version }) },
    { name: "package/lib/client.js", data: clientCode },
  ]));
  return { dir, tgzPath, clientCode };
}

test("release: readTgzEntry reads npm pack members (name / prefix / PAX skipped)", () => {
  const tgz = tgzOf([
    { name: "package/pax-header", type: "x", data: "30 mtime=1\n" },
    { name: "package/package.json", data: '{"version":"1.2.3"}' },
    { name: "client.js", prefix: "package/lib", data: "bundle" },
  ]);
  assert.equal(readTgzEntry(tgz, "package/package.json").toString("utf8"), '{"version":"1.2.3"}');
  // ustar 的 prefix 字段要拼成完整路径
  assert.equal(readTgzEntry(tgz, "package/lib/client.js").toString("utf8"), "bundle");
  assert.equal(readTgzEntry(tgz, "package/nope.js"), null);
});

test("release: checkArtifactFreshness accepts a tarball built from the current tree", () => {
  const { tgzPath, clientCode } = freshnessFixture();
  const result = checkArtifactFreshness({ tgzPath, version: "1.2.3", buildCode: clientCode });
  assert.equal(result.fresh, true, result.reasons.join("; "));
  assert.deepEqual(result.reasons, []);
  assert.equal(result.tarballVersion, "1.2.3");
  assert.equal(result.tarballSha256, result.expectedSha256);
});

test("release: checkArtifactFreshness rejects a stale bundle and a mismatched version", () => {
  const { tgzPath, clientCode } = freshnessFixture();
  const stale = checkArtifactFreshness({ tgzPath, version: "1.2.3", buildCode: "const bundle = 2;\n" });
  assert.equal(stale.fresh, false);
  assert.match(stale.reasons.join("\n"), /lib\/client\.js 与当前构建不一致/);
  assert.notEqual(stale.tarballSha256, stale.expectedSha256);
  const wrongVersion = checkArtifactFreshness({ tgzPath, version: "9.9.9", buildCode: clientCode });
  assert.equal(wrongVersion.fresh, false);
  assert.match(wrongVersion.reasons.join("\n"), /tarball 版本 1\.2\.3 与 package\.json 版本 9\.9\.9 不一致/);
});

test("release: checkArtifactFreshness fails closed on missing members / invalid gzip", () => {
  const dir = mkdtempSync(join(tmpdir(), "cn-fresh-bad-"));
  const noClient = join(dir, "no-client.tgz");
  writeFileSync(noClient, tgzOf([{ name: "package/package.json", data: '{"version":"1.2.3"}' }]));
  const missing = checkArtifactFreshness({ tgzPath: noClient, version: "1.2.3", buildCode: "x" });
  assert.equal(missing.fresh, false);
  assert.match(missing.reasons.join("\n"), /缺少 package\/lib\/client\.js/);

  const notGzip = join(dir, "bad.tgz");
  writeFileSync(notGzip, "definitely not gzip");
  const invalid = checkArtifactFreshness({ tgzPath: notGzip, version: "1.2.3", buildCode: "x" });
  assert.equal(invalid.fresh, false);
  assert.match(invalid.reasons.join("\n"), /无法解开 tarball/);

  const absent = checkArtifactFreshness({ tgzPath: join(dir, "absent.tgz"), version: "1.2.3", buildCode: "x" });
  assert.equal(absent.fresh, false);
  assert.match(absent.reasons.join("\n"), /无法读取产物/);
});

test("release: the freshness gate sits after npm test and before the token / remote writes", () => {
  const code = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  // lastIndexOf：dry-run 分支里还有一次只读校验，live 门禁是后面那次。
  const freshnessAt = code.lastIndexOf("checkArtifactFreshness(");
  const testAt = code.indexOf('runNpm(["test"]');
  assert.ok(freshnessAt > 0, "live 路径缺少产物新鲜度门禁");
  assert.ok(freshnessAt > testAt, "新鲜度检查必须在 npm test 之后");
  assert.ok(freshnessAt < code.indexOf("readGithubToken()"), "新鲜度检查必须在取凭据之前");
  assert.ok(freshnessAt < code.indexOf('"push", "-u"'), "新鲜度检查必须在 push 之前");
  assert.ok(freshnessAt < code.indexOf('"/releases"'), "新鲜度检查必须在创建 Release 之前");
});

// ---------- repo-topics ----------

test("repo-topics: default is a dry run, --yes switches to write mode", () => {
  const dry = parseArgs([]);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.yes, false);
  assert.deepEqual(dry.topics, []);
  const write = parseArgs(["--yes"]);
  assert.equal(write.dryRun, false);
  assert.equal(write.yes, true);
  // 显式 --dry-run 与默认等价
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
});

test("repo-topics: positional arguments become topics; --help is recognised", () => {
  const options = parseArgs(["--yes", "alpha", "beta"]);
  assert.deepEqual(options.topics, ["alpha", "beta"]);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("repo-topics: an unknown --flag is an error, never a topic", () => {
  assert.throws(() => parseArgs(["--dryrun"]), /未知选项/);
  assert.throws(() => parseArgs(["-x"]), /未知选项/);
  assert.throws(() => parseArgs(["--yes", "--dry-run"]), /不能同时使用/);
});

test("repo-topics: mergeTopics keeps existing order, appends missing, dedupes", () => {
  assert.deepEqual(mergeTopics(["dsh", "plugin"], ["plugin", "code-preview"]), ["dsh", "plugin", "code-preview"]);
  assert.deepEqual(mergeTopics(undefined, DEFAULT_TOPICS), DEFAULT_TOPICS);
  assert.equal(new Set(DEFAULT_TOPICS).size, DEFAULT_TOPICS.length, "默认 topics 不能有重复");
});

// ---------- pr-better-sidebar ----------

test("pr: the clone origin must normalise to the better-sidebar upstream", () => {
  for (const url of [
    "https://github.com/omdsh-dev/DSH-better-sidebar.git",
    "git@github.com:omdsh-dev/DSH-better-sidebar.git",
    "ssh://git@github.com/omdsh-dev/DSH-better-sidebar",
    "https://github.com/Omdsh-Dev/dsh-better-sidebar",
  ]) {
    assert.equal(cloneOriginMatchesUpstream(url), true, "应识别为上游: " + url);
  }
  for (const url of [
    "https://github.com/whybebabo/dsh-code-nav.git",
    "https://github.com/whybebabo/DSH-better-sidebar.git",
    "",
    "not a url",
  ]) {
    assert.equal(cloneOriginMatchesUpstream(url), false, "不应识别为上游: " + url);
  }
});

test("pr: an existing open PR is reused instead of posted again", () => {
  const decision = decidePrAction([
    { number: 7, state: "open", html_url: "https://github.com/omdsh-dev/DSH-better-sidebar/pull/7" },
  ]);
  assert.equal(decision.action, "reuse");
  assert.equal(decision.url, "https://github.com/omdsh-dev/DSH-better-sidebar/pull/7");
  assert.equal(decision.number, 7);
});

test("pr: no open PR for the head means create; closed PRs do not count", () => {
  assert.equal(decidePrAction([]).action, "create");
  assert.equal(decidePrAction(undefined).action, "create");
  assert.equal(
    decidePrAction([{ state: "closed", html_url: "https://github.com/x/y/pull/1" }]).action,
    "create"
  );
});

test("pr: a 422 create failure explains the idempotent retry path", () => {
  const message = explainPrCreateFailure(422, { message: "Validation Failed" });
  assert.match(message, /已经存在/);
  assert.match(message, /DSH-better-sidebar\/pulls/);
  assert.match(explainPrCreateFailure(500, {}), /HTTP 500/);
});

test("pr: the clone origin is redacted before it reaches the log", () => {
  // remote URL 的 userinfo 里可能内嵌 PAT，原样打印会进终端历史 / CI 日志（审查 P1-4）。
  const src = readFileSync(new URL("../scripts/pr-better-sidebar.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("redactRemoteUrl(cloneOrigin)"), "clone origin 打印前没有过 redactRemoteUrl");
  assert.ok(!/console\.error\([^\n]*\+ cloneOrigin\b/.test(src), "仍有 console.error 直接拼接 cloneOrigin");
});

test("pr: the token is only fetched after all local clone checks", () => {
  const src = readFileSync(new URL("../scripts/pr-better-sidebar.mjs", import.meta.url), "utf8");
  const tokenAt = src.indexOf("readGithubToken()");
  assert.ok(tokenAt > 0, "PR 脚本没有使用共享的取 token helper");
  // 本地校验（clone 存在 / origin 指向上游）全部通过之后才去触发凭据助手。
  assert.ok(tokenAt > src.indexOf("cloneOriginMatchesUpstream(cloneOrigin)"), "取 token 早于本地 origin 校验");
  assert.ok(tokenAt > src.indexOf("clone 缺少 origin remote"), "取 token 早于本地 clone 校验");
});

// ---------- release dry-run 行为（子进程，不写仓库） ----------

/** 在临时目录造一个最小 repo：package.json + 发布脚本，没有 .git / 没有 tgz。 */
function releaseFixture() {
  const dir = mkdtempSync(join(tmpdir(), "cn-release-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(join(SCRIPT_DIR, "release-code-nav.mjs"), join(dir, "scripts", "release-code-nav.mjs"));
  copyFileSync(join(SCRIPT_DIR, "release-config.mjs"), join(dir, "scripts", "release-config.mjs"));
  // release-code-nav.mjs 现在静态 import ./build.mjs 取当前构建（产物新鲜度校验），
  // fixture 也必须带上它，否则连「打印计划」都跑不起来。
  copyFileSync(join(SCRIPT_DIR, "build.mjs"), join(dir, "scripts", "build.mjs"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "@t/pkg",
    version: "1.2.3",
    description: "fixture",
    repository: { type: "git", url: "git+https://github.com/t/pkg.git" },
  }, null, 2));
  return dir;
}

test("release: --dry-run prints the plan and exits 0 even when the tarball is missing", () => {
  const dir = releaseFixture();
  const env = { ...process.env };
  delete env.npm_execpath;
  const result = spawnSync(process.execPath, [join(dir, "scripts", "release-code-nav.mjs"), "--dry-run"], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, "dry-run 应 exit 0；stderr: " + result.stderr);
  assert.match(result.stdout, /release plan/);
  assert.match(result.stdout, /package   : @t\/pkg@1\.2\.3/);
  assert.match(result.stdout, /tag       : v1\.2\.3/);
  assert.match(result.stdout, /\(MISSING\)/);
  assert.match(result.stdout, /产物不存在/);
  assert.match(result.stdout, /dry run/);
  assert.match(result.stdout, /未推送、未打 tag、未创建 Release/);
});

test("release: a bare invocation still refuses to act (exit 1, no writes)", () => {
  const dir = releaseFixture();
  const env = { ...process.env };
  delete env.npm_execpath;
  const result = spawnSync(process.execPath, [join(dir, "scripts", "release-code-nav.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少动作标志/);
  assert.match(result.stderr, /未推送、未打 tag、未创建 Release/);
});

test("release: live path runs npm test before credentials or any remote write", () => {
  // 静态顺序哨兵：这条门禁不能因为重构被挪到 push 之后（无法在不触网的前提下单测）。
  const code = readFileSync(new URL("../scripts/release-code-nav.mjs", import.meta.url), "utf8");
  const testGate = code.indexOf('runNpm(["test"]');
  assert.ok(testGate > 0, "缺少 npm test 门禁");
  assert.ok(testGate < code.indexOf("readGithubToken()"), "npm test 必须在取凭据之前");
  assert.ok(testGate < code.indexOf('"push", "-u"'), "npm test 必须在 push 之前");
  assert.ok(!code.includes('"--skip-tests"'), "不得提供 --skip-tests 逃生阀");
  assert.ok(!code.includes('includes("--skip-tests")'), "不得解析 --skip-tests");
});

test("release notes: the title derives from the first markdown heading", () => {
  assert.equal(releaseTitleFromNotes("## v0.5.0 — large files\n\nbody", "v0.5.0"), "v0.5.0 — large files");
  assert.equal(releaseTitleFromNotes("# Just a title\n", "v0.1.0"), "Just a title");
  assert.equal(releaseTitleFromNotes("body without a heading", "v0.1.0"), "v0.1.0");
  assert.equal(releaseTitleFromNotes(null, "v0.1.0"), "v0.1.0");
  assert.equal(releaseTitleFromNotes("", ""), "");
  assert.equal(releaseTitleFromNotes("###\n", "fallback"), "fallback");
});
