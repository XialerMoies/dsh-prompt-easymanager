import assert from "node:assert/strict";
import { parsePresetBundle, serializePresetBundle } from "./lib/preset-transfer.mjs";

const preset = { name: "编码预设", note: "demo", prompts: ["p1"], selection: { listed: ["harness:identity"], excluded: [], sections: {}, known: [] } };
const markdown = serializePresetBundle({
  preset,
  prompts: [{ id: "p1", name: "规范", description: "说明", category: "domain", mode: "append", order: 950, text: "# 标题\n```js\n---\n```" }],
  sectionOverrides: { "harness:identity": { text: "改写正文", original: "原文", originalHash: "abc" } },
});
const roundTrip = parsePresetBundle(markdown);
assert.equal(roundTrip.format, "dsh-prompt-preset");
assert.equal(roundTrip.preset.prompts[0].text, "# 标题\n```js\n---\n```");
assert.equal(roundTrip.preset.sectionOverrides["harness:identity"].text, "改写正文");
assert.throws(() => parsePresetBundle("# nope"), /不是 dsh/);
assert.throws(() => parsePresetBundle(serializePresetBundle({
  preset: { name: "重复", prompts: [], selection: {} },
}).replace('"prompts": []', '"prompts": [{"id":"x","text":"a"},{"id":"x","text":"b"}]')), /id 重复/);
assert.throws(() => parsePresetBundle(serializePresetBundle({
  preset: { name: "坏段落", prompts: [], selection: {} },
}).replace('"sectionOverrides": {}', '"sectionOverrides": {"x": null}')), /格式不正确/);
console.log("预设导入导出测试：6 通过, 0 失败");
