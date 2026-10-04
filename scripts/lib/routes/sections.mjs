// Read and mutate native system-prompt sections in the effective preset.
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
    diag,
    jsonOf,
    editActivePresetSelection,
    normalizeSelection,
    applySelectionEdit,
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
    const selNow = foundPreset?.preset?.selection ?? null;
    const projected = projectSelection({
      native: found.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
      selection: selNow,
    });

    const liveOf = (nm) => found.sections.find((s) => s.name === nm)?.text ?? "";
    const asRow = (row, status) => {
      const ov = selNow?.sections?.[row.name];
      return {
        name: row.name,
        index: found.sections.findIndex((s) => s.name === row.name),
        status,
        drifted: row.drifted === true,
        driftAcknowledged: false,
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
        globalOverrides: {},
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
      if (!["restore", "replace", "disable", "acknowledge"].includes(action)) {
        diag.lastSections = "bad-action";
        return jsonOf(
          {
            error: `action 必须是 replace / disable / restore / acknowledge，收到 ${JSON.stringify(action)}`,
          },
          400,
        );
      }
      if ((action === "replace" || action === "disable") && action === "replace" && typeof body?.text !== "string") {
        diag.lastSections = "missing-text";
        return jsonOf({ error: "replace 需要 text" }, 400);
      }

      const foundLive = await injector.listSections(sessionId);
      const live = foundLive.sections.find((s) => s.name === name);
      const liveText = typeof live?.text === "string" ? live.text : "";
      if ((action === "replace" || action === "disable") && live === undefined) {
        diag.lastSections = "unknown-section";
        return jsonOf(
          {
            error: `找不到段落 ${name} —— 它可能刚被官方删掉或改名了`,
            knownNames: foundLive.sections.map((s) => s.name),
          },
          404,
        );
      }

      if (action === "acknowledge") {
        const sAck = readState();
        const foundAck = presetForSession({
          sessionId,
          assignments: sAck.assignments,
          global: sAck.global,
          presets: sAck.presets,
        });
        if (!foundAck?.preset?.selection?.sections?.[name]) {
          diag.lastSections = "acknowledge-missing";
          return jsonOf({ error: `段落 ${name} 没有改动记录，无从确认` }, 404);
        }
      }


      const commit = (editFn) => {
        const r = editActivePresetSelection({ sessionId, fallbackToGlobal: true, edit: editFn });
        if (!r.ok) {
          diag.lastSections = r.outcome;
          return jsonOf({ ok: false, outcome: r.outcome, error: r.error }, 409);
        }
        wroteTo = r;
        return null;
      };

      if (action === "restore") {
        const bad = commit((sel) => {
          const next = normalizeSelection(sel);
          next.listed = next.listed.filter((n) => n !== name);
          next.excluded = next.excluded.filter((n) => n !== name);
          delete next.sections[name];
          return next;
        });
        if (bad) return bad;
      } else if (action === "replace" || action === "disable") {
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
      } else if (action === "acknowledge") {
        const sAck = readState();
        const foundAck = presetForSession({
          sessionId,
          assignments: sAck.assignments,
          global: sAck.global,
          presets: sAck.presets,
        });
        if (!foundAck?.preset?.selection?.sections?.[name]) {
          diag.lastSections = "acknowledge-missing";
          return jsonOf({ error: `段落 ${name} 没有改动记录，无从确认` }, 404);
        }
        const bad = commit((sel) => {
          const next = normalizeSelection(sel);
          const ov = next.sections[name];
          if (ov) next.sections[name] = { ...ov, original: liveText };
          return next;
        });
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
    const selAfter = foundAfter?.preset?.selection ?? null;
    const projected = projectSelection({
      native: found2.sections.map((s) => ({ name: s.name, text: s.text ?? "" })),
      selection: selAfter,
    });
    const asRow = (row, status) => {
      const ov = selAfter?.sections?.[row.name];
      return {
        name: row.name,
        index: found2.sections.findIndex((s) => s.name === row.name),
        status,
        drifted: row.drifted === true,
        driftAcknowledged: false,
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
        action,
        name,
        wroteTo: wroteTo
          ? { presetId: wroteTo.presetId, via: wroteTo.via, fellBack: wroteTo.fellBack === true }
          : null,
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


