import { normalizeOverrides } from "./section-overrides.mjs";
import { normalizeSelection } from "./prompt-selection.mjs";

/** 把持久化预设状态转换成注入器使用的 prompt id 列表。 */
export function toInjectorState(state = {}) {
  const presets = state.presets ?? {};
  const assignments = {};
  for (const [sessionId, presetId] of Object.entries(state.assignments ?? {})) {
    if (!sessionId) continue;
    if (presetId === null) {
      assignments[sessionId] = [];
      continue;
    }
    const preset = typeof presetId === "string" ? presets[presetId] : undefined;
    if (preset) assignments[sessionId] = [...preset.prompts];
  }
  const global = state.global ?? {};
  const globalPreset =
    global.enabled === true && typeof global.presetId === "string" ? presets[global.presetId] : undefined;
  return { assignments, defaults: globalPreset ? [...globalPreset.prompts] : [] };
}

/** 归一化旧接口和新接口共用的段落输入。 */
export function normalizeSectionsInput(raw) {
  const out = {};
  for (const [name, override] of Object.entries(raw ?? {})) {
    if (typeof name !== "string" || !name) continue;
    if (!override || typeof override !== "object" || Array.isArray(override)) continue;
    const action = override.action === "disable" ? "disable" : "replace";
    out[name] = { ...override, action };
  }
  return normalizeOverrides(out);
}

/** 把旧接口的段落表转换成唯一的 selection 字段。 */
export function selectionFromSectionsInput(raw) {
  const normalized = normalizeSectionsInput(raw);
  const listed = [];
  const excluded = [];
  const sections = {};
  for (const [name, override] of Object.entries(normalized)) {
    if (override.action === "disable") excluded.push(name);
    else {
      listed.push(name);
      sections[name] = {
        text: override.text ?? "",
        original: override.original ?? "",
        originalHash: override.originalHash ?? "",
        savedAt: override.savedAt ?? "",
      };
    }
  }
  return normalizeSelection({ listed, excluded, sections, known: [] });
}

