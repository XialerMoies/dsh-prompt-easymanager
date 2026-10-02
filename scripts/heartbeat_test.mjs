/**
 * 心跳文件的测试。
 *
 * ═══ 为什么要测这个 ═══
 *
 * 心跳是**诊断工具**。诊断工具自己坏了最糟 —— 它会**自信地告诉你错的东西**，
 * 而你是拿它来查问题的，于是被带偏。所以：
 *
 *   · 字段算得对不对，不能靠"跑一遍插件看看"
 *   · 「写不进去也不能影响插件」这句话，得真的验
 *   · `starting` / `ready` / `failed` 三种状态必须**能区分** ——
 *     这正是它存在的理由
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSuite } from "./lib/test-harness.mjs";
import {
  writeHeartbeat,
  readHeartbeat,
  makeHeartbeat,
  cleanupStaleTmp,
} from "./lib/heartbeat.mjs";

const { ok, eq, done } = createSuite("加载心跳");

// ⚠️ 版本号**从 package.json 读**，别硬编码 —— 有一条守卫盯着这个
//    （硬编码的话每发一版都要来改测试）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));

/** 每个用例一个临时目录，互不影响。 */
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-hb-"));
  return { dir, file: path.join(dir, "dsh-prompt-easymanager-heartbeat.json") };
}

/** 一份完整的 makeHeartbeat 入参（各用例按需覆盖）。 */
function args(over) {
  return {
    phase: "ready",
    pluginId: "dsh-prompt-easymanager",
    version: PKG.version,
    dshVersion: "0.1.7-rc.2",
    nodeVersion: process.version,
    stateFile: "/x/state.json",
    // ⚠️ **读和写是两个路径**（老用户升级后是「读老的、写新的」）。
    //    故意给一个**不同的值** —— 两个一样的话，「有没有报出来」验不出来。
    stateWriteFile: "/x/state-new.json",
    stateDir: "/x",
    promptsDir: "/x/prompts",
    catalogPath: "/x/prompts/catalog.json",
    routeCount: 8,
    sectionCount: 32,
    libraryMigration: { moved: false, reason: "新位置已有库" },
    ...over,
  };
}

// ── ① 写与读 ──────────────────────────────────────────────────────────
{
  const { file } = fresh();
  const hb = makeHeartbeat(args({ counts: { prompts: 3, errors: 0 } }));
  const wrote = writeHeartbeat(file, hb);

  eq(wrote, true, "写成功");
  const back = readHeartbeat(file);
  ok(!!back, "读得回来");
  eq(back.phase, "ready", "phase 对");
  eq(back.ok, true, "**ready 时 ok 是 true**（人先看这个字段）");
  eq(back.version, PKG.version, "版本跟 package.json 一致");
  eq(back.dsh, "0.1.7-rc.2", "dsh 版本");
  eq(back.paths.state, "/x/state.json", "状态文件路径（读）");
  // ⚠️ **这条要真的从写出来的文件里读** —— 不能只验「调用方传了」。
  //    踩过：`makeHeartbeat` 只挑固定几个字段组装 `paths`，
  //    我在调用方加了入参、忘了在 `makeHeartbeat` 里挑一下 ——
  //    于是调用方传了、文件里却没有，而测试**照样绿**（它只验了入参）。
  eq(back.paths.stateWriteFile, "/x/state-new.json", "**状态文件路径（写）也报出来了**");
  eq(back.paths.catalog, "/x/prompts/catalog.json", "库路径");
  eq(back.registered.routes, 8, "路由数");
  eq(back.registered.sectionSlots, 32, "段落槽数");
  eq(back.counts.prompts, 3, "提示词条数");
  ok(/心跳/.test(back.note ?? ""), "有说明这是心跳不是配置");
}

// ── ② 三种状态必须能区分（这是它存在的理由）───────────────────────────
{
  const starting = makeHeartbeat(args({ phase: "starting" }));
  const ready = makeHeartbeat(args({ phase: "ready" }));
  const failed = makeHeartbeat(args({ phase: "failed", error: new Error("炸了") }));

  eq(starting.phase, "starting", "starting 的 phase");
  eq(starting.ok, false, "**starting 时 ok 是 false**");
  eq(ready.ok, true, "ready 时 ok 是 true");
  eq(failed.ok, false, "failed 时 ok 是 false");
  eq(failed.error.message, "炸了", "failed 带错误信息");
  ok(!!failed.error.stack, "failed 带堆栈");

  // ⚠️ 关键：只有 starting 没有 ready，就说明 apply 挂了
  const hasReady = (h) => h.phase === "ready";
  ok(!hasReady(starting), "只看 starting 能判断「加载了但没生效」");
  ok(hasReady(ready), "ready 才是真的生效");
}

// ── ③ 原子写：不留 .tmp，且过程中不会有半截文件 ───────────────────────
{
  const { dir, file } = fresh();
  writeHeartbeat(file, makeHeartbeat(args()));
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
  eq(leftovers, [], "**写完不留 .tmp**（rename 之后临时文件就没了）");

  // 连写多次也不该堆积
  //
  // ⚠️ 这里**不能用字面量版本号**。原来写的是 `"0.3." + i` 去拼、再断言某三个数字，
  //    而本轮真实版本**恰好就是那串数字** —— 于是：
  //      · 字面量跟「当前版本」撞了，触发「测试里不许硬编码版本号」那条守卫
  //      · 更糟的是**断言退化成了废的**（期望值跟实际值来源不同但数值相同，
  //        看上去在验「最后一次写的内容生效」，其实验不出什么）
  //
  //    ⚠️ 派生方案本身也要保证「跟当前版本不同」——
  //       我第一版写的是 `x.y.<i>`，而 `i=4` 正好等于当前的 patch 号，
  //       于是派生值 == 当前版本，自己把自己那两条断言踩了。
  //       现在加个后缀，**结构上不可能撞**。
  const v = (n) => PKG.version + "-hb" + n;
  for (let i = 0; i < 5; i++) writeHeartbeat(file, makeHeartbeat(args({ version: v(i) })));
  eq(fs.readdirSync(dir).filter((f) => f.includes(".tmp")), [], "连写 5 次也不留 .tmp");
  eq(readHeartbeat(file).version, v(4), "最后一次写的内容生效");
  ok(v(4) !== PKG.version, "  派生出来的值跟当前版本不同（否则这条断言是废的）");
}

// ── ④ 写不进去**不能影响插件** ────────────────────────────────────────
{
  // 目标路径本身是目录：跨平台稳定触发原子写和回退写失败。
  const badBase = fs.mkdtempSync(path.join(os.tmpdir(), "pm-hb-bad-"));
  const bad = path.join(badBase, "heartbeat.json");
  fs.mkdirSync(bad);
  let threw = false;
  let result;
  try {
    result = writeHeartbeat(bad, makeHeartbeat(args()));
  } catch {
    threw = true;
  }
  eq(threw, false, "**写不进去也不抛**（它是诊断工具，不能拖垮插件）");
  eq(result, false, "返回 false 让人知道没写成");
  fs.rmSync(badBase, { recursive: true, force: true });
}

// ── ⑤ 读不存在的 / 坏的，返回 null 而不是抛 ────────────────────────────
{
  const { dir, file } = fresh();
  eq(readHeartbeat(file), null, "文件不存在 → null");

  fs.writeFileSync(file, "{ 这不是 JSON", "utf8");
  eq(readHeartbeat(file), null, "内容坏了 → null（不抛）");
}

// ── ⑥ 目录不存在时要自己建出来 ────────────────────────────────────────
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-hb-deep-"));
  const file = path.join(base, "还没有", "更深一层", "heartbeat.json");
  try {
    eq(writeHeartbeat(file, makeHeartbeat(args())), true, "多级目录自己建出来");
    ok(fs.existsSync(file), "文件真的在");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ── ⑦ 清掉被强杀留下的 .tmp ───────────────────────────────────────────
{
  const { dir, file } = fresh();
  fs.writeFileSync(file + ".tmp", "{}", "utf8");
  fs.writeFileSync(file, JSON.stringify({ phase: "ready" }), "utf8");

  const n = cleanupStaleTmp(file);
  eq(n, 1, "清掉 1 个残留");
  ok(!fs.existsSync(file + ".tmp"), ".tmp 没了");
  ok(fs.existsSync(file), "**但正常的心跳文件不动**（别清错东西）");
}

// ── ⑧ 心跳里不许出现用户数据 ──────────────────────────────────────────
//
// ⚠️ 心跳会被用户贴给别人看（就是用来求助的），所以**不能**把预设内容、
//    提示词正文这类东西带进去。这里只做常识检查：不出现长文本字段。
{
  const hb = makeHeartbeat(
    args({
      counts: { prompts: 3, errors: 0 },
      libraryMigration: { moved: true, entries: 2, bodies: 2 },
    }),
  );
  const text = JSON.stringify(hb);
  ok(!/presetId|assignments|content|text|promptIds/.test(text), "**心跳里没有用户数据字段**");
  ok(text.length < 2000, "心跳很小（" + text.length + " 字符）—— 能整个贴出来");
}

done();
