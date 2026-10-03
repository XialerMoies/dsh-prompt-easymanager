// 预设规范模型回归：selection 是唯一持久化的段落数据源。
import { createSuite } from "./lib/test-harness.mjs";
import { capturePreset, normalizePreset, presetSignature, summarizePreset } from "./lib/presets.mjs";

const { ok, eq, done } = createSuite("预设规范模型测试");

const legacy = normalizePreset({
  name: "旧配置",
  prompts: ["a"],
  sections: {
    "harness:identity": { action: "replace", text: "新身份" },
    "tool:bash": { action: "disable", text: "" },
  },
});
eq(legacy.selection.listed, ["harness:identity"], "旧 replace 迁移到 selection.listed");
eq(legacy.selection.excluded, ["tool:bash"], "旧 disable 迁移到 selection.excluded");
ok(!Object.prototype.propertyIsEnumerable.call(legacy, "sections"), "兼容 sections 视图不参与持久化");
ok(!Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(legacy)), "sections"), "JSON 顶层不再保存第二份 sections");
eq(Object.keys(legacy.sections), ["tool:bash", "harness:identity"], "旧调用方仍能读取兼容视图");

const captured = capturePreset({
  name: "当前配置",
  prompts: ["a"],
  selection: legacy.selection,
});
eq(
  presetSignature(captured),
  presetSignature({ prompts: ["a"], selection: legacy.selection }),
  "签名只取实际内容，不取保存时间和原文基准",
);
eq(summarizePreset(captured), "改 2 段 · 自设 1 条", "摘要来自唯一 selection");

done();
