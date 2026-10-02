// 系统提示词的「勾选清单」—— **纯逻辑**，无副作用
//
// ═══════════════════════════════════════════════════════════════════════════
// 这是什么
// ═══════════════════════════════════════════════════════════════════════════
//
// 一条预设管三块东西（用户看到的就是三个文件夹）：
//
//     个人提示词    要挂哪几条（库里的 id）
//     改动提示词    哪几段被改成了什么
//     系统提示词    dsh 原生的那些段，勾着的就用原版
//
// 这三块合成一个「清单」，装配时照清单把段落拼出来。
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ 关键设计：记的是「动作」，不是「快照」
// ═══════════════════════════════════════════════════════════════════════════
//
// 一开始我想的是「预设里存一份完整的段落快照」。**那样是错的**，因为：
//
//     快照 = 那一刻的原生全文。dsh 之后加了新段、改了旧段，快照都不知道。
//     结果：每条预设都得手动更新，而且 dsh 加的新段会**静静地不进提示词**。
//
// 改成记「用户主动做过的动作」之后：
//
//     没动过的段   →  不在任何名单里  →  **跟着 dsh 走**（自动包含，内容用最新的）
//     改过的段     →  在 `listed` 里，正文记在 `sections`
//     取消勾选的段 →  在 `excluded` 里  →  不进提示词
//
// 于是 dsh 加了新段：**不用改任何预设，它自动就在提示词里**。
//
// ⚠️ 但「取消勾选」必须**显式记下来**。不记的话，一个从没出现在清单里的段
//    和「用户不想要的段」就分不开了 —— 前者该自动包含，后者不该。
//
// ═══════════════════════════════════════════════════════════════════════════
// 某一段的三种状态
// ═══════════════════════════════════════════════════════════════════════════
//
//     `sections[name]` 有   →  用**用户改的那份**
//     `excluded` 里有       →  **不进提示词**（这就是原来那个「关闭」动作）
//     两个都没有            →  用 **dsh 原版**（跟着它升级走）

import { OVERRIDE_ACTIONS, hashSectionText } from "./section-overrides.mjs";

/**
 * 「用户主动改过、但还没决定要不要进预设」的那一段，用的占位。
 *
 * ⚠️ 存在这个值是因为**改一段**和**决定它进不进预设**是两步：
 *    用户刚在「系统提示词」那一栏改完，改动要**先存进预设**（否则刷新就丢），
 *    但他可能还没在清单里勾中它。占位就表示「改好了，等着被勾」。
 *
 *    真正生效时正文取的是这个段落的实际内容，所以占位不会变成空正文。
 */
export const UNCHECKED = Symbol("dsh-prompt-easymanager.selection.unchecked");

/** 一份空清单。 */
export function emptySelection() {
  return { listed: [], excluded: [], sections: {}, known: [] };
}

/**
 * 校验一份清单。坏数据丢掉，不抛。
 *
 * `listed` 和 `excluded` 是两套独立勾选：同一个名字可以同时存在，分别
 * 代表「注入改写副本」和「不注入原生副本」。投影时改写副本优先。
 */
export function normalizeSelection(raw) {
  const out = emptySelection();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

  // ① 先收排除名单 —— 它优先级最高
  const exSeen = new Set();
  for (const name of Array.isArray(raw.excluded) ? raw.excluded : []) {
    if (typeof name !== "string" || !name || exSeen.has(name)) continue;
    exSeen.add(name);
    out.excluded.push(name);
  }

  // ② 改写副本的勾选名单。不要过滤 excluded：两套 tag 必须独立。
  const seen = new Set();
  for (const name of Array.isArray(raw.listed) ? raw.listed : []) {
    if (typeof name !== "string" || !name || seen.has(name)) continue;
    seen.add(name);
    out.listed.push(name);
  }

  // ③ 段落正文 —— 被排除的段仍保留副本，取消勾选不应造成数据丢失
  if (raw.sections && typeof raw.sections === "object" && !Array.isArray(raw.sections)) {
    for (const [name, ov] of Object.entries(raw.sections)) {
      if (typeof name !== "string" || !name) continue;
      const norm = normalizeKeptOverride(ov);
      if (norm !== null) out.sections[name] = norm;
    }
  }

  // ④ 上次看见过的原生段名 —— 用来判断「dsh 加了新段没有」
  if (Array.isArray(raw.known)) {
    const kSeen = new Set();
    out.known = [];
    for (const name of raw.known) {
      if (typeof name !== "string" || !name || kSeen.has(name)) continue;
      kSeen.add(name);
      out.known.push(name);
    }
  }

  return out;
}

/**
 * 校验一条「留在预设里」的段落记录。
 *
 * ⚠️ 跟 `section-overrides.normalizeOverride` **不一样**：
 *    那边要求 `action` 是 `replace` / `disable` 之一（老模型的两个动作）。
 *    新模型里没有 `disable` —— 「不要这段」由 `excluded` 表达，
 *    所以这里不认 `action: "disable"`，只认「有正文的改写」。
 *
 *    也正因如此，这里**不需要 action 字段**：能被留下的记录就是「改成这样」。
 */
function normalizeKeptOverride(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw === UNCHECKED) return { unchecked: true };
  const text = typeof raw.text === "string" ? raw.text : null;
  if (text === null) return null;
  // 老数据里带 action 的照样收下（迁移友好），但只当作「改成这样」
  const action = typeof raw.action === "string" ? raw.action : null;
  if (action !== null && !OVERRIDE_ACTIONS.includes(action)) return null;
  return {
    text,
    /** 拍下这份改动时，官方原文是什么 —— 用来判断「官方后来改过没有」 */
    original: typeof raw.original === "string" ? raw.original : "",
    originalHash:
      typeof raw.originalHash === "string" && raw.originalHash
        ? raw.originalHash
        : hashSectionText(typeof raw.original === "string" ? raw.original : ""),
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
  };
}

/**
 * 从「原生段落 + 上一份清单 + 这次要做的动作」算出一份新清单。
 *
 * 这是用户点一下之后唯一要走的路 —— 界面只表达意图，算术在这儿。
 *
 * @param {object} args
 * @param {Array<{name: string, text: string}>} args.native  当前 dsh 原生段落（这次装配看到的）
 * @param {object} args.selection                            上一份清单
 * @param {string} args.name                                 动的是哪一段
 * @param {'include'|'exclude'} [args.action]                include = 勾上、exclude = 不勾
 * @param {{text: string, original?: string}} [args.edit]    顺带把正文改成这样
 * @returns {{listed: string[], excluded: string[], sections: Record<string, object>}}
 */
export function applySelectionEdit({ native, selection, name, action, edit }) {
  const next = normalizeSelection(selection);
  if (typeof name !== "string" || !name) return next;

  const liveText =
    (Array.isArray(native) ? native : []).find((s) => s && s.name === name)?.text ?? "";

  // ── 只改正文（没给 action）────────────────────────────────────────────
  //
  // ⚠️ **这条分支不能动两个名单。** 第一版把它放在下面那两行清理之后，
  //    于是「已经勾着的段改一下正文」会把它从 listed 里踢出去 —— 测试逮到了。
  if (!action) {
    if (edit && typeof edit.text === "string") {
      next.sections[name] = normalizeKeptOverride({
        text: edit.text,
        original: typeof edit.original === "string" ? edit.original : liveText,
        savedAt: new Date().toISOString(),
      });
      // 改过的段**不自动进 listed** —— 用户还没勾它。
      // `listed` 里原来有就保留（上面没动它），没有就等他勾。
    }
    return next;
  }

  // ── 有 action：按它调整两个名单 ──────────────────────────────────────
  if (action !== "exclude") next.listed = next.listed.filter((n) => n !== name);
  next.excluded = next.excluded.filter((n) => n !== name);

  if (action === "exclude") {
    // 不勾 = 不进提示词；改过的正文保留在副本里，之后可以重新勾回。
    next.excluded.push(name);
    return next;
  }

  if (action === "include") {
    next.listed.push(name);
    // ⚠️ **`include` 时必须把 `edit` 一起存下来。**
    //    第一版这里只 push 了名字、**把 edit 丢了** —— 于是
    //    「改一段」这个动作只记了「勾上」，正文没进去，
    //    表现是「改完保存，还是原生」。
    //    （集成测试逮到的：`改动写进了预设的清单里` 那条红。）
    if (edit && typeof edit.text === "string") {
      next.sections[name] = normalizeKeptOverride({
        text: edit.text,
        original: typeof edit.original === "string" ? edit.original : liveText,
        savedAt: new Date().toISOString(),
      });
    }
    return next;
  }

  return next;
}

/**
 * 把清单投影到装配结果上 —— 算出「每一段最终该是什么」。
 *
 * @param {object} args
 * @param {Array<{name: string, text: string}>} args.native   这次装配的段落（dsh 原生）
 * @param {object|null} args.selection                        生效的清单；null = 一个都不套
 * @returns {{
 *   outcome: string,
 *   plan: Array<{name: string, mode: string, text: string, drifted: boolean}>,
 *   counts: object,
 * }}
 */
export function projectSelection({ native, selection }) {
  const sections = (Array.isArray(native) ? native : []).filter(
    (s) => s && typeof s.name === "string",
  );

  // ⚠️ **`selection` 是 null 时一段都不套** —— 这就是「全局关掉 / 会话不注入」
  //    那条路径。以前的行为是「照样套全局那份改写」，是个 bug。
  if (!selection) {
    return {
      outcome: "none",
      plan: sections.map((s) => ({
        name: s.name,
        mode: "native",
        text: typeof s.text === "string" ? s.text : "",
        drifted: false,
      })),
      counts: { total: sections.length, native: sections.length, edited: 0, dropped: 0, unlisted: 0 },
    };
  }

  const sel = normalizeSelection(selection);
  const excluded = new Set(sel.excluded);
  const listed = new Set(sel.listed);
  const liveByName = new Map(sections.map((s) => [s.name, typeof s.text === "string" ? s.text : ""]));

  const plan = [];
  let edited = 0;
  let dropped = 0;
  let pending = 0;

  // ── ① 当前装配里的每一段 ─────────────────────────────────────────────
  for (const s of sections) {
    const live = typeof s.text === "string" ? s.text : "";

    const ov = sel.sections[s.name];
    // Native and edited copies have independent checkboxes. A listed edited
    // copy wins even when the native copy is excluded; excluding native must
    // not silently disable the user's separately selected rewrite.
    if (ov && listed.has(s.name)) {
      // 改过的段：用改的那份，并报「官方后来动过没有」
      const drifted = ov.original ? ov.original !== live : false;
      plan.push({ name: s.name, mode: "edited", text: ov.text, drifted });
      edited += 1;
      continue;
    }

    // Keep an unchecked rewrite visible to the editor while leaving native
    // text active for injection until the rewrite tag is selected and saved.
    if (ov) {
      plan.push({ name: s.name, mode: "pending", text: ov.text, drifted: false });
      pending += 1;
      continue;
    }

    if (excluded.has(s.name)) {
      plan.push({ name: s.name, mode: "dropped", text: "", drifted: false });
      dropped += 1;
      continue;
    }

    // A saved edit is only active when it is also listed in the preset.
    // An empty `listed` is the default "all native sections" state, so an
    // unlisted edit falls back to the current native text.

    plan.push({ name: s.name, mode: "native", text: live, drifted: false });
  }

  // ── ② 预设里有、但这次装配里没有的（dsh 改名/删了，或者换了预设）──────
  //
  //     ⚠️ **不注册回去** —— 硬塞一个同名段会变成「新增一段」，
  //        位置也不对。留着数据、报给界面，让用户自己决定。
  const stale = [];
  for (const [name, ov] of Object.entries(sel.sections)) {
    if (liveByName.has(name)) continue;
    stale.push({ name, mode: "stale", text: ov.text, drifted: false });
  }

  // ── ③ 清单里有、但这次装配里没有的原生段（换了预设）────────────────
  const unlisted = sel.listed.filter((n) => !liveByName.has(n));

  return {
    outcome: "ok",
    plan: plan.concat(stale),
    counts: {
      total: plan.length,
      native: plan.length - edited - dropped - pending,
      edited,
      dropped,
      pending,
      unlisted: unlisted.length,
    },
    stale,
    unlisted,
  };
}

/**
 * 把投影结果套回装配对象上（就地改 `section.text`）。
 *
 * ⚠️ 跟 `projectSelection` 分开，是为了让判定能单独测 ——
 *    那个函数不碰任何 dsh 的东西，这个才动手。
 *
 * ⚠️ **返回值里 `touched` 比 `changed` 重要。**
 *
 *    第一版只返回 `changed`（正文真的变了的条数），于是有个注入验不出来：
 *    把「不在计划里就跳过」改成「不在计划里就当它该保持原样」——
 *    那会把正文赋成它自己的值，`changed` 照样不变，看着一切正常，
 *    但它**确实动了不该动的段**。
 *
 *    所以显式报出「这次碰了哪些段的名字」，让测试能钉住「没碰别人的」。
 *
 * @returns {{changed: number, touched: string[]}}
 */
export function applyProjection(sections, projected) {
  if (!Array.isArray(sections) || !projected || !Array.isArray(projected.plan)) {
    return { changed: 0, touched: [] };
  }
  const byName = new Map();
  for (const row of projected.plan) {
    if (row.mode === "stale" || row.mode === "pending") continue;
    byName.set(row.name, row.text);
  }
  let changed = 0;
  const touched = [];
  for (const section of sections) {
    if (!section || typeof section.name !== "string") continue;
    // ⚠️ **计划里没有的段，一根手指都不碰。**
    if (!byName.has(section.name)) continue;
    const want = byName.get(section.name);
    // ⚠️ `touched` 只记**真的改了的** —— 记「遍历到的」的话，
    //    计划里那些「本来就跟现状一样」的段也会进去，数字就没意义了。
    //    （第一版就是这么写的，测试第一条就把它逮住了。）
    if (section.text !== want) {
      section.text = want;
      changed += 1;
      touched.push(section.name);
    }
  }
  return { changed, touched };
}

/**
 * 从当前的原生段落**开一份全勾的清单**（刚装上时的默认）。
 *
 * ⚠️ **不复制正文** —— 见文件头那段。全勾的清单就是「两个名单都空」，
 *    意思是「有什么用什么，都用原版」。这样 dsh 升级、加段，默认预设自动跟上。
 */
export function selectionFromNative() {
  return emptySelection();
}

/**
 * 比对「这次装配」跟「上一份清单」，报出 dsh 那边的变化。
 *
 * ⚠️ 「新段」的判据是「**上次没看见过**」，不是「清单里没提到」。
 *    第一版拿「清单里记过的那几个名字」当已知集合，于是**所有没动过的段
 *    都被误报成 dsh 新增** —— 测试逮到了（它报出了 `harness:identity`）。
 *
 *    所以清单里得存一份 `known`：上次看见过的原生段名。
 *    装配时顺手更新它。
 *
 * @param {object} args
 * @param {Array<{name: string, text?: string}>} args.native
 * @param {object} args.selection
 * @returns {{added: string[], removed: string[], drifted: string[], known: string[]}}
 *          `known` 是这次应该写回清单的「看见过的段名」
 */
export function diffNative({ native, selection }) {
  const sections = (Array.isArray(native) ? native : []).filter(
    (s) => s && typeof s.name === "string" && s.name,
  );
  const names = sections.map((s) => s.name);
  const live = new Set(names);
  const sel = normalizeSelection(selection);
  const before = new Set(sel.known);

  // 清单里动过的段（改过 / 排除过）—— 它们就算上次没记进 known，
  // 也不该报成「dsh 新增」（用户明明见过它们）
  const touched = new Set([...sel.listed, ...sel.excluded, ...Object.keys(sel.sections)]);

  const drifted = [];
  for (const [name, ov] of Object.entries(sel.sections)) {
    if (!live.has(name)) continue;
    const text = sections.find((s) => s.name === name)?.text;
    if (ov.original && ov.original !== (typeof text === "string" ? text : "")) drifted.push(name);
  }

  return {
    // 上次没看见过、而且用户也没动过 → dsh 新加的（会被自动包含）
    added: names.filter((n) => !before.has(n) && !touched.has(n)),
    // 记过、但这次没了 → dsh 删了或改名了
    removed: [...before].filter((n) => !live.has(n)),
    drifted,
    known: names,
  };
}

/**
 * 一份清单是不是什么都没勾（用来拦住「空清单保存」）。
 *
 * ⚠️ 「空」的判据**不是「两个名单都空」** —— 那正是**默认的全勾状态**
 *    （默认不写任何东西，意思是「dsh 有什么就用什么」）。
 *
 *    真正的空是：一段都没改过，而且**当前能用的原生段全被排除了**。
 *    第一版漏了这个区分，测试第一条断言就把它逮住了 ——
 *    而且第二版还错了一次（`availableNative` 可能是空的，我拿它当「全排除」）。
 *
 * @param {object} args
 * @param {object} args.selection
 * @param {string[]} args.availableNative  当前能用的原生段名
 */
export function isEmptySelection({ selection, availableNative }) {
  const sel = normalizeSelection(selection);
  if (Object.keys(sel.sections).length > 0) return false; // 有改过的段 → 不空

  const names = (Array.isArray(availableNative) ? availableNative : []).filter(
    (n) => typeof n === "string" && n,
  );
  // ⚠️ **不知道有哪些原生段 → 不判断**（返回 false）。
  //    宁可放过，也不要因为「不知道」就把用户的保存拦下来 ——
  //    拦住保存比放过保存烦人得多。
  if (names.length === 0) return false;

  const excluded = new Set(sel.excluded);
  return names.every((n) => excluded.has(n));
}
