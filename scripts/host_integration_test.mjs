// 宿主集成测试：HTTP 路由、状态持久化、会话可信度校验
//
// 运行：node scripts/host_integration_test.mjs
//
// ⚠️ DSH_HOME 必须在**导入 index.js 之前**设置 —— 状态目录是模块顶层的 const。
//    这里用临时目录隔离，绝不碰用户真实的 ~/.dsh。

import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DSH_HOME = mkdtempSync(join(tmpdir(), "pm-host-"));
process.env.DSH_HOME = DSH_HOME;

// ⚠️ **测试用自己的 fixture 提示词库，不碰用户真实的那个。**
//
// 以前这里直接读 `<插件>/prompts/catalog.json`，于是测试**依赖用户的库里留着
// 几条特定 id 的提示词**（`infinite-gen-3` / `infinite-gen-4`）。
// 用户把那几条长文删掉之后，测试立刻红了 —— 那是测试设计的问题：
// 要么污染用户的库，要么测试跟着用户的数据飘。
//
// 现在插件支持 `DSH_PROMPT_MANAGER_CATALOG` 覆盖，测试就在临时目录里造自己的库。
const FIXTURE_DIR = join(DSH_HOME, "fixture-prompts");
mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(
  join(FIXTURE_DIR, "infinite-gen-3.md"),
  "集成测试用的正文占位。这段文本必须超过一百个字符，因为测试里有一条断言检查正文长度 —— 真实的提示词动辄几千字，如果 fixture 写得太短，「正文根本没读到」这种 bug 会溜过去而测试照样绿。所以这里故意写得啰嗦一点，把长度凑够。下面再重复一遍确保够长：集成测试用的正文占位，这段文本必须超过一百个字符。（三代）\n",
  "utf8",
);
writeFileSync(
  join(FIXTURE_DIR, "infinite-gen-4.md"),
  "集成测试用的正文占位。这段文本必须超过一百个字符，因为测试里有一条断言检查正文长度 —— 真实的提示词动辄几千字，如果 fixture 写得太短，「正文根本没读到」这种 bug 会溜过去而测试照样绿。所以这里故意写得啰嗦一点，把长度凑够。下面再重复一遍确保够长：集成测试用的正文占位，这段文本必须超过一百个字符。（四代）\n",
  "utf8",
);
writeFileSync(
  join(FIXTURE_DIR, "infinite-gen-4.1-flash.md"),
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
          id: "infinite-gen-3",
          name: "无限三代",
          mode: "append",
          category: "output",
          order: 9500,
          // ⚠️ `file` 字段是必须的 —— 少了它条目在库里但正文读不到，
          //    注入会静默失败（第一次写 fixture 就漏了这个，测试直接红）。
          file: "infinite-gen-3.md",
        },
        {
          id: "infinite-gen-4",
          name: "无限四代",
          mode: "append",
          category: "output",
          order: 9500,
          file: "infinite-gen-4.md",
        },
        {
          id: "infinite-gen-4.1-flash",
          name: "无限四代 · Flash",
          mode: "append",
          category: "output",
          order: 9500,
          file: "infinite-gen-4.1-flash.md",
        },
      ],
    },
    null,
    2,
  ),
  "utf8",
);
process.env.DSH_PROMPT_MANAGER_CATALOG = join(FIXTURE_DIR, "catalog.json");

const {
  apply,
  name,
  inject,
  STATE_PATH,
  ASSIGN_PATH,
  PREVIEW_PATH,
  RELOAD_PATH,
  DEFAULTS_PATH,
  EDIT_PATH,
  SECTIONS_PATH,
  PRESETS_PATH,
} = await import("../index.js");

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error("  ❌ " + label);
  }
}
function eq(a, b, label) {
  ok(
    JSON.stringify(a) === JSON.stringify(b),
    label + "（实际 " + JSON.stringify(a) + "，期望 " + JSON.stringify(b) + "）",
  );
}

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
  eq(name, "dsh-prompt-manager", "插件 name");
  ok(inject.includes("systemPrompt"), "inject 含 systemPrompt");
  ok(inject.includes("connection"), "inject 含 connection");
  ok(inject.includes("agents"), "inject 含 agents");
  ok(inject.includes("tools"), "inject 含 tools");
  eq(STATE_PATH, "/api/prompt-manager/state", "state 路径");
  eq(ASSIGN_PATH, "/api/prompt-manager/assign", "assign 路径");
  eq(PREVIEW_PATH, "/api/prompt-manager/preview", "preview 路径");
  eq(RELOAD_PATH, "/api/prompt-manager/reload", "reload 路径");
  eq(DEFAULTS_PATH, "/api/prompt-manager/defaults", "defaults 路径");
  eq(EDIT_PATH, "/api/prompt-manager/edit", "edit 路径");
}

// ── 2. 路由注册 ─────────────────────────────────────────────────────────────
const live = makeAgent(S);
const ctx = makeCtx([live.agent]);
apply(ctx);

// ⚠️ 防回归：path 必须是**单个字符串**。曾经传数组 [A,B,C,D]，结果所有路由全部
//    失效 —— 因为 dsh-client-connection 按 url.pathname 在 Map 里精确匹配。
//    这几条断言专门盯住这个点。
{
  const ALL = [STATE_PATH, ASSIGN_PATH, PREVIEW_PATH, RELOAD_PATH, DEFAULTS_PATH, EDIT_PATH, SECTIONS_PATH, PRESETS_PATH];
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
  ok(typeof ctx.__route("/api/prompt-manager/nope") === "undefined", "未注册的路径取不到路由");
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
  eq(r.json.defaults, [], "初始没有默认");
  eq(r.json.version, 2, "状态版本 2");
  ok(Array.isArray(r.json.prompts) && r.json.prompts.length >= 4, "返回提示词清单");
  ok(r.json.prompts.every((p) => p.text === undefined), "清单不含正文");
  eq(r.json.diag.routeRegistered, true, "diag 报告路由已注册");
  ok(r.json.diag.libraryErrors.length === 0, "库无错误");
  ok(typeof r.json.catalogPath === "string", "回报 catalog 路径");
}

// ── 4. POST assign：正常 ────────────────────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4"] },
  });
  eq(r.status, 200, "POST assign 200");
  eq(r.json.ok, true, "返回 ok");
  eq(r.json.promptIds, ["infinite-gen-4"], "返回 promptIds 数组");
  eq(r.json.source, "explicit", "来源是显式");
  eq(r.json.outcome, "attached", "结论 attached");
  eq(r.json.sessionCheck, "verified", "会话校验为 verified（agent 存活）");
  eq(live.sections.length, 1, "agent 上注册了 1 个 section");
  eq(live.sections[0].name, "prompt-manager:infinite-gen-4", "section 名正确");
  ok(live.sections[0].text.length > 100, "正文来自 prompts/*.md");
}

// ── 4b. POST assign：一次挂多条（本次的重点）────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4", "infinite-gen-3"] },
  });
  eq(r.status, 200, "多条分配 200");
  eq(r.json.promptIds.length, 2, "两条都生效");
  eq(live.sections.length, 2, "agent 上注册了 2 个 section");
}

// ── 5. 状态已落盘 ───────────────────────────────────────────────────────────
{
  const f = join(DSH_HOME, "dsh-prompt-manager-state.json");
  ok(existsSync(f), "状态文件已写入 DSH_HOME");
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  eq(parsed.assignments[S], ["infinite-gen-4", "infinite-gen-3"], "文件里的分配是数组");
  eq(parsed.version, 2, "文件里有版本号");
  ok(Array.isArray(parsed.defaults), "文件里有 defaults 字段");
  ok(typeof parsed.updatedAt === "string", "带 updatedAt");
}

// ── 6. 换一组 → 旧的卸掉 ────────────────────────────────────────────────────
{
  await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-3"] },
  });
  eq(live.sections.length, 1, "换一组后只剩 1 个 section");
  eq(live.sections[0].name, "prompt-manager:infinite-gen-3", "已换成新的");
}

// ── 7. 未知 id：整组被拒，且不改状态 ───────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["根本没有这条"] },
  });
  eq(r.status, 400, "未知 id → 400");
  eq(r.json.outcome, "unknown-prompt", "结论是 unknown-prompt");
  ok(r.json.error.includes("根本没有这条"), "错误里点名了它");
  eq(r.json.ok, false, "回报 ok: false");
  eq(live.sections.length, 1, "被拒时不动已有的 section");
}

// ── 7b. 多条 append 任意组合都合法（以前有组合护栏，现在没有）───────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4", "infinite-gen-3"] },
  });
  eq(r.status, 200, "两条 append → 200");
  eq(r.json.promptIds.length, 2, "两条都挂上");
  eq(live.sections.length, 2, "两个 section");
  ok(
    live.sections.every((s) => s.complete === undefined),
    "都不带 complete —— 不再有独占语义",
  );

  const r2 = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4", "infinite-gen-4"] },
  });
  eq(r2.status, 200, "同一条重复被去重 → 合法");
  eq(r2.json.promptIds.length, 1, "去重后只有 1 条");
}

// ── 8. POST assign：显式不注入（空数组）────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptIds: [] } });
  eq(r.status, 200, "空数组 200");
  eq(r.json.promptIds, [], "返回空数组");
  eq(r.json.source, "explicit", "来源仍是显式");
  eq(live.sections.length, 0, "section 已卸载");
}

// ── 8b. POST assign：null = 清除指定，回落默认 ──────────────────────────────
{
  // 先设一个默认
  await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: ["infinite-gen-4"] } });
  const r = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptIds: null } });
  eq(r.status, 200, "null 200");
  eq(r.json.source, "default", "来源回到 default");
  eq(r.json.promptIds, ["infinite-gen-4"], "生效的是默认那条");
  eq(live.sections.length, 1, "默认已被挂上");
  // 收尾：清掉默认，免得影响后面的断言
  await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: [] } });
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
  const unknown = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["不存在的提示词"] },
  });
  eq(unknown.status, 400, "未知 id → 400");
  ok(unknown.json.error.includes("没有"), "未知 id 的错误可读");
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

// ── 9b. 兼容旧的 promptId 写法 ──────────────────────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptId: "infinite-gen-4" },
  });
  eq(r.status, 200, "旧的 promptId 字符串仍可用");
  eq(r.json.promptIds, ["infinite-gen-4"], "被当成单条");
  const r2 = await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptId: "none" } });
  eq(r2.json.promptIds, [], "旧的 none 被当成空数组");
}

// ── 9c. defaults 路由 ───────────────────────────────────────────────────────
{
  eq((await call(ctx, DEFAULTS_PATH)).json.defaults, [], "初始默认为空");
  const set = await call(ctx, DEFAULTS_PATH, {
    method: "POST",
    body: { promptIds: ["infinite-gen-3", "infinite-gen-4"] },
  });
  eq(set.status, 200, "设置默认 200");
  eq(set.json.defaults.length, 2, "默认两条");
  eq((await call(ctx, DEFAULTS_PATH)).json.defaults.length, 2, "GET 能读回");
  eq(
    (await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: "x" } })).status,
    400,
    "默认不是数组 → 400",
  );
  eq(
    (await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: ["不存在"] } })).status,
    400,
    "默认含未知 id → 400",
  );
  await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: [] } });
  eq((await call(ctx, DEFAULTS_PATH)).json.defaults, [], "能清空默认");
}

// ── 10. 伪造 sessionId（有活动 agent 时应拒绝） ─────────────────────────────
{
  const r = await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-伪造的-9999", promptIds: [] },
  });
  eq(r.status, 404, "有活动 agent 时的伪造 id → 404");
}

// ── 10b. 编辑器路由：读取（带正文）─────────────────────────────────────────
{
  const r = await call(ctx, EDIT_PATH);
  eq(r.status, 200, "GET edit → 200");
  ok(Array.isArray(r.json.prompts), "返回条目数组");
  ok(r.json.prompts.length >= 3, "至少 3 条");
  const one = r.json.prompts.find((p) => p.id === "infinite-gen-4");
  ok(!!one, "能找到 infinite-gen-4");
  ok(one.text.length > 100, "**带正文**（这是编辑器需要的）");
  eq(one.source, "file", "注明来源是文件");
  eq(one.file, "infinite-gen-4.md", "回报文件名");
  ok(one.tokens > 0, "带 token 估算");
  ok(typeof r.json.catalogPath === "string", "回报目录路径");
  ok(typeof r.json.promptsDir === "string", "回报正文目录路径");
  // 编辑器要显示「新会话默认」的勾选状态，所以这份响应必须带 defaults
  ok(Array.isArray(r.json.defaults), "回报当前全局默认（编辑器要用）");
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

// ── 10b2. GET edit 的 defaults 跟着 POST defaults 变 ───────────────────────
{
  await call(ctx, DEFAULTS_PATH, {
    method: "POST",
    body: { promptIds: ["infinite-gen-3"] },
  });
  const r = await call(ctx, EDIT_PATH);
  eq(r.json.defaults, ["infinite-gen-3"], "改了默认后，编辑器的 GET 读得到");
  await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: [] } });
  eq((await call(ctx, EDIT_PATH)).json.defaults, [], "清空后也同步");
}

// ── 10d. 删掉「正在被用」的条目：引用必须被清掉（v0.3.2 的 bug 回归）──────
//
// 走真实路由：把一条提示词设成默认 + 显式分配给某会话，然后通过 EDIT 路由删掉它。
// 期望：默认和分配里的幽灵 id 都被剔掉，而不是留在那里让新会话「挂空」。
{
  const GONE = "zz-vanish-test";
  // 建一条，设为默认，并显式分配给 live 会话
  const mk = await call(ctx, EDIT_PATH, {
    method: "POST",
    body: {
      action: "upsert",
      prompt: { id: GONE, name: "会被删的", mode: "append", order: 100, text: "正文" },
    },
  });
  eq(mk.status, 200, "先建一条用于删除");

  await call(ctx, DEFAULTS_PATH, { method: "POST", body: { promptIds: [GONE] } });
  eq((await call(ctx, DEFAULTS_PATH)).json.defaults, [GONE], "默认设成它");
  await call(ctx, ASSIGN_PATH, { method: "POST", body: { sessionId: S, promptIds: ["infinite-gen-3", GONE] } });
  eq((await call(ctx, STATE_PATH)).json.assignments[S], ["infinite-gen-3", GONE], "会话也显式挂上它");

  // 删掉它
  const del = await call(ctx, EDIT_PATH, { method: "POST", body: { action: "delete", id: GONE } });
  eq(del.status, 200, "删除成功");
  ok(del.json.pruned, "回报清理结果");
  eq(del.json.pruned.defaults, [GONE], "报告：默认里剔掉了它");
  eq(del.json.pruned.sessions[S], [GONE], "报告：会话里剔掉了它");

  // 关键断言：幽灵 id 不该留下
  eq((await call(ctx, DEFAULTS_PATH)).json.defaults, [], "**默认已清空**（否则新会话会挂空）");
  eq((await call(ctx, STATE_PATH)).json.assignments[S], ["infinite-gen-3"], "**显式分配保留了还成立的部分**");
  eq(live.sections.length, 1, "会话只留下还成立的那一条 section");
  eq(live.sections[0].name, "prompt-manager:infinite-gen-3", "留下的是正确的那条");
}

// ── 10c. 编辑器路由：新增 / 更新 / 删除 ────────────────────────────────────
// ⚠️ 注意：这条路由真的会往插件的 prompts/ 目录里写文件。
//    测试用的是**真实目录**，所以下面新增的条目都在测试结束时删掉。
const TMP_ID = "zz-test-only";
{
  // 非法 action
  const bad = await call(ctx, EDIT_PATH, { method: "POST", body: { action: "乱写" } });
  eq(bad.status, 400, "非法 action → 400");
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
  const r = await call(ctx2, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-任意-0000", promptId: "infinite-gen-4" },
  });
  eq(r.status, 200, "无活动 agent 时不拒绝（无从比较）");
  eq(r.json.sessionCheck, "unverifiable", "标记为 unverifiable");
  eq(r.json.outcome, "awaiting-agent", "agent 未加载，等补挂");
  void empty;
}

// ── 12. GET preview ─────────────────────────────────────────────────────────
{
  // 先分配，让预览有内容
  await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4"] },
  });
  const r = await call(ctx, PREVIEW_PATH, { search: "session=" + encodeURIComponent(S) });
  eq(r.status, 200, "GET preview 200");
  eq(r.json.outcome, "ok", "预览成功");
  eq(r.json.promptIds, ["infinite-gen-4"], "回报生效的 id 列表");
  eq(r.json.prompts[0].mode, "append", "回报每条的 id/name/mode/order");
  eq(r.json.prompts[0].id, "infinite-gen-4", "回报 id");
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
    typeof ctx.__route("/api/prompt-manager/不存在") === "undefined",
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
  eq(out.plugin, "dsh-prompt-manager", "工具回报 plugin id");
  eq(out.name, "提示词管理", "工具回报中文名");
  eq(out.pluginVersion, "0.10.1", "工具回报版本");
  eq(out.stateVersion, 2, "工具回报状态版本 2");
  ok(Array.isArray(out.defaults), "工具回报全局默认");
  ok(Array.isArray(out.prompts) && out.prompts.length >= 4, "工具回报提示词清单");
  ok(Array.isArray(out.sessions), "工具回报会话状态");
  eq(out.liveAgents.rootsCount, 1, "工具回报存活 agent（当前实例有 1 个）");
  ok(out.notes.some((n) => n.includes("下一步即生效")), "工具说明含生效时机");
  ok(out.notes.some((n) => n.includes("全局默认")), "工具说明含全局默认");
  ok(t.description.includes("提示词管理"), "工具描述可读");
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
  await call(ctx, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: S, promptIds: ["infinite-gen-4.1-flash"] },
  });
  const ctx3 = makeCtx([live.agent]);
  apply(ctx3);
  const r = await call(ctx3, STATE_PATH);
  eq(r.json.assignments[S], ["infinite-gen-4.1-flash"], "新实例读回上次的分配（数组）");
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
  eq(badAction.status, 400, "非法 action → 400");
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
  eq(badJson.status, 400, "坏 JSON → 400");
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
  const before = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  writeFileSync(
    join(DSH_HOME, "dsh-prompt-manager-state.json"),
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

  const after = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
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

  const res = await call(ctx6, SECTIONS_PATH, { search: "session=session-sec-0001" });
  eq(res.status, 200, "GET /sections 正常返回");

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
  // 真机上它冒出过 `prompt-manager:infinite-gen-3`（4290 字），
  // 用户第一反应是「这是什么东西」。
  ok(
    !names.some((n) => n.startsWith("prompt-manager:")),
    "**本插件注入的段落被剔除**（它不是 dsh 原生段落，归提示词库管）",
  );
}

// ══ 33. 改写按会话：写会话层不许影响别的会话 ══════════════════════════════
{
  // ⚠️ 必须给一个**活着的 agent** —— 没有 agent 时 listSections 返回空列表，
  //    POST 会因为「找不到这个段落」直接 404，测试就测不到写入了。
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

  // 先写一条**全局**改写
  const g1 = await call(ctx7, SECTIONS_PATH, {
    method: "POST",
    search: "session=session-A",
    body: { name: "harness:identity", action: "replace", text: "全局身份", scope: "global" },
  });
  eq(g1.status, 200, "写全局改写 → 200");

  // 再给 A 写一条**会话层**的，盖住同一段
  const s1 = await call(ctx7, SECTIONS_PATH, {
    method: "POST",
    search: "session=session-A",
    body: { name: "harness:identity", action: "replace", text: "A 的身份", scope: "session" },
  });
  eq(s1.status, 200, "写会话层改写 → 200");

  // 落盘检查：两层各存各的
  const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  eq(disk.sectionOverrides["harness:identity"].text, "全局身份", "全局层还是原来那条");
  eq(
    disk.sessionSectionOverrides["session-A"]["harness:identity"].text,
    "A 的身份",
    "会话层单独存着",
  );

  // 读回来：A 看到的是会话层，B 看到的是全局层
  const a = await call(ctx7, SECTIONS_PATH, { search: "session=session-A" });
  eq(a.json.effectiveOverrides["harness:identity"].text, "A 的身份", "**A 看到会话层（盖住全局）**");
  const b = await call(ctx7, SECTIONS_PATH, { search: "session=session-B" });
  eq(b.json.effectiveOverrides["harness:identity"].text, "全局身份", "**B 看到的是全局那条，没被 A 影响**");
  eq(Object.keys(b.json.sessionOverrides).length, 0, "B 没有自己的会话层");

  // 还原掉 A 的会话层 → A 回落到全局那条
  const r1 = await call(ctx7, SECTIONS_PATH, {
    method: "POST",
    search: "session=session-A",
    body: { name: "harness:identity", action: "restore", scope: "session" },
  });
  eq(r1.status, 200, "还原会话层 → 200");
  const a2 = await call(ctx7, SECTIONS_PATH, { search: "session=session-A" });
  eq(a2.json.effectiveOverrides["harness:identity"].text, "全局身份", "**还原会话层后回落到全局那条**");
  const disk2 = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  ok(
    disk2.sessionSectionOverrides["session-A"] === undefined,
    "空掉的会话层不留占位（文件里不堆空对象）",
  );

  // scope: session 但没带 session → 400
  const noSid = await call(ctx7, SECTIONS_PATH, {
    method: "POST",
    body: { name: "harness:identity", action: "disable", scope: "session" },
  });
  eq(noSid.status, 400, "scope: session 没带 session → 400");

  // 不带 scope → 默认全局（老客户端兼容）
  const dflt = await call(ctx7, SECTIONS_PATH, {
    method: "POST",
    search: "session=session-C",
    body: { name: "tool:bash", action: "disable" },
  });
  eq(dflt.status, 200, "不带 scope → 200");
  const disk3 = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  ok(disk3.sectionOverrides["tool:bash"] !== undefined, "**不带 scope 时写进全局层**（向后兼容）");
  ok(
    disk3.sessionSectionOverrides["session-C"] === undefined,
    "没有意外写进会话层",
  );
}
// ══ 34. 快速预设：保存 / 应用 / 删除 ══════════════════════════════════════
//
// 预设 = 一层配置的完整快照。**应用是「覆盖」不是「合并」** ——
// 这一条是语义上的关键决定：合并的话就永远去不掉之前加的提示词，
// 「切换」这个语义就不成立了。
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

  // ① 先给全局层配点东西：一条提示词 + 一条改写
  await call(ctx8, DEFAULTS_PATH, { method: "POST", body: { promptIds: ["infinite-gen-4"] } });
  await call(ctx8, SECTIONS_PATH, {
    method: "POST",
    body: { name: "harness:identity", action: "replace", text: "写代码时的身份", scope: "global" },
  });

  // ② 存成预设
  const saved = await call(ctx8, PRESETS_PATH, {
    method: "POST",
    body: { action: "save", name: "写代码", scope: "global" },
  });
  eq(saved.status, 200, "存预设 → 200");
  eq(saved.json.id, "写代码", "id 就是名字（中文保留）");
  eq(saved.json.preset.prompts, ["infinite-gen-4"], "快照里带上提示词");
  ok(saved.json.preset.sections["harness:identity"] !== undefined, "快照里带上段落改写");

  // ③ 改成别的状态
  await call(ctx8, DEFAULTS_PATH, { method: "POST", body: { promptIds: [] } });
  await call(ctx8, SECTIONS_PATH, {
    method: "POST",
    body: { name: "harness:identity", action: "restore", scope: "global" },
  });
  const mid = await call(ctx8, PRESETS_PATH, { method: "GET" });
  eq(mid.json.layers.global.prompts, [], "改完之后全局层是空的");
  eq(mid.json.matched.global, null, "**手改过之后匹配不上任何预设**（界面要显示「已改动」）");

  // ④ 应用预设 —— 应该把状态整个还原回去
  const applied = await call(ctx8, PRESETS_PATH, {
    method: "POST",
    body: { action: "apply", id: "写代码" },
  });
  eq(applied.status, 200, "应用预设 → 200");
  const after = await call(ctx8, PRESETS_PATH, { method: "GET" });
  eq(after.json.layers.global.prompts, ["infinite-gen-4"], "**应用后提示词回来了**");
  ok(
    after.json.layers.global.sections["harness:identity"] !== undefined,
    "**段落改写也回来了**",
  );
  eq(after.json.matched.global?.id, "写代码", "**应用完能认出「现在在写代码这个预设上」**");

  // ⑤ 应用是「覆盖」：预设里没有的东西要被清掉
  await call(ctx8, DEFAULTS_PATH, { method: "POST", body: { promptIds: ["infinite-gen-3"] } });
  await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "apply", id: "写代码" } });
  const over = await call(ctx8, PRESETS_PATH, { method: "GET" });
  eq(
    over.json.layers.global.prompts,
    ["infinite-gen-4"],
    "**应用是覆盖不是合并** —— 后加的 infinite-gen-3 被清掉了",
  );

  // ⑥ 会话层预设
  await call(ctx8, ASSIGN_PATH, {
    method: "POST",
    body: { sessionId: "session-P", promptIds: ["infinite-gen-3"] },
  });
  const sessSaved = await call(ctx8, PRESETS_PATH, {
    method: "POST",
    search: "session=session-P",
    body: { action: "save", name: "写作", scope: "session" },
  });
  eq(sessSaved.status, 200, "存会话层预设 → 200");
  eq(sessSaved.json.preset.scope, "session", "scope 记对了");

  // 会话层预设应用时**必须带 session**
  const noSid = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "apply", id: "写作" } });
  eq(noSid.status, 400, "**应用会话层预设不带 session → 400**");
  ok(String(noSid.json.error).includes("写作") || String(noSid.json.error).includes("会话层"), "错误里说明了原因");

  // ⑦ 应用会话层预设，只动那个会话
  await call(ctx8, ASSIGN_PATH, { method: "POST", body: { sessionId: "session-P", promptIds: [] } });
  await call(ctx8, PRESETS_PATH, {
    method: "POST",
    search: "session=session-P",
    body: { action: "apply", id: "写作" },
  });
  const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  eq(disk.assignments["session-P"], ["infinite-gen-3"], "会话层被还原");
  eq(disk.defaults, ["infinite-gen-4"], "**全局层没被动**（应用会话层预设不影响全局）");

  // ⑧ 参数校验
  const noName = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "save", scope: "global" } });
  eq(noName.status, 400, "存预设缺名字 → 400");
  const badAction = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "乱写" } });
  eq(badAction.status, 400, "非法 action → 400");
  const noPreset = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "apply", id: "不存在" } });
  eq(noPreset.status, 404, "应用不存在的预设 → 404");
  ok(Array.isArray(noPreset.json.known), "404 时列出已有的预设名，方便排查");

  // ⑨ 删除
  const del = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "delete", id: "写代码" } });
  eq(del.status, 200, "删除预设 → 200");
  const left = await call(ctx8, PRESETS_PATH, { method: "GET" });
  ok(!left.json.presets.some((p) => p.id === "写代码"), "删掉了");
  ok(left.json.presets.some((p) => p.id === "写作"), "别的预设没受影响");
  const delAgain = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "delete", id: "写代码" } });
  eq(delAgain.status, 404, "删不存在的 → 404");

  // ⑩ 重名自动加序号
  const a = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "save", name: "同名", scope: "global" } });
  const b = await call(ctx8, PRESETS_PATH, { method: "POST", body: { action: "save", name: "同名", scope: "global" } });
  eq(a.json.id, "同名", "第一个用原名");
  eq(b.json.id, "同名-2", "**重名自动加序号，不覆盖**");
}
// ══ 35. 总开关：关掉 = 完全用 dsh 原始提示词 ══════════════════════════════
//
// 关掉的实现方式是**在装配时清空本插件自己注入的段落**，不是"不挂载"。
// 后者要遍历所有 agent 卸载重挂、还有竞态；前者跟段落覆盖同一个机制，
// **下一个模型步骤就生效**。
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

  // 装一条改写，确认开关关掉后它也不生效了
  await call(ctx9, SECTIONS_PATH, {
    method: "POST",
    body: { name: "harness:identity", action: "replace", text: "我改的身份", scope: "global" },
  });

  // 开 → 监听器改写生效
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
  eq(a.sections[0].text, "我改的身份", "**开关开着时改写生效**");
  eq(a.sections[1].text, "我注入的提示词正文", "开关开着时注入保留");

  // 关 → 注入清空、改写停用
  const off = await call(ctx9, STATE_PATH, { method: "POST", body: { enabled: false } });
  eq(off.status, 200, "关掉总开关 → 200");
  eq(off.json.enabled, false, "回报已关");

  a = await asm();
  await l0(a, {}, async () => a);
  eq(a.sections[0].text, "官方身份", "**开关关掉后改写不再生效（回到官方原文）**");
  eq(a.sections[1].text, "", "**开关关掉后自己注入的段落被清空**（等价于没注入）");

  // 再开回来
  await call(ctx9, STATE_PATH, { method: "POST", body: { enabled: true } });
  a = await asm();
  await l0(a, {}, async () => a);
  eq(a.sections[0].text, "我改的身份", "**开回来之后改写恢复**");
  eq(a.sections[1].text, "我注入的提示词正文", "注入也恢复");

  // 缺字段 → 400
  const bad = await call(ctx9, STATE_PATH, { method: "POST", body: {} });
  eq(bad.status, 400, "缺 enabled → 400");

  // GET state 要带上开关状态
  const st = await call(ctx9, STATE_PATH, { method: "GET" });
  eq(st.json.enabled, true, "GET state 带上开关状态");

  // 落盘
  const disk = JSON.parse(readFileSync(join(DSH_HOME, "dsh-prompt-manager-state.json"), "utf8"));
  eq(disk.enabled, true, "开关持久化了");
}
rmSync(DSH_HOME, { recursive: true, force: true });

console.log(`\n宿主集成测试：${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
