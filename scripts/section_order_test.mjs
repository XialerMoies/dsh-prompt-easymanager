// 分类的建议 order 跟 dsh 原生 SECTION_ORDERS 的冲突检查
//
// 运行：node scripts/section_order_test.mjs
//
// ═══════════════════════════════════════════════════════════════════════════
// 为什么单独一个文件
// ═══════════════════════════════════════════════════════════════════════════
//
// v0.3.6 里 `domain` 的建议 order 取了 500 —— **正好等于 dsh 的 `PLAN_POLICY`**；
// `tool` 取了 3000 —— **正好等于 `TOOL_COMPUTER_USE`**。
//
// 撞了会怎样：dsh 的排序是
//
//   comparePromptSections = a.order - b.order || compareNames(a.name, b.name)
//
// order 相同时**按 section 名字的字典序**。于是同一个分类的提示词插在哪，
// 取决于用户给提示词起的名字首字母 —— 叫 `abc-规则` 就排到 plan:policy 前面，
// 叫 `zzz-规则` 就排到后面。同一个分类、同一个 order，位置随名字变。
//
// **原来的测试没发现，因为它只查了「五个分类之间 order 互不相同」，
// 而且断言写的是「500 在 900 之前」这种区间判断 —— 话没说错，但没问
// 「那 500 是不是正好等于别人」。**
//
// 所以这里补两件事：
//   ① 断言五个建议 order 一个都不在 dsh 的原生表里
//   ② 断言每个建议 order 落在预期的两个原生段之间
//
// 而且原生表**从 dsh 的源码实时读**（读不到就只用快照，并给出提示），
// 这样 dsh 升级改了表，这个测试会当场红。

import { readFileSync, existsSync } from "node:fs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("分类 order 冲突检查");
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, suggestedOrder } from "./lib/prompt-library.mjs";


const HERE = dirname(fileURLToPath(import.meta.url));

// ══ 1. 快照：dsh 的原生 SECTION_ORDERS ═════════════════════════════════════
//
// 抄自 dsh-system-prompt/lib/index.js。
// 实时读取成功且与快照不符时会红 —— 那时候**先去看 dsh 到底改了什么**，
// 再决定是更新快照还是调整建议 order。
const SNAPSHOT_VERSION = "0.1.7-rc.2";
const SNAPSHOT = {
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
};

// ══ 2. 实时读 dsh 的源码，看快照还准不准 ══════════════════════════════════
//
// ⚠️ 别硬编码安装路径。原来这里写死了作者本机的 `D:\Node\node_global\…`，
//    换台机器就**静默退回快照** —— 测试照样绿，但「dsh 升级改了表就当场红」
//    这层保护没了，而且没人知道。
//
// 改成按「候选 node_modules 根 × 相对路径」找。顺序：
//   1. 环境变量 DSH_SYSTEM_PROMPT_PATH（明确指定，永远优先）
//   2. 从 node 可执行文件所在目录往上几级找（全局装 dsh 时它就在旁边，
//      本机 node 在 D:\Node\、dsh 在 D:\Node\node_global\）
//   3. 环境变量给的线索（npm 前缀、APPDATA）
//   4. 常见的系统全局位置
function candidateRoots() {
  const roots = [];
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };

  // node 往上三级 + 每级下的 node_modules / <name>_global/node_modules
  let dir = dirname(process.execPath);
  for (let i = 0; i < 4 && dir; i++) {
    push(join(dir, "node_modules"));
    for (const name of ["node_global", "npm-global", "global"]) {
      push(join(dir, name, "node_modules"));
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (process.env.npm_config_prefix) {
    push(join(process.env.npm_config_prefix, "node_modules"));
    push(join(process.env.npm_config_prefix, "lib", "node_modules"));
  }
  if (process.env.APPDATA) push(join(process.env.APPDATA, "npm", "node_modules"));
  if (process.env.HOME) push(join(process.env.HOME, ".npm-global", "lib", "node_modules"));

  push("/usr/local/lib/node_modules");
  push("/usr/lib/node_modules");

  return roots;
}

const DSH_RELS = [
  join("@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-system-prompt", "lib", "index.js"),
  join("@deepseek-ai", "dsh-system-prompt", "lib", "index.js"),
];

function locateDshSystemPrompt() {
  if (process.env.DSH_SYSTEM_PROMPT_PATH) {
    return existsSync(process.env.DSH_SYSTEM_PROMPT_PATH) ? process.env.DSH_SYSTEM_PROMPT_PATH : null;
  }
  for (const root of candidateRoots()) {
    for (const rel of DSH_RELS) {
      const p = join(root, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function parseSectionOrders(src) {
  const block = src.match(/const SECTION_ORDERS\s*=\s*\{([\s\S]*?)\};/);
  if (!block) return null;
  const out = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*:\s*(-?[\d.e+]+)\s*,?\s*$/);
    if (!m) continue;
    // 源码里写过 1e3 / 3e3 / 9e4 这种科学计数法
    const v = Number(m[2]);
    if (Number.isFinite(v)) out[m[1]] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

let NATIVE = SNAPSHOT;
{
  const file = locateDshSystemPrompt();
  if (file === null) {
    console.log("  ⚠️ 没找到 dsh-system-prompt 的源码，只用快照（快照抄自 dsh " + SNAPSHOT_VERSION + "）");
    console.log("      想启用实时比对：设 DSH_SYSTEM_PROMPT_PATH 指向 dsh-system-prompt/lib/index.js");
  } else {
    const live = parseSectionOrders(readFileSync(file, "utf8"));
    ok(live !== null, "能从 dsh 源码里解析出 SECTION_ORDERS");
    if (live !== null) {
      // 快照 vs 实时：不一致就红，提示去看 dsh 改了什么
      eq(
        Object.keys(live).sort(),
        Object.keys(SNAPSHOT).sort(),
        "dsh 的 SECTION_ORDERS 段名与快照一致（不一致说明 dsh 升级过，去看它改了什么）",
      );
      const drift = Object.keys(SNAPSHOT).filter(
        (k) => live[k] !== undefined && live[k] !== SNAPSHOT[k],
      );
      eq(drift, [], "dsh 的 SECTION_ORDERS 数值与快照一致（有漂移就要更新快照和建议 order）");
      NATIVE = live;
      console.log("  ℹ️ 实时比对了 " + Object.keys(live).length + " 个原生段落");
    }
  }
}

const nativeValues = new Set(Object.values(NATIVE));
const nativeList = Object.entries(NATIVE).sort((a, b) => a[1] - b[1]);

// ══ 3. **核心断言：建议 order 一个都不许撞原生表** ═════════════════════════
{
  for (const c of CATEGORIES) {
    ok(
      !nativeValues.has(c.order),
      `**分类 ${c.id}(${c.order}) 不等于任何原生段落的 order**（撞了就按名字排序，位置随机）`,
    );
  }

  // 撞了的话，把撞谁了说清楚，省得回头还要自己查
  const collisions = CATEGORIES.flatMap((c) =>
    nativeList.filter(([, v]) => v === c.order).map(([k]) => `${c.id}=${c.order} 撞 ${k}`),
  );
  eq(collisions, [], "没有任何建议 order 与原生段落重合");
}

// ══ 4. 每个建议 order 落在预期的两个原生段之间 ═════════════════════════════
{
  // [分类, 前一个原生段名, 后一个原生段名]
  const EXPECT = [
    ["identity", "DEPLOYMENT_PERSONA_PREFIX", "PLAN_POLICY"],
    ["domain", "FILE_REFERENCE", "TOOL_BASH"],
    ["tool", "MCP_SERVERS", "TOOLS_SDK"],
    ["output", "DELIVERABLE_FILE_REFERENCES", "STRUCTURED_OUTPUT"],
    ["other", "DEPLOYMENT_PERSONA_PREFIX", "PLAN_POLICY"],
  ];
  for (const [id, lo, hi] of EXPECT) {
    const v = suggestedOrder(id);
    ok(typeof v === "number", `分类 ${id} 有建议 order`);
    ok(
      v > NATIVE[lo] && v < NATIVE[hi],
      `分类 ${id}(${v}) 落在 ${lo}(${NATIVE[lo]}) 与 ${hi}(${NATIVE[hi]}) 之间`,
    );
  }
}

// ══ 5. hint 不许撒谎 ══════════════════════════════════════════════════════
//
// 老版本里 `tool` 的 hint 写「插在所有工具说明之后」，
// 但它的 3000 跟最后一个工具说明并列、而且 MCP_SERVERS(3100) 还在后面。
{
  const tool = CATEGORIES.find((c) => c.id === "tool");
  ok(
    tool.order > NATIVE.MCP_SERVERS,
    "`工具` 的建议 order 真的排在 MCP_SERVERS 之后（hint 说的「所有工具说明 + MCP 之后」要成立）",
  );

  const domain = CATEGORIES.find((c) => c.id === "domain");
  ok(
    domain.order < NATIVE.TOOL_BASH,
    "`领域` 的建议 order 真的在第一个工具说明之前（hint 说的「工具说明之前」要成立）",
  );
  ok(
    domain.order > NATIVE.FILE_REFERENCE,
    "`领域` 的建议 order 在文件引用之后（别挤在 persona 和策略段中间）",
  );
}

// ══ 6.（已删）分类之间「建议 order 互不相同」 ═════════════════════════════
//
// 那一条**不在这里** —— prompt_library_test.mjs 已经验过
// `new Set(CATEGORIES.map(c => c.order)).size === CATEGORIES.length`。
// 同一判据、同一输入，两处各写一遍只是让失败时多一个误导性的位置。
//
// 而且本节原本想守的东西（别撞车）由上面**第 3 节**守着，那一条更强：
// 逐个验「分类的 order 不等于**任何原生段落**的 order」—— 原生 order 本身唯一，
// 所以唯一性由它蕴含。

// ══ 7. 撞车时排序会真的乱掉 —— 留个可执行的证据 ═══════════════════════════
{
  // 复现 dsh 的排序规则
  const cmp = (a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const before = [
    { name: "plan:policy", order: 500 },
    { name: "abc-my-rules", order: 500 },
  ].sort(cmp);
  const after = [
    { name: "plan:policy", order: 500 },
    { name: "zzz-my-rules", order: 500 },
  ].sort(cmp);

  eq(before[0].name, "abc-my-rules", "order 相同时，名字字典序小的排在前面");
  eq(after[0].name, "plan:policy", "换个名字就换位置 —— 所以绝不能撞 order");
}

done();
