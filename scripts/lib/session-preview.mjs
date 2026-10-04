import { estimateTokens } from "./prompt-library.mjs";
import { normalizeOverrides, planOverrides } from "./section-overrides.mjs";

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
 * 读取会话日志里模型最近一次实际收到的 system/message。
 * dsh 只在提示词变化时写入正文，因此要跳过尾部的空清理事件。
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
  for (const event of events) {
    const type = event && event.type ? String(event.type) : "(无 type)";
    typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
    if (type === "system/message") sysMsgs.push(event);
  }
  if (sysMsgs.length === 0) {
    return {
      ok: false,
      reason: `日志里有 ${events.length} 条事件，但一条 system/message 都没有`,
      eventCount: events.length,
      eventTypes: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    };
  }

  let last = null;
  for (let i = sysMsgs.length - 1; i >= 0; i--) {
    const text = messageTextOf(sysMsgs[i].data?.message);
    if (text) {
      last = { event: sysMsgs[i], text };
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
    isLatestEvent: last.event === sysMsgs[sysMsgs.length - 1],
    eventCount: events.length,
  };
}

/**
 * 预览某会话的最终系统提示词、上下文和工具。
 * 依赖通过参数传入，避免预览逻辑反向依赖注入器内部状态。
 */
export async function previewSession({
  sessionId,
  maxSectionChars = 20000,
  findAgent,
  resolvePrompt,
  resolvedIds,
  sourceOf,
  getSectionOverrides,
} = {}) {
  const agent = typeof findAgent === "function" ? findAgent(sessionId) : undefined;
  if (!agent) return { error: "该会话的 agent 未加载，无法预览", outcome: "awaiting-agent" };
  const sp = agent.ctx?.systemPrompt;
  if (!sp || typeof sp.assemble !== "function") {
    return { error: "该 agent 上取不到 systemPrompt.assemble", outcome: "no-assemble-api" };
  }

  let assembly;
  try {
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

  const cut = (value) => {
    const text = String(value ?? "");
    return {
      chars: text.length,
      tokens: estimateTokens(text),
      truncated: text.length > maxSectionChars,
      text: text.length > maxSectionChars ? text.slice(0, maxSectionChars) : text,
    };
  };

  const sections = (assembly?.sections ?? []).map((section) => ({
    name: section.name,
    complete: section.complete === true,
    ...cut(section.text),
  }));
  const contexts = (assembly?.contexts ?? []).map((context) => ({
    name: context.name,
    ...cut(context.text),
  }));
  const tools = (assembly?.tools ?? []).map((tool) => {
    let schemaText = "";
    try {
      schemaText = JSON.stringify(tool?.parameters ?? {});
    } catch {
      schemaText = "";
    }
    const body = `${tool?.name ?? ""}\n${tool?.description ?? ""}\n${schemaText}`;
    return {
      name: tool?.name ?? "(未命名)",
      description: typeof tool?.description === "string" ? tool.description : "",
      parameters: tool?.parameters && typeof tool.parameters === "object" ? tool.parameters : {},
      deferLoading: tool?.deferLoading === true,
      chars: body.length,
      tokens: estimateTokens(body),
    };
  });

  const sectionTokens = sections.reduce((sum, section) => sum + section.tokens, 0);
  const contextTokens = contexts.reduce((sum, context) => sum + context.tokens, 0);
  const toolTokens = tools.reduce((sum, tool) => sum + tool.tokens, 0);
  const logged = loggedSystemPrompt(agent);

  const myIds = typeof resolvedIds === "function" ? resolvedIds(sessionId) : [];
  const myPrompts = myIds
    .map((id) => (typeof resolvePrompt === "function" ? resolvePrompt(id) : undefined))
    .filter(Boolean);
  const mySectionNames = new Set(myPrompts.map((prompt) => prompt.sectionName));
  const mine = sections.filter((section) => mySectionNames.has(section.name));

  let overridesDelta = null;
  let overridesDeltaCount = null;
  let overridesSectionsCleared = null;
  try {
    const merged = normalizeOverrides(
      typeof getSectionOverrides === "function" ? getSectionOverrides(sessionId) : {},
    );
    const plan = planOverrides({
      overrides: merged,
      globalSections: sections.map((section) => ({ name: section.name, text: section.text ?? "" })),
    });
    let delta = 0;
    let count = 0;
    let cleared = 0;
    for (const row of plan?.apply ?? []) {
      const before = typeof row.original === "string" ? row.original : "";
      const after = typeof row.text === "string" ? row.text : "";
      delta += estimateTokens(after) - estimateTokens(before);
      count += 1;
      if (row.action === "disable") cleared += 1;
    }
    overridesDelta = delta;
    overridesDeltaCount = count;
    overridesSectionsCleared = cleared;
  } catch {
    /* 算不出来就不报，避免展示不可靠的数字。 */
  }

  let conflict = null;
  const completeElsewhere = sections.filter((section) => section.complete === true);
  if (completeElsewhere.length > 0 && mine.length === 0) {
    conflict = {
      kind: "shadowed-by-complete",
      message:
        `有别的插件在这个会话上开启了「独占系统提示词」覆盖（section：` +
        `${completeElsewhere.map((section) => section.name).join("、")}），` +
        "本插件挂的 section 不在最终结果里。",
      sections: sections.map((section) => ({ name: section.name, complete: section.complete })),
      hint:
        "检查 dsh 自带 persona 插件的覆盖开关（它的 Config 里有 complete）。" +
        "覆盖模式下所有其他 section 都会被顶掉，这是 dsh 的设计。",
    };
  }

  return {
    outcome: "ok",
    sessionId,
    promptIds: myIds,
    source: typeof sourceOf === "function" ? sourceOf(sessionId) : undefined,
    prompts: myPrompts.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      mode: prompt.mode,
      order: prompt.order,
    })),
    modes: myPrompts.map((prompt) => prompt.mode),
    sectionCount: sections.length,
    sectionTokens,
    contextCount: contexts.length,
    contextTokens,
    toolCount: tools.length,
    toolTokens,
    totalTokens: sectionTokens + contextTokens + toolTokens,
    sectionsOnlyTokens: sectionTokens,
    oursSectionCount: mine.length,
    oursSectionsTokens: mine.reduce((sum, section) => sum + (section.tokens || 0), 0),
    overridesDeltaCount,
    overridesDeltaTokens: overridesDelta,
    overridesSectionsCleared,
    sections,
    contexts,
    tools,
    variables: assembly?.variables ?? null,
    logged,
    conflict,
  };
}

