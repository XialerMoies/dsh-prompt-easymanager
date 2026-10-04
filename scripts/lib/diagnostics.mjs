/**
 * 运行时诊断查询。
 * 通过依赖注入读取宿主状态，避免诊断逻辑和插件生命周期、路由闭包混在一起。
 */
export function createDiagnostics({
  diag,
  pluginVersion,
  catalogPath,
  stateFile,
  libraryOf,
  getActiveInjector,
  getActiveLibrary,
  getHostContext,
} = {}) {
  function sessionStates() {
    try {
      const injector = typeof getActiveInjector === "function" ? getActiveInjector() : null;
      return injector ? injector.explain() : [];
    } catch (err) {
      return [{ error: err?.message ?? String(err) }];
    }
  }

  function libraryList(ctx) {
    try {
      const library = typeof libraryOf === "function" ? libraryOf(ctx) : null;
      return library ? library.list() : [];
    } catch (err) {
      return [{ error: err?.message ?? String(err) }];
    }
  }

  function libraryErrors() {
    try {
      const library = typeof getActiveLibrary === "function" ? getActiveLibrary() : null;
      return library ? library.errors() : [];
    } catch {
      return [];
    }
  }

  function listAgentsDiag() {
    try {
      const context = typeof getHostContext === "function" ? getHostContext() : null;
      if (!context || !context.agents) return { error: "ctx.agents 不可用" };
      const all = typeof context.agents.list === "function" ? context.agents.list() : [];
      const roots = typeof context.agents.roots === "function" ? context.agents.roots() : [];
      const shape = (agent) => ({
        id: agent?.id ?? null,
        sessionId: agent?.session?.id ?? null,
        hasCtx: !!agent?.ctx,
        hasInject: typeof agent?.ctx?.inject === "function",
        systemPromptDirect: !!agent?.ctx?.systemPrompt,
        origin: agent?.session?.header?.origin ?? null,
        delegationDepth: agent?.session?.header?.delegationDepth ?? null,
        parentSession: agent?.session?.header?.parentSession ?? null,
      });
      return {
        listCount: all.length,
        rootsCount: roots.length,
        list: all.map(shape),
        roots: roots.map(shape),
      };
    } catch (err) {
      return { error: err?.message ?? String(err) };
    }
  }

  function publicDiag() {
    return {
      version: pluginVersion,
      routeRegistered: diag?.routeRegistered ?? false,
      routeError: diag?.routeError ?? null,
      lastPost: diag?.lastPost ?? null,
      lastSessionCheck: diag?.lastSessionCheck ?? null,
      lastPreview: diag?.lastPreview ?? null,
      assignCount: diag?.assignCount ?? 0,
      reloadCount: diag?.reloadCount ?? 0,
      catalogPath,
      stateFile,
      libraryErrors: libraryErrors(),
    };
  }

  function classifySession(ctx, sessionId) {
    let registry;
    try {
      registry = ctx?.agents;
    } catch {
      return "unverifiable";
    }
    if (!registry || typeof registry.get !== "function") return "unverifiable";
    try {
      if (registry.get(sessionId) !== undefined) return "verified";
      const liveCount =
        typeof registry.roots === "function"
          ? (registry.roots() ?? []).length
          : typeof registry.list === "function"
            ? (registry.list() ?? []).length
            : 0;
      return liveCount === 0 ? "unverifiable" : "reject";
    } catch {
      return "unverifiable";
    }
  }

  function findAgentFor(ctx, sessionId) {
    try {
      const roots = ctx?.agents?.roots?.() ?? [];
      const list = typeof ctx?.agents?.list === "function" ? ctx.agents.list() : roots;
      const normalize = (value) => String(value ?? "").replace(/^session-/, "").toLowerCase();
      const wanted = normalize(sessionId);
      return [...list, ...roots].find(
        (agent) => normalize(agent?.id) === wanted || normalize(agent?.session?.id) === wanted,
      );
    } catch {
      return undefined;
    }
  }

  return {
    sessionStates,
    libraryList,
    libraryErrors,
    listAgentsDiag,
    publicDiag,
    classifySession,
    findAgentFor,
  };
}

