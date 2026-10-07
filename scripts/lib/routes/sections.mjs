// Read and mutate native system-prompt sections in the effective preset.
function storedRewriteRows(overrides) {
  return Object.entries(overrides ?? {}).map(([name, override]) => ({
    name,
    index: null,
    status: "pending",
    drifted: false,
    driftAcknowledged: override?.acceptedDrift === true,
    original: override?.original ?? "",
    originalHash: override?.originalHash ?? "",
    basedOn: override?.original ?? "",
    basedOnHash: override?.originalHash ?? "",
    action: "replace",
    text: override?.text ?? "",
    savedAt: override?.savedAt ?? "",
  }));
}

export async function handleSections(request, url, deps) {
  const {
    SECTIONS_PATH,
    injector,
    readState,
    presetForSession,
    projectSelection,
    findEmptySlots,
    SECTION_SLOTS,
    OVERRIDE_ACTIONS,
    presetSignature,
    diag,
    jsonOf,
    writeState,
    editActivePresetSelection,
    normalizeSelection,
    applySelectionEdit,
    makeOverride,
    syncInjector,
  } = deps;
  if (url.pathname !== SECTIONS_PATH) return null;  // Native sections are projected into the current preset selection.
  const sessionId = url.searchParams.get("session") ?? undefined;
  if (request.method === "GET") {
    const found = await injector.listSections(sessionId);
    const state = readState();

    const foundPreset = presetForSession({
      sessionId,
      assignments: state.assignments,
      global: state.global,
      presets: state.presets,
    });
    if (found.outcome !== "ok") {
      const pendingRows = storedRewriteRows(state.sectionOverrides);
      return jsonOf({
        outcome: "stored-only",
        error: found.error ?? "当前没有打开的会话，暂时无法读取原生系统提示词。",
        agentId: found.agentId ?? null,
        summary: pendingRows.length > 0 ? `已保存 ${pendingRows.length} 段改写` : "等待读取原生段落",
        applied: [],
        pending: pendingRows,
        drifted: [],
        stale: [],
        untouched: [],
        availableNative: [],
        excludedSections: Array.isArray(foundPreset?.preset?.selection?.excluded)
          ? foundPreset.preset.selection.excluded
          : [],
        emptySlots: [],
        slotTotal: SECTION_SLOTS.length,
        globalOverrides: state.sectionOverrides ?? {},
        sessionOverrides: {},
        effectiveOverrides: {},
        effectivePresetId: foundPreset?.id ?? null,
        effectivePresetSignature: foundPreset?.preset ? presetSignature(foundPreset.preset) : null,
        counts: { applied: 0, drifted: 0, stale: 0, untouched: 0, total: pendingRows.length },
        actions: OVERRIDE_ACTIONS,
      });
    }
    const selNow = {
      ...(foundPreset?.preset?.selection ?? normalizeSelection(null)),
      sections: state.sectionOverrides ?? {},
    };
    const projected = projectSelection({
      native: found.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
      selection: selNow,
    });

    const liveOf = (nm) => found.sections.find((s) => s.name === nm)?.text ?? "";
    const asRow = (row, status) => {
      const ov = state.sectionOverrides?.[row.name];
      return {
        name: row.name,
        index: found.sections.findIndex((s) => s.name === row.name),
        status,
        drifted: row.drifted === true,
        driftAcknowledged: ov?.acceptedDrift === true,
        original: liveOf(row.name),
        originalHash: "",
        basedOn: ov?.original ?? "",
        basedOnHash: "",
        action: status === "apply" || status === "pending" ? "replace" : null,
        text: row.text ?? "",
        savedAt: ov?.savedAt ?? "",
      };
    };
    const appliedRows = projected.plan
      .filter((r) => r.mode === "edited" || r.mode === "dropped")
      .map((r) => asRow(r, "apply"));
    const pendingRows = projected.plan
      .filter((r) => r.mode === "pending")
      .map((r) => asRow(r, "pending"));
    const untouchedRows = projected.plan
      .filter((r) => r.mode === "native")
      .map((r) => asRow(r, "untouched"));
    const staleRows = (projected.stale ?? []).map((r) => asRow(r, "stale"));

    diag.lastSections = found.outcome;
    return jsonOf({
        outcome: found.outcome,
        error: found.error ?? null,
        agentId: found.agentId ?? null,
        summary:
          appliedRows.length > 0 ? `改 ${appliedRows.length} 段` : "全部原生",
        applied: appliedRows,
        pending: pendingRows,
        drifted: appliedRows.filter((r) => r.drifted),
        stale: staleRows,
        untouched: untouchedRows,
        availableNative: found.sections.map((s) => s.name),
        excludedSections: Array.isArray(selNow?.excluded) ? selNow.excluded : [],
        emptySlots: findEmptySlots(found.sections),
        slotTotal: SECTION_SLOTS.length,
        globalOverrides: state.sectionOverrides ?? {},
        sessionOverrides: {},
        effectiveOverrides: {},
        effectivePresetId: foundPreset?.id ?? null,
        effectivePresetSignature: foundPreset?.preset ? presetSignature(foundPreset.preset) : null,
        counts: {
          applied: appliedRows.length,
          drifted: appliedRows.filter((r) => r.drifted).length,
          stale: staleRows.length,
          untouched: untouchedRows.length,
          total: found.sections.length,
        },
        actions: OVERRIDE_ACTIONS,
      });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      diag.lastSections = "bad-json";
      return jsonOf({ error: "请求体不是合法 JSON" }, 400);
    }

    const name = typeof body?.name === "string" ? body.name : "";
    const action = typeof body?.action === "string" ? body.action : "";
    if (!name) {
      diag.lastSections = "missing-name";
      return jsonOf({ error: "缺少 name" }, 400);
    }

    let wroteTo = null;

    {
      if (!["restore", "replace", "delete", "disable", "acknowledge"].includes(action)) {
        diag.lastSections = "bad-action";
        return jsonOf(
          {
            error: `action 必须是 replace / delete / disable / restore / acknowledge，收到 ${JSON.stringify(action)}`,
          },
          400,
        );
      }
      if (action === "replace" && typeof body?.text !== "string") {
        diag.lastSections = "missing-text";
        return jsonOf({ error: "replace 需要 text" }, 400);
      }

      const foundLive = await injector.listSections(sessionId);
      const live = foundLive.sections.find((s) => s.name === name);
      const before = readState();
      const previousOverride = before.sectionOverrides?.[name];
      const liveText = typeof live?.text === "string" ? live.text : previousOverride?.original ?? "";
      if (
        ((action === "replace" && !previousOverride) || action === "disable") &&
        live === undefined
      ) {
        diag.lastSections = "unknown-section";
        return jsonOf(
          {
            error: `找不到段落 ${name} —— 它可能刚被官方删掉或改名了`,
            knownNames: foundLive.sections.map((s) => s.name),
          },
          404,
        );
      }

      if (action === "replace") {
        const state = before;
        writeState({
          sectionOverrides: {
            ...state.sectionOverrides,
            [name]: makeOverride({ action: "replace", text: body.text, original: liveText }),
          },
        });
      } else if (action === "delete" || action === "restore") {
        const state = before;
        const nextOverrides = { ...state.sectionOverrides };
        delete nextOverrides[name];
        const nextPresets = {};
        for (const [id, preset] of Object.entries(state.presets)) {
          const selection = normalizeSelection(preset.selection);
          const nextSections = { ...selection.sections };
          delete nextSections[name];
          nextPresets[id] = {
            ...preset,
            selection: {
              ...selection,
              listed: selection.listed.filter((item) => item !== name),
              sections: nextSections,
            },
          };
        }
        writeState({ sectionOverrides: nextOverrides, presets: nextPresets });
        syncInjector?.();
      } else if (action === "acknowledge") {
        const sAck = readState();
        if (!sAck.sectionOverrides?.[name]) {
          diag.lastSections = "acknowledge-missing";
          return jsonOf({ error: `段落 ${name} 没有改动记录，无从确认` }, 404);
        }
        writeState({
          sectionOverrides: {
            ...sAck.sectionOverrides,
            [name]: { ...sAck.sectionOverrides[name], acceptedDrift: true },
          },
        });
      } else if (action === "disable") {
        const commit = (editFn) => {
        const r = editActivePresetSelection({ sessionId, fallbackToGlobal: true, edit: editFn });
        if (!r.ok) {
          diag.lastSections = r.outcome;
          return jsonOf({ ok: false, outcome: r.outcome, error: r.error }, 409);
        }
        wroteTo = r;
        return null;
      };
        const bad = commit((sel) =>
          applySelectionEdit({
            native: [{ name, text: liveText }],
            selection: sel,
            name,
            action: action === "disable" ? "exclude" : undefined,
            edit:
              action === "disable" ? undefined : { text: body.text, original: liveText },
          }),
        );
        if (bad) return bad;
      }
    }

    const found2 = await injector.listSections(sessionId);
    const stateAfter2 = readState();
    const foundAfter = presetForSession({
      sessionId,
      assignments: stateAfter2.assignments,
      global: stateAfter2.global,
      presets: stateAfter2.presets,
    });
    if (found2.outcome !== "ok") {
      const pendingRows = storedRewriteRows(stateAfter2.sectionOverrides);
      return jsonOf({
        ok: true,
        action,
        name,
        outcome: "stored-only",
        error: found2.error ?? "当前没有打开的会话，暂时无法读取原生系统提示词。",
        summary: pendingRows.length > 0 ? `已保存 ${pendingRows.length} 段改写` : "等待读取原生段落",
        applied: [],
        pending: pendingRows,
        drifted: [],
        stale: [],
        untouched: [],
        availableNative: [],
        excludedSections: Array.isArray(foundAfter?.preset?.selection?.excluded)
          ? foundAfter.preset.selection.excluded
          : [],
        emptySlots: [],
        globalOverrides: stateAfter2.sectionOverrides ?? {},
        counts: { applied: 0, drifted: 0, stale: 0, untouched: 0, total: pendingRows.length },
      });
    }
    const selAfter = {
      ...(foundAfter?.preset?.selection ?? normalizeSelection(null)),
      sections: stateAfter2.sectionOverrides ?? {},
    };
    const projected = projectSelection({
      native: found2.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
      selection: selAfter,
    });
    const asRow = (row, status) => {
      const ov = stateAfter2.sectionOverrides?.[row.name];
      return {
        name: row.name,
        index: found2.sections.findIndex((s) => s.name === row.name),
        status,
        drifted: row.drifted === true,
        driftAcknowledged: ov?.acceptedDrift === true,
        original: found2.sections.find((s) => s.name === row.name)?.text ?? "",
        originalHash: "",
        basedOn: ov?.original ?? "",
        basedOnHash: "",
        action: status === "apply" || status === "pending" ? "replace" : null,
        text: row.text ?? "",
        savedAt: ov?.savedAt ?? "",
      };
    };
    const appliedRows = projected.plan
      .filter((r) => r.mode === "edited")
      .map((r) => asRow(r, "apply"));
    const pendingRows = projected.plan
      .filter((r) => r.mode === "pending")
      .map((r) => asRow(r, "pending"));
    const droppedRows = projected.plan
      .filter((r) => r.mode === "dropped")
      .map((r) => asRow(r, "apply"));
    const untouchedRows = projected.plan
      .filter((r) => r.mode === "native")
      .map((r) => asRow(r, "untouched"));
    const staleRows = (projected.stale ?? []).map((r) => asRow(r, "stale"));
    const allApplied = appliedRows.concat(droppedRows);
    diag.lastSections = `${action}:ok`;
    return jsonOf({
        ok: true,
        outcome: "ok",
        action,
        name,
        ...(wroteTo ? {
          wroteTo: { presetId: wroteTo.presetId, via: wroteTo.via, fellBack: wroteTo.fellBack === true },
        } : {}),
        summary:
          allApplied.length > 0
            ? `改 ${allApplied.length} 段`
            : untouchedRows.length > 0
              ? "全部原生"
              : "",
        applied: allApplied,
        pending: pendingRows,
        drifted: allApplied.filter((r) => r.drifted),
        stale: staleRows,
        untouched: untouchedRows,
        availableNative: found2.sections.map((s) => s.name),
        excludedSections: Array.isArray(selAfter?.excluded) ? selAfter.excluded : [],
        emptySlots: findEmptySlots(found2.sections),
        counts: {
          applied: allApplied.length,
          drifted: allApplied.filter((r) => r.drifted).length,
          stale: staleRows.length,
          untouched: untouchedRows.length,
          total: found2.sections.length,
        },
      });
  }
  return null;
}
