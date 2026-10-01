// 快速预设：纯逻辑测试
//
// 运行：node scripts/presets_test.mjs

import {
  presetId,
  normalizePreset,
  normalizePresets,
  capturePreset,
  planApply,
  presetSignature,
  matchPreset,
  summarizePreset,
  presetForSession,
  presetLabel,
  normalizeGlobal,
} from "./lib/presets.mjs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("快速预设逻辑测试");

const ov = (action, text) => ({ action, text: text ?? "", original: "", originalHash: "", savedAt: "t", acceptedDrift: false });

// ══ 1. id 生成 ═══════════════════════════════════════════════════════════
{
  eq(presetId("写代码"), "写代码", "**中文名原样保留当 id**（转拼音反而不好认）");
  eq(presetId("  写 代码  "), "写-代码", "空格换成连字符");
  eq(presetId("a/b:c*d"), "a-b-c-d", "文件系统敏感字符换掉");
  eq(presetId(""), "preset", "空名字有兜底");
  eq(presetId(null), "preset", "null 有兜底");
  eq(presetId("x".repeat(100)).length, 60, "超长截断到 60");

  // 冲突时加序号
  eq(presetId("写代码", ["写代码"]), "写代码-2", "冲突时加 -2");
  eq(presetId("写代码", ["写代码", "写代码-2"]), "写代码-3", "再加 -3");
  eq(presetId("写代码", ["别的"]), "写代码", "没冲突就不加");

  // 前导/尾随连字符去掉
  eq(presetId("-x-"), "x", "首尾连字符去掉");
}

// ══ 2. 校验 ══════════════════════════════════════════════════════════════
{
  ok(normalizePreset(null) === null, "null 丢掉");
  ok(normalizePreset({}) === null, "缺 name 丢掉");
  ok(normalizePreset({ name: "   " }) === null, "**只有空白的名字也算缺**");

  const p = normalizePreset({ name: "  写代码  " });
  eq(p.name, "写代码", "名字去空白");
  eq(p.prompts, [], "prompts 默认空数组");
  eq(p.sections, {}, "sections 默认空对象");

  // ⚠️ 这里原来有三条 `scope` 断言，**已删** —— 预设不再带作用范围了
  //    （同一预设两层都能用，见 presets.mjs 文件头）。改成反向盯住：
  eq(
    Object.prototype.hasOwnProperty.call(normalizePreset({ name: "x", scope: "session" }), "scope"),
    false,
    "**预设不再带 scope**（老数据里那个字段读的时候直接丢掉）",
  );
  eq(normalizePreset({ name: "x", prompts: ["a", "a", "b"] }).prompts, ["a", "b"], "**prompts 去重**");
  eq(normalizePreset({ name: "x", prompts: ["a", "", 1, null] }).prompts, ["a"], "prompts 里的非法值丢掉");
  eq(normalizePreset({ name: "x", prompts: "a" }).prompts, [], "prompts 不是数组 → 空");
  eq(normalizePreset({ name: "x", sections: [] }).sections, {}, "sections 是数组 → 空");

  const table = normalizePresets({ a: { name: "甲" }, b: { name: "" }, c: null, "": { name: "x" } });
  eq(Object.keys(table), ["a"], "坏记录丢掉，好的留下");
  eq(normalizePresets(null), {}, "null → 空表");
  eq(normalizePresets([1]), {}, "数组 → 空表");
}

// ══ 3. 采集快照 ══════════════════════════════════════════════════════════
{
  const p = capturePreset({
    name: "写代码",
    prompts: ["a", "b", "a"],
    sections: { "harness:identity": ov("replace", "我的身份") },
    note: "给编码会话用",
    now: "2026-01-01T00:00:00.000Z",
  });
  eq(p.name, "写代码", "名字");
  eq(p.prompts, ["a", "b"], "去重");
  eq(Object.keys(p.sections), ["harness:identity"], "段落带上");
  eq(p.createdAt, "2026-01-01T00:00:00.000Z", "时间戳可注入（测试友好）");
  ok(p.createdAt.length > 0, "默认也会生成时间戳");

  // ⚠️ 快照要**深一层**：外部改原对象不该影响已存的预设
  const src = { "a": ov("replace", "原") };
  const p2 = capturePreset({ name: "x", prompts: [], sections: src });
  src["a"].text = "改了";
  eq(p2.sections["a"].text, "原", "**快照跟源对象解耦**（不会跟着变）");

  const p3 = capturePreset({ name: "x", prompts: null, sections: null });
  eq([p3.prompts, p3.sections], [[], {}], "null 输入不炸");
}

// ══ 4. 应用：**是覆盖不是合并** ══════════════════════════════════════════
//
// 这条是语义上的关键决定，见 presets.mjs 文件头。
{
  const preset = normalizePreset({
    name: "写代码",
    prompts: ["a", "b"],
    sections: { s1: ov("disable", "") },
  });
  const plan = planApply(preset);
  eq(plan.prompts, ["a", "b"], "提示词整份给出");
  eq(Object.keys(plan.sections), ["s1"], "段落整份给出");
  eq(
    Object.prototype.hasOwnProperty.call(plan, "scope"),
    false,
    "**planApply 不再返回 scope**（写去哪层由调用方决定）",
  );

  // 空预设 → 应用后是「什么都没有」，不是「保持原样」
  const empty = planApply(normalizePreset({ name: "空" }));
  eq([empty.prompts, empty.sections], [[], {}], "**空预设应用后是清空，不是不动**（覆盖语义）");

  eq(planApply(null), { prompts: [], sections: {} }, "null 输入给个安全默认");
  eq(planApply(undefined).sections, {}, "undefined 不炸");

  // 返回的是副本：改它不该影响原预设
  plan.prompts.push("c");
  eq(preset.prompts, ["a", "b"], "**返回的是副本**（改它不影响原预设）");
}

// ══ 5. 签名与匹配：应用完要能看出「现在在哪个预设上」 ════════════════════
{
  const A = { prompts: ["a", "b"], sections: { s1: ov("replace", "X") } };
  const A2 = { prompts: ["b", "a"], sections: { s1: ov("replace", "X") } };
  eq(presetSignature(A), presetSignature(A2), "**顺序不同算同一个**（提示词集合相同）");

  // 顺序不同也该匹配上 —— 提示词集合语义上无序
  const presets = {
    写代码: normalizePreset({ name: "写代码", prompts: ["a", "b"], sections: { s1: ov("replace", "X") } }),
    写作: normalizePreset({ name: "写作", prompts: ["c"], sections: {} }),
  };
  eq(matchPreset(A2, presets)?.id, "写代码", "能匹配到「写代码」");
  eq(matchPreset({ prompts: ["z"], sections: {} }, presets), null, "对不上就返回 null（界面显示「已改动」）");
  eq(matchPreset(A, null), null, "没有预设时不炸");
  eq(matchPreset(A, {}), null, "空预设表返回 null");

  // 段落内容不同就不该算同一个预设
  const B = { prompts: ["a", "b"], sections: { s1: ov("replace", "Y") } };
  eq(matchPreset(B, presets), null, "段落文本不同 → 不是同一个预设");
  // disable 与 replace 空串语义相同（都让这段不出现）—— 但签名按 action 区分，钉住行为
  const C = { prompts: ["a", "b"], sections: { s1: ov("disable", "") } };
  eq(matchPreset(C, presets), null, "disable 与 replace 不同（签名按 action 区分）");

  eq(presetSignature(null), presetSignature({ prompts: [], sections: {} }), "null 等价于空");
  eq(presetSignature({ prompts: ["a"], sections: { s1: {} } }), presetSignature({ prompts: ["a"], sections: { s1: ov("replace", "") } }), "缺字段按 replace 空串算");
}

// ══ 6. 摘要 ══════════════════════════════════════════════════════════════
{
  const s = summarizePreset(
    normalizePreset({ name: "x", prompts: ["a", "b"], sections: { s1: ov("disable", "") } }),
  );
  ok(s.includes("自设 2 条"), "含提示词数");
  ok(s.includes("改 1 段"), "含改了几段");
  // ⚠️ 这里原来还有「含作用范围」和「空预设也说明范围」两条 —— 预设不再带 scope，删了。
  ok(!s.includes("层"), "**摘要不再提作用范围**（预设不分层了）");
  const g = summarizePreset(normalizePreset({ name: "x" }));
  ok(!g.includes("自设"), "空预设不提提示词（不啰嗦）");
  eq(g, "", "**两样都空 → 摘要就是空串**（不硬凑一句话）");
}

// ══ 7. 会话该用哪个预设 ══════════════════════════════════════════════════
//
// 这是新模型的核心：预设是唯一载体，会话要么选一条、要么跟随全局、要么什么都不挂。
{
  const P = {
    A: normalizePreset({ name: "写代码", prompts: ["p1"] }),
    B: normalizePreset({ name: "翻译", sections: { s1: ov("disable", "") } }),
  };
  const off = { enabled: false, presetId: null };
  const onA = { enabled: true, presetId: "A" };

  const r1 = presetForSession({ sessionId: "s1", assignments: { s1: "B" }, global: onA, presets: P });
  eq(r1.id, "B", "**会话自己选了就用它**（压过全局）");
  eq(r1.source, "session", "来源是会话层");

  const r2 = presetForSession({ sessionId: "s2", assignments: {}, global: onA, presets: P });
  eq(r2.id, "A", "没记录 + 全局开着 → 跟随全局");
  eq(r2.source, "global", "来源是全局层");

  const r3 = presetForSession({ sessionId: "s3", assignments: {}, global: off, presets: P });
  eq(r3.id, null, "**全局注入关掉 → 谁都跟随不了全局**（用户选的 A 方案）");
  eq(r3.source, "none", "来源是 none");

  // ⚠️ 上面那条用例的 presetId 是 null，光看它**分不出**
  //    「因为开关关着」还是「因为没指预设」—— 所以再补一条：
  //    全局**指了**预设、但开关关着 → 仍然不许跟随。
  const r3b = presetForSession({
    sessionId: "s3b",
    assignments: {},
    global: { enabled: false, presetId: "A" },
    presets: P,
  });
  eq(r3b.id, null, "**开关关着时，就算指了预设也不跟随**（这才是开关的作用）");
  eq(r3b.source, "none", "来源是 none");

  // ⚠️ 关键：显式「什么都不挂」不许再退回去跟随全局
  const r4 = presetForSession({ sessionId: "s4", assignments: { s4: null }, global: onA, presets: P });
  eq(r4.id, null, "**显式什么都不挂 → 不许跟随全局**");
  eq(r4.source, "none", "来源是 none，不是 global");

  // 会话指的预设被删了 → 退回跟随全局（不是炸）
  const r5 = presetForSession({ sessionId: "s5", assignments: { s5: "没了" }, global: onA, presets: P });
  eq(r5.id, "A", "会话指的预设不存在 → 退回跟随全局");

  // 全局指的预设被删了
  const r6 = presetForSession({ sessionId: "s6", assignments: {}, global: { enabled: true, presetId: "没了" }, presets: P });
  eq(r6.id, null, "全局指的预设不存在 → 什么都不挂");

  // 脏输入不炸
  eq(presetForSession({}).source, "none", "空参数不炸");
  eq(presetForSession({ sessionId: "x", assignments: null, global: null, presets: null }).id, null, "null 不炸");
}

// ══ 8. 标签：用户那四个场景 ══════════════════════════════════════════════
{
  const ov1 = ov("replace", "我的身份");

  // ① 纯原生
  eq(presetLabel(normalizePreset({ name: "空" })), "系统提示词", "两样都空 → 「系统提示词」");

  // ② 只改系统提示词
  eq(
    presetLabel(normalizePreset({ name: "改名", sections: { s1: ov1 } })),
    "系统提示词 · 改",
    "**只改系统提示词 → 不显示预设名**，显示「系统提示词 · 改」",
  );

  // ③ 只用个人提示词
  eq(
    presetLabel(normalizePreset({ name: "写代码", prompts: ["p1"] })),
    "写代码",
    "有个人提示词 → **显示预设名**（即使没改系统提示词）",
  );

  // ④ 两样都有
  eq(
    presetLabel(normalizePreset({ name: "写代码", prompts: ["p1"], sections: { s1: ov1 } })),
    "写代码",
    "两样都有 → 显示预设名",
  );

  eq(presetLabel(null), "系统提示词", "null → 「系统提示词」");
  eq(presetLabel(undefined), "系统提示词", "undefined → 「系统提示词」");
  eq(presetLabel({ prompts: ["a"], name: "" }), "（无名预设）", "有提示词但没名字 → 兜底文案");
}

// ══ 9. 全局配置归一化（含老数据迁移）════════════════════════════════════
{
  eq(normalizeGlobal({ enabled: true, presetId: "A" }), { enabled: true, presetId: "A" }, "正常读");
  eq(normalizeGlobal({ enabled: "是", presetId: "" }), { enabled: false, presetId: null }, "脏值收紧");
  eq(normalizeGlobal(null), { enabled: false, presetId: null }, "null → 全关");

  // ⚠️ 老数据：那时候是「开关 + defaults[] + sectionOverrides」，没有 global 这个键。
  //    迁移时尽量认出它对应哪条已存预设。
  const P = {
    A: normalizePreset({ name: "写代码", prompts: ["p1"] }),
  };
  const migrated = normalizeGlobal(undefined, {
    switchEnabled: true,
    defaults: ["p1"],
    sectionOverrides: {},
    presets: P,
  });
  eq(migrated.enabled, true, "**老开关开着 → 新开关也开着**");
  eq(migrated.presetId, "A", "**认出老默认配置对应哪条预设**");

  const noMatch = normalizeGlobal(undefined, {
    switchEnabled: true,
    defaults: ["完全没存过的"],
    sectionOverrides: {},
    presets: P,
  });
  eq(noMatch.enabled, true, "认不出也保持开着");
  eq(noMatch.presetId, null, "认不出就先不指向任何预设（让用户自己选）");

  const wasOff = normalizeGlobal(undefined, { switchEnabled: false, defaults: ["p1"], sectionOverrides: {}, presets: P });
  eq(wasOff.enabled, false, "老开关关着 → 新开关也关着");

  // ⚠️ **这条是实际踩到的**：老版本的判据是 `parsed?.enabled !== false`，
  //    也就是**不写这个字段 = 开着**。我第一版把 `switchEnabled` 直接传成
  //    `parsed?.enabled`（undefined），于是升级后全局注入**凭空被关掉** ——
  //    宿主集成测试里 4 条「来自默认的注入被清空」当场红。
  //    调用方必须传 `parsed?.enabled !== false` 的结果。
  eq(
    normalizeGlobal(undefined, {
      switchEnabled: true,
      defaults: [],
      sectionOverrides: {},
      presets: {},
    }).enabled,
    true,
    "**老数据缺 enabled 字段 = 开着**（升级不许把全局注入关掉）",
  );
}

done();
