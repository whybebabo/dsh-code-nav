/**
 * dsh-code-nav — 发布产物新鲜度门禁的回归测试（REL-1 修复）。
 *
 * 旧门禁只比对 tarball 里的 `package/lib/client.js` 与 `package/package.json` 版本，
 * 于是「pack 之后又改了 `lib/index.js` / `cordis.patch.yml`」时仍然报 fresh，
 * 发布附件与 tag 指向的源码不一致（审查 REL-1）。
 *
 * 现在 `checkArtifactFreshness({root})` 会校验 tarball 里**每一个普通文件**与
 * 工作区同名文件一致（文本按 CRLF→LF 归一后比较）。
 *
 * 所有 fixture 都在系统临时目录里复制仓库 + 真实 `npm pack`，不写仓库、不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { checkArtifactFreshness, readPkg, readTgzEntries, runNpm, tgzNameOf } from "../scripts/release-config.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 仓库根现有的 tgz 快照：确认测试不会往仓库里丢产物。 */
function repoRootTarballs() {
  return readdirSync(REPO_ROOT).filter((name) => name.endsWith(".tgz")).sort();
}

/**
 * 用 `git archive HEAD` 造一个临时工作区副本（零依赖：git archive 的 tar 再 gzip，
 * 复用发布脚本自己的 tar 读取器把它落盘）。
 *
 * 刻意从 HEAD 取快照而不是 cp 当前工作区：release 本来也要求干净工作区，
 * 而且并行开发时工作区可能有其它未提交改动 / 未重新构建的 src，用 HEAD 才能
 * 得到「src 与已提交 lib/client.js 自洽」的树（prepack 构建才有意义）。
 */
function makeWorktree(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  const tarBuffer = execFileSync("git", ["-C", REPO_ROOT, "archive", "--format=tar", "HEAD"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = readTgzEntries(gzipSync(tarBuffer));
  for (const [name, data] of entries) {
    const relative = name.replace(/^\.\//, "");
    if (relative.length === 0 || relative.startsWith("/") || relative.split("/").includes("..")) continue;
    const target = join(work, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return { dir, work };
}

/**
 * 在临时工作区里真实 `npm pack`（产物落在 `<dir>/tarballs/`，不碰真实工作区）。
 *
 * 用 `--ignore-scripts`：本测试校验的是「tarball 内容 vs 工作区」，而不是 npm
 * 生命周期；跳过 prepack 也让测试不依赖构建产物是否刚好与并行改动同步
 * （「committed bundle == fresh build」由其它门禁/测试负责）。`buildCode` 取
 * 快照里已提交的 client bundle——这正是真实发布时 `npm pack` 会打进包里的内容。
 * @param {string} dir 临时根目录
 * @param {string} work 工作区副本（git HEAD 快照）
 */
function packWorktree(dir, work) {
  const destination = join(dir, "tarballs");
  mkdirSync(destination, { recursive: true });
  const pkg = readPkg(work);
  runNpm(["pack", "--silent", "--ignore-scripts", "--pack-destination", destination], {
    cwd: work,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tgzPath = join(destination, tgzNameOf(pkg));
  assert.ok(existsSync(tgzPath), "npm pack 没有产出 " + tgzPath);
  return { tgzPath, version: pkg.version, buildCode: readFileSync(join(work, "lib", "client.js"), "utf8") };
}

test("release-fixes: a real npm pack of an unchanged tree is fresh and every packed file is compared", () => {
  const tarballsBefore = repoRootTarballs();
  const { dir, work } = makeWorktree("cn-relfix-ok-");
  try {
    const { tgzPath, version, buildCode } = packWorktree(dir, work);
    const result = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(result.fresh, true, "未改动的工作区应判 fresh：\n" + result.reasons.join("\n"));
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.mismatchedFiles, []);
    assert.equal(result.worktreeRoot, work);
    // 必须真的逐文件对比，而不是只比 lib/client.js
    const compared = result.files.map((file) => file.path).sort();
    assert.ok(result.files.length >= 7, "应比对全部打包文件，实际 " + result.files.length);
    for (const required of [
      "package.json",
      "LICENSE",
      "lib/client.js",
      "lib/index.js",
      "cordis.patch.yml",
      "README.md",
      "README_EN.md",
    ]) {
      assert.ok(compared.includes(required), "没有比对打包成员 " + required + "（实际：" + compared.join(", ") + "）");
    }
    for (const file of result.files) {
      assert.equal(file.status, "same", file.path + " 状态异常");
      assert.equal(file.tarballSha256, file.worktreeSha256, file.path + " 哈希不一致");
    }
    // 测试本身不能把 tarball 丢进仓库根（否则发布脚本会误读这个"产物"）
    assert.deepEqual(repoRootTarballs(), tarballsBefore, "测试在仓库根留下了新的 .tgz");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-fixes: editing lib/index.js after pack is stale and names the file", () => {
  const { dir, work } = makeWorktree("cn-relfix-index-");
  try {
    const { tgzPath, version, buildCode } = packWorktree(dir, work);
    const entryPath = join(work, "lib", "index.js");
    writeFileSync(entryPath, readFileSync(entryPath, "utf8") + "\nexport const AFTER_PACK = true;\n");

    const result = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(result.fresh, false, "pack 之后改了 host 入口，门禁必须报 stale");
    assert.ok(
      result.reasons.some((reason) => reason.includes("lib/index.js")),
      "reasons 没有点名改动的文件：\n" + result.reasons.join("\n")
    );
    assert.deepEqual(result.mismatchedFiles, ["lib/index.js"]);
    // 反向证明：旧门禁（client.js + 版本）在这种情况下会放行
    assert.equal(result.tarballVersion, version);
    assert.equal(result.tarballSha256, result.expectedSha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-fixes: editing cordis.patch.yml after pack is stale and names the file", () => {
  const { dir, work } = makeWorktree("cn-relfix-patch-");
  try {
    const { tgzPath, version, buildCode } = packWorktree(dir, work);
    const patchPath = join(work, "cordis.patch.yml");
    const patched = readFileSync(patchPath, "utf8").replace("id: dsh-code-nav", "id: dsh-code-nav-STALE");
    writeFileSync(patchPath, patched);

    const result = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(result.fresh, false, "pack 之后改了 bundle 补丁，门禁必须报 stale");
    assert.ok(
      result.reasons.some((reason) => reason.includes("cordis.patch.yml")),
      "reasons 没有点名改动的文件：\n" + result.reasons.join("\n")
    );
    assert.deepEqual(result.mismatchedFiles, ["cordis.patch.yml"]);
    assert.equal(result.tarballSha256, result.expectedSha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-fixes: CRLF in the worktree is normalised, a real content change is not", () => {
  const { dir, work } = makeWorktree("cn-relfix-eol-");
  try {
    // 把 lib/index.js 改成 CRLF 再 pack：tarball 与工作区都是 CRLF，但内容等价，
    // 跨平台（core.autocrlf / 编辑器）下不应误报 stale。
    const entryPath = join(work, "lib", "index.js");
    writeFileSync(entryPath, readFileSync(entryPath, "utf8").replace(/\r?\n/g, "\r\n"));
    const { tgzPath, version, buildCode } = packWorktree(dir, work);

    const freshResult = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(freshResult.fresh, true, "仅换行符不同不应判 stale：\n" + freshResult.reasons.join("\n"));

    // 反证：真正改内容仍然 stale（归一化不会掩盖内容差异）
    writeFileSync(entryPath, readFileSync(entryPath, "utf8").replace("export const", "// changed\nexport const"));
    const staleResult = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(staleResult.fresh, false);
    assert.deepEqual(staleResult.mismatchedFiles, ["lib/index.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-fixes: a packed file missing from the worktree is reported", () => {
  const { dir, work } = makeWorktree("cn-relfix-missing-");
  try {
    const { tgzPath, version, buildCode } = packWorktree(dir, work);
    rmSync(join(work, "README_EN.md"));

    const result = checkArtifactFreshness({ tgzPath, version, buildCode, root: work });
    assert.equal(result.fresh, false);
    assert.ok(
      result.reasons.some((reason) => reason.includes("README_EN.md") && reason.includes("工作区不存在")),
      "reasons 没有报告缺失文件：\n" + result.reasons.join("\n")
    );
    assert.deepEqual(result.mismatchedFiles, ["README_EN.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
