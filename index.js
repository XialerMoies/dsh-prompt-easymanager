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

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
  planApply,
  matchPreset,
  summarizePreset,
} from "./scripts/lib/presets.mjs";
import { findEmptySlots, SECTION_SLOTS } from "./scripts/lib/section-slots.mjs";

const PLUGIN_ID = "dsh-prompt-manager";
const PLUGIN_NAME = "个人提示词";
const PLUGIN_VERSION = "0.2.8";

/** 客户端用的路由前缀（客户端半体里有一份同名常量，两边必须一致） */
export const STATE_PATH = "/api/prompt-manager/state";
export const ASSIGN_PATH = "/api/prompt-manager/assign";
export const PREVIEW_PATH = "/api/prompt-manager/preview";
export const RELOAD_PATH = "/api/prompt-manager/reload";
export const DEFAULTS_PATH = "/api/prompt-manager/defaults";
export const EDIT_PATH = "/api/prompt-manager/edit";
export const SECTIONS_PATH = "/api/prompt-manager/sections";
export const PRESETS_PATH = "/api/prompt-manager/presets";

const STATE_DIR = process.env.DSH_HOME || join(homedir(), ".dsh");
const STATE_FILE = join(STATE_DIR, "dsh-prompt-manager-state.json");

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 提示词库目录。
 *
 * `DSH_PROMPT_MANAGER_CATALOG` 可以覆盖 —— **给测试用的**。
 * 集成测试要往库里塞几条 fixture，不该因此污染用户真实的提示词库，
 * 也不该反过来要求用户的库里留几条"测试专用"的提示词。
 */
const CATALOG_PATH =
  process.env.DSH_PROMPT_MANAGER_CATALOG || join(HERE, "prompts", "catalog.json");
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

/** apply() 时赋值，供工具与路由读取 */
let activeInjector = null;
let activeLibrary = null;
let activeStore = null;
let hostCtxRef = null;

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
function libraryList() {
  try {
    return activeLibrary ? activeLibrary.list() : [];
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

// ── 状态持久化 ────────────────────────────────────────────────────────────────
// 形态：
//   {
//     assignments:      { "<sessionId>": ["<promptId>", ...] },
//     defaults:         ["<promptId>", ...],
//     sectionOverrides: { "<sectionName>": { action, text, original, originalHash, ... } },
//     sessionSectionOverrides: { "<sessionId>": { "<sectionName>": {...} } },
//     updatedAt:        "..."
//   }
//
// sectionOverrides 的键是**原生系统提示词段落的 name**（如 `harness:identity`），
// **不是下标、不是 order** —— 这样官方新增/改动/删除段落时，用户的数据不用改。
// 详见 docs/section-overrides-design.md。
//
// ⚠️ **改写分两层，跟注入的两层对齐：**
//
//     sectionOverrides        全局默认改写（所有会话都用）
//     sessionSectionOverrides 按会话改写（只影响那一个会话，**盖住全局**）
//
//   合并规则是**按段落名合、会话层赢**，不是整表替换 —— 见
//   section-overrides.mjs 的 `resolveOverrides()`（那里写了为什么）。
function readState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const out = {
      assignments: {},
      defaults: [],
      sectionOverrides: {},
      sessionSectionOverrides: {},
      presets: {},
      enabled: true,
      /** 界面补丁：**默认关** —— 它会改 dsh 自己的文件 */
    };
    const map = parsed?.assignments;
    if (map && typeof map === "object" && !Array.isArray(map)) out.assignments = map;
    if (Array.isArray(parsed?.defaults)) {
      // ⚠️ 迁移：`"none"` 是**老版本**里那条哨兵条目（内置的「不注入」提示词）。
      //    现在库里没有它了，留着会变成指向不存在条目的悬挂 id ——
      //    每次装配都要报一句「提示词库里没有：none」，而它的语义本来就是
      //    「什么都不注入」，等价于从列表里去掉。
      out.defaults = parsed.defaults.filter((x) => typeof x === "string" && x !== NONE_SENTINEL);
    }
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
    out.presets = normalizePresets(parsed?.presets);
    // 总开关：默认开（不写这个字段就是开）—— 老数据不用迁移
    out.enabled = parsed?.enabled !== false;
    return out;
  } catch {
    /* 文件不存在或损坏：等价于「全部不注入」+「不改动任何原生段落」，符合默认值 */
  }
  return {
    assignments: {},
    defaults: [],
    sectionOverrides: {},
    sessionSectionOverrides: {},
    presets: {},
    enabled: true,
  };
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    // ⚠️ **先读盘再合并** —— 不能直接覆盖。
    //    注入器调 saveState 时只传 `{assignments, defaults}`；如果直接写，
    //    那一侧的写入会把 `sectionOverrides` 整块抹掉
    //    （改一次会话分配就把用户的段落改写全丢了）。
    const onDisk = readState();
    const merged = {
      ...onDisk,
      ...state,
      // 显式传了才覆盖，没传就保留盘上的
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
      // 总开关：显式传了才改（`enabled: false` 也要能写进去，所以不能用真值判断）
      enabled: state && "enabled" in state ? state.enabled !== false : onDisk.enabled,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* 持久化失败不影响本次会话内的效果 */
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
      prompts: libraryList(),
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
    // 总开关：关掉时注入器会清空自己注入的段落（见 session-injection.mjs）
    isEnabled: () => readState().enabled !== false,
    getSectionOverrides: (sessionId) => {
      const s = readState();
      return resolveOverrides(s.sectionOverrides, s.sessionSectionOverrides[sessionId]);
    },
  });
  injector.restore(readState());
  activeInjector = injector;
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
        const snap = injector.snapshot();
        const items = libraryList();
        // 选词面板要按分类分组，所以这份也要带分类表和目录里的自定义分类
        const custom = [...new Set(
          items
            .map((p) => p && p.category)
            .filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
        )].sort();
        return jsonOf({
            assignments: snap.assignments, // { sessionId: [promptId, ...] }
            defaults: snap.defaults,
            /**
             * 原生段落的改写表。
             *
             * ⚠️ **这是全局的，没有会话维度** —— 改一次影响所有会话。
             *    （用户已确认要改成按会话，那是下一步；现在先在界面上如实暴露。）
             *
             * 会话头那个徽章需要它：否则「我改了系统提示词」在界面上
             * 仍然显示成「未注入」，会让人以为没生效。
             */
            /**
             * 原生段落改写 —— **全局默认层**（所有会话都用）。
             * 按会话的那层在 `/sections` 里回传，会话头徽章用那个。
             */
            sectionOverrides: readState().sectionOverrides,
            /** 总开关 —— 设置页的胶囊和会话头徽章都要用 */
            enabled: readState().enabled !== false,
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
      if (path === PRESETS_PATH) {
        const sessionId = url.searchParams.get("session") ?? undefined;
        const hasSession = typeof sessionId === "string" && sessionId.length > 0;

        if (request.method === "GET") {
          const s = readState();
          const globalLayer = { prompts: s.defaults ?? [], sections: s.sectionOverrides };
          const sessionLayer = hasSession
            ? {
                prompts: Array.isArray(s.assignments[sessionId]) ? s.assignments[sessionId] : [],
                sections: s.sessionSectionOverrides[sessionId] ?? {},
              }
            : null;

          const list = Object.entries(s.presets).map(([id, p]) => ({
            id,
            ...p,
            summary: summarizePreset(p),
          }));
          list.sort((a, b) => a.name.localeCompare(b.name));

          return jsonOf({
              presets: list,
              layers: { global: globalLayer, session: sessionLayer },
              /**
               * 当前状态**正好等于**哪条预设 —— 应用完得能看出「现在在哪个预设上」，
               * 否则用户不知道自己在哪。手改过就是 null，界面显示「已改动」。
               */
              matched: {
                global: matchPreset(globalLayer, s.presets),
                session: sessionLayer ? matchPreset(sessionLayer, s.presets) : null,
              },
              sessionId: hasSession ? sessionId : null,
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

          // ── 保存：把当前这一层存成预设 ──────────────────────────────────
          if (action === "save") {
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) {
              diag.lastPresets = "missing-name";
              return jsonOf({ error: "缺少预设名字" }, 400);
            }
            const scope = body?.scope === "session" ? "session" : "global";
            if (scope === "session" && !hasSession) {
              diag.lastPresets = "missing-session";
              return jsonOf({ error: "存会话层预设时必须带 ?session=<sessionId>" }, 400);
            }

            const s = readState();
            const layer =
              scope === "session"
                ? {
                    prompts: Array.isArray(s.assignments[sessionId]) ? s.assignments[sessionId] : [],
                    sections: s.sessionSectionOverrides[sessionId] ?? {},
                  }
                : { prompts: s.defaults ?? [], sections: s.sectionOverrides };

            const id = presetId(name, Object.keys(s.presets));
            const preset = capturePreset({
              name,
              scope,
              prompts: layer.prompts,
              sections: layer.sections,
              note: typeof body?.note === "string" ? body.note : "",
            });
            writeState({ presets: { ...s.presets, [id]: preset } });
            diag.lastPresets = `save:${id}`;
            return jsonOf({ ok: true, id, preset });
          }

          // ── 应用：覆盖写回它自己的那一层 ────────────────────────────────
          if (action === "apply") {
            const id = typeof body?.id === "string" ? body.id : "";
            const s = readState();
            const preset = s.presets[id];
            if (!preset) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
            }
            if (preset.scope === "session" && !hasSession) {
              diag.lastPresets = "missing-session";
              return jsonOf({ error: `预设「${preset.name}」是会话层的，应用时必须带 ?session=<sessionId>` }, 400);
            }

            const plan = planApply(preset);
            if (plan.scope === "session") {
              const nextAssign = { ...s.assignments };
              if (plan.prompts.length > 0) nextAssign[sessionId] = plan.prompts;
              else delete nextAssign[sessionId]; // 空 = 不注入（不留空数组占位）
              const nextSec = { ...s.sessionSectionOverrides };
              if (Object.keys(plan.sections).length > 0) nextSec[sessionId] = plan.sections;
              else delete nextSec[sessionId];
              writeState({ assignments: nextAssign, sessionSectionOverrides: nextSec });
            } else {
              writeState({ defaults: plan.prompts, sectionOverrides: plan.sections });
            }
            // ⚠️ **必须让注入器重新读一遍盘。**
            //
            //    注入器内部缓存着 `assignments` 和 `defaults` 两份内存副本，
            //    它调 `saveState` 时会把这两份**整个写回文件**。
            //
            //    上面这段是**绕过注入器直接写文件**的，所以注入器那份就过期了 ——
            //    之后只要有人动一下任何会话的分配，注入器就拿旧值覆盖回去，
            //    **用户刚应用的预设会被悄悄改掉**（测试逮到的就是这个：
            //    应用完预设再改一次分配，defaults 变回了上一个预设的值）。
            //
            //    覆盖（sectionOverrides）不受影响：它每次装配现取，没有内存副本。
            try {
              injector.restore(readState());
            } catch {
              /* 重读失败不影响本次写入本身 */
            }
            // 覆盖是每次装配现取的，所以不用重挂 agent。

            diag.lastPresets = `apply:${id}`;
            return jsonOf({
                ok: true,
                id,
                name: preset.name,
                scope: plan.scope,
                applied: { prompts: plan.prompts.length, sections: Object.keys(plan.sections).length },
              });
          }

          // ── 改名 ────────────────────────────────────────────────────────
          //
          // 界面上预设名是**卡片标题**，旁边一个铅笔图标改它。
          // 改名要同时换 id（id 是从名字派生的）—— 所以返回新 id，
          // 客户端得跟着更新「当前选中的是哪条」。
          if (action === "rename") {
            const id = typeof body?.id === "string" ? body.id : "";
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) {
              diag.lastPresets = "missing-name";
              return jsonOf({ error: "缺少预设名字" }, 400);
            }
            const s = readState();
            const preset = s.presets[id];
            if (!preset) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}` }, 404);
            }
            const nextId = presetId(name, Object.keys(s.presets).filter((x) => x !== id));
            const next = { ...s.presets };
            delete next[id];
            next[nextId] = { ...preset, name };
            writeState({ presets: next });
            diag.lastPresets = `rename:${id}->${nextId}`;
            return jsonOf({ ok: true, id: nextId, oldId: id, name });
          }

          // ── 删除 ────────────────────────────────────────────────────────
          if (action === "delete") {
            const id = typeof body?.id === "string" ? body.id : "";
            const s = readState();
            if (!s.presets[id]) {
              diag.lastPresets = "unknown-preset";
              return jsonOf({ error: `没有这条预设：${id}` }, 404);
            }
            const next = { ...s.presets };
            delete next[id];
            writeState({ presets: next });
            diag.lastPresets = `delete:${id}`;
            return jsonOf({ ok: true, id });
          }

          diag.lastPresets = "bad-action";
          return jsonOf({ error: `action 必须是 save / apply / rename / delete，收到 ${JSON.stringify(action)}` }, 400);
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
            r = library.reload();
          } catch (err) {
            diag.lastPost = "reload-threw";
            return jsonOf({ error: err?.message ?? String(err) }, 500);
          }
          diag.reloadCount += 1;
          diag.lastPost = `reload:${r.count}`;
          // 重载后：
          //   1. 先把引用到「已不存在条目」的分配/默认清掉（否则新会话会静默挂空）
          //   2. 再把其余会话重挂一遍 —— 提示词正文可能变了
          const pruned = injector.pruneMissing();
          {
            const snap = injector.snapshot();
            for (const sessionId of Object.keys(snap.assignments)) {
              injector.assign(sessionId, snap.assignments[sessionId]);
            }
          }
          return jsonOf({ count: r.count, errors: r.errors, prompts: libraryList(), pruned });
        }

        // ── POST assign：给会话指定提示词（数组）────────────────────────
        if (path === ASSIGN_PATH && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPost = "bad-json";
            return new Response("Bad JSON", { status: 400 });
          }
          const sessionId = body?.sessionId;
          if (typeof sessionId !== "string" || !sessionId) {
            diag.lastPost = "missing-sessionId";
            return new Response("sessionId required", { status: 400 });
          }

          const verdict = classifySession(ctx, sessionId);
          diag.lastSessionCheck = verdict;
          if (verdict === "reject") {
            diag.lastPost = "unknown-session";
            return new Response("unknown session", { status: 404 });
          }

          // 三种输入形态：
          //   promptIds: null       → 清除指定，回落到全局默认
          //   promptIds: []         → 显式不注入
          //   promptIds: ["a","b"]  → 挂这两条
          // 兼容旧的 promptId: "a" / promptId: "none"
          let promptIds;
          if ("promptIds" in (body ?? {})) {
            promptIds = body.promptIds === null ? null : body.promptIds;
            if (promptIds !== null && !Array.isArray(promptIds)) {
              diag.lastPost = "bad-promptIds";
              return new Response("promptIds must be an array or null", { status: 400 });
            }
          } else if (typeof body?.promptId === "string") {
            promptIds = body.promptId === "none" ? [] : [body.promptId];
          } else {
            diag.lastPost = "missing-promptIds";
            return new Response("promptIds required", { status: 400 });
          }

          // 库里不存在的 id 不进状态（避免留下永远挂不上的幽灵记录）
          if (Array.isArray(promptIds)) {
            const unknown = promptIds.filter((id) => typeof id !== "string" || !library.has(id));
            if (unknown.length > 0) {
              diag.lastPost = "unknown-prompt";
              return jsonOf({
                  ok: false,
                  outcome: "unknown-prompt",
                  error: `提示词库里没有：${unknown.join("、")}`,
                  prompts: libraryList(),
                }, 400);
            }
          }

          const result = injector.assign(sessionId, promptIds);
          diag.assignCount += 1;
          diag.lastPost = `assign:${Array.isArray(promptIds) ? promptIds.join(",") || "(none)" : "default"}`;
          // 组合非法是一个**业务错误**：400，让界面直接把原因显示出来
          const status = result.ok ? 200 : 400;
          return Response.json({ ...result, sessionCheck: verdict }, { status, headers: jsonHeaders });
        }

        // ── GET/POST defaults：全局默认（新会话用）──────────────────────
        if (path === DEFAULTS_PATH) {
          if (request.method === "GET") {
            return jsonOf({ defaults: injector.getDefaults() });
          }
          let body;
          try {
            body = await request.json();
          } catch {
            diag.lastPost = "bad-json";
            return new Response("Bad JSON", { status: 400 });
          }
          const ids = body?.promptIds;
          if (!Array.isArray(ids)) {
            diag.lastPost = "bad-defaults";
            return new Response("promptIds must be an array", { status: 400 });
          }
          const unknown = ids.filter((id) => typeof id !== "string" || !library.has(id));
          if (unknown.length > 0) {
            diag.lastPost = "unknown-prompt";
            return jsonOf({
                ok: false,
                outcome: "unknown-prompt",
                error: `提示词库里没有：${unknown.join("、")}`,
                defaults: injector.getDefaults(),
              }, 400);
          }
          const result = injector.setDefaults(ids);
          diag.lastPost = `defaults:${ids.join(",") || "(none)"}`;
          return Response.json(
            { ...result, defaults: injector.getDefaults() },
            { status: result.ok ? 200 : 400, headers: jsonHeaders },
          );
        }

        // ── GET edit：编辑器要的**带正文**清单（POST 见下）─────────────
        if (path === EDIT_PATH && request.method === "GET") {
          const items = library.raw().map((entry) => {
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
              // 当前全局默认 —— 编辑器要显示勾选状态
              defaults: injector.getDefaults(),
              // ⚠️ 总开关的状态必须在这里回报。
              //    漏了它编辑器读到 `undefined`，而 `d.enabled !== false` 恒为 true ——
              //    表现是「胶囊怎么点都弹回去」：拨完 POST 成功，紧接着 load()
              //    又把它读回 true。
              //    取值用 readState()（真相来源），不要绕 injector ——
              //    测试里的假注入器没有 isEnabled，会直接炸。
              enabled: readState().enabled !== false,
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
            result = store.save(body?.prompt);
          } else {
            result = store.remove(body?.id);
          }

          if (!result.ok) {
            diag.lastPost = `edit:${action}:failed`;
            return jsonOf(result, 400);
          }

          // 写完立刻重载，让改动马上生效
          library.reload();
          // 删条目 / 改 id 会让别处的引用变成幽灵，先清掉再重挂
          const pruned = injector.pruneMissing();
          {
            const snap = injector.snapshot();
            for (const sessionId of Object.keys(snap.assignments)) {
              injector.assign(sessionId, snap.assignments[sessionId]);
            }
          }
          diag.editCount = (diag.editCount ?? 0) + 1;
          diag.lastPost = `edit:${action}:${result.id}`;
          return jsonOf({ ...result, pruned, prompts: libraryList(), libraryErrors: libraryErrors() });
        }

        return new Response("Not Found", { status: 404 });
      };

    // 四条路径逐个注册（原因见上面那段注释：path 必须是单个字符串）
    const disposers = [
      STATE_PATH,
      ASSIGN_PATH,
      PREVIEW_PATH,
      RELOAD_PATH,
      DEFAULTS_PATH,
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
