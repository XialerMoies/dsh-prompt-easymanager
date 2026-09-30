// 槽位表测试：dsh 预留了哪些位置、哪些这次没被注册
//
// 运行：node scripts/section_slots_test.mjs
//
// ═══════════════════════════════════════════════════════════════════════════
// 这份表是**从源码读出来的**，不是推的 —— 所以测试重点有两块：
// ═══════════════════════════════════════════════════════════════════════════
//
//   ① **不许出现推测出来的段名。** 我推错过两次：
//        PTC_ONLY        → 推 `ptc:only`        实际 `tools:ptc-only`
//        FILE_REFERENCE  → 推 `file-reference`  实际 `context:file-reference`
//      两个都"看着很合理"，而且推错**不会报错、只会静默失效**。
//      所以这里逐条钉住实际值 —— 改表必须同步改测试，逼人去看源码。
//
//   ② **判断不了的不许报「未注册」。** 模板名（`tool:${toolName}`）没法确认
//      对应哪个具体段落（`tool:subagent_fork` 就归在 TOOL_SUBAGENT 键下），
//      硬报会误伤。这里用真机数据验证：跑出来正好 10 个空槽位，一个不多一个不少。

import { SECTION_SLOTS, SLOT_KIND, findEmptySlots } from "./lib/section-slots.mjs";

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

const byKey = new Map(SECTION_SLOTS.map((s) => [s.key, s]));

// ══ 1. 总量与不重复 ═══════════════════════════════════════════════════════
{
  eq(SECTION_SLOTS.length, 32, "dsh 一共预留 32 个位置");
  eq(new Set(SECTION_SLOTS.map((s) => s.key)).size, 32, "键不重复");
  const dev = [0, 1, 2].map((i) => SECTION_SLOTS[i].name);
  eq(dev, ["harness:identity", "deployment:persona-prefix", "plan:policy"], "顺序按 order 升序(前三个)");
  ok(
    SECTION_SLOTS.every((s, i, a) => i === 0 || a[i - 1].order <= s.order),
    "整张表按 order 升序（界面直接按这个顺序渲染）",
  );
  ok(typeof SECTION_SLOTS[0].order === "number" && SECTION_SLOTS[0].order === -1000, "第一条是 -1000");
  ok(SECTION_SLOTS[SECTION_SLOTS.length - 1].order === 10200, "最后一条是 10200");
}

// ══ 2. **逐条钉住从源码读出的段名** ═══════════════════════════════════════
//
// 这些值全部来自 `.section({ name, order: getSectionOrder("KEY") })` 的实际配对。
// 谁改这张表，就得回源码核对，改不动就说明改错了。
{
  /** 我推错过的那几个，单独列出来 —— 它们是最容易再推错的。 */
  eq(byKey.get("PTC_ONLY").name, "tools:ptc-only", "**PTC_ONLY → tools:ptc-only**（不是 ptc:only，我推错过）");
  eq(
    byKey.get("FILE_REFERENCE").name,
    "context:file-reference",
    "**FILE_REFERENCE → context:file-reference**（不是 file-reference）",
  );
  eq(byKey.get("MCP_SERVERS").name, "mcp-resource-servers", "MCP_SERVERS → mcp-resource-servers（不是 mcp:servers）");
  eq(
    byKey.get("DELIVERABLE_FILE_REFERENCES").name,
    "ui:deliverable-file-references",
    "交付物文件引用",
  );
  eq(byKey.get("WEB_SURFACE").name, "app:web-surface", "网页界面（不是 web:surface）");
  eq(byKey.get("TOOLS_SDK").name, "tools:sdk", "TOOLS_SDK → tools:sdk");
  eq(byKey.get("TEAM_POLICY").name, "team:policy", "TEAM_POLICY → team:policy");
  eq(byKey.get("HARNESS_IDENTITY").name, "harness:identity", "身份");
  eq(byKey.get("HARNESS_SOURCE").name, "harness:source", "Harness 安装位置");
  eq(byKey.get("PLAN_POLICY").name, "plan:policy", "计划策略");
  eq(byKey.get("DEPLOYMENT_PERSONA_PREFIX").name, "deployment:persona-prefix", "部署人设 · 前");
  eq(byKey.get("DEPLOYMENT_PERSONA_SUFFIX").name, "deployment:persona-suffix", "部署人设 · 后");

  // tool:* 全是机械对应，逐个钉住
  const tools = {
    TOOL_BASH: "tool:bash",
    TOOL_PWSH: "tool:pwsh",
    TOOL_READ: "tool:read",
    TOOL_WRITE: "tool:write",
    TOOL_EDIT: "tool:edit",
    TOOL_GLOB: "tool:glob",
    TOOL_GREP: "tool:grep",
    TOOL_JOBS: "tool:jobs",
    TOOL_WEB_SEARCH: "tool:web_search",
    TOOL_WEB_FETCH: "tool:web_fetch",
    TOOL_GOAL: "tool:goal",
    TOOL_RALPH: "tool:ralph",
  };
  for (const [k, v] of Object.entries(tools)) eq(byKey.get(k).name, v, k + " → " + v);
}
{
  // 模板名 —— **绝不能**写上具体的段落名，写了就是在猜
  for (const k of ["TOOL_WORKFLOW", "TOOL_SUBAGENT", "STRUCTURED_OUTPUT"]) {
    const s = byKey.get(k);
    eq(s.kind, SLOT_KIND.DYNAMIC, k + " 标为 dynamic");
    ok(s.name.includes("${"), k + " 的段名保留模板形式（不猜具体名）");
  }
  eq(byKey.get("TOOL_WORKFLOW").name, "tool:${toolName}", "TOOL_WORKFLOW 是模板名");
  eq(byKey.get("TOOL_SUBAGENT").name, "tool:${toolName}", "TOOL_SUBAGENT 是模板名");
  eq(byKey.get("STRUCTURED_OUTPUT").name, "tool:${STRUCTURED_OUTPUT_TOOL}", "结构化输出是模板名");
}

// ══ 3. 孤儿槽位：没有任何包会注册它 ═══════════════════════════════════════
//
// 这 5 个键在整个 dsh 树里**只出现在 SECTION_ORDERS 的定义处**
// （dsh-system-prompt/lib/index.js），没有任何 .section() 创建它们。
// 所以「没有名字」是事实 —— 不许给它们编一个。
{
  const orphans = SECTION_SLOTS.filter((s) => s.kind === SLOT_KIND.ORPHAN);
  eq(
    orphans.map((s) => s.key),
    ["TOOL_PTY", "TOOL_LSP", "TOOL_SESSION_QUERY", "TOOL_REPORT", "TOOL_COMPUTER_USE"],
    "恰好这 5 个是孤儿槽位",
  );
  ok(
    orphans.every((s) => s.name === null),
    "**孤儿槽位一律 name: null** —— 不许推成 tool:pty / tool:lsp 这种",
  );
}

// ══ 4. 用真机数据验证空槽位判定 ═══════════════════════════════════════════
{
  // 2026-09 真机实测的 23 段（用户从界面上逐条念出来的）
  const REAL = [
    "harness:identity",
    "deployment:persona-prefix",
    "plan:policy",
    "context:file-reference",
    "tool:pwsh",
    "tool:read",
    "tool:write",
    "tool:edit",
    "tool:glob",
    "tool:grep",
    "tool:jobs",
    "tool:web_search",
    "tool:web_fetch",
    "tool:goal",
    "tool:workflow",
    "tool:subagent",
    "tool:subagent_fork",
    "mcp-resource-servers",
    "ui:deliverable-file-references",
    "prompt-manager:infinite-gen-3",
    "harness:source",
    "app:web-surface",
    "deployment:persona-suffix",
  ].map((name) => ({ name }));

  const empty = findEmptySlots(REAL);
  eq(empty.length, 10, "**真机 23 段 → 正好 10 个空槽位**");
  eq(
    empty.map((e) => e.key),
    [
      "TEAM_POLICY",
      "PTC_ONLY",
      "TOOL_BASH",
      "TOOL_PTY",
      "TOOL_LSP",
      "TOOL_SESSION_QUERY",
      "TOOL_RALPH",
      "TOOL_REPORT",
      "TOOL_COMPUTER_USE",
      "TOOLS_SDK",
    ],
    "空槽位清单逐条对上（按 order 升序）",
  );

  const bash = empty.find((e) => e.key === "TOOL_BASH");
  eq(bash.name, "tool:bash", "TOOL_BASH 空着，但**知道它本该叫什么**");
  ok(bash.reason.includes("没有"), "给了「为什么不在」的原因");

  const pty = empty.find((e) => e.key === "TOOL_PTY");
  eq(pty.name, null, "TOOL_PTY 没有名字");
  ok(pty.reason.includes("没有任何插件"), "孤儿槽位的原因跟「没加载」区分开");

  // ⚠️ 模板名的键**不许**出现在空槽位里
  ok(
    !empty.some((e) => ["TOOL_SUBAGENT", "TOOL_WORKFLOW", "STRUCTURED_OUTPUT", "MCP_SERVERS"].includes(e.key)),
    "**模板名的槽位一个都不报** —— tool:workflow / tool:subagent 明明注册了，报了就是误伤",
  );
}

// ══ 5. 边界 ══════════════════════════════════════════════════════════════
{
  eq(findEmptySlots([]).length, SECTION_SLOTS.length - 3, "一段都没有时，除 3 个模板键外全报空（32 - 3 = 29）");
  eq(findEmptySlots(null).length, SECTION_SLOTS.length - 3, "null 输入不炸");
  eq(findEmptySlots(undefined).length, SECTION_SLOTS.length - 3, "undefined 输入不炸");
  ok(
    findEmptySlots([{ name: "harness:identity" }]).length === SECTION_SLOTS.length - 4,
    "只注册一段时，那一段不报空",
  );
  // 脏数据不许炸
  eq(findEmptySlots([null, {}, { name: 123 }]).length, SECTION_SLOTS.length - 3, "没有合法 name 的项被跳过");

  // MCP 的动态名也算「用上了」
  const withMcp = findEmptySlots([{ name: "mcp:github" }]);
  ok(!withMcp.some((e) => e.key === "MCP_SERVERS"), "**有 mcp:<server> 时，MCP_SERVERS 不算空**");
  const withMcpRes = findEmptySlots([{ name: "mcp-resource-servers" }]);
  ok(!withMcpRes.some((e) => e.key === "MCP_SERVERS"), "有 mcp-resource-servers 时也不算空");
  const noMcp = findEmptySlots([]);
  ok(noMcp.some((e) => e.key === "MCP_SERVERS"), "两者都没有时才报空");
}

console.log(`\n槽位表测试：${pass} 通过, ${fail} 失败`);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail === 0 ? 0 : 1);
