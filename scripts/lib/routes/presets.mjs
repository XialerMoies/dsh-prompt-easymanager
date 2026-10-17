// Preset CRUD and application to the global or session scope.
export async function handlePresets(request, url, deps) {
  const {
    ctx,
    PRESETS_PATH,
    readState,
    writeState,
    syncInjector,
    libraryOf,
    diag,
    jsonOf,
    presetId,
    presetSignature,
    presetLabel,
    summarizePreset,
    presetForSession,
    capturePreset,
    selectionFromSectionsInput,
    normalizeSelection,
    isEmptySelection,
    storeOf,
    serializePresetBundle,
    parsePresetBundle,
    dshVersion,
  } = deps;
  if (url.pathname !== PRESETS_PATH) return null;
  // Preset CRUD and application to the global or session scope.
  const sessionId = url.searchParams.get("session") ?? undefined;
  const hasSession = typeof sessionId === "string" && sessionId.length > 0;

  if (request.method === "GET" && url.searchParams.get("export") === "1") {
    const id = url.searchParams.get("id") || "";
    const state = readState();
    const preset = state.presets[id];
    if (!preset) return jsonOf({ error: "没有这条预设" }, 404);
    const library = libraryOf(ctx);
    const prompts = (preset.prompts || []).map((pid) => library.resolve(pid)).filter(Boolean);
    const listed = new Set(preset.selection?.listed ?? []);
    const sectionOverrides = Object.fromEntries(
      Object.entries(state.sectionOverrides ?? {}).filter(([name]) => listed.has(name)),
    );
    const markdown = serializePresetBundle({ preset, prompts, sectionOverrides, dshVersion: dshVersion?.() });
    return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${encodeURIComponent(preset.name || "preset")}.md"`, "cache-control": "no-store" } });
  }

  const presetList = (s) =>
    Object.entries(s.presets)
      .map(([id, p]) => ({
        id,
        name: p.name,
        prompts: p.prompts,
        sections: p.selection?.sections ?? {},
        selection: p.selection,
signature: presetSignature(p),
        createdAt: p.createdAt,
        note: p.note,
        summary: summarizePreset(p),
        label: presetLabel(p),
        isNative: p.prompts.length === 0 &&
          Object.keys(p.selection?.sections ?? {}).length === 0 &&
          (p.selection?.listed ?? []).length === 0 &&
          (p.selection?.excluded ?? []).length === 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

  if (request.method === "GET") {
    const s = readState();
    return jsonOf({
      presets: presetList(s),
      global: s.global,
      session: hasSession
        ? {
            sessionId,
            presetId: Object.prototype.hasOwnProperty.call(s.assignments, sessionId)
              ? s.assignments[sessionId]
              : undefined,
          }
        : null,
      effective: hasSession
        ? (() => {
            const found = presetForSession({
              sessionId,
              assignments: s.assignments,
              global: s.global,
              presets: s.presets,
            });
            return found?.preset
              ? {
                  ...found,
                  signature: presetSignature(found.preset),
                  preset: {
                    ...found.preset,
                    signature: presetSignature(found.preset),
                    label: presetLabel(found.preset),
                  },
                }
              : found;
          })()
        : null,
    });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      diag.lastPresets = "bad-json";
      return jsonOf({ error: "请求体不是合法 JSON" }, 400);
    }
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "import-preview" || action === "import-commit") {
      let bundle;
      try { bundle = parsePresetBundle(body?.markdown); } catch (err) { return jsonOf({ error: err.message }, 400); }
      const incoming = bundle.preset;
      const state = readState();
      const library = libraryOf(ctx);
      const existingById = new Map((library.raw?.() || []).map((p) => [p.id, p]));
      const promptConflicts = [];
      for (const p of incoming.prompts) {
        const old = existingById.get(p.id);
        if (old && (library.resolve(p.id)?.text || "") !== p.text) promptConflicts.push({ id: p.id, name: p.name, type: "prompt", reason: "正文不同" });
      }
      const sectionConflicts = [];
      for (const [name, value] of Object.entries(incoming.sectionOverrides || {})) {
        if (state.sectionOverrides?.[name] && state.sectionOverrides[name].text !== value.text) sectionConflicts.push({ name, type: "section", reason: "改写正文不同" });
      }
      const preview = { name: incoming.name, prompts: incoming.prompts.length, rewrites: Object.keys(incoming.sectionOverrides || {}).length, conflicts: { name: Object.values(state.presets).some((p) => p.name === incoming.name), prompts: promptConflicts, sections: sectionConflicts }, dshVersion: bundle.dshVersion || null };
      if (action === "import-preview") return jsonOf({ ok: true, preview });
      const rename = typeof body.name === "string" && body.name.trim() ? body.name.trim() : incoming.name;
      const promptIdMap = {};
      const store = storeOf(ctx);
      for (const p of incoming.prompts) {
        let id = p.id;
        if (existingById.has(id) && (library.resolve(id)?.text || "") !== p.text) {
          let n = 2; id = `${p.id}-imported`;
          while (library.has(id)) id = `${p.id}-imported-${n++}`;
        }
        promptIdMap[p.id] = id;
        if (!library.has(id)) {
          const result = store.save({ id, name: p.name, description: p.description, category: p.category, mode: p.mode, order: p.order, text: p.text });
          if (!result.ok) return jsonOf({ error: result.error }, 400);
        }
      }
      library.reload?.();
      const selection = incoming.selection || { listed: [], excluded: [], sections: {}, known: [] };
      const preset = capturePreset({ name: rename, prompts: incoming.prompts.map((p) => promptIdMap[p.id] || p.id), selection, note: incoming.note || "" });
      const id = presetId(rename, Object.keys(state.presets));
      const sections = body.overwriteSections === true ? incoming.sectionOverrides : Object.fromEntries(Object.entries(incoming.sectionOverrides || {}).filter(([name]) => !sectionConflicts.some((x) => x.name === name)));
      writeState({ presets: { ...state.presets, [id]: preset }, sectionOverrides: { ...state.sectionOverrides, ...sections } });
      syncInjector(ctx);
      diag.lastPresets = `import:${id}`;
      return jsonOf({ ok: true, id, name: rename, preview, applied: { prompts: incoming.prompts.length, rewrites: Object.keys(sections).length } });
    }

    const readContent = () => {
      const out = {};
      const tagSelection = (raw) => {
        const selection = normalizeSelection(raw);
        return { ...selection, sections: {} };
      };
      if ("prompts" in (body ?? {})) {
        const prompts = Array.isArray(body.prompts) ? body.prompts : [];
        const unknown = prompts.filter((x) => typeof x !== "string" || !libraryOf(ctx).has(x));
        if (unknown.length > 0) return { error: `提示词库里没有：${unknown.join("、")}` };
        out.prompts = prompts;
      }
      if ("sections" in (body ?? {})) {
        out.selection = tagSelection(
          body.sections && typeof body.sections === "object" && !Array.isArray(body.sections)
            ? selectionFromSectionsInput(body.sections)
            : normalizeSelection(null),
        );
      }
      if ("selection" in (body ?? {})) {
        out.selection = tagSelection(body.selection);
      }
      return out;
    };

    const emptySelectionProblem = (content) => {
      const available = Array.isArray(body?.availableNative) ? body.availableNative : [];
      if (available.length === 0) return null; // 不知道 → 不拦
      const raw = body?.selection && typeof body.selection === "object" ? body.selection : {};
      const sel = {
        listed: Array.isArray(raw.listed) ? raw.listed : [],
        excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
        sections: { ...(raw.sections && typeof raw.sections === "object" ? raw.sections : {}) },
      };
      if (content.selection) {
        sel.listed = content.selection.listed;
        sel.excluded = content.selection.excluded;
        sel.sections = content.selection.sections;
      }
      return isEmptySelection({ selection: sel, availableNative: available })
        ? "这张清单里一段都不会进系统提示词 —— 至少勾一段原生段落，或者挂一条自己的提示词。"
        : null;
    };

    if (action === "save") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        diag.lastPresets = "missing-name";
        return jsonOf({ error: "缺少预设名字" }, 400);
      }
      const content = readContent();
      if (content.error) {
        diag.lastPresets = "unknown-prompt";
        return jsonOf({ error: content.error }, 400);
      }
      {
        const empty = emptySelectionProblem(content);
        if (empty) {
          diag.lastPresets = "empty-selection";
          return jsonOf({ ok: false, outcome: "empty-selection", error: empty }, 400);
        }
      }
      const s = readState();
      const id = presetId(name, Object.keys(s.presets));
      const preset = capturePreset({
        name,
        prompts: content.prompts ?? [],
        selection: content.selection,
        note: typeof body?.note === "string" ? body.note : "",
      });
      writeState({ presets: { ...s.presets, [id]: preset } });
      diag.lastPresets = `save:${id}`;
      return jsonOf({ ok: true, id, preset: { ...preset, sections: {} } });
    }

    if (action === "update") {
      const id = typeof body?.id === "string" ? body.id : "";
      const s = readState();
      const preset = s.presets[id];
      if (!preset) {
        diag.lastPresets = "unknown-preset";
        return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
      }
      const content = readContent();
      if (content.error) {
        diag.lastPresets = "unknown-prompt";
        return jsonOf({ error: content.error }, 400);
      }
      if ("sections" in (body ?? {}) || "selection" in (body ?? {})) {
        const empty = emptySelectionProblem(content);
        if (empty) {
          diag.lastPresets = "empty-selection";
          return jsonOf({ ok: false, outcome: "empty-selection", error: empty }, 400);
        }
      }
      const name =
        typeof body?.name === "string" && body.name.trim() ? body.name.trim() : preset.name;
      const nextId = presetId(name, Object.keys(s.presets).filter((x) => x !== id));
      const nextPresets = { ...s.presets };
      delete nextPresets[id];
      nextPresets[nextId] = {
        ...preset,
        name,
        prompts: content.prompts ?? preset.prompts,
        selection: content.selection ?? preset.selection,
      };
      const patch = { presets: nextPresets };
      if (nextId !== id) {
        if (s.global.presetId === id) patch.global = { ...s.global, presetId: nextId };
        const nextAssign = {};
        let touched = false;
        for (const [sid, v] of Object.entries(s.assignments)) {
          if (v === id) {
            nextAssign[sid] = nextId;
            touched = true;
          } else nextAssign[sid] = v;
        }
        if (touched) patch.assignments = nextAssign;
      }
      writeState(patch);
      syncInjector(ctx);
      diag.lastPresets = `update:${id}->${nextId}`;
      return jsonOf({ ok: true, id: nextId, oldId: id, name });
    }

    if (action === "delete") {
      const id = typeof body?.id === "string" ? body.id : "";
      const s = readState();
      if (!s.presets[id]) {
        diag.lastPresets = "unknown-preset";
        return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
      }
      const nextPresets = { ...s.presets };
      delete nextPresets[id];
      const patch = { presets: nextPresets };
      if (s.global.presetId === id) patch.global = { ...s.global, presetId: null };
      const nextAssign = {};
      let touched = false;
      for (const [sid, v] of Object.entries(s.assignments)) {
        if (v === id) touched = true;
        else nextAssign[sid] = v;
      }
      if (touched) patch.assignments = nextAssign;
      writeState(patch);
      syncInjector(ctx);
      diag.lastPresets = `delete:${id}`;
      return jsonOf({ ok: true, id });
    }

    if (action === "apply") {
      const id = typeof body?.id === "string" ? body.id : "";
      const s = readState();
      const preset = s.presets[id];
      if (!preset) {
        diag.lastPresets = "unknown-preset";
        return jsonOf({ error: `没有这条预设：${id}`, known: Object.keys(s.presets) }, 404);
      }
      const target = body?.target === "session" ? "session" : "global";
      if (target === "session" && !hasSession) {
        diag.lastPresets = "missing-session";
        return jsonOf({ error: "挂到会话上必须带 ?session=<sessionId>" }, 400);
      }
      if (target === "global") {
        writeState({
          global: { ...s.global, presetId: id, enabled: true },
        });
      } else {
        writeState({ assignments: { ...s.assignments, [sessionId]: id } });
      }
      syncInjector(ctx);
      diag.lastPresets = `apply:${target}:${id}`;
      return jsonOf({
        ok: true,
        id,
        name: preset.name,
        target,
        label: presetLabel(preset),
        applied: {
          prompts: preset.prompts.length,
          sections: Object.keys(preset.selection?.sections ?? {}).length,
          signature: presetSignature(preset),
        },
      });
    }

    diag.lastPresets = "bad-action";
    return jsonOf(
      {
        error: `action 必须是 save / update / delete / apply，收到 ${JSON.stringify(action)}`,
      },
      400,
    );
  }

  return null;
}

