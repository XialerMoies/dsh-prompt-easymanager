// 个人提示词 —— 宿主半体（提示词库、按会话挂载、全局默认、分类、编辑器路由、prompt_manager 工具）
//
// 为 DSH 的**每个会话**独立选择系统提示词，并提供最终系统提示词的实时预览。
//
// 三件事：
//   1. 提示词库  —— `$DSH_HOME/prompts/` 里的条目，可编辑、可重载
//   2. 会话分配  —— 每个会话用哪一条（默认不注入）
//   3. 预览      —— 直接调 dsh 的 assemble()，把最终系统提示词按 section 列出来
//
// 设计原则（沿自旧版踩坑的经验）：
//   - 不用 ctx.settings：它要一份 schemastery schema，而本插件目录解析
//     `@deepseek-ai/*` 会落到全局安装路径，未必与 DSH 运行时是同一模块实例。
//     用一个 JSON 文件最简单也最可控。
//   - 服务取不到时**大声报错**，不静默返回 no-op —— 旧版因为静默失败，
//     客户端点击毫无反应且无从排障。
//   - 诊断信息随 GET 一起返回，失败原因在界面上一眼可见。

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionInjector } from "./scripts/lib/session-injection.mjs";
import { createPromptLibrary, createPromptStore, estimateTokens, CATEGORIES } from "./scripts/lib/prompt-library.mjs";
import {
  normalizeOverrides,
  resolveOverrides,
  normalizeOverride,
  makeOverride,
  planOverrides,
  summarizePlan,
  OVERRIDE_ACTIONS,
} from "./scripts/lib/section-overrides.mjs";
import {
  presetId,
  normalizePresets,
  capturePreset,
  normalizePreset,
  matchPreset,
  summarizePreset,
  normalizeGlobal,
  presetForSession,
  presetLabel,
} from "./scripts/lib/presets.mjs";
import { findEmptySlots, SECTION_SLOTS } from "./scripts/lib/section-slots.mjs";
import { migrateLibraryOutOfPackage } from "./scripts/lib/library-migration.mjs";
import {
  isEmptySelection,
  normalizeSelection,
  applySelectionEdit,
  projectSelection,
} from "./scripts/lib/prompt-selection.mjs";
import {
  writeHeartbeat,
  makeHeartbeat,
  cleanupStaleTmp,
} from "./scripts/lib/heartbeat.mjs";

const PLUGIN_ID = "dsh-prompt-easymanager";
const PLUGIN_NAME = "个人提示词";
const PLUGIN_VERSION = "0.3.5";

/** 客户端用的路由前缀（客户端半体里有一份同名常量，两边必须一致） */
export const STATE_PATH = "/api/prompt-easymanager/state";
export const ASSIGN_PATH = "/api/prompt-easymanager/assign";
export const PREVIEW_PATH = "/api/prompt-easymanager/preview";
export const RELOAD_PATH = "/api/prompt-easymanager/reload";
export const EDIT_PATH = "/api/prompt-easymanager/edit";
export const SECTIONS_PATH = "/api/prompt-easymanager/sections";
export const PRESETS_PATH = "/api/prompt-easymanager/presets";
/**
 * 全局那份配置：`{ enabled, presetId }`。
 *
 * ⚠️ 它**取代**了老的 `/defaults`（那条路由收一堆裸 prompt id）。
 *    新模型里全局也得指向一条预设，所以这个入口叫 global 更贴切。
 */
export const GLOBAL_PATH = "/api/prompt-easymanager/global";

/**
 * 注册了几条路由 —— 心跳里报一个。
 *
 * ⚠️ 从上面的常量**手数**，不用运行时集合：心跳是**模块加载时**就要写的，
 *    那时路由还没注册。数错的话心跳会说谎，所以下面有条测试盯着它。
 */
const ROUTE_COUNT = 8;

const STATE_DIR = process.env.DSH_HOME || join(homedir(), ".dsh");
const STATE_FILE = join(STATE_DIR, "dsh-prompt-easymanager-state.json");

/**
 * 改名之前的状态文件。
 *
 * ⚠️ **必须兼容读** —— 插件从 `dsh-prompt-manager` 改名成
 *    `dsh-prompt-easymanager`，状态文件名跟着变了。只认新名字的话，
 *    老用户升级后**读不到自己那份配置**，打开插件一片空白
 *    （跟之前那个「开关关着就丢配置」是同一类后果）。
 *
 * 策略：**新名字优先；新文件不存在而老文件在 → 读老的**。
 *       写的时候一律写新名字（见 `writeState`），所以读一次就迁过来了，
 *       老文件**留着不动** —— 万一新版有问题，退回去还能用。
 */
const LEGACY_STATE_FILE = join(STATE_DIR, "dsh-prompt-manager-state.json");

/** 这次请求该**读**哪个状态文件。 */
function stateFilePath() {
  try {
    if (existsSync(STATE_FILE)) return STATE_FILE;
    if (existsSync(LEGACY_STATE_FILE)) {
      // 只在**第一次**读老文件时说一声，免得每次请求都刷
      if (!legacyNoticeDone) {
        legacyNoticeDone = true;
        try {
          console.info(
            "[dsh-prompt-easymanager] 从旧状态文件读取配置（" +
              LEGACY_STATE_FILE +
              "），下次写入会落到新文件。旧文件保留不动。",
          );
        } catch {
          /* 没有 console 就算了 */
        }
      }
      return LEGACY_STATE_FILE;
    }
  } catch {
    /* 读不到就当没有 */
  }
  return STATE_FILE;
}
let legacyNoticeDone = false;

/**
 * 这次请求该**写**哪个状态文件。
 *
 * ⚠️ **写一律写新名字 —— 不跟读那条走。**
 *
 *    原来 `writeState` 用的也是 `stateFilePath()`，于是**只要老文件还在，
 *    就永远写回老文件**，新文件永远长不出来。而启动时那句日志说的是
 *    「下次写入会落到新文件」—— **日志跟代码不一致，日志在骗人。**
 *
 *    （真机验证时发现的：心跳里 `paths.state` 报的是老文件名，
 *      而启动日志说会迁到新文件。两者对不上才挖出来。）
 *
 *    现在的语义：
 *
 *        读   有老文件 → 读老的（老用户升级后配置不丢）
 *        写   **一律写新的** → 第一次写就完成迁移
 *        老文件 **保留不动** → 用户后悔了还能翻回去看
 *
 *    迁移是幂等的：新文件一旦出现，`stateFilePath()` 就只读它了。
 */
function stateWritePath() {
  return STATE_FILE;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 提示词库放**用户目录**，不放包里。
 *
 * ⚠️ **这是能发 npm 的前提。** 装在 `node_modules` 里的包目录是**可以被覆盖的** ——
 *    库要是放在包里，用户 `pnpm update` 一次，他攒的提示词**全没了**。
 *    （本地 `link:` 装法看不出这个问题，因为包里就是源码目录。）
 *
 * 位置：`$DSH_HOME/prompts/`（缺省 `~/.dsh/prompts/`），**跟状态文件并排**。
 *
 *     ~/.dsh/dsh-prompt-easymanager-state.json   预设、会话选择、段落改写
 *     ~/.dsh/prompts/catalog.json                库的目录（条目元数据）
 *     ~/.dsh/prompts/<id>.md                     每条提示词的正文
 *
 * 环境变量 `DSH_PROMPT_EASYMANAGER_CATALOG` 可以覆盖（**给测试用的** ——
 * 集成测试要往库里塞几条 fixture，不该污染用户真实的库）。
 */
const PROMPTS_DIR =
  process.env.DSH_PROMPT_EASYMANAGER_CATALOG !== undefined
    ? dirname(process.env.DSH_PROMPT_EASYMANAGER_CATALOG)
    : join(STATE_DIR, "prompts");
const CATALOG_PATH =
  process.env.DSH_PROMPT_EASYMANAGER_CATALOG || join(PROMPTS_DIR, "catalog.json");

/**
 * 库在**包里**时的老位置（v0.3.2 之前）。
 *
 * ⚠️ 一次性迁移：老位置有货、新位置没有 → 搬过去。
 *    判定用「新位置的 catalog 不存在」，所以迁移**只发生一次**，
 *    之后用户怎么改都不会再被覆盖。
 *
 *    ⚠️ 老位置**留着不动**（不是删）—— 万一新版有问题，退回去数据还在。
 *
 * 逻辑本身在 `scripts/lib/library-migration.mjs` —— 那里有它的单元测试
 * （这段有四个「错了就丢数据」的边界，必须被测到）。
 */
const LEGACY_IN_PACKAGE_DIR = join(HERE, "prompts");
const LIBRARY_MIGRATION = migrateLibraryOutOfPackage({
  legacyDir: LEGACY_IN_PACKAGE_DIR,
  targetDir: PROMPTS_DIR,
  targetCatalog: CATALOG_PATH,
});

/**
 * 加载心跳的落点。
 *
 * ⚠️ **跟状态文件分开放** —— 心跳是诊断信息（每次加载重写、随便删），
 *    状态文件是用户数据（删了配置就没了）。分开放，删心跳永远不会误伤配置。
 */
const HEARTBEAT_FILE = join(STATE_DIR, "dsh-prompt-easymanager-heartbeat.json");

/**
 * 读 dsh 的版本 —— 心跳里记一个，版本对不上时很多「怪问题」一句话就解释完。
 *
 * ⚠️ **不能用固定的相对路径猜**（第一版就是 `../../@deepseek-ai/dsh/package.json`，
 *    在真实安装位置下猜不中，结果字段一直是 null）。
 *    从插件自己的目录**往上走**找 `node_modules/@deepseek-ai/dsh`，
 *    这样不管装在哪（profile 的 node_modules / 本地 link / monorepo）都能找到。
 */
function dshVersion() {
  try {
    let dir = HERE;
    for (let up = 0; up < 8; up++) {
      const p = join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json");
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).version ?? null;
      const parent = dirname(dir);
      if (parent === dir) break; // 到根了
      dir = parent;
    }
  } catch {
    /* 读不到就算了 */
  }
  return null;
}

/** 心跳的公共字段（starting / ready 都用这套）。 */
function heartbeatBase(phase, extra) {
  return makeHeartbeat({
    phase,
    pluginId: PLUGIN_ID,
    version: PLUGIN_VERSION,
    dshVersion: dshVersion(),
    nodeVersion: process.version,
    /**
     * ⚠️ **读和写是两个路径，要分开报。**
     *
     *    老用户升级后是「读老的、写新的」—— 只报一个的话，
     *    看心跳的人分不清「配置从哪读的」和「改动会落到哪」。
     *
     *    真机验证时踩过：心跳只报了老路径，而启动日志说「下次写入会落到新文件」，
     *    两者对不上，我以为是心跳报错了 —— 实际是**写那条路一直没走对**
     *    （`writeState` 跟着读的路径走，于是永远写回老文件）。
     */
    stateFile: stateFilePath(),
    stateWriteFile: stateWritePath(),
    stateDir: STATE_DIR,
    promptsDir: PROMPTS_DIR,
    catalogPath: CATALOG_PATH,
    routeCount: ROUTE_COUNT,
    sectionCount: SECTION_SLOTS.length,
    libraryMigration: LIBRARY_MIGRATION,
    ...extra,
  });
}

/**
 * 写心跳。
 *
 * ⚠️ **先写 `starting`，`apply()` 成功后再写 `ready`。**
 *    「加载了」和「生效了」不是一回事 —— 模块 import 成功但 apply 抛错的话，
 *    进程还在、文件也读了，可功能是死的。只写一次的话这两种情况看起来一样，
 *    而那恰恰是最难查的一种失败。
 *
 *    ⚠️ 心跳失败**绝不影响插件**（writeHeartbeat 内部已经吞掉了）。
 */
function beat(phase, extra) {
  writeHeartbeat(HEARTBEAT_FILE, heartbeatBase(phase, extra));
}

/**
 * 老版本内置的那条哨兵提示词的 id。
 *
 * 它叫「不注入」，作用是让用户能在库里点一个选项来表达「什么都不挂」——
 * 但**「一个都不选」本来就是同一个意思**，所以它只是把一件事说成了两件：
 * 库里多一张永远不该被勾的卡片，设置页还得配一张卡片去管它。
 *
 * v0.2.9 起不随包发了（发布包里没有 prompt 条目）。
 * 这个常量只用来**清理老状态里的悬挂 id** —— 见 readState 里的迁移。
 */
const NONE_SENTINEL = "none";

// 顺手清掉上次被强杀留下的 `.tmp`（原子写理论上不留，被杀在中间的会留）
cleanupStaleTmp(HEARTBEAT_FILE);

// ── 心跳第一次落盘：**模块活着** ─────────────────────────────────────────
//
// 这一刻只知道「文件被 import 了、路径解析成什么、库迁移做了什么」。
// 真正生效要等 apply()，那时会再写一次 `ready`。
beat("starting");

/**
 * 找到「这次请求该用哪个注入器」。
 *
 * ⚠️ **不能只认模块级的 `activeInjector`** —— 它是「最后一次 apply 的那个」，
 *    而 `apply()` 每被调用一次就覆盖它。踩过（宿主集成测试里）：
 *
 *        apply(ctx)      → activeInjector = ctx 的注入器
 *        apply(ctxF)     → activeInjector = **ctxF 的注入器**（覆盖了）
 *        之后再往 ctx 发 /assign
 *          → syncInjector() 同步的是 **ctxF 那个**，ctx 的 agent 一直挂不上
 *          → 表现是「接口 200、状态也对，但 agent 上一个 section 都没有」
 *
 *    真机上 `apply` 只调一次，所以看不出来 —— 但那是**碰巧**，不是对的。
 *    正确做法是按 ctx 认：每个 ctx 各存一份，测试里的多个 ctx 互不干扰。
 */
function injectorOf(ctx) {
  const perCtx = ctx && ctx.__pmInjector;
  if (perCtx) return perCtx;
  return activeInjector;
}

/** apply() 时赋值，供工具与路由读取 */
let activeInjector = null;
let activeLibrary = null;
let activeStore = null;
let hostCtxRef = null;

/**
 * 找到「这次请求该用哪个提示词库」。
 *
 * ⚠️ 跟 `injectorOf` 同一个坑：`activeLibrary` / `activeStore` 都是**模块级**的，
 *    每 `apply()` 一次就被覆盖。踩过（宿主集成测试里）：
 *
 *        apply(ctx)   → activeLibrary = ctx 的库
 *        apply(ctxF)  → activeLibrary = **ctxF 的库**
 *        再往 ctx 发 /edit upsert
 *          → 写盘成功（盘上确实有那条），但 `libraryList()` 读的是 ctxF 那个库的
 *            内存副本 → **返回的清单里没有刚新增的条目**
 *
 *    真机上 `apply` 只调一次所以看不出，但那是碰巧。
 */
function libraryOf(ctx) {
  const perCtx = ctx && ctx.__pmLibrary;
  if (perCtx) return perCtx;
  return activeLibrary;
}

/** 同 `libraryOf`，写入侧。 */
function storeOf(ctx) {
  const perCtx = ctx && ctx.__pmStore;
  if (perCtx) return perCtx;
  return activeStore;
}

/**
 * 运行时诊断。
 * 旧版的失败模式是**静默的** —— 路由没注册或校验过严时客户端毫无反馈，
 * 只能靠猜。现在这些事实随 GET 一起返回。
 */
const diag = {
  routeRegistered: false,
  routeError: null,
  lastPost: null,
    lastSections: null,
    lastPresets: null,
    lastToggle: null,
  lastSessionCheck: null,
  lastPreview: null,
  assignCount: 0,
  reloadCount: 0,
  editCount: 0,
};

/** 逐会话诊断（含失败原因）；注入器未就绪时返回空数组。 */
function sessionStates() {
  try {
    return activeInjector ? activeInjector.explain() : [];
  } catch (err) {
    return [{ error: err?.message ?? String(err) }];
  }
}

/** 提示词库清单（不含正文，正文体积大，按需通过 preview/raw 取）。 */
function libraryList(ctx) {
  try {
    const lib = libraryOf(ctx); return lib ? lib.list() : [];
  } catch (err) {
    return [{ error: err?.message ?? String(err) }];
  }
}

function libraryErrors() {
  try {
    return activeLibrary ? activeLibrary.errors() : [];
  } catch {
    return [];
  }
}

/**
 * 列出宿主里真实存在的 agent 及其关键能力。
 * 旧版的失败全都出在「我以为宿主长什么样」—— id 形式、ctx 上有没有 systemPrompt、
 * header 里有什么字段。这个函数把事实直接摆出来，不再靠推断。
 */
function listAgentsDiag() {
  try {
    const c = hostCtxRef;
    if (!c || !c.agents) return { error: "ctx.agents 不可用" };
    const all = typeof c.agents.list === "function" ? c.agents.list() : [];
    const roots = typeof c.agents.roots === "function" ? c.agents.roots() : [];
    const shape = (a) => ({
      id: a?.id ?? null,
      sessionId: a?.session?.id ?? null,
      hasCtx: !!a?.ctx,
      hasInject: typeof a?.ctx?.inject === "function",
      systemPromptDirect: !!a?.ctx?.systemPrompt,
      origin: a?.session?.header?.origin ?? null,
      delegationDepth: a?.session?.header?.delegationDepth ?? null,
      parentSession: a?.session?.header?.parentSession ?? null,
    });
    return {
      listCount: all.length,
      rootsCount: roots.length,
      list: all.map(shape),
      roots: roots.map(shape),
    };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

function publicDiag() {
  return {
    version: PLUGIN_VERSION,
    routeRegistered: diag.routeRegistered,
    routeError: diag.routeError,
    lastPost: diag.lastPost,
    lastSessionCheck: diag.lastSessionCheck,
    lastPreview: diag.lastPreview,
    assignCount: diag.assignCount,
    reloadCount: diag.reloadCount,
    catalogPath: CATALOG_PATH,
    stateFile: STATE_FILE,
    libraryErrors: libraryErrors(),
  };
}

/**
 * 判断浏览器传来的 sessionId 是否可信。
 *
 * ⚠️ 不要写成「`ctx.agents.get()` 取不到就 404」—— 那会**误杀合法会话**：
 *    Agent 是会话被打开/运行时才实例化的，get() 在其它时刻就是 undefined。
 *
 *   - agents 服务不可用           → "unverifiable"（放行，无法判定不能当拒绝）
 *   - 能查到该 id                 → "verified"
 *   - 查不到但没有任何活动 agent  → "unverifiable"（放行，无从比较）
 *   - 查不到但确实有其它活动 agent → "reject"（可疑 id，拒绝）
 *
 * @returns {"verified"|"unverifiable"|"reject"}
 */
function classifySession(ctx, sessionId) {
  let registry;
  try {
    registry = ctx.agents;
  } catch {
    return "unverifiable";
  }
  if (!registry || typeof registry.get !== "function") return "unverifiable";
  try {
    if (registry.get(sessionId) !== undefined) return "verified";
    const liveCount =
      typeof registry.roots === "function"
        ? (registry.roots() ?? []).length
        : typeof registry.list === "function"
          ? (registry.list() ?? []).length
          : 0;
    if (liveCount === 0) return "unverifiable";
    return "reject";
  } catch {
    return "unverifiable";
  }
}

/** 找到某会话对应的 agent（预览需要它来调 assemble）。 */
function findAgentFor(ctx, sessionId) {
  try {
    const roots = ctx.agents?.roots?.() ?? [];
    const list = typeof ctx.agents?.list === "function" ? ctx.agents.list() : roots;
    const norm = (s) => String(s ?? "").replace(/^session-/, "").toLowerCase();
    const want = norm(sessionId);
    return [...list, ...roots].find((a) => norm(a?.id) === want || norm(a?.session?.id) === want);
  } catch {
    return undefined;
  }
}

/**
 * 把「预设的世界」翻译成「注入器的世界」。
 *
 * ⚠️ **这是这次改动最关键的一层胶水**，两个世界用的是不同的东西：
 *
 *     状态文件 / 界面   →  预设 id（`assignments[sid] = "写代码"`）
 *     注入器            →  提示词 id 数组（`explicit.get(sid) = ["格式契约"]`）
 *
 *     `createSessionInjector` 内部按「一堆裸 promptId」建模（1133 行、199 条
 *    测试），直接改它的内部表示风险太大。所以**保持它原样**，在这里翻译。
 *
 * 翻译规则（跟 `presetForSession` 一一对应）：
 *
 *     assignments[sid] 是预设 id  → explicit.set(sid, 那条预设的 prompts)
 *     assignments[sid] 是 null    → explicit.set(sid, [])   ← 注入器认「空数组 = 显式不注入」
 *     没有这个 sid                → **不设 explicit**，让它走 defaults
 *
 *     defaults ← 全局那条预设的 prompts（全局关掉时是空数组）
 *
 * ⚠️ 关键：**「跟随全局」和「显式不注入」在注入器里必须能分开** ——
 *    前者不设 explicit，后者设成空数组。搞混了就会「选了原生但还吃全局」。
 */
function toInjectorState(state) {
  const presets = state.presets ?? {};
  const assignments = {};
  for (const [sid, presetId] of Object.entries(state.assignments ?? {})) {
    if (!sid) continue;
    if (presetId === null) {
      assignments[sid] = []; // 显式什么都不挂
      continue;
    }
    const p = typeof presetId === "string" ? presets[presetId] : undefined;
    if (!p) continue; // 指的预设不存在（被删了）→ 当没记录，走 defaults
    assignments[sid] = [...p.prompts];
  }
  const g = state.global ?? {};
  const gp = g.enabled === true && typeof g.presetId === "string" ? presets[g.presetId] : undefined;
  return { assignments, defaults: gp ? [...gp.prompts] : [] };
}

/**
 * 归一化一份「段落内容」输入 —— **两种形状都收**。
 *
 * ⚠️ 为什么需要这个（踩出来的）：
 *
 *     界面「系统提示词」那一栏发的是老形状 `{ action, text }`。
 *     新模型（`prompt-selection.mjs`）只关心「改成什么」，所以发的是 `{ text }`。
 *
 *     而校验用的是老模型的 `normalizeOverrides()` —— 它**要求 `action` 合法**，
 *     没有就整条丢掉。于是新形状会被**静默丢弃**：
 *     界面上看着存进去了，实际预设里一段都没有。
 *
 *     （测试逮到的：存完预设之后 `selection.sections` 是空的，
 *       于是「会话选了自己的预设 → 按它那条走」那条断言红。）
 *
 * 做法：新形状补一个 `action: "replace"` 再交给老校验 ——
 * 这样返回的对象仍然带着 `action`，老界面的回应格式不用改。
 *
 * @param {object} raw
 * @returns {Record<string, object>}
 */
function normalizeSectionsInput(raw) {
  const out = {};
  for (const [name, ov] of Object.entries(raw ?? {})) {
    if (typeof name !== "string" || !name) continue;
    if (!ov || typeof ov !== "object" || Array.isArray(ov)) continue;
    // 已经有合法 action 的照原样；否则补一个，让它过得了老校验
    const action = ov.action === "disable" ? "disable" : "replace";
    out[name] = { ...ov, action };
  }
  return normalizeOverrides(out);
}

/**
 * 清掉**预设里**已经不存在的提示词 id。
 *
 * ⚠️ 这条是新模型引入的**第二层引用**，老的 `injector.pruneMissing()` 管不到：
 *
 *        全局 / 会话  →  预设  →  提示词
 *
 *    `pruneMissing()` 修的是注入器内部那套（按 prompt id 建模），
 *    而预设里的 `prompts[]` 是盘上的数据，它碰不到。
 *
 *    漏了这一层的表现：预设里留着一条不存在的提示词，注入时被**静默跳过** ——
 *    用户看到「我明明勾了 3 条，只生效 2 条」，而且不报错。
 *
 *    而且**不能靠 `injector.pruneMissing()` 顺带修** —— `toInjectorState()`
 *    是从预设推出来的，预设里还留着幽灵 id 的话，下一次 `syncInjector()`
 *    又会把它翻译回来。**必须改预设本身。**
 *
 * @param {(id: string) => boolean} alive 这个 id 在库里还成不成立
 * @returns {{ presets: Record<string, string[]> }} 被剔掉的，按预设 id 分组
 */
function prunePresets(alive) {
  const s = readState();
  const dropped = {};
  let touched = false;
  const next = {};
  for (const [id, p] of Object.entries(s.presets)) {
    const ghost = (p.prompts ?? []).filter((x) => !alive(x));
    if (ghost.length === 0) {
      next[id] = p;
      continue;
    }
    dropped[id] = ghost;
    touched = true;
    next[id] = { ...p, prompts: p.prompts.filter((x) => alive(x)) };
  }
  if (touched) writeState({ presets: next });
  return { presets: dropped };
}

// ── 状态持久化 ────────────────────────────────────────────────────────────────
//
// 新模型（预设是**唯一载体**）：
//
//   {
//     global:      { enabled: boolean, presetId: string | null },   ← 全局用哪个预设
//     assignments: { "<sessionId>": "<presetId>" | null },          ← 会话用哪个预设
//     presets:     { "<presetId>": { name, prompts[], sections{} } },
//     sectionOverrides:        { … },   ← 保留：段落改写区块仍在用
//     sessionSectionOverrides: { … },
//   }
//
// ⚠️ **`assignments` 的语义变了**：老版本存的是 `["<promptId>", …]`（一堆裸 id），
//    新版本存 `"<presetId>"` 或 `null`（什么都不挂）。读盘时按类型分辨：
//
//      数组 → 老数据，走迁移（见 migrateLegacyState）
//      字符串 / null → 新数据，直接用
//
// `defaults` 字段**保留读取**只为迁移 —— 老版本「全局默认提示词」在那儿。
// 迁移完就不再写它了。
//
// sectionOverrides 的键是**原生系统提示词段落的 name**（如 `harness:identity`），
// **不是下标、不是 order** —— 这样官方新增/改动/删除段落时，用户的数据不用改。
// 详见 docs/section-overrides-design.md。
function readState() {
  try {
    // ⚠️ 走 `stateFilePath()` —— 老名字的文件也认（见上面那段说明）。
const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
    const out = {
      global: { enabled: false, presetId: null },
      assignments: {},
      sectionOverrides: {},
      sessionSectionOverrides: {},
      presets: {},
      /** 「这个插件之前加载过没有」—— 见下面 `ensureDefaultPreset` */
      hasLoaded: parsed?.hasLoaded === true,
    };
    out.presets = normalizePresets(parsed?.presets);
    // ⚠️ **顺序要紧**：先让 `migrateLegacyState` 把老 `defaults[]` 变成一条预设，
    //    再让 `normalizeGlobal` 去匹配那条预设、把 `global.presetId` 指上。
    //
    //    反过来的话 `matchPreset` 在**空预设表**里找不到东西，
    //    `presetId` 就是 null —— 用户老 `defaults` 里那几条**静默消失**。
    //    （演练真实状态文件时发现的：`defaults:["my-prompt-1"]` + 开关关着，
    //      迁移后什么都没剩下。）
    migrateLegacyState(out, parsed);
    out.global = normalizeGlobal(parsed?.global, {
      // ⚠️ 按老版本的语义传：**不写 `enabled` = 开着**（`parsed?.enabled !== false`）。
      //    传 `parsed?.enabled` 的话，「没有这个字段」会变成 undefined → 关掉，
      //    用户升级后全局注入凭空失效。
      switchEnabled: parsed?.enabled !== false,
      defaults: parsed?.defaults,
      sectionOverrides: parsed?.sectionOverrides,
      presets: out.presets,
    });
    if (parsed?.sectionOverrides && typeof parsed.sectionOverrides === "object") {
      out.sectionOverrides = normalizeOverrides(parsed.sectionOverrides);
    }
    // 按会话的改写：{ "<sessionId>": { "<name>": {...} } }
    const perSession = parsed?.sessionSectionOverrides;
    if (perSession && typeof perSession === "object" && !Array.isArray(perSession)) {
      for (const [sid, table] of Object.entries(perSession)) {
        if (typeof sid !== "string" || !sid) continue;
        const norm = normalizeOverrides(table);
        // 空表不占位 —— 免得文件里堆一堆 `"session-x": {}`
        if (Object.keys(norm).length > 0) out.sessionSectionOverrides[sid] = norm;
      }
    }
    ensureDefaultPreset(out);
    return out;
  } catch {
    /* 文件不存在或损坏：等价于「什么都不挂」+「不改动任何原生段落」，符合默认值 */
  }
  const fresh = {
    global: { enabled: false, presetId: null },
    assignments: {},
    sectionOverrides: {},
    sessionSectionOverrides: {},
    presets: {},
    hasLoaded: false,
  };
  // ⚠️ **第一次跑（连状态文件都没有）也要给那条默认预设。**
  //    这样刚装上的用户进设置页就能看到一条能用的，而不是空白。
  ensureDefaultPreset(fresh);
  return fresh;
}

/** 默认那条预设叫什么。 */
const DEFAULT_PRESET_NAME = "系统提示词（原生）";

/**
 * 首次加载时造一条「全部原生」的预设。
 *
 * ⚠️ **只在「第一次」造，之后就算用户把它删了也不再造。**
 *    判据是 `hasLoaded` —— 这个插件之前加载过没有。
 *    没有它的话，每读一次盘都判断「预设表空不空」，用户删掉默认预设之后
 *    会**每次打开设置页都被造回来**，而且他自己删不掉。
 *
 * ⚠️ **这条预设的清单是「空的」** —— 而空清单的意思正是「全勾」（都用原生）。
 *    见 `prompt-selection.mjs`：没动过的段不在任何名单里，自动包含。
 *    所以不需要在造的时候去问 dsh 有哪些段，也就不需要会话。
 *
 * ⚠️ **不去改 `global`** —— 不自动把全局注入打开。
 *    造一条预设 ≠ 决定用它；用不用是用户的事（界面上一目了然）。
 *
 * @param {object} out  就地改
 */
function ensureDefaultPreset(out) {
  if (out.hasLoaded === true) return;
  out.hasLoaded = true;
  if (Object.keys(out.presets).length > 0) return; // 已经有别的预设了（老用户）
  const id = presetId(DEFAULT_PRESET_NAME, Object.keys(out.presets));
  out.presets[id] = capturePreset({
    name: DEFAULT_PRESET_NAME,
    prompts: [],
    sections: {},
    note: "刚装上时的默认：三段都用 dsh 原生的。改哪一段，它就会挪进「改动提示词」。",
  });
}

/**
 * 把一份「勾选清单」的改动**写进该落的那条预设**。
 *
 * ⚠️ **这是老 `/sections` 路由跟新模型的桥。**
 *
 *    老路由（界面「系统提示词」那一栏还在用）原来是写 `state.sectionOverrides`
 *    那张独立表的。新模型里段落改写**由预设承载**，那张表不再被读 ——
 *    于是「在那一栏改一段」会**写了不生效**。
 *
 *    两条路可选：① 读的时候把老表折算进来（桥接）② 写的时候直接写进预设。
 *
 *    **② 是对的。** 桥接那条路我试过，它会让老表变成「影响所有预设的一层」——
 *    本质上就是这次要修掉的那个 bug（段落改写无条件生效）换个地方复发。
 *    注入验证逮到的：把「没有预设就返回 null」注入掉之后，测试**照样全绿**，
 *    因为桥接把老改写塞回来了。
 *
 * ⚠️ **`fallbackToGlobal`：带 session 但那个会话没有生效预设时，退到全局那条。**
 *
 *    真机上复现出来的（一个真 bug）：
 *
 *        POST /sections           （不带 session） →  200，写进全局预设
 *        POST /sections?session=X （X 设了「不注入」）→  409，写不了
 *
 *    同一个逻辑动作，带不带参数结果不一样 —— 而设置页那一栏**本来就只管全局层**
 *    （界面上没有「这一栏是写给谁的」这个选择）。所以带上 session 时
 *    不该被那个会话的「不注入」挡住。
 *
 *    ⚠️ **但会话自己选了预设时不许退** —— 那是用户明确的选择，
 *       退到全局会让「改 A 会话的段落」悄悄改了所有会话。
 *
 * @param {object} args
 * @param {string} [args.sessionId]
 * @param {boolean} [args.fallbackToGlobal]  没有生效预设时退到全局那条
 * @param {(sel: object) => object} args.edit  收一份清单、返回改完的清单
 * @returns {{ok: true, presetId: string, via: string, fellBack?: boolean}
 *          | {ok: false, outcome: string, error: string}}
 */
function editActivePresetSelection({ sessionId, fallbackToGlobal = false, edit }) {
  const s = readState();
  let found = presetForSession({
    sessionId,
    assignments: s.assignments,
    global: s.global,
    presets: s.presets,
  });
  let fellBack = false;

  if (fallbackToGlobal && (!found || !found.preset)) {
    // 退到全局那条 —— 但**只在全局这一层确实有一条**的时候。
    // 全局没指预设（或指的那条不在了）时给一个说得清的错误。
    const gp =
      typeof s.global?.presetId === "string" && s.presets[s.global.presetId]
        ? s.presets[s.global.presetId]
        : null;
    if (gp) {
      found = { id: s.global.presetId, preset: gp, source: "global" };
      fellBack = true;
    }
  }

  if (!found || !found.preset) {
    return {
      ok: false,
      outcome: "no-active-preset",
      error:
        "这个会话没有生效的预设，改动无处可存 —— " +
        "先在会话页选一条预设（或者把全局注入打开并选一条）。",
    };
  }
  const before = found.preset.selection ?? { listed: [], excluded: [], sections: {}, known: [] };
  const after = edit(before);
  const next = normalizePreset({ ...found.preset, selection: after });
  if (next === null) {
    return { ok: false, outcome: "bad-preset", error: "改完之后预设不合法（名字丢了？）" };
  }
  writeState({ presets: { ...s.presets, [found.id]: next } });
  // ⚠️ `via` / `fellBack` 要回传 —— 界面得能说清「这条改动写到哪儿去了」。
  //    退了的话尤其要说，不然用户以为改的是当前会话。
  return { ok: true, presetId: found.id, via: found.source ?? "unknown", fellBack };
}

/**
 * 老数据 → 新模型。
 *
 * ⚠️ **这是整个改动里最容易悄悄弄丢用户配置的地方**，所以规则写清楚：
 *
 *   老 `assignments[sid] = ["p1","p2"]`（裸 prompt id 数组）
 *        ↓
 *   ① 先看这个组合**是不是已经等于某条已存预设**（内容一样就认出来，不重复存）
 *   ② 不是 → **新存一条预设**把它装进去，名字取「（旧配置 前几个 id）」
 *   ③ `assignments[sid]` 改成那条预设的 id
 *
 *   老的 `defaults[]` + `sectionOverrides` 同理 —— 但那部分由 `normalizeGlobal`
 *   处理（它会把全局指向认出来的预设）。
 *
 * 认不出来的**不猜**：宁可多存一条预设让用户看见，也不要把配置抹掉。
 */
function migrateLegacyState(out, parsed) {
  const map = parsed?.assignments;
  if (!map || typeof map !== "object" || Array.isArray(map)) return;
  /** 迁移出来的预设名会带这个前缀，用户一眼能看出是搬过来的。 */
  const MIGRATED = "（旧配置）";
  for (const [sid, value] of Object.entries(map)) {
    if (typeof sid !== "string" || !sid) continue;
    if (Array.isArray(value)) {
      // ── 老格式：裸 prompt id 数组 ──
      const prompts = value.filter((x) => typeof x === "string" && x && x !== NONE_SENTINEL);
      // 空数组 = 老的「显式不注入」→ 新模型里正好就是 null
      if (prompts.length === 0) {
        out.assignments[sid] = null;
        continue;
      }
      const same = matchPreset({ prompts, sections: {} }, out.presets);
      if (same) {
        out.assignments[sid] = same.id;
        continue;
      }
      // ⚠️ **必须幂等**：同一个 sid 读两遍、或者盘上还留着老数组，
      //    每次都会走到这儿。只按内容判重不够 —— 上面的 matchPreset 只认
      //    内容完全一样的，`["a"]` 和 `["a","b"]` 会各自长一条。
      //    所以再按**名字**兜一层：名字是按 prompts 拼的，同样的输入必然同名。
      const name = `${MIGRATED} ${prompts.slice(0, 3).join("、")}`;
      const byName = Object.entries(out.presets).find(([, p]) => p.name === name);
      if (byName) {
        out.assignments[sid] = byName[0];
        continue;
      }
      const id = presetId(name, Object.keys(out.presets));
      out.presets[id] = capturePreset({ name, prompts, sections: {} });
      out.assignments[sid] = id;
      continue;
    }
    // ── 新格式：presetId 或 null ──
    if (value === null) {
      out.assignments[sid] = null;
    } else if (typeof value === "string" && value && value !== NONE_SENTINEL) {
      out.assignments[sid] = value;
    }
  }

  // ── 老的全局 `defaults[]` ──────────────────────────────────────────────
  //
  // ⚠️ 这一段是**演练真实状态文件之后补的**。原来只迁 `assignments`，
  //    而 `normalizeGlobal` 只会在**已有的预设表**里找匹配 —— 用户的
  //    `presets: {}` 是空的，于是 `defaults: ["my-prompt-1"]` 被**静默丢掉**。
  //
  //    这里先把它变成一条预设，`normalizeGlobal`（在 readState 里**稍后**调用）
  //    就能匹配到、把 `global.presetId` 指上。
  const defs = (Array.isArray(parsed?.defaults) ? parsed.defaults : []).filter(
    (x) => typeof x === "string" && x && x !== NONE_SENTINEL,
  );
  if (defs.length > 0) {
    const secs =
      parsed?.sectionOverrides && typeof parsed.sectionOverrides === "object"
        ? normalizeOverrides(parsed.sectionOverrides)
        : {};
    // ⚠️ 先在已有预设里找内容一模一样的（幂等）—— 第二次读盘不能又长一条。
    const same = matchPreset({ prompts: defs, sections: secs }, out.presets);
    if (!same) {
      const name = `${MIGRATED} 全局 ${defs.slice(0, 3).join("、")}`;
      const byName = Object.entries(out.presets).find(([, p]) => p.name === name);
      if (!byName) {
        const id = presetId(name, Object.keys(out.presets));
        out.presets[id] = capturePreset({ name, prompts: defs, sections: secs });
      }
    }
  }
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    // ⚠️ **先读盘再合并** —— 不能直接覆盖。
    //    注入器调 saveState 时只传一部分字段；如果直接写，
    //    那一侧的写入会把 `sectionOverrides` 整块抹掉
    //    （改一次会话分配就把用户的段落改写全丢了）。
    const onDisk = readState();
    const merged = {
      global: {
        // ⚠️ 两个字段分开判「有没有显式传」—— `enabled: false` 和 `presetId: null`
        //    都是**合法的新值**，用真值判断会把它们当成「没传」。
        enabled:
          state && state.global && "enabled" in state.global
            ? state.global.enabled === true
            : onDisk.global.enabled,
        presetId:
          state && state.global && "presetId" in state.global
            ? typeof state.global.presetId === "string" && state.global.presetId
              ? state.global.presetId
              : null
            : onDisk.global.presetId,
      },
      // ⚠️ **`assignments` 只认预设 id，不认注入器传回来的 prompt id 表。**
      //
      //    注入器的 `persist()` 会把**整张** `assignments`（值是裸 prompt id
      //    数组）传过来，那是它内部的表示。原样写盘的话，状态文件会被写回
      //    老格式 —— 下次读盘又走一遍迁移，预设越迁移越多（踩过：临时目录里
      //    长出 9 条「（旧配置）…」）。
      //
      //    所以这里只接受「值不是数组」的输入（字符串 = 预设 id、null = 不挂）。
      //    注入器内部那套对不上的话，以**状态文件为准** —— 见 `syncInjector()`。
      assignments: pickPresetAssignments(state, onDisk),
      sectionOverrides:
        state && "sectionOverrides" in state && state.sectionOverrides
          ? normalizeOverrides(state.sectionOverrides)
          : onDisk.sectionOverrides,
      sessionSectionOverrides:
        state && "sessionSectionOverrides" in state && state.sessionSectionOverrides
          ? state.sessionSectionOverrides
          : onDisk.sessionSectionOverrides,
      presets:
        state && "presets" in state && state.presets
          ? normalizePresets(state.presets)
          : onDisk.presets,
      // ⚠️ **「见过面」标记：从盘上继承，只认盘上那份。**
      //
      //    用途：区分「刚装上，该给你造那条默认预设」和
      //    「你之前来过，而且把默认那条删了」—— 后者不该被造回来。
      //
      //    ⚠️ 不认入参：调用方大多只传一部分字段，认入参的话这个标记会被写没，
      //       下次加载又把用户删掉的预设造回来。
      //
      //    ⚠️ **也不要 `|| true`** —— 我第一版这么写过，标记恒为真、等于没有。
      //       它由 `readState` 在读盘时补上（那边才判断得出「是不是第一次」）。
      hasLoaded: onDisk.hasLoaded === true,
      updatedAt: new Date().toISOString(),
    };
    // ⚠️ 写**一律写新名字**（`stateWritePath()`）—— 这样第一次写就完成迁移。
    //    跟着 `stateFilePath()` 走的话，只要老文件还在就永远写回老文件，
    //    新文件永远长不出来（而日志说会迁移 —— 那就是日志在骗人）。
    writeFileSync(stateWritePath(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* 持久化失败不影响本次会话内的效果 */
  }
}

/**
 * 从一次写入里挑出「合法的预设 id 分配」。
 *
 * 合法 = 值是 `string`（预设 id）或 `null`（显式不挂）。
 *
 * ⚠️ **只要看到一个数组，就整块放弃这次写入、保留盘上那份。**
 *
 *    数组是**注入器的内部表示**（一堆裸 prompt id），不是盘上的格式。
 *    注入器的 `persist()` 在 `pruneMissing()` / `assign()` 里都会调，
 *    传回来的就是这种数组表。
 *
 *    踩过两次，第二次很隐蔽：
 *      · 第一版「原样写盘」→ 盘上被写成老格式，下次读盘又走一遍迁移，
 *        预设越迁移越多（临时目录里长出 9 条「（旧配置）…」）。
 *      · 第二版改成「把数组项丢掉」→ **丢掉之后写出了空对象**，
 *        于是「删一条提示词，所有会话的预设选择全没了」。
 *        （探针原话：`传入assignments=有 盘上={"s1":"含弃用项"} 合并后={}`。）
 *
 *    正确做法是**整块不认** —— 注入器那份视图跟盘上格式对不上时以盘上为准，
 *    它内部该有什么由 `syncInjector()` 按盘重建。
 */
function pickPresetAssignments(state, onDisk) {
  if (!state || !("assignments" in state) || !state.assignments) return onDisk.assignments;
  const out = {};
  for (const [sid, v] of Object.entries(state.assignments)) {
    if (typeof sid !== "string" || !sid) continue;
    // ⚠️ 数组 = 注入器的内部表示 → **整块放弃**，保留盘上那份
    if (Array.isArray(v)) return onDisk.assignments;
    if (v === null) out[sid] = null;
    else if (typeof v === "string" && v) out[sid] = v;
    // 数字 / 其他脏值：单条丢掉，不影响别的会话
  }
  return out;
}

/**
 * 让注入器跟上盘上的状态。
 *
 * ⚠️ **状态文件是唯一真相**，注入器只是它的一份投影。
 *    每次改完盘都调这个，注入器的内存副本就不会和盘漂移
 *    （它内部按 prompt id 建模，翻译在 `toInjectorState`）。
 *
 * ⚠️ **`restore()` 之后必须 `reattachAll()`** —— `restore()` 只重建映射表、
 *    **不挂载**。少了这一步的表现是「状态对了但 agent 上一个 section 都没有」，
 *    而且不报错（宿主集成测试逮到过）。
 *
 * @param {object} [ctx] 这次操作发生在哪个 ctx 上（见 `injectorOf`）
 */
function syncInjector(ctx) {
  const inj = injectorOf(ctx);
  if (!inj) return;
  try {
    inj.restore(toInjectorState(readState()));
    inj.reattachAll();
  } catch (err) {
    // ⚠️ **不能静默吞掉** —— 踩过：`restore()` 抛了之后注入器内部映射是**半空**的，
    //    表现成「状态文件里明明选着预设，界面上什么都不注入」，而日志里一个字都没有，
    //    只能逐层加探针查。至少把原因说出来。
    console.error(`[${PLUGIN_ID}] 同步注入器失败：${err?.message ?? String(err)}`);
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────
const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

const promptTool = {
  name: "prompt_manager",
  description:
    "查看「个人提示词」插件的运行状态：可用提示词清单、每个会话当前的分配与挂载情况、" +
    "以及诊断信息。用于排查「选了提示词但没生效」。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  output: objectOutput,
  execute() {
    const snap = activeInjector ? activeInjector.snapshot() : { defaults: [], assignments: {} };
    return {
      plugin: PLUGIN_ID,
      name: PLUGIN_NAME,
      pluginVersion: PLUGIN_VERSION,
      catalogPath: CATALOG_PATH,
      stateFile: STATE_FILE,
      stateVersion: snap.version ?? 2,
      /** 全局默认：新会话没显式指定时用这几条 */
      defaults: snap.defaults ?? [],
      prompts: libraryList(hostCtxRef),
      libraryErrors: libraryErrors(),
      sessions: sessionStates(),
      liveAgents: listAgentsDiag(),
      seenAgentIds: activeInjector ? activeInjector.seenAgentIds() : [],
      diag: publicDiag(),
      notes: [
        "一个会话可以挂多条提示词，各自按 order 排序插入；改分配后**下一步即生效**。",
        "未显式指定的会话用「全局默认」（defaults）；显式设成空数组 = 该会话不注入。",
        "生效前提：那个会话的 agent 还活着。未加载的会话会在被打开时自动补挂。",
        "提示词有分类（category）：identity / domain / tool / output / other，也可以自定义。" +
          "分类只影响界面分组；真正决定插入位置的是 order。",
        "v0.1.9 起已删除 replace（替换）模式 —— 它会顶掉 dsh 原生的身份声明和全部工具用法说明。",
        "状态文件每条记录约 60 字节；不做自动清理（没有安全的「会话是否存在」接口），" +
          "需要时用 prune() 手动清。",
      ],
    };
  },
};

export const name = PLUGIN_ID;
export const inject = ["tools", "systemPrompt", "connection", "agents"];

/** 心跳里报几个数 —— 「库读出来了吗、几条」一眼可见。 */
function heartbeatCounts(library) {
  try {
    const list = library.list();
    return { prompts: list.length, errors: list.errors?.length ?? 0 };
  } catch (err) {
    return { prompts: null, errors: null, listError: String(err) };
  }
}

/**
 * 真正的 apply 实现。
 *
 * ⚠️ 它被外面那层 `apply` 包着，**只是为了写心跳**（出错时把错误落盘）。
 *    不直接把 try/catch 塞进来，是因为那要给近千行重新缩进 ——
 *    那种大范围改动最容易改坏东西，能不做就不做。
 */
function applyInner(ctx) {
  // ── 提示词库 ──────────────────────────────────────────────────────────────
  const library = createPromptLibrary({ catalogPath: CATALOG_PATH, baseDir: PROMPTS_DIR });
  activeLibrary = library;
  // 编辑器用的写入侧（设置页那个 tab）。只动库目录内的文件（见 PROMPTS_DIR）。
  const store = createPromptStore({ catalogPath: CATALOG_PATH, baseDir: PROMPTS_DIR });
  activeStore = store;
  // ⚠️ **按 ctx 各存一份**（原因见 libraryOf / injectorOf）——
  //    模块级那两份会被「后一次 apply」覆盖，多 ctx 场景下读到的库就错人了。
  try {
    ctx.__pmLibrary = library;
    ctx.__pmStore = store;
  } catch {
    /* ctx 可能是冻结对象；拿不到就退回模块级 */
  }

  // ── 按会话分配 ────────────────────────────────────────────────────────────
  const injector = createSessionInjector({
    resolvePrompt: (id) => library.resolve(id),
    saveState: writeState,
    topLevelOnly: true,
    // ⚠️ 传**函数**而不是当前这张表 —— 每次装配都现取，
    //    所以界面上改完，**下一个模型步骤就生效**，不用重挂 agent。
    // ⚠️ **入参是 sessionId，返回的是这个会话实际生效的那张表。**
    //    两层合并：全局默认改写 ← 被「该会话的改写」盖住（按段落名合）。
    //    每次装配都现取 —— 界面上改完，下一个模型步骤就生效，不用重挂 agent。
    // ⚠️ **全局开关不再传给注入器** —— 新模型里「全局关掉」= 全局那条预设
    //    不生效（`toInjectorState` 把 defaults 算成空数组）。
    //    注入器的 `isEnabled` 还会顺带**掐掉显式选择**（见它 443 行），
    //    那在新模型里是错的：全局关掉时用户自己选的预设照样该生效。
    //    所以这里恒为 true，语义完全由 `global.enabled` 在翻译层表达。
    isEnabled: () => true,
    /**
     * 这个会话该套哪份「勾选清单」。
     *
     * ⚠️ **返回值 `null` = 一段都不套** —— 这是这次改造的核心。
     *
     *    老实现是从 `state.sectionOverrides` + `state.sessionSectionOverrides`
     *    两张表里**无条件**取改写，不问开关、不问选了哪条预设。于是：
     *
     *        全局注入关掉      →  段落改写**照样生效**
     *        会话选了「不注入」 →  同上
     *        会话什么都没选     →  照样吃全局那份改写
     *
     *    现在改成**跟着预设走**，跟个人提示词同一套作用域规则：
     *
     *        会话选了预设      →  用那条的清单
     *        没选，全局也开着   →  用全局那条的
     *        其余（含全局关掉） →  **null**，系统提示词原样，一个字都不改
     *
     *    判定完全交给 `presetForSession` —— 它本来就是干这个的，
     *    个人提示词那半一直走它。两半从此同一套规则。
     *
     * ⚠️ **下面那段「老数据桥接」是暂时的，第三步要删。**
     *
     *    老的 `/sections` 路由（界面「系统提示词」那一栏还在用）把改写写进
     *    `state.sectionOverrides` 那张单独的表，而不是写进预设。新模型不看
     *    那张表了 —— 于是「在那一栏改一段」会**写了不生效**。
     *
     *    桥接：有生效的预设时，把它清单里没有的老改写**折算进去**。
     *    语义上说得通 —— 全局改写本来就是「所有预设共享的那层」。
     *
     *    等第三步把那栏改成「写进当前预设」，这段就删掉，
     *    `sectionOverrides` / `sessionSectionOverrides` 两张表一起退休。
     */
    getSectionOverrides: (sessionId) => {
      const s = readState();
      const found = presetForSession({
        sessionId,
        assignments: s.assignments,
        global: s.global,
        presets: s.presets,
      });
      // ⚠️ 没有生效的预设 → **null**。这就是修掉的那个 bug：
      //    「全局关掉」和「会话不注入」都走到这儿，段落改写不再生效。
      //
      //    ⚠️ **必须直接 return，不能落进下面的桥接。**
      //       注入验证逮到的：第一版「先算出 sel、再进桥接」——
      //       于是桥接会把 `state.sectionOverrides` 里那份老改写**塞回来**，
      //       等于 `null` 那条路被绕过去了，bug 原样还在
      //       （「没有生效的预设时照样套」那个注入**没变红**，就是它暴露的）。
      if (!found || !found.preset) return null;

      const sel = found.preset.selection ?? { listed: [], excluded: [], sections: {}, known: [] };

      // ⚠️ **这里原来有一段「老数据桥接」**（把 `state.sectionOverrides` 里的
      //    老改写折算进清单），**已删** —— 它有两个毛病：
      //
      //    ① 它让那张老表变成「影响**所有**预设的一层」——
      //       本质上就是这次要修掉的 bug（段落改写无条件生效）换了个地方复发。
      //       注入验证逮到的：把上面那句 `return null` 注入掉之后，
      //       测试**照样全绿** —— 因为桥接把老改写塞了回来，等于没修。
      //
      //    ② 正确的做法是**写的时候直接写进预设**，不是读的时候折算。
      //       老的 `/sections` 路由已经改成写预设（见 `editActivePresetSelection`）。
      //
      //    那张表从此**只读不写**：只为把升级前的老数据读出来一次
      //    （`readState` 里的 `migrateLegacyState` 会把它并进预设）。
      return sel;
    },
  });
  injector.restore(toInjectorState(readState()));
  activeInjector = injector;
  // ⚠️ **按 ctx 存一份**（见 `injectorOf`）—— 多个 ctx 各用各的，
  //    不会出现「后 apply 的那个把前一个顶掉」。
  try {
    ctx.__pmInjector = injector;
  } catch {
    /* ctx 可能是冻结对象；拿不到就退回模块级那份 */
  }
  hostCtxRef = ctx;

  // 登记插件加载时已存活的顶层会话（官方惯用法：roots() + on 配对）。
  try {
    const live = ctx.agents?.roots?.();
    if (live) injector.seedAgents(live);
  } catch {
    /* agents 不可用时静默；后续 agent/created 仍会登记新会话 */
  }

  ctx.effect(() => {
    const onCreated = ({ agent }) => injector.handleAgentCreated(agent);
    const onDisposed = ({ agent }) => injector.handleAgentDisposed(agent);
    ctx.on("agent/created", onCreated);
    ctx.on("agent/disposed", onDisposed);
    return () => {
      injector.disposeAll();
    };
  });

  // ── HTTP 路由 ─────────────────────────────────────────────────────────────
  // 参考实现：dsh-client-file-upload/lib/index.js:170-175
  //           dsh-client-ui-deliverables/lib/index.js:34-39
  // 直连 ctx.connection（依赖 apply 声明的 inject）；取不到时大声报错而不是静默 no-op。
  const jsonHeaders = { "cache-control": "no-store" };

/**
 * 统一的 JSON 响应。
 *
 * 36 条路由本来每处都手写 `{ headers: jsonHeaders }`（带状态的还要写两遍）——
 * 一个地方忘了加就变成可缓存的响应。收成一个函数，漏不了。
 */
const jsonOf = (body, status) =>
  Response.json(body, status === undefined ? { headers: jsonHeaders } : { status, headers: jsonHeaders });

  ctx.effect(() => {
    const connection =
      ctx.connection ?? (typeof ctx.get === "function" ? ctx.get("connection") : undefined);
    if (!connection?.fetch?.register) {
      diag.routeRegistered = false;
      diag.routeError = "connection.fetch.register 不可用";
      console.error(
        `[${PLUGIN_ID}] 无法注册路由：connection.fetch.register 不可用。会话头部的提示词选择器将无法工作。`,
      );
      return () => {};
    }
    diag.routeRegistered = true;
    diag.routeError = null;

    // 按 pathname 分发。四条路径共用同一个 handler。
    //
    // ⚠️ 必须**逐个路径单独注册**，`path` 只能是**单个字符串**。
    //    曾试过 `path: [A, B, C, D]`，结果是四条路由全部失效 —— 因为
    //    dsh-client-connection 把路由存在 `Map` 里按 `url.pathname` **精确匹配**：
    //        lib/index.js:611  `const route = this.fetchRoutes.get(url.pathname)`
    //        lib/index.js:634  `this.fetchRoutes.set(route.path, registered)`
    //    键写成数组，`get(pathname)` 就永远取不到 → 请求落到默认处理，表现为 404。
    //    类型也写明了：dsh-host-webserver/lib/types/index.d.ts:36 `path: string`。
    //    所有一方插件（/api/file、file-upload、deliverables）传的都是单个字符串。
    const handleRequest = async (request) => {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;

      // ── POST state：总开关 ──────────────────────────────────────────────
      //
      // 「本插件对提示词的一切干预」的**总开关**。关掉 = 完全用 dsh 原始提示词
      // （不注入自设提示词、不改写原生段落），不用去清空各项配置。
      //
      // ⚠️ 生效方式是**在装配时清空自己注入的段落**，不是"不挂载" ——
      //    后者要遍历所有 agent 卸载重挂，还有竞态。详见 session-injection.mjs。
      if (path === STATE_PATH && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonOf({ error: "请求体不是合法 JSON" }, 400);
        }
        if (!("enabled" in (body ?? {}))) {
          return jsonOf({ error: "缺少 enabled 字段" }, 400);
        }
        const next = body.enabled !== false;
        writeState({ enabled: next });
        diag.lastToggle = next ? "enabled" : "disabled";
        return jsonOf({ ok: true, enabled: next, note: next ? "已启用你的提示词配置" : "已切回 dsh 原始提示词" });
      }

      // ── GET state：分配表 + 默认 + 提示词库 + 诊断 ──────────────────
      if (path === STATE_PATH && request.method === "GET") {
        const snap = injectorOf(ctx)?.snapshot() ?? { version: 2 };
        // ⚠️ **盘上那份才是真相**（预设、全局、会话选择），`injector.snapshot()`
        //    是注入器内部的 prompt id 视图，跟界面要的东西对不上。
        //    所以这里读盘，不用 snap.assignments / snap.defaults。
        const st = readState();
        const items = libraryList(ctx);
        // 选词面板要按分类分组，所以这份也要带分类表和目录里的自定义分类
        const custom = [...new Set(
          items
            .map((p) => p && p.category)
            .filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
        )].sort();
        return jsonOf({
            /**
             * 每个会话选的是哪条预设。
             *
             * ⚠️ **值现在是「预设 id 字符串」或 `null`（显式什么都不挂）。**
             *    老版本这里是「一堆 prompt id 数组」，读盘时会被迁移成预设
             *    （见 `migrateLegacyState`）。
             */
            assignments: st.assignments,
            /**
             * 全局那份配置：`{ enabled, presetId }`。
             *
             * ⚠️ 它**取代**了老版本的两个独立东西（`enabled` 总开关 + `defaults[]`
             *    默认提示词）—— 现在全局也得指向一条预设，所以只有一处状态，
             *    不会再出现「开关关着、但里面还设着一堆东西」那种糊里糊涂的情况。
             */
            global: st.global,
            /**
             * ⚠️ **`enabled` 也单独回一份**（就是 `global.enabled` 的投影）——
             *    会话头那个徽章和设置页的胶囊都读它。
             *    漏了的话客户端读到 `undefined`，而 `d.enabled !== false` 恒为 true，
             *    表现是「开关怎么点都弹回去」（POST 明明成功，紧接着 load() 又读回 true）。
             *    踩过一次，所以钉住。
             */
            enabled: st.global.enabled === true,
            /** 预设表（界面要用它渲染勾选状态和标签） */
            presets: st.presets,
            /**
             * 原生段落改写 —— **全局层**（所有会话都用）。
             * 按会话的那层在 `/sections` 里回传，会话头徽章用那个。
             */
            sectionOverrides: st.sectionOverrides,
            version: snap.version,
            prompts: items,
            categories: CATEGORIES,
            customCategories: custom,
            catalogPath: CATALOG_PATH,
            diag: publicDiag(),
          });
      }

      // ── GET/POST sections：原生系统提示词段落的拆分 / 编辑 / 关掉 / 还原 ──
      //
      // 这是「按段落改系统提示词」的入口。设计见 docs/section-overrides-design.md。
      //
      // ⚠️ 状态存在 STATE_FILE 的 `sectionOverrides` 里，**键是段落的 name**
      //    （如 `harness:identity`），不是下标也不是 order ——
      //    这样官方新增/改动/删除段落时用户的数据一个字都不用改。
      if (path === SECTIONS_PATH) {
        const sessionId = url.searchParams.get("session") ?? undefined;

        if (request.method === "GET") {
          const found = await injector.listSections(sessionId);
          const state = readState();

          // ⚠️ **这里从这一版起走新模型（勾选清单），不再读那两张退休的表。**
          //
          //    老版本算的是 `planOverrides({ overrides: state.sectionOverrides, ... })`。
          //    段落改写现在由预设承载，那张表不再被读 —— 继续读它的后果是
          //    「界面显示的还是改之前的样子」，而且 `availableNative` 也拿不到
          //    （三块文件夹需要它才知道原生段有哪些）。
          const foundPreset = presetForSession({
            sessionId,
            assignments: state.assignments,
            global: state.global,
            presets: state.presets,
          });
          const selNow = foundPreset?.preset?.selection ?? null;
          const projected = projectSelection({
            native: found.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
            selection: selNow,
          });

          /**
           * 把新模型的投影结果**翻译成老形状**的行。
           *
           * ⚠️ 界面在这一版还没改完，仍在读 `applied` / `drifted` / `stale` /
           *    `untouched`。翻译层让两边都能用；等界面改完就可以直接换掉。
           */
          const liveOf = (nm) => found.sections.find((s) => s.name === nm)?.text ?? "";
          const asRow = (row, status) => {
            const ov = selNow?.sections?.[row.name];
            return {
              name: row.name,
              index: found.sections.findIndex((s) => s.name === row.name),
              status,
              drifted: row.drifted === true,
              driftAcknowledged: false,
              original: liveOf(row.name),
              originalHash: "",
              basedOn: ov?.original ?? "",
              basedOnHash: "",
              action: status === "apply" ? "replace" : null,
              text: row.text ?? "",
              savedAt: ov?.savedAt ?? "",
            };
          };
          const appliedRows = projected.plan
            .filter((r) => r.mode === "edited" || r.mode === "dropped")
            .map((r) => asRow(r, "apply"));
          const untouchedRows = projected.plan
            .filter((r) => r.mode === "native")
            .map((r) => asRow(r, "untouched"));
          const staleRows = (projected.stale ?? []).map((r) => asRow(r, "stale"));

          diag.lastSections = found.outcome;
          return jsonOf({
              outcome: found.outcome,
              error: found.error ?? null,
              agentId: found.agentId ?? null,
              summary:
                appliedRows.length > 0 ? `改 ${appliedRows.length} 段` : "全部原生",
              /** 会被应用的（含「官方已更新」的） */
              applied: appliedRows,
              /** apply 里「官方改过这段」的那些（子集，界面上标红） */
              drifted: appliedRows.filter((r) => r.drifted),
              /** 名字已不存在，保留数据但不应用 */
              stale: staleRows,
              /** 用户没动过的 */
              untouched: untouchedRows,
              /**
               * 当前能用的原生段名 —— 界面要拿它去判断「空清单」。
               *
               * ⚠️ 保存预设时界面得把它递回来（`availableNative`）：
               *    「一张清单是不是空」取决于**当前有哪些原生段**，
               *    服务端在别的上下文里不知道这件事，只能问界面。
               *    递不了就不拦（fail-open）—— 见 `emptySelectionProblem`。
               */
              availableNative: found.sections.map((s) => s.name),
              /**
               * 被排除掉的段名（清单里 `excluded` 那些）。
               *
               * ⚠️ 界面要它才能把「系统提示词」那块的勾选框画对：
               *    没排除的勾着、排除的空着。光看 `applied` 分不出来 ——
               *    「没改过」和「明确不要」在那边长得一样。
               */
              excludedSections: Array.isArray(selNow?.excluded) ? selNow.excluded : [],
              /**
               * dsh 预留了、但**这次没有被注册**的位置 —— 界面显示成灰色卡片，
               * 让用户知道「为什么 bash 不在」而不是以为列表出错了。
               *
               * 只报判断确定的两种（静态段名 / 没有包注册它）；模板名
               * （`tool:${toolName}`）**不报** —— 判断不了，硬报会误伤
               * （`tool:subagent_fork` 就归在 TOOL_SUBAGENT 那个键下）。
               * 详见 scripts/lib/section-slots.mjs。
               */
              emptySlots: findEmptySlots(found.sections),
              slotTotal: SECTION_SLOTS.length,
              /**
               * 两层改写都回传 —— 界面要能显示「这条是全局的还是在当前会话覆盖的」。
               *
               *   globalOverrides   全局默认（所有会话都用）
               *   sessionOverrides  当前会话的（**盖住全局**）
               *   effective         两者合并后实际生效的（= 上面 plan 算的那张）
               *
               * ⚠️ 这三个字段这一版**故意留着**（值为空），只为了让还没改完的
               *    界面不崩。它们反映的是那两张**已退休**的表，读到的永远是空。
               *    界面改完之后删掉。
               */
              globalOverrides: {},
              sessionOverrides: {},
              effectiveOverrides: {},
              counts: {
                applied: appliedRows.length,
                drifted: appliedRows.filter((r) => r.drifted).length,
                stale: staleRows.length,
                untouched: untouchedRows.length,
                total: found.sections.length,
              },
              actions: OVERRIDE_ACTIONS,
            });
        }

        if (request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastSections = "bad-json";
            return jsonOf({ error: "请求体不是合法 JSON" }, 400);
          }

          const name = typeof body?.name === "string" ? body.name : "";
          const action = typeof body?.action === "string" ? body.action : "";
          if (!name) {
            diag.lastSections = "missing-name";
            return jsonOf({ error: "缺少 name" }, 400);
          }

          /**
           * 这条改动**写到哪儿去了**（由下面的 `commit` 填）。
           *
           * ⚠️ **必须声明在这一层**，不能在下面那个 `{}` 块里 ——
           *    响应是在块**外面**拼的，块里声明的它看不见。
           *    （写的时候踩过：`ReferenceError: wroteTo is not defined`。）
           */
          let wroteTo = null;

          // ── ⚠️ 从这一版起，这里**写进预设**，不再写 `sectionOverrides` ──
          //
          //    新模型里段落改写由预设承载（`selection`），那张独立的表不再被读。
          //    所以这条路必须改成写预设 —— 不然「在系统提示词那一栏改一段」
          //    会**写了不生效**（而且不报错）。
          //
          //    ⚠️ 老的 `scope` 参数**不再有意义**：改动跟着**这会话实际生效的那条预设**走
          //       （会话选了就用会话那条，没选就用全局那条）。
          //       这跟个人提示词是同一套规则 —— 两半终于统一了。
          {
            // ⚠️ **校验顺序：先参数、再段落、最后才查「有没有预设」。**
            //    第一版把「有没有生效的预设」放在最前，于是「非法 action」
            //    「replace 缺 text」「段落不存在」全被盖成了 409 ——
            //    而那几条校验**本来就不该依赖有没有预设**。测试逮到的。
            if (!["restore", "replace", "disable", "acknowledge"].includes(action)) {
              diag.lastSections = "bad-action";
              return jsonOf(
                {
                  error: `action 必须是 replace / disable / restore / acknowledge，收到 ${JSON.stringify(action)}`,
                },
                400,
              );
            }
            if ((action === "replace" || action === "disable") && action === "replace" && typeof body?.text !== "string") {
              diag.lastSections = "missing-text";
              return jsonOf({ error: "replace 需要 text" }, 400);
            }

            // 这一段**当前的官方原文** —— 编辑时当漂移基准，还原/确认时也要用
            const foundLive = await injector.listSections(sessionId);
            const live = foundLive.sections.find((s) => s.name === name);
            const liveText = typeof live?.text === "string" ? live.text : "";
            if ((action === "replace" || action === "disable") && live === undefined) {
              diag.lastSections = "unknown-section";
              return jsonOf(
                {
                  error: `找不到段落 ${name} —— 它可能刚被官方删掉或改名了`,
                  knownNames: foundLive.sections.map((s) => s.name),
                },
                404,
              );
            }

            // ── `acknowledge` 的校验要**放在最前** ────────────────────────────
            //
            // ⚠️ 它跟别的动作不一样：**不写任何东西**，只是把漂移基准推到当前原文。
            //    所以「没有生效的预设」对它不是错误 —— **没有记录**才是（404）。
            //
            //    第一版把它跟别的动作一起放在「有没有预设」后面，于是
            //    「确认一个不存在的覆盖」返回的是 409「没有预设」——
            //    **答非所问**，而且那条 404 的路**永远走不到**（测试逮到的）。
            if (action === "acknowledge") {
              const sAck = readState();
              const foundAck = presetForSession({
                sessionId,
                assignments: sAck.assignments,
                global: sAck.global,
                presets: sAck.presets,
              });
              if (!foundAck?.preset?.selection?.sections?.[name]) {
                diag.lastSections = "acknowledge-missing";
                return jsonOf({ error: `段落 ${name} 没有改动记录，无从确认` }, 404);
              }
            }

            // ── 「改动有没有地方存」交给下面的 `commit` 判 ────────────────────
            //
            // ⚠️ **这里原来有个早返回的检查，它把 fallback 整个绕过去了。**
            //
            //    写这个 fallback 时踩过：在路由里先判一次「有没有生效的预设」，
            //    没有就 409 —— 而 `editActivePresetSelection` 里那个
            //    「退到全局」的兜底根本轮不到执行。
            //    表现是：加完 fallback，测试**一条都没变绿**。
            //
            //    判据只能有**一处**。这里不判，让 `commit`（它带 fallback）去判 ——
            //    它判完还会把「写到哪儿去了」回报上来，比这儿判信息更全。

            /** 把一份改好的清单写回那条预设；失败就返回响应对象。 */
            //
            // ⚠️ **`fallbackToGlobal: true`** —— 带 session 但那个会话没有生效预设时，
            //    退到全局那条。理由见 `editActivePresetSelection` 的注释：
            //    真机上复现过「同一个动作带不带 session 参数结果不一样」。
            //    设置页那一栏本来就只管全局层，不该被某个会话的「不注入」挡住。
            const commit = (editFn) => {
              const r = editActivePresetSelection({ sessionId, fallbackToGlobal: true, edit: editFn });
              if (!r.ok) {
                diag.lastSections = r.outcome;
                return jsonOf({ ok: false, outcome: r.outcome, error: r.error }, 409);
              }
              wroteTo = r;
              return null;
            };

            // ⚠️ 参数和段落**上面都验过了**，所以下面这一串可以放心分发 ——
            //    不用在每个分支里重复校验。
            if (action === "restore") {
              // 「还原默认」= 把这段从清单里拿掉 → 回到原生
              const bad = commit((sel) => {
                const next = normalizeSelection(sel);
                next.listed = next.listed.filter((n) => n !== name);
                next.excluded = next.excluded.filter((n) => n !== name);
                delete next.sections[name];
                return next;
              });
              if (bad) return bad;
            } else if (action === "replace" || action === "disable") {
              const bad = commit((sel) =>
                applySelectionEdit({
                  native: [{ name, text: liveText }],
                  selection: sel,
                  name,
                  // ⚠️ 「关闭」在新模型里就是**不勾**（进 excluded），
                  //    不再是一个 `disable` 动作。见 prompt-selection.mjs。
                  action: action === "disable" ? "exclude" : "include",
                  edit:
                    action === "disable" ? undefined : { text: body.text, original: liveText },
                }),
              );
              if (bad) return bad;
            } else if (action === "acknowledge") {
              // 点掉「官方已更新」的提醒：**把基准推到当前原文**，正文不动。
              //
              // ⚠️ 没有覆盖记录时给 **404** —— 「无从确认」跟「没有预设」是两回事，
              //    别混成一个状态码（第一版混了，测试逮到的）。
              const sAck = readState();
              const foundAck = presetForSession({
                sessionId,
                assignments: sAck.assignments,
                global: sAck.global,
                presets: sAck.presets,
              });
              if (!foundAck?.preset?.selection?.sections?.[name]) {
                diag.lastSections = "acknowledge-missing";
                return jsonOf({ error: `段落 ${name} 没有改动记录，无从确认` }, 404);
              }
              const bad = commit((sel) => {
                const next = normalizeSelection(sel);
                const ov = next.sections[name];
                if (ov) next.sections[name] = { ...ov, original: liveText };
                return next;
              });
              if (bad) return bad;
            }
          }
          // 覆盖是**每次装配现取**的（见 createSessionInjector 的 getSectionOverrides），
          // 所以这里不用重挂 agent，下一个模型步骤就生效。

          const found2 = await injector.listSections(sessionId);
          // ⚠️ **响应形状暂时保持老样子**（`applied` / `drifted` / `stale` /
          //    `untouched` / `summary`）—— 界面那一栏还在读它们，
          //    改了会让它崩。第三步界面改完之后，这里跟着换成新模型的
          //    「三个文件夹」形状。
          //
          //    但**内容要来自新的清单**，不能再去读那两张退休的表 ——
          //    否则「改完一段，界面显示的还是旧的」。
          const stateAfter2 = readState();
          const foundAfter = presetForSession({
            sessionId,
            assignments: stateAfter2.assignments,
            global: stateAfter2.global,
            presets: stateAfter2.presets,
          });
          const selAfter = foundAfter?.preset?.selection ?? null;
          const projected = projectSelection({
            native: found2.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
            selection: selAfter,
          });
          // 把新模型的投影结果**翻译回老形状**
          const asRow = (row, status) => {
            const ov = selAfter?.sections?.[row.name];
            return {
              name: row.name,
              index: found2.sections.findIndex((s) => s.name === row.name),
              status,
              drifted: row.drifted === true,
              driftAcknowledged: false,
              original: found2.sections.find((s) => s.name === row.name)?.text ?? "",
              originalHash: "",
              basedOn: ov?.original ?? "",
              basedOnHash: "",
              action: status === "apply" ? "replace" : null,
              text: row.text ?? "",
              savedAt: ov?.savedAt ?? "",
            };
          };
          const appliedRows = projected.plan
            .filter((r) => r.mode === "edited")
            .map((r) => asRow(r, "apply"));
          const droppedRows = projected.plan
            .filter((r) => r.mode === "dropped")
            .map((r) => asRow(r, "apply"));
          const untouchedRows = projected.plan
            .filter((r) => r.mode === "native")
            .map((r) => asRow(r, "untouched"));
          const staleRows = (projected.stale ?? []).map((r) => asRow(r, "stale"));
          const allApplied = appliedRows.concat(droppedRows);
          diag.lastSections = `${action}:ok`;
          return jsonOf({
              ok: true,
              action,
              name,
              /**
               * 这条改动**写到哪儿去了**。
               *
               * ⚠️ 界面要能说清这件事 —— 尤其 `fellBack` 为真时：
               *    用户带着某个会话来改，而改动落到了**全局那条**预设上，
               *    不说的话他会以为只影响当前会话。
               */
              wroteTo: wroteTo
                ? { presetId: wroteTo.presetId, via: wroteTo.via, fellBack: wroteTo.fellBack === true }
                : null,
              summary:
                allApplied.length > 0
                  ? `改 ${allApplied.length} 段`
                  : untouchedRows.length > 0
                    ? "全部原生"
                    : "",
              applied: allApplied,
              drifted: allApplied.filter((r) => r.drifted),
              stale: staleRows,
              untouched: untouchedRows,
              /**
               * 当前能用的原生段名 —— 界面要拿它去判断「空清单」。
               *
               * ⚠️ 保存预设时界面得把它递回来（`availableNative`）：
               *    「一张清单是不是空」取决于**当前有哪些原生段**，
               *    服务端在别的上下文里不知道这件事，只能问界面。
               *    递不了就不拦（fail-open）—— 见 `emptySelectionProblem`。
               */
              availableNative: found2.sections.map((s) => s.name),
              /**
               * 被排除掉的段名（清单里 `excluded` 那些）。
               *
               * ⚠️ 界面要它才能把「系统提示词」那块的勾选框画对：
               *    没排除的勾着、排除的空着。光看 `applied` 分不出来 ——
               *    「没改过」和「明确不要」在那边长得一样。
               */
              excludedSections: Array.isArray(selAfter?.excluded) ? selAfter.excluded : [],
              // 改完一段后空槽位也要重算 —— 通常不会变，但保持两个响应形状一致
              emptySlots: findEmptySlots(found2.sections),
              counts: {
                applied: allApplied.length,
                drifted: allApplied.filter((r) => r.drifted).length,
                stale: staleRows.length,
                untouched: untouchedRows.length,
                total: found2.sections.length,
              },
            });
        }
      }

      // ── GET/POST presets：快速预设（把一整套配置存成名字，一键切换）──────
      //
      // 预设 = **一层配置的完整快照**。两层对称：
      //     全局层:  defaults[]             + sectionOverrides
      //     会话层:  assignments[sessionId] + sessionSectionOverrides[sessionId]
      //
      // ⚠️ **应用预设是「覆盖」不是「合并」** —— 见 presets.mjs 文件头的说明。
      //    合并的话就永远去不掉之前加的提示词，「切换」这个语义就不成立了。
      // ── /presets：提示词组合（预设）──────────────────────────────────
      //
      // 新模型：**预设是配置的唯一载体**。
      //
      //     GET  → 预设清单 + 全局那份 + 指定会话那份
      //     POST → save（直接收内容）/ update / delete / apply
      //
      // ⚠️ 跟老版本最大的不同：`save` **直接收 `prompts[]` 和 `sections{}`**，
      //    不再「把当前那一层的状态存成快照」—— 新模型里没有「当前层状态」
      //    这个东西了，勾选区编辑的就是预设本身。
      if (path === PRESETS_PATH) {
        const sessionId = url.searchParams.get("session") ?? undefined;
        const hasSession = typeof sessionId === "string" && sessionId.length > 0;

        /** 把预设表变成界面要的列表（带显示标签）。 */
        const presetList = (s) =>
          Object.entries(s.presets)
            .map(([id, p]) => ({
              id,
              name: p.name,
              prompts: p.prompts,
              sections: p.sections,
              createdAt: p.createdAt,
              note: p.note,
              summary: summarizePreset(p),
              /** 会话页标签按这个显示（只有系统改动时不显示预设名） */
              label: presetLabel(p),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (request.method === "GET") {
          const s = readState();
          return jsonOf({
            presets: presetList(s),
            global: s.global,
            /** 这个会话选的是哪条（null = 显式不挂；字段不存在 = 跟随全局） */
            session: hasSession
              ? {
                  sessionId,
                  presetId: Object.prototype.hasOwnProperty.call(s.assignments, sessionId)
                    ? s.assignments[sessionId]
                    : undefined,
                }
              : null,
            /** 目前**实际生效**的是哪条（把跟随 / 显式 / 全局都算完） */
            effective: hasSession
              ? presetForSession({
                  sessionId,
                  assignments: s.assignments,
                  global: s.global,
                  presets: s.presets,
                })
              : null,
          });
        }

        if (request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPresets = "bad-json";
            return jsonOf({ error: "请求体不是合法 JSON" }, 400);
          }
          const action = typeof body?.action === "string" ? body.action : "";

          /**
           * 校验并归一化一份「内容」。
           *
           * ⚠️ **没给的字段要返回 `undefined`，不能默认成空** —— 调用方靠
           *    「是不是 undefined」区分「没传，保持原样」和「传了空，就是要清空」。
           *
           *    踩过：`update` 只改名（不带 prompts）时，第一版把 prompts 默认成
           *    `[]`，于是**改个名字就把预设内容清空了**，而且界面看着一切正常。
           *    （「只改名时内容不许被清空」那条测试当场红。）
           */
          const readContent = () => {
            const out = {};
            if ("prompts" in (body ?? {})) {
              const prompts = Array.isArray(body.prompts) ? body.prompts : [];
              const unknown = prompts.filter((x) => typeof x !== "string" || !libraryOf(ctx).has(x));
              if (unknown.length > 0) return { error: `提示词库里没有：${unknown.join("、")}` };
              out.prompts = prompts;
            }
            if ("sections" in (body ?? {})) {
              // ⚠️ **两种形状都收** —— 老界面发 `{action, text}`，新模型只发 `{text}`。
              //
              //    这里原来用的是 `normalizeOverrides()`（老模型的校验），
              //    而它**要求 `action` 是 `replace` / `disable` 之一**，没有就整条丢掉。
              //    于是新形状的 `{ text }` 会被**静默丢弃** —— 界面上看着存进去了，
              //    实际预设里一段都没有。（测试逮到的：存完 `selection.sections` 是空的。）
              //
              //    新模型里「有没有 action」不该是判据：能留下来的记录就是
              //    「改成这样」，而 `disable` 由 `excluded` 表达、不需要正文。
              out.sections =
                body.sections && typeof body.sections === "object" && !Array.isArray(body.sections)
                  ? normalizeSectionsInput(body.sections)
                  : {};
            }
            return out;
          };

          /**
           * 拦住「一段都不会进提示词」的清单。
           *
           * ⚠️ 为什么值得拦：把 32 段全不勾、又没挂任何提示词，
           *    这个会话就等于**没有系统提示词** —— 模型会跑得莫名其妙，
           *    而用户不会想到是自己那张清单搞的。
           *
           * ⚠️ **判据不能是「清单是空的」** —— 空清单正好是**默认的全勾状态**
           *    （「没动过的段自动包含」）。真正的空是「该有的原生段全被排除了」，
           *    所以要知道**当前有哪些原生段**。
           *
           * ⚠️ **拿不到原生段清单时不拦**（fail-open）。
           *    界面会把它知道的那份通过 `availableNative` 递过来；
           *    递给不了（比如第三方调用）就放过 —— 宁可少拦，别把正常保存挡住。
           *
           * @returns {string|null} 有错返回说明文字，没问题返回 null
           */
          const emptySelectionProblem = (content) => {
            const available = Array.isArray(body?.availableNative) ? body.availableNative : [];
            if (available.length === 0) return null; // 不知道 → 不拦
            const raw = body?.selection && typeof body.selection === "object" ? body.selection : {};
            const sel = {
              listed: Array.isArray(raw.listed) ? raw.listed : [],
              excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
              // ⚠️ **`selection.sections` 也要算进去。** 第一版只看老形状的
              //    `content.sections`，于是「全排除 + 改了一段」会被误判成空
              //    （测试里的第 ③ 条当场红了）。
              sections: { ...(raw.sections && typeof raw.sections === "object" ? raw.sections : {}) },
            };
            // 老形状的输入（只有 `sections`）没有 excluded 的概念，
            // 所以按老形状折算一遍：`disable` 进 excluded，其余进 sections。
            for (const [name, ov] of Object.entries(content.sections ?? {})) {
              if (ov && ov.action === "disable") {
                sel.excluded = [...sel.excluded, name];
              } else {
                sel.sections[name] = { ...ov };
              }
            }
            return isEmptySelection({ selection: sel, availableNative: available })
              ? "这张清单里一段都不会进系统提示词 —— 至少勾一段原生段落，或者挂一条自己的提示词。"
              : null;
          };

          // ── 保存新预设 ──────────────────────────────────────────────────
          if (action === "save") {
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) {
              diag.lastPresets = "missing-name";
              return jsonOf({ error: "缺少预设名字" }, 400);
            }
            const content = readContent();
            if (content.error) {
              diag.lastPresets = "unknown-prompt";
              return jsonOf({ error: content.error }, 400);
            }
            {
              const empty = emptySelectionProblem(content);
              if (empty) {
                diag.lastPresets = "empty-selection";
                return jsonOf({ ok: false, outcome: "empty-selection", error: empty }, 400);
              }
            }
            const s = readState();
            const id = presetId(name, Object.keys(s.presets));
            const preset = capturePreset({
              name,
              // 「存」的时候缺字段就是空（新建没给就是空的，语义清楚）
              prompts: content.prompts ?? [],
              sections: content.sections ?? {},
              note: typeof body?.note === "string" ? body.note : "",
            });
            writeState({ presets: { ...s.presets, [id]: preset } });
            diag.lastPresets = `save:${id}`;
            return jsonOf({ ok: true, id, preset });
          }

          // ── 改内容 / 改名 ───────────────────────────────────────────────
          //
          // ⚠️ 改名要**把指着它的引用一起改**（全局 + 各会话），否则留下悬挂
          //    引用 —— 表现是「改完名字，会话页那条预设没了」，而且不报错。
          if (action === "update") {
            const id = typeof body?.id === "string" ? body.id : "";
            const s = readState();
            const preset = s.presets[id];
            if (!preset) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
            }
            const content = readContent();
            if (content.error) {
              diag.lastPresets = "unknown-prompt";
              return jsonOf({ error: content.error }, 400);
            }
            // ⚠️ 改名/改内容**同样要拦住空清单** ——
            //    不然「先存一条好的、再把它改成空的」就绕过去了。
            //    只在真的动了段落内容时才判（只改名不该被拦）。
            if ("sections" in (body ?? {}) || "selection" in (body ?? {})) {
              const empty = emptySelectionProblem(content);
              if (empty) {
                diag.lastPresets = "empty-selection";
                return jsonOf({ ok: false, outcome: "empty-selection", error: empty }, 400);
              }
            }
            const name =
              typeof body?.name === "string" && body.name.trim() ? body.name.trim() : preset.name;
            const nextId = presetId(name, Object.keys(s.presets).filter((x) => x !== id));
            const nextPresets = { ...s.presets };
            delete nextPresets[id];
            nextPresets[nextId] = {
              ...preset,
              name,
              // ⚠️ 没传就**保持原样**（`undefined` 才会走到 `??` 右边）——
              //    改成无条件赋值的话，「只改名」会把内容清空。
              prompts: content.prompts ?? preset.prompts,
              sections: content.sections ?? preset.sections,
            };
            const patch = { presets: nextPresets };
            if (nextId !== id) {
              if (s.global.presetId === id) patch.global = { ...s.global, presetId: nextId };
              const nextAssign = {};
              let touched = false;
              for (const [sid, v] of Object.entries(s.assignments)) {
                if (v === id) {
                  nextAssign[sid] = nextId;
                  touched = true;
                } else nextAssign[sid] = v;
              }
              if (touched) patch.assignments = nextAssign;
            }
            writeState(patch);
            syncInjector(ctx);
            diag.lastPresets = `update:${id}->${nextId}`;
            return jsonOf({ ok: true, id: nextId, oldId: id, name });
          }

          // ── 删除 ────────────────────────────────────────────────────────
          //
          // ⚠️ 删之前要**把指着它的地方清掉**，否则全局 / 会话会指向一条不存在的
          //    预设 —— 界面上的表现是「选了预设但什么都不生效」，且没有任何报错。
          //    清掉之后它们退回「跟随全局 / 原生」。
          if (action === "delete") {
            const id = typeof body?.id === "string" ? body.id : "";
            const s = readState();
            if (!s.presets[id]) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
            }
            const nextPresets = { ...s.presets };
            delete nextPresets[id];
            const patch = { presets: nextPresets };
            if (s.global.presetId === id) patch.global = { ...s.global, presetId: null };
            const nextAssign = {};
            let touched = false;
            for (const [sid, v] of Object.entries(s.assignments)) {
              if (v === id) touched = true;
              else nextAssign[sid] = v;
            }
            if (touched) patch.assignments = nextAssign;
            writeState(patch);
            syncInjector(ctx);
            diag.lastPresets = `delete:${id}`;
            return jsonOf({ ok: true, id });
          }

          // ── 应用：把某条预设挂到全局或某个会话 ──────────────────────────
          if (action === "apply") {
            const id = typeof body?.id === "string" ? body.id : "";
            const s = readState();
            const preset = s.presets[id];
            if (!preset) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
            }
            const target = body?.target === "session" ? "session" : "global";
            if (target === "session" && !hasSession) {
              diag.lastPresets = "missing-session";
              return jsonOf({ error: "挂到会话上必须带 ?session=<sessionId>" }, 400);
            }
            if (target === "global") {
              // ⚠️ 用户定的规则：全局要生效就得选定预设 —— 所以这里顺带把它打开。
              //
              // ⚠️ **段落覆盖也要一起写** —— 预设的两半是「个人提示词」+「系统提示词改动」，
              //    只写前者的话，预设里改过的段落根本不会生效（而且不报错）。
              //    全局那份覆盖存在 `sectionOverrides` 里。
              writeState({
                global: { ...s.global, presetId: id, enabled: true },
                sectionOverrides: preset.sections,
              });
            } else {
              writeState({ assignments: { ...s.assignments, [sessionId]: id } });
            }
            syncInjector(ctx);
            diag.lastPresets = `apply:${target}:${id}`;
            return jsonOf({
              ok: true,
              id,
              name: preset.name,
              target,
              label: presetLabel(preset),
              applied: {
                prompts: preset.prompts.length,
                sections: Object.keys(preset.sections).length,
              },
            });
          }

          diag.lastPresets = "bad-action";
          return jsonOf(
            {
              error: `action 必须是 save / update / delete / apply，收到 ${JSON.stringify(action)}`,
            },
            400,
          );
        }
      }

      // ── GET preview：某会话最终的系统提示词 ──────────────────────────
        if (path === PREVIEW_PATH && request.method === "GET") {
          const sessionId = url.searchParams.get("session");
          if (!sessionId) {
            diag.lastPreview = "missing-session";
            return new Response("session query param required", { status: 400 });
          }
          const result = await injector.preview(sessionId);
          diag.lastPreview = result.outcome ?? "unknown";
          return jsonOf(result);
        }

        // ── POST reload：重读 catalog.json ──────────────────────────────
        if (path === RELOAD_PATH && request.method === "POST") {
          let r;
          try {
            r = libraryOf(ctx).reload();
          } catch (err) {
            diag.lastPost = "reload-threw";
            return jsonOf({ error: err?.message ?? String(err) }, 500);
          }
          diag.reloadCount += 1;
          diag.lastPost = `reload:${r.count}`;
          // 重载后：
          //   1. 先把引用到「已不存在条目」的**预设**清掉
          //   2. 再把其余会话重挂一遍 —— 提示词正文可能变了
          //
          // ⚠️ 顺序要紧：**先清预设再 sync**。反过来的话，`syncInjector()` 会
          //    按还带着幽灵 id 的预设去挂，然后又得再来一遍。
          //    （注入器自己那份 `pruneMissing()` **修不了预设** —— 预设是盘上的
          //      数据，它只按 prompt id 建模。见 `prunePresets` 的注释。）
          const pruned = prunePresets((id) => libraryOf(ctx).has(id));
          syncInjector(ctx);
          return jsonOf({ count: r.count, errors: r.errors, prompts: libraryList(ctx), pruned });
        }

        // ── POST assign：给会话指定提示词（数组）────────────────────────
        // ── POST assign：给某个会话选一条预设 ──────────────────────────
        //
        // ⚠️ **收的是预设 id，不是一堆 prompt id** —— 新模型里预设是唯一载体，
        //    想挂提示词必须先存成预设。老客户端传 `promptIds` 会明确报错，
        //    而不是被悄悄当成预设 id（那会变成「指向不存在的预设」）。
        //
        //      presetId: "写代码"  → 这个会话用这条预设
        //      presetId: null      → 显式什么都不挂（压过全局）
        //      （不传 presetId 字段 → 400；想「跟随全局」就删掉这条记录）
        if (path === ASSIGN_PATH && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPost = "bad-json";
            return jsonOf({ ok: false, error: "请求体不是合法 JSON" }, 400);
          }
          const sessionId = body?.sessionId;
          if (typeof sessionId !== "string" || !sessionId) {
            diag.lastPost = "missing-sessionId";
            return jsonOf({ ok: false, error: "缺少 sessionId" }, 400);
          }

          // 老客户端的调用方式：明确说出来，别让人猜
          if ("promptIds" in (body ?? {}) || "promptId" in (body ?? {})) {
            diag.lastPost = "legacy-promptIds";
            return jsonOf(
              {
                ok: false,
                outcome: "preset-required",
                error:
                  "现在要选提示词组合（预设），不再直接收提示词 id。" +
                  "先把组合存成预设，再传 presetId。",
              },
              400,
            );
          }

          // ⚠️ **三种状态，必须分清楚**（会话页那个下拉框就靠这个区分）：
          //
          //      presetId: "写代码"   → 这个会话用这条预设
          //      presetId: null      → **显式什么都不挂**（压过全局）
          //      follow: true        → **删掉记录 = 跟随全局**
          //
          //    「什么都不挂」和「跟随全局」不是一回事：全局开着的时候，
          //    前者是一条都不挂，后者是吃全局那条。合并成一个的话，
          //    用户就没法表达「这个会话别挂全局的」。
          if (body?.follow === true) {
            const beforeFollow = readState();
            const nextFollow = { ...beforeFollow.assignments };
            delete nextFollow[sessionId];
            writeState({ assignments: nextFollow });
            syncInjector(ctx);
            diag.lastPost = "assign:follow";
            return jsonOf({ ok: true, presetId: undefined, follow: true, assignments: nextFollow });
          }

          if (!("presetId" in (body ?? {}))) {
            diag.lastPost = "missing-presetId";
            return jsonOf(
              {
                ok: false,
                error: "要传 presetId（预设名或 null），或者 follow: true（跟随全局）",
              },
              400,
            );
          }
          const presetId = body.presetId;
          if (presetId !== null && (typeof presetId !== "string" || !presetId)) {
            diag.lastPost = "bad-presetId";
            return jsonOf({ ok: false, error: "presetId 要么是预设名，要么是 null" }, 400);
          }

          const before = readState();
          if (typeof presetId === "string" && !before.presets[presetId]) {
            diag.lastPost = "unknown-preset";
            return jsonOf(
              {
                ok: false,
                outcome: "unknown-preset",
                error: `没有这条预设：${presetId}`,
                known: Object.keys(before.presets),
              },
              400,
            );
          }

          // 会话存不存在：宽松处理 —— 「还没建出来的新会话」也要能预先选，
          // 所以只挡**明确判定为不存在**的（`reject` 那条）。
          const verdict = classifySession(ctx, sessionId);
          diag.lastSessionCheck = verdict;
          if (verdict === "reject") {
            diag.lastPost = "unknown-session";
            return jsonOf({ ok: false, error: "会话不存在" }, 404);
          }

          const nextAssign = { ...before.assignments };
          if (presetId === null) nextAssign[sessionId] = null;
          else nextAssign[sessionId] = presetId;
          writeState({ assignments: nextAssign });
          syncInjector(ctx);
          diag.assignCount += 1;
          diag.lastPost = `assign:${presetId ?? "(none)"}`;
          return jsonOf({
            ok: true,
            presetId: presetId ?? null,
            assignments: nextAssign,
            sessionCheck: verdict,
          });
        }

        // ── GET/POST global：全局那份配置（开关 + 用哪条预设）──────────
        if (path === GLOBAL_PATH) {
          if (request.method === "GET") {
            return jsonOf({ global: readState().global });
          }
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPost = "bad-json";
            return jsonOf({ ok: false, error: "请求体不是合法 JSON" }, 400);
          }
          const s = readState();
          const next = { ...s.global };
          if ("enabled" in (body ?? {})) next.enabled = body.enabled === true;
          if ("presetId" in (body ?? {})) {
            next.presetId =
              typeof body.presetId === "string" && body.presetId ? body.presetId : null;
          }
          // ⚠️ 用户定的规则：**要开全局注入，必须先选定一个预设。**
          //    没选就开 → 400，并且不改动任何东西（别默默开一个什么都不注入的全局）。
          if (next.enabled === true && !next.presetId) {
            diag.lastPost = "global-needs-preset";
            return jsonOf(
              {
                ok: false,
                outcome: "preset-required",
                error: "要开启全局注入，得先选一个预设",
                known: Object.keys(s.presets),
              },
              400,
            );
          }
          if (next.presetId && !s.presets[next.presetId]) {
            diag.lastPost = "unknown-preset";
            return jsonOf(
              { ok: false, outcome: "unknown-preset", error: `没有这条预设：${next.presetId}` },
              400,
            );
          }
          writeState({ global: next });
          syncInjector(ctx);
          diag.lastToggle = next.enabled ? "enabled" : "disabled";
          return jsonOf({ ok: true, global: readState().global });
        }

        // ── GET edit：编辑器要的**带正文**清单（POST 见下）─────────────
        if (path === EDIT_PATH && request.method === "GET") {
          // ⚠️ 读盘（真相来源），不要绕 injector —— 它内部是 prompt id 视图，
          //    给不出「预设表 + 全局指向哪条」这两样编辑器要的东西。
          const stEdit = readState();
          const items = libraryOf(ctx).raw().map((entry) => {
            const resolved = entry && typeof entry.id === "string" ? library.resolve(entry.id) : undefined;
            return {
              id: entry?.id ?? null,
              name: resolved?.name ?? entry?.name ?? entry?.id ?? null,
              description: resolved?.description ?? entry?.description ?? "",
              category: resolved?.category ?? "other",
              mode: resolved?.mode ?? entry?.mode ?? "append",
              order: resolved?.order ?? entry?.order ?? 100,
              source: typeof entry?.file === "string" && entry.file ? "file" : typeof entry?.inline === "string" ? "inline" : "none",
              file: typeof entry?.file === "string" ? entry.file : null,
              tokens: resolved ? estimateTokens(resolved.text ?? "") : 0,
              chars: resolved ? (resolved.text ?? "").length : 0,
              text: resolved?.text ?? "",
            };
          });
          // 目录里出现过的自定义分类也要报给 UI —— 否则用户自己起的分类
          // 在「分类」下拉框里找不到，只能重打一遍
          const custom = [...new Set(
            items.map((p) => p.category).filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
          )].sort();
          return jsonOf({
              prompts: items,
              // 内置分类表（含建议 order）+ 目录里已存在的自定义分类
              categories: CATEGORIES,
              customCategories: custom,
              /**
               * ⚠️ **预设表和全局那份必须在这里回报。**
               *
               *    编辑器要拿它们渲染「勾了哪几条、改了哪几段、全局用哪条」。
               *    老版本这里是 `defaults` + `enabled` 两个字段 —— 新模型下
               *    `defaults` 没了（全局指向预设）、`enabled` 挪进了 `global`。
               */
              presets: stEdit.presets,
              global: stEdit.global,
              /**
               * ⚠️ **`enabled` 也要单独回一份**（取 `global.enabled`）——
               *    设置页那个「全局注入」开关的状态徽章要用它。
               *    漏了的话它读到 `undefined`，而 `d.enabled !== false` 恒为 true，
               *    表现是「拨完 POST 成功，紧接着 load() 又把它读回 true、弹回去」。
               *    （踩过。值取盘上的，不要绕 injector。）
               */
              enabled: stEdit.global.enabled === true,
              catalogPath: CATALOG_PATH,
              promptsDir: PROMPTS_DIR,
              libraryErrors: libraryErrors(),
            });
        }

        // ── POST edit：设置页的编辑器用（增改 / 删）──────────────────────
        if (path === EDIT_PATH && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPost = "bad-json";
            return new Response("Bad JSON", { status: 400 });
          }
          const action = body?.action;
          if (action !== "upsert" && action !== "delete") {
            diag.lastPost = "bad-action";
            return jsonOf({ ok: false, error: `action 必须是 upsert 或 delete，收到 ${JSON.stringify(action)}` }, 400);
          }

          let result;
          if (action === "upsert") {
            result = storeOf(ctx).save(body?.prompt);
          } else {
            result = storeOf(ctx).remove(body?.id);
          }

          if (!result.ok) {
            diag.lastPost = `edit:${action}:failed`;
            return jsonOf(result, 400);
          }

          // 写完立刻重载，让改动马上生效
          libraryOf(ctx).reload();
          // 删条目 / 改 id 会让别处的引用变成幽灵。
          //
          // ⚠️ **两层都要清，而且顺序不能反**：提示词 ← 预设 ← 全局/会话。
          //
          //     ① 先 `injector.pruneMissing()` —— 它按**当前预设**算出每个会话
          //        实际还剩什么，顺手把自己那份快照 `persist()` 回盘。
          //     ② 再 `prunePresets()` —— 把预设里已经不存在的提示词 id 剔掉。
          //     ③ 最后 `syncInjector()` —— 按清干净的预设重挂。
          //
          //     **反过来会出事**（真踩到）：先清预设的话，注入器还是按旧预设翻译，
          //     它 `persist()` 回来的 `assignments` 跟盘上对不上；而 `writeState`
          //     会把注入器传回来的那份**当成权威**，于是 `assignments` 被整个写成
          //     空对象 —— 表现是「删一条提示词，所有会话的预设选择全没了」。
          //     探针抓到的原话：`传入assignments=有 盘上={"session-live-0001":"含弃用项"} 合并后={}`。
          const pruned = {};
          {
            const inner = injectorOf(ctx)?.pruneMissing() ?? {};
            if (inner && Object.keys(inner.defaults ?? {}).length) pruned.defaults = inner.defaults;
            if (inner && Object.keys(inner.sessions ?? {}).length) pruned.sessions = inner.sessions;
          }
          // ② 清预设里的幽灵 id（第二层引用）
          Object.assign(pruned, prunePresets((id) => libraryOf(ctx).has(id)));
          // ③ 按清干净的预设重挂
          syncInjector(ctx);
          diag.editCount = (diag.editCount ?? 0) + 1;
          diag.lastPost = `edit:${action}:${result.id}`;
          return jsonOf({ ...result, pruned, prompts: libraryList(ctx), libraryErrors: libraryErrors() });
        }

        return new Response("Not Found", { status: 404 });
      };

    // 逐个路径注册（原因见上面那段注释：path 必须是单个字符串）
    //
    // ⚠️ **加了新路由必须往这个列表里加一条** —— 漏了的表现是那个接口 404，
    //    而且请求会落到默认处理，看不出是「忘了注册」还是「打错了」。
    //    （`/state` 的 GET 里回传 `global`，但 `/global` 是**独立的一条路由**，
    //      两者不是一回事，别只加前者。）
    const disposers = [
      STATE_PATH,
      ASSIGN_PATH,
      PREVIEW_PATH,
      RELOAD_PATH,
          GLOBAL_PATH,
      EDIT_PATH,
      SECTIONS_PATH,
      PRESETS_PATH,
    ].map((p) =>
      connection.fetch.register({
        path: p,
        methods: ["GET", "POST"],
        requestBody: "buffered",
        fetch: handleRequest,
      }),
    );

    return () => {
      diag.routeRegistered = false;
      for (const d of disposers) {
        try {
          d();
        } catch {
          /* 单条卸载失败不影响其余 */
        }
      }
    };
  });

  ctx.effect(() => {
    ctx.tools.register(promptTool);
  });

  // ── 心跳第二次落盘：**真的生效了** ───────────────────────────────────────
  //
  // ⚠️ 只有跑到这一行才算数。上面的代码抛错的话，心跳会**停在 `starting`**，
  //    而且磁盘上那份会写明错误（见 catch）——
  //    「加载了但没生效」这种最难查的情况，从此一眼可辨。
  beat("ready", { counts: heartbeatCounts(library) });
}

/**
 * 插件入口。
 *
 * ⚠️ 包一层**只为心跳**：apply 里任何地方抛错，都把错误落盘再往上抛。
 *
 *    为什么值得：
 *      「插件加载了但没生效」是最难查的一种失败 —— 进程在、日志可能没刷出来、
 *      界面上就是没反应。有了这条，磁盘上那份心跳会直接写明**哪一步炸了、炸在哪**，
 *      而且错误**继续往上抛**（不吞）—— dsh 该报错还是报错。
 */
export function apply(ctx) {
  try {
    applyInner(ctx);
  } catch (err) {
    beat("failed", { error: err });
    throw err;
  }
}
