// 设置 GitHub 仓库 topics（合并式：保留已有 + 新增缺失）。
// 目标仓库从 package.json 的 repository.url 派生（曾经写死上游 AnakinCao/dsh-code-nav，
// 在 fork 里会改到上游仓库上）。
// 凭据经 git credential fill 进程内获取（见 release-config.mjs 的 readGithubToken）；
// 沙箱阻断 GCM 凭据管道，须 danger-full-access 运行。token 只在内存里用，不写盘、不进日志。
//
// 用法：
//   node scripts/repo-topics.mjs                 # 默认 dry-run：只打印计划，不读远端、不写
//   node scripts/repo-topics.mjs --yes           # 真正读取现有 topics 并 PUT 合并结果
//   node scripts/repo-topics.mjs --yes topic...  # 用给定的 topic 列表（默认列表见 DEFAULT_TOPICS）
//   node scripts/repo-topics.mjs --help
// 未知的 `--flag` 直接报错退出 —— 不能把开关当成 topic 名字发出去。
import { pathToFileURL } from "node:url";
import { readPkg, repoOf, readGithubToken } from "./release-config.mjs";

/** 默认新增的 topics（合并式：不会删掉仓库已有的 topic）。 */
export const DEFAULT_TOPICS = [
  "dsh-better-sidebar",
  "dsh",
  "dsh-plugin",
  "deepseek-harness",
  "code-preview",
  "syntax-highlighting",
  "code-outline",
  "code-navigation",
  "plugin",
];

/** GitHub 每个仓库最多 20 个 topic。 */
const TOPIC_CAP = 20;

/**
 * 解析命令行。
 * - `--yes`：执行写入（默认是 dry-run）；
 * - `--dry-run`：显式演练，与默认一致，且不能与 `--yes` 同时出现；
 * - `--help` / `-h`：打印用法；
 * - 其余以 `-` 开头的参数一律报错（防止把拼错的开关当成 topic）；
 * - 位置参数才是 topic。
 * @param {string[]} argv 不含 node / 脚本路径
 * @returns {{yes:boolean, dryRun:boolean, help:boolean, topics:string[]}}
 * @throws 未知选项 / --yes 与 --dry-run 同时出现时抛错
 */
export function parseArgs(argv = []) {
  const options = { yes: false, dryRun: false, help: false, topics: [] };
  let explicitDryRun = false;
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === "--yes") options.yes = true;
    else if (arg === "--dry-run") explicitDryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error("未知选项：" + arg);
    else if (arg.length > 0) options.topics.push(arg);
  }
  if (options.yes && explicitDryRun) throw new Error("不能同时使用 --yes 与 --dry-run");
  options.dryRun = !options.yes;
  return options;
}

/** 合并式 topic 列表：保留已有顺序，追加缺失项，去重。 */
export function mergeTopics(existing, desired) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(desired) ? desired : [])])];
}

const HELP = [
  "用法: node scripts/repo-topics.mjs [--yes] [--dry-run] [--help] [topic...]",
  "",
  "  （无参数）     dry-run：打印目标仓库与将新增的 topics，不读远端、不写",
  "  --yes          真正写入：读取现有 topics，合并后 PUT 回 GitHub",
  "  --dry-run      显式演练（与默认一致）",
  "  --help, -h     打印本帮助",
  "",
  "  topic...       覆盖默认 topic 列表（见 DEFAULT_TOPICS）",
].join("\n");

/** 从 GitHub 读取 topics 后合并写回。调用方必须先确认是 live 模式。 */
async function applyTopics(repo, desired) {
  let token;
  try {
    token = readGithubToken();
  } catch (error) {
    console.error("[topics] " + error.message);
    process.exit(1);
  }

  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "dsh-release",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const cur = await fetch(`https://api.github.com/repos/${repo}/topics`, { headers });
  const curData = await cur.json();
  if (!cur.ok) {
    console.error("get topics failed", cur.status, curData.message || "");
    process.exit(1);
  }
  const existing = curData.names ?? [];
  const merged = mergeTopics(existing, desired);
  console.log("existing:", existing.join(", ") || "(none)");
  if (merged.length > TOPIC_CAP) {
    console.error("[topics] 合并后有 " + merged.length + " 个 topic，超过 GitHub 上限 " + TOPIC_CAP + "；未写入。");
    console.error("[topics] 请用显式 topic 列表减少新增项，或先人工清理已有 topics。");
    process.exit(1);
  }

  const put = await fetch(`https://api.github.com/repos/${repo}/topics`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ names: merged }),
  });
  const putData = await put.json();
  if (!put.ok) {
    console.error("set topics failed", put.status, putData.message || "");
    process.exit(1);
  }
  console.log("topics now:", (putData.names ?? []).join(", "));
  console.log("DONE");
}

/** CLI 主体；被 import 时不执行（供 test/release-hardening.test.mjs 用 parseArgs）。 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const pkg = readPkg();
  const repo = repoOf(pkg);
  const desired = options.topics.length > 0 ? options.topics : DEFAULT_TOPICS;
  console.log("target repo:", repo);
  console.log("topics to add:", desired.join(", "));
  if (options.dryRun) {
    console.log("[topics] dry run: 未读取远端、未写入。确认后加 --yes 执行。");
    console.log("[topics] 现有 topics 与合并结果只有 --yes 才会从 GitHub 读取。");
    return;
  }
  await applyTopics(repo, desired);
}

const isCli = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  try {
    await main();
  } catch (error) {
    console.error("[topics] " + String(error && error.message ? error.message : error));
    process.exit(1);
  }
}
