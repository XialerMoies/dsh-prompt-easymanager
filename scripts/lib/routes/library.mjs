// Prompt library editor endpoints.
export async function handleLibrary(request, url, deps) {
  const {
    EDIT_PATH,
    ctx,
    readState,
    libraryOf,
    storeOf,
    libraryList,
    libraryErrors,
    estimateTokens,
    CATEGORIES,
    CATALOG_PATH,
    PROMPTS_DIR,
    injectorOf,
    prunePresets,
    syncInjector,
    diag,
    jsonOf,
  } = deps;
  const path = url.pathname;
  if (path !== EDIT_PATH) return null;// Prompt library editor endpoints.
if (path === EDIT_PATH && request.method === "GET") {
  const stEdit = readState();
  const items = libraryOf(ctx).raw().map((entry) => {
    const resolved = entry && typeof entry.id === "string" ? libraryOf(ctx).resolve(entry.id) : undefined;
    return {
      id: entry?.id ?? null,
      name: resolved?.name ?? entry?.name ?? entry?.id ?? null,
      description: resolved?.description ?? entry?.description ?? "",
      category: resolved?.category ?? "other",
      mode: resolved?.mode ?? entry?.mode ?? "append",
      order: resolved?.order ?? entry?.order ?? 100,
      source: typeof entry?.file === "string" && entry.file ? "file" : typeof entry?.inline === "string" ? "inline" : "none",
      file: typeof entry?.file === "string" ? entry.file : null,
      tokens: resolved ? estimateTokens(resolved.text ?? "") : 0,
      chars: resolved ? (resolved.text ?? "").length : 0,
      text: resolved?.text ?? "",
    };
  });
  const custom = [...new Set(
    items.map((p) => p.category).filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
  )].sort();
  return jsonOf({
      prompts: items,
      categories: CATEGORIES,
      customCategories: custom,
      presets: stEdit.presets,
      global: stEdit.global,
      enabled: stEdit.global.enabled === true,
      catalogPath: CATALOG_PATH,
      promptsDir: PROMPTS_DIR,
      libraryErrors: libraryErrors(),
    });
}

if (path === EDIT_PATH && request.method === "POST") {
  let body;
  try {
    body = await request.json();
  } catch {
    diag.lastPost = "bad-json";
    return new Response("Bad JSON", { status: 400 });
  }
  const action = body?.action;
  if (action !== "upsert" && action !== "delete") {
    diag.lastPost = "bad-action";
    return jsonOf({ ok: false, error: `action 必须是 upsert 或 delete，收到 ${JSON.stringify(action)}` }, 400);
  }

  let result;
  if (action === "upsert") {
    result = storeOf(ctx).save(body?.prompt);
  } else {
    result = storeOf(ctx).remove(body?.id);
  }

  if (!result.ok) {
    diag.lastPost = `edit:${action}:failed`;
    return jsonOf(result, 400);
  }

  libraryOf(ctx).reload();
  const pruned = {};
  {
    const inner = injectorOf(ctx)?.pruneMissing() ?? {};
    if (inner && Object.keys(inner.defaults ?? {}).length) pruned.defaults = inner.defaults;
    if (inner && Object.keys(inner.sessions ?? {}).length) pruned.sessions = inner.sessions;
  }
  Object.assign(pruned, prunePresets((id) => libraryOf(ctx).has(id)));
  syncInjector(ctx);
  diag.editCount = (diag.editCount ?? 0) + 1;
  diag.lastPost = `edit:${action}:${result.id}`;
  return jsonOf({ ...result, pruned, prompts: libraryList(ctx), libraryErrors: libraryErrors() });
}

  return null;
}


