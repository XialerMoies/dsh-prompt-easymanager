/**
 * 读取 DSH 当前会话的原生系统提示词段落。
 *
 * 这部分只负责组装和过滤 section；会话查找、覆盖注入和状态管理留在
 * session-injection.mjs，避免注入器文件同时承载展示查询逻辑。
 */
export async function listSectionsForAgent({ agent, readOriginal, selfPrefix, sessionIdOf }) {
  if (!agent) {
    return { outcome: "awaiting-agent", error: "还没有存活的会话，稍后再试", sections: [] };
  }
  const sp = agent.ctx?.systemPrompt;
  if (!sp || typeof sp.assemble !== "function") {
    return { outcome: "no-assemble-api", error: "该 agent 上取不到 systemPrompt.assemble", sections: [] };
  }

  let assembly;
  try {
    assembly = await sp.assemble({ agent, scope: agent, [readOriginal]: true });
  } catch (err) {
    return { outcome: "assemble-threw", error: `组装失败：${err?.message ?? String(err)}`, sections: [] };
  }

  const sections = (assembly?.sections ?? [])
    .filter((s) => s && typeof s.name === "string")
    .filter((s) => !s.name.startsWith(selfPrefix))
    .map((s, index) => ({
      name: s.name,
      index,
      text: typeof s.text === "string" ? s.text : "",
    }));
  return { outcome: "ok", agentId: sessionIdOf(agent), sections };
}
