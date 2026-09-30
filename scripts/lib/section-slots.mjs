// 原生系统提示词的「槽位表」—— dsh 预留了哪些位置、每个位置对应哪一段。
//
// ═══════════════════════════════════════════════════════════════════════════
// 这份数据是怎么来的（**不是推的**）
// ═══════════════════════════════════════════════════════════════════════════
//
// 每个注册点里，键和段名是**挨着写的**：
//
//     this.section({
//       name: "harness:identity",
//       order: this.getSectionOrder("HARNESS_IDENTITY"),   // ← 对应关系就在这里
//       text: "..."
//     });
//
// 用 scripts/extract_section_names.mjs 把全树的 `.section({...})` 配对抠出来，
// 得到 27 个键的确定映射。完整表格见 docs/dev/native-sections-verified.md。
//
// ⚠️ **不要凭键名推段名。** 我推错过两次，而且推错不会报错、只会静默失效：
//      PTC_ONLY        → 推 `ptc:only`        实际 `tools:ptc-only`
//      FILE_REFERENCE  → 推 `file-reference`  实际 `context:file-reference`
//    两个都"看着很合理"。
//
// ═══════════════════════════════════════════════════════════════════════════
// 三种槽位
// ═══════════════════════════════════════════════════════════════════════════
//
//   ① 静态段名   —— 源码里写死的名字，能精确判断"这次注册了没有"
//   ② 动态段名   —— `tool:${toolName}` 这种，**无法可靠判断**，所以一律不报"未注册"
//                    （报了会误伤：`tool:subagent_fork` 就属于 TOOL_SUBAGENT 这个键）
//   ③ 无对应包   —— dsh 预留了位置，但**没有任何包会注册它**，连名字都没有
//
// 只有 ① 和 ③ 会出现在「未注册」列表里 —— 这两种判断都是确定的。

/** 槽位种类。 */
export const SLOT_KIND = {
  /** 源码里有写死的段名 */
  STATIC: "static",
  /** 段名是模板（`tool:${x}`），判断不了 */
  DYNAMIC: "dynamic",
  /** 没有任何包注册这个位置 */
  ORPHAN: "orphan",
};

/**
 * dsh 预留的全部 32 个位置。
 *
 * `order` 是 `SECTION_ORDERS` 里的值，`name` 是从源码读出的段名
 * （`null` = 那个位置没有包注册，连名字都没有）。
 */
export const SECTION_SLOTS = [
  { key: "HARNESS_IDENTITY", order: -1000, name: "harness:identity", kind: SLOT_KIND.STATIC },
  { key: "DEPLOYMENT_PERSONA_PREFIX", order: 0, name: "deployment:persona-prefix", kind: SLOT_KIND.STATIC },
  { key: "PLAN_POLICY", order: 500, name: "plan:policy", kind: SLOT_KIND.STATIC },
  { key: "TEAM_POLICY", order: 600, name: "team:policy", kind: SLOT_KIND.STATIC },
  { key: "PTC_ONLY", order: 800, name: "tools:ptc-only", kind: SLOT_KIND.STATIC },
  { key: "FILE_REFERENCE", order: 900, name: "context:file-reference", kind: SLOT_KIND.STATIC },
  { key: "TOOL_BASH", order: 1000, name: "tool:bash", kind: SLOT_KIND.STATIC },
  { key: "TOOL_PWSH", order: 1010, name: "tool:pwsh", kind: SLOT_KIND.STATIC },
  { key: "TOOL_READ", order: 1100, name: "tool:read", kind: SLOT_KIND.STATIC },
  { key: "TOOL_WRITE", order: 1200, name: "tool:write", kind: SLOT_KIND.STATIC },
  { key: "TOOL_EDIT", order: 1300, name: "tool:edit", kind: SLOT_KIND.STATIC },
  { key: "TOOL_GLOB", order: 1400, name: "tool:glob", kind: SLOT_KIND.STATIC },
  { key: "TOOL_GREP", order: 1500, name: "tool:grep", kind: SLOT_KIND.STATIC },
  { key: "TOOL_JOBS", order: 1600, name: "tool:jobs", kind: SLOT_KIND.STATIC },
  // 以下 5 个：整个 dsh 树里只出现在 SECTION_ORDERS 的定义处，没有任何 .section() 创建它们
  { key: "TOOL_PTY", order: 1700, name: null, kind: SLOT_KIND.ORPHAN },
  { key: "TOOL_WEB_SEARCH", order: 2000, name: "tool:web_search", kind: SLOT_KIND.STATIC },
  { key: "TOOL_WEB_FETCH", order: 2100, name: "tool:web_fetch", kind: SLOT_KIND.STATIC },
  { key: "TOOL_LSP", order: 2200, name: null, kind: SLOT_KIND.ORPHAN },
  { key: "TOOL_SESSION_QUERY", order: 2300, name: null, kind: SLOT_KIND.ORPHAN },
  { key: "TOOL_GOAL", order: 2400, name: "tool:goal", kind: SLOT_KIND.STATIC },
  // 模板名 —— 运行时是 `tool:workflow` / `tool:subagent` / `tool:subagent_fork`
  { key: "TOOL_WORKFLOW", order: 2600, name: "tool:${toolName}", kind: SLOT_KIND.DYNAMIC },
  { key: "TOOL_RALPH", order: 2700, name: "tool:ralph", kind: SLOT_KIND.STATIC },
  { key: "TOOL_SUBAGENT", order: 2800, name: "tool:${toolName}", kind: SLOT_KIND.DYNAMIC },
  { key: "TOOL_REPORT", order: 2900, name: null, kind: SLOT_KIND.ORPHAN },
  { key: "TOOL_COMPUTER_USE", order: 3000, name: null, kind: SLOT_KIND.ORPHAN },
  // 这一键会产出两个名字：`mcp-resource-servers`（静态）和 `mcp:${server}`（动态）
  { key: "MCP_SERVERS", order: 3100, name: "mcp-resource-servers", kind: SLOT_KIND.STATIC, alsoDynamic: "mcp:" },
  { key: "TOOLS_SDK", order: 5000, name: "tools:sdk", kind: SLOT_KIND.STATIC },
  { key: "DELIVERABLE_FILE_REFERENCES", order: 9000, name: "ui:deliverable-file-references", kind: SLOT_KIND.STATIC },
  { key: "STRUCTURED_OUTPUT", order: 9900, name: "tool:${STRUCTURED_OUTPUT_TOOL}", kind: SLOT_KIND.DYNAMIC },
  { key: "HARNESS_SOURCE", order: 10000, name: "harness:source", kind: SLOT_KIND.STATIC },
  { key: "WEB_SURFACE", order: 10100, name: "app:web-surface", kind: SLOT_KIND.STATIC },
  { key: "DEPLOYMENT_PERSONA_SUFFIX", order: 10200, name: "deployment:persona-suffix", kind: SLOT_KIND.STATIC },
];

/**
 * 找出**这次没有被注册**的槽位。
 *
 * 只报判断确定的两种（见文件头说明）：
 *   · `static` —— 段名写死，查一下在不在就知道
 *   · `orphan` —— 压根没有包会注册它
 *
 * **`dynamic` 一律不报** —— `tool:${toolName}` 这类判断不了，硬报会误伤
 * （`tool:subagent_fork` 就归在 TOOL_SUBAGENT 这个键下）。
 *
 * @param {Array<{name: string}>} registered 当前装配结果里的段落
 * @returns {Array<{key: string, order: number, name: string|null, kind: string, reason: string}>}
 */
export function findEmptySlots(registered) {
  const have = new Set(
    (Array.isArray(registered) ? registered : [])
      .map((s) => (s && typeof s.name === "string" ? s.name : null))
      .filter(Boolean),
  );

  const out = [];
  for (const slot of SECTION_SLOTS) {
    if (slot.kind === SLOT_KIND.DYNAMIC) continue;

    if (slot.kind === SLOT_KIND.ORPHAN) {
      out.push({
        key: slot.key,
        order: slot.order,
        name: null,
        kind: slot.kind,
        reason: "dsh 预留了这个位置，但没有任何插件会注册它",
      });
      continue;
    }

    if (have.has(slot.name)) continue;
    // 这一键同时会产出动态名（如 `mcp:${server}`）—— 有任何一个就算用上了
    if (slot.alsoDynamic && [...have].some((n) => n.startsWith(slot.alsoDynamic))) continue;

    out.push({
      key: slot.key,
      order: slot.order,
      name: slot.name,
      kind: slot.kind,
      reason: "这个功能这次没有被加载，所以 dsh 没有往这个位置放内容",
    });
  }
  return out;
}
