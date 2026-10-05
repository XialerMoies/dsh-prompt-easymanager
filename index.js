// DSH host half: prompt library, preset state, session injection, and HTTP routes.
// Presets are the single source of truth for both personal prompts and section edits.

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
  presetSignature,
} from "./scripts/lib/presets.mjs";
import { findEmptySlots, SECTION_SLOTS } from "./scripts/lib/section-slots.mjs";
import { toInjectorState, normalizeSectionsInput, selectionFromSectionsInput } from "./scripts/lib/state-helpers.mjs";
import { createDiagnostics } from "./scripts/lib/diagnostics.mjs";
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
import { handlePresets } from "./scripts/lib/routes/presets.mjs";
import { handleSections } from "./scripts/lib/routes/sections.mjs";
import { handleState } from "./scripts/lib/routes/state.mjs";
import { handleSessions } from "./scripts/lib/routes/sessions.mjs";
import { handleLibrary } from "./scripts/lib/routes/library.mjs";

const PLUGIN_ID = "dsh-prompt-easymanager";
const PLUGIN_NAME = "个人提示词";
const PLUGIN_VERSION = "0.3.8";

export const STATE_PATH = "/api/prompt-easymanager/state";
export const ASSIGN_PATH = "/api/prompt-easymanager/assign";
export const PREVIEW_PATH = "/api/prompt-easymanager/preview";
export const RELOAD_PATH = "/api/prompt-easymanager/reload";
export const EDIT_PATH = "/api/prompt-easymanager/edit";
export const SECTIONS_PATH = "/api/prompt-easymanager/sections";
export const PRESETS_PATH = "/api/prompt-easymanager/presets";
export const GLOBAL_PATH = "/api/prompt-easymanager/global";

const ROUTE_COUNT = 8;

const STATE_DIR = process.env.DSH_HOME || join(homedir(), ".dsh");
const STATE_FILE = join(STATE_DIR, "dsh-prompt-easymanager-state.json");

const LEGACY_STATE_FILE = join(STATE_DIR, "dsh-prompt-manager-state.json");

// Read the legacy filename for upgrades; all writes use the current filename.
function stateFilePath() {
  try {
    if (existsSync(STATE_FILE)) return STATE_FILE;
    if (existsSync(LEGACY_STATE_FILE)) {
      if (!legacyNoticeDone) {
        legacyNoticeDone = true;
        try {
          console.info(
            "[dsh-prompt-easymanager] 从旧状态文件读取配置（" +
              LEGACY_STATE_FILE +
              "），下次写入会落到新文件。旧文件保留不动。",
          );
        } catch {
        }
      }
      return LEGACY_STATE_FILE;
    }
  } catch {
  }
  return STATE_FILE;
}
let legacyNoticeDone = false;

function stateWritePath() {
  return STATE_FILE;
}

const HERE = dirname(fileURLToPath(import.meta.url));

const PROMPTS_DIR =
  process.env.DSH_PROMPT_EASYMANAGER_CATALOG !== undefined
    ? dirname(process.env.DSH_PROMPT_EASYMANAGER_CATALOG)
    : join(STATE_DIR, "prompts");
const CATALOG_PATH =
  process.env.DSH_PROMPT_EASYMANAGER_CATALOG || join(PROMPTS_DIR, "catalog.json");

const LEGACY_IN_PACKAGE_DIR = join(HERE, "prompts");
const LIBRARY_MIGRATION = migrateLibraryOutOfPackage({
  legacyDir: LEGACY_IN_PACKAGE_DIR,
  targetDir: PROMPTS_DIR,
  targetCatalog: CATALOG_PATH,
});

const HEARTBEAT_FILE = join(STATE_DIR, "dsh-prompt-easymanager-heartbeat.json");

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
  }
  return null;
}

function heartbeatBase(phase, extra) {
  return makeHeartbeat({
    phase,
    pluginId: PLUGIN_ID,
    version: PLUGIN_VERSION,
    dshVersion: dshVersion(),
    nodeVersion: process.version,
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

function beat(phase, extra) {
  writeHeartbeat(HEARTBEAT_FILE, heartbeatBase(phase, extra));
}

const NONE_SENTINEL = "none";

cleanupStaleTmp(HEARTBEAT_FILE);

beat("starting");

function injectorOf(ctx) {
  const perCtx = ctx && ctx.__pmInjector;
  if (perCtx) return perCtx;
  return activeInjector;
}

let activeInjector = null;
let activeLibrary = null;
let activeStore = null;
let hostCtxRef = null;

function libraryOf(ctx) {
  const perCtx = ctx && ctx.__pmLibrary;
  if (perCtx) return perCtx;
  return activeLibrary;
}

function storeOf(ctx) {
  const perCtx = ctx && ctx.__pmStore;
  if (perCtx) return perCtx;
  return activeStore;
}

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

const diagnostics = createDiagnostics({
  diag,
  pluginVersion: PLUGIN_VERSION,
  catalogPath: CATALOG_PATH,
  stateFile: STATE_FILE,
  libraryOf,
  getActiveInjector: () => activeInjector,
  getActiveLibrary: () => activeLibrary,
  getHostContext: () => hostCtxRef,
});
const {
  sessionStates,
  libraryList,
  libraryErrors,
  listAgentsDiag,
  publicDiag,
  classifySession,
  findAgentFor,
} = diagnostics;

// Remove prompt ids that disappeared from the user library from every preset.
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

function readState() {
  try {
const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
    const out = {
      global: { enabled: false, presetId: null },
      assignments: {},
      sectionOverrides: {},
      sessionSectionOverrides: {},
      presets: {},
      hasLoaded: parsed?.hasLoaded === true,
    };
    out.presets = normalizePresets(parsed?.presets);
    migrateLegacyState(out, parsed);
    const globalRaw = parsed?.global ?? (out.global.presetId ? out.global : undefined);
    out.global = normalizeGlobal(globalRaw, {
      switchEnabled: parsed?.enabled !== false,
      defaults: parsed?.defaults,
      sectionOverrides: parsed?.sectionOverrides,
      presets: out.presets,
    });
    if (parsed?.sectionOverrides && typeof parsed.sectionOverrides === "object") {
      out.sectionOverrides = normalizeOverrides(parsed.sectionOverrides);
    }
    const perSession = parsed?.sessionSectionOverrides;
    if (perSession && typeof perSession === "object" && !Array.isArray(perSession)) {
      for (const [sid, table] of Object.entries(perSession)) {
        if (typeof sid !== "string" || !sid) continue;
        const norm = normalizeOverrides(table);
        if (Object.keys(norm).length > 0) out.sessionSectionOverrides[sid] = norm;
      }
    }
    ensureDefaultPreset(out);
    return out;
  } catch {
  }
  const fresh = {
    global: { enabled: false, presetId: null },
    assignments: {},
    sectionOverrides: {},
    sessionSectionOverrides: {},
    presets: {},
    hasLoaded: false,
  };
  ensureDefaultPreset(fresh);
  return fresh;
}

const DEFAULT_PRESET_NAME = "系统提示词（原生）";

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

// Section edits follow the effective session preset, falling back to global settings
// for the settings page where no session is available.
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
  return { ok: true, presetId: found.id, via: found.source ?? "unknown", fellBack };
}

function migrateLegacyState(out, parsed) {
  const map = parsed?.assignments;
  if (!map || typeof map !== "object" || Array.isArray(map)) return;
  const MIGRATED = "（旧配置）";
  for (const [sid, value] of Object.entries(map)) {
    if (typeof sid !== "string" || !sid) continue;
    if (Array.isArray(value)) {
      const prompts = value.filter((x) => typeof x === "string" && x && x !== NONE_SENTINEL);
      if (prompts.length === 0) {
        out.assignments[sid] = null;
        continue;
      }
      const same = matchPreset({ prompts, sections: {} }, out.presets);
      if (same) {
        out.assignments[sid] = same.id;
        continue;
      }
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
    if (value === null) {
      out.assignments[sid] = null;
    } else if (typeof value === "string" && value && value !== NONE_SENTINEL) {
      out.assignments[sid] = value;
    }
  }

  const defs = (Array.isArray(parsed?.defaults) ? parsed.defaults : []).filter(
    (x) => typeof x === "string" && x && x !== NONE_SENTINEL,
  );
  if (defs.length > 0) {
    const secs =
      parsed?.sectionOverrides && typeof parsed.sectionOverrides === "object"
        ? normalizeOverrides(parsed.sectionOverrides)
        : {};
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

  const globalLegacy =
    parsed?.sectionOverrides && typeof parsed.sectionOverrides === "object"
      ? selectionFromSectionsInput(parsed.sectionOverrides)
      : null;
  if (globalLegacy && (globalLegacy.listed.length > 0 || globalLegacy.excluded.length > 0)) {
    const gid = typeof parsed?.global?.presetId === "string" ? parsed.global.presetId : null;
    const target = gid && out.presets[gid] ? out.presets[gid] : null;
    if (target) {
      const current = normalizeSelection(target.selection);
      out.presets[gid] = normalizePreset({
        ...target,
        selection: normalizeSelection({
          listed: [...new Set([...current.listed, ...globalLegacy.listed])],
          excluded: [...new Set([...current.excluded, ...globalLegacy.excluded])],
          sections: { ...current.sections, ...globalLegacy.sections },
          known: [...new Set([...current.known, ...globalLegacy.known])],
        }),
      });
    } else {
      const name = "（旧配置）全局系统提示词";
      const existing = Object.entries(out.presets).find(([, p]) => p.name === name);
      const id = existing?.[0] ?? presetId(name, Object.keys(out.presets));
      if (!existing) {
        out.presets[id] = capturePreset({ name, prompts: [], selection: globalLegacy });
      }
      out.global = { enabled: parsed?.enabled !== false, presetId: id };
    }
  }

  const sessionLegacy = parsed?.sessionSectionOverrides;
  if (sessionLegacy && typeof sessionLegacy === "object" && !Array.isArray(sessionLegacy)) {
    for (const [sid, table] of Object.entries(sessionLegacy)) {
      const sel = selectionFromSectionsInput(table);
      if (sel.listed.length === 0 && sel.excluded.length === 0) continue;
      const baseId = typeof out.assignments[sid] === "string" ? out.assignments[sid] : null;
      const base = baseId && out.presets[baseId] ? out.presets[baseId] : null;
      const name = `（旧配置）会话 ${sid}`;
      const existing = Object.entries(out.presets).find(([, p]) => p.name === name);
      const id = existing?.[0] ?? presetId(name, Object.keys(out.presets));
      if (!existing) {
        out.presets[id] = capturePreset({
          name,
          prompts: base?.prompts ?? [],
          selection: {
            listed: [...(base?.selection?.listed ?? []), ...sel.listed],
            excluded: [...(base?.selection?.excluded ?? []), ...sel.excluded],
            sections: { ...(base?.selection?.sections ?? {}), ...sel.sections },
            known: [...(base?.selection?.known ?? []), ...sel.known],
          },
        });
      }
      out.assignments[sid] = id;
    }
  }
}

// Merge partial writes with on-disk state so independent routes cannot erase each other.
function writeState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const onDisk = readState();
    const merged = {
      global: {
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
      assignments: pickPresetAssignments(state, onDisk),
      sectionOverrides: {},
      sessionSectionOverrides: {},
      presets:
        state && "presets" in state && state.presets
          ? normalizePresets(state.presets)
          : onDisk.presets,
      hasLoaded: onDisk.hasLoaded === true,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(stateWritePath(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
  }
}

function pickPresetAssignments(state, onDisk) {
  if (!state || !("assignments" in state) || !state.assignments) return onDisk.assignments;
  const out = {};
  for (const [sid, v] of Object.entries(state.assignments)) {
    if (typeof sid !== "string" || !sid) continue;
    if (Array.isArray(v)) return onDisk.assignments;
    if (v === null) out[sid] = null;
    else if (typeof v === "string" && v) out[sid] = v;
  }
  return out;
}

function syncInjector(ctx) {
  const inj = injectorOf(ctx);
  if (!inj) return;
  try {
    inj.restore(toInjectorState(readState()));
    inj.reattachAll();
  } catch (err) {
    console.error(`[${PLUGIN_ID}] 同步注入器失败：${err?.message ?? String(err)}`);
  }
}

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

function heartbeatCounts(library) {
  try {
    const list = library.list();
    return { prompts: list.length, errors: list.errors?.length ?? 0 };
  } catch (err) {
    return { prompts: null, errors: null, listError: String(err) };
  }
}

function applyInner(ctx) {
  const library = createPromptLibrary({ catalogPath: CATALOG_PATH, baseDir: PROMPTS_DIR });
  activeLibrary = library;
  const store = createPromptStore({ catalogPath: CATALOG_PATH, baseDir: PROMPTS_DIR });
  activeStore = store;
  try {
    ctx.__pmLibrary = library;
    ctx.__pmStore = store;
  } catch {
  }

  const injector = createSessionInjector({
    resolvePrompt: (id) => library.resolve(id),
    saveState: writeState,
    topLevelOnly: true,
    isEnabled: () => true,
    getSectionOverrides: (sessionId) => {
      const s = readState();
      const found = presetForSession({
        sessionId,
        assignments: s.assignments,
        global: s.global,
        presets: s.presets,
      });
      if (!found || !found.preset) return null;

      const sel = found.preset.selection ?? { listed: [], excluded: [], sections: {}, known: [] };

      return sel;
    },
  });
  injector.restore(toInjectorState(readState()));
  activeInjector = injector;
  try {
    ctx.__pmInjector = injector;
  } catch {
  }
  hostCtxRef = ctx;

  try {
    const live = ctx.agents?.roots?.();
    if (live) injector.seedAgents(live);
  } catch {
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

  const jsonHeaders = { "cache-control": "no-store" };

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

    const handleRequest = async (request) => {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;

        const stateResponse = await handleState(request, url, {
          STATE_PATH,
          GLOBAL_PATH,
          ctx,
          injectorOf,
          readState,
          writeState,
          libraryList,
          CATEGORIES,
          presetSignature,
          presetLabel,
          publicDiag,
          diag,
          jsonOf,
          syncInjector,
          CATALOG_PATH,
        });
        if (stateResponse) return stateResponse;

        const sectionResponse = await handleSections(request, url, {
          SECTIONS_PATH,
          injector,
          readState,
          presetForSession,
          projectSelection,
          findEmptySlots,
          SECTION_SLOTS,
          OVERRIDE_ACTIONS,
          presetSignature,
          diag,
          jsonOf,
          editActivePresetSelection,
          normalizeSelection,
          applySelectionEdit,
        });
        if (sectionResponse) return sectionResponse;

        const presetResponse = await handlePresets(request, url, {
          ctx,
          PRESETS_PATH,
          readState,
          writeState,
          syncInjector,
          libraryOf,
          diag,
          jsonOf,
          presetId,
          presetSignature,
          presetLabel,
          summarizePreset,
          presetForSession,
          capturePreset,
          selectionFromSectionsInput,
          normalizeSelection,
          isEmptySelection,
        });
        if (presetResponse) return presetResponse;

        const sessionResponse = await handleSessions(request, url, {
          ctx,
          PREVIEW_PATH,
          RELOAD_PATH,
          ASSIGN_PATH,
          injector,
          libraryOf,
          libraryList,
          readState,
          writeState,
          syncInjector,
          prunePresets,
          classifySession,
          diag,
          jsonOf,
        });
        if (sessionResponse) return sessionResponse;

        // The global layer stores only its switch and selected preset id.
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

        const libraryResponse = await handleLibrary(request, url, {
          EDIT_PATH,
          ctx,
          readState,
          libraryOf,
          storeOf,
          libraryList,
          libraryErrors,
          estimateTokens,
          CATEGORIES,
          CATALOG_PATH,
          PROMPTS_DIR,
          injectorOf,
          prunePresets,
          syncInjector,
          diag,
          jsonOf,
        });
        if (libraryResponse) return libraryResponse;

        return new Response("Not Found", { status: 404 });
      };

    // Register each route separately; the host router matches one exact pathname.
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
        }
      }
    };
  });

  ctx.effect(() => {
    ctx.tools.register(promptTool);
  });

  beat("ready", { counts: heartbeatCounts(library) });
}

// apply() is intentionally thin so host failures are recorded in the heartbeat.
export function apply(ctx) {
  try {
    applyInner(ctx);
  } catch (err) {
    beat("failed", { error: err });
    throw err;
  }
}
