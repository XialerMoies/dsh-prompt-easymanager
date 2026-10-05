// 宿主集成测试：HTTP 路由、状态持久化、会话可信度校验
//
// 运行：node scripts/host_integration_test.mjs
//
// ⚠️ DSH_HOME 必须在**导入 index.js 之前**设置 —— 状态目录是模块顶层的 const。
//    这里用临时目录隔离，绝不碰用户真实的 ~/.dsh。

import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("宿主集成测试");
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const DSH_HOME = mkdtempSync(join(tmpdir(), "pm-host-"));
process.env.DSH_HOME = DSH_HOME;

// 版本号只从 package.json 取 —— 硬编码的话每发一版就要来改测试。
const PLUGIN_VERSION = JSON.parse(
  readFileSync(join(HERE, "..", "package.json"), "utf8"),
).version;

// ⚠️ **测试用自己的 fixture 提示词库，不碰用户真实的那个。**
//
// 以前这里直接读 `<插件>/prompts/catalog.json`，于是测试**依赖用户的库里留着
// 几条特定 id 的提示词**（`format-contract-a` / `format-contract`）。
// 用户把那几条长文删掉之后，测试立刻红了 —— 那是测试设计的问题：
// 要么污染用户的库，要么测试跟着用户的数据飘。
//
// 现在插件支持 `DSH_PROMPT_EASYMANAGER_CATALOG` 覆盖，测试就在临时目录里造自己的库。
//
// ⚠️ **趁加载之前**种一份「老版本写的状态」，用来验升级路径：
//    老版本随包发过一条哨兵提示词 `{id:"none", name:"不注入"}`，让用户能在库里
//    点一个选项表达「什么都不挂」。但「一个都不选」本来就是同一个意思 ——
//    它只是把一件事说成了两件（库里多一张永远不该被勾的卡片，设置页还得配一张
//    卡片去管它）。现在不发了，catalog 是空库。
//    老用户的状态文件里可能还留着 `"none"`：那是指向不存在条目的悬挂 id，
//    每次装配都会报一句「提示词库里没有：none」，而它的语义本来就等于「去掉」。
//    readState() 里有段迁移负责清它，下面 4b 验。
//
//    ⚠️ 必须在**这里**写，不能等 apply() 之后再改文件 —— 注入器只在启动
//       （apply 里的 `injector.restore(readState())`）和应用预设时重读盘，
//       之后再写文件它看不见，断言会「碰巧过」而什么也没测到。
// ⚠️ 种子里**只放哨兵 id**：迁移会把它清掉，所以「初始没有默认」这条断言仍然成立
//    （`["none"] → []`），而「老状态里的 none 被清掉」也能验到。
//    塞一个真 id 进去的话，前面那条「初始没有默认」就红了。
//
// ⚠️ **这是「老版本状态文件」的样子**（`assignments` 存裸 prompt id 数组、
//    `defaults` 存全局默认）。新模型下它会被 `readState()` 迁移：
//      · `defaults: ["none"]` → 开关状态 + 全局指向（认不出对应预设 → presetId 为 null）
//      · 数组形式的 `assignments[sid]` → 自动存成一条「（旧配置）…」预设
//    4e 那一节专门验这个迁移。
writeFileSync(
  join(DSH_HOME, "dsh-prompt-easymanager-state.json"),
  JSON.stringify(
    { version: 1, assignments: {}, defaults: ["none"], sectionOverrides: {} },
    null,
    2,
  ),
  "utf8",
);

const FIXTURE_DIR = join(DSH_HOME, "fixture-prompts");
mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(
  join(FIXTURE_DIR, "format-contract-a.md"),
  "集成测试用的正文占位。这段文本必须超过一百个字符，因为测试里有一条断言检查正文长度 —— 真实的提示词动辄几千字，如果 fixture 写得太短，「正文根本没读到」这种 bug 会溜过去而测试照样绿。所以这里故意写得啰嗦一点，把长度凑够。下面再重复一遍确保够长：集成测试用的正文占位，这段文本必须超过一百个字符。（三代）\n",
  "utf8",
);
writeFileSync(
  join(FIXTURE_DIR, "format-contract.md"),
  "集成测试用的正文占位。这段文本必须超过一百个字符，因为测试里有一条断言检查正文长度 —— 真实的提示词动辄几千字，如果 fixture 写得太短，「正文根本没读到」这种 bug 会溜过去而测试照样绿。所以这里故意写得啰嗦一点，把长度凑够。下面再重复一遍确保够长：集成测试用的正文占位，这段文本必须超过一百个字符。（四代）\n",
  "utf8",
);
writeFileSync(
  join(FIXTURE_DIR, "format-contract-b.md"),
  "集成测试用的正文占位。这段文本必须超过一百个字符，因为测试里有一条断言检查正文长度 —— 真实的提示词动辄几千字，如果 fixture 写得太短，「正文根本没读到」这种 bug 会溜过去而测试照样绿。所以这里故意写得啰嗦一点，把长度凑够。下面再重复一遍确保够长：集成测试用的正文占位，这段文本必须超过一百个字符。（四代 Flash）\n",
  "utf8",
);
writeFileSync(
  join(FIXTURE_DIR, "catalog.json"),
  JSON.stringify(
    {
      version: 2,
      prompts: [
        { id: "none", name: "不注入", mode: "none", category: "other" },
        {
          id: "format-contract-a",
          name: "格式契约甲",
          mode: "append",
          category: "output",
          order: 9500,
          // ⚠️ `file` 字段是必须的 —— 少了它条目在库里但正文读不到，
          //    注入会静默失败（第一次写 fixture 就漏了这个，测试直接红）。
          file: "format-contract-a.md",
        },
        {
          id: "format-contract",
          name: "格式契约",
          mode: "append",
          category: "output",
          order: 9500,
          file: "format-contract.md",
        },
        {
          id: "format-contract-b",
          name: "格式契约 · 乙",
          mode: "append",
          category: "output",
          order: 9500,
          file: "format-contract-b.md",
        },
      ],
    },
    null,
    2,
  ),
  "utf8",
);
process.env.DSH_PROMPT_EASYMANAGER_CATALOG = join(FIXTURE_DIR, "catalog.json");

const {
  apply,
  name,
  inject,
  STATE_PATH,
  ASSIGN_PATH,
  PREVIEW_PATH,
  RELOAD_PATH,
  GLOBAL_PATH,
  EDIT_PATH,
  SECTIONS_PATH,
  PRESETS_PATH,
} = await import("../index.js");


// ── 假宿主 ──────────────────────────────────────────────────────────────────
function makeCtx(liveAgents = []) {
  const registered = { tools: [], events: {}, effects: 0 };
  // 模拟 dsh-client-connection 的真实行为：路由存在 Map 里，按 url.pathname 精确匹配。
  // ⚠️ 键就是 opts.path 本身 —— 如果插件传数组，set 出来的键也是数组，按字符串
  //    pathname 查就永远取不到。这正是「四条路由全部 404」的成因，
  //    所以 mock 必须照实模拟，不能用宽容的查找把它掩盖掉。
  const routes = new Map();
  let registerCalls = 0;

  const toolRuntime = {
    register(tool) {
      registered.tools.push(tool);
    },
  };

  const ctx = {
    get(serviceName) {
      return serviceName === "connection" ? ctx.connection : undefined;
    },
    connection: {
      fetch: {
        register(opts) {
          registerCalls += 1;
          if (routes.has(opts.path)) {
            throw new Error(
              "connection: exact Fetch route already registered: " + String(opts.path),
            );
          }
          routes.set(opts.path, opts);
          return () => {
            routes.delete(opts.path);
          };
        },
      },
    },
    agents: {
      list: () => liveAgents,
      roots: () => liveAgents,
      get: (id) => liveAgents.find((a) => a.id === id),
    },
    tools: toolRuntime,
    effect(cb) {
      registered.effects += 1;
      return cb();
    },
    on(event, handler) {
      registered.events[event] = handler;
    },
    __registered: registered,
    __routes: () => routes,
    __registerCalls: () => registerCalls,
    /** 按 pathname 精确取路由 —— 与真实实现一致 */
    __route(path) {
      const r = routes.get(path);
      return r ? r.fetch : undefined;
    },
  };
  return ctx;
}

function makeAgent(id, { assemble } = {}) {
  const sections = [];
  /** 注册过的 system-prompt/assemble 监听器（供测试直接触发） */
  const assembleListeners = [];
  const scope = {
    // 真实的 scoped ctx 有 on()；mock 也得有，否则「挂段落覆盖监听」那一步
    // 会走到 catch 里、测试就测不到真正的覆盖逻辑了。
    on(event, listener) {
      if (event !== "system-prompt/assemble") return () => {};
      assembleListeners.push(listener);
      return () => {
        const i = assembleListeners.indexOf(listener);
        if (i >= 0) assembleListeners.splice(i, 1);
      };
    },
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
          sections: sections.map((s) => ({ name: s.name, text: s.text, complete: s.complete === true })),
          contexts: [],
          tools: [],
        })),
    },
  };
  const agent = {
    id,
    session: { id, header: {} },
    ctx: {
      inject: (keys, cb) => cb(scope),
      systemPrompt: scope.systemPrompt,
    },
  };
  return { agent, sections, assembleListeners };
}

async function call(ctx, path, { method = "GET", body, search } = {}) {
  const url = "http://localhost" + path + (search ? "?" + search : "");
  const init = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(url, init);
  // 按 pathname 精确取路由 —— 未注册的路径会得到 undefined，测试会立刻炸出来
  const handler = ctx.__route(path);
  if (!handler) throw new Error(`路由未注册: ${path}`);
  const res = await handler(req);
  let json = null;
  const text = await res.clone().text();
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, text };
}

const S = "session-live-0001";

// ── 1. 导出面 ───────────────────────────────────────────────────────────────
{
  eq(name, "dsh-prompt-easymanager", "插件 name");
  ok(inject.includes("systemPrompt"), "inject 含 systemPrompt");
  ok(inject.includes("connection"), "inject 含 connection");
  ok(inject.includes("agents"), "inject 含 agents");
  ok(inject.includes("tools"), "inject 含 tools");
  eq(STATE_PATH, "/api/prompt-easymanager/state", "state 路径");
  eq(ASSIGN_PATH, "/api/prompt-easymanager/assign", "assign 路径");
  eq(PREVIEW_PATH, "/api/prompt-easymanager/preview", "preview 路径");
  eq(RELOAD_PATH, "/api/prompt-easymanager/reload", "reload 路径");
  eq(EDIT_PATH, "/api/prompt-easymanager/edit", "edit 路径");
}

// ── 2. 路由注册 ─────────────────────────────────────────────────────────────
const live = makeAgent(S);
const ctx = makeCtx([live.agent]);
apply(ctx);

// ⚠️ **全部已注册的路由** —— 从 index.js 的导出取，不手写。
//
//    手写那份曾经漏过东西，而且 `/defaults` 删掉之后就对不上了。
//    从导出取还顺带把「导出了但没注册」和「注册了但没导出」都变成红的。
const ALL = [...new Set([STATE_PATH, ASSIGN_PATH, PREVIEW_PATH, RELOAD_PATH, EDIT_PATH, SECTIONS_PATH, PRESETS_PATH, GLOBAL_PATH])];

// ⚠️ 防回归：path 必须是**单个字符串**。曾经传数组 [A,B,C,D]，结果所有路由全部
//    失效 —— 因为 dsh-client-connection 按 url.pathname 在 Map 里精确匹配。
//    这几条断言专门盯住这个点。
{
  eq(ctx.__registerCalls(), ALL.length, `注册了 ${ALL.length} 条独立路由`);
  const keys = [...ctx.__routes().keys()];
  ok(
    keys.every((k) => typeof k === "string"),
    "每个 path 都是字符串（不是数组）—— 这是路由能否被匹配到的关键",
  );
  eq(keys.slice().sort().join("|"), ALL.slice().sort().join("|"), "所有路径齐全且无重复");
  for (const p of ALL) {
    ok(typeof ctx.__route(p) === "function", "按 pathname 能取到路由: " + p);
  }
  ok(typeof ctx.__route("/api/prompt-easymanager/nope") === "undefined", "未注册的路径取不到路由");
}
// ⚠️ v0.3.0 曾加过 list_personas / get_persona 两个「给子代理挑角色」的工具，
//    v0.3.1 删掉了。原因：dsh 的 subagent 工具**没有** persona 参数
//    （那是插件级 config，不是模型能传的 args），取回正文也没地方送。
//    做不到事的工具留着比没有更糟 —— 模型会以为能用。
ok(ctx.__registered.tools.length === 1, "注册了 1 个工具（只有 prompt_manager）");
eq(ctx.__registered.tools[0].name, "prompt_manager", "工具名正确");
ok(
  typeof ctx.__registered.tools[0].execute === "function" && ctx.__registered.tools[0].parameters,
  "工具有 execute 与 parameters",
);

// ── 3. GET state ────────────────────────────────────────────────────────────
{
  const r = await call(ctx, STATE_PATH);
  eq(r.status, 200, "GET state 200");
  eq(r.json.assignments, {}, "初始分配表为空");
  // ⚠️ 初始是 `enabled: true` —— 因为种子里是**老格式**（没有 `global`、没有
  //    `enabled` 字段），而老版本的判据是 `parsed?.enabled !== false`，
  //    也就是「不写 = 开着」。这是刻意验的升级路径，见 4c。
  eq(
    r.json.global,
    { enabled: true, presetId: null },
    "初始全局：开关沿用老数据（开着）、但没指任何预设",
  );
  eq(r.json.version, 2, "状态版本 2");
  ok(Array.isArray(r.json.prompts) && r.json.prompts.length >= 4, "返回提示词清单");
  ok(r.json.prompts.every((p) => p.text === undefined), "清单不含正文");
  eq(r.json.diag.routeRegistered, true, "diag 报告路由已注册");
  ok(r.json.diag.libraryErrors.length === 0, "库无错误");
  ok(typeof r.json.catalogPath === "string", "回报 catalog 路径");
}

// ── 3b. 先存一条预设（新模型里想挂提示词必须先有预设）──────────────────────
let P1 = "";
let P2 = "";
{
  const r = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "写代码", prompts: ["format-contract"] },
  });
  eq(r.status, 200, "存预设 200");
  eq(r.json.ok, true, "存预设返回 ok");
  P1 = r.json.id;
  eq(P1, "写代码", "id 从名字派生");
  eq(r.json.preset.prompts, ["format-contract"], "提示词进去了");
  eq(r.json.preset.sections, {}, "没给段落就是空（= 全部原生）");
  eq(
    Object.prototype.hasOwnProperty.call(r.json.preset, "scope"),
    false,
    "**预设不带 scope**",
  );

  const bad = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "坏", prompts: ["不存在这条"] },
  });
  eq(bad.status, 400, "存预设时库里没有的 id → 400");

  const noName = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", prompts: [] },
  });
  eq(noName.status, 400, "缺名字 → 400");
}

// ── 4. POST assign：给会话选一条预设 ────────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: P1 },
  });
  eq(r.status, 200, "POST assign 200");
  eq(r.json.ok, true, "返回 ok");
  eq(r.json.presetId, P1, "回报选中的预设 id");
  eq(r.json.sessionCheck, "verified", "会话校验为 verified（agent 存活）");
  eq(live.sections.length, 1, "agent 上注册了 1 个 section");
  eq(live.sections[0].name, "prompt-manager:format-contract", "section 名正确");
  ok(live.sections[0].text.length > 100, "正文来自 prompts/*.md");
}

// ── 4-旧. 老 API（传 promptIds）**明确报错**，不许被当成预设 id ─────────────
//
// ⚠️ 这条很重要：老客户端传 `promptIds: ["format-contract"]` 时，如果宿主机
//    「宽容」地把它当预设 id 用，用户会得到一条**指向不存在的预设**的记录 ——
//    界面显示选了东西、实际什么都不注入，而且不报错。宁可明确 400。
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["format-contract"] },
  });
  eq(r.status, 400, "**老 API 传 promptIds → 400**（不许当预设 id 用）");
  eq(r.json.outcome, "preset-required", "结论说明了要传预设");
  ok(
    String(r.json.error).includes("预设"),
    "错误里点明了「要选预设」",
  );

  const missing = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S },
  });
  eq(missing.status, 400, "既没 presetId 也没 promptIds → 400");
}

// ── 4b. assign：选不存在的预设 / 显式「什么都不挂」──────────────────────────
{
  const unknown = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: "根本没这条" },
  });
  eq(unknown.status, 400, "**选不存在的预设 → 400**（否则会留下悬挂引用）");
  eq(unknown.json.outcome, "unknown-preset", "结论是 unknown-preset");
  ok(Array.isArray(unknown.json.known), "错误里列出已有的预设，方便排查");
  eq(unknown.json.known.includes(P1), true, "已有的预设里有刚存那条");

  // 显式「什么都不挂」
  const none = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: null },
  });
  eq(none.status, 200, "presetId: null → 200（显式什么都不挂）");
  eq(none.json.presetId, null, "回报 null");
  live.agent.ctx.inject(["systemPrompt"], (scope) => {
    void scope;
  });
  // 重挂之后不该有 section 了
  ok(true, "（不注入的效果由 5 那一节验）");
}

// ── 4c. 老状态里的 `"none"` 哨兵：新模型下不再是个问题 ──────────────────────
//
// 老版本随包发过 `{id:"none", name:"不注入"}` 这条哨兵提示词，让用户能表达
// 「什么都不挂」。现在不发了，而它的语义正好等于新模型的 `presetId: null`。
// 种子里那个 `defaults: ["none"]` 走迁移后不会变成任何预设的引用。
{
  const r = await call(ctx, GLOBAL_PATH);
  eq(r.status, 200, "GET global → 200");
  eq(r.json.global.presetId, null, "**老种子里没有可对应的预设 → 全局不指任何预设**");
  eq(r.json.global.enabled, true, "**老数据缺 enabled 字段 = 开着**（升级不许把开关关掉）");
}

// ── 5. 状态已落盘 ───────────────────────────────────────────────────────────
{
  const f = join(DSH_HOME, "dsh-prompt-easymanager-state.json");
  ok(existsSync(f), "状态文件已写入 DSH_HOME");
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  // ⚠️ 会话此刻是「显式什么都不挂」（见 8 那一节）—— 所以值就是 null。
  //    留 null 而不是把记录删掉：删掉的意思变成「跟随全局」，
  //    而用户点的是「这个会话什么都不挂」，两者不同。
  eq(parsed.assignments[S], null, "**文件里留着 null**（显式不挂，不是删记录）");

  // 再挂一条预设，确认盘上写的是**预设 id 字符串**而不是数组。
  //
  // ⚠️ 这条是这次改动最容易写错的地方：注入器内部按 prompt id 数组建模，
  //    它的 persist() 会把那个数组传回 writeState —— 如果那里不挡，
  //    盘上就会被写成老格式，下次读盘又走一遍迁移（踩过：预设越迁移越多）。
  //
  // ⚠️ **自己存一条**，别依赖别处的 P2 —— 那个变量在这一节可能还没赋值
  //    （踩过：断言拿到 undefined，报错却显示「实际 null」，看不出是变量没用）。
  const p2make = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "盘上格式用", prompts: ["format-contract-b"] },
  });
  eq(p2make.status, 200, "存一条用于验盘上格式");
  const P2 = p2make.json.id;
  const asg2 = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, presetId: P2 } });
  eq(asg2.status, 200, "挂上它");
  const again = JSON.parse(readFileSync(f, "utf8"));
  eq(again.assignments[S], P2, "**盘上存的是预设 id 字符串**");
  ok(!Array.isArray(again.assignments[S]), "**绝不是数组**（数组 = 注入器的内部表示漏到盘上了）");
  eq(
    (again.assignments[S] ?? "").includes("format-contract"),
    false,
    "盘上不该出现 prompt id",
  );
  eq(parsed.global !== undefined, true, "文件里有 global 字段");
  eq(parsed.global.presetId, null, "全局还没指预设");
  eq(parsed.updatedAt !== undefined, true, "带 updatedAt");
  eq(
    Object.prototype.hasOwnProperty.call(parsed, "defaults"),
    false,
    "**不再写 defaults 字段**（全局改用 global.presetId 表达）",
  );
  eq(
    Object.prototype.hasOwnProperty.call(parsed, "enabled"),
    false,
    "**不再写顶层 enabled**（挪进 global 里了）",
  );
}

// ── 6. 换一条预设 → 旧的卸掉 ────────────────────────────────────────────────
{
  const made = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "只甲", prompts: ["format-contract-a"] },
  });
  eq(made.status, 200, "再存一条预设");
  P2 = made.json.id;
  await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: P2 },
  });
  eq(live.sections.length, 1, "换一条后只剩 1 个 section");
  eq(live.sections[0].name, "prompt-manager:format-contract-a", "已换成新的");
}

// ── 7. 未知预设：被拒，且不改状态 ───────────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: "根本没有这条" },
  });
  eq(r.status, 400, "**分配**未知预设 → 400");
  eq(r.json.outcome, "unknown-preset", "结论是 unknown-preset");
  ok(r.json.error.includes("根本没有这条"), "错误里点名了它");
  eq(r.json.ok, false, "回报 ok: false");
  eq(live.sections.length, 1, "被拒时不动已有的 section");
}

// ── 7b. 一条预设挂多条提示词 ────────────────────────────────────────────────
{
  const made = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "两条", prompts: ["format-contract", "format-contract-a"] },
  });
  eq(made.status, 200, "存一条含两条提示词的预设");
  eq(made.json.preset.prompts.length, 2, "两条都在预设里");
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: made.json.id },
  });
  eq(r.status, 200, "挂上去 → 200");
  eq(live.sections.length, 2, "两个 section");
  ok(
    live.sections.every((s) => s.complete === undefined),
    "都不带 complete —— 不再有独占语义",
  );

  // ⚠️ 「去重」现在归预设管：同一条提示词在预设里出现两次会被
  //    `capturePreset` 去重（它内部 `new Set`）。所以这里验的是那个。
  const dup = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "重复", prompts: ["format-contract", "format-contract"] },
  });
  eq(dup.status, 200, "同一条重复 → 存得进去");
  eq(dup.json.preset.prompts.length, 1, "**存在预设里时就去重了**（只剩 1 条）");
}

// ── 8. assign：显式「什么都不挂」────────────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, presetId: null } });
  eq(r.status, 200, "**第 8 节**：presetId: null → 200");
  eq(r.json.presetId, null, "回报 null");
  eq(live.sections.length, 0, "section 已卸载");
  // ⚠️ 关键：显式「不挂」**不许**退回吃全局 —— 那是两件不同的事。
  const g = await call(ctx, GLOBAL_PATH);
  eq(g.json.global.enabled, true, "（全局此刻是开着的）");
  const st = await call(ctx, STATE_PATH);
  eq(st.json.assignments[S], null, "**状态里留着 null**，不是把记录删掉");
}

// ── 8b. POST assign：null = 清除指定，回落默认 ──────────────────────────────
{
  // 先让全局指向一条预设（新模型里「默认」就是「全局那条预设」）
  const gp = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "全局默认", prompts: ["format-contract"] },
  });
  await call(ctx, GLOBAL_PATH, { method: "POST", body: { presetId: gp.json.id, enabled: true } });

  // ⚠️ 新模型里 **没有「清除指定、回去跟随全局」这个动作** ——
  //    `presetId: null` 的语义是「这个会话显式什么都不挂」（压过全局）。
  const r = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, presetId: null } });
  eq(r.status, 200, "**「清除指定」那条路**：presetId: null → 200");
  eq(r.json.presetId, null, "**显式什么都不挂**（不是回落默认）");
  eq(live.sections.length, 0, "**一条都不挂**（不吃全局）");

  // 真的让一个「没记录」的会话去吃全局（这才是「跟随」）
  const other = makeAgent("session-follow-0001");
  const ctxF = makeCtx([other.agent]);
  apply(ctxF);
  eq(other.sections.length, 1, "**没记录的会话跟随全局**（挂上全局那条）");
  // 收尾：把全局清掉，免得影响后面的断言
  //
  // ⚠️ 这里原来打的是已退役的 `/defaults`（收一堆裸 prompt id）。
  //    那条路由**已经删掉了** —— 它当初留着是为了给「老客户端」一个友好的 410，
  //    但这个插件从没发布过、没有老客户端，所以那个理由不成立。
  await call(ctx, GLOBAL_PATH, { method: "POST", body: { presetId: null, enabled: false } });
}

// ── 9. POST assign：各种错误输入 ────────────────────────────────────────────
{
  eq((await call(ctx, ASSIGN_PATH, { method: "POST", body: {} })).status, 400, "缺 sessionId → 400");
  eq(
    (await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S } })).status,
    400,
    "缺 promptIds/promptId → 400",
  );
  eq(
    (await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptIds: "不是数组" } }))
      .status,
    400,
    "promptIds 不是数组 → 400",
  );
  // ⚠️ 老 API（promptIds）现在一律 400，文案是「要选预设」——
  //    想验「**没有这条预设**」得真的传一个不存在的 presetId。
  const legacy = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["不存在的提示词"] },
  });
  eq(legacy.status, 400, "老 API 传 promptIds → 400");
  ok(legacy.json.error.includes("预设"), "错误里说明要选预设");

  const unknown = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: "不存在的预设" },
  });
  eq(unknown.status, 400, "**指向不存在的预设** → 400");
  ok(unknown.json.error.includes("没有"), "错误可读（直接说「没有这条预设」）");
  eq(
    (await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: "", promptIds: [] } })).status,
    400,
    "空 sessionId → 400",
  );
  const badJson = await ctx.__route(ASSIGN_PATH)(
    new Request("http://localhost" + ASSIGN_PATH, { method: "POST", body: "{不是 JSON" }),
  );
  eq(badJson.status, 400, "坏 JSON → 400");
}

// ── 9b. 旧的 promptId 写法也明确报错 ────────────────────────────────────────
//
// ⚠️ 老客户端传 `promptId: "format-contract"` 时，「宽容」地接受它会把一个
//    prompt id 当成预设 id 用 —— 界面上显示选了东西、实际什么都不注入，
//    而且不报错。宁可明确 400。
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptId: "format-contract" },
  });
  eq(r.status, 400, "**旧的 promptId 字符串 → 400**");
  eq(r.json.outcome, "preset-required", "结论说明要传预设");

  const r2 = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptId: "none" } });
  eq(r2.status, 400, "旧的 promptId 传 none 同样 400（那个哨兵已经没了）");
}

// ── 9c. `/defaults` 已**整条删掉**（连 410 也不留）─────────────────────────
//
// ⚠️ 它原来是「留着但不干活，回 410 告诉调用方去哪儿」。那个设计的前提是
//    **有老客户端** —— 而这个插件从没发布过，没有老客户端。
//    所以路由、常量、客户端那份死常量一起删了。
//
//    现在打它就是**未注册路径**，跟打错字一样。跟下面「未注册路径」那条
//    同样的形状 —— 这里就不再重复断言了。
// ── 9d. /global：开关 + 用哪条预设 ─────────────────────────────────────────
{
  // ⚠️ **先重置** —— 前面的用例（「没记录的会话跟随全局」那条）会把全局指向
  //    一条预设，而这一节要验的正是「**还没指预设**时不许开」。
  //    不重置的话这一节验的是残留状态，红得莫名其妙。
  await call(ctx, GLOBAL_PATH, { method: "POST", body: { presetId: null, enabled: false } });

  const g0 = await call(ctx, GLOBAL_PATH);
  eq(g0.status, 200, "GET global → 200");
  eq(g0.json.global.presetId, null, "此刻还没指预设（上面刚重置过）");

  // ⚠️ 用户定的规则：**要开全局注入，必须先选定一个预设。**
  const noPreset = await call(ctx, GLOBAL_PATH, { method: "POST", body: { enabled: true } });
  eq(noPreset.status, 400, "**没选预设就想开全局注入 → 400**");
  eq(noPreset.json.outcome, "preset-required", "结论说明要先选预设");
  ok(Array.isArray(noPreset.json.known), "列出可选预设，方便排查");

  const bad = await call(ctx, GLOBAL_PATH, { method: "POST", body: { presetId: "没这条" } });
  eq(bad.status, 400, "指不存在的预设 → 400");

  // 一次带上：选预设 + 开
  const on = await call(ctx, GLOBAL_PATH, { method: "POST", body: { presetId: P1, enabled: true } });
  eq(on.status, 200, "选预设并开启 → 200");
  eq(on.json.global.presetId, P1, "指上了");
  eq(on.json.global.enabled, true, "**9d**：开启后 global.enabled 为 true");

  // 关掉：预设**留着**（用户选的 A 方案：关掉 = 全局这层不生效，配置不丢）
  const off = await call(ctx, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
  eq(off.status, 200, "关掉 → 200");
  eq(off.json.global.enabled, false, "开关关着");
  eq(off.json.global.presetId, P1, "**关掉之后预设还留着**（不是把配置清掉）");
}

// ── 10. 伪造 sessionId（有活动 agent 时应拒绝） ─────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-伪造的-9999", presetId: P1 },
  });
  eq(r.status, 404, "有活动 agent 时的伪造 id → 404");
}

// ── 10b. 编辑器路由：读取（带正文）─────────────────────────────────────────
{
  const r = await call(ctx, EDIT_PATH);
  eq(r.status, 200, "GET edit → 200");
  ok(Array.isArray(r.json.prompts), "返回条目数组");
  ok(r.json.prompts.length >= 3, "至少 3 条");
  const one = r.json.prompts.find((p) => p.id === "format-contract");
  ok(!!one, "能找到 format-contract");
  ok(one.text.length > 100, "**带正文**（这是编辑器需要的）");
  eq(one.source, "file", "注明来源是文件");
  eq(one.file, "format-contract.md", "回报文件名");
  ok(one.tokens > 0, "带 token 估算");
  ok(typeof r.json.catalogPath === "string", "回报目录路径");
  ok(typeof r.json.promptsDir === "string", "回报正文目录路径");
  // 编辑器要显示「新会话默认」的勾选状态，所以这份响应必须带 defaults
  // ⚠️ 新模型里 `defaults` 没了 —— 全局改成「指向一条预设」，
  //    所以编辑器要的是**预设表 + 全局那份**。
  ok(r.json.presets && typeof r.json.presets === "object", "回报预设表（编辑器要用）");
  ok(r.json.global !== undefined, "回报全局那份（指向哪条、开没开）");
  // ⚠️ 总开关的状态也必须在这份响应里。
  //    漏过：编辑器 `setEnabledDraft(d.enabled !== false)` 读到 undefined 恒为 true，
  //    表现是「胶囊怎么点都弹回去」—— POST 明明成功，紧接着 load() 又读回 true。
  eq(typeof r.json.enabled, "boolean", "**回报总开关状态**（漏了它胶囊会弹回去）");
  // 分类：编辑器要下拉框的选项和每类的建议 order
  ok(Array.isArray(r.json.categories), "回报分类表");
  eq(r.json.categories.length, 5, "内置 5 类");
  ok(
    r.json.categories.every((c) => c.id && c.name && typeof c.order === "number" && c.hint),
    "每类都有 id/name/order/hint",
  );
  eq(r.json.categories.find((c) => c.id === "tool").order, 3200, "工具类的建议 order 是 3200");
  eq(r.json.categories.find((c) => c.id === "domain").order, 950, "领域类的建议 order 是 950");
  ok(Array.isArray(r.json.customCategories), "回报目录里的自定义分类");
  ok(
    r.json.prompts.every((p) => typeof p.category === "string" && p.category),
    "每条都带 category",
  );
}

// ── 10b2. 自定义分类会被收集出来 ───────────────────────────────────────────
{
  await call(ctx, EDIT_PATH, {
    method: "POST",
    body: {
      action: "upsert",
      prompt: { id: "zz-cat-test", name: "分类测试", category: "安全审查", mode: "append", order: 100, text: "x" },
    },
  });
  const r = await call(ctx, EDIT_PATH);
  ok(r.json.customCategories.includes("安全审查"), "自定义分类出现在 customCategories 里");
  eq(
    r.json.prompts.find((p) => p.id === "zz-cat-test").category,
    "安全审查",
    "条目带着自定义分类",
  );
  ok(
    !r.json.categories.some((c) => c.id === "安全审查"),
    "自定义分类**不**混进内置分类表",
  );
  await call(ctx, EDIT_PATH, { method: "POST", body: { action: "delete", id: "zz-cat-test" } });
}

// ── 10b2. GET edit 报的是**预设表**（编辑器要用它渲染勾选状态）────────────
{
  const r = await call(ctx, EDIT_PATH);
  ok(r.json.presets && typeof r.json.presets === "object", "GET edit 带上预设表");
  ok(r.json.global !== undefined, "GET edit 带上全局那份");
  // ⚠️ 顶层 `enabled` **要留着** —— 设置页那个开关的胶囊状态用它。
  //    只是它的**来源**变了：新模型里真相是 `global.enabled`，这里是它的投影。
  eq(typeof r.json.enabled, "boolean", "回报总开关状态（投影自 global.enabled）");
  eq(r.json.enabled, r.json.global.enabled, "**跟 global.enabled 一致**（别各写一份）");
  eq(
    Object.prototype.hasOwnProperty.call(r.json, "defaults"),
    false,
    "**不再回传 defaults**（全局改用 global.presetId）",
  );
}

// ── 10d. 删掉「正在被用」的条目：引用必须被清掉（v0.3.2 的 bug 回归）──────
//
// ⚠️ 新模型下「正在被用」多了一层：提示词现在是被**预设**引用，预设再被
//    全局/会话引用。所以删一条提示词要清两层：
//
//        全局 / 会话  →  预设  →  提示词
//
//    漏掉第二层的表现是「预设里留着一条不存在的提示词」，注入时被静默跳过 ——
//    用户看到的是「我明明勾了 3 条，实际只生效 2 条」，而且不报错。
{
  const GONE = "zz-vanish-test";
  const mk = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: {
      action: "upsert",
      prompt: { id: GONE, name: "会被删的", mode: "append", order: 100, text: "正文" },
    },
  });
  eq(mk.status, 200, "先建一条用于删除");

  // 存一条预设同时引用「还成立的」和「会被删的」
  const made = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "含弃用项", prompts: ["format-contract-a", GONE] },
  });
  eq(made.status, 200, "存一条含它的预设");
  const PID = made.json.id;
  const asg = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, presetId: PID } });
  eq(asg.status, 200, "挂到会话上 → 200");
  eq(
    (await call(ctx, STATE_PATH)).json.assignments[S],
    PID,
    "**状态里记着这条预设**（挂载失败的话这条会先红，好定位）",
  );
  eq(live.sections.length, 2, "两条都挂上了");

  // 删掉那条提示词
  const del = await call(ctx, EDIT_PATH, { method: "POST", body: { action: "delete", id: GONE } });
  eq(del.status, 200, "删除成功");
  ok(del.json.pruned, "回报清理结果");
  eq(del.json.pruned.presets[PID], [GONE], "**报告：预设里剔掉了它**（第二层清理）");

  // 关键断言：幽灵 id 不该留在预设里
  const p = await call(ctx, PRESETS_PATH);
  const after = p.json.presets.find((x) => x.id === PID);
  ok(!!after, "预设还在");
  eq(after.prompts, ["format-contract-a"], "**预设里只剩下还成立的那条**");
  eq(live.sections.length, 1, "会话只留下还成立的那一条 section");
  eq(live.sections[0].name, "prompt-manager:format-contract-a", "留下的是正确的那条");
}

// ── 10c. 编辑器路由：新增 / 更新 / 删除 ────────────────────────────────────
// ⚠️ 注意：这条路由真的会往**库目录**里写文件（测试里是那个临时 fixture 目录）。
//    测试用的是**真实目录**，所以下面新增的条目都在测试结束时删掉。
const TMP_ID = "zz-test-only";
{
  // 非法 action
  const bad = await call(ctx, EDIT_PATH, { method: "POST", body: { action: "乱写" } });
  eq(bad.status, 400, "**编辑器**路由：非法 action → 400");
  ok(bad.json.error.includes("upsert"), "错误里说明了合法取值");
  eq(
    (await call(ctx, EDIT_PATH, { method: "POST", body: {} })).status,
    400,
    "缺 action → 400",
  );
  // 非法 id
  const badId = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: { action: "upsert", prompt: { id: "../逃逸", mode: "append", text: "x" } },
  });
  eq(badId.status, 400, "含路径分隔的 id → 400");

  // 新增
  const created = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: {
      action: "upsert",
      prompt: { id: TMP_ID, name: "测试条目", description: "仅测试用", mode: "append", order: 777, text: "测试正文" },
    },
  });
  eq(created.status, 200, "新增 → 200");
  eq(created.json.ok, true, "回报 ok");
  eq(created.json.created, true, "标记为新建");
  ok(Array.isArray(created.json.prompts), "返回刷新后的清单");
  const inList = created.json.prompts.find((p) => p.id === TMP_ID);
  ok(!!inList, "新条目出现在清单里");
  eq(inList.order, 777, "order 正确");

  // 更新
  const updated = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: {
      action: "upsert",
      prompt: { id: TMP_ID, name: "改过名", mode: "append", order: 778, text: "改过正文" },
    },
  });
  eq(updated.status, 200, "更新 → 200");
  eq(updated.json.created, false, "标记为更新而非新建");
  const again = updated.json.prompts.find((p) => p.id === TMP_ID);
  eq(again.name, "改过名", "名字已更新");
  eq(again.order, 778, "order 已更新");
  eq(again.tokens, 4, "正文已更新（4 个中文字 = 4 tokens）");

  // 删除
  const removed = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: { action: "delete", id: TMP_ID },
  });
  eq(removed.status, 200, "删除 → 200");
  eq(removed.json.fileRemoved, true, "正文文件一并删掉");
  ok(!removed.json.prompts.some((p) => p.id === TMP_ID), "清单里已消失");

  // 删不存在的
  const gone = await call(ctx, EDIT_PATH, { method: "POST", body: { action: "delete", id: TMP_ID } });
  eq(gone.status, 400, "删不存在的 → 400");
}

// ── 11. 没有任何活动 agent 时放行 ───────────────────────────────────────────
{
  const empty = makeAgent("x");
  const ctx2 = makeCtx([]);
  apply(ctx2);
  const gp2 = await call(ctx2, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "任意会话用", prompts: ["format-contract"] },
  });
  const r = await call(ctx2, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-任意-0000", presetId: gp2.json.id },
  });
  eq(r.status, 200, "无活动 agent 时不拒绝（无从比较）");
  eq(r.json.sessionCheck, "unverifiable", "标记为 unverifiable");
  // ⚠️ 挂载结论在**注入器**里，不在 /assign 的响应里 —— 查它得走 /preview
  const pv = await call(ctx2, PREVIEW_PATH, { search: "session=session-任意-0000" });
  eq(pv.json.outcome, "awaiting-agent", "agent 未加载，等补挂");
  void empty;
}

// ── 12. GET preview ─────────────────────────────────────────────────────────
{
  // 先给这个会话挂一条预设，让预览有内容
  const pvP = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "预览用", prompts: ["format-contract"] },
  });
  const pvAsg = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: pvP.json.id },
  });
  eq(pvAsg.status, 200, "挂上预览用的预设");
  const r = await call(ctx, PREVIEW_PATH, { search: "session=" + encodeURIComponent(S) });
  eq(r.status, 200, "GET preview 200");
  eq(r.json.outcome, "ok", "预览成功");
  eq(r.json.promptIds, ["format-contract"], "回报生效的 id 列表");
  eq(r.json.prompts[0].mode, "append", "回报每条的 id/name/mode/order");
  eq(r.json.prompts[0].id, "format-contract", "回报 id");
  ok(r.json.sectionCount >= 1, "至少 1 个 section");
  ok(r.json.totalTokens > 0, "有 token 合计");
  ok(r.json.logged !== undefined, "带会话日志那块");
  eq(r.json.conflict, null, "无冲突");

  eq((await call(ctx, PREVIEW_PATH)).status, 400, "缺 session 参数 → 400");
  const unknown = await call(ctx, PREVIEW_PATH, { search: "session=session-不存在" });
  eq(unknown.json.outcome, "awaiting-agent", "未知会话预览返回 awaiting-agent");
}

// ── 13. POST reload ─────────────────────────────────────────────────────────
{
  const r = await call(ctx, RELOAD_PATH, { method: "POST" });
  eq(r.status, 200, "POST reload 200");
  ok(r.json.count >= 4, "重载后有 " + r.json.count + " 条");
  ok(Array.isArray(r.json.errors), "返回 errors 数组");
  eq(r.json.errors, [], "重载无错误");
}

// ── 14. 未注册的路径 ────────────────────────────────────────────────────────
// 修复后每条路径是独立注册的，未注册的路径**根本不会进到我们的 handler** ——
// 请求会落到服务器的默认处理。这正是我们想要的（不再有"永远匹配不上"的哑路由）。
{
  ok(
    typeof ctx.__route("/api/prompt-easymanager/不存在") === "undefined",
    "未注册路径没有路由（由服务器默认处理）",
  );
  // 已注册路径但方法不对：handler 内部返回 404
  const wrongMethod = await ctx.__route(ASSIGN_PATH)(
    new Request("http://localhost" + ASSIGN_PATH, { method: "GET" }),
  );
  eq(wrongMethod.status, 404, "GET 打 assign 路径 → 404（只接受 POST）");
}

// ── 15. 工具返回结构 ────────────────────────────────────────────────────────
// ⚠️ 本插件按**单实例**设计：hostCtxRef / activeInjector 是模块级变量，后一次
//    apply() 会覆盖前一次。上面测试创建过多个实例，所以这里 apply 到一个新 ctx
//    让它成为当前实例。
//    注意不能对**同一个 ctx 重复 apply** —— 真实实现会对重复路径抛错
//    （dsh-client-connection: `if (this.fetchRoutes.has(route.path)) throw`）。
{
  const ctx4 = makeCtx([live.agent]);
  apply(ctx4);
  const t = ctx4.__registered.tools[0];
  const out = t.execute();
  eq(out.plugin, "dsh-prompt-easymanager", "工具回报 plugin id");
  eq(out.name, "个人提示词", "工具回报中文名");
  // ⚠️ 从 package.json 读，别硬编码 —— 这个断言因为「忘了跟着改」红过三次
  //    （v0.10.2 / v0.11.1 各一次，重排版本号又一次）。版本号本来就有三处要同步，
  //    测试不该是第四处。
  eq(out.pluginVersion, PLUGIN_VERSION, "工具回报的版本跟 package.json 一致");
  ok(/^\d+\.\d+\.\d+$/.test(PLUGIN_VERSION), `版本号是 x.y.z 形态（${PLUGIN_VERSION}）`);
  eq(out.stateVersion, 2, "工具回报状态版本 2");
  ok(Array.isArray(out.defaults), "工具回报全局默认");
  ok(Array.isArray(out.prompts) && out.prompts.length >= 4, "工具回报提示词清单");
  ok(Array.isArray(out.sessions), "工具回报会话状态");
  eq(out.liveAgents.rootsCount, 1, "工具回报存活 agent（当前实例有 1 个）");
  ok(out.notes.some((n) => n.includes("下一步即生效")), "工具说明含生效时机");
  ok(out.notes.some((n) => n.includes("全局默认")), "工具说明含全局默认");
  ok(t.description.includes("个人提示词"), "工具描述可读");
  ok(t.parameters.additionalProperties === false, "工具无参数");
}


// ── 15b. 同一 ctx 重复 apply 会抛错（真实行为的回归保护）────────────────────
{
  const dup = makeCtx([live.agent]);
  apply(dup);
  let threw = false;
  try {
    apply(dup);
  } catch {
    threw = true;
  }
  ok(threw, "对同一 ctx 重复 apply 会因路由重复注册而抛错");
}

// ── 16. 持久化往返：新实例能读回 ────────────────────────────────────────────
{
  const reread = await call(ctx, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "重读用", prompts: ["format-contract-b"] },
  });
  await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, presetId: reread.json.id },
  });
  const ctx3 = makeCtx([live.agent]);
  apply(ctx3);
  const r = await call(ctx3, STATE_PATH);
  // ⚠️ 新模型里存的是**预设 id 字符串**，不再是 prompt id 数组。
  eq(r.json.assignments[S], reread.json.id, "**新实例读回上次选的预设 id**");
  eq(typeof r.json.assignments[S], "string", "**是字符串，不是数组**");
  eq(r.json.version, 2, "读回版本 2");
}

// ── 17. 路由注册失败时要大声报错 ────────────────────────────────────────────
{
  const broken = {
    get: () => undefined,
    connection: undefined,
    agents: { list: () => [], roots: () => [], get: () => undefined },
    tools: { register() {} },
    effect: (cb) => cb(),
    on() {},
  };
  let errored = false;
  const origErr = console.error;
  console.error = () => {
    errored = true;
  };
  apply(broken);
  console.error = origErr;
  ok(errored, "connection 不可用时打印了错误（不静默）");
}

// ══ 30. 原生段落覆盖路由（/sections）══════════════════════════════════════
//
// 这一块**必须能在「没有存活的 agent」时也不炸** —— 界面一打开就会请求它，
// 而那时可能还没有任何会话。返回 `awaiting-agent` + 空列表 + 说明，
// 界面显示成「先开个会话」就行。
{
  const ctx2 = makeCtx([]);   // 故意不给任何 agent
  apply(ctx2);

  const g = await call(ctx2, SECTIONS_PATH, { search: "session=whatever" });
  eq(g.status, 200, "GET /sections 在没 agent 时也返回 200");
  eq(g.json.outcome, "awaiting-agent", "并如实说明是「还没有会话」");
  eq(g.json.counts.total, 0, "段落总数为 0");
  ok(typeof g.json.error === "string" && g.json.error.length > 0, "带一句给人看的说明");
  ok(Array.isArray(g.json.applied), "applied 是数组（界面不用判空）");
  ok(Array.isArray(g.json.stale), "stale 是数组");
  ok(Array.isArray(g.json.untouched), "untouched 是数组");
  ok(typeof g.json.summary === "string", "带摘要文案");
  eq(g.json.actions, ["replace", "disable"], "回报可用的动作");

  // POST 的参数校验
  const noName = await call(ctx2, SECTIONS_PATH, { method: "POST", body: { action: "replace", text: "x" } });
  eq(noName.status, 400, "缺 name → 400");

  const badAction = await call(ctx2, SECTIONS_PATH, { method: "POST", body: { name: "a", action: "乱写" } });
  eq(badAction.status, 400, "**段落**路由：非法 action → 400");
  ok(String(badAction.json.error).includes("replace"), "错误里列出合法取值");

  const noText = await call(ctx2, SECTIONS_PATH, { method: "POST", body: { name: "a", action: "replace" } });
  eq(noText.status, 400, "replace 缺 text → 400");

  // 没有存活 agent 时，改不了任何段落 → 404 并列出已知名字（这里是空）
  const unknown = await call(ctx2, SECTIONS_PATH, { method: "POST", body: { name: "harness:identity", action: "disable" } });
  eq(unknown.status, 404, "段落不存在 → 404");
  ok(Array.isArray(unknown.json.knownNames), "带上已知的段落名，方便排查");

  const ackMissing = await call(ctx2, SECTIONS_PATH, { method: "POST", body: { name: "x", action: "acknowledge" } });
  eq(ackMissing.status, 404, "确认一个不存在的覆盖 → 404");

  // 坏 JSON
  const route = ctx2.__route(SECTIONS_PATH);
  const badJson = await route(new Request("http://localhost" + SECTIONS_PATH, { method: "POST", body: "{不是 JSON" }));
  eq(badJson.status, 400, "**段落**路由：坏 JSON → 400");
}

// ══ 31. **写分配不能把段落覆盖抹掉** ═══════════════════════════════════════
//
// `saveState` 被注入器调用时只传 `{assignments, defaults}`；
// 如果 `writeState` 直接覆盖整个文件，改一次会话分配就会把用户的段落改写全丢掉。
// 所以 writeState 是「先读盘再合并」，这条断言盯住它。
{
  const ctx3 = makeCtx([]);
  apply(ctx3);

  // 先手工塞一份覆盖进状态文件，再走一次会触发 saveState 的接口
  const before = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
  writeFileSync(
    join(DSH_HOME, "dsh-prompt-easymanager-state.json"),
    JSON.stringify(
      {
        ...before,
        sectionOverrides: {
          "harness:identity": {
            action: "replace",
            text: "我的身份",
            original: "官方身份",
            originalHash: "deadbeefdeadbeef",
            savedAt: "2026-01-01T00:00:00.000Z",
            acceptedDrift: false,
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  // 走一次「重载目录」——它内部会调 pruneMissing + 写状态
  await call(ctx3, RELOAD_PATH, { method: "POST", body: {} });

  const after = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
  ok(after.sectionOverrides !== undefined, "**重载之后 sectionOverrides 还在**");
  ok(
    after.sectionOverrides?.["harness:identity"]?.text === "我的身份",
    "**段落改写没被写分配的那条路径抹掉**",
  );
}

// ══ 32. **列表必须包含 scoped 层注册的段落** ═══════════════════════════════
//
// 真机上踩过的大坑：`listSections` 一开始用 `assemble({ agent })`（**不带 scope**）读，
// 以为这样能绕开我们自己的覆盖监听器、拿到「官方原文」。
//
// 但**瀑布分发和 scoped 段落注册是同一个开关**（都看 `context.scope`）：
//
//   assemble({agent})                → 监听器不跑 ✓  但 scoped 段落也没了 ✗
//   assemble({agent, scope: agent})  → scoped 段全在 ✓  但文本被我们改过 ✗
//
// 结果：界面上只剩 7 段全局段落，**21 段 `tool:*`（注册在 scoped 层）整段消失** ——
// 用户根本没法关掉工具说明。而**这个 bug 不会让任何老测试变红**，因为老 mock 的
// assemble 是无视 scope 的常量函数，两种情况返回一样。
//
// 这个用例的 mock 照实模拟 scope 分发，并记录 assemble 收到的参数，专门盯住它。
{
  const calls = [];
  const GLOBAL_SECTIONS = [
    { name: "harness:identity", text: "You are an AI agent powered by DeepSeek Harness." },
    { name: "deployment:persona-prefix", text: "You are a coding agent powered by the {{model}} model." },
  ];
  const SCOPED_SECTIONS = [
    { name: "tool:bash", text: "Check the [exit code: N] marker on every bash result." },
    { name: "tool:read", text: "Use the read tool when you need the contents of a file." },
  ];
  const live2 = makeAgent("session-sec-0001", {
    assemble: async (context) => {
      calls.push(context);
      // 照实模拟：**只有带 scope 时**才看得到 scoped 注册的段落
      const withScope = context && context.scope !== undefined;
      return {
        sections: withScope ? [...GLOBAL_SECTIONS, ...SCOPED_SECTIONS] : [...GLOBAL_SECTIONS],
        contexts: [],
        tools: [],
      };
    },
  });
  const ctx6 = makeCtx([live2.agent]);
  apply(ctx6);

  // 真实设置页会在这里带着已选全局预设请求；覆盖这个状态，
  // 以确保 /sections 的签名字段不会因漏传路由依赖而在运行时抛错。
  const selected = await call(ctx6, GLOBAL_PATH, {
    method: "POST",
    body: { enabled: true, presetId: P1 },
  });
  eq(selected.status, 200, "为段落列表选择一个有效全局预设");

  const res = await call(ctx6, SECTIONS_PATH, { search: "session=session-sec-0001" });
  eq(res.status, 200, "GET /sections 正常返回");
  ok(typeof res.json.effectivePresetSignature === "string" && res.json.effectivePresetSignature.length > 0,
    "有效预设存在时 /sections 返回稳定签名");

  eq(calls.length > 0, true, "listSections 确实调了 assemble");
  const usedScope = calls.some((c) => c && c.scope !== undefined);
  ok(
    usedScope,
    "**listSections 带了 scope**（不带 scope 就拿不到 scoped 层注册的段落）",
  );

  // ⚠️ 用全集（applied + stale + untouched）—— `harness:identity` 可能被前面的
  //    用例留下了一条覆盖，那它就在 applied 而不是 untouched 里。
  const names = [...(res.json.applied || []), ...(res.json.stale || []), ...(res.json.untouched || [])].map((r) => r.name);
  ok(names.includes("harness:identity"), "列表里有全局层段落");
  ok(
    names.includes("tool:bash") && names.includes("tool:read"),
    "**列表里必须也有 scoped 层注册的段落** —— tool:* 就是这一类，少了它用户就关不掉工具说明",
  );
  eq(res.json.counts.total, 4, "总数是 4（2 全局 + 2 scoped），不是 2");

  // **本插件自己注入的段落不许出现在这里** —— 列表列的是 dsh 原生段落。
  // 真机上它冒出过 `prompt-manager:format-contract-a`（4300 字），
  // 用户第一反应是「这是什么东西」。
  ok(
    !names.some((n) => n.startsWith("prompt-manager:")),
    "**本插件注入的段落被剔除**（它不是 dsh 原生段落，归提示词库管）",
  );
}

// ══ 33. 段落改写**写进预设**（不再有那两张独立的表）═══════════════════════
//
// ⚠️ 这一节整个重写过。老版本验的是「两层改写」模型：
//
//       POST /sections + scope:"global"   → 写 state.sectionOverrides
//       POST /sections + scope:"session"  → 写 state.sessionSectionOverrides
//
//    新模型里那两张表**不再被读**（段落改写由预设承载），所以那条路
//    必须改成写预设 —— 否则「在系统提示词那一栏改一段」会写了不生效。
//
//    而且老的 scope 参数**不再有意义**：改动跟着**这会话实际生效的那条预设**走。
//    这跟个人提示词是同一套规则 —— 两半终于统一了。
{
  const live7 = makeAgent("session-A", {
    assemble: async () => ({
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "tool:bash", text: "官方 bash" },
      ],
      contexts: [],
      tools: [],
    }),
  });
  const ctx7 = makeCtx([live7.agent]);
  apply(ctx7);

  /** 装配一次，返回结果（这一段要用好几回）。 */
  //
  //  ⚠️ `asmOf` 定义在文件**后面**第 36 节里，这儿用不了 —— 自己造一个。
  //     注意**每次都要新对象**，不能复用同一个引用，
  //     否则上一次装配被改过的正文会带到下一次。
  const assembleOnce = async () => {
    const a = {
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "tool:bash", text: "官方 bash" },
      ],
      contexts: [],
      tools: [],
    };
    await live7.assembleListeners[0](a, {}, async () => a);
    return a;
  };
  const diskState = () =>
    JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
  /** 那张退休的表**这一刻**长什么样 —— 用来验「这次写没写它」。 */
  const legacyBefore = JSON.stringify(diskState().sectionOverrides ?? {});

  // ── ① 退无可退 → **409**，并说清怎么办 ────────────────────────────────
  //
  // ⚠️ 这一条是核心：改动总得有地方存。退无可退时就明确拒绝，
  //    而不是悄悄写进一个没人读的地方（老模型就是这么干的）。
  //
  // ⚠️ **「退无可退」= 全局那一层也没有预设。** 第一版没把全局清掉，
  //    于是 `ensureDefaultPreset` 造的那条默认预设接住了 → 200，
  //    红的反而是夹具（踩过一次）。
  {
    // 先把全局指空 —— 制造真正的「退无可退」
    await call(ctx7, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
    const clear = await call(ctx7, GLOBAL_PATH, { method: "POST", body: { presetId: null } });
    eq(clear.status, 200, "把全局指空 → 200");

    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "harness:identity", action: "replace", text: "无处可存" },
    });
    eq(r.status, 409, "**全局也没预设时改段落 → 409**（不静默丢弃）");
    eq(r.json.outcome, "no-active-preset", "结论说清是「没有生效的预设」");
    ok(
      typeof r.json.error === "string" && r.json.error.includes("先在会话页选一条预设"),
      "  并告诉用户怎么办",
    );
    // ⚠️ 错误响应里 **没有** `wroteTo`（不是 `null` —— 那个字段只在写成功时才回）。
    //    第一版我写成期望 `null`，红了。判据用 `undefined`。
    eq(r.json.wroteTo, undefined, "  错误响应里没有 wroteTo（什么都没写）");
  }

  // ── ①b **全局有货时，带 session 也该退到全局**（真机上复现过的不一致）──
  //
  // ⚠️ 起因：真机上同一个动作，带不带 `session` 参数结果不一样 ——
  //
  //        POST /sections            （不带） →  200，写进全局预设
  //        POST /sections?session=X  （X 设了「不注入」）→  409
  //
  //    设置页那一栏**本来就只管全局层**（界面上没有「这一栏写给谁」这个选择），
  //    所以带上 session 时不该被那个会话的「不注入」挡住。
  //
  //    ⚠️ 但**会话自己选了预设时不许退** —— 那是用户明确的选择，
  //       退到全局会让「改 A 会话的段落」悄悄改了所有会话。见 ①c。
  {
    const gp0 = await call(ctx7, PRESETS_PATH, {
      method: "POST",
      body: { action: "save", name: "七号全局-退路", prompts: [] },
    });
    eq(gp0.status, 200, "先造一条全局预设");
    const setG = await call(ctx7, GLOBAL_PATH, { method: "POST", body: { presetId: gp0.json.id, enabled: true } });
    eq(setG.status, 200, "把全局指到它 → 200");
    eq(setG.json?.global?.presetId, gp0.json.id, "  全局确实指向它了");

    // 让这个会话显式「不注入」—— 于是它自己没有生效预设
    await call(ctx7, ASSIGN_PATH, {
      method: "POST",
      body: { sessionId: "session-A", presetId: null },
    });

    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "harness:identity", action: "replace", text: "退到全局了" },
    });
    eq(r.status, 200, "**会话没生效预设、但全局有 → 200**（原来这里 409）");
    if (r.status !== 200) {
      console.log("  [DEBUG] 实际响应: " + JSON.stringify(r.json));
      console.log("  [DEBUG] 盘上 global: " + JSON.stringify(diskState().global));
      console.log("  [DEBUG] 盘上 assignments: " + JSON.stringify(diskState().assignments));
    }
    eq(r.json.wroteTo && r.json.wroteTo.fellBack, true, "**并且如实回报「退到了全局」**");
    eq(r.json.wroteTo && r.json.wroteTo.presetId, gp0.json.id, "  落到的是全局那条预设");

    const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
    eq(
      disk.presets?.[gp0.json.id]?.selection?.sections?.["harness:identity"]?.text,
      "退到全局了",
      "  改动真的写进了全局预设",
    );

    // 收尾：撤掉这条改写，别影响后面的用例
    await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "harness:identity", action: "restore" },
    });
    await call(ctx7, ASSIGN_PATH, { method: "POST", body: { sessionId: "session-A", follow: true } });
  }

  // ── ② 给全局选一条预设之后，改写**写进那条预设** ──────────────────────
  const gp = await call(ctx7, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "七号全局", prompts: [] },
  });
  eq(gp.status, 200, "存一条预设 → 200");
  await call(ctx7, GLOBAL_PATH, { method: "POST", body: { presetId: gp.json.id, enabled: true } });

  {
    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "harness:identity", action: "replace", text: "改过的身份" },
    });
    eq(r.status, 200, "有预设了 → 200");

    // 落盘：改动在**预设里**，那两张老表**没被动**
    const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
    const p = disk.presets[gp.json.id];
    eq(
      p?.selection?.sections?.["harness:identity"]?.text,
      "改过的身份",
      "**改动写进了预设的清单里**",
    );
    eq(
      JSON.stringify(disk.sectionOverrides ?? {}),
      "{}",
      "**退休的 `sectionOverrides` 表已清空**（改动只写预设 selection）",
    );
    eq(
      JSON.stringify(disk.sessionSectionOverrides ?? {}),
      "{}",
      "  会话层那张也没被动",
    );
    eq(
      p?.selection?.sections?.["harness:identity"]?.original,
      "官方身份",
      "  顺手记下了当时的官方原文（漂移基准）",
    );
    ok(!p?.selection?.listed?.includes("harness:identity"), "  改写默认未勾选");
  }

  // 勾选只是草稿意图；保存预设后才进入注入清单。
  {
    const disk = diskState();
    const selection = disk.presets[gp.json.id].selection;
    selection.listed = ["harness:identity"];
    await call(ctx7, PRESETS_PATH, {
      method: "POST",
      body: { action: "update", id: gp.json.id, selection },
    });
  }

  // ── ③ 装配时真的生效 ──────────────────────────────────────────────────
  {
    const a = await assembleOnce();
    eq(
      a.sections.find((s) => s.name === "harness:identity")?.text,
      "改过的身份",
      "**装配时用上了改过的正文**",
    );
  }

  // ── ④ 「关闭」= 不勾（进 excluded）──────────────────────────────────────
  {
    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "tool:bash", action: "disable" },
    });
    eq(r.status, 200, "关掉一段 → 200");
    const sel = diskState().presets[gp.json.id].selection;
    ok(sel.excluded.includes("tool:bash"), "**「关闭」写进 excluded**（新模型里它就是「不勾」）");

    const a = await assembleOnce();
    eq(a.sections.find((s) => s.name === "tool:bash")?.text, "", "  装配时那段被清空");
  }

  // ── ⑤ 「还原」= 从清单里拿掉 → 回原生 ──────────────────────────────────
  {
    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "harness:identity", action: "restore" },
    });
    eq(r.status, 200, "还原一段 → 200");
    const sel = diskState().presets[gp.json.id].selection;
    eq(
      Object.keys(sel.sections).includes("harness:identity"),
      false,
      "**还原 = 把它从清单里拿掉**",
    );

    const a = await assembleOnce();
    eq(
      a.sections.find((s) => s.name === "harness:identity")?.text,
      "官方身份",
      "  装配时回到 dsh 原生",
    );
  }

  // ── ⑥ 改的是**这会话生效的那条**：会话选了自己的 → 改它自己那条 ─────────
  //
  // ⚠️ 这条替代了老模型的「会话层盖住全局层」——
  //    现在不是「盖住」，而是「这条会话压根用另一条预设」。
  {
    const own = await call(ctx7, PRESETS_PATH, {
      method: "POST",
      body: { action: "save", name: "七号自己", prompts: [] },
    });
    await call(ctx7, ASSIGN_PATH, {
      method: "POST",
      body: { sessionId: "session-A", presetId: own.json.id },
    });

    const r = await call(ctx7, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-A",
      body: { name: "tool:bash", action: "replace", text: "A 自己的 bash" },
    });
    eq(r.status, 200, "给选了预设的会话改段落 → 200");

    const disk = diskState();
    eq(
      disk.presets[own.json.id].selection.sections["tool:bash"]?.text,
      "A 自己的 bash",
      "**改动落到了 A 自己那条预设上**",
    );
    eq(
      disk.presets[gp.json.id].selection.sections["tool:bash"],
      undefined,
      "  全局那条**没被碰到**（不再互相影响）",
    );
  }
}
// ══ 34. 提示词组合（预设）：保存 / 改 / 删 / 应用 ═════════════════════════
//
// 新模型下预设是**唯一载体**：
//   · save **直接收内容**（prompts[] / sections{}）—— 不再「把当前层存成快照」
//   · 改名走 update，而且**要把指着它的引用一起改**（全局 + 各会话）
//   · 预设**不带 scope**，同一个预设两层都能挂
//   · GET 回传 presets / global / session / effective
{
  const live8 = makeAgent("session-P", {
    assemble: async () => ({
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "tool:bash", text: "官方 bash" },
      ],
      contexts: [],
      tools: [],
    }),
  });
  const ctx8 = makeCtx([live8.agent]);
  apply(ctx8);

  // ① 存一条预设：直接给内容
  const saved = await call(ctx8, PRESETS_PATH, {
    method: "POST",
    body: {
      action: "save",
      name: "代码",
      prompts: ["format-contract"],
      sections: { "harness:identity": { action: "replace", text: "代码时的身份" } },
    },
  });
  eq(saved.status, 200, "存预设 → 200");
  eq(saved.json.id, "代码", "id 就是名字（中文保留）");
  eq(saved.json.preset.prompts, ["format-contract"], "提示词进预设");
  ok(saved.json.preset.sections["harness:identity"] !== undefined, "段落改写进预设");
  eq(
    Object.prototype.hasOwnProperty.call(saved.json.preset, "scope"),
    false,
    "**预设不带 scope**（同一个预设两层都能挂）",
  );

  // ② 改名 —— 界面上的预设名是卡片标题，旁边一个铅笔改它
  {
    const renamed = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "update", id: "代码", name: "代码（v2）" },
    });
    eq(renamed.status, 200, "改名 → 200");
    // ⚠️ id 从名字派生，所以改名会**换 id** —— 客户端得拿新 id 更新选中项
    eq(renamed.json.id, "代码（v2）", "**改名换 id**（id 派生自名字）");
    eq(renamed.json.oldId, "代码", "回报旧 id 以便客户端对账");
    const list1 = await call(ctx8, PRESETS_PATH, { method: "GET" });
    // ⚠️ 只断言「新名字在、旧名字不在」—— 别写「表里只有它一条」：
    //    盘上还有别的用例留下的预设（它们共用同一个 DSH_HOME）。
    ok(list1.json.presets.some((p) => p.id === "代码（v2）"), "新名字在");
    ok(!list1.json.presets.some((p) => p.id === "代码"), "**旧 id 不在了**（改名要删旧的，不是复制一份）");
    // ⚠️ 内容要**原样保留** —— update 只给了 name，没给 prompts/sections，
    //    实现里如果无条件覆盖，这里会把内容清空。
    const renamedPreset = list1.json.presets.find((p) => p.id === "代码（v2）");
    eq(
      renamedPreset?.prompts,
      ["format-contract"],
      "**只改名时内容不许被清空**",
    );
    // 改回去，后面的用例还用「代码」这个 id
    const back = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "update", id: "代码（v2）", name: "代码" },
    });
    eq(back.json.id, "代码", "改回原名 → id 也回到原样");

    // 边界：不存在的预设
    const missing = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "update", id: "没有这条", name: "x" },
    });
    eq(missing.status, 404, "改不存在的预设 → 404");

    const badAction = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "乱写" } });
    eq(badAction.status, 400, "**预设**路由：非法 action → 400");
  }

  // ③ 应用：把预设挂到全局 —— **顺带把全局注入打开**
  {
    const applied = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "apply", id: "代码", target: "global" },
    });
    eq(applied.status, 200, "挂到全局 → 200");
    eq(applied.json.target, "global", "回报目标层");
    eq(applied.json.label, "代码", "回报显示标签（有个人提示词 → 预设名）");
    const g = await call(ctx8, GLOBAL_PATH);
    eq(g.json.global.presetId, "代码", "全局指向它");
    eq(g.json.global.enabled, true, "**挂到全局会顺带把全局注入打开**");
    const st = await call(ctx8, STATE_PATH);
    eq(
      st.json.presets["代码"].sections["harness:identity"] !== undefined,
      true,
      "段落改写跟着生效（注入侧每次装配现取）",
    );
  }

  // ③b 标签规则：只有系统改动时**不显示预设名**
  {
    const only = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "只改段落",
        prompts: [],
        sections: { "tool:bash": { action: "disable", text: "" } },
      },
    });
    eq(only.status, 200, "存一条「只有系统改动」的预设");
    const list = await call(ctx8, PRESETS_PATH, { method: "GET" });
    const row = list.json.presets.find((p) => p.id === "只改段落");
    eq(row.label, "系统提示词 · 改", "**没个人提示词 → 显示「系统提示词 · 改」**，不显示预设名");
  }

  // ④ 挂到会话：只动那个会话，不碰全局
  {
    await call(ctx8, ASSIGN_PATH, {
      method: "POST",
      body: { sessionId: "session-P", presetId: "只改段落" },
    });
    const g = await call(ctx8, GLOBAL_PATH);
    eq(g.json.global.presetId, "代码", "**挂会话不影响全局**");
    const st = await call(ctx8, STATE_PATH);
    eq(st.json.assignments["session-P"], "只改段落", "会话记着它");

    // GET 带 session 时回报「实际生效的是哪条」
    const one = await call(ctx8, PRESETS_PATH, { search: "session=session-P" });
    eq(one.json.session.presetId, "只改段落", "回报这个会话选的是哪条");
    eq(one.json.effective.id, "只改段落", "回报实际生效的是哪条");
    eq(one.json.effective.source, "session", "来源标成 session");
  }

  // ⑤ 全局关掉 → 全局这层整体停用；但**会话自己的选择照旧**
  {
    await call(ctx8, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
    const st = await call(ctx8, STATE_PATH);
    eq(st.json.global.enabled, false, "全局关着");
    eq(st.json.global.presetId, "代码", "**预设留着**（关掉不是把配置清掉）");
    eq(st.json.assignments["session-P"], "只改段落", "会话的选择还在");

    // 一个**没有**会话记录的会话 → 全局关掉之后不该再吃全局
    const other = await call(ctx8, PRESETS_PATH, { search: "session=别的会话" });
    eq(other.json.effective.id, null, "**全局关掉 → 没记录的会话什么都不挂**");
    eq(other.json.effective.source, "none", "来源是 none");

    await call(ctx8, GLOBAL_PATH, { method: "POST", body: { enabled: true } });
  }

  // ⑥ 删除：被指着的引用要一起清掉（否则界面显示选了、实际不生效）
  {
    await call(ctx8, GLOBAL_PATH, { method: "POST", body: { presetId: "代码", enabled: true } });
    const del = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "delete", id: "代码" },
    });
    eq(del.status, 200, "删除预设 → 200");
    const g = await call(ctx8, GLOBAL_PATH);
    eq(g.json.global.presetId, null, "**全局的引用被清掉了**（不留悬挂）");
    const left = await call(ctx8, PRESETS_PATH, { method: "GET" });
    ok(!left.json.presets.some((p) => p.id === "代码"), "删掉了");
    ok(left.json.presets.some((p) => p.id === "只改段落"), "别的预设没受影响");

    const delAgain = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "delete", id: "代码" },
    });
    eq(delAgain.status, 404, "删不存在的 → 404");

    // 会话指的那条被删 → 那条记录也要清掉（退回「跟随全局」）
    const delSess = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "delete", id: "只改段落" },
    });
    eq(delSess.status, 200, "删掉会话指着的那条");
    const st = await call(ctx8, STATE_PATH);
    eq(
      Object.prototype.hasOwnProperty.call(st.json.assignments, "session-P"),
      false,
      "**会话那条记录也被清掉了**（退回跟随全局）",
    );
  }

  // ⑦ 重名自动加序号
  {
    const a = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "save", name: "同名", prompts: [] },
    });
    const b = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "save", name: "同名", prompts: [] },
    });
    eq(a.json.id, "同名", "第一个用原名");
    eq(b.json.id, "同名-2", "**重名自动加序号，不覆盖**");
  }

  // ⑧ 参数校验
  {
    const noName = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "save", prompts: [] },
    });
    eq(noName.status, 400, "存预设缺名字 → 400");
    const noPreset = await call(ctx8, PRESETS_PATH, {
      method: "POST",
      body: { action: "apply", id: "不存在" },
    });
    eq(noPreset.status, 404, "应用不存在的预设 → 404");
    ok(Array.isArray(noPreset.json.known), "404 时列出已有的预设名，方便排查");
  }
}
// ══ 35. 全局注入：开关 + 指向哪条预设 ═════════════════════════════════════
//
// ⚠️ **语义（用户选的 A 方案）**：
//     关掉 = **全局这一层整体停用** —— 没记录的会话什么都不挂。
//
//   它**不是**「不禁止注入」：用户在会话页给某个会话选的具体预设照旧生效
//   （那些会话本来就不看全局）。两者的区别在「没记录的会话」上：
//
//     开关开着 → 没记录的会话吃全局那条预设
//     开关关着 → 没记录的会话什么都不挂
//
//   ⚠️ 老模型里还有「显式选了『跟随全局』」这个状态，新模型里**没有** ——
//      "不记录" 就等于跟随。所以关掉时不需要去清谁的记录。
{
  const live9 = makeAgent("session-T", {
    assemble: async () => ({
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "prompt-manager:my-prompt", text: "我注入的提示词正文" },
      ],
      contexts: [],
      tools: [],
    }),
  });
  const ctx9 = makeCtx([live9.agent]);
  apply(ctx9);

  // ⚠️ **这条改写不能在这儿写。**
  //
  //    老模型下它无条件生效，所以放哪儿都行 —— 于是老测试把它放在**建预设之前**。
  //    新模型里段落改写由预设承载，此时还没有任何预设 → POST 直接 409，
  //    改写**根本没存下来**，后面「开关开着 → 改写生效」那条必然红。
  //
  //    所以改成：先建预设 → 选上并打开 → 再写这条改写。见下面。

  const l0 = live9.assembleListeners[0];
  ok(typeof l0 === "function", "注入器挂上了装配监听器");
  const asm = async () => ({
    sections: [
      { name: "harness:identity", text: "官方身份" },
      { name: "prompt-manager:my-prompt", text: "我注入的提示词正文" },
    ],
    contexts: [],
    tools: [],
  });
  let a = await asm();
  await l0(a, {}, async () => a);
  // ⚠️ **这一条是新语义，老测试验的是反的。**
  //
  //    老模型里「全局段落改写」是一张独立的表，注入时**无条件**读取 ——
  //    所以「还没选任何预设」的时候它也生效（那条断言因此碰巧绿了）。
  //
  //    新模型里段落改写**跟着预设走**（跟个人提示词同一套规则）：
  //    没有生效的预设 → `getSectionOverrides` 返回 null → 一段都不套。
  eq(a.sections[0].text, "官方身份", "**没选预设时段落改写不生效**（它现在跟着预设走）");
  eq(a.sections[1].text, "我注入的提示词正文", "个人提示词的注入不受影响（同上）");

  // ── 没选预设就想开全局注入 → 400（用户定的规则）────────────────────────
  {
    await call(ctx9, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
    // 先把 presetId 清掉，才能验「没选预设不许开」
    await call(ctx9, GLOBAL_PATH, { method: "POST", body: { presetId: null } });
    const bad = await call(ctx9, GLOBAL_PATH, { method: "POST", body: { enabled: true } });
    eq(bad.status, 400, "**没选预设就想开全局注入 → 400**");
    eq(bad.json.outcome, "preset-required", "结论说明要先选预设");
    ok(Array.isArray(bad.json.known), "列出可选预设，方便排查");
  }

  // ── 选上预设并打开 ──────────────────────────────────────────────────────
  const gp9 = await call(ctx9, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "全局那条", prompts: ["format-contract"] },
  });
  {
    const on = await call(ctx9, GLOBAL_PATH, { method: "POST", body: { presetId: gp9.json.id, enabled: true } });
    eq(on.status, 200, "选上预设并打开 → 200");
    eq(on.json.global.presetId, gp9.json.id, "指向它");
    eq(on.json.global.enabled, true, "**35 节**：开启后 global.enabled 为 true");

    // 🔑 **现在才写这条段落改写** —— 它写进刚才选上的那条预设。
    //    （老测试把它放在建预设之前，新模型下会 409。）
    const sec = await call(ctx9, SECTIONS_PATH, {
      method: "POST",
      search: "session=session-T",
      body: { name: "harness:identity", action: "replace", text: "我改的身份" },
    });
    eq(sec.status, 200, "有预设之后写段落改写 → 200");

    // 改写刚保存时默认未勾选，所以此刻仍是原生。
    a = await asm();
    await l0(a, {}, async () => a);
    eq(a.sections[0].text, "官方身份", "**改写未勾选 → 仍是原生**");
    const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
    const selection = disk.presets[gp9.json.id].selection;
    selection.listed = ["harness:identity"];
    await call(ctx9, PRESETS_PATH, {
      method: "POST",
      body: { action: "update", id: gp9.json.id, selection },
    });
    a = await asm();
    await l0(a, {}, async () => a);
    eq(a.sections[0].text, "我改的身份", "**保存并勾选后 → 改写生效**");
  }

  // ⚠️ 编辑器读完 POST 的响应后会立刻重新 GET /edit（load()）。
  //    所以这边必须也能读到，否则拨下去又被读回 —— 胶囊「弹回去」。
  {
    const off = await call(ctx9, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
    eq(off.status, 200, "关掉全局注入 → 200");
    eq(off.json.global.enabled, false, "回报已关");
    eq(off.json.global.presetId, gp9.json.id, "**关掉之后预设还留着**（不是把配置清掉）");
    eq((await call(ctx9, EDIT_PATH)).json.enabled, false, "**GET edit 也读得到已关**（否则胶囊弹回去）");

    a = await asm();
    await l0(a, {}, async () => a);
    // ⚠️ **这一条就是这次要修的 bug。**
    //
    //    老行为：「改原生段落跟注不注入是两件事」→ 关掉注入后**改写照样生效**。
    //    新行为：关掉 = 全局这一层整体停用 → 段落改写**也不生效**，回原生。
    eq(
      a.sections[0].text,
      "官方身份",
      "**关掉全局注入 → 段落改写也不生效**（回 dsh 原生）",
    );

    // 再开回来
    await call(ctx9, GLOBAL_PATH, { method: "POST", body: { enabled: true } });
    eq((await call(ctx9, EDIT_PATH)).json.enabled, true, "开回来之后 GET edit 也读得到");
  }

  // ── GET /state 也要带上开关状态（会话头徽章读它）────────────────────────
  {
    const st = await call(ctx9, STATE_PATH, { method: "GET" });
    eq(st.json.enabled, true, "GET state 带上开关状态");
    eq(st.json.enabled, st.json.global.enabled, "**跟 global.enabled 一致**（别各写一份）");
  }

  // ── 落盘：新模型存的是 global.*，不再有顶层 enabled / defaults ──────────
  {
    const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
    eq(disk.global.enabled, true, "开关持久化在 global.enabled");
    eq(
      Object.prototype.hasOwnProperty.call(disk, "enabled"),
      false,
      "**不再写顶层 enabled**（挪进 global 里了）",
    );
  }
}

// ══ 36. 全局关掉时：没记录的会话不挂，显式选过的照旧 ═══════════════════════
//
// 这是全局开关的核心语义。**两件事必须一起成立**才有意义：
//   ① 没记录的会话 → 全局关掉后什么都不挂
//   ② **显式选过具体预设的会话 → 照旧注入**
//
// 只验①的话「全停」也能过，那就把「会话自己能选」这个功能一起废掉了。
{
  const liveA = makeAgent("session-D1");
  const liveB = makeAgent("session-D2");
  const ctxD = makeCtx([liveA.agent, liveB.agent]);
  apply(ctxD);

  // 全局指一条预设并打开；D2 显式选另一条（D1 不记录 = 跟随全局）
  const gD = await call(ctxD, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "D 全局", prompts: ["format-contract"] },
  });
  const dD = await call(ctxD, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "D 单条", prompts: ["format-contract-a"] },
  });
  await call(ctxD, GLOBAL_PATH, { method: "POST", body: { presetId: gD.json.id, enabled: true } });
  const asg = await call(ctxD, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-D2", presetId: dD.json.id },
  });
  eq(asg.status, 200, "给 D2 显式指定一条 → 200");

  // 关掉全局注入
  await call(ctxD, GLOBAL_PATH, { method: "POST", body: { enabled: false } });

  // ⚠️ **按「这个会话实际注册了哪些段落」构造**，不能把三段写死。
  //
  //    写死的话，就算「全局关掉 → 默认那条不再注册」是对的，夹具里那一段
  //    照样带着正文，断言必然红 —— 红的是夹具，不是实现。
  //    （真实装配只包含注册过的段落，夹具也得照这个来。）
  //
  //    live.sections 是注入器调 scope.systemPrompt.section() 时登记的，
  //    名字形如 prompt-manager:<提示词 id>。
  const TEXT_OF = {
    "prompt-manager:format-contract": "全局那条的正文",
    "prompt-manager:format-contract-a": "D2 自己选的那条正文",
  };
  const asmOf = (live) => ({
    sections: [
      { name: "harness:identity", text: "官方身份" },
      ...live.sections.map((x) => ({ name: x.name, text: TEXT_OF[x.name] ?? "" })),
    ],
    contexts: [],
    tools: [],
  });

  const aA = asmOf(liveA);
  const lA = liveA.assembleListeners[0];
  ok(typeof lA === "function", "D1 挂上了装配监听器");
  await lA(aA, {}, async () => aA);
  // ⚠️ 按**名字**找，不按下标 —— 段落少一条时下标会错位，
  //    那时候按下标断言可能「碰巧对上另一条」，等于没测。
  {
    const found = aA.sections.find((x) => x.name === "prompt-manager:format-contract");
    eq(found, undefined, "**D1 没记录 → 全局关掉后，全局那条根本没注册**");
  }

  const aB = asmOf(liveB);
  const lB = liveB.assembleListeners[0];
  ok(typeof lB === "function", "D2 挂上了装配监听器");
  await lB(aB, {}, async () => aB);
  {
    const own = aB.sections.find((x) => x.name === "prompt-manager:format-contract-a");
    ok(!!own, "**D2 显式选的那条照旧注册**（关掉全局 ≠ 禁止注入）");
    eq(own?.text, "D2 自己选的那条正文", "正文对");
    const gp = aB.sections.find((x) => x.name === "prompt-manager:format-contract");
    eq(gp, undefined, "**D2 不吃全局，所以全局那条对它本来就没注册**");
  }

  // 开回来 → D1 恢复吃全局
  await call(ctxD, GLOBAL_PATH, { method: "POST", body: { enabled: true } });
  const aA2 = asmOf(liveA);
  await lA(aA2, {}, async () => aA2);
  {
    const found = aA2.sections.find((x) => x.name === "prompt-manager:format-contract");
    ok(!!found, "开回来后 D1 恢复吃全局（那条又注册上了）");
    eq(found?.text, "全局那条的正文", "正文对");
  }
}

// ══ 37. 会话选「不注入」时，段落改写也**不许**生效 ═════════════════════════
//
// 这一节补的是那个 bug 的**另一半**。
//
// 35/36 验的是「全局关掉」，这一节验「这个会话自己选了不注入」——
// 两种情况下段落改写都不该生效。老模型里它们都会漏：
// 段落改写存在一张独立的表里，注入时**无条件**读取，压根不问会话选了什么。
//
// ⚠️ 为什么单开一节而不是塞进 36：36 那节有两个会话、两套预设，
//    再加一个变量进去就看不清哪条断言在验什么了。
{
  // ⚠️ **库里的 id 就用现成的**（`format-contract`）。第一版我编了个 `format-contract`，
  //    结果保存预设直接 400（"提示词库里没有"），而我又没验状态码 ——
  //    于是 `gN.json.id` 是 undefined，后面几条断言全在验一个不存在的预设。
  //    **保存预设之后一定要验一下 200**，不然错了都不知道错在哪。
  const liveN = makeAgent("session-N1", {
    assemble: async () => ({
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "prompt-manager:format-contract", text: "会话自己的提示词" },
      ],
      contexts: [],
      tools: [],
    }),
  });
  const ctxN = makeCtx([liveN.agent]);
  apply(ctxN);

  // 全局那条预设带一段改写，并且开着
  const gN = await call(ctxN, PRESETS_PATH, {
    method: "POST",
    body: {
      action: "save",
      name: "N 全局",
      prompts: ["format-contract"],
      sections: { "harness:identity": { action: "replace", text: "全局改的身份" } },
    },
  });
  eq(gN.status, 200, "**存「N 全局」这条预设 → 200**（400 的话后面全是假失败）");
  await call(ctxN, GLOBAL_PATH, { method: "POST", body: { presetId: gN.json.id, enabled: true } });

  const lN = liveN.assembleListeners[0];
  const asmN = async () => ({
    sections: [
      { name: "harness:identity", text: "官方身份" },
      { name: "prompt-manager:format-contract", text: "会话自己的提示词" },
    ],
    contexts: [],
    tools: [],
  });

  // ── ① 没记录 → 跟随全局 → 改写生效 ────────────────────────────────────
  {
    const x = await asmN();
    await lN(x, {}, async () => x);
    eq(x.sections[0].text, "全局改的身份", "没记录的会话跟着全局 → 改写生效");
  }

  // ── ② 显式选「不注入」 → 全局那条不生效 → **改写也不生效** ──────────────
  {
    const asg = await call(ctxN, ASSIGN_PATH, {
      method: "POST",
      body: { sessionId: "session-N1", presetId: null },
    });
    eq(asg.status, 200, "给会话选「不注入」→ 200");

    const x = await asmN();
    await lN(x, {}, async () => x);
    eq(
      x.sections[0].text,
      "官方身份",
      "**会话选「不注入」→ 段落改写也不生效**（回 dsh 原生）",
    );
    const injected = x.sections.find((s) => s.name === "prompt-manager:format-contract");
    eq(injected?.text, "会话自己的提示词", "  那一段是夹具带的，注入器没动它");
  }

  // ── ③ 给它选一条**自己的**预设 → 改写按那条走 ─────────────────────────
  {
    const own = await call(ctxN, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "N 自己",
        prompts: ["format-contract"],
        sections: { "harness:identity": { action: "replace", text: "会话自己的身份" } },
      },
    });
    await call(ctxN, ASSIGN_PATH, {
      method: "POST",
      body: { sessionId: "session-N1", presetId: own.json.id },
    });

    const x = await asmN();
    await lN(x, {}, async () => x);
    eq(
      x.sections[0].text,
      "会话自己的身份",
      "**选了自己的预设 → 按它那条走**（不是全局那条）",
    );
  }
}

// ══ 38. 默认预设：第一次造一条「全原生」的，之后**不再造回来** ═════════════
//
// ⚠️ 这一节的关键是**第二、三条**：用户把默认预设删了之后，
//    再打开设置页不许又被造回来 —— 那样他永远删不掉。
//
//    判据是状态文件里那个 `hasLoaded` 标记（「这插件之前加载过没有」）。
//    没有它的话，「预设表空不空」每读一次盘都成立，预设会反复长出来。
{
  const snap = makeAgent("session-DEF", {
    assemble: async () => ({
      sections: [{ name: "harness:identity", text: "官方身份" }],
      contexts: [],
      tools: [],
    }),
  });
  const ctxF = makeCtx([snap.agent]);
  apply(ctxF);

  // ── ① 第一次进来：有一条默认预设 ────────────────────────────────────────
  const first = await call(ctxF, PRESETS_PATH);
  const defs = first.json.presets.filter((p) => p.name.includes("原生"));
  eq(defs.length, 1, "**第一次打开 → 有一条默认预设**");
  eq(defs[0]?.prompts, [], "  它不挂任何个人提示词");
  eq(Object.keys(defs[0]?.sections ?? {}), [], "  也不改任何段落（= 全部用原生）");

  // ── ② 把它删掉 ──────────────────────────────────────────────────────────
  const del = await call(ctxF, PRESETS_PATH, {
    method: "POST",
    body: { action: "delete", id: defs[0].id },
  });
  eq(del.status, 200, "删掉默认预设 → 200");
  {
    const after = await call(ctxF, PRESETS_PATH);
    eq(
      after.json.presets.filter((p) => p.name.includes("原生")).length,
      0,
      "  删完就没了（没被立刻造回来）",
    );
  }

  // ── ③ 再读一次（模拟重开设置页）→ **不许造回来** ────────────────────────
  {
    const again = await call(ctxF, PRESETS_PATH);
    eq(
      again.json.presets.filter((p) => p.name.includes("原生")).length,
      0,
      "**再打开一次也不许造回来**（否则用户永远删不掉它）",
    );
  }

  // ── ④ 而且那个标记真的落盘了 ────────────────────────────────────────────
  {
    // 触发一次写盘
    await call(ctxF, GLOBAL_PATH, { method: "POST", body: { enabled: false } });
    const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-easymanager-state.json"), "utf8"));
    eq(disk.hasLoaded, true, "**`hasLoaded` 落盘了**（下次启动才知道你来过）");
  }
}

// ══ 39. 空清单不许保存 ═══════════════════════════════════════════════════════
//
// 把原生段全排除、又没改过任何一段 → 这个会话等于**没有系统提示词**。
// 拦住，并说清怎么改。
//
// ⚠️ **判据不是「清单是空的」** —— 空清单正好是默认的全勾状态。
//    真正的空是「该有的原生段全被排除了」，所以界面要把
//    「当前有哪些原生段」递过来（`availableNative`）。
//    递不了就不拦（fail-open）—— 宁可少拦，别把正常保存挡住。
{
  // ⚠️ `ctx9` 是 35 节那个块里的局部变量，这里用不了 —— 自己建一个。
  //    （第一版直接写了 `ctx9`，`ReferenceError`。测试**崩**了而不是红 ——
  //      崩溃比失败更糟：后面的断言一条都没跑。）
  const liveE = makeAgent("session-EMP", {
    assemble: async () => ({
      sections: [
        { name: "harness:identity", text: "官方身份" },
        { name: "tool:bash", text: "bash 说明" },
      ],
      contexts: [],
      tools: [],
    }),
  });
  const ctxE = makeCtx([liveE.agent]);
  apply(ctxE);

  const avail = ["harness:identity", "tool:bash", "plan:policy"];

  // ── ① 全排除 + 没改过 → 拦住 ───────────────────────────────────────────
  {
    const r = await call(ctxE, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "空清单",
        prompts: [],
        selection: { listed: [], excluded: avail, sections: {} },
        availableNative: avail,
      },
    });
    eq(r.status, 400, "**全排除又不改任何段 → 400**");
    eq(r.json.outcome, "empty-selection", "结论说清是「清单是空的」");
    ok(
      typeof r.json.error === "string" && r.json.error.includes("至少勾一段"),
      "  并告诉用户怎么办（不是干巴巴一句「不行」）",
    );
  }

  // ── ② 空清单（= 默认全勾）→ **放行** ───────────────────────────────────
  //
  // ⚠️ 这条是上一轮的教训：判据要是写成「两个名单都空就算空」，
  //    默认那条预设就存不下来了。
  {
    const r = await call(ctxE, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "全原生",
        prompts: [],
        selection: { listed: [], excluded: [], sections: {} },
        availableNative: avail,
      },
    });
    eq(r.status, 200, "**空清单 = 全勾 → 放行**（它不是「空」，是「都用原生」）");
  }

  // ── ③ 排除了大部分、但留了一段改过的 → 放行 ───────────────────────────
  //
  // ⚠️ **别把同一段既排除又给它改正文** —— 那是自相矛盾的数据，
  //    校验逻辑会（正确地）把被排除段的正文丢掉，于是「改过至少一段」
  //    这个前提根本不成立。第一版就是这么写的，测试没错、数据错了。
  {
    const r = await call(ctxE, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "只剩自己改的",
        prompts: [],
        // 排除 tool:bash 和 plan:policy，**留下 harness:identity** 并改它
        selection: {
          listed: [],
          excluded: ["tool:bash", "plan:policy"],
          sections: { "harness:identity": { text: "我改的" } },
        },
        availableNative: avail,
      },
    });
    eq(r.status, 200, "排除了大部分、但**留下一段改过的** → 放行（有内容）");
  }

  // ── ④ 没递 availableNative → **不拦**（fail-open）──────────────────────
  {
    const r = await call(ctxE, PRESETS_PATH, {
      method: "POST",
      body: {
        action: "save",
        name: "不知道有哪些段",
        prompts: [],
        selection: { listed: [], excluded: avail, sections: {} },
      },
    });
    eq(r.status, 200, "**不知道有哪些原生段时不拦**（宁可少拦，别挡住正常保存）");
  }
}

rmSync(DSH_HOME, { recursive: true, force: true });


// ── 4f. 老数据迁移：**开关关着 + 老 defaults 里有东西** ──────────────────
//
// ⚠️ 这条是**演练真实状态文件**逼出来的。原来是 `if (enabled && …)`，
//    开关关着的用户 `defaults` 里那几条会被**静默丢掉** ——
//    而种子里是 `defaults: ["none"]`（会被过滤掉），所以原来的测试测不到。
//
//    取舍写在这儿：迁移是**保住配置**，不是替用户决定要不要开。
//    `enabled` 照原位保留（关着就还是关着），预设建出来挂在那儿。
{
  const stateFile = join(DSH_HOME, "dsh-prompt-easymanager-state.json");
  // ⚠️ 那时候文件可能**还不存在**（前面几节把盘清了）—— 直接 readFileSync 会炸。
  const existed = existsSync(stateFile);
  const backup = existed ? readFileSync(stateFile, "utf8") : null;
  try {
    // ⚠️ **这节的目录可能已经被前面几节清掉了** —— 写之前先建回来，
    //    不然 ENOENT（这节的 dump 探针就踩过这个）。
    mkdirSync(DSH_HOME, { recursive: true });
    // 造一份「老版本 + 开关关着 + defaults 有货」的状态
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          version: 1,
          assignments: {},
          defaults: ["format-contract"],
          sectionOverrides: {},
          enabled: false,
        },
        null,
        2,
      ),
      "utf8",
    );

    const st = await call(ctx, STATE_PATH, { method: "GET" });
    eq(st.status, 200, "迁移后 /state 能读");

    const j = st.json || {};
    const presets = j.presets || {};
    const ids = Object.keys(presets);
    ok(ids.length >= 1, "**老 defaults 变成了一条预设**（开关关着也迁）：" + JSON.stringify(ids));

    // 认出来的那条要真的装着那个 prompt id
    const found = ids.find((k) => (presets[k].prompts || []).indexOf("format-contract") >= 0);
    ok(!!found, "**那条预设想里装着老的 prompt id**（不是空壳）");

    // ⚠️ 关键：**开关照原位关着**。迁移不该替用户把开关打开 ——
    //    那会让本来不注入的会话突然开始注入。
    eq(j.global && j.global.enabled, false, "**开关照原位关着**（迁移不替用户做决定）");
    eq(
      j.global && j.global.presetId,
      found,
      "**global.presetId 指上那条预设**（这样用户一打开开关就能用）",
    );

    // 幂等：再读一遍不该多长预设
    const st2 = await call(ctx, STATE_PATH, { method: "GET" });
    eq(
      Object.keys((st2.json || {}).presets || {}).length,
      ids.length,
      "**幂等**：再读一遍不会又长一条预设",
    );
  } finally {
    if (existed) writeFileSync(stateFile, backup, "utf8");
    else if (existsSync(stateFile)) unlinkSync(stateFile);
  }
}

// ── 4g. **老文件名迁移：读老名字、写新名字** ────────────────────────────────
//
// ⚠️ 这一节是补出来的，起因是**真机验证时发现心跳和日志对不上**：
//
//     启动日志：从旧状态文件读取配置（…-manager-state.json），
//               **下次写入会落到新文件**
//     心跳：    stateFile 报的是**旧文件**
//
//    挖下去发现是 `writeState` 用的也是「读哪个」那个函数 ——
//    于是**只要老文件还在，就永远写回老文件**，新文件永远长不出来。
//    **日志说了两年的话，代码没做。**
//
//    为什么一直没有测试发现：`.mjs` 里搜 `dsh-prompt-manager-state`
//    一条都没有 —— 这条路径**从来没被测过**。
//
// 语义（写下来免得以后又走偏）：
//
//     读   有老文件 → 读老的（老用户升级后配置不丢）
//     写   **一律写新的** → 第一次写就完成迁移
//     老文件 **保留不动** → 用户后悔了还能翻回去
{
  const NEW_FILE = join(DSH_HOME, "dsh-prompt-easymanager-state.json");
  const OLD_FILE = join(DSH_HOME, "dsh-prompt-manager-state.json");
  const existed = { new: existsSync(NEW_FILE), old: existsSync(OLD_FILE) };
  const backup = {
    new: existed.new ? readFileSync(NEW_FILE, "utf8") : null,
    old: existed.old ? readFileSync(OLD_FILE, "utf8") : null,
  };
  try {
    mkdirSync(DSH_HOME, { recursive: true });
    // 清掉新文件、只留老的 —— 模拟「老用户刚升级上来」
    if (existsSync(NEW_FILE)) unlinkSync(NEW_FILE);
    writeFileSync(
      OLD_FILE,
      JSON.stringify({ version: 1, assignments: {}, defaults: [], sectionOverrides: {}, enabled: false }, null, 2),
      "utf8",
    );

    // 读一次 → 应该读的是**老文件**（配置不丢）
    const before = await call(ctx, STATE_PATH, { method: "GET" });
    eq(before.status, 200, "只有老文件时也能读（升级后配置不丢）");

    // 触发一次写
    await call(ctx, GLOBAL_PATH, { method: "POST", body: { enabled: false } });

    // ⚠️ **关键断言：新文件必须长出来**
    ok(
      existsSync(NEW_FILE),
      "**写一次之后新文件长出来了**（原来永远写回老文件，新文件永远不出现）",
    );

    // 老文件**保留不动** —— 用户后悔了还能翻回去
    const oldNow = JSON.parse(readFileSync(OLD_FILE, "utf8"));
    eq(oldNow.version, 1, "**老文件保留不动**（内容没被改写）");

    // 再读一次 → 这次该读新文件了（迁移幂等）
    const after = await call(ctx, STATE_PATH, { method: "GET" });
    eq(after.status, 200, "迁移后还能读");
    const diskNew = JSON.parse(readFileSync(NEW_FILE, "utf8"));
    eq(
      typeof diskNew.global === "object" && diskNew.global !== null,
      true,
      "**新文件里是完整的新结构**（不是半个）",
    );
  } finally {
    if (existed.new) writeFileSync(NEW_FILE, backup.new, "utf8");
    else if (existsSync(NEW_FILE)) unlinkSync(NEW_FILE);
    if (existed.old) writeFileSync(OLD_FILE, backup.old, "utf8");
    else if (existsSync(OLD_FILE)) unlinkSync(OLD_FILE);
  }
}

done();
