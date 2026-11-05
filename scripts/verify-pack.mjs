#!/usr/bin/env node
/**
 * dsh-code-nav — 打包内容校验：tarball 里必须真的有运行期需要的文件。
 *
 * 背景：CI 只在 `npm pack --silent` 之后跑发布 dry-run，而 dry-run 只检查
 * 目标仓库/版本/产物名派生与 `.tgz` 存在，**从不看 tarball 里装了什么**。
 * 于是 `package.json.files` 少一项（例如 `cordis.patch.yml`）时 CI 仍然全绿，
 * 装到用户 profile 里才在 DSH 组合 bundle 时报错。
 *
 * 这里运行 `npm pack --dry-run --json` 解析 `files` 清单并断言必需项齐全，
 * **并用每项的 `size` 校验非空/最小体积**：只断言「存在」曾让 0 字节的
 * `lib/client.js` 通过校验（审查 P2-1 的假绿），装到用户那里直接白屏。
 * `--ignore-scripts` 是刻意的：校验本身不该触发 `prepack` 构建（CI 前一步已经
 * build 过），也不该在验证时改写工作区里的 `lib/client.js`。
 *
 * 用法：node scripts/verify-pack.mjs
 * 纯函数 `verifyPackJson(json)` 供 test/release-hardening.test.mjs 使用。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runNpm } from "./release-config.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * tarball 里必须存在的文件（相对包根）。
 * - `package.json`：npm 一直会带，但显式列出可以挡住「包名/版本字段被删」的极端回归；
 * - `lib/index.js`：host half，DSH loader entry 的实际入口；
 * - `lib/client.js`：浏览器端 bundle，缺了等于插件没有界面；
 * - `cordis.patch.yml`：`dsh.bundle.patch` 指向的补丁，缺了 bundle 无法组合；
 * - 两份 README：npm 页面与安装说明（en 不是 npm 默认必带项，必须显式在 files 里）。
 */
export const REQUIRED_FILES = [
  "package.json",
  "lib/index.js",
  "lib/client.js",
  "cordis.patch.yml",
  "README.md",
  "README_EN.md"
];

/**
 * 必需文件的最小体积（字节）。只校验「存在」会给出假绿：把 `lib/client.js`
 * 清成 0 字节后 `verify-pack` 依旧 OK（审查 P2-1），而装到用户那里就是白屏。
 * - `lib/client.js`：整个浏览器端 bundle，正常 200_000+ 字节，取 100_000 作下限；
 * - 其余必需文件：> 0 即可（空文件一律视为打包事故）。
 */
export const MIN_BYTES = {
  "lib/client.js": 100_000
};

/** 所有必需文件的绝对下限：1 字节（空文件必然失败）。 */
const NONEMPTY_BYTES = 1;

/**
 * 解析 `npm pack --json` 的 stdout。正常是单元素 JSON 数组；即使前面混进了
 * 生命周期脚本的输出（我们传了 --ignore-scripts，正常不会），也截取最外层的
 * `[…]` 再解析，避免把整段文本当 JSON。
 * @param {string} stdout
 * @returns {unknown}
 * @throws 空输出或无法解析时抛错
 */
export function parsePackJson(stdout) {
  const text = typeof stdout === "string" ? stdout.trim() : "";
  if (text.length === 0) throw new Error("[verify-pack] `npm pack --json` 没有输出");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error("[verify-pack] 无法解析 `npm pack --json` 输出：" + String(error && error.message ? error.message : error));
  }
}

/**
 * 把 `npm pack --json` 的输出（数组或单个对象）归一成 pack 记录。
 * @param {unknown} json
 * @returns {{name?:string,version?:string,files:string[],sizes:Map<string,number>}}
 * @throws 形状不对时抛错
 */
function packRecordOf(json) {
  const record = Array.isArray(json) ? json[0] : json;
  if (record === null || typeof record !== "object") {
    throw new Error("[verify-pack] `npm pack --json` 输出不是对象/数组");
  }
  const files = record.files;
  if (!Array.isArray(files)) {
    throw new Error("[verify-pack] `npm pack --json` 输出缺少 files 数组");
  }
  const paths = [];
  const sizes = new Map();
  for (const entry of files) {
    const path = typeof entry === "string"
      ? entry
      : entry !== null && typeof entry === "object" && typeof entry.path === "string"
        ? entry.path
        : null;
    if (path === null) continue;
    // 不同 npm 版本可能给出 `package/…` 前缀；统一成包根相对路径。
    const normalized = path.replace(/^package\//, "");
    paths.push(normalized);
    // `npm pack --json` 的 size 是打包后的字节数。缺失 / 非法时**不**补默认值：
    // 调用方会把它当成失败（宁可报错，也不让 0 字节产物蒙混过关）。
    if (entry !== null && typeof entry === "object"
      && typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0) {
      sizes.set(normalized, entry.size);
    }
  }
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.version === "string" ? { version: record.version } : {}),
    files: paths,
    sizes
  };
}

/**
 * 纯函数：校验 tarball 文件清单包含全部必需项，且体积不是空的/小得不像话。
 * @param {unknown} json `npm pack --json` 的输出（数组或 `{files:[…]}` 形状）
 * @param {string[]} [required]
 * @param {Record<string, number>} [minBytes] 每个文件的最小字节数（覆盖默认下限）
 * @returns {{name?:string,version?:string,files:string[],sizes:Map<string,number>}}
 * @throws 缺少必需文件 / 尺寸过小 / 缺少 size / 输出形状不对时抛错
 */
export function verifyPackJson(json, required = REQUIRED_FILES, minBytes = MIN_BYTES) {
  const record = packRecordOf(json);
  const present = new Set(record.files);
  const missing = required.filter((file) => !present.has(file));
  if (missing.length > 0) {
    throw new Error(
      "[verify-pack] tarball 缺少必需文件：" + missing.join(", ") +
      "\n[verify-pack] 检查 package.json 的 `files` 字段（npm 只会打包它列出的路径，加上 README/LICENSE）。"
    );
  }
  // 「文件存在」不等于「文件是内容」：0 字节的 lib/client.js 曾能通过校验。
  const unknownSize = [];
  const tooSmall = [];
  for (const file of required) {
    const size = record.sizes.get(file);
    const floor = Math.max(NONEMPTY_BYTES, minBytes[file] ?? NONEMPTY_BYTES);
    if (typeof size !== "number") {
      unknownSize.push(file);
      continue;
    }
    if (size < floor) tooSmall.push("  " + file + " " + size + " 字节（最小 " + floor + " 字节）");
  }
  if (unknownSize.length > 0) {
    throw new Error(
      "[verify-pack] `npm pack --json` 未给出必需文件的 size，无法校验非空/体积：" + unknownSize.join(", ") +
      "\n[verify-pack] 缺失 size 一律视为失败（否则 0 字节产物会假绿）；请升级 npm 或检查 pack 输出。"
    );
  }
  if (tooSmall.length > 0) {
    throw new Error(
      "[verify-pack] tarball 里的必需文件为空或体积过小：\n" + tooSmall.join("\n") +
      "\n[verify-pack] 打包内容校验必须拦住这种产物：先确认 `node scripts/build.mjs` 真的产出了 bundle，再检查 package.json 的 `files`。"
    );
  }
  return record;
}

/** 真跑一次 `npm pack --dry-run --json` 并校验。 */
export function verifyCurrentPackage() {
  const stdout = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return verifyPackJson(parsePackJson(stdout));
}

/** 被 `node scripts/verify-pack.mjs` 直接执行时才产生副作用。 */
const isCli = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  try {
    // 读一次 package.json 只为输出里带上版本号（不依赖 pack JSON 的字段一定存在）。
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const record = verifyCurrentPackage();
    const clientSize = record.sizes.get("lib/client.js");
    const details = [
      clientSize === undefined ? null : "lib/client.js " + clientSize + " bytes",
      pkg.name && pkg.version ? pkg.name + "@" + pkg.version : null
    ].filter(Boolean).join("; ");
    console.log(
      "[verify-pack] OK — " + (record.files.length) + " files, required entries present" +
      (details.length > 0 ? " (" + details + ")" : "")
    );
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    for (const line of text.split("\n")) console.error(line.startsWith("[verify-pack]") ? line : "[verify-pack] " + line);
    process.exit(1);
  }
}
