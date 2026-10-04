// Global switch and state projections used by the settings UI.
export async function handleState(request, url, deps) {
  const {
    STATE_PATH,
    GLOBAL_PATH,
    ctx,
    injectorOf,
    readState,
    writeState,
    libraryList,
    CATEGORIES,
    presetSignature,
    presetLabel,
    publicDiag,
    diag,
    jsonOf,
    syncInjector,
    CATALOG_PATH,
  } = deps;
  const path = url.pathname;
if (path === STATE_PATH && request.method === "POST") {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonOf({ error: "请求体不是合法 JSON" }, 400);
  }
  if (!("enabled" in (body ?? {}))) {
    return jsonOf({ error: "缺少 enabled 字段" }, 400);
  }
  const next = body.enabled !== false;
  writeState({ enabled: next });
  diag.lastToggle = next ? "enabled" : "disabled";
  return jsonOf({ ok: true, enabled: next, note: next ? "已启用你的提示词配置" : "已切回 dsh 原始提示词" });
}

if (path === STATE_PATH && request.method === "GET") {
  const snap = injectorOf(ctx)?.snapshot() ?? { version: 2 };
  const st = readState();
  const items = libraryList(ctx);
  const custom = [...new Set(
    items
      .map((p) => p && p.category)
      .filter((c) => c && !CATEGORIES.some((k) => k.id === c)),
  )].sort();
  return jsonOf({
      assignments: st.assignments,
      global: st.global,
      enabled: st.global.enabled === true,
      presets: Object.fromEntries(
        Object.entries(st.presets).map(([id, p]) => [id, {
          ...p,
          sections: p.selection?.sections ?? {},
          signature: presetSignature(p),
          label: presetLabel(p),
          isNative: p.prompts.length === 0 &&
            Object.keys(p.selection?.sections ?? {}).length === 0 &&
            (p.selection?.listed ?? []).length === 0 &&
            (p.selection?.excluded ?? []).length === 0,
        }]),
      ),
      sectionOverrides: {},
      schemaVersion: 3,
      version: snap.version,
      prompts: items,
      categories: CATEGORIES,
      customCategories: custom,
      catalogPath: CATALOG_PATH,
      diag: publicDiag(),
    });
}

  // The global layer stores only its switch and selected preset id.
  if (path === GLOBAL_PATH) {
    if (request.method === "GET") {
      return jsonOf({ global: readState().global });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      diag.lastPost = "bad-json";
      return jsonOf({ ok: false, error: "请求体不是合法 JSON" }, 400);
    }
    const s = readState();
    const next = { ...s.global };
    if ("enabled" in (body ?? {})) next.enabled = body.enabled === true;
    if ("presetId" in (body ?? {})) {
      next.presetId =
        typeof body.presetId === "string" && body.presetId ? body.presetId : null;
    }
    if (next.enabled === true && !next.presetId) {
      diag.lastPost = "global-needs-preset";
      return jsonOf(
        {
          ok: false,
          outcome: "preset-required",
          error: "要开启全局注入，得先选一个预设",
          known: Object.keys(s.presets),
        },
        400,
      );
    }
    if (next.presetId && !s.presets[next.presetId]) {
      diag.lastPost = "unknown-preset";
      return jsonOf(
        { ok: false, outcome: "unknown-preset", error: `没有这条预设：${next.presetId}` },
        400,
      );
    }
    writeState({ global: next });
    syncInjector(ctx);
    diag.lastToggle = next.enabled ? "enabled" : "disabled";
    return jsonOf({ ok: true, global: readState().global });
  }

  return null;
}


