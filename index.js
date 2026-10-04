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

const PLUGIN_ID = "dsh-prompt-easymanager";
const PLUGIN_NAME = "个人提示词";
const PLUGIN_VERSION = "0.3.7";

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

      // Global switch and the read-only state projection used by the settings UI.
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

      if (path === STATE_PATH && request.method === "GET") {
        const snap = injectorOf(ctx)?.snapshot() ?? { version: 2 };
        const st = readState();
        const items = libraryList(ctx);
        const custom = [...new Set(
          items
            .map((p) => p && p.category)
            .filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
        )].sort();
        return jsonOf({
            assignments: st.assignments,
            global: st.global,
            enabled: st.global.enabled === true,
            presets: Object.fromEntries(
              Object.entries(st.presets).map(([id, p]) => [id, {
                ...p,
                sections: p.selection?.sections ?? {},
                signature: presetSignature(p),
                label: presetLabel(p),
                isNative: p.prompts.length === 0 &&
                  Object.keys(p.selection?.sections ?? {}).length === 0 &&
                  (p.selection?.listed ?? []).length === 0 &&
                  (p.selection?.excluded ?? []).length === 0,
              }]),
            ),
            sectionOverrides: {},
            schemaVersion: 3,
            version: snap.version,
            prompts: items,
            categories: CATEGORIES,
            customCategories: custom,
            catalogPath: CATALOG_PATH,
            diag: publicDiag(),
          });
      }

      if (path === SECTIONS_PATH) {
        // Native sections are projected into the current preset selection.
        const sessionId = url.searchParams.get("session") ?? undefined;

        if (request.method === "GET") {
          const found = await injector.listSections(sessionId);
          const state = readState();

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
              action: status === "apply" || status === "pending" ? "replace" : null,
              text: row.text ?? "",
              savedAt: ov?.savedAt ?? "",
            };
          };
          const appliedRows = projected.plan
            .filter((r) => r.mode === "edited" || r.mode === "dropped")
            .map((r) => asRow(r, "apply"));
          const pendingRows = projected.plan
            .filter((r) => r.mode === "pending")
            .map((r) => asRow(r, "pending"));
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
              applied: appliedRows,
              pending: pendingRows,
              drifted: appliedRows.filter((r) => r.drifted),
              stale: staleRows,
              untouched: untouchedRows,
              availableNative: found.sections.map((s) => s.name),
              excludedSections: Array.isArray(selNow?.excluded) ? selNow.excluded : [],
              emptySlots: findEmptySlots(found.sections),
              slotTotal: SECTION_SLOTS.length,
              globalOverrides: {},
              sessionOverrides: {},
              effectiveOverrides: {},
              effectivePresetId: foundPreset?.id ?? null,
              effectivePresetSignature: foundPreset?.preset ? presetSignature(foundPreset.preset) : null,
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

          let wroteTo = null;

          {
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


            const commit = (editFn) => {
              const r = editActivePresetSelection({ sessionId, fallbackToGlobal: true, edit: editFn });
              if (!r.ok) {
                diag.lastSections = r.outcome;
                return jsonOf({ ok: false, outcome: r.outcome, error: r.error }, 409);
              }
              wroteTo = r;
              return null;
            };

            if (action === "restore") {
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
                  action: action === "disable" ? "exclude" : undefined,
                  edit:
                    action === "disable" ? undefined : { text: body.text, original: liveText },
                }),
              );
              if (bad) return bad;
            } else if (action === "acknowledge") {
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

          const found2 = await injector.listSections(sessionId);
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
              action: status === "apply" || status === "pending" ? "replace" : null,
              text: row.text ?? "",
              savedAt: ov?.savedAt ?? "",
            };
          };
          const appliedRows = projected.plan
            .filter((r) => r.mode === "edited")
            .map((r) => asRow(r, "apply"));
          const pendingRows = projected.plan
            .filter((r) => r.mode === "pending")
            .map((r) => asRow(r, "pending"));
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
              pending: pendingRows,
              drifted: allApplied.filter((r) => r.drifted),
              stale: staleRows,
              untouched: untouchedRows,
              availableNative: found2.sections.map((s) => s.name),
              excludedSections: Array.isArray(selAfter?.excluded) ? selAfter.excluded : [],
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

      if (path === PRESETS_PATH) {
        // Preset CRUD and application to the global or session scope.
        const sessionId = url.searchParams.get("session") ?? undefined;
        const hasSession = typeof sessionId === "string" && sessionId.length > 0;

        const presetList = (s) =>
          Object.entries(s.presets)
            .map(([id, p]) => ({
              id,
              name: p.name,
              prompts: p.prompts,
              sections: p.selection?.sections ?? {},
              selection: p.selection,
      signature: presetSignature(p),
              createdAt: p.createdAt,
              note: p.note,
              summary: summarizePreset(p),
              label: presetLabel(p),
              isNative: p.prompts.length === 0 &&
                Object.keys(p.selection?.sections ?? {}).length === 0 &&
                (p.selection?.listed ?? []).length === 0 &&
                (p.selection?.excluded ?? []).length === 0,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (request.method === "GET") {
          const s = readState();
          return jsonOf({
            presets: presetList(s),
            global: s.global,
            session: hasSession
              ? {
                  sessionId,
                  presetId: Object.prototype.hasOwnProperty.call(s.assignments, sessionId)
                    ? s.assignments[sessionId]
                    : undefined,
                }
              : null,
            effective: hasSession
              ? (() => {
                  const found = presetForSession({
                    sessionId,
                    assignments: s.assignments,
                    global: s.global,
                    presets: s.presets,
                  });
                  return found?.preset
                    ? {
                        ...found,
                        signature: presetSignature(found.preset),
                        preset: {
                          ...found.preset,
                          signature: presetSignature(found.preset),
                          label: presetLabel(found.preset),
                        },
                      }
                    : found;
                })()
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

          const readContent = () => {
            const out = {};
            if ("prompts" in (body ?? {})) {
              const prompts = Array.isArray(body.prompts) ? body.prompts : [];
              const unknown = prompts.filter((x) => typeof x !== "string" || !libraryOf(ctx).has(x));
              if (unknown.length > 0) return { error: `提示词库里没有：${unknown.join("、")}` };
              out.prompts = prompts;
            }
            if ("sections" in (body ?? {})) {
              out.selection =
                body.sections && typeof body.sections === "object" && !Array.isArray(body.sections)
                  ? selectionFromSectionsInput(body.sections)
                  : normalizeSelection(null);
            }
            if ("selection" in (body ?? {})) {
              out.selection = normalizeSelection(body.selection);
            }
            return out;
          };

          const emptySelectionProblem = (content) => {
            const available = Array.isArray(body?.availableNative) ? body.availableNative : [];
            if (available.length === 0) return null; // 不知道 → 不拦
            const raw = body?.selection && typeof body.selection === "object" ? body.selection : {};
            const sel = {
              listed: Array.isArray(raw.listed) ? raw.listed : [],
              excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
              sections: { ...(raw.sections && typeof raw.sections === "object" ? raw.sections : {}) },
            };
            if (content.selection) {
              sel.listed = content.selection.listed;
              sel.excluded = content.selection.excluded;
              sel.sections = content.selection.sections;
            }
            return isEmptySelection({ selection: sel, availableNative: available })
              ? "这张清单里一段都不会进系统提示词 —— 至少勾一段原生段落，或者挂一条自己的提示词。"
              : null;
          };

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
              prompts: content.prompts ?? [],
              selection: content.selection,
              note: typeof body?.note === "string" ? body.note : "",
            });
            writeState({ presets: { ...s.presets, [id]: preset } });
            diag.lastPresets = `save:${id}`;
            return jsonOf({ ok: true, id, preset: { ...preset, sections: preset.selection?.sections ?? {} } });
          }

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
              prompts: content.prompts ?? preset.prompts,
              selection: content.selection ?? preset.selection,
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
              writeState({
                global: { ...s.global, presetId: id, enabled: true },
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
                sections: Object.keys(preset.selection?.sections ?? {}).length,
                signature: presetSignature(preset),
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

        // Preview, library reload, and session assignment endpoints.
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
          const pruned = prunePresets((id) => libraryOf(ctx).has(id));
          syncInjector(ctx);
          return jsonOf({ count: r.count, errors: r.errors, prompts: libraryList(ctx), pruned });
        }

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

        // Prompt library editor endpoints.
        if (path === EDIT_PATH && request.method === "GET") {
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
          const custom = [...new Set(
            items.map((p) => p.category).filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
          )].sort();
          return jsonOf({
              prompts: items,
              categories: CATEGORIES,
              customCategories: custom,
              presets: stEdit.presets,
              global: stEdit.global,
              enabled: stEdit.global.enabled === true,
              catalogPath: CATALOG_PATH,
              promptsDir: PROMPTS_DIR,
              libraryErrors: libraryErrors(),
            });
        }

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

          libraryOf(ctx).reload();
          const pruned = {};
          {
            const inner = injectorOf(ctx)?.pruneMissing() ?? {};
            if (inner && Object.keys(inner.defaults ?? {}).length) pruned.defaults = inner.defaults;
            if (inner && Object.keys(inner.sessions ?? {}).length) pruned.sessions = inner.sessions;
          }
          Object.assign(pruned, prunePresets((id) => libraryOf(ctx).has(id)));
          syncInjector(ctx);
          diag.editCount = (diag.editCount ?? 0) + 1;
          diag.lastPost = `edit:${action}:${result.id}`;
          return jsonOf({ ...result, pruned, prompts: libraryList(ctx), libraryErrors: libraryErrors() });
        }

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
