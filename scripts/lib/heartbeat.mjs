/**
 * 加载心跳。
 *
 * ═══ 为什么要有这个 ═══
 *
 * 排查「插件到底加载了没」的时候，只能开 F12 翻控制台 ——
 * 而控制台是**易失**的：刷新一下就没了，用户也很难把那段贴出来。
 *
 * 心跳是一份**落在盘上的、随时能 `cat` 的**记录。它的用途只有一个：
 * **让「加载了没 / 读到哪个文件 / 为什么没生效」这类问题不用猜。**
 *
 * ═══ 跟状态文件的区别 ═══
 *
 *   状态文件   `…-state.json`      **用户数据** —— 预设、会话选择、段落改写。
 *                                 删了配置就没了，插件绝不会自动动它。
 *   心跳       `…-heartbeat.json`  **诊断信息** —— 每次加载重写，随便删。
 *
 * 两者**分开放**，就是为了让「删心跳」永远不会误伤配置。
 *
 * ═══ 两个刻意的设计 ═══
 *
 * ① **先写一条 `starting`，`apply()` 成功后再写 `ready`。**
 *
 *    「加载了」和「生效了」**不是一回事** —— 模块 import 成功但 apply 抛错的话，
 *    进程还在、文件也读了，可功能是死的。只写一次的话这两种情况看起来一样，
 *    而那恰恰是最难查的一种失败。所以：
 *
 *        只有 starting 没有 ready  →  apply 挂了（而且文件里有 error 字段）
 *        starting 之后有 ready     →  真的起来了
 *
 * ② **绝不因为心跳失败而影响插件。**
 *
 *    它是诊断工具，不是功能。写不进去（权限、磁盘满）就算了，
 *    顶多没有诊断信息，绝不能让插件起不来。
 */
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * 写一份心跳（原子写）。
 *
 * ⚠️ 原子写的理由：用户可能正好在插件写它的时候 `cat`，
 *    非原子写会让他看到一个截断的 JSON，然后以为插件坏了。
 *    同目录临时文件 + rename，读者永远看到完整的一份。
 */
export function writeHeartbeat(file, payload) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    try {
      renameSync(tmp, file);
    } catch {
      // rename 跨不过去（极少见）就退化成直接写
      writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
      try {
        unlinkSync(tmp);
      } catch {
        /* 算了 */
      }
    }
    return true;
  } catch {
    // ⚠️ 心跳失败**不能影响插件** —— 它是诊断工具，不是功能
    return false;
  }
}

/** 读一份心跳（给测试和诊断路由用；读不出来返回 null）。 */
export function readHeartbeat(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 造一份心跳的字段。
 *
 * 抽成函数是为了**能测**：字段算得对不对，不该靠跑一遍插件才知道。
 *
 * @param {object} o
 * @param {string} o.phase        `"starting"` 或 `"ready"`
 * @param {string} o.version
 * @param {string} o.dshVersion   读不到就传 null
 * @param {string} o.nodeVersion
 * @param {string} o.stateFile    这次会读的状态文件（可能是老名字）
 * @param {string} o.stateDir
 * @param {string} o.promptsDir
 * @param {string} o.catalogPath
 * @param {number} o.routeCount
 * @param {number} o.sectionCount
 * @param {object} o.libraryMigration  migrateLibraryOutOfPackage 的返回值
 * @param {string[]} [o.patch]     来自哪些 profile 补丁（能拿到才传）
 * @param {object} [o.counts]      ready 阶段才有：几条预设、几条提示词
 * @param {object} [o.error]       失败时：{ message, stack }
 */
export function makeHeartbeat(o) {
  const hb = {
    // 人先看的：一眼知道这次加载是好是坏
    ok: o.phase === "ready",
    phase: o.phase,
    at: new Date().toISOString(),

    plugin: o.pluginId ?? "dsh-prompt-easymanager",
    version: o.version,

    // 版本对不上的时候，很多"怪问题"其实一句话就解释完了
    dsh: o.dshVersion ?? null,
    node: o.nodeVersion,

    paths: {
      // ⚠️ 这个特别有用：它可能就是老名字（迁移还没落盘时），
      //    用户一看就知道"原来读的是那份老的"
      state: o.stateFile,
      /**
       * ⚠️ **读和写是两个路径，必须分开报。**
       *
       *    老用户升级后是「读老的、写新的」。只报 `state` 的话，
       *    看心跳的人分不清「配置从哪读的」和「改动会落到哪」——
       *    真机上就是靠这个对不上，才发现**写那条路一直写回老文件**
       *    （启动日志说会迁到新文件，代码没做）。
       *
       *    ⚠️ **加这个字段时踩过一次**：我只在调用方（`heartbeatBase`）
       *       的入参里加了，**忘了在这儿也挑一下** —— 于是文件里根本
       *       没有这个字段。调用方传了、这里不挑，就等于没传。
       *
       *    ⚠️ 所以下面测试里那条断言要**直接读文件**验，不能只验调用方传了。
       */
      stateWriteFile: o.stateWriteFile ?? null,
      stateDir: o.stateDir,
      prompts: o.promptsDir,
      catalog: o.catalogPath,
    },

    registered: {
      routes: o.routeCount,
      sectionSlots: o.sectionCount,
      patch: o.patch ?? null,
    },

    // 库迁移的结果 —— 曾经出过「开关关着就把配置丢掉」那种问题，
    // 迁移到底做没做、为什么没做，写在这儿就不用再猜
    libraryMigration: o.libraryMigration ?? null,
  };

  if (o.counts) hb.counts = o.counts;
  if (o.error) hb.error = { message: String(o.error.message ?? o.error), stack: o.error.stack ?? null };

  hb.note =
    "这是加载心跳，不是配置。每次启动重写，随便删 —— " +
    "你的数据在同目录的 dsh-prompt-easymanager-state.json 和 prompts/ 里。";

  return hb;
}

/**
 * 清掉失效的 `.tmp` 残留。
 *
 * 原子写理论上不会留残留（rename 之后 tmp 就没了），
 * 但进程被杀在 write 和 rename 之间时会留一个。
 * 加载时顺手清一下，免得用户看到 `.tmp` 以为出事了。
 */
export function cleanupStaleTmp(file) {
  try {
    const dir = dirname(file);
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const f of readdirSync(dir)) {
      if (f.startsWith("dsh-prompt-easymanager-heartbeat.json.tmp")) {
        try {
          unlinkSync(join(dir, f));
          n++;
        } catch {
          /* 删不掉就算了 */
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}
