// 注入核心测试：多条挂载、全局默认、未知 id、子代理过滤、预览、幽灵引用清理
// 运行：node scripts/session_injection_test.mjs
import { createSessionInjector, sessionKey } from "./lib/session-injection.mjs";
import { createPromptLibrary } from "./lib/prompt-library.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push(label);
    console.error("  ❌ " + label);
  }
}
function eq(a, b, label) {
  ok(
    JSON.stringify(a) === JSON.stringify(b),
    label + "（实际 " + JSON.stringify(a) + "，期望 " + JSON.stringify(b) + "）",
  );
}

// ── 测试用提示词库 ──────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "pm-inj-"));
const pd = join(dir, "prompts");
mkdirSync(pd, { recursive: true });
writeFileSync(join(pd, "append.md"), "追加正文");
writeFileSync(
  join(pd, "catalog.json"),
  JSON.stringify({
    prompts: [
      { id: "none", name: "不注入", mode: "none" },
      { id: "a", name: "甲", mode: "append", order: 100, file: "append.md" },
      { id: "b", name: "乙", mode: "append", order: 200, inline: "乙正文" },
      { id: "c", name: "丙", mode: "append", order: 2900, inline: "丙正文" },
      { id: "d", name: "丁", mode: "append", order: 50, inline: "丁正文" },
      // v0.2.2 起 replace 模式已删除 —— 这条应当**加载失败并给出迁移提示**
      { id: "old-replace", name: "老的替换条目", mode: "replace", order: 10, inline: "替换正文" },
    ],
  }),
);
const library = createPromptLibrary({ catalogPath: join(pd, "catalog.json"), baseDir: pd });
const resolvePrompt = (id) => library.resolve(id);

// ── 假 agent ────────────────────────────────────────────────────────────────
function makeAgent(
  id,
  { origin = null, delegationDepth = null, parentSession = null, assemble, events = null } = {},
) {
  const sections = [];
  const header = { version: 1 };
  if (origin !== null) header.origin = origin;
  if (delegationDepth !== null) header.delegationDepth = delegationDepth;
  if (parentSession !== null) header.parentSession = parentSession;

  const scope = {
    systemPrompt: {
      section(def) {
        sections.push(def);
        return () => {
          const i = sections.indexOf(def);
          if (i >= 0) sections.splice(i, 1);
        };
      },
      assemble:
        assemble ??
        (async () => ({
          sections: sections.map((s) => ({
            name: s.name,
            text: s.text,
            complete: s.complete === true,
          })),
          contexts: [],
          tools: [],
          variables: {},
        })),
    },
  };

  const agent = {
    id,
    session: { id, header },
    ctx: {
      inject(keys, cb) {
        ok(Array.isArray(keys) && keys.includes("systemPrompt"), "inject 请求了 systemPrompt 依赖");
        return cb(scope);
      },
    },
  };
  if (assemble) agent.ctx.systemPrompt = scope.systemPrompt;
  if (events !== null) agent.session.snapshotEvents = () => events;
  return { agent, sections, sectionNames: () => sections.map((s) => s.name).sort() };
}

function freshInjector(extra = {}) {
  const saved = [];
  const inj = createSessionInjector({
    resolvePrompt,
    saveState: (s) => saved.push(s),
    topLevelOnly: true,
    ...extra,
  });
  return { inj, saved };
}

/**
 * 造一个「库里的条目会消失」的注入器 —— 用来测 pruneMissing。
 * 真实路径是 library.reload() 后条目没了，效果等价。
 * @param {string[]} gone 一开始就不存在的 id
 */
function injectorWithMissing(gone = []) {
  const missing = new Set(gone);
  const saved = [];
  const inj = createSessionInjector({
    resolvePrompt: (id) => (missing.has(id) ? undefined : resolvePrompt(id)),
    saveState: (s) => saved.push(s),
    topLevelOnly: true,
  });
  return {
    inj,
    saved,
    /** 让某个 id 从库里"消失" */
    vanish(id) {
      missing.add(id);
    },
    /** 让它回来 */
    restore(id) {
      missing.delete(id);
    },
  };
}

const S = "session-aaaa-1111";

// ── 1. 默认状态：不注入 ─────────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  eq(inj.promptsOf(S), [], "没设默认时生效列表为空");
  eq(h.sections.length, 0, "不注册任何 section");
  eq(inj.stateOf(S).source, "default", "来源是 default");
}

// ── 2. 挂一条 ───────────────────────────────────────────────────────────────
{
  const { inj, saved } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  const r = inj.assign(S, ["a"]);
  eq(r.ok, true, "分配成功");
  eq(r.outcome, "attached", "结论 attached");
  eq(r.source, "explicit", "来源是 explicit");
  eq(h.sections.length, 1, "注册 1 个 section");
  eq(h.sections[0].name, "prompt-manager:a", "section 名正确");
  eq(h.sections[0].order, 100, "order 来自条目");
  eq(h.sections[0].text, "追加正文", "正文正确");
  const last = saved[saved.length - 1];
  eq(last.version, 2, "持久化格式版本 2");
  eq(last.assignments[S], ["a"], "持久化内容是数组");
}

// ── 3. 一个会话挂多条（本次的重点）──────────────────────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  const r = inj.assign(S, ["a", "b", "c"]);
  eq(r.ok, true, "多条分配成功");
  eq(h.sections.length, 3, "注册了 3 个 section");
  eq(h.sectionNames(), ["prompt-manager:a", "prompt-manager:b", "prompt-manager:c"], "三条都在");
  const byName = new Map(h.sections.map((s) => [s.name, s.order]));
  eq(byName.get("prompt-manager:a"), 100, "a 的 order 是 100");
  eq(byName.get("prompt-manager:b"), 200, "b 的 order 是 200");
  eq(byName.get("prompt-manager:c"), 2900, "c 的 order 是 2900");
  eq(inj.stateOf(S).promptIds, ["a", "b", "c"], "生效列表正确");
}

// ── 4. 换一组：旧的必须全卸掉 ───────────────────────────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  inj.assign(S, ["a", "b", "c"]);
  eq(h.sections.length, 3, "换之前 3 条");
  inj.assign(S, ["b"]);
  eq(h.sections.length, 1, "换之后只剩 1 条（其余全卸）");
  eq(h.sections[0].name, "prompt-manager:b", "留下的是被选中的那条");
  inj.assign(S, ["a", "c"]);
  eq(h.sections.length, 2, "换成两条");
  eq(h.sectionNames(), ["prompt-manager:a", "prompt-manager:c"], "两条正确");
}

// ── 5. 替换模式已删除：任何组合都不再有"非法组合"这回事 ─────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  // 老的 replace 条目根本没进库（加载时就报错了），所以它是「未知 id」
  eq(resolvePrompt("old-replace"), undefined, "replace 条目没被加载进库");
  ok(
    library.errors().some((e) => e.includes("已移除的 replace")),
    "库的错误里给出了 replace 的迁移提示",
  );
  const r = inj.assign(S, ["old-replace"]);
  eq(r.ok, false, "挂一个已删除的模式 → 被拒");
  eq(r.outcome, "unknown-prompt", "结论是 unknown-prompt");
  eq(h.sections.length, 0, "被拒时一个 section 都不挂");
}

// ── 6. 任意多条 append 都能共存（以前有组合限制，现在没有）──────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  const r = inj.assign(S, ["a", "b", "c", "d"]);
  eq(r.ok, true, "四条 append 一起挂没问题");
  eq(h.sections.length, 4, "四个 section");
  // 每条都不带 complete —— 替换模式删除后不再有独占行为
  ok(
    h.sections.every((s) => s.complete === undefined),
    "所有 section 都不带 complete（不再有独占语义）",
  );
}

// ── 7. 未知 id 混在合法 id 里：整组被拒，且不改状态 ─────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  const r = inj.assign(S, ["a", "根本不存在", "b"]);
  eq(r.ok, false, "含未知 id 时整组被拒");
  eq(r.outcome, "unknown-prompt", "结论是 unknown-prompt");
  ok(r.error.includes("根本不存在"), "错误里点名了未知 id");
  eq(h.sections.length, 0, "被拒时不挂任何一条");
}

// ── 8. 显式不注入（空数组）vs 清除指定（回落默认）──────────────────────────
{
  const { inj } = freshInjector();
  inj.setDefaults(["c"]);
  const hEmpty = makeAgent("session-e");
  inj.seedAgents([hEmpty.agent]);

  eq(hEmpty.sections.length, 1, "新会话自动用默认（全局默认生效）");
  eq(hEmpty.sections[0].name, "prompt-manager:c", "默认那条挂上了");

  inj.assign("session-e", []);
  eq(hEmpty.sections.length, 0, "显式空数组 → 一条都不挂");
  eq(inj.promptsOf("session-e"), [], "生效列表为空");
  eq(inj.stateOf("session-e").source, "explicit", "来源标记为 explicit（不是回落默认）");

  inj.assign("session-e", null);
  eq(hEmpty.sections.length, 1, "清除指定后回到默认");
  eq(inj.stateOf("session-e").source, "default", "来源回到 default");
}

// ── 9. 全局默认：改默认时，没有显式指定的会话要跟着变 ───────────────────────
{
  const { inj } = freshInjector();
  const hA = makeAgent("session-x1");
  const hB = makeAgent("session-x2");
  inj.seedAgents([hA.agent, hB.agent]);
  inj.assign("session-x2", ["a"]);

  const r = inj.setDefaults(["b", "c"]);
  eq(r.ok, true, "设置默认成功");
  eq(inj.getDefaults(), ["b", "c"], "默认已更新");
  eq(hA.sections.length, 2, "未指定的会话跟上了新默认");
  eq(hA.sectionNames(), ["prompt-manager:b", "prompt-manager:c"], "挂的是新的默认两条");
  eq(hB.sections.length, 1, "显式指定的会话**不**被默认覆盖");
  eq(hB.sections[0].name, "prompt-manager:a", "仍然是显式那一条");

  // 未知 id 不能进默认（否则每个新会话都记一条「挂不上」）
  const bad = inj.setDefaults(["b", "根本不存在的 id"]);
  eq(bad.ok, false, "含未知 id 的默认被拒");
  ok(bad.error.includes("根本不存在的 id"), "错误里点名了未知 id");
  eq(inj.getDefaults(), ["b", "c"], "被拒后默认不变");
}

// ── 10. 默认在 agent 创建时也要生效 ────────────────────────────────────────
{
  const { inj } = freshInjector();
  inj.setDefaults(["a"]);
  const h = makeAgent("session-late");
  inj.handleAgentCreated(h.agent);
  eq(h.sections.length, 1, "agent 创建时自动挂上默认");
  eq(h.sections[0].name, "prompt-manager:a", "挂的是默认那条");
}

// ── 11. 分配时 agent 没加载，之后补挂 ──────────────────────────────────────
{
  const { inj } = freshInjector();
  const r = inj.assign(S, ["a", "b"]);
  eq(r.outcome, "awaiting-agent", "agent 未加载时结论为 awaiting-agent");
  eq(r.promptIds, ["a", "b"], "分配仍被记住");
  const h = makeAgent(S);
  inj.handleAgentCreated(h.agent);
  eq(h.sections.length, 2, "agent 创建后两条一起补挂");
}

// ── 12. 子代理过滤 ──────────────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  inj.setDefaults(["a"]);
  const sub1 = makeAgent("session-sub-origin", { origin: "subagent" });
  const sub2 = makeAgent("session-sub-depth", { delegationDepth: 2 });
  const top1 = makeAgent("session-top-zero", { delegationDepth: 0 });
  const fork = makeAgent("session-fork", { delegationDepth: 0, parentSession: "session-parent" });
  inj.seedAgents([sub1.agent, sub2.agent, top1.agent, fork.agent]);

  eq(sub1.sections.length, 0, "origin=subagent 被排除");
  eq(sub2.sections.length, 0, "delegationDepth=2 被排除");
  eq(top1.sections.length, 1, "delegationDepth=0 的顶层会话正常（旧版正是在这写错）");
  eq(fork.sections.length, 1, "有 parentSession 但 depth=0 的 fork 会话仍注入");
}

// ── 13. session- 前缀规范化 ────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent("session-bbbb-2222");
  inj.seedAgents([h.agent]);
  inj.assign("bbbb-2222", ["a"]);
  eq(h.sections.length, 1, "不带前缀的 id 也能匹配到 agent");
  eq(inj.promptsOf("session-bbbb-2222"), ["a"], "反查也通");
  eq(sessionKey("session-bbbb-2222"), sessionKey("bbbb-2222"), "sessionKey 等价");
}

// ── 14. 持久化往返 + v1 兼容 ───────────────────────────────────────────────
{
  const { inj } = freshInjector();
  inj.restore({ version: 2, defaults: ["c"], assignments: { [S]: ["a", "b"] } });
  eq(inj.getDefaults(), ["c"], "restore 默认");
  eq(inj.promptsOf(S), ["a", "b"], "restore 多条分配");
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  eq(h.sections.length, 2, "restore 后能挂上两条");
}
{
  const { inj } = freshInjector();
  inj.restore({ assignments: { [S]: "a", "session-old-none": "none" } });
  eq(inj.promptsOf(S), ["a"], "v1 字符串转成单条数组");
  eq(inj.stateOf(S).source, "explicit", "v1 记录算显式");
  eq(inj.stateOf("session-old-none").source, "explicit", "v1 的 none 也算显式");
  eq(inj.promptsOf("session-old-none"), [], "v1 的 none 转成空数组（不注入）");
}

// ── 15. prune：清理已消失会话的记录（防状态文件无限增长）────────────────────
{
  const { inj } = freshInjector();
  const alive = new Set(["session-alive"]);
  inj.restore({
    assignments: { "session-alive": ["a"], "session-dead1": ["b"], "session-dead2": ["c"] },
  });
  const r = inj.prune((id) => alive.has(id));
  eq(r.removed, 2, "删掉 2 条已消失会话的记录");
  eq(r.kept, 1, "留下 1 条");
  eq(inj.promptsOf("session-alive"), ["a"], "活着的记录保留");
  eq(inj.promptsOf("session-dead1"), [], "死掉的记录已清（回落到默认）");
  const r2 = inj.prune(() => {
    throw new Error("炸");
  });
  eq(r2.removed, 0, "判断函数抛错时不误删");
}

// ── 16. disposeAll ──────────────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  const a = makeAgent("session-x1");
  const b = makeAgent("session-x2");
  inj.seedAgents([a.agent, b.agent]);
  inj.assign("session-x1", ["a", "b"]);
  inj.assign("session-x2", ["c"]);
  eq(a.sections.length + b.sections.length, 3, "disposeAll 前共 3 个 section");
  inj.disposeAll();
  eq(a.sections.length + b.sections.length, 0, "disposeAll 后全部卸载");
}

// ── 17. 非法输入与去重 ──────────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  eq(inj.assign("", ["a"]).outcome, "bad-session", "空 sessionId 被拒");
  eq(inj.assign(null, ["a"]).outcome, "bad-session", "null sessionId 被拒");
  eq(inj.promptsOf(undefined), [], "promptsOf(undefined) 返回空");
  eq(inj.explainOne("从未见过的会话").outcome, "unknown", "未知会话 explainOne");
  const h = makeAgent("session-dup");
  inj.seedAgents([h.agent]);
  inj.assign("session-dup", ["a", "a", "b", "a"]);
  eq(h.sections.length, 2, "重复 id 被去重");
}

// ── 18. preview：多条 + 三路真相 ────────────────────────────────────────────
{
  const holder = {};
  const h = makeAgent(S, {
    assemble: async (ctxArg) => {
      // ⚠️ v0.3.4 的 bug 回归：**agent 和 scope 必须都传**。
      //    只传 scope 时，读 `context.agent` 的段落（approval:policy /
      //    sandbox:policy —— 都写着 `if (agent === void 0) return ""`）
      //    会全部返回空串，预览显示成「上下文段 N 段 = 0 tokens」。
      //    官方权威用法：dsh-agent/lib/types/dispatch.js:92
      //      `assembleContextFor(agent, signal) => { agent, scope: agent, ... }`
      ok(ctxArg.scope === holder.agent, "assemble 收到的 scope 就是 agent");
      ok(ctxArg.agent === holder.agent, "**assemble 也必须收到 agent**（不只是 scope）");
      ok(
        "agent" in ctxArg && "scope" in ctxArg,
        "两个字段都在（缺一个就有段落会静默变空）",
      );
      return {
        sections: [
          { name: "prompt-manager:a", text: "甲" },
          { name: "prompt-manager:c", text: "丙" },
          { name: "harness:identity", text: "身份" },
        ],
        contexts: [{ name: "ctx", text: "上下文" }],
        tools: [{ name: "bash", description: "run", parameters: { type: "object" } }],
        variables: { model: "m" },
      };
    },
    events: [
      { seq: 1, type: "user/message", data: {} },
      {
        seq: 2,
        type: "system/message",
        data: { turn: 2, step: 0, message: { content: "模型实际收到的" } },
      },
    ],
  });
  holder.agent = h.agent;
  const { inj } = freshInjector();
  inj.seedAgents([h.agent]);
  inj.assign(S, ["a", "c"]);
  const p = await inj.preview(S);
  eq(p.outcome, "ok", "预览成功");
  eq(p.promptIds, ["a", "c"], "回报生效的多条 id");
  eq(p.prompts.length, 2, "回报每条的名字/模式/order");
  eq(p.prompts[0].order, 100, "回报 order");
  eq(p.prompts[1].order, 2900, "第二条的 order 也对");
  eq(p.sectionCount, 3, "section 总数");
  eq(p.toolCount, 1, "工具数");
  eq(p.totalTokens, p.sectionTokens + p.contextTokens + p.toolTokens, "totalTokens 是三者和");
  eq(p.conflict, null, "全追加不报冲突");
  eq(p.logged.ok, true, "会话日志读到了");
  eq(p.logged.text, "模型实际收到的", "日志内容正确");
}

// ── 19. preview：别的插件开启独占覆盖时，要报出来（不是我们的错，但要让用户看懂）──
{
  const h = makeAgent(S, {
    assemble: async () => ({
      sections: [{ name: "deployment:persona-prefix", text: "别人的", complete: true }],
      contexts: [],
      tools: [],
      variables: {},
    }),
  });
  const { inj } = freshInjector();
  inj.seedAgents([h.agent]);
  inj.assign(S, ["a"]);
  const p = await inj.preview(S);
  ok(p.conflict !== null, "检测到别人的独占覆盖");
  eq(p.conflict.kind, "shadowed-by-complete", "冲突类型正确");
  ok(p.conflict.message.includes("别的插件"), "说明是别的插件干的");
  ok(p.conflict.hint.includes("persona"), "提示往 persona 的覆盖开关上查");

  // 我们自己挂的 section **不可能是** complete（替换模式删除后不再设 complete）
  const h2 = makeAgent("session-plain", {
    assemble: async () => ({
      sections: [
        { name: "deployment:persona-prefix", text: "原生 persona" },
        { name: "prompt-manager:session-system-prompt", text: "我们的" },
      ],
      contexts: [],
      tools: [],
      variables: {},
    }),
  });
  const { inj: inj2 } = freshInjector();
  inj2.seedAgents([h2.agent]);
  inj2.assign("session-plain", ["a", "b"]);
  const p2 = await inj2.preview("session-plain");
  eq(p2.outcome, "ok", "preview 正常返回");
  eq(p2.conflict, null, "没有别的插件独占时，不报冲突");
  eq(p2.sectionCount, 2, "两个 section 共存");
}

// ── 20. preview 失败路径 + 日志诊断 ────────────────────────────────────────
{
  const { inj } = freshInjector();
  const p1 = await inj.preview("没有这个会话");
  eq(p1.outcome, "awaiting-agent", "agent 未加载");

  const h2 = makeAgent("s-nolog", {
    assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
  });
  h2.agent.session.append = () => {};
  inj.seedAgents([h2.agent]);
  const p2 = await inj.preview("s-nolog");
  eq(p2.logged.ok, false, "没 snapshotEvents 时 ok:false");
  ok(p2.logged.reason.includes("snapshotEvents"), "reason 指明缺什么");
  ok(Array.isArray(p2.logged.availableMethods), "附带可用方法列表");
  ok(p2.logged.availableMethods.includes("append"), "可用方法列表里能看到真实成员");

  const h3 = makeAgent("s-notype", {
    assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
    events: [{ type: "user/message" }, { type: "user/message" }, { type: "assistant/message" }],
  });
  inj.seedAgents([h3.agent]);
  const p3 = await inj.preview("s-notype");
  eq(p3.logged.ok, false, "没有 system/message 时 ok:false");
  eq(p3.logged.eventCount, 3, "报出事件数");
  const m = new Map(p3.logged.eventTypes);
  eq(m.get("user/message"), 2, "报出真实事件类型统计");
}

// ── 21. explain 汇总 ────────────────────────────────────────────────────────
{
  const { inj } = freshInjector();
  const h = makeAgent(S);
  inj.seedAgents([h.agent]);
  inj.assign(S, ["a", "b"]);
  const mine = inj.explain().find((e) => e.sessionId === S);
  eq(mine.attachedPrompts.length, 2, "explain 列出已挂的多条");
  eq(mine.attachedPrompts[0].promptId, "a", "带 promptId");
  eq(mine.attachedPrompts[0].mode, "append", "带 mode");
  eq(mine.attachedPrompts[0].order, 100, "带 order");
}

// ── 22. inject 抛错时回滚，不留半个状态 ────────────────────────────────────
{
  let calls = 0;
  const h = makeAgent("session-rollback");
  const origInject = h.agent.ctx.inject;
  h.agent.ctx.inject = (keys, cb) => {
    calls += 1;
    if (calls === 2) throw new Error("第二条挂了");
    return origInject(keys, cb);
  };
  const { inj } = freshInjector();
  inj.seedAgents([h.agent]);
  const r = inj.assign("session-rollback", ["a", "b"]);
  eq(r.outcome, "inject-threw", "抛错的结论正确");
  eq(h.sections.length, 0, "第一条被回滚，不留半个状态");
}

rmSync(dir, { recursive: true, force: true });

// ── 21. pruneMissing：删掉「正在被用」的条目后的清理 ───────────────────────
//
// v0.3.2 补的真实 bug。删掉一条正在被用的提示词后，曾经会：
//   1. 它还留在全局默认里 → **所有新会话静默地什么都挂不上**
//   2. 已分配的会话留着幽灵 id，而 stateOf() 报 attached:true 是**假的**
//   3. assign() 遇未知 id 提前 return 不走 detach → 旧正文永远卡在会话里
{
  const hA = makeAgent("session-dangle-A");
  const hB = makeAgent("session-dangle-B");
  const { inj } = injectorWithMissing();
  inj.seedAgents([hA.agent, hB.agent]);

  inj.setDefaults(["b"]);
  eq(inj.promptsOf("session-dangle-B"), ["b"], "B 跟着默认挂上了 b");
  eq(hB.sections.length, 1, "B 有一个 section");
  inj.assign("session-dangle-A", ["a", "b"]);
  eq(hA.sections.length, 2, "A 显式挂了两条");

  // b 从库里消失。同一个注入器改不了 resolvePrompt，所以换一个"缺 b 的"，
  // 把状态 restore 进去 —— 等价于 library.reload() 后条目没了。
  const dropped = (() => {
    const m = injectorWithMissing(["b"]);
    m.inj.restore({
      version: 2,
      defaults: ["b"],
      assignments: { "session-dangle-A": ["a", "b"], "session-dangle-B": ["b"] },
    });
    const d = m.inj.pruneMissing();
    return { d, m };
  })();

  eq(dropped.d.defaults, ["b"], "报告：默认里剔掉了 b");
  eq(dropped.d.sessions["session-dangle-A"], ["b"], "报告：A 里剔掉了 b");
  eq(dropped.m.inj.getDefaults(), [], "默认已清空");
  eq(dropped.m.inj.promptsOf("session-dangle-A"), ["a"], "**显式分配保留了还成立的部分**");
  eq(dropped.m.inj.promptsOf("session-dangle-B"), [], "全是幽灵的那条收敛成空");

  // 幂等：再 prune 一次无事可做
  const again = dropped.m.inj.pruneMissing();
  eq(again.defaults, [], "第二次 prune 不再动默认");
  eq(Object.keys(again.sessions).length, 0, "也没有会话需要改");
}

// ── 22. pruneMissing 之后，新会话能重新正常跟上默认 ─────────────────────────
{
  const m = injectorWithMissing(["b"]);
  m.inj.restore({ version: 2, defaults: ["b"], assignments: {} });

  // 清掉之前：新会话「挂空」
  const hBad = makeAgent("session-dangle-bad");
  m.inj.handleAgentCreated(hBad.agent);
  eq(hBad.sections.length, 0, "幽灵默认下，新会话什么都挂不上（这就是那个 bug）");
  eq(m.inj.stateOf("session-dangle-bad").attached, false, "如实报告未挂载");

  // 清理之后：把默认换成合法的一条，新会话恢复正常
  eq(m.inj.pruneMissing().defaults, ["b"], "清掉了幽灵默认");
  m.inj.setDefaults(["a"]);
  const hGood = makeAgent("session-dangle-good");
  m.inj.handleAgentCreated(hGood.agent);
  eq(hGood.sections.length, 1, "设了合法默认后新会话正常挂上");
  eq(m.inj.promptsOf("session-dangle-good"), ["a"], "挂的是新默认");
}

// ── 23. pruneMissing 要能把「卡住的旧 section」卸掉 ─────────────────────────
{
  const m = injectorWithMissing();
  const h = makeAgent("session-stuck");
  m.inj.seedAgents([h.agent]);
  m.inj.assign("session-stuck", ["a"]);
  eq(h.sections.length, 1, "先正常挂上 a");

  // a 消失，然后 prune —— 分配收敛成空，**section 必须被卸掉**
  m.vanish("a");
  const d = m.inj.pruneMissing();
  eq(d.sessions["session-stuck"], ["a"], "报告剔掉了 a");
  eq(m.inj.promptsOf("session-stuck"), [], "分配收敛成空");
  eq(h.sections.length, 0, "**卡住的 section 被卸掉了**（否则已删条目的正文会永远留着）");
}

// ── 24. pruneMissing 不碰不相干的会话 ───────────────────────────────────────
{
  const m = injectorWithMissing();
  const hKeep = makeAgent("session-keep");
  const hTouch = makeAgent("session-touch");
  m.inj.seedAgents([hKeep.agent, hTouch.agent]);
  m.inj.assign("session-keep", ["a"]);
  m.inj.assign("session-touch", ["a", "b"]);

  m.vanish("b");
  const d = m.inj.pruneMissing();
  ok(!("session-keep" in d.sessions), "完全没用 b 的会话不出现在报告里");
  eq(m.inj.promptsOf("session-keep"), ["a"], "它的分配没被动过");
  eq(hKeep.sections.length, 1, "它的 section 还在");
  eq(m.inj.promptsOf("session-touch"), ["a"], "用了 b 的会话被收敛");
}

// ── 25. logged：取「最后一条**有正文**的」system/message ─────────────────────
//
// dsh 的 project() 有个分支会先把多余节点 replace 成空串、再更新 head，
// 那时最后追加的一条是**空文本**。只取最后一条会误报「取不到文本」。
{
  const h = makeAgent("session-logtail", {
    assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
    events: [
      { seq: 1, type: "user/message", data: {} },
      {
        seq: 2,
        type: "system/message",
        data: { turn: 5, step: 1, message: { content: [{ type: "text", text: "早先的系统提示词" }] } },
      },
      // 清理记录：空文本，排在最后
      {
        seq: 3,
        type: "system/message",
        data: { turn: 6, step: 1, message: { content: [{ type: "text", text: "" }] } },
      },
    ],
  });
  const { inj } = freshInjector();
  inj.seedAgents([h.agent]);
  const p = await inj.preview("session-logtail");
  eq(p.logged.ok, true, "空文本的清理记录不会让它失败");
  eq(p.logged.text, "早先的系统提示词", "取到的是最后一条**有正文**的");
  eq(p.logged.turn, 5, "轮次跟着那条走");
  eq(p.logged.messageCount, 2, "仍然报告日志里有 2 条 system/message");
  eq(p.logged.isLatestEvent, false, "并标明它不是时间上的最后一条");
}

// ── 26. logged：全是空文本时才失败 ──────────────────────────────────────────
{
  const h = makeAgent("session-logempty", {
    assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
    events: [
      {
        seq: 1,
        type: "system/message",
        data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "" }] } },
      },
    ],
  });
  const { inj } = freshInjector();
  inj.seedAgents([h.agent]);
  const p = await inj.preview("session-logempty");
  eq(p.logged.ok, false, "全空时如实失败");
  ok(p.logged.reason.includes("没有一条带正文"), "原因写清楚，不是含糊的『取不到』");
}

console.log(`\n注入核心测试：${pass} 通过, ${fail} 失败`);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail === 0 ? 0 : 1);
