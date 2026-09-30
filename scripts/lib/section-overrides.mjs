// 系统提示词段落覆盖 —— **纯逻辑**，无副作用
//
// ═══════════════════════════════════════════════════════════════════════════
// 这里为什么单独一个模块
// ═══════════════════════════════════════════════════════════════════════════
//
// 「官方改过这一段没有」的判定分支很多（新增 / 改动 / 删除 / 改名），
// 而且**每一条都关系到会不会把官方的更新顶掉**。
// 所以把这些判定做成不碰 dsh、不碰文件系统的纯函数，可以单独跑测试。
//
// 真正动模型输入的是 `applyOverridesToAssembly()`，由宿主在
// `system-prompt/assemble` 瀑布里调用 —— 见 session-injection.mjs。
//
// 机制依据见 docs/section-overrides-design.md。

import { createHash } from "node:crypto";

/** 覆盖动作。 */
export const OVERRIDE_ACTIONS = ["replace", "disable"];

/**
 * 段落状态。
 *
 * - `apply`     有覆盖，**会生效**
 * - `stale`     这一段在全局视图里已经不存在了（官方删了或改名了）→ **不应用**，保留数据
 * - `untouched` 官方有、用户没动过
 *
 * ⚠️ **没有 "drifted" 这个状态** —— 漂移不是状态，是 `apply` 上的一个**标记**
 *    （`row.drifted === true`）。因为按用户定的口径，官方改过这段**也照旧覆盖**。
 */
export const OVERRIDE_STATUS = {
  APPLY: "apply",
  STALE: "stale",
  UNTOUCHED: "untouched",
};

/** 官方原文的指纹。只用来比对，不做安全用途，取前 16 位就够。 */
export function hashSectionText(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex").slice(0, 16);
}

/** 校验一条存储的覆盖记录；不合法就返回 null（调用方当作"没这条"）。 */
export function normalizeOverride(raw) {
  if (!raw || typeof raw !== "object") return null;
  const action = OVERRIDE_ACTIONS.includes(raw.action) ? raw.action : null;
  if (action === null) return null;
  return {
    action,
    // disable 时正文无意义，但仍保留字段，方便用户来回切换不丢内容
    text: typeof raw.text === "string" ? raw.text : "",
    original: typeof raw.original === "string" ? raw.original : "",
    originalHash: typeof raw.originalHash === "string" ? raw.originalHash : "",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    acceptedDrift: raw.acceptedDrift === true,
  };
}

/** 规范化整张覆盖表。坏记录直接丢掉，不让它拖垮整个装配。 */
export function normalizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw)) {
    if (typeof name !== "string" || name.length === 0) continue;
    const norm = normalizeOverride(value);
    if (norm !== null) out[name] = norm;
  }
  return out;
}

/**
 * 造一条新的覆盖记录。
 *
 * @param {object} args
 * @param {"replace"|"disable"} args.action
 * @param {string} args.text        用户写的正文（disable 时空串）
 * @param {string} args.original    **当前**官方原文 —— 存下来做漂移基准
 * @param {boolean} [args.acceptedDrift] 用户是否已经点掉了「官方改过」的提醒
 */
export function makeOverride({ action, text, original, acceptedDrift = false }) {
  return {
    action,
    text: typeof text === "string" ? text : "",
    original: typeof original === "string" ? original : "",
    originalHash: hashSectionText(original),
    savedAt: new Date().toISOString(),
    acceptedDrift: acceptedDrift === true,
  };
}

/**
 * 把「存储的覆盖」和「全局视图里的官方原文」对一遍，决定每一段该怎么办。
 *
 * ⚠️ **这是整个功能的核心判定，也是「向后兼容官方未来新提示词」的落点。**
 *
 * **漂移（官方改过这段）不影响是否覆盖** —— 用户的改写照旧生效。
 * 漂移只作为标记报给界面（`row.drifted`），提示「你改的这段官方已经更新过」。
 * 「还原默认」= 删掉覆盖 → 官方**当前**的文本自然生效（也就是新版）。
 *
 * @param {object} args
 * @param {Record<string, object>} args.overrides      存储的覆盖
 * @param {Array<{name: string, text: string}>} args.globalSections
 *        全局视图（`assemble({ agent })`，**不带 scope**）—— 官方原文
 * @returns {{
 *   apply: Array<object>, drifted: Array<object>, stale: Array<object>,
 *   untouched: Array<object>, byName: Record<string, object>
 * }}
 *   `apply` 是**会被应用的**；`drifted` 是其中「官方改过」的那些（apply 的子集）。
 */
export function planOverrides({ overrides, globalSections }) {
  const sections = Array.isArray(globalSections) ? globalSections : [];
  // ⚠️ 一定要过一遍 normalizeOverrides：传进来 undefined / null / 数组 / 带坏记录的表
  //    都会在这里被收拾干净。少了这一步，`overrides[name]` 会直接抛
  //    （测试第一次跑就红在这行）。
  const ovTable = normalizeOverrides(overrides);

  const globalByName = new Map();
  for (const s of sections) {
    if (s && typeof s.name === "string") globalByName.set(s.name, s);
  }

  const apply = [];
  const drifted = [];
  const stale = [];
  const untouched = [];
  /** @type {Record<string, object>} name → 这一段的完整判定（给界面直接渲染用） */
  const byName = {};

  // ── 1. 先走官方现有的每一段 ──────────────────────────────────────────────
  sections.forEach((section, index) => {
    const name = section?.name;
    if (typeof name !== "string") return;
    const liveText = typeof section.text === "string" ? section.text : "";
    const liveHash = hashSectionText(liveText);
    const ov = ovTable[name];

    if (ov === undefined) {
      const row = {
        name,
        index,
        status: OVERRIDE_STATUS.UNTOUCHED,
        drifted: false,
        driftAcknowledged: false,
        original: liveText,
        originalHash: liveHash,
        basedOn: "",
        basedOnHash: "",
        action: null,
        text: "",
        savedAt: "",
      };
      untouched.push(row);
      byName[name] = row;
      return;
    }

    // 漂移判定：官方原文的指纹跟当初存下来的对不对得上。
    // **只做标记，不拦着覆盖。**
    const isDrifted = ov.originalHash !== liveHash;

    const row = {
      name,
      index,
      status: OVERRIDE_STATUS.APPLY,
      /** 官方改过这一段（不影响是否覆盖） */
      drifted: isDrifted,
      /** 漂移提醒已经点掉过了 */
      driftAcknowledged: isDrifted && ov.acceptedDrift,
      original: liveText,
      originalHash: liveHash,
      // 当初依据的旧原文，界面能做对照
      basedOn: ov.original,
      basedOnHash: ov.originalHash,
      action: ov.action,
      text: ov.text,
      savedAt: ov.savedAt,
    };
    apply.push(row);
    if (isDrifted) drifted.push(row);
    byName[name] = row;
  });

  // ── 2. 再看存储里那些全局视图里已经没有的 ────────────────────────────────
  //
  // 这些**不应用**：用户当初是「覆盖官方某一段」，而那段已经不存在了。
  // 硬注册回同名 section 会变成「新增一段」—— 那不是用户的意思，
  // 而且我们也拿不到它原本的位置（会插到错的地方）。
  for (const [name, ov] of Object.entries(ovTable)) {
    if (globalByName.has(name)) continue;
    const row = {
      name,
      index: null,
      status: OVERRIDE_STATUS.STALE,
      drifted: false,
      driftAcknowledged: false,
      original: "",
      originalHash: "",
      basedOn: ov.original,
      basedOnHash: ov.originalHash,
      action: ov.action,
      text: ov.text,
      savedAt: ov.savedAt,
    };
    stale.push(row);
    byName[name] = row;
  }

  return { apply, drifted, stale, untouched, byName };
}

/**
 * 把覆盖应用到一次装配结果上。**原地改，绝不重排。**
 *
 * 为什么走 `system-prompt/assemble` 瀑布而不是「注册一个同名 section」：
 *   - 注册同名 section 必须同时给出**正确的 `order`**，而**没有公开接口能读到
 *     已注册 section 的 order** —— `AssembledSection` 只有 `{name, text}`；
 *     `getSectionOrder()` 只认 `"TOOL_BASH"` 这种键名，跟 `"tool:bash"`、
 *     `"mcp:${server}"`、`"ui:deliverable-file-references"` 这类 section 名
 *     之间**没有可推导的对应关系**（这是查过原生插件的注册代码确认的）。
 *     order 给错，这一段就会**跑到别的位置去**。
 *   - 瀑布里拿到的是**已经排好序的**最终结果，直接改 `text` 就行，位置天然不变。
 *
 * 「关掉一段」= 把 text 置空 —— `renderPrompt` 的文档明确写着会 **drop empty
 * sections**，所以空文本等价于不出现。
 *
 * @param {{sections?: Array<{name: string, text: string}>}} assembly
 * @param {ReturnType<typeof planOverrides>} plan
 * @returns {number} 实际改了几段
 */
export function applyOverridesToAssembly(assembly, plan) {
  if (!assembly || !Array.isArray(assembly.sections)) return 0;
  const table = plan?.byName;
  if (!table || typeof table !== "object") return 0;

  let changed = 0;
  for (const section of assembly.sections) {
    if (!section || typeof section.name !== "string") continue;
    const row = table[section.name];
    // 只有 apply 的会被应用；stale / untouched 一律不动
    if (row === undefined || row.status !== OVERRIDE_STATUS.APPLY) continue;
    const next = row.action === "disable" ? "" : row.text;
    if (section.text !== next) {
      section.text = next;
      changed += 1;
    }
  }
  return changed;
}

/**
 * 把「全局默认改写」和「某个会话的改写」合成这个会话**实际生效**的那张表。
 *
 * ⚠️ **按段落名合并，会话层赢** —— 不是整表替换。
 *
 *    为什么是合并不是替换：常见用法是「全局设一个身份，某一个会话额外关掉
 *    几个工具说明」。整表替换的话，那个会话就得把全局那几条也抄一遍，
 *    以后改全局还得挨个同步 —— 迟早漏。
 *
 * @param {Record<string, object>} globalTable  全局默认改写（state.sectionOverrides）
 * @param {Record<string, object>} sessionTable 该会话的改写（state.sessionSectionOverrides[id]）
 * @returns {Record<string, object>} 合并后的表（已 normalize）
 */
export function resolveOverrides(globalTable, sessionTable) {
  return {
    ...normalizeOverrides(globalTable),
    ...normalizeOverrides(sessionTable),
  };
}

/**
 * 给界面用的一句话摘要。
 * @param {ReturnType<typeof planOverrides>} plan
 */
export function summarizePlan(plan) {
  const parts = [];
  if (plan.apply.length > 0) parts.push(`生效 ${plan.apply.length}`);
  if (plan.drifted.length > 0) parts.push(`官方已更新 ${plan.drifted.length}`);
  if (plan.stale.length > 0) parts.push(`已失效 ${plan.stale.length}`);
  parts.push(`未改动 ${plan.untouched.length}`);
  return parts.join(" · ");
}
