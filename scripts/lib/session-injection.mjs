// 个人提示词 —— 按会话挂载多条提示词 + 全局默认 + 幽灵引用清理
//
// v0.2.0 的两处变化：
//   1. **一个会话可以挂多条**（各自有 order）。dsh 的 section 机制本来就允许多条并存，
//      以前只能选一条，等于逼用户把「格式契约 + 领域知识 + 委派规矩」揉成一大段。
//   2. **全局默认**：新会话自动用默认的几条，不必逐个手点。以前每个新会话都是空。
//
// 机制（全部基于 DSH 原生能力，无自造全局状态）：
//   1. 每个会话对应一个 Agent，Agent 有独立的 scoped context（`agent.ctx`）。
//   2. `systemPrompt.section()` 注册在**调用者的 scope** 内，同名的 scoped section
//      遮蔽 global section。
//   3. 所以「本会话用这些提示词」= 向该 agent 的 scoped ctx 注册若干 section。
//      Agent 被销毁时注册自动 unwind，无需手工清理。
//
// 注册方式必须用 `agent.ctx.inject(["systemPrompt"], cb)` —— scoped ctx 不把宿主
// 服务当普通属性暴露，要先 inject 才保证可用。权威范例：
//   dsh-file-reference-local/lib/index.js:339-347
//
// ⚠️ 子代理过滤（旧版踩过的坑，原样保留）：
//   不要用 `delegationDepth !== undefined` 判断 —— 顶层会话的 delegationDepth **就是 0**，
//   字段确实存在，那样写会把每个顶层会话都当子代理拒掉。
//   只在**明确**为子代理时拒绝：`origin === 'subagent'` 或 `delegationDepth > 0`。
//   也不要用 `parentSession` 过滤 —— 那是 fork 的 seed lineage。
//
// ⚠️ 生效时机（已从 dsh 源码确认）：
//   `assemble()` 在每个模型步骤前都重新执行且不缓存
//     —— dsh-agent-loop/lib/index.js:907 `preStep()`
//     —— dsh-system-prompt/lib/index.js:199 "assembled before each model step"
//   所以改了分配之后**下一步就生效**，新老会话都一样。
//   前提：那个会话的 agent 必须活着；没加载的会在被打开时自动补挂。
//
// ⚠️ v0.2.2 起**没有 replace（替换）模式了**。
//   它曾经靠 section 的 `complete: true` 独占整个系统提示词，代价是把 dsh 原生的
//   身份声明（harness:identity）与二十余段工具用法说明全部顶掉。整条路已删除 ——
//   现在库里只有 `none` 和 `append` 两种模式，可以任意组合，不存在冲突组合。
//   （因此下面 attach 里不再设 `section.complete`，preview 里也不再做冲突检测。）
//
//   保留一条：`preview()` 仍然会检查**是不是别的插件**在做覆盖 ——
//   dsh 自带的 persona 插件也能设 complete，那是它的事，我们只是把事实报出来。

import { estimateTokens } from "./prompt-library.mjs";
import { normalizeOverrides, planOverrides } from "./section-overrides.mjs";
// ⚠️ 注入路径现在走**勾选清单**（`prompt-selection.mjs`）。
//    上面那两个是老模型的判定函数，`preview()` 和界面还在用 ——
//    等第三步界面改完才能收掉。
import { projectSelection, applyProjection } from "./prompt-selection.mjs";

const SECTION_DEFAULT = "prompt-manager:session-system-prompt";

/**
 * 会话 id 的规范化形式：去掉 `session-` 前缀并统一小写。
 * 仅用于**比对**，不改变对外暴露的原始字符串。
 */
export function sessionKey(id) {
  return String(id ?? "").replace(/^session-/, "").toLowerCase();
}

/** 取 agent 对应的会话 id。`Agent.id` 就是 SessionId。 */
function sessionIdOf(agent) {
  try {
    return agent?.id ?? agent?.session?.id ?? undefined;
  } catch {
    return undefined;
  }
}

/** 把 SystemMessage 的内容块拼成纯文本。 */
function messageTextOf(message) {
  try {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block.text === "string") return block.text;
        return "";
      })
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * 是否属于"顶层用户会话"（排除子代理）。
 * 见文件头：只在**明确**为子代理时拒绝，避免误杀。
 */
function isTopLevelSession(agent) {
  try {
    const header = agent?.session?.header;
    if (!header) return true;
    if (header.origin === "subagent") return false;
    if (typeof header.delegationDepth === "number" && header.delegationDepth > 0) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * 从**会话日志**里读出模型上一次实际收到的系统提示词。
 *
 * dsh 的 agent loop 每一步都会把渲染后的提示词写进日志
 * （dsh-agent-loop/lib/index.js:1032 `renderPrompt(assembly)` → `append("system/message", ...)`），
 * 那是**模型实际所见**，不依赖我能不能 import 到 renderPrompt。
 *
 * ⚠️ 注意：日志里**只有文字段落**，不含工具定义 —— 工具走的是模型 API 自己的
 *    `tools` 参数，不写进 system/message。
 *
 * ⚠️ 失败时必须**说清卡在哪**。早先的实现把「读不到」一律返回 null，界面上就显示成
 *    「这个会话还没有跑过模型步骤」—— 对已经跑了几十轮的会话来说那是**误导**。
 */
function loggedSystemPrompt(agent) {
  let session;
  try {
    session = agent?.session;
  } catch {
    return { ok: false, reason: "读取 agent.session 时抛错" };
  }
  if (!session) return { ok: false, reason: "agent 上没有 session" };

  const snap = session.snapshotEvents;
  if (typeof snap !== "function") {
    let methods = [];
    try {
      methods = Object.keys(Object.getPrototypeOf(session) ?? {})
        .concat(Object.keys(session))
        .filter((k, i, a) => a.indexOf(k) === i && typeof session[k] === "function")
        .slice(0, 40);
    } catch {
      /* 取不到就算了 */
    }
    return {
      ok: false,
      reason: "session 上没有 snapshotEvents()，取不到会话日志",
      availableMethods: methods,
    };
  }

  let events;
  try {
    events = snap.call(session) ?? [];
  } catch (err) {
    return { ok: false, reason: `调用 snapshotEvents() 抛错：${err?.message ?? String(err)}` };
  }
  if (!Array.isArray(events)) return { ok: false, reason: "snapshotEvents() 没有返回数组" };
  if (events.length === 0) {
    return { ok: false, reason: "会话日志是空的（事件数为 0）", eventCount: 0 };
  }

  const sysMsgs = [];
  const typeCount = new Map();
  for (const e of events) {
    const t = e && e.type ? String(e.type) : "(无 type)";
    typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
    if (t === "system/message") sysMsgs.push(e);
  }
  if (sysMsgs.length === 0) {
    return {
      ok: false,
      reason: `日志里有 ${events.length} 条事件，但一条 system/message 都没有`,
      eventCount: events.length,
      eventTypes: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    };
  }

  // ⚠️ 取**最后一条有正文的** system/message，不能只取最后一条。
  //
  //    dsh-agent-loop/lib/index.js:264 `project()` 有一个分支会先「把多余节点
  //    replace 成空串」再更新 head：
  //      const updates = nodes.slice(1).filter((n) => n.text !== "").map((n) => this.replace(n.seq, ""));
  //      if (head.text !== rendered) updates.push(this.replace(head.seq, rendered));
  //    当 head 已经正确、只是要清掉多余节点时，**最后追加的那条是空文本** ——
  //    取它就会误报「最后一条取不到文本」。
  //
  //    另外：`system/message` **只在提示词变化时才写**（`project()` 里
  //    `if (latest.text === rendered) return []`），所以这条日志的轮次看着旧，
  //    内容却是当前生效的那份。界面上要说明这一点。
  let last = null;
  for (let i = sysMsgs.length - 1; i >= 0; i--) {
    const candidate = messageTextOf(sysMsgs[i].data?.message);
    if (candidate) {
      last = { event: sysMsgs[i], text: candidate };
      break;
    }
  }
  if (!last) {
    return {
      ok: false,
      reason: `找到 ${sysMsgs.length} 条 system/message，但没有一条带正文`,
      eventCount: events.length,
      messageCount: sysMsgs.length,
    };
  }
  const text = last.text;
  return {
    ok: true,
    text,
    chars: text.length,
    tokens: estimateTokens(text),
    turn: last.event.data?.turn ?? null,
    step: last.event.data?.step ?? null,
    messageCount: sysMsgs.length,
    atSeq: last.event.seq ?? null,
    /** 这条是不是日志里最后一条 system/message（不是则说明后面还有空文本的清理记录） */
    isLatestEvent: last.event === sysMsgs[sysMsgs.length - 1],
    eventCount: events.length,
  };
}

/** 去重并保持顺序。 */
function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const v of list ?? []) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * @param {object} options
 * @param {(id: string) => object|undefined} options.resolvePrompt  按 id 取提示词条目（含正文）
 * @param {string} [options.sectionName]  兜底 section 名
 * @param {(state: object) => void} [options.saveState]  持久化回调
 * @param {boolean} [options.topLevelOnly=true]  是否只对顶层用户会话生效
 * @param {(sessionId: string) => boolean} [options.isEnabled]
 *        **总开关**：返回 false 时本插件对提示词的一切干预全部停用
 *        （不注入自设提示词、不改写原生段落）—— 等价于原生 dsh。
 *        同样是函数、每次装配现取，所以开关一拨**下一个模型步骤就生效**。
 * @param {(sessionId: string) => Record<string, object>} [options.getSectionOverrides]
 *        **每个装配阶段现取**的「原生段落覆盖表」（name → {action,text}）。
 *        传函数而不是对象，一是让界面上改完立刻生效、不用重挂；
 *        二是**入参是 sessionId** —— 改写按会话存，不同会话可以不一样。
 */
export function createSessionInjector({
  resolvePrompt,
  sectionName = SECTION_DEFAULT,
  saveState,
  topLevelOnly = true,
  getSectionOverrides,
  isEnabled,
} = {}) {
  /** 显式指定过的会话：sessionId -> string[]（**空数组 = 显式不注入**） */
  const explicit = new Map();
  /** 全局默认：新会话没显式指定时用它 */
  let defaults = [];
  /** 存活 agent：agentId -> agent */
  const agents = new Map();
  /** 已挂载的：sessionId -> [{ dispose, promptId, mode }] */
  const attached = new Map();
  /** 每个会话最近一次挂载尝试的结论 */
  const attempts = new Map();
  /** 见过的 agent id 原样记录 */
  const seenAgentIds = [];
  /** 已挂上「段落覆盖」监听的 agent：agentId -> 卸载器 */
  const overrideHooks = new Map();

  /**
   * 内部读取用的标记：带这个标记装配时，覆盖监听器**直接放行**，
   * 于是拿到的是「完整且没有被我们改过」的系统提示词。
   *
   * ⚠️ **为什么不用「不带 scope 的 assemble」** —— 我一开始的做法，是错的：
   *
   *   瀑布分发和 scoped 段落注册**都按 `context.scope` 走**，两者是同一个开关。
   *   所以「让监听器不触发」和「让 scoped 段落消失」根本是同一件事：
   *
   *     assemble({agent})                 → 监听器不跑 ✓  但 scoped 段落也没了 ✗
   *     assemble({agent, scope: agent})   → scoped 段落全在 ✓  但文本被我们改过 ✗
   *
   *   真机上就这么错的：列表里只剩 7 段全局段落，**21 段 `tool:*`
   *   （注册在各自的 scoped 层）整段消失** —— 用户根本没法关掉工具说明。
   *
   *   用标记解耦之后：照样带 `scope`（段落完整），只是监听器放行（文本未被改）。
   */
  const READ_ORIGINAL = Symbol("dsh-prompt-easymanager.read-original");

  /**
   * 本插件注入的段落用的段名前缀。
   *
   * 用途有二：
   *   1. 总开关关掉时，把这些段落的正文清空 = 等价于没注入
   *   2. listSections 里把它们过滤掉（那是 dsh 原生段落的面板，不该混进来）
   */
  const SELF_PREFIX = "prompt-manager:";

  /**
   * 给一个 agent 挂上「原生系统提示词段落覆盖」。
   *
   * ⚠️ **为什么走 `system-prompt/assemble` 瀑布，而不是注册同名 section：**
   *
   *   注册同名 section 确实能遮蔽（官方文档：「A scoped section shadows a global
   *   section with the same name」），但**必须同时给出正确的 `order`**，而没有任何
   *   公开接口能读到某个已注册 section 的 order —— `AssembledSection` 只有
   *   `{name, text}`；`getSectionOrder()` 只认 `"TOOL_BASH"` 这种键名，跟
   *   `"tool:bash"` / `"mcp:${server}"` 这类 section 名之间没有可推导的对应关系。
   *   order 给错，这一段就会跑到别的位置去。
   *
   *   瀑布里拿到的是**已经排好序的**最终结果，直接改 `text` 就完事，位置天然不变。
   *
   * ⚠️ 监听器注册在 **agent 的 scoped ctx** 上 —— 瀑布按 `scope` 分发，所以：
   *     - 正常装配（带 scope）→ 触发 → 覆盖生效
   *     - 插件自己调 `assemble({agent})`（**不带 scope**）探测官方原文 → 不触发
   *   这正是「读原文」和「用覆盖」能同时成立的原因。
   */
  function hookSectionOverrides(agent, agentId) {
    if (typeof getSectionOverrides !== "function") return;
    if (overrideHooks.has(agentId)) return;

    let listenerDispose = null;
    let fiber = null;
    try {
      fiber = agent.ctx.inject(["systemPrompt"], (scope) => {
        listenerDispose = scope.on("system-prompt/assemble", async (_assembly, context, next) => {
          const result = await next();
          // 插件自己在读「原文」时放行（见 READ_ORIGINAL 的说明）
          if (context && context[READ_ORIGINAL] === true) return result;
          try {
            const sections = result?.sections;
            if (!Array.isArray(sections)) return result;

            // ⚠️ **这里原来有一段「装配期把来自默认的段落清空」**（老机制，
            //    靠 `isEnabled` 驱动）—— **已删**。
            //
            //    新模型下「全局注入关掉」= **`defaults` 直接是空的**
            //    （见 index.js 的 `toInjectorState`），装配时压根不会有那几段，
            //    所以不需要在装配期清。
            //
            //    那段还活着的唯一后果是**误导**：`isEnabled` 现在恒为 true
            //    （语义挪到翻译层了），所以它永不触发 —— 留着会让人以为
            //    「清空」这条路径还在用。
            //
            // ⚠️ **按 agent 取清单** —— 清单是按会话的，不同会话不一样。
            //    监听器本来就是每个 agent 挂一个，所以这里天然知道是谁。
            //
            // ⚠️ **返回 `null` 表示「一段都不套」** —— 也就是
            //    「全局注入关掉」和「这个会话选了不注入」那两种情况。
            //    老实现是从两张 state 表里**无条件**取改写，所以那两种情况下
            //    段落改写照样生效（这就是要修的 bug）。
            //
            //    现在由 `projectSelection` 统一判定：给了清单就照清单投影，
            //    没给清单就把原生原样放过去。
            const selection = getSectionOverrides(agentId);
            const projected = projectSelection({
              // ⚠️ 传**当前装配结果**当原生 —— 它就是 dsh 这一刻的原样。
              //    别的插件挂的段落也在里面，而清单里没有它们，
              //    所以 `applyProjection` 不会碰它们（有断言钉着）。
              native: sections.map((s) => ({
                name: s?.name,
                text: typeof s?.text === "string" ? s.text : "",
              })),
              selection,
            });
            applyProjection(sections, projected);
          } catch (err) {
            // 投影出问题**绝不能拖垮整个装配** —— 那会让会话完全跑不动
            log("段落投影失败（已忽略，按原文继续）：", err?.message ?? String(err));
          }
          return result;
        });
        return listenerDispose;
      });
    } catch (err) {
      log("挂段落覆盖监听失败：", err?.message ?? String(err));
      return;
    }

    overrideHooks.set(agentId, () => {
      try {
        if (typeof listenerDispose === "function") listenerDispose();
      } catch {
        /* 忽略 */
      }
      try {
        if (typeof fiber === "function") fiber();
        else if (fiber && typeof fiber.dispose === "function") fiber.dispose();
      } catch {
        /* 忽略 */
      }
    });
  }

  function log(...args) {
    try {
      console.warn("[prompt-manager]", ...args);
    } catch {
      /* 宿主无 console 时忽略 */
    }
  }

  function record(sessionId, outcome, detail, extra) {
    attempts.set(sessionId, {
      outcome,
      detail: detail ?? null,
      at: Date.now(),
      ...(extra ? { extra } : {}),
    });
    if (outcome !== "attached" && outcome !== "skipped" && outcome !== "partial") {
      log("挂载未完成:", sessionId, outcome, detail ?? "");
    }
  }

  function findAgent(sessionId) {
    if (agents.has(sessionId)) return agents.get(sessionId);
    const k = sessionKey(sessionId);
    for (const [agentId, agent] of agents) {
      if (sessionKey(agentId) === k) return agent;
    }
    return undefined;
  }

  /** 找到显式记录的键（兼容前缀差异）。返回 { key, value } 或 undefined。 */
  function explicitEntry(sessionId) {
    if (explicit.has(sessionId)) return { key: sessionId, value: explicit.get(sessionId) };
    const k = sessionKey(sessionId);
    for (const [id, value] of explicit) {
      if (sessionKey(id) === k) return { key: id, value };
    }
    return undefined;
  }

  /**
   * 某会话**实际生效**的提示词 id 列表。
   *
   * 三层优先级：
   *   1. 这个会话被**显式指定**过 → 用它的（哪怕是空数组 = 显式不注入）
   *   2. 没显式指定 → 用全局默认
   *   3. 但**全局注入关掉时，第 2 层整体作废**（见 isEnabled）
   *
   * ⚠️ 第 3 层只掐「默认」，**不掐「显式」** —— 这是用户定的语义：
   *    关闭全局注入 = 不再往每个会话都塞那几条；用户在会话页自己选的照旧注入。
   *    会话页那个「跟随默认」也正是这个意思：选它才吃默认，自己有选择就不吃。
   */
  function resolvedIds(sessionId) {
    const e = explicitEntry(sessionId);
    if (e) return [...e.value];
    if (isEnabled && isEnabled(sessionId) === false) return [];
    return [...defaults];
  }

  /** 当前分配是显式给的还是来自默认。 */
  function sourceOf(sessionId) {
    return explicitEntry(sessionId) ? "explicit" : "default";
  }

  function isAttachedId(sessionId) {
    if (attached.has(sessionId)) return true;
    const k = sessionKey(sessionId);
    for (const id of attached.keys()) {
      if (sessionKey(id) === k) return true;
    }
    return false;
  }

  /** 卸载某会话已挂的全部 section（不改分配记录）。 */
  function detach(sessionId) {
    const k = sessionKey(sessionId);
    let n = 0;
    for (const id of [...attached.keys()]) {
      if (sessionKey(id) !== k) continue;
      const entries = attached.get(id) ?? [];
      attached.delete(id);
      for (const entry of entries) {
        try {
          entry.dispose?.();
          n += 1;
        } catch (err) {
          record(id, "detach-threw", `卸载抛错：${err?.message ?? String(err)}`);
        }
      }
    }
    return n;
  }

  /**
   * 库里不存在的 id 挑出来。
   *
   * ⚠️ v0.2.2 起这是**唯一**的预检了。以前这里还管「替换模式」的两条组合规则
   *    （两条替换 = 必崩；替换+追加 = 追加被静默丢弃），替换模式删除后随之作废 ——
   *    现在库里只有 none / append，任意组合都合法。
   */
  function unknownIds(ids) {
    return ids.filter((id) => !(typeof resolvePrompt === "function" && resolvePrompt(id)));
  }

  /** 把某会话的提示词（可能多条）挂到它的 agent 上。 */
  function attach(sessionId) {
    const ids = resolvedIds(sessionId);
    if (ids.length === 0) {
      detach(sessionId);
      record(sessionId, "skipped", "该会话没有分配任何提示词");
      return false;
    }
    const agent = findAgent(sessionId);
    if (!agent) {
      record(
        sessionId,
        "awaiting-agent",
        `无匹配 agent（已登记 ${agents.size} 个：${[...agents.keys()].join(", ") || "无"}）`,
      );
      return false;
    }
    if (!agent.ctx) {
      record(sessionId, "no-ctx", "agent 存在但没有 ctx");
      return false;
    }
    if (typeof agent.ctx.inject !== "function") {
      record(sessionId, "no-inject-api", "agent.ctx 上没有 inject()");
      return false;
    }

    // 先卸旧，再挂新 —— 换提示词和首次挂载走同一条路径，不会出现中间态
    detach(sessionId);

    // 注：v0.2.2 删掉替换模式后，组合校验只剩「挑出库里不存在的 id」，
    // 而那件事在下面的循环里顺带做了（进 failed 数组），所以这里不再预检。

    const entries = [];
    const failed = [];
    for (const promptId of ids) {
      const prompt = typeof resolvePrompt === "function" ? resolvePrompt(promptId) : undefined;
      if (!prompt) {
        failed.push(promptId);
        continue;
      }
      try {
        const section = {
          name: prompt.sectionName ?? sectionName,
          order: prompt.order ?? 100,
          text: prompt.text ?? "",
        };
        // 不再设 section.complete —— 替换模式已在 v0.2.2 删除

        // 卸载器要同时抓两个来源：section() 的返回值，以及 inject() 的返回值
        // （fiber 对象或函数）。回调必须**返回** section() 的结果 —— 写成块体
        // 会返回 undefined，卸载器退化成空函数、旧 section 永远留着。
        let sectionDispose = null;
        const fiber = agent.ctx.inject(["systemPrompt"], (scope) => {
          sectionDispose = scope.systemPrompt.section(section);
          return sectionDispose;
        });
        entries.push({
          dispose: () => {
            try {
              if (typeof sectionDispose === "function") sectionDispose();
            } catch {
              /* 单次卸载失败不阻断另一条路 */
            }
            try {
              if (typeof fiber === "function") fiber();
              else if (fiber && typeof fiber.dispose === "function") fiber.dispose();
            } catch {
              /* 同上 */
            }
          },
          promptId,
          mode: prompt.mode,
          sectionName: section.name,
          order: section.order,
        });
      } catch (err) {
        record(sessionId, "inject-threw", `agent.ctx.inject 抛错：${err?.message ?? String(err)}`);
        // 已经挂上的先回滚，避免半个状态
        for (const e of entries) {
          try {
            e.dispose();
          } catch {
            /* 忽略 */
          }
        }
        return false;
      }
    }

    if (entries.length === 0) {
      record(sessionId, "unknown-prompt", `提示词库里没有：${failed.join("、")}`);
      return false;
    }
    attached.set(sessionId, entries);
    const summary = entries.map((e) => `${e.promptId}(${e.mode},order=${e.order})`).join("、");
    record(
      sessionId,
      failed.length ? "partial" : "attached",
      `已注册 ${entries.length} 个 section：${summary}` +
        (failed.length ? `；另有 ${failed.length} 条库里不存在被跳过：${failed.join("、")}` : ""),
    );
    return true;
  }

  function persist() {
    if (typeof saveState !== "function") return;
    try {
      saveState({
        version: 2,
        defaults: [...defaults],
        assignments: Object.fromEntries(explicit),
      });
    } catch (err) {
      log("持久化失败", err?.message);
    }
  }

  /** 登记一个 agent；若它对应某个有分配的会话，立即补挂。 */
  function register(agent) {
    if (topLevelOnly && !isTopLevelSession(agent)) return false;
    const agentId = sessionIdOf(agent);
    if (!agentId) return false;
    agents.set(agentId, agent);
    if (!seenAgentIds.includes(agentId)) seenAgentIds.push(agentId);
    hookSectionOverrides(agent, agentId);

    // 该 agent 对应的会话：显式指定过就用显式的，否则用默认。
    // 注意**默认也要挂** —— 否则「全局默认」就只是个摆设。
    const e = explicitEntry(agentId);
    if (e) {
      attach(e.key);
    } else if (defaults.length > 0) {
      // 给默认分配补一条显式记录吗？不 —— 保持"来自默认"这个事实可查，
      // 只是照常挂载。挂载读的就是 resolvedIds()。
      attach(agentId);
    }
    return true;
  }

  return {
    /** 启动时灌入持久化状态。兼容 v1（`assignments: { id: "promptId" }`）。 */
    restore(state) {
      explicit.clear();
      defaults = [];
      const raw = state?.assignments;
      if (raw && typeof raw === "object") {
        for (const [id, value] of Object.entries(raw)) {
          if (typeof id !== "string" || !id) continue;
          // v1：值是字符串 → 当成单条
          if (typeof value === "string") {
            if (value && value !== "none") explicit.set(id, [value]);
            else explicit.set(id, []); // "none" = 显式不注入
            continue;
          }
          if (Array.isArray(value)) explicit.set(id, uniq(value));
        }
      }
      if (Array.isArray(state?.defaults)) defaults = uniq(state.defaults);
    },

    /** 当前状态快照（供 UI）。 */
    snapshot() {
      return {
        version: 2,
        defaults: [...defaults],
        assignments: Object.fromEntries(explicit),
      };
    },

    /** 全局默认（新会话用）。 */
    getDefaults() {
      return [...defaults];
    },

    /** 设置全局默认。返回受影响的行为。 */
    setDefaults(ids) {
      // 库里不存在的 id 不进默认 —— 否则每个新会话都会记一条「挂不上」
      const unknown = unknownIds(uniq(ids));
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `提示词库里没有：${unknown.join("、")}`,
          defaults: [...defaults],
        };
      }
      defaults = uniq(ids);
      persist();
      // 没被显式指定过的存活会话要跟着变
      let refreshed = 0;
      for (const agentId of agents.keys()) {
        if (!explicitEntry(agentId)) {
          if (attach(agentId)) refreshed += 1;
        }
      }
      return { ok: true, defaults: [...defaults], refreshed };
    },

    /** 某会话**实际生效**的提示词 id（含来自默认的）。 */
    promptsOf(sessionId) {
      return resolvedIds(sessionId);
    },

    /**
     * 把引用到「库里已不存在」的条目的地方清理掉。
     *
     * ⚠️ 这段是补一个真实踩到的坑（v0.3.2）：
     *    删掉一条**正在被用**的提示词后，曾经会出现三个问题 ——
     *      1. 它还留在全局默认里 → **所有新会话静默地什么都挂不上**
     *      2. 已分配的会话留着幽灵 id，而 stateOf() 报 attached: true 是**假的**
     *         （读的是上一次的结论，不是当前真相）
     *      3. assign() 遇到未知 id 会**提前 return，不走 detach** ——
     *         于是那条已删提示词的旧正文永远卡在会话里卸不掉
     *
     *    根因是设计上把「未知 id」一律当成**用户输错了**，整组拒绝。
     *    对用户手选那是对的；但**库里少了一条**时，拒绝等于把烂摊子留在原地。
     *    正确做法：**库是唯一真相** —— 引用清掉，然后把受影响的会话重挂。
     *
     * 显式分配里被剔掉一条后剩下的部分**保留**（`["keep","victim"]` → `["keep"]`），
     * 因为那是用户的本意里还成立的部分。全被剔光就是 `[]`，即"显式不注入" ——
     * 不回落到默认，免得出现"我设了个空的反而挂上了东西"。
     *
     * @returns {{defaults: string[], sessions: Record<string, string[]>}} 被剔掉的 id
     */
    pruneMissing() {
      const alive = (id) => typeof resolvePrompt === "function" && !!resolvePrompt(id);
      const dropped = { defaults: [], sessions: {} };

      const keptDefaults = defaults.filter(alive);
      if (keptDefaults.length !== defaults.length) {
        dropped.defaults = defaults.filter((id) => !alive(id));
        defaults = keptDefaults;
      }

      const touched = new Set();
      for (const [sid, ids] of [...explicit.entries()]) {
        const kept = ids.filter(alive);
        if (kept.length !== ids.length) {
          dropped.sessions[sid] = ids.filter((id) => !alive(id));
          explicit.set(sid, kept);
          touched.add(sid);
        }
      }

      // 默认变了 → 所有「跟着默认走」的存活会话都要重挂
      if (dropped.defaults.length > 0) {
        for (const agentId of agents.keys()) {
          if (!explicitEntry(agentId)) touched.add(agentId);
        }
      }
      // 显式分配被改过的会话重挂（顺带把卡住的旧 section detach 掉）
      for (const sid of touched) attach(sid);

      if (dropped.defaults.length > 0 || Object.keys(dropped.sessions).length > 0) persist();
      return dropped;
    },

    stateOf(sessionId) {
      const ids = resolvedIds(sessionId);
      return {
        promptIds: ids,
        source: sourceOf(sessionId),
        attached: isAttachedId(sessionId),
        agentLive: findAgent(sessionId) !== undefined,
      };
    },

    /**
     * 给某会话指定提示词。
     * @param {string} sessionId
     * @param {string[]|null} promptIds  空数组 = 显式不注入；null/undefined = 清除指定，回落到默认
     */
    assign(sessionId, promptIds) {
      if (typeof sessionId !== "string" || !sessionId) {
        return { ok: false, outcome: "bad-session", error: "sessionId 不能为空" };
      }
      const k = sessionKey(sessionId);

      // 清掉同一会话的其他写法，避免幽灵条目
      for (const id of [...explicit.keys()]) {
        if (sessionKey(id) === k && id !== sessionId) explicit.delete(id);
      }

      if (promptIds === null || promptIds === undefined) {
        // 清除指定 → 回落默认
        explicit.delete(sessionId);
        attach(sessionId);
        persist();
        return {
          ok: true,
          outcome: attempts.get(sessionId)?.outcome ?? "untried",
          promptIds: resolvedIds(sessionId),
          source: "default",
        };
      }

      const ids = uniq(Array.isArray(promptIds) ? promptIds : [promptIds]);
      // 库里不存在的 id 直接拒（进状态只会留下永远挂不上的幽灵记录）。
      // 路由层已经先挡过一次，这里是注入核心自己的兜底。
      const unknown = unknownIds(ids);
      if (unknown.length > 0) {
        record(sessionId, "unknown-prompt", `提示词库里没有：${unknown.join("、")}`);
        return {
          ok: false,
          outcome: "unknown-prompt",
          error: `提示词库里没有：${unknown.join("、")}`,
          promptIds: ids,
        };
      }
      explicit.set(sessionId, ids);
      attach(sessionId);
      persist();
      const entry = attempts.get(sessionId);
      return {
        ok: true,
        outcome: entry?.outcome ?? "untried",
        detail: entry?.detail ?? null,
        promptIds: resolvedIds(sessionId),
        source: "explicit",
      };
    },

    handleAgentCreated(agent) {
      register(agent);
    },

    /**
     * 按**当前**的 explicit / defaults 重新挂一遍所有存活会话。
     *
     * ⚠️ **`restore()` 之后必须调这个** —— `restore()` 只重建内部的映射表，
     *    它**不挂载**。所以「改完盘 → restore()」这条路上，状态是对的、
     *    但 agent 上一个 section 都没有（宿主集成测试当场逮到：
     *    「agent 上注册了 1 个 section（实际 0）」）。
     *
     *    老的 `assign()` 是「设映射 + 立刻 attach」两件事一起做的，所以那时候
     *    没这个问题；现在状态由盘上说了算，就得显式补一次挂载。
     *
     * @returns {number} 成功重挂的会话数
     */
    reattachAll() {
      let n = 0;
      try {
        for (const agentId of agents.keys()) {
          if (attach(agentId)) n += 1;
        }
      } catch (err) {
        log("reattachAll 失败", err?.message);
      }
      return n;
    },

    /**
     * 登记插件加载时**已经存活**的顶层 agent。
     * 官方惯用法同时做「遍历已存活」+「订阅 agent/created」，否则插件热加载后
     * 先前已开的会话永远不被登记。用 `ctx.agents.roots()`（只含顶层）。
     */
    seedAgents(agentList) {
      let n = 0;
      try {
        for (const agent of agentList ?? []) {
          if (register(agent)) n += 1;
        }
      } catch (err) {
        log("seedAgents 失败", err?.message);
      }
      return n;
    },

    /**
     * `agent/disposed`：scoped 注册随 agent 自动 unwind，这里只清本地表。
     *
     * ⚠️ **不清 explicit**：分配是"意图"，会话重新打开时要按它重新挂上。
     *    但为了不让状态文件无限增长（同 my-code-agent 那个 .bak 堆积的教训），
     *    提供一个显式的 prune()，由宿主定期调用。
     */
    handleAgentDisposed(agent) {
      const agentId = sessionIdOf(agent);
      if (!agentId) return;
      agents.delete(agentId);
      const k = sessionKey(agentId);
      for (const id of [...attached.keys()]) {
        if (sessionKey(id) === k) attached.delete(id);
      }
    },

    /**
     * 清理已不存在会话的分配记录，避免状态文件无限增长。
     * @param {(sessionId: string) => boolean} exists 该会话是否还存在
     */
    prune(exists) {
      if (typeof exists !== "function") return { removed: 0, kept: 0 };
      let removed = 0;
      for (const id of [...explicit.keys()]) {
        let alive = true;
        try {
          alive = exists(id) === true;
        } catch {
          alive = true; // 判断不了就不删 —— 宁留勿误删
        }
        if (!alive) {
          explicit.delete(id);
          attempts.delete(id);
          removed += 1;
        }
      }
      if (removed > 0) persist();
      return { removed, kept: explicit.size };
    },

    /**
     * 逐会话完整诊断。
     * 这是排查「选了提示词但没生效」的唯一入口。
     */
    explain() {
      const ids = new Set([
        ...explicit.keys(),
        ...agents.keys(),
        ...attached.keys(),
        ...attempts.keys(),
      ]);
      return [...ids].map((id) => {
        const attempt = attempts.get(id);
        const entries = attached.get(id) ?? [];
        return {
          sessionId: id,
          key: sessionKey(id),
          promptIds: resolvedIds(id),
          source: sourceOf(id),
          agentLive: findAgent(id) !== undefined,
          attached: isAttachedId(id),
          attachedPrompts: entries.map((e) => ({
            promptId: e.promptId,
            mode: e.mode,
            order: e.order,
          })),
          outcome: attempt ? attempt.outcome : "untried",
          detail: attempt ? attempt.detail : null,
        };
      });
    },

    explainOne(sessionId) {
      const found = this.explain().find((e) => sessionKey(e.sessionId) === sessionKey(sessionId));
      if (found) return found;
      return {
        sessionId,
        key: sessionKey(sessionId),
        promptIds: resolvedIds(sessionId),
        source: sourceOf(sessionId),
        agentLive: findAgent(sessionId) !== undefined,
        attached: isAttachedId(sessionId),
        attachedPrompts: [],
        outcome: "unknown",
        detail: "该会话从未被登记",
      };
    },

    seenAgentIds() {
      return [...seenAgentIds];
    },

    /**
     * 预览某会话**最终**的系统提示词。
     *
     * 直接调 dsh 自己的组装器拿真实结果。
     *
     * ⚠️ 参数必须同时传 `agent` 和 `scope`：
     *     dsh-agent/lib/types/dispatch.js:92
     *       `assembleContextFor(agent, signal) => { agent, scope: agent, ... }`
     *     dsh-agent-loop/lib/index.js:907 就是这么调的。
     *
     *     **曾经只传了 `{ scope: agent }`**，于是凡是读 `context.agent` 的段落
     *     （`approval:policy`、`sandbox:policy` —— 都写着 `if (agent === void 0) return ""`）
     *     全部返回空串，预览里显示成「上下文段 2 段 = 0 tokens」。
     *     **看着像"这些段落是空的"，其实是我没喂参数。** v0.3.4 修。
     *
     * 两路取真相：
     *   1. `logged` —— 会话日志里的 system/message，**模型真正收到过的**（变量已替换）
     *   2. `sections` / `contexts` / `tools` —— assemble() 的结果，未插值原文 + 分类 token
     *
     * ⚠️ 注意 contexts 与 sections **不是一回事**：
     *    `renderPrompt()` 只拼 `assembly.sections`（dsh-system-prompt/lib/index.js:113），
     *    contexts 由 `renderContextSnapshot()` 单独渲染成
     *    「Current runtime context. This snapshot supersedes earlier …」那一条**独立消息**
     *    （dsh-agent-loop/lib/index.js:909-917），**不进 system/message**。
     *    所以会话日志里看不到 runtime context 是正常的，不是丢了。
     *
     * （曾经还有第三路：本地调 dsh 的 renderPrompt() 看「下次将生效的样子」。
     *   但那个函数从插件里 import 不到，界面上永远显示不可用，已移除。）
     */
    /**
     * 读**完整的、未被覆盖的**系统提示词段落（供「系统提示词」面板用）。
     *
     * ⚠️ **关键：带 `scope`，同时带 `READ_ORIGINAL` 标记。**
     *
     *    · 带 `scope`  → scoped 层注册的段落（21 段 `tool:*` 等）**才会出现**
     *    · 带标记      → 覆盖监听器放行 → 文本是**官方原文**，不是我们改过的
     *
     *    之前的实现是「不带 scope」，结果是**列表缺了一大半**（详见 READ_ORIGINAL
     *    的注释）。这一点的教训是：`scope` 同时控制着「谁注册的段落出现」和
     *    「瀑布监听器跑不跑」，**不能用它来单独关掉其中一个**。
     *
     * @param {string} [sessionId] 用哪个会话来读（省略则用任一存活的 agent）
     */
    async listSections(sessionId) {
      // 没指定会话时用任一存活的 agent —— 段落构成是全局面（scoped 的差异只影响
      // 各段落的文本），用哪个 agent 读到的段落集合是一样的。
      let agent = findAgent(sessionId);
      if (!agent && agents.size > 0) agent = agents.values().next().value;
      if (!agent) {
        return { outcome: "awaiting-agent", error: "还没有存活的会话，稍后再试", sections: [] };
      }
      const sp = agent.ctx?.systemPrompt;
      if (!sp || typeof sp.assemble !== "function") {
        return { outcome: "no-assemble-api", error: "该 agent 上取不到 systemPrompt.assemble", sections: [] };
      }
      let assembly;
      try {
        assembly = await sp.assemble({ agent, scope: agent, [READ_ORIGINAL]: true });
      } catch (err) {
        return { outcome: "assemble-threw", error: `组装失败：${err?.message ?? String(err)}`, sections: [] };
      }
      const sections = (assembly?.sections ?? [])
        .filter((s) => s && typeof s.name === "string")
        // ⚠️ **把本插件自己注入的段落剔除掉。**
        //
        // 「系统提示词」面板列的是 **dsh 原生的段落** —— 让用户逐段看、逐段改。
        // 本插件注入的提示词不属于这一类：那是用户自己写的内容，归「提示词库」
        // 那一块管，混进来会让人以为「这也是 dsh 自带的」。
        //
        // 真机上就出过这个歧义：列表里冒出 `prompt-manager:infinite-gen-3`
        // （4290 字），用户第一反应是「这是什么东西」。
        //
        // 判据是段名前缀。默认注入名是 `prompt-manager:<promptId>`；
        // 用户在 catalog 里自定义了 `sectionName` 的话不会被过滤掉 —— 那种情况
        // 少见，而且名字是他自己起的，混进来也不算意外。
        .filter((s) => !s.name.startsWith(SELF_PREFIX))
        .map((s, index) => ({
          name: s.name,
          index,
          text: typeof s.text === "string" ? s.text : "",
        }));
      return { outcome: "ok", agentId: sessionIdOf(agent), sections };
    },

    async preview(sessionId, { maxSectionChars = 20000 } = {}) {
      const agent = findAgent(sessionId);
      if (!agent) return { error: "该会话的 agent 未加载，无法预览", outcome: "awaiting-agent" };
      const sp = agent.ctx?.systemPrompt;
      if (!sp || typeof sp.assemble !== "function") {
        return { error: "该 agent 上取不到 systemPrompt.assemble", outcome: "no-assemble-api" };
      }
      let assembly;
      try {
        // ⚠️ `agent` 和 `scope` **都要传**。只传 scope 会让读 context.agent 的
        //    段落（approval:policy / sandbox:policy）拿到 undefined 并返回空串，
        //    预览里就变成「上下文段 N 段 = 0 tokens」。官方用法见
        //    dsh-agent/lib/types/dispatch.js:92 `assembleContextFor`。
        assembly = await sp.assemble({ agent, scope: agent });
      } catch (err) {
        return {
          error: `组装失败：${err?.message ?? String(err)}`,
          outcome: "assemble-threw",
          hint:
            "常见原因：同时存在多个 complete 段落（比如 dsh 自带 persona 的覆盖开关和别的插件撞了）—— " +
            "检查 dsh-persona 的 complete 配置。",
        };
      }

      const cut = (t) => ({
        chars: t.length,
        tokens: estimateTokens(t),
        truncated: t.length > maxSectionChars,
        text: t.length > maxSectionChars ? t.slice(0, maxSectionChars) : t,
      });

      const sections = (assembly?.sections ?? []).map((s) => {
        const text = typeof s.text === "string" ? s.text : String(s.text ?? "");
        return { name: s.name, complete: s.complete === true, ...cut(text) };
      });
      const contexts = (assembly?.contexts ?? []).map((c) => {
        const text = typeof c.text === "string" ? c.text : String(c.text ?? "");
        return { name: c.name, ...cut(text) };
      });
      const tools = (assembly?.tools ?? []).map((t) => {
        let schemaText = "";
        try {
          schemaText = JSON.stringify(t?.parameters ?? {});
        } catch {
          schemaText = "";
        }
        const body = `${t?.name ?? ""}\n${t?.description ?? ""}\n${schemaText}`;
        return {
          name: t?.name ?? "(未命名)",
          description: typeof t?.description === "string" ? t.description : "",
          parameters:
            t?.parameters && typeof t.parameters === "object" ? t.parameters : {},
          deferLoading: t?.deferLoading === true,
          chars: body.length,
          tokens: estimateTokens(body),
        };
      });

      const sectionTokens = sections.reduce((n, s) => n + s.tokens, 0);
      const contextTokens = contexts.reduce((n, c) => n + c.tokens, 0);
      const toolTokens = tools.reduce((n, t) => n + t.tokens, 0);

      // 本地渲染（renderPrompt）已移除 —— 从插件里 import 不到，界面上会永远显示
      // 「不可用」，是纯噪音。真实内容走下面的会话日志那条路。
      const logged = loggedSystemPrompt(agent);

      const myIds = resolvedIds(sessionId);
      const myPrompts = myIds
        .map((id) => (typeof resolvePrompt === "function" ? resolvePrompt(id) : undefined))
        .filter(Boolean);
      const mySectionNames = new Set(myPrompts.map((p) => p.sectionName));
      const mine = sections.filter((s) => mySectionNames.has(s.name));

      // ── 「我们的增量」：相对**原生装配**多花了多少 ─────────────────────
      //
      // ⚠️ 为什么要有这个：总数（totalTokens）是**原生 + 我们**的合计，
      //    用户看不出「我挂的这东西到底花了多少」。而答案分两块，
      //    两块都算得出来，不用猜：
      //
      //      ① 我们自己的段落：名字是 `prompt-manager:<id>`，
      //         在 sections 里能直接认出来 —— 这些**整段**都是我们加的
      //
      //      ② 段落改写：只改**已有**段落的正文，名字不变，认不出来 ——
      //         但覆盖记录里存了 `original`（改之前的原文）和 `text`（改写后），
      //         两者字数之差就是净增量。**这是准确值，不是估算。**
      //
      //    ⚠️ 只在能拿到覆盖记录时才算。拿不到就不报这个字段 ——
      //       宁可没有，也不要给个看着像真的的错数字。
      const oursSections = mine.reduce((n, s) => n + (s.tokens || 0), 0);
      const oursSectionCount = mine.length;

      let overridesDelta = null;
      let overridesDeltaCount = null;
      let overridesSectionsCleared = null;
      try {
        // ⚠️ 这里要**走完整条判定链**，不能只调一半：
        //
        //      resolveOverrides(全局表, 该会话的表)   合并两层
        //        → normalizeOverrides(…)             校验，返回 {name: rec}
        //        → planOverrides({ overrides, globalSections })   判定
        //
        //    第一版我漏了 `planOverrides`，直接拿 `normalizeOverrides` 的返回值
        //    去取 `.apply` —— 那是个 `{name: rec}` 的字典，根本没有 `.apply`，
        //    算出来会是 undefined 或垃圾。
        const merged = normalizeOverrides(
          typeof getSectionOverrides === "function" ? getSectionOverrides(sessionId) : {},
        );
        const plan = planOverrides({
          overrides: merged,
          // 官方原文的视图就是这次装配出来的 sections（它们的名字和顺序）
          globalSections: sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
        });

        let delta = 0;
        let n = 0;
        let cleared = 0;
        for (const row of plan?.apply ?? []) {
          // ⚠️ 比的是 **`original`（当前官方原文）** 和 `text`（用户改写后）——
          //    那才是这次装配实际发生的替换。
          //    `basedOn` 是「当初依据的旧原文」，官方改过之后它跟现在的不一样，
          //    拿它算会算错。
          const before = typeof row.original === "string" ? row.original : "";
          const after = typeof row.text === "string" ? row.text : "";
          // ⚠️ **分别估算再相减**，不要用「字符数差」去套估算 ——
          //    中文 1 字 ≈ 1 token、英文 4 字符 ≈ 1 token，
          //    拿字符差换算在混排文本上会偏得离谱。
          delta += estimateTokens(after) - estimateTokens(before);
          n += 1;
          if (row.action === "disable") cleared += 1;
        }
        overridesDelta = delta;
        overridesDeltaCount = n;
        overridesSectionsCleared = cleared;
      } catch {
        /* 算不出来就不报 —— 不编一个数 */
      }

      // 替换模式删除后，本插件不可能造成 complete 冲突。
      // 但仍要报一件事：**别的插件**（dsh 自带的 persona）若开启了覆盖，
      // 我们的 section 会整个消失 —— 那时用户看到「挂了却不在结果里」会困惑。
      let conflict = null;
      const completeElsewhere = sections.filter((s) => s.complete === true);
      if (completeElsewhere.length > 0 && mine.length === 0) {
        conflict = {
          kind: "shadowed-by-complete",
          message:
            `有别的插件在这个会话上开启了「独占系统提示词」覆盖（section：` +
            `${completeElsewhere.map((s) => s.name).join("、")}），` +
            `本插件挂的 section 不在最终结果里。`,
          sections: sections.map((s) => ({ name: s.name, complete: s.complete })),
          hint: "检查 dsh 自带 persona 插件的覆盖开关（它的 Config 里有 complete）。" +
            "覆盖模式下所有其他 section 都会被顶掉，这是 dsh 的设计。",
        };
      }

      return {
        outcome: "ok",
        sessionId,
        promptIds: myIds,
        source: sourceOf(sessionId),
        prompts: myPrompts.map((p) => ({ id: p.id, name: p.name, mode: p.mode, order: p.order })),
        modes: myPrompts.map((p) => p.mode),
        sectionCount: sections.length,
        sectionTokens,
        contextCount: contexts.length,
        contextTokens,
        toolCount: tools.length,
        toolTokens,
        totalTokens: sectionTokens + contextTokens + toolTokens,
        sectionsOnlyTokens: sectionTokens,
        // 「我们的增量」—— 原生装配之上多花的部分。分两块报，因为来源不同：
        //   oursSectionsTokens   我们**自己加的段落**（整段都是我们的）
        //   overridesDeltaTokens 段落**改写**带来的净增减（改的可能是原生段落）
        // ⚠️ 拿不到覆盖记录时 overridesDelta* 是 null —— 不编数字。
        oursSectionCount,
        oursSectionsTokens: oursSections,
        overridesDeltaCount,
        overridesDeltaTokens: overridesDelta,
        overridesSectionsCleared,
        sections,
        contexts,
        tools,
        variables: assembly?.variables ?? null,
        // 模型实际看到的东西：会话日志里的 system/message（变量已由 dsh 替换）
        logged,
        conflict,
      };
    },

    /** 卸载用：卸载所有已挂载荷。 */
    disposeAll() {
      for (const sessionId of [...attached.keys()]) detach(sessionId);
      agents.clear();
    },

    /** 测试/诊断用。 */
    _internals: { explicit, agents, attached, attempts, getDefaults: () => defaults },
  };
}
