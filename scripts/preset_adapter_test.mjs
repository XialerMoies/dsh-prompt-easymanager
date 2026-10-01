// 「预设的世界」→「注入器的世界」翻译层测试
//
// ⚠️ 这一层是这次改动**最危险**的地方：两个世界用不同的东西编码同一件事
//    （状态文件存预设 id，注入器存 prompt id 数组）。翻译错了的表现是
//    「选了预设但注入的是别的」或者「选了原生但还吃全局」—— 都不报错。
//
// 运行：node scripts/preset_adapter_test.mjs

import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("预设翻译层测试");

// ⚠️ 从 index.js 里抠出这个函数来测。
//    index.js 顶层会读 DSH_HOME、建提示词库，不能直接 import，
//    所以这里把源码里的那个函数**原样 eval 出来** —— 这样测的就是真身，
//    不是抄一份（抄一份就会跟真身漂移，那这种测试没意义）。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "index.js"), "utf8");
const m = SRC.match(/function toInjectorState\(state\) \{[\s\S]*?\n\}/);
if (!m) {
  console.error("❌ 在 index.js 里找不到 toInjectorState");
  process.exit(1);
}
// eslint-disable-next-line no-new-func
const toInjectorState = new Function(`${m[0]}; return toInjectorState;`)();

const P = {
  写代码: { name: "写代码", prompts: ["格式契约", "编码规范"], sections: {} },
  只改段落: { name: "只改段落", prompts: [], sections: { "harness:identity": { action: "replace", text: "x" } } },
};

// ══ 1. 没记录 → 走 defaults（跟随全局）════════════════════════════════════
{
  const out = toInjectorState({
    global: { enabled: true, presetId: "写代码" },
    assignments: {},
    presets: P,
  });
  eq(out.defaults, ["格式契约", "编码规范"], "全局预设的提示词进 defaults");
  eq(out.assignments, {}, "**没有记录的会话不许设 explicit**（设了就不跟随全局了）");
}

// ══ 2. 会话自己选了 → explicit，且不吃 defaults ═══════════════════════════
{
  const out = toInjectorState({
    global: { enabled: true, presetId: "写代码" },
    assignments: { s1: "只改段落" },
    presets: P,
  });
  eq(out.assignments.s1, [], "只改段落那条没有个人提示词 → 空数组");
  ok("s1" in out.assignments, "**显式选了就要设 explicit**（哪怕是空的）");
}

// ══ 3. 会话选了「什么都不挂」→ 空数组，不是删掉 ═══════════════════════════
{
  const out = toInjectorState({
    global: { enabled: true, presetId: "写代码" },
    assignments: { s2: null },
    presets: P,
  });
  ok("s2" in out.assignments, "**显式什么都不挂必须留一条记录**");
  eq(out.assignments.s2, [], "值就是空数组（注入器认这个为显式不注入）");
  // ⚠️ 这条是核心：不能因为「值是 null」就当成「没记录」而跳过 ——
  //    那样这个会话会退回去吃全局，跟用户的意图相反。
  eq(Object.keys(out.assignments).length, 1, "记录数要是 1（漏了就退回跟随全局了）");
}

// ══ 4. 全局关掉 → defaults 空，但**会话自己的选择照旧** ════════════════════
{
  const out = toInjectorState({
    global: { enabled: false, presetId: "写代码" },
    assignments: { s3: "写代码" },
    presets: P,
  });
  eq(out.defaults, [], "**全局关掉 → defaults 清空**（新会话什么都不挂）");
  eq(out.assignments.s3, ["格式契约", "编码规范"], "**但用户自己选的会话照旧生效**");
}

// ══ 5. 全局开着但没指预设 ══════════════════════════════════════════════════
{
  const out = toInjectorState({ global: { enabled: true, presetId: null }, assignments: {}, presets: P });
  eq(out.defaults, [], "开着但没指预设 → 没有默认可给");
}

// ══ 6. 指的预设被删了 ══════════════════════════════════════════════════════
{
  const a = toInjectorState({ global: { enabled: true, presetId: "没了" }, assignments: {}, presets: P });
  eq(a.defaults, [], "全局指的预设不存在 → 空");

  const b = toInjectorState({ global: { enabled: false, presetId: null }, assignments: { s4: "没了" }, presets: P });
eq(Object.keys(b.assignments).length, 0, "会话指的预设不存在 → **当没记录**（退回跟随全局，而不是不注入）");
}

// ══ 7. 脏输入不炸 ══════════════════════════════════════════════════════════
//
// ⚠️ 这里要比**键**，不能直接 `eq(x, {})` —— 那是拿两个不同的对象比引用，
//    永远不等。第一版就是这么写的，于是三条假红，白查了一轮。
{
  const out = toInjectorState({});
  eq(out.defaults, [], "空状态 → 空 defaults");
  eq(Object.keys(out.assignments).length, 0, "空状态 → 空 assignments");

  const n = toInjectorState({ assignments: { s5: undefined }, presets: P, global: {} });
  eq(Object.keys(n.assignments).length, 0, "值是 undefined → 当没记录");

  const weird = toInjectorState({ assignments: { "": "写代码", s6: 123 }, presets: P, global: {} });
  eq(Object.keys(weird.assignments).length, 0, "空 sid / 非字符串值 → 丢掉");
}

done();
