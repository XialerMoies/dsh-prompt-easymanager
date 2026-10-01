// dsh-prompt-manager · 多选面板与会话头部入口（包内 chunk）
//
// 由 client.js 用 require.async("./client.picker.js") 拉起；必须注册成
// id "dsh-prompt-manager" + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  chunk: "client.picker.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var reactDom = require("react-dom");

    /**
     * 宿主调用入口，把「注册期就存在、chunk 等不到」的东西注入进来。
     *
     * ⚠️ 下面这些名字原先在本文件里是**闭包白拿**的（外层 var 内层直接用），
     *    拆成 chunk 后必须靠 api 显式传，漏传就是渲染期 ReferenceError ——
     *    React 随即卸载整棵子树，表现是「点了之后控件全没了」。
     */
    function create(api) {
      var SELECT_SM = api.style.SELECT_SM;
      var SLOT_HEAD = api.style.SLOT_HEAD;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var SLOT_WHY = api.style.SLOT_WHY;
      var RAW_NAME = api.style.RAW_NAME;
      var DOT = api.style.DOT;
      var DOT_OK = api.style.DOT_OK;
      var DOT_DEFAULT = api.style.DOT_DEFAULT;
      var DOT_WAIT = api.style.DOT_WAIT;
      var DOT_ERR = api.style.DOT_ERR;
      var ERRBOX = api.style.ERRBOX;
      var PICK = api.style.PICK;
      var PICK_ON = api.style.PICK_ON;
      var MONO = api.style.MONO;
      var MONO_TAIL = api.style.MONO_TAIL;
      var WARN = api.style.WARN;
      var ADVISE = api.style.ADVISE;
      var MUTED = api.style.MUTED;
      var HEADING = api.style.HEADING;
      var SUMSUM = api.style.SUMSUM;
      var ROW = api.style.ROW;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_TITLE = api.style.CARD_TITLE;
      var ROW_ACTIVE = api.style.ROW_ACTIVE;
      var ROW_MARK = api.style.ROW_MARK;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var DETAIL_BTN = api.style.DETAIL_BTN;
      var OVERLAY = api.style.OVERLAY;
      var PANEL_SM = api.style.PANEL_SM;
      var PANEL = api.style.PANEL;
      var BTN = api.style.BTN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var BTN_PRIMARY = api.style.BTN_PRIMARY;
      var PANEL_HEAD = api.style.PANEL_HEAD;
      var PANEL_BODY = api.style.PANEL_BODY;
      var PANEL_FOOT = api.style.PANEL_FOOT;
      var BTN_ERR = api.style.BTN_ERR;
      var MSG_ERR = api.style.MSG_ERR;
      var MSG_OK = api.style.MSG_OK;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_SECTIONS = api.route.ROUTE_SECTIONS;
      var ROUTE_STATE = api.route.ROUTE_STATE;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
      var ROUTE_PREVIEW = api.route.ROUTE_PREVIEW;
      var ROUTE_RELOAD = api.route.ROUTE_RELOAD;

      var SELECT_SM = {
        flex: "0 0 auto",
        width: "220px",
        font: "inherit",
        fontSize: "12px",
        padding: "2px 6px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
        background: "var(--dsw-alias-bg-layer-1, Canvas)",
        color: "inherit",
      };

      var ADVISE = {
        border: "1px solid rgba(245,158,11,.7)",
        background: "rgba(245,158,11,.08)",
        borderRadius: "6px",
        padding: "8px 10px",
        marginBottom: "10px",
      };
      var ROW = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "none" };
      var PILL_SWITCH = {
        position: "relative",
        flex: "0 0 auto",
        width: "36px",
        height: "20px",
        borderRadius: "999px",
        padding: "0",
        transition: "background .15s ease, border-color .15s ease",
      };
      /** 组件共用的浮层外壳：portal 到 body，点遮罩关闭。 */
      function Overlay(props) {
        return reactDom.createPortal(
          react.createElement(
            "div",
            {
              style: OVERLAY,
              onClick: function (e) {
                if (e.target === e.currentTarget) props.onClose();
              },
            },
            react.createElement("div", { style: props.narrow ? PANEL_SM : PANEL }, props.children),
          ),
          document.body,
        );
      }

      // ── 多选面板 ──────────────────────────────────────────────────────────
      /**
       * 会话页那个**预设下拉框**。
       *
       * ⚠️ 它**只选预设**，不选提示词 tag —— 用户明确说过：
       *    「会话页的是选预设下拉框不是选提示词 tag 下拉框」。
       *    想改预设内容去设置页，这边不提供微调入口。
       *
       * ⚠️ **点一下就生效**，没有「应用」按钮。
       */
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
        }, [sessionId, msg]);

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
              setMsg("已切换到「" + o.label + "」");
              // ⚠️ 重新拉 /presets —— 勾要跟着挪到新选项上，否则用户看不出生效了
              props.onApplied && props.onApplied();
              return null;
            })
            .catch(function (e) {
              setErr((e && e.message) || String(e));
            });
        }

        var rows = [];

        // ── ────────────────────────────────────────────────────────
        // 「当前实际用哪条」（宿主算好的，面板不自己猜）
        // ──────────────────────────────────────────────────────────
        var head = react.createElement(
          "div",
          { key: "h", style: PANEL_HEAD },
          [
            react.createElement("span", { key: "t", style: CARD_TITLE }, "这个会话用什么"),
            react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
            react.createElement(
              "button",
              { key: "x", type: "button", className: "pm-btn", style: BTN, onClick: onClose },
              "关闭",
            ),
          ],
        );
        rows.push(head);

        if (err) {
          rows.push(react.createElement("div", { key: "e", style: MSG_ERR }, err));
        } else if (msg) {
          rows.push(react.createElement("div", { key: "m", style: MSG_OK }, msg));
        }

        // ── 选项 ────────────────────────────────────────────────────
        for (var i = 0; i < presets.length; i++) {
          rows.push(renderOption(presets[i], props));
        }

        if (presets.length === 0) {
          rows.push(
            react.createElement(
              "div",
              { key: "none", style: MUTED },
              "还没有任何提示词组合。去「设置 → 提示词管理 → 提示词组合」存一条。",
            ),
          );
        }

        // ⚠️ 加载中**不要**渲染成「空列表」—— 那会闪一下「还没有任何提示词组合」，
        //    看着像数据丢了。
        if (!data) {
          return react.createElement(
            Overlay,
            { narrow: true, onClose: onClose },
            react.createElement("div", { style: MUTED }, "读取中…"),
          );
        }

        return react.createElement(Overlay, { narrow: true, onClose: onClose }, [
          react.createElement("div", { key: "b", style: PANEL_BODY }, rows),
        ]);
      }

      /** 「跟随全局」这个选项在内部用一个哨兵值表示（不是字符串 id）。 */
      var FOLLOW = "\u0000follow";

      /**
       * 从 `/presets` 的响应算出一串**选项**。
       *
       * ⚠️ **必须包含「系统提示词」和「跟随全局」两个非预设选项** ——
       *    用户点名要「原生提示词」那个选项（= 系统提示词），
       *    而「跟随全局」是「没单独设过」的唯一表达方式，两个都不能少。
       */
      /**
       * 预设的显示标签 —— **跟宿主 `presetLabel` 同一套规则**。
       *
       * ⚠️ 两边规则要一致：宿主给 /presets 的列表里带 `label`，
       *    而 /state 的预设表没有 —— 这里补算，免得同一个预设
       *    在两处显示成不同的东西。
       */
      function presetLabelOf(p) {
        if (!p) return "系统提示词";
        var ps = Array.isArray(p.prompts) ? p.prompts : [];
        if (ps.length > 0) return p.name || "（无名预设）";
        var n = p.sections && typeof p.sections === "object" ? Object.keys(p.sections).length : 0;
        return n > 0 ? "系统提示词 · 改" : "系统提示词";
      }
      function metaOf(props) {
        var d = props.data;
        var out = [];
        if (!d) return out;

        // ⚠️ **两个形状都要认**：
        //      /state   → presets 是**对象**（id → 预设），global 在里面
        //      /presets → presets 是**数组**（带 label），另有 session / effective
        //    只认一种的话另一半就静默读不到 —— 不报错，只是选项少了。
        var list = [];
        if (Array.isArray(d.presets)) {
          list = d.presets.filter(Boolean);
        } else if (d.presets && typeof d.presets === "object") {
          for (var pid in d.presets) {
            if (!Object.prototype.hasOwnProperty.call(d.presets, pid)) continue;
            var one = d.presets[pid] || {};
            list.push({
              id: pid,
              name: one.name,
              prompts: one.prompts,
              sections: one.sections,
              label: presetLabelOf(one),
              summary: "",
            });
          }
        }
        // extras 也要合进来 —— 它是 /presets?session= 的响应，
        // 带一份**带 label 的预设数组**和 session / effective。
        // props.data（/state）里那份预设表没有 label，只有这边有。
        var ex = props.extras || null;
        if (list.length === 0 && ex && Array.isArray(ex.presets)) {
          list = ex.presets.filter(Boolean);
        }
        var g = (ex && ex.global) || d.global || {};
        // ⚠️ 会话自己选的那条：
        //      /presets → d.session.presetId（undefined = 没记录、null = 什么都不挂）
        //      /state   → d.assignments[sessionId]（同一个语义）
        var sess = (ex && ex.session) || d.session || null;
        var ownId;
        if (sess && "presetId" in sess) {
          ownId = sess.presetId;
        } else if (d.assignments && typeof d.assignments === "object") {
          var sid = props.sessionId;
          ownId = Object.prototype.hasOwnProperty.call(d.assignments, sid)
            ? d.assignments[sid]
            : undefined;
        }

        // ① 跟随全局（只在全局真有一条预设时才有意义）
        var gp = null;
        for (var k = 0; k < list.length; k++) {
          if (list[k] && list[k].id === g.presetId) gp = list[k];
        }
        if (gp) {
          out.push({
            kind: "follow",
            label: "跟随全局（" + gp.label + "）",
            sub: "全局改了就跟着变",
            active: ownId === undefined,
          });
        }

        // ② 系统提示词（= 什么都不挂）
        out.push({
          kind: "system",
          label: "系统提示词",
          sub: "这个会话不挂任何自设提示词",
          active: ownId === null,
        });

        // ③ 具体预设
        for (var m = 0; m < list.length; m++) {
          var p = list[m];
          if (!p) continue;
          out.push({
            kind: "preset",
            id: p.id,
            label: p.label || p.name,
            sub: p.summary || "",
            active: ownId === p.id,
          });
        }
        return out;
      }

      /** 一个选项行。当前生效的带勾 + 高亮。 */
      function renderOption(o, props) {
        return react.createElement(
          "button",
          {
            key: "o-" + o.kind + "-" + (o.id || ""),
            type: "button",
            className: "pm-btn",
            style: Object.assign({}, ROW, o.active ? ROW_ACTIVE : null),
            "aria-current": o.active ? "true" : undefined,
            onClick: function () {
              if (o.active) {
                props.onClose && props.onClose();
                return;
              }
              pickOption(o, props);
            },
          },
          [
            react.createElement("span", { key: "g", style: ROW_MARK }, o.active ? "✓" : ""),
            react.createElement("span", { key: "l", style: CARD_TITLE }, o.label),
            o.sub ? react.createElement("span", { key: "s", style: MUTED }, o.sub) : null,
          ],
        );
      }

      /** 点一个选项 → 写状态 + 让宿主重挂。 */
      function pickOption(o, props) {
        var body = { sessionId: props.sessionId };
        if (o.kind === "follow") body.follow = true;
        else body.presetId = o.kind === "system" ? null : o.id;
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
            props.onApplied && props.onApplied();
            return null;
          })
          .catch(function () {
            /* 失败时不动面板，让用户重试 */
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
        var injectedCount = currentIds.length;
        var customized = overriddenCount > 0 || injectedCount > 0;

        // ⚠️ 标签的主体**仍然是提示词名字** —— 会话头一眼要能看出"这条提示词叫啥"。
        //    改写数量是**追加**在后面的，不能把名字挤掉。
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
            var ps = Array.isArray(p.prompts) ? p.prompts : [];
            if (ps.length > 0) return p.name || "（无名预设）";
            var nsec = p.sections && typeof p.sections === "object" ? Object.keys(p.sections).length : 0;
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
        var dotStyle = DOT;
        var statusText = "正在读取…";
        if (hasErr) {
          dotStyle = DOT_ERR;
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
                "）⚠️这是**全局默认层**，影响所有会话",
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
          react.createElement("span", { style: dotStyle, title: statusText }),
          hasErr ? react.createElement("span", { style: ERRBOX, title: err }, "✕ " + err) : null,
          react.createElement(
            "button",
            {
              type: "button",
              style: hasErr ? BTN_ERR : busy ? BTN_BUSY : BTN,
              disabled: busy,
              onClick: function () {
                setPicking(true);
              },
              title: title + "（点击选择）",
              "data-prompt-manager": hasErr ? "error" : currentIds.join(",") || "none",
              "data-prompt-source": hasExplicit ? "explicit" : "default",
            },
            label + " ▾",
          ),
          react.createElement(
            "button",
            {
              type: "button",
              style: BTN,
              disabled: busy,
              onClick: openPreview,
              title: "预览最终系统提示词",
              "data-prompt-preview": "1",
            },
            "预览",
          ),
          react.createElement(
            "button",
            {
              type: "button",
              style: BTN,
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
                { style: hasErr ? MSG_ERR : MSG_OK, title: message, "data-prompt-message": "1" },
                message,
              )
            : null,
          picking
            ? react.createElement(PresetDropdown, {
                data: data,
                sessionId: sessionId,
                busy: busy,
                onClose: function () {
                  setPicking(false);
                },
                // ⚠️ 新语义：**点一下就生效**，没有「应用」按钮 ——
                  //    所以这里是 onApplied（写完之后刷新），不是 onApply。
                  onApplied: load,
              })
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

      // ── 设置页的提示词编辑器 ──────────────────────────────────────────────
      // 挂在 `settings.plugins.tab`（root 作用域）。注册形态参考一方实现
      // dsh-client-ui-settings-plugin-inventory/lib/client.js：

      return {
        PresetDropdown: PresetDropdown,
        PromptPicker: PromptPicker,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
