/**
 * 把 `prompts/` 从**包里**搬到**用户目录**。
 *
 * ═══ 为什么要搬 ═══
 *
 * 库以前在包内（`<包>/prompts/`）。本地 `link:` 装法看不出问题，因为包里就是
 * 源码目录 —— 但**装在 `node_modules` 里的包目录是可以被覆盖的**：
 * 用户 `pnpm update` 一次，他攒的提示词**全没了**。
 * 所以库必须放到包外，跟状态文件并排（`$DSH_HOME/prompts/`）。
 *
 * ═══ 为什么抽成独立模块 ═══
 *
 * 这段逻辑有好几个**错了就丢数据**的边界，必须有测试盯着：
 *
 *   ① 空库不算「有货」 —— 发布包里那个 catalog 是**空库**（出厂默认）。
 *      不能因为它存在就判定「用户有数据」，否则新装的人会被塞一份空迁移。
 *   ② 搬的是**整个目录**（catalog + 所有正文 .md）。只搬 catalog 的话
 *      条目在、正文没了，界面上每条都读不出内容。
 *   ③ 新位置已经有库 → **不许覆盖**（用户可能已经在用了）。
 *   ④ 老位置**留着不动**（不是删）—— 新版有问题时能退回去。
 *
 * ⚠️ 放在 `scripts/lib/` 而不是内联在 `index.js` 里，就是为了能**直接单元测试**：
 *    `index.js` 是插件入口，加载它会读环境变量、跑一遍迁移，
 *    一个进程里只能测一种环境（Node 的 ESM 缓存不认查询串）。
 *    抽出来之后这些边界都能纯函数式地测。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 一条正文文件 —— 只有 `.md` 是提示词正文。 */
const BODY_EXT = ".md";

/**
 * 把库从包内搬到包外。
 *
 * @param {object} options
 * @param {string} options.legacyDir - 包内那个老目录（`<包>/prompts`）
 * @param {string} options.targetDir - 新的库目录（`$DSH_HOME/prompts`）
 * @param {string} options.targetCatalog - 新位置的 catalog 绝对路径
 * @param {(msg: string) => void} [options.log] - 成功时的说明（默认 `console.info`）
 * @param {(msg: string) => void} [options.warn] - 失败时的说明（默认 `console.warn`）
 * @returns {{moved: boolean, reason?: string, entries?: number, bodies?: number}}
 */
export function migrateLibraryOutOfPackage({
  legacyDir,
  targetDir,
  targetCatalog,
  log,
  warn,
}) {
  const say = (fn, msg) => {
    try {
      fn(msg);
    } catch {
      /* 没有 console 就算了 */
    }
  };
  const info = log ?? ((m) => console.info(m));
  const warnFn = warn ?? ((m) => console.warn(m));

  try {
    // 新位置已经有库 → 一律不动。迁移**只发生一次**。
    if (existsSync(targetCatalog)) return { moved: false, reason: "新位置已有库" };
    if (!existsSync(legacyDir)) return { moved: false, reason: "老位置没有库" };

    const oldCatalog = join(legacyDir, "catalog.json");
    if (!existsSync(oldCatalog)) return { moved: false, reason: "老位置没有 catalog" };

    let entries = [];
    try {
      const parsed = JSON.parse(readFileSync(oldCatalog, "utf8"));
      entries = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    } catch {
      return { moved: false, reason: "老 catalog 读不出来" };
    }
    // ① 空库不搬
    if (entries.length === 0) return { moved: false, reason: "老位置是空库（出厂默认）" };

    // ⚠️ **必须 recursive** —— `~/.dsh` 在全新安装时可能还不存在，
    //    不带 recursive 会在建 `prompts/` 时报 ENOENT（父目录不存在）。
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(oldCatalog, targetCatalog);

    // ② 正文也要搬
    let bodies = 0;
    for (const f of readdirSync(legacyDir)) {
      if (!f.endsWith(BODY_EXT)) continue;
      copyFileSync(join(legacyDir, f), join(targetDir, f));
      bodies++;
    }

    say(
      info,
      "[dsh-prompt-easymanager] 提示词库已搬到 " +
        targetDir +
        "（" +
        entries.length +
        " 条 + " +
        bodies +
        " 个正文文件）。包内旧目录保留不动。",
    );
    return { moved: true, entries: entries.length, bodies };
  } catch (err) {
    // ⚠️ 迁移失败**不能挡启动** —— 大不了库是空的，界面会报读不到
    say(warnFn, "[dsh-prompt-easymanager] 库迁移失败：" + String(err));
    return { moved: false, reason: "出错：" + String(err) };
  }
}
