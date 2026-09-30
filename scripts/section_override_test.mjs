// 系统提示词段落覆盖 —— 纯逻辑测试
//
// 运行：node scripts/section_override_test.mjs
//
// ═══════════════════════════════════════════════════════════════════════════
// 重点测什么
// ═══════════════════════════════════════════════════════════════════════════
//
// **「官方未来改了提示词怎么办」是这个功能的核心要求，所以这里大半用例都是这件事：**
//
//   · 官方**新增**一段      → 用户的数据不用动，新段落自动出现，状态「未改动」
//   · 官方**改动**一段正文  → 标为「官方已更新」，但**照旧覆盖**（用户定的口径）
//   · 官方**删除/改名**一段 → 用户的覆盖变成「已失效」，保留数据但不应用
//
// 以及**真正动模型输入的那一步**（`applyOverridesToAssembly`）：
//   · 只改 text，**不重排**（位置天然不变，因为我们拿不到 order）
//   · 「关掉」= 置空文本 —— renderPrompt 会丢弃空段落
//   · 失效的段落绝不动

import {
  OVERRIDE_ACTIONS,
  OVERRIDE_STATUS,
  hashSectionText,
  normalizeOverride,
  normalizeOverrides,
  makeOverride,
  planOverrides,
  applyOverridesToAssembly,
  resolveOverrides,
  summarizePlan,
} from "./lib/section-overrides.mjs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("段落覆盖逻辑测试");


/** 造一个「全局视图」（官方原文）。 */
const global = (...rows) => rows.map(([name, text]) => ({ name, text }));
/** 造一个「装配结果」（会被原地改）。 */
const assemblyOf = (...rows) => ({ sections: rows.map(([name, text]) => ({ name, text })) });

// ══ 1. 哈希 ═══════════════════════════════════════════════════════════════
{
  eq(hashSectionText("x").length, 16, "取前 16 位");
  eq(hashSectionText("abc"), hashSectionText("abc"), "同样文本同样哈希");
  ok(hashSectionText("abc") !== hashSectionText("abd"), "差一个字符就不同");
  eq(hashSectionText(""), hashSectionText(undefined), "空串与 undefined 等价");
  ok(/^[0-9a-f]{16}$/.test(hashSectionText("中文段落")), "输出是十六进制");
}

// ══ 2. 校验 ═══════════════════════════════════════════════════════════════
{
  eq(OVERRIDE_ACTIONS, ["replace", "disable"], "两种动作");
  eq(Object.keys(OVERRIDE_STATUS).sort(), ["APPLY", "STALE", "UNTOUCHED"], "**没有 drifted 这个状态**（漂移是标记不是状态）");

  ok(normalizeOverride(null) === null, "null → 丢掉");
  ok(normalizeOverride({}) === null, "缺 action → 丢掉");
  ok(normalizeOverride({ action: "乱写" }) === null, "非法 action → 丢掉");

  const r = normalizeOverride({ action: "replace", text: "hi" });
  eq([r.action, r.text, r.original, r.originalHash, r.acceptedDrift], ["replace", "hi", "", "", false], "缺字段用安全的默认值");
  eq(normalizeOverride({ action: "disable", text: "留着" }).text, "留着", "disable 也保留正文（来回切换不丢内容）");

  const table = normalizeOverrides({ good: { action: "replace", text: "a" }, bad: { action: "nope" }, "": { action: "replace" } });
  eq(Object.keys(table), ["good"], "坏记录被丢掉，好的留下");
  eq(normalizeOverrides(null), {}, "null → 空表");
  eq(normalizeOverrides([1, 2]), {}, "**数组 → 空表**（数组也是 object，要单独挡）");
}

// ══ 3. makeOverride ═══════════════════════════════════════════════════════
{
  const o = makeOverride({ action: "replace", text: "我的版本", original: "官方原文" });
  eq(o.originalHash, hashSectionText("官方原文"), "**hash 是按官方原文算的**");
  eq(o.text, "我的版本", "正文");
  ok(o.savedAt.length > 0, "带时间戳");
  eq(o.acceptedDrift, false, "默认没点过漂移提醒");
}

// ══ 4. planOverrides：三态 ════════════════════════════════════════════════
{
  const g = global(["harness:identity", "你是 DSH。"], ["plan:policy", "先做计划。"], ["tool:bash", "怎么用 bash。"]);
  const plan = planOverrides({
    overrides: { "plan:policy": makeOverride({ action: "replace", text: "先写 todo。", original: "先做计划。" }) },
    globalSections: g,
  });

  eq(plan.apply.map((r) => r.name), ["plan:policy"], "一段生效");
  eq(plan.apply[0].status, OVERRIDE_STATUS.APPLY, "状态 apply");
  eq(plan.apply[0].drifted, false, "没漂移");
  eq(plan.drifted.length, 0, "漂移清单为空");
  eq(plan.stale.length, 0, "没有失效");
  eq(plan.untouched.map((r) => r.name), ["harness:identity", "tool:bash"], "另外两段未改动");
  eq(plan.byName["plan:policy"].text, "先写 todo。", "byName 能拿到用户正文");
  eq(plan.byName["harness:identity"].text, "", "未改动没有用户正文");
  eq(plan.byName["plan:policy"].original, "先做计划。", "**带上官方原文**（界面要显示）");
}

// ══ 5. 官方新增一段 —— 用户数据不用动 ═════════════════════════════════════
{
  const overrides = { a: makeOverride({ action: "replace", text: "我的甲", original: "甲" }) };
  const plan = planOverrides({ overrides, globalSections: global(["a", "甲"], ["b", "乙（官方新加的）"]) });

  eq(plan.apply.map((r) => r.name), ["a"], "老的覆盖照常生效");
  eq(plan.untouched.map((r) => r.name), ["b"], "**新增的自动进了未改动**");
  eq(Object.keys(overrides).length, 1, "**用户的数据一个字都不用改**");
}

// ══ 6. **官方改动某段正文** → 标记漂移，但**照旧覆盖** ════════════════════
{
  const overrides = { "plan:policy": makeOverride({ action: "replace", text: "我的版本", original: "旧版策略" }) };
  const plan = planOverrides({ overrides, globalSections: global(["plan:policy", "新版策略（官方改过）"]) });

  eq(plan.apply.map((r) => r.name), ["plan:policy"], "**漂移的照旧生效**（用户定的口径）");
  eq(plan.apply[0].drifted, true, "**但标记为 drifted**，界面要提醒");
  eq(plan.apply[0].driftAcknowledged, false, "提醒还没点掉");
  eq(plan.apply[0].original, "新版策略（官方改过）", "带上官方的新文本");
  eq(plan.apply[0].basedOn, "旧版策略", "**也带上当初依据的旧文本**，界面能做对照");
  eq(plan.apply[0].text, "我的版本", "用户写的照旧用");
  eq(plan.drifted.map((r) => r.name), ["plan:policy"], "漂移清单里有它");
  ok(plan.drifted[0] === plan.apply[0], "**drifted 是 apply 的子集**（同一个对象）");
}

// ══ 7. 漂移提醒点掉之后 → 不再提醒，照旧覆盖 ═════════════════════════════
{
  const o = makeOverride({ action: "replace", text: "我的版本", original: "旧版" });
  o.acceptedDrift = true;
  const plan = planOverrides({ overrides: { "plan:policy": o }, globalSections: global(["plan:policy", "新版"]) });

  eq(plan.apply.length, 1, "照旧生效");
  eq(plan.apply[0].drifted, true, "仍是漂移状态（事实没变）");
  eq(plan.apply[0].driftAcknowledged, true, "**但提醒已点掉**");
  eq(plan.drifted.length, 1, "仍在漂移清单里（界面可以只对未确认的标红）");
}

// ══ 8. **官方删除 / 改名一段** → 失效，保留数据但不应用 ═══════════════════
{
  const overrides = { "tool:old-name": makeOverride({ action: "disable", text: "", original: "老工具说明" }) };
  const plan = planOverrides({ overrides, globalSections: global(["harness:identity", "你是 DSH。"]) });

  eq(plan.stale.map((r) => r.name), ["tool:old-name"], "检出失效");
  eq(plan.stale[0].status, OVERRIDE_STATUS.STALE, "状态 stale");
  eq(plan.stale[0].action, "disable", "原来想干什么还记着");
  eq(plan.stale[0].basedOn, "老工具说明", "当初依据的原文也还在");
  eq(plan.apply.length, 0, "不生效");
  eq(plan.untouched.map((r) => r.name), ["harness:identity"], "官方剩下的那段是未改动");
}

// ══ 9. 改名：旧名字失效 + 新名字未改动，**不会错误套用** ══════════════════
{
  const plan = planOverrides({
    overrides: { "tool:bash": makeOverride({ action: "replace", text: "我的 bash 说明", original: "官方 bash 说明" }) },
    globalSections: global(["tool:shell", "官方 bash 说明（改了个名字）"]),
  });
  eq(plan.stale.map((r) => r.name), ["tool:bash"], "旧名字失效");
  eq(plan.untouched.map((r) => r.name), ["tool:shell"], "新名字是未改动");
  eq(plan.apply.length, 0, "不会把改写套到新名字上");
}

// ══ 10. **applyOverridesToAssembly：原地改 text，绝不重排** ═══════════════
{
  const g = global(["a", "甲"], ["b", "乙"], ["c", "丙"], ["d", "丁"]);
  const plan = planOverrides({
    overrides: {
      a: makeOverride({ action: "disable", text: "", original: "甲" }),
      b: makeOverride({ action: "replace", text: "我改的乙", original: "乙" }),
      c: makeOverride({ action: "replace", text: "改", original: "不是丙" }), // 漂移，照旧覆盖
      zzz: makeOverride({ action: "disable", text: "", original: "没了" }),  // 失效
    },
    globalSections: g,
  });

  const asm = assemblyOf(["a", "甲"], ["b", "乙"], ["c", "丙"], ["d", "丁"]);
  const n = applyOverridesToAssembly(asm, plan);

  eq(n, 3, "改了三段（a 关掉、b 改写、c 漂移但照旧覆盖）");
  eq(asm.sections.map((s) => s.name), ["a", "b", "c", "d"], "**顺序一点没变**");
  eq(asm.sections[0].text, "", "**关掉 = 空文本**（renderPrompt 会丢弃空段落）");
  eq(asm.sections[1].text, "我改的乙", "改写生效");
  eq(asm.sections[2].text, "改", "漂移的那段也照旧覆盖");
  eq(asm.sections[3].text, "丁", "用户没动过的原样不动");

  // ⚠️ 关键：**失效的段落绝不能被"加回来"**
  ok(!asm.sections.some((s) => s.name === "zzz"), "失效的 zzz **没有**被加进装配结果");
}

// ══ 11. applyOverridesToAssembly 的边界 ══════════════════════════════════
{
  eq(applyOverridesToAssembly(null, null), 0, "null 输入 → 0");
  eq(applyOverridesToAssembly({}, null), 0, "没有 sections → 0");
  eq(applyOverridesToAssembly({ sections: [] }, { byName: {} }), 0, "空装配 → 0");
  eq(applyOverridesToAssembly({ sections: [{ name: "a", text: "x" }] }, {}), 0, "plan 没有 byName → 0");
  eq(
    applyOverridesToAssembly(assemblyOf(["a", "甲"]), planOverrides({ overrides: {}, globalSections: global(["a", "甲"]) })),
    0,
    "没有任何覆盖时，一段都不改",
  );

  // 已经等于目标值的不算"改过"
  const plan = planOverrides({
    overrides: { a: makeOverride({ action: "replace", text: "甲", original: "甲" }) },
    globalSections: global(["a", "甲"]),
  });
  eq(applyOverridesToAssembly(assemblyOf(["a", "甲"]), plan), 0, "文本没变化时不计入改动数");

  // 装配里出现 plan 里没有的段落 → 跳过，不炸
  const p2 = planOverrides({
    overrides: { a: makeOverride({ action: "disable", text: "", original: "甲" }) },
    globalSections: global(["a", "甲"]),
  });
  const asm = assemblyOf(["a", "甲"], ["陌生段落", "别动我"]);
  eq(applyOverridesToAssembly(asm, p2), 1, "只改认识的，陌生的跳过");
  eq(asm.sections[1].text, "别动我", "陌生段落原样保留");
}

// ══ 12. 边界输入 ═════════════════════════════════════════════════════════
{
  const p1 = planOverrides({ overrides: {}, globalSections: global(["a", "甲"]) });
  eq([p1.apply.length, p1.drifted.length, p1.stale.length, p1.untouched.length], [0, 0, 0, 1], "空覆盖表");

  const p2 = planOverrides({ overrides: undefined, globalSections: undefined });
  ok(p2.apply.length === 0 && p2.untouched.length === 0, "**undefined 输入不炸**");

  const p3 = planOverrides({ overrides: {}, globalSections: [{ name: "a", text: "甲" }, { text: "没有名字" }, null, { name: 123 }] });
  eq(p3.untouched.length, 1, "没有合法 name 的项被跳过");

  const p4 = planOverrides({ overrides: {}, globalSections: [{ name: "a", text: undefined }] });
  eq(p4.untouched[0].original, "", "text 不是字符串 → 当空处理");
}

// ══ 13. 摘要文案 ══════════════════════════════════════════════════════════
{
  const plan = planOverrides({
    overrides: {
      a: makeOverride({ action: "replace", text: "改", original: "甲" }),
      b: makeOverride({ action: "replace", text: "改", original: "旧" }),
      zzz: makeOverride({ action: "disable", text: "", original: "没了" }),
    },
    globalSections: global(["a", "甲"], ["b", "乙"], ["c", "丙"], ["d", "丁"]),
  });
  const s = summarizePlan(plan);
  ok(s.includes("生效 2"), "摘要含生效数（含漂移的那段）");
  ok(s.includes("官方已更新 1"), "摘要含漂移数");
  ok(s.includes("已失效 1"), "摘要含失效数");
  ok(s.includes("未改动 2"), "摘要含未改动数");
}

// ══ 14. **一条完整的「官方演进」时间线** ═════════════════════════════════
{
  // ── 第 0 天：用户改了一段、关了一段 ────────────────────────────────────
  let g = global(
    ["harness:identity", "你是 DSH，一个编程助手。"],
    ["tool:bash", "bash 用法说明 v1"],
    ["tool:grep", "grep 用法说明 v1"],
  );
  const overrides = {
    "harness:identity": makeOverride({ action: "replace", text: "你是我的私人助手，说话简短。", original: "你是 DSH，一个编程助手。" }),
    "tool:bash": makeOverride({ action: "disable", text: "", original: "bash 用法说明 v1" }),
  };

  let plan = planOverrides({ overrides, globalSections: g });
  eq(plan.apply.length, 2, "第 0 天：两段都生效");
  eq(plan.drifted.length, 0, "第 0 天：没有漂移");

  // ── 第 30 天：官方新增 tool:edit，并改动了 harness:identity 的正文 ───────
  g = global(
    ["harness:identity", "你是 DSH，一个**会思考的**编程助手。"],
    ["tool:bash", "bash 用法说明 v1"],
    ["tool:grep", "grep 用法说明 v1"],
    ["tool:edit", "edit 用法说明（官方新增）"],
  );
  plan = planOverrides({ overrides, globalSections: g });
  eq(plan.apply.length, 2, "第 30 天：**两段都还生效**（漂移不拦着）");
  eq(plan.drifted.map((r) => r.name), ["harness:identity"], "第 30 天：改动过的那段标为漂移");
  eq(plan.untouched.map((r) => r.name).sort(), ["tool:edit", "tool:grep"], "第 30 天：新增的 edit 自动出现");

  const asm = assemblyOf(["harness:identity", "你是 DSH，一个**会思考的**编程助手。"], ["tool:bash", "bash 用法说明 v1"], ["tool:edit", "edit 用法说明（官方新增）"]);
  applyOverridesToAssembly(asm, plan);
  eq(asm.sections[0].text, "你是我的私人助手，说话简短。", "第 30 天：用户的 identity 改写照旧生效");
  eq(asm.sections[1].text, "", "第 30 天：bash 仍是关掉状态");
  eq(asm.sections[2].text, "edit 用法说明（官方新增）", "第 30 天：新增段落原样进提示词");

  // ── 第 60 天：官方把 tool:grep 改名成 tool:search ──────────────────────
  g = global(
    ["harness:identity", "你是 DSH，一个会思考的编程助手。"],
    ["tool:bash", "bash 用法说明 v1"],
    ["tool:search", "search 用法说明（原 grep）"],
  );
  plan = planOverrides({ overrides, globalSections: g });
  eq(plan.apply.length, 2, "第 60 天：还是两段生效");
  eq(plan.untouched.map((r) => r.name).sort(), ["tool:search"], "第 60 天：改名后的 search 是未改动");
  eq(plan.stale.length, 0, "第 60 天：grep 改名不产生失效项 —— 用户从没改过它");

  // ── 第 90 天：用户点掉漂移提醒（表示"我知道官方改了，继续用我的"）──────
  overrides["harness:identity"].acceptedDrift = true;
  plan = planOverrides({ overrides, globalSections: g });
  eq(plan.apply[0].driftAcknowledged, true, "第 90 天：漂移提醒已点掉");
  eq(plan.apply.length, 2, "第 90 天：两段仍然生效");
}

// ══ 15. **两层合并：全局默认 ← 会话层盖住** ════════════════════════════════
//
// 改写分两层，跟注入的两层对齐：
//   sectionOverrides        全局默认（所有会话都用）
//   sessionSectionOverrides 按会话的（**盖住全局同名的那条**）
//
// ⚠️ 关键是**按段落名合并，不是整表替换**。整表替换的话，「全局设个身份 +
//    某一个会话额外关掉一个工具说明」这种常见用法就得把全局那几条抄一遍，
//    以后改全局还要挨个同步 —— 迟早漏。
{
  const g = {
    "harness:identity": makeOverride({ action: "replace", text: "全局身份", original: "官方身份" }),
    "tool:bash": makeOverride({ action: "disable", text: "", original: "官方 bash" }),
  };
  const s = {
    "harness:identity": makeOverride({ action: "replace", text: "这个会话的身份", original: "官方身份" }),
  };

  const merged = resolveOverrides(g, s);
  eq(merged["harness:identity"].text, "这个会话的身份", "**同名时会话层赢**");
  eq(merged["tool:bash"].action, "disable", "**只有会话层没有的那条，全局的留着**");
  eq(Object.keys(merged).length, 2, "合并后是两条，不是一条（没被整表替换）");

  // 没有会话层时，合并结果就是全局那份
  eq(Object.keys(resolveOverrides(g, undefined)).sort(), ["harness:identity", "tool:bash"], "无会话层 → 全是全局的");
  eq(Object.keys(resolveOverrides(g, {})).length, 2, "空会话层也一样");

  // 只有会话层时也能用
  eq(Object.keys(resolveOverrides({}, s)).join(), "harness:identity", "空全局 + 有会话层");

  // 脏数据不许炸
  eq(resolveOverrides(null, null), {}, "null 输入不炸");
  eq(resolveOverrides(undefined, undefined), {}, "undefined 输入不炸");
  eq(resolveOverrides([1], "x"), {}, "非对象输入不炸");
  // normalize 会丢掉非法记录
  eq(Object.keys(resolveOverrides({ a: { action: "乱写" } }, { b: { action: "disable" } })).join(), "b", "非法记录被丢掉");

  // 合并后的表能直接喂给 planOverrides
  const plan = planOverrides({
    overrides: merged,
    globalSections: global(
      ["harness:identity", "官方身份"],
      ["tool:bash", "官方 bash"],
    ),
  });
  eq(plan.apply.map((r) => r.name).sort(), ["harness:identity", "tool:bash"], "合并表能正常参与判定");
  eq(plan.drifted.length, 0, "两边 hash 都对得上，没有误报漂移");
}
done();
