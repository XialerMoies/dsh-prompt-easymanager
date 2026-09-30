// 「快速预设」：把一整套配置存成名字，一键切换。
//
// ═══════════════════════════════════════════════════════════════════════════
// 预设是什么
// ═══════════════════════════════════════════════════════════════════════════
//
// **一份完整配置的快照**，两个作用范围各存各的：
//
//     全局层:  defaults[]               + sectionOverrides
//     会话层:  assignments[sessionId]   + sessionSectionOverrides[sessionId]
//
// 注意这两层是**对称的** —— 注入和改写各有一层全局、一层按会话。
// 预设就按这个对称来存，不需要另造一套结构。
//
// ═══════════════════════════════════════════════════════════════════════════
// 应用预设是「覆盖」不是「合并」
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ 这一条要**在界面上说清楚**，否则用户会以为应用预设只加不减。
//
//    理由：预设的语义是「我要切换到这个状态」。如果合并，就永远去不掉
//    之前加的提示词 —— 那这个功能就没法「切换」了。
//
//    代价：手写的临时改动会被冲掉。所以「另存为预设」必须好用，
//    用户才能先存后切。

/** 预设 id 的最大长度（存进 JSON 的键，别太长）。 */
const MAX_ID = 60;

/**
 * 从名字生成一个稳定的 id。
 *
 * 保留中文 —— 用户的预设名多半是中文，转成拼音或哈希反而不好认。
 * 只把明显不适合做键的字符换掉。
 */
export function presetId(name, taken = []) {
  const base =
    String(name ?? "")
      .trim()
      .replace(/[\s/\\:*?"<>|]+/g, "-") // 空格和文件系统敏感字符
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_ID) || "preset";
  const used = new Set(Array.isArray(taken) ? taken : []);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** 校验单条预设。不合法返回 null（调用方当作"没这条"）。 */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  return {
    name,
    /** "global" | "session" —— 这份快照是从哪一层存的，也决定应用时写回哪一层 */
    scope: raw.scope === "session" ? "session" : "global",
    /** 要注入的自设提示词 id（有序，去重） */
    prompts: Array.isArray(raw.prompts)
      ? [...new Set(raw.prompts.filter((x) => typeof x === "string" && x))]
      : [],
    /** 段落改写表（结构跟 sectionOverrides 一样，**深一层拷贝**） */
    sections: cloneSections(raw.sections),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    /** 用户自己写的说明，可选 */
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

/** 校验整张预设表。坏记录丢掉，不拖垮其他预设。 */
export function normalizePresets(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof id !== "string" || !id) continue;
    const norm = normalizePreset(value);
    if (norm !== null) out[id] = norm;
  }
  return out;
}

/**
 * 深一层拷贝段落改写表。
 *
 * ⚠️ **不能只 `{ ...sections }`** —— 那是浅拷贝，内层的覆盖对象还是共享的。
 *    结果：存完预设之后，界面上再改同一段，**已存的预设会跟着变**
 *    （测试逮到的：改源对象的 `.text`，预设里的也跟着变了）。
 *
 *    覆盖对象本身是平的（action/text/original/originalHash/savedAt/acceptedDrift），
 *    所以拷贝一层就够。
 */
function cloneSections(sections) {
  const out = {};
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return out;
  for (const [name, ov] of Object.entries(sections)) {
    out[name] = ov && typeof ov === "object" ? { ...ov } : ov;
  }
  return out;
}

/**
 * 从当前状态采一份快照。
 *
 * @param {object} args
 * @param {string} args.name
 * @param {"global"|"session"} args.scope
 * @param {string[]} args.prompts   该层当前生效的提示词 id
 * @param {object} args.sections    该层当前的段落改写表
 * @param {string} [args.note]
 * @param {string} [args.now]       注入时间戳（测试用，默认取当前时间）
 */
export function capturePreset({ name, scope, prompts, sections, note = "", now }) {
  return {
    name: String(name ?? "").trim(),
    scope: scope === "session" ? "session" : "global",
    prompts: [...new Set((Array.isArray(prompts) ? prompts : []).filter((x) => typeof x === "string" && x))],
    sections: cloneSections(sections),
    createdAt: now ?? new Date().toISOString(),
    note: String(note ?? ""),
  };
}

/**
 * 算出「应用这条预设」要写什么。
 *
 * ⚠️ **返回的是要写进对应层的完整值，不是增量** —— 应用 = 覆盖。
 *    见文件头「应用预设是覆盖不是合并」。
 *
 * @param {object} preset  已 normalize 的预设
 * @returns {{ prompts: string[], sections: object, scope: string }}
 */
export function planApply(preset) {
  if (!preset || typeof preset !== "object") {
    return { prompts: [], sections: {}, scope: "global" };
  }
  return {
    scope: preset.scope === "session" ? "session" : "global",
    prompts: [...(preset.prompts ?? [])],
    sections: { ...(preset.sections ?? {}) },
  };
}

/**
 * 预设的「签名」：用来判断两个预设内容是否相同。
 *
 * 用途：界面上标出「当前状态 = 某个预设」 —— 应用完预设之后要能看出来
 * 现在正处在哪个预设上（不然用户不知道自己在哪）。
 */
export function presetSignature(input) {
  // ⚠️ **不能直接解构参数** —— `presetSignature(null)` 会抛
  //    `Cannot destructure property 'prompts' of 'object null'`（测试逮到的）。
  const src = input && typeof input === "object" ? input : {};
  const prompts = src.prompts;
  const sections = src.sections;
  const p = [...new Set((Array.isArray(prompts) ? prompts : []).filter(Boolean))].sort();
  const s = Object.entries(sections && typeof sections === "object" ? sections : {})
    .map(([k, v]) => {
      const action = v && v.action === "disable" ? "disable" : "replace";
      const text = action === "disable" ? "" : String((v && v.text) ?? "");
      return `${k}=${action}:${text}`;
    })
    .sort();
  return JSON.stringify({ p, s });
}

/**
 * 找出当前状态**正好等于**哪条预设。
 *
 * 应用完预设之后界面上要能显示「当前：写代码」—— 否则用户不知道自己在哪。
 * 找不到（手改过）就返回 null，界面显示「已改动」。
 */
export function matchPreset(current, presets) {
  const table = presets && typeof presets === "object" ? presets : {};
  const target = presetSignature(current);
  for (const [id, preset] of Object.entries(table)) {
    if (presetSignature(preset) === target) return { id, name: preset.name };
  }
  return null;
}

/**
 * 给界面用的一句话摘要。
 * @param {object} preset
 */
export function summarizePreset(preset) {
  const parts = [];
  if (preset.prompts.length > 0) parts.push(`自设 ${preset.prompts.length} 条`);
  const n = Object.keys(preset.sections).length;
  if (n > 0) parts.push(`改写 ${n} 段`);
  parts.push(preset.scope === "session" ? "会话层" : "全局层");
  return parts.join(" · ");
}
