// Existing-session picker and session status row.
window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.picker.session.js",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");
    function create(api, shared) {
      var ActionButton = api.ui.ActionButton;
      var PresetSelector = api.ui.PresetSelector;
      var StateDot = api.ui.StateDot;
      var Tag = api.ui.Tag;
      var ROW = api.style.ROW;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
      var ROUTE_STATE = api.route.ROUTE_STATE;
      var ROUTE_PREVIEW = api.route.ROUTE_PREVIEW;
      var ROUTE_RELOAD = api.route.ROUTE_RELOAD;
      var metaOf = shared.metaOf;
      var pickOption = shared.pickOption;
      function PresetDropdown(props) {
  var data = props.data;
  var sessionId = props.sessionId;
  var busy = props.busy;
  var onClose = props.onClose;
  void sessionId;
  void busy;

  var errSt = react.useState(null);
  var err = errSt[0];
  var setErr = errSt[1];
  // ⚠️ 面板**自己拉一份 /presets?session=** —— 因为：
  //    · /state 里那份预设表没有 label（会话页要按 label 显示）
  //    · 「这个会话自己选了哪条」只有 /presets 的 session.presetId 说清了
  //      （undefined = 没记录、null = 显式什么都不挂 —— 两者不同）
  var exSt = react.useState(null);
  var extras = exSt[0];
  var setExtras = exSt[1];
  var msgSt = react.useState("");
  var msg = msgSt[0];
  var setMsg = msgSt[1];
  // ⚠️ **刷新计数器** —— 点选成功后 +1，让下面那个 effect 重跑。
  //
  //    原来只靠 `msg` 当依赖，而点选走的是 `props.onApplied`
  //    （外面那个 load，只重读 /state），**msg 没变 → effect 不重跑**，
  //    于是「切了但勾还停在旧那条上，关掉浮窗再开才对」。
  var tickSt = react.useState(0);
  var tick = tickSt[0];
  var setTick = tickSt[1];

  react.useEffect(function () {
    var alive = true;
    fetch(ROUTE_PRESETS + "?session=" + encodeURIComponent(sessionId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        if (alive) setExtras(d);
        return null;
      });
    return function () {
      alive = false;
    };
  }, [sessionId, msg, tick]);

  var presets = metaOf(Object.assign({}, props, { extras: extras }));

  /** 点一下 → 写状态 + 让宿主重挂（宿主会 syncInjector）。 */
  function pick(o) {
    setErr(null);
    setMsg("");
    var body = { sessionId: sessionId };
    if (o.kind === "follow") {
      // ⚠️ 「跟随全局」= **删掉这个会话的记录**。
      //    宿主 /assign 收 `presetId: null` 是「显式什么都不挂」，
      //    跟「跟随」**不是一回事** —— 所以这条走单独的参数。
      body.follow = true;
    } else {
      body.presetId = o.kind === "system" ? null : o.id;
    }
    return fetch(ROUTE_ASSIGN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
          return j;
        });
      })
      .then(function () {
        // ⚠️ 顺序：先让外面重读 /state，再让**面板自己**重读 /presets
        //    （勾要跟着挪到新选项上），最后**关掉面板**。
        props.onApplied && props.onApplied();
        setTick(tick + 1);
        return null;
      })
      .catch(function (e) {
        setErr((e && e.message) || String(e));
      });
  }

  // ── ────────────────────────────────────────────────────────
  // 「当前实际用哪条」（宿主算好的，面板不自己猜）
  // ──────────────────────────────────────────────────────────
  var menuItems = [{ type: "label", id: "session-title", text: "这个会话用什么" }];
  if (err) menuItems.push({ type: "label", id: "session-error", text: err });
  else if (msg) menuItems.push({ type: "label", id: "session-message", text: msg });

  menuItems = menuItems.concat(presets.map(function (o) {
    return {
      id: o.kind + ":" + (o.id || ""),
      label: o.label,
    };
  }));
  var activeOption = presets.find(function (o) { return o.active; });
  var activeId = activeOption ? activeOption.kind + ":" + (activeOption.id || "") : undefined;
  var selectOption = function (id) {
    var chosen = presets.find(function (o) { return o.kind + ":" + (o.id || "") === id; });
    if (!chosen) return;
    pickOption(chosen, Object.assign({}, props, {
      onDone: function () {
        setTick(tick + 1);
      },
    }));
  };

  if (!data) {
    menuItems.push({ type: "label", id: "session-loading", text: "读取中…" });
  } else if (presets.length === 0) {
    menuItems.push({
      type: "label",
      id: "session-empty",
      text: "还没有任何提示词组合。去「设置 → 提示词管理 → 提示词组合」存一条。",
    });
  }

  return react.createElement(PresetSelector, {
    open: props.open,
    onOpenChange: props.onOpenChange,
    label: props.label || "系统提示词",
    variant: props.anchorProps && props.anchorProps.variant,
    anchorProps: props.anchorProps,
    disabled: busy,
    title: "这个会话用哪套提示词组合",
    "aria-label": "选择这个会话的提示词预设",
    items: menuItems,
    selectedId: activeId,
    onSelect: selectOption,
    onClose: onClose,
  });
}
function PromptPicker(props) {
  var sessionId = props && props.sessionId;

  var st = react.useState(null);
  var data = st[0];
  var setData = st[1];
  var busySt = react.useState(false);
  var busy = busySt[0];
  var setBusy = busySt[1];
  var errSt = react.useState(null);
  var err = errSt[0];
  var setErr = errSt[1];
  var pvSt = react.useState(null);
  var preview = pvSt[0];
  var setPreview = pvSt[1];
  var pickSt = react.useState(false);
  var picking = pickSt[0];
  var setPicking = pickSt[1];
  var msgSt = react.useState(null);
  var message = msgSt[0];
  var setMessage = msgSt[1];
  var msgTimerRef = react.useRef(null);
  var mountedRef = react.useRef(true);

  var flash = react.useCallback(function (text) {
    setMessage(text);
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(function () {
      if (mountedRef.current) setMessage(null);
    }, 4000);
  }, []);

  react.useEffect(function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    };
  }, []);

  var load = react.useCallback(
    function () {
      if (!sessionId) return;
      fetch(ROUTE_STATE, { method: "GET" })
        .then(function (res) {
          if (!res.ok) throw new Error("GET HTTP " + res.status);
          return res.json();
        })
        .then(function (d) {
          if (!mountedRef.current) return;
          setData(d);
          if (d.diag && d.diag.routeRegistered === false) {
            setErr("宿主未注册路由：" + (d.diag.routeError || "原因未知"));
          } else {
            setErr(null);
          }
        })
        .catch(function (e) {
          if (mountedRef.current) setErr((e && e.message) || String(e));
        });
    },
    [sessionId],
  );

  react.useEffect(function () {
    load();
  }, [load]);

  var doAssign = react.useCallback(
    function (promptIds, setLocalErr) {
      if (!sessionId) return;
      setBusy(true);
      fetch(ROUTE_ASSIGN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId, promptIds: promptIds }),
      })
        .then(function (res) {
          return res.json().then(function (j) {
            if (!res.ok) throw new Error(j && j.error ? j.error : "POST HTTP " + res.status);
            return j;
          });
        })
        .then(function (d) {
          if (!mountedRef.current) return null;
          setErr(null);
          var n = (d && d.promptIds) || [];
          if (promptIds === null) flash("已改为跟随全局默认");
          else if (n.length === 0) flash("已设为不注入");
          else if (d && d.outcome === "attached") flash("已挂载 " + n.length + " 条，下一步生效");
          else flash("已选择 " + n.length + " 条，但未挂载（" + (d && d.outcome) + "）");
          setPicking(false);
          return null;
        })
        .catch(function (e) {
          var m = (e && e.message) || String(e);
          if (!mountedRef.current) return;
          setErr(m);
          if (typeof setLocalErr === "function") setLocalErr(m);
          else flash("切换失败：" + m);
        })
        .then(function () {
          if (!mountedRef.current) return;
          setBusy(false);
          load();
        });
    },
    [sessionId, load, flash],
  );

  var openPreview = react.useCallback(
    function () {
      if (!sessionId) return;
      setBusy(true);
      setMessage(null);
      fetch(ROUTE_PREVIEW + "?session=" + encodeURIComponent(sessionId), { method: "GET" })
        .then(function (res) {
          if (!res.ok) throw new Error("GET HTTP " + res.status);
          return res.json();
        })
        .then(function (d) {
          if (!mountedRef.current) return;
          setPreview(d);
          setErr(null);
          if (d && d.error) flash("预览失败：" + d.error);
        })
        .catch(function (e) {
          if (!mountedRef.current) return;
          var m = (e && e.message) || String(e);
          setErr(m);
          flash("预览失败：" + m);
        })
        .then(function () {
          if (mountedRef.current) setBusy(false);
        });
    },
    [sessionId, flash],
  );

  var doReload = react.useCallback(
    function () {
      setBusy(true);
      setMessage("重载中…");
      fetch(ROUTE_RELOAD, { method: "POST" })
        .then(function (res) {
          if (!res.ok) throw new Error("POST HTTP " + res.status);
          return res.json();
        })
        .then(function (d) {
          if (!mountedRef.current) return null;
          setErr(null);
          var n = (d && d.count) || 0;
          var errs = (d && d.errors) || [];
          flash(
            errs.length
              ? "已重载 " + n + " 条，但有 " + errs.length + " 个问题：" + errs[0]
              : "已重载 " + n + " 条提示词",
          );
          return null;
        })
        .catch(function (e) {
          if (!mountedRef.current) return;
          var m = (e && e.message) || String(e);
          setErr(m);
          flash("重载失败：" + m);
        })
        .then(function () {
          if (!mountedRef.current) return;
          setBusy(false);
          load();
        });
    },
    [load, flash],
  );

  if (!sessionId) return null;

  var prompts = (data && data.prompts) || [];
  var assigns = (data && data.assignments) || {};
  var hasExplicit = Object.prototype.hasOwnProperty.call(assigns, sessionId);
  var explicitVal = hasExplicit ? assigns[sessionId] : null;
  var currentIds = hasExplicit
    ? Array.isArray(explicitVal)
      ? explicitVal
      : typeof explicitVal === "string" && explicitVal !== "none"
        ? [explicitVal]
        : []
    : []; // ⚠️ 新模型里没有「回落默认」（见上面那段说明）

  var byId = {};
  for (var i = 0; i < prompts.length; i++) byId[prompts[i].id] = prompts[i];

  var hasErr = err !== null;

  // ── 「这个会话的提示词是怎么凑出来的」────────────────────────────
  //
  // ⚠️ 以前这里只有「注入」一个概念：没有自设提示词就显示「未注入」。
  //    但如果你**改了 dsh 原本的段落**，它也显示「未注入」—— 那是在骗人，
  //    你会以为改动没生效。
  //
  // 现在分开算两件事，再合成一个说法：
  //    注入 = 你加了自己的提示词（按会话）
  //    改写 = 你改了 dsh 原本的段落（**目前是全局的**，下一步改成按会话）
  //    两个都算「你动了手」→ 已定制
  var overrides = (data && data.sectionOverrides) || {};
  var overrideNames = [];
  for (var ok in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, ok)) overrideNames.push(ok);
  }
  var overriddenCount = overrideNames.length;
    // ⚠️ 这里原来还有一段按「一堆 prompt id」算标签的旧代码
    //    （`injectedCount` / `customized`，配合 `·改原生 N 段` 那个后缀）。
    //    标签改成按**预设**算之后那两个变量没人读了 —— 删掉，免得以后有人
    //    改标签逻辑时改到这里、以为生效了其实没有。
    //    （`currentIds` 本身还在用，见下面的统计块。）
    // ── 算「这个会话实际用哪条预设」──────────────────────────────
    //
    // ⚠️ 新模型里预设是**唯一载体**，所以标签按**预设**算，不再按
    //    「一堆 prompt id」算。三种状态分清楚：
    //
    //      显式选了某条          → 用那条（`source: session`）
    //      显式选了「什么都不挂」 → 不注入（`presetId === null`）
    //      没记录                → 跟随全局（全局开着）/ 什么都不挂（关掉）
    //
    //    最后一种**不能**并进「不注入」—— 用户要能看出自己没单独设过。
    var presetsTable = (data && data.presets) || {};
    var g = (data && data.global) || {};
    var hasOwn = Object.prototype.hasOwnProperty.call(assigns, sessionId);
    var ownId = hasOwn ? assigns[sessionId] : undefined;
    var ownPreset = typeof ownId === "string" ? presetsTable[ownId] : null;
    var globalPreset =
      g.enabled === true && typeof g.presetId === "string" ? presetsTable[g.presetId] : null;

    var effective = null;
    var source = "none";
    if (ownPreset) {
      effective = ownPreset;
      source = "session";
    } else if (ownId === null) {
      source = "none"; // 显式「什么都不挂」
    } else if (globalPreset) {
      effective = globalPreset;
      source = "global";
    }

    /** 预设的显示名 —— 跟 server 端 presetLabel 同一套规则。 */
    function labelOf(p) {
      if (!p) return null;
      if (typeof p.name === "string" && p.name.trim() && p.name !== "系统提示词（原生）") return p.name.trim();
      if (typeof p.label === "string" && p.label) return p.label;
      var ps = Array.isArray(p.prompts) ? p.prompts : [];
      if (ps.length > 0) return p.name || "（无名预设）";
      var nsec = p.selection && p.selection.sections && typeof p.selection.sections === "object"
        ? Object.keys(p.selection.sections).length : 0;
      return nsec > 0 ? "系统提示词 · 改" : "系统提示词";
    }

    var label;
    if (source === "none") {
      // 显式「什么都不挂」，或者全局关着且没记录
      label = hasOwn ? "不注入" : "系统提示词";
    } else {
      label = labelOf(effective) || "系统提示词";
      // ⚠️ 来源要**看得见** —— 「跟随全局」是常态，标出来才知道这条
      //    不是为本会话专门设的。
      if (source === "global") label += " ·跟随全局";
    }
    var injectedCount = effective && Array.isArray(effective.prompts) ? effective.prompts.length : 0;
    var customized = source === "session";

  // 从诊断里找本会话的挂载结论，决定状态点颜色
  var mine = null;
  var diagSessions = (data && data.diag && data.diag.sessions) || [];
  for (var j = 0; j < diagSessions.length; j++) {
    if (diagSessions[j] && diagSessions[j].sessionId === sessionId) mine = diagSessions[j];
  }
  var dotState = !data
    ? "ongoing"
    : hasErr
      ? "error"
      : customized && mine && !mine.agentLive
        ? "warning"
        : customized
          ? "done"
          : "idle";
  var statusText = "正在读取…";
  if (hasErr) {
    statusText = "通信失败：" + err;
  } else if (!customized) {
    statusText = "全部用 dsh 原样 —— 没加自设提示词，也没改原生段落";
  } else {
    // 把「怎么凑出来的」讲清楚 —— 四个使用场景（纯原生 / 只改原生 /
    // 只加自设 / 两个都有）都用这一句话表达，不为每种单独设计
    var parts = [];
    if (injectedCount > 0) {
      var names = [];
      for (var ni = 0; ni < currentIds.length; ni++) {
        var it = byId[currentIds[ni]];
        names.push((it && it.name) || currentIds[ni]);
      }
      parts.push(
        "自设 " + injectedCount + " 条（" + names.join("、") + "）" +
          (hasExplicit ? "" : "，来自全局默认"),
      );
    }
    if (overriddenCount > 0) {
      // ⚠️ 如实说清作用范围 —— 改写目前是全局的，会影响别的会话
      parts.push(
        "改写原生 " + overriddenCount + " 段（" + overrideNames.slice(0, 3).join("、") +
          (overrideNames.length > 3 ? " 等" : "") +
          // ⚠️ **纯文本 UI，不能写 markdown 星号** —— 会原样显示出来。
          //    这里原来写的是「这是**全局默认层**」，真机上会看到两个星号。
          "）⚠️这是全局默认层，影响所有会话",
      );
    }
    statusText = parts.join("；");
    if (mine && mine.attached) statusText += " · 下一步即生效";
    else if (mine && !mine.agentLive) statusText += " · 该会话 agent 未加载";
  }
  var title = "个人提示词 · " + statusText;

  return react.createElement(
    "span",
    { style: ROW },
    react.createElement("span", { title: statusText }, react.createElement(StateDot, { state: dotState })),
    hasErr
      ? react.createElement("span", { title: err }, react.createElement(Tag, { tone: "danger" }, "✕ " + err))
      : null,
    react.createElement(PresetDropdown, {
      data: data,
      sessionId: sessionId,
      busy: busy,
      open: picking,
      onOpenChange: setPicking,
      label: label,
      anchorProps: {
        variant: hasErr ? "outline" : "ghost",
        "data-prompt-manager": hasErr ? "error" : currentIds.join(",") || "none",
        "data-prompt-source": hasExplicit ? "explicit" : "default",
      },
      // 点选成功后由面板刷新自己的 /presets；菜单保持打开，用户自行关闭。
      onApplied: load,
    }),
    react.createElement(
      ActionButton,
      {
        variant: "ghost",
        size: "sm",
        disabled: true,
        title: "预览功能正在回炉重造，敬请期待",
        "data-prompt-preview": "1",
        "data-prompt-preview-status": "rebuilding",
      },
      "预览（正在回炉重造，敬请期待）",
    ),
    react.createElement(
      ActionButton,
      {
        variant: "ghost",
        size: "sm",
        disabled: busy,
        onClick: doReload,
        title: "重新读取 prompts/catalog.json",
        "data-prompt-reload": "1",
      },
      busy ? "…" : "↻",
    ),
    message
      ? react.createElement(
          "span",
          { title: message, "data-prompt-message": "1" },
          react.createElement(Tag, { tone: hasErr ? "danger" : "success" }, message),
        )
      : null,
    preview
      ? react.createElement(props.PreviewPanel, {
          data: preview,
          onClose: function () {
            setPreview(null);
          },
        })
      : null,
  );
}

      return { PresetDropdown: PresetDropdown, PromptPicker: PromptPicker };
    }
    module.exports.create = create;
    return module.exports;
  },
});
