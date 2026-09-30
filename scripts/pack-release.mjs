/**
 * 打发布包：先把你本地的提示词库清空，再 `npm pack`，最后原样还原。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────────────────
 *
 * `prompts/catalog.json` 一直是「出厂文件」和「你的运行时库」两用：
 * 在界面上建一条提示词，插件就写进这里。于是 `npm pack` 会**把你的库一起打包**
 * 发出去 —— 别人装完打开会看到一堆不相干的条目。踩过两次。
 *
 * 现在 catalog 与正文都**不入库**（见 `prompts/.gitignore`），所以发布包必须
 * 自己造一份干净的：出厂默认 = **空库**。
 *
 * ⚠️ 改动是**临时**的，`finally` 里一定还原 —— 中途别 Ctrl-C。
 *    写得再稳也怕断电，所以还原逻辑会先备份到内存，且不依赖任何外部状态。
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "prompts", "catalog.json");
const BACKUP = join(ROOT, "prompts", ".catalog.backup.json");

function main() {
  const hadCatalog = existsSync(CATALOG);
  if (hadCatalog) {
    copyFileSync(CATALOG, BACKUP);
    console.log("已备份你本地的 catalog.json");
  }

  try {
    // 出厂默认 = 空库
    writeFileSync(CATALOG, JSON.stringify({ version: 1, prompts: [] }, null, 2) + "\n", "utf8");
    console.log("已把 catalog 临时清空（出厂默认 = 空库）");

    // npm pack 的输出（文件名）走 stdout —— 这里直接透传
    const out = execFileSync("npm", ["pack", ...process.argv.slice(2)], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    return out;
  } finally {
    if (hadCatalog && existsSync(BACKUP)) {
      renameSync(BACKUP, CATALOG);
      console.log("已还原你本地的 catalog.json");
    } else if (!hadCatalog && existsSync(CATALOG)) {
      unlinkSync(CATALOG);
      console.log("本地原本没有 catalog.json，已删掉临时文件");
    }
  }
}

main();
