/**
 * 库迁移测试：`<包>/prompts/` → `$DSH_HOME/prompts/`
 *
 * ═══ 为什么需要这个测试 ═══
 *
 * 库以前在包内。本地 `link:` 装法看不出问题（包里就是源码目录），但
 * **装在 `node_modules` 里的包目录是可以被覆盖的** —— 用户 `pnpm update`
 * 一次，他攒的提示词全没了。所以 v0.3.2 起库移到包外。
 *
 * 迁移有四个「错了就丢数据或覆盖数据」的边界，逐个验：
 *
 *   ① 老位置有货、新位置空   → **要搬**（catalog + 正文都要）
 *   ② 老位置是空库           → **不搬**（发布包里那个就是空的，别当用户数据）
 *   ③ 老位置没 catalog       → **不搬**（不新建空文件）
 *   ④ 新位置已经有库         → **不许覆盖**
 *
 * ═══ 为什么直接调函数，不加载 index.js ═══
 *
 * `index.js` 是插件入口：加载它会读环境变量、跑一遍迁移。
 * 而 **Node 的 ESM 缓存不认查询串**，一个进程里只能测一种环境 ——
 * 想测四种就得开四个子进程（这个环境里 `spawnSync` + `stdio:"pipe"` 会 EPERM）。
 *
 * 所以把迁移逻辑抽成 `scripts/lib/library-migration.mjs` 里的纯函数，
 * 这里直接调它、传临时路径。**纯函数 + 临时目录 = 想测几个就测几个。**
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSuite } from "./lib/test-harness.mjs";
import { migrateLibraryOutOfPackage } from "./lib/library-migration.mjs";

const { ok, eq, done } = createSuite("提示词库迁移");

/** 造一对临时目录：老位置（包内）+ 新位置（用户目录）。 */
function withDirs(fn) {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-legacy-"));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-target-"));
  // ⚠️ 目标 catalog 一开始**必须不存在** —— 迁移的判据就是它
  fs.rmSync(path.join(targetDir, "catalog.json"), { force: true });
  try {
    return fn({
      legacyDir,
      targetDir,
      targetCatalog: path.join(targetDir, "catalog.json"),
    });
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

/** 往老位置写一份库。`entries` 为空数组表示「空库」。 */
function seedLegacy(legacyDir, entries) {
  fs.writeFileSync(
    path.join(legacyDir, "catalog.json"),
    JSON.stringify({ version: 1, prompts: entries }, null, 2),
  );
  for (const e of entries) {
    if (e.file) fs.writeFileSync(path.join(legacyDir, e.file), "# 正文 " + e.id + "\n");
  }
}

const ONE = [{ id: "my-prompt-1", name: "新提示词", mode: "append", order: 950, file: "my-prompt-1.md" }];

/** 迁移时把日志吞掉 —— 不然每跑一次都往控制台喷一行。 */
const QUIET = { log: () => {}, warn: () => {} };

// ── ① 老位置有货、新位置空 → 要搬 ──────────────────────────────────────
withDirs((d) => {
  seedLegacy(d.legacyDir, ONE);
  const r = migrateLibraryOutOfPackage({ ...d, ...QUIET });

  ok(r.moved === true, "① 判定为「要搬」", JSON.stringify(r));
  ok(fs.existsSync(d.targetCatalog), "① catalog 出现在新位置");
  eqCatalogIds(d.targetCatalog, ["my-prompt-1"], "① 条目对");
  ok(
    fs.existsSync(path.join(d.targetDir, "my-prompt-1.md")),
    "① **正文也搬了** —— 只搬 catalog 的话条目在、正文读不出来",
  );
  ok(
    fs.existsSync(path.join(d.legacyDir, "catalog.json")),
    "① **老位置保留不动** —— 新版有问题时能退回去",
  );
  eq(r.entries, 1, "① 回报搬了几条");
  eq(r.bodies, 1, "① 回报搬了几个正文");
});

// ── ② 老位置是空库 → 不搬 ──────────────────────────────────────────────
withDirs((d) => {
  seedLegacy(d.legacyDir, []);
  const r = migrateLibraryOutOfPackage({ ...d, ...QUIET });

  eq(r.moved, false, "② **空库不搬**（发布包里 catalog 就是空的，别当用户数据）");
  ok(!fs.existsSync(d.targetCatalog), "② 新位置没被建出 catalog");
});

// ── ③ 老位置没有 catalog → 不搬 ────────────────────────────────────────
withDirs((d) => {
  const r = migrateLibraryOutOfPackage({ ...d, ...QUIET });
  eq(r.moved, false, "③ 老位置没 catalog 时不搬");
  ok(!fs.existsSync(d.targetCatalog), "③ 也不新建空 catalog");
});

// ── ③b 老位置整个目录都不在 → 不搬、不报错 ─────────────────────────────
withDirs((d) => {
  const r = migrateLibraryOutOfPackage({ ...d, legacyDir: path.join(d.legacyDir, "不存在") , ...QUIET });
  eq(r.moved, false, "③b 老位置目录不存在时不搬");
});

// ── ③c catalog 是坏 JSON → 不搬、不抛 ─────────────────────────────────
withDirs((d) => {
  fs.writeFileSync(path.join(d.legacyDir, "catalog.json"), "{ 这不是 JSON");
  const r = migrateLibraryOutOfPackage({ ...d, ...QUIET });
  eq(r.moved, false, "③c catalog 坏了时不搬");
  ok(/读不出来/.test(r.reason ?? ""), "③c 说清了原因", r.reason);
});

// ── ④ 新位置已经有库 → 不许覆盖 ────────────────────────────────────────
withDirs((d) => {
  seedLegacy(d.legacyDir, ONE);
  const mine = { version: 1, prompts: [{ id: "用户自己的", name: "别动我" }] };
  fs.writeFileSync(d.targetCatalog, JSON.stringify(mine));

  const r = migrateLibraryOutOfPackage({ ...d, ...QUIET });

  eq(r.moved, false, "④ 新位置已有库时不搬");
  eqCatalogIds(d.targetCatalog, ["用户自己的"], "④ **已有的库没被覆盖**");
  ok(
    !fs.existsSync(path.join(d.targetDir, "my-prompt-1.md")),
    "④ 也没把老位置的正文混进来",
  );
});

// ── ⑤ 新位置的父目录不存在 → 要能自己建出来 ────────────────────────────
//
// ⚠️ 全新安装时 `~/.dsh` 本身可能就不存在。`mkdirSync` 不带 recursive 的话
//    会在建 `prompts/` 时报 ENOENT（父目录不存在）—— 这个踩过。
{
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-legacy-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-parent-"));
  const targetDir = path.join(parent, "还没有", "prompts");
  try {
    seedLegacy(legacyDir, ONE);
    const r = migrateLibraryOutOfPackage({
      legacyDir,
      targetDir,
      targetCatalog: path.join(targetDir, "catalog.json"),
      ...QUIET,
    });
    eq(r.moved, true, "⑤ 父目录不存在时也能建出来");
    ok(fs.existsSync(path.join(targetDir, "catalog.json")), "⑤ 多层目录建好了");
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

/** 只比 id —— 顺序和多余字段不该影响这条断言。 */
function eqArr(entries, ids, label) {
  const got = (entries ?? []).map((e) => e.id);
  ok(
    got.length === ids.length && ids.every((x, i) => got[i] === x),
    label,
    JSON.stringify(got),
  );
}

/**
 * 读 catalog 并比 id。
 *
 * ⚠️ **读不到文件时不能抛** —— 抛的话测试进程直接崩，后面的断言全都不跑，
 *    报出来是「0 失败」（或者一个看不懂的 ENOENT 堆栈）。
 *    实测过：去掉 `mkdirSync` 的 `recursive` 之后就是这个样子，
 *    注入验证只能看到「? 条」。
 *
 *    这里把「文件不在」变成一个**正常的失败断言**，测试继续往下走。
 */
function eqCatalogIds(file, ids, label) {
  if (!fs.existsSync(file)) {
    ok(false, label, "文件都不在：" + file);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    ok(false, label, "读不出来：" + String(e).slice(0, 80));
    return;
  }
  eqArr(parsed.prompts, ids, label);
}

done();
