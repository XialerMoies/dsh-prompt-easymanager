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
  eq(p.scope, "global", "scope 默认 global");
  eq(p.prompts, [], "prompts 默认空数组");
  eq(p.sections, {}, "sections 默认空对象");

  eq(normalizePreset({ name: "x", scope: "session" }).scope, "session", "scope 认 session");
  eq(normalizePreset({ name: "x", scope: "乱写" }).scope, "global", "非法 scope 退回 global");
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
    scope: "session",
    prompts: ["a", "b", "a"],
    sections: { "harness:identity": ov("replace", "我的身份") },
    note: "给编码会话用",
    now: "2026-01-01T00:00:00.000Z",
  });
  eq(p.name, "写代码", "名字");
  eq(p.scope, "session", "scope");
  eq(p.prompts, ["a", "b"], "去重");
  eq(Object.keys(p.sections), ["harness:identity"], "段落带上");
  eq(p.createdAt, "2026-01-01T00:00:00.000Z", "时间戳可注入（测试友好）");
  ok(p.createdAt.length > 0, "默认也会生成时间戳");

  // ⚠️ 快照要**深一层**：外部改原对象不该影响已存的预设
  const src = { "a": ov("replace", "原") };
  const p2 = capturePreset({ name: "x", scope: "global", prompts: [], sections: src });
  src["a"].text = "改了";
  eq(p2.sections["a"].text, "原", "**快照跟源对象解耦**（不会跟着变）");

  const p3 = capturePreset({ name: "x", scope: "global", prompts: null, sections: null });
  eq([p3.prompts, p3.sections], [[], {}], "null 输入不炸");
}

// ══ 4. 应用：**是覆盖不是合并** ══════════════════════════════════════════
//
// 这条是语义上的关键决定，见 presets.mjs 文件头。
{
  const preset = normalizePreset({
    name: "写代码",
    scope: "session",
    prompts: ["a", "b"],
    sections: { s1: ov("disable", "") },
  });
  const plan = planApply(preset);
  eq(plan.scope, "session", "写回会话层");
  eq(plan.prompts, ["a", "b"], "提示词整份给出");
  eq(Object.keys(plan.sections), ["s1"], "段落整份给出");

  // 空预设 → 应用后是「什么都没有」，不是「保持原样」
  const empty = planApply(normalizePreset({ name: "空" }));
  eq([empty.prompts, empty.sections], [[], {}], "**空预设应用后是清空，不是不动**（覆盖语义）");

  eq(planApply(null), { prompts: [], sections: {}, scope: "global" }, "null 输入给个安全默认");
  eq(planApply(undefined).scope, "global", "undefined 不炸");

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
    normalizePreset({ name: "x", scope: "session", prompts: ["a", "b"], sections: { s1: ov("disable", "") } }),
  );
  ok(s.includes("自设 2 条"), "含提示词数");
  ok(s.includes("改写 1 段"), "含改写数");
  ok(s.includes("会话层"), "含作用范围");
  const g = summarizePreset(normalizePreset({ name: "x" }));
  ok(g.includes("全局层"), "空预设也说明范围");
  ok(!g.includes("自设"), "空预设不提提示词（不啰嗦）");
}

done();
