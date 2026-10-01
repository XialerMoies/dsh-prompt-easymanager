// 预设：要注入什么的**唯一载体**。
//
// ═══════════════════════════════════════════════════════════════════════════
// 一个预设 = 两半
// ═══════════════════════════════════════════════════════════════════════════
//
//     {
//       name:     "写代码",
//       prompts:  ["格式契约", "编码规范"],        ← 个人提示词：挂哪几条
//       sections: { "harness:identity": {…} },    ← 系统提示词：改了哪几段
//     }
//
// **两半是独立的**：
//   · `sections` 里**没有**的段落 = 原生（一个字没改）
//   · `prompts` 为空 = 不挂任何个人提示词
//   · 两半都空 = 这个预设什么都不注入，等价于「系统提示词」原样
//
// ⚠️ 「原生」**不是一个选项，是一个状态** —— 某段没被改过它就是原生。
//    所以界面不该有「原生提示词 / 改动过的提示词」这种二选一的下拉，
//    而是「哪些段改过」直接体现在 `sections` 的键上。
//
// ═══════════════════════════════════════════════════════════════════════════
// 作用范围：预设**不带** scope，挂在哪层是「位置」决定的
// ═══════════════════════════════════════════════════════════════════════════
//
// 老模型里 `preset.scope` 表示「这份快照从哪层存的」，应用时写回那层 ——
// 于是同一个预设没法既当全局又挂给某个会话，用户得存两份。
//
// 现在改成**同一个预设两层都能用**：
//
//     全局:  global.presetId     ← 全局用哪个预设
//     会话:  assignments[sid]    ← 这个会话用哪个预设（或 null = 什么都不挂）
//
// `scope` 字段保留只为**兼容老数据**，读取时忽略、写入时不再产生。
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
    // ⚠️ 这里原来还有 `scope: "global"|"session"`，现在**删掉了** ——
    //    预设不再自带作用范围，挂在哪层由 `assignments` / `global.presetId`
    //    决定。老数据里那个字段读的时候直接忽略（normalize 不往外带）。
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
 * @param {string[]} args.prompts   要挂的自设提示词 id
 * @param {object} args.sections    改了哪几段（没有的段 = 原生）
 * @param {string} [args.note]
 * @param {string} [args.now]       注入时间戳（测试用，默认取当前时间）
 */
export function capturePreset({ name, prompts, sections, note = "", now }) {
  return {
    name: String(name ?? "").trim(),
    prompts: [...new Set((Array.isArray(prompts) ? prompts : []).filter((x) => typeof x === "string" && x))],
    sections: cloneSections(sections),
    createdAt: now ?? new Date().toISOString(),
    note: String(note ?? ""),
  };
}

/**
 * 算出「应用这条预设」要写什么。
 *
 * ⚠️ **返回的是完整值，不是增量** —— 应用 = 覆盖。
 *    见文件头「应用预设是覆盖不是合并」。
 *
 * ⚠️ 不再返回 `scope` —— 预设不带作用范围了，写去哪层由调用方决定。
 *
 * @param {object} preset  已 normalize 的预设
 * @returns {{ prompts: string[], sections: object }}
 */
export function planApply(preset) {
  if (!preset || typeof preset !== "object") {
    return { prompts: [], sections: {} };
  }
  return {
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
  const n = Object.keys((preset && preset.sections) || {}).length;
  if (n > 0) parts.push(`改 ${n} 段`);
  const m = ((preset && preset.prompts) || []).length;
  if (m > 0) parts.push(`自设 ${m} 条`);
  return parts.join(" · ");
}

// ═══════════════════════════════════════════════════════════════════════════
// 会话该用哪个预设
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 算出一个会话**实际**该用哪条预设。
 *
 * 三种情形：
 *
 *   ① `assignments[sessionId]` 有值  → 用那条（显式指定，最高优先）
 *   ② 没有，且全局注入开着          → 用 `global.presetId`（跟随全局）
 *   ③ 其余                          → null（系统提示词原样，什么都不挂）
 *
 * ⚠️ **全局注入关掉时，情形 ② 不成立** —— 那是「全局这一层整体停用」，
 *    不是「新会话不自动吃」。所以关掉之后**谁都跟随不了全局**，
 *    会话只能选一条具体预设，或者什么都不挂。
 *    （用户明确选了 A：关掉 = 全局注入这件事整体停用。）
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {object} args.assignments  { sessionId: presetId | null }
 * @param {object} args.global       { enabled: boolean, presetId: string | null }
 * @param {object} args.presets      { id: preset }
 * @returns {{ id: string|null, preset: object|null, source: "session"|"global"|"none" }}
 */
export function presetForSession({ sessionId, assignments, global, presets }) {
  const table = presets && typeof presets === "object" ? presets : {};
  const map = assignments && typeof assignments === "object" ? assignments : {};
  const g = global && typeof global === "object" ? global : {};

  const own = Object.prototype.hasOwnProperty.call(map, sessionId) ? map[sessionId] : undefined;
  if (typeof own === "string" && own && table[own]) {
    return { id: own, preset: table[own], source: "session" };
  }
  // ⚠️ `own === null`（显式「什么都不挂」）会走到这儿 —— 它**不该**再退回去
  //    跟随全局。所以只有「这个会话压根没记录」才允许跟随。
  if (own === null) return { id: null, preset: null, source: "none" };

  if (g.enabled === true && typeof g.presetId === "string" && table[g.presetId]) {
    return { id: g.presetId, preset: table[g.presetId], source: "global" };
  }
  return { id: null, preset: null, source: "none" };
}

/**
 * 一个预设该显示成什么（会话页标签）。
 *
 * 用户的四个场景：
 *
 *   · 有个人提示词        → **预设名**（场景 ③④）
 *   · 没个人提示词、改了段 → 「系统提示词 · 改」（场景 ②）
 *   · 两样都没有          → 「系统提示词」（场景 ①）
 *
 * ⚠️ 判据是「个人提示词**非空**」而不是「改没改段落」——
 *    场景 ③ 说得很清楚：只用个人提示词组合时显示预设名。
 *
 * @param {object} preset
 * @returns {string}
 */
export function presetLabel(preset) {
  const p = preset && typeof preset === "object" ? preset : null;
  if (!p) return "系统提示词";
  const prompts = Array.isArray(p.prompts) ? p.prompts : [];
  if (prompts.length > 0) return String(p.name ?? "") || "（无名预设）";
  const n = Object.keys(p.sections && typeof p.sections === "object" ? p.sections : {}).length;
  return n > 0 ? "系统提示词 · 改" : "系统提示词";
}

/**
 * 归一化全局那份配置。
 *
 * ⚠️ **老数据的默认值是「开」** —— 老版本的状态文件里写的是 `enabled`，而
 *    `readState` 的判据是 `parsed?.enabled !== false`，也就是**不写这个字段 = 开着**。
 *    升级时如果在这里默认成 `false`，用户的全局注入会**凭空被关掉**。
 *    所以调用方要按「!== false」的语义传 `legacy.switchEnabled`（见 index.js）。
 *
 * @param {object} raw
 * @param {object} legacy  { switchEnabled, defaults, sectionOverrides, presets }
 */
export function normalizeGlobal(raw, legacy = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {
    enabled: src.enabled === true,
    presetId: typeof src.presetId === "string" && src.presetId ? src.presetId : null,
  };
  // 老数据：没有 `global` 这个键（那时候是「开关 + defaults[]」两个独立的东西）
  if (!raw || typeof raw !== "object") {
    out.enabled = legacy.switchEnabled === true;
    if (out.enabled && legacy.presets && typeof legacy.presets === "object") {
      const found = matchPreset(
        { prompts: legacy.defaults, sections: legacy.sectionOverrides },
        legacy.presets,
      );
      out.presetId = found ? found.id : null;
    }
  }
  return out;
}
