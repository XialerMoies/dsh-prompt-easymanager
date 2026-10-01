// 个人提示词 —— 宿主半体（提示词库、按会话挂载、全局默认、分类、编辑器路由、prompt_manager 工具）
//
// 为 DSH 的**每个会话**独立选择系统提示词，并提供最终系统提示词的实时预览。
//
// 三件事：
//   1. 提示词库  —— prompts/catalog.json 里的条目，可编辑、可重载
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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
  matchPreset,
  summarizePreset,
  normalizeGlobal,
  presetForSession,
  presetLabel,
} from "./scripts/lib/presets.mjs";
import { findEmptySlots, SECTION_SLOTS } from "./scripts/lib/section-slots.mjs";

const PLUGIN_ID = "dsh-prompt-easymanager";
const PLUGIN_NAME = "个人提示词";
const PLUGIN_VERSION = "0.3.1";

/** 客户端用的路由前缀（客户端半体里有一份同名常量，两边必须一致） */
export const STATE_PATH = "/api/prompt-manager/state";
export const ASSIGN_PATH = "/api/prompt-manager/assign";
export const PREVIEW_PATH = "/api/prompt-manager/preview";
export const RELOAD_PATH = "/api/prompt-manager/reload";
export const DEFAULTS_PATH = "/api/prompt-manager/defaults";
export const EDIT_PATH = "/api/prompt-manager/edit";
export const SECTIONS_PATH = "/api/prompt-manager/sections";
export const PRESETS_PATH = "/api/prompt-manager/presets";
/**
 * 全局那份配置：`{ enabled, presetId }`。
 *
 * ⚠️ 它**取代**了老的 `/defaults`（那条路由收一堆裸 prompt id）。
 *    新模型里全局也得指向一条预设，所以这个入口叫 global 更贴切。
 */
export const GLOBAL_PATH = "/api/prompt-manager/global";

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

/** 这次请求该读哪个状态文件。 */
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

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 提示词库目录。
 *
 * 环境变量可以覆盖它 —— **给测试用的**。集成测试要往库里塞几条 fixture，
 * 不该因此污染用户真实的提示词库，也不该反过来要求用户的库里留几条
 * "测试专用"的提示词。
 *
 * ⚠️ **两个名字都认**（`EASYMANAGER` 是改名后的新名字）：
 *    插件从 `dsh-prompt-manager` 改名过来，但**已经按老名字配了环境变量的人
 *    不该因此静默失效** —— 那种失败不报错，只是「以为配了却没生效」。
 */
const CATALOG_PATH =
  process.env.DSH_PROMPT_EASYMANAGER_CATALOG ||
  process.env.DSH_PROMPT_MANAGER_CATALOG ||
  join(HERE, "prompts", "catalog.json");
const PROMPTS_DIR = dirname(CATALOG_PATH);

/**
 * 老版本内置的那条哨兵提示词的 id。
 *
 * 它叫「不注入」，作用是让用户能在库里点一个选项来表达「什么都不挂」——
 * 但**「一个都不选」本来就是同一个意思**，所以它只是把一件事说成了两件：
 * 库里多一张永远不该被勾的卡片，设置页还得配一张卡片去管它。
 *
 * v0.2.9 起不随包发了（`prompts/catalog.json` 现在是空库）。
 * 这个常量只用来**清理老状态里的悬挂 id** —— 见 readState 里的迁移。
 */
const NONE_SENTINEL = "none";

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
    return out;
  } catch {
    /* 文件不存在或损坏：等价于「什么都不挂」+「不改动任何原生段落」，符合默认值 */
  }
  return {
    global: { enabled: false, presetId: null },
    assignments: {},
    sectionOverrides: {},
    sessionSectionOverrides: {},
    presets: {},
  };
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
      updatedAt: new Date().toISOString(),
    };
    // ⚠️ 写**一律写新名字** —— 这样读一次就迁过来了，老文件留着不动。
writeFileSync(stateFilePath(), JSON.stringify(merged, null, 2), "utf8");
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

export function apply(ctx) {
  // ── 提示词库 ──────────────────────────────────────────────────────────────
  const library = createPromptLibrary({ catalogPath: CATALOG_PATH, baseDir: PROMPTS_DIR });
  activeLibrary = library;
  // 编辑器用的写入侧（设置页那个 tab）。只动 prompts/ 目录内的文件。
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
    getSectionOverrides: (sessionId) => {
      const s = readState();
      return resolveOverrides(s.sectionOverrides, s.sessionSectionOverrides[sessionId]);
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
          const plan = planOverrides({
            overrides: state.sectionOverrides,
            globalSections: found.sections,
          });
          diag.lastSections = found.outcome;
          return jsonOf({
              outcome: found.outcome,
              error: found.error ?? null,
              agentId: found.agentId ?? null,
              summary: summarizePlan(plan),
              /** 会被应用的（含「官方已更新」的） */
              applied: plan.apply,
              /** apply 里「官方改过这段」的那些（子集，界面上标红） */
              drifted: plan.drifted,
              /** 名字已不存在，保留数据但不应用 */
              stale: plan.stale,
              /** 用户没动过的 */
              untouched: plan.untouched,
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
               */
              globalOverrides: state.sectionOverrides,
              sessionOverrides: sessionId ? state.sessionSectionOverrides[sessionId] ?? {} : {},
              effectiveOverrides: resolveOverrides(
                state.sectionOverrides,
                sessionId ? state.sessionSectionOverrides[sessionId] : undefined,
              ),
              counts: {
                applied: plan.apply.length,
                drifted: plan.drifted.length,
                stale: plan.stale.length,
                untouched: plan.untouched.length,
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

          const state = readState();

          // ── 写到哪一层 ──────────────────────────────────────────────────
          //
          //   scope: "global"  → 全局默认改写（影响所有会话）
          //   scope: "session" → 只影响 sessionId 这一个会话，**盖住全局那条**
          //
          // ⚠️ **默认 global** —— 老客户端不带 scope 时行为跟以前一样。
          const scope = body?.scope === "session" ? "session" : "global";
          if (scope === "session" && !sessionId) {
            diag.lastSections = "missing-session";
            return jsonOf({ error: "scope: session 时必须带 ?session=<sessionId>" }, 400);
          }

          // 拿到**这一层**的表（会话层不存在就现建）
          const layerTable =
            scope === "session"
              ? { ...(state.sessionSectionOverrides[sessionId] ?? {}) }
              : { ...state.sectionOverrides };
          const table = layerTable;

          if (action === "restore") {
            // 「还原默认」= 删掉覆盖。
            // ⚠️ 还原的是官方**当前**的文本 —— 如果官方更新过这一段，
            //    拿到的是新版而不是用户当初依据的旧版。（用户明确要的口径。）
            delete table[name];
          } else if (action === "replace" || action === "disable") {
            if (typeof body?.text !== "string" && action === "replace") {
              diag.lastSections = "missing-text";
              return jsonOf({ error: "replace 需要 text" }, 400);
            }
            // 先取这一段**当前的官方原文**做漂移基准。
            // 此刻如果已经存在覆盖，listSections 给的是原文（不带 scope），所以
            // 反复编辑不会把基准越推越偏。
            const found = await injector.listSections(sessionId);
            const live = found.sections.find((s) => s.name === name);
            if (live === undefined) {
              diag.lastSections = "unknown-section";
              return jsonOf({
                  error: `找不到段落 ${name} —— 它可能刚被官方删掉或改名了`,
                  knownNames: found.sections.map((s) => s.name),
                }, 404);
            }
            const built = makeOverride({
              action,
              text: action === "disable" ? "" : body.text,
              original: live.text,
              acceptedDrift: body?.acceptedDrift === true,
            });
            table[name] = built;
          } else if (action === "acknowledge") {
            // 点掉「官方已更新」的提醒：覆盖不动，只把 acceptedDrift 置真。
            const existing = normalizeOverride(table[name]);
            if (existing === null) {
              diag.lastSections = "acknowledge-missing";
              return jsonOf({ error: `段落 ${name} 没有覆盖记录，无从确认` }, 404);
            }
            table[name] = { ...existing, acceptedDrift: true };
          } else {
            diag.lastSections = "bad-action";
            return jsonOf({ error: `action 必须是 replace / disable / restore / acknowledge，收到 ${JSON.stringify(action)}` }, 400);
          }

          // 只写**这一层**，另一层原样保留
          if (scope === "session") {
            const next = { ...state.sessionSectionOverrides };
            if (Object.keys(table).length > 0) next[sessionId] = table;
            else delete next[sessionId]; // 空表就不留占位
            writeState({ sessionSectionOverrides: next });
          } else {
            writeState({ sectionOverrides: table });
          }
          // 覆盖是**每次装配现取**的（见 createSessionInjector 的 getSectionOverrides），
          // 所以这里不用重挂 agent，下一个模型步骤就生效。

          const found2 = await injector.listSections(sessionId);
          // ⚠️ 判定要用**合并后**的表 —— 只看单层的话，会话层看到的会漏掉全局那些
          const stateAfter = readState();
          const effective = resolveOverrides(
            stateAfter.sectionOverrides,
            sessionId ? stateAfter.sessionSectionOverrides[sessionId] : undefined,
          );
          const plan2 = planOverrides({ overrides: effective, globalSections: found2.sections });
          diag.lastSections = `${action}:${scope}:ok`;
          return jsonOf({
              ok: true,
              action,
              name,
              summary: summarizePlan(plan2),
              applied: plan2.apply,
              drifted: plan2.drifted,
              stale: plan2.stale,
              untouched: plan2.untouched,
              // 改完一段后空槽位也要重算 —— 通常不会变，但保持两个响应形状一致
              emptySlots: findEmptySlots(found2.sections),
              counts: {
                applied: plan2.apply.length,
                drifted: plan2.drifted.length,
                stale: plan2.stale.length,
                untouched: plan2.untouched.length,
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
              out.sections =
                body.sections && typeof body.sections === "object" && !Array.isArray(body.sections)
                  ? normalizeOverrides(body.sections)
                  : {};
            }
            return out;
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

        // ── /defaults 已退役 ────────────────────────────────────────────────
        //
        // ⚠️ 老路由收的是「一堆裸 prompt id」，新模型里全局也得指向一条预设，
        //    所以它没法再正确工作。**留着但不干活**，明确告诉调用方去哪儿：
        //    删掉整条的话老客户端会拿到 404，分不清「路由没了」和「打错了」。
        if (path === DEFAULTS_PATH) {
          diag.lastPost = "defaults-retired";
          return jsonOf(
            {
              ok: false,
              outcome: "gone",
              error:
                "`/defaults` 已换成 `/global` —— 现在全局要指向一条预设，" +
                "不再直接收提示词 id。",
              use: GLOBAL_PATH,
            },
            410, // Gone：比 404 说得清楚
          );
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
      DEFAULTS_PATH,
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
}
