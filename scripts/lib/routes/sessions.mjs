// Preview, reload the prompt library, and assign a preset to a session.
export async function handleSessions(request, url, deps) {
  const {
    ctx,
    PREVIEW_PATH,
    RELOAD_PATH,
    ASSIGN_PATH,
    injector,
    libraryOf,
    libraryList,
    readState,
    writeState,
    syncInjector,
    prunePresets,
    classifySession,
    diag,
    jsonOf,
  } = deps;
  const path = url.pathname;// Preview, library reload, and session assignment endpoints.
if (path === PREVIEW_PATH && request.method === "GET") {
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    diag.lastPreview = "missing-session";
    return new Response("session query param required", { status: 400 });
  }
  const result = await injector.preview(sessionId);
  diag.lastPreview = result.outcome ?? "unknown";
  return jsonOf(result);
}

if (path === RELOAD_PATH && request.method === "POST") {
  let r;
  try {
    r = libraryOf(ctx).reload();
  } catch (err) {
    diag.lastPost = "reload-threw";
    return jsonOf({ error: err?.message ?? String(err) }, 500);
  }
  diag.reloadCount += 1;
  diag.lastPost = `reload:${r.count}`;
  const pruned = prunePresets((id) => libraryOf(ctx).has(id));
  syncInjector(ctx);
  return jsonOf({ count: r.count, errors: r.errors, prompts: libraryList(ctx), pruned });
}

if (path === ASSIGN_PATH && request.method === "POST") {
  let body;
  try {
    body = await request.json();
  } catch {
    diag.lastPost = "bad-json";
    return jsonOf({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    diag.lastPost = "missing-sessionId";
    return jsonOf({ ok: false, error: "缺少 sessionId" }, 400);
  }

  if ("promptIds" in (body ?? {}) || "promptId" in (body ?? {})) {
    diag.lastPost = "legacy-promptIds";
    return jsonOf(
      {
        ok: false,
        outcome: "preset-required",
        error:
          "现在要选提示词组合（预设），不再直接收提示词 id。" +
          "先把组合存成预设，再传 presetId。",
      },
      400,
    );
  }

  if (body?.follow === true) {
    const beforeFollow = readState();
    const nextFollow = { ...beforeFollow.assignments };
    delete nextFollow[sessionId];
    writeState({ assignments: nextFollow });
    syncInjector(ctx);
    diag.lastPost = "assign:follow";
    return jsonOf({ ok: true, presetId: undefined, follow: true, assignments: nextFollow });
  }

  if (!("presetId" in (body ?? {}))) {
    diag.lastPost = "missing-presetId";
    return jsonOf(
      {
        ok: false,
        error: "要传 presetId（预设名或 null），或者 follow: true（跟随全局）",
      },
      400,
    );
  }
  const presetId = body.presetId;
  if (presetId !== null && (typeof presetId !== "string" || !presetId)) {
    diag.lastPost = "bad-presetId";
    return jsonOf({ ok: false, error: "presetId 要么是预设名，要么是 null" }, 400);
  }

  const before = readState();
  if (typeof presetId === "string" && !before.presets[presetId]) {
    diag.lastPost = "unknown-preset";
    return jsonOf(
      {
        ok: false,
        outcome: "unknown-preset",
        error: `没有这条预设：${presetId}`,
        known: Object.keys(before.presets),
      },
      400,
    );
  }

  const verdict = classifySession(ctx, sessionId);
  diag.lastSessionCheck = verdict;
  if (verdict === "reject") {
    diag.lastPost = "unknown-session";
    return jsonOf({ ok: false, error: "会话不存在" }, 404);
  }

  const nextAssign = { ...before.assignments };
  if (presetId === null) nextAssign[sessionId] = null;
  else nextAssign[sessionId] = presetId;
  writeState({ assignments: nextAssign });
  syncInjector(ctx);
  diag.assignCount += 1;
  diag.lastPost = `assign:${presetId ?? "(none)"}`;
  return jsonOf({
    ok: true,
    presetId: presetId ?? null,
    assignments: nextAssign,
    sessionCheck: verdict,
  });
}

  return null;
}


