// dsh-prompt-manager · 设置页 · 提示词编辑（包内 chunk）
//
// 由 client.js 用 require.async("./client.editor.js") 拉起；必须注册成
// id "dsh-prompt-manager" + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  chunk: "client.editor.js",
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
      var SECTION = api.style.SECTION;
      var CARDS_GRID = api.style.CARDS_GRID;
      var CARD = api.style.CARD;
      var CARD_BAD = api.style.CARD_BAD;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_TITLE = api.style.CARD_TITLE;
      var CARD_ID = api.style.CARD_ID;
      var CARD_DESC = api.style.CARD_DESC;
      var CARD_DESC_ROW = api.style.CARD_DESC_ROW;
      var CHEVRON = api.style.CHEVRON;
      var CHEVRON_OPEN = api.style.CHEVRON_OPEN;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var DETAILS_GRID = api.style.DETAILS_GRID;
      var DT = api.style.DT;
      var DD = api.style.DD;
      var PILL = api.style.PILL;
      var PILL_APPEND = api.style.PILL_APPEND;
      var PILL_WARN = api.style.PILL_WARN;
      var CARD_HEADING = api.style.CARD_HEADING;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var DETAIL_BTN = api.style.DETAIL_BTN;
      var DETAIL_BTN_BUSY = api.style.DETAIL_BTN_BUSY;
      var DETAIL_BTN_DANGER = api.style.DETAIL_BTN_DANGER;
      var CARD_ACTIONS = api.style.CARD_ACTIONS;
      var FORM = api.style.FORM;
      var FORM_LINE = api.style.FORM_LINE;
      var FORM_LABEL = api.style.FORM_LABEL;
      var FORM_INPUT = api.style.FORM_INPUT;
      var FORM_INPUT_NUM = api.style.FORM_INPUT_NUM;
      var FORM_TEXTAREA = api.style.FORM_TEXTAREA;
      var HINT = api.style.HINT;
      var STATUS_LINE = api.style.STATUS_LINE;
      var BADGE_WARN = api.style.BADGE_WARN;
      var BADGE_MUTED = api.style.BADGE_MUTED;
      var BADGE_OFF = api.style.BADGE_OFF;
      var BADGE_OK = api.style.BADGE_OK;
      var RAW_NAME = api.style.RAW_NAME;
      var CARD_NOTICE = api.style.CARD_NOTICE;
      var WARN = api.style.WARN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var BTN = api.style.BTN;
      var TEXTAREA = api.style.TEXTAREA;
      var ACTIONS = api.style.ACTIONS;
      var BTN_PRIMARY = api.style.BTN_PRIMARY;
      var PRE = api.style.PRE;
      var BTN_DANGER = api.style.BTN_DANGER;
      var HINT_TEXT = api.style.HINT_TEXT;
      var SLOT_HEAD = api.style.SLOT_HEAD;
      var SLOT_WHY = api.style.SLOT_WHY;
      var COMBO_ROW = api.style.COMBO_ROW;
      var COMBO_ROW_HL = api.style.COMBO_ROW_HL;
      var COMBO_SIDE = api.style.COMBO_SIDE;
      var COMBO_SIDE_HL = api.style.COMBO_SIDE_HL;
      var COMBO_BOARD = api.style.COMBO_BOARD;
      var COMBO_CHIPS = api.style.COMBO_CHIPS;
      var SELECT_SM = api.style.SELECT_SM;
      var MUTED = api.style.MUTED;
      var MONO = api.style.MONO;
      var MSG_ERR = api.style.MSG_ERR;
      var MSG_OK = api.style.MSG_OK;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;
      var sectionLabel = api.label;
      var ROUTE_EDIT = api.route.ROUTE_EDIT;
      var ROUTE_STATE = api.route.ROUTE_STATE;
      var ROUTE_SECTIONS = api.route.ROUTE_SECTIONS;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
      var ROUTE_DEFAULTS = api.route.ROUTE_DEFAULTS;

      var SECTION = {
        width: "100%",
        maxWidth: "760px",
        color: "var(--dsw-alias-label-primary, inherit)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      };
      var CARDS_GRID = {
        display: "grid",
        // ⚠️ **单列**，一行一张卡片。
        //
        // 原来是 `repeat(2, minmax(0, 1fr))`（一行两张）。系统提示词那块是
        // 单列平铺（`items.push(renderSectionCard(...))`），两块内容上下挨着、
        // 行数却不一样，看着就是两套东西 —— 用户直接问了「为什么不是像系统
        // 提示词一样一行一卡片」。
        //
        // 用 grid 而不是纯块级：`gap` 直接给出行距，不用给每张卡片补 margin-bottom。
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "8px",
        alignItems: "start",
        listStyle: "none",
        margin: "0",
        padding: "0",
      };
      var CARD = {
        border: ".5px solid var(--dsw-alias-settings-card-stroke, rgba(128,128,128,.3))",
        borderRadius: "var(--dsw-radius-xl, 10px)",
        background: "var(--dsw-alias-settings-card-fill, rgba(128,128,128,.06))",
        minWidth: "0",
        overflow: "hidden",
      };
      var CARD_BAD = Object.assign({}, CARD, {
        borderColor: "var(--dsw-alias-state-error-primary, rgba(239,68,68,.7))",
      });
      var CARD_HEAD = {
        width: "100%",
        minHeight: "52px",
        padding: "12px 14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "2px",
        background: "transparent",
        border: "0",
        color: "inherit",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      };
      var CARD_MAIN_ROW = {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        minWidth: "0",
      };
      var CARD_TITLE = {
        flex: "1 1 auto",
        minWidth: "0",
        fontSize: "14px",
        fontWeight: 600,
        lineHeight: "20px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      };
      var CARD_ID = {
        display: "block",
        width: "100%",
        fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        opacity: 0.9,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      };
      var CARD_DESC = {
        fontSize: "12.5px",
        lineHeight: "18px",
        color: "var(--dsw-alias-label-secondary, inherit)",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      };
      var CHEVRON = {
        flex: "none",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        transition: "transform .14s ease-in-out",
        fontSize: "12px",
        lineHeight: "16px",
      };
      var CHEVRON_OPEN = Object.assign({}, CHEVRON, { transform: "rotate(90deg)" });
      var CARD_DETAILS = {
        borderTop: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        background: "var(--dsw-alias-bg-module-platform, rgba(128,128,128,.08))",
        padding: "10px 14px 12px",
      };
      var DETAILS_GRID = {
        display: "grid",
        gridTemplateColumns: "58px minmax(0,1fr)",
        gap: "6px 10px",
        margin: "0 0 10px",
      };
      var DT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "11px",
        lineHeight: "17px",
      };
      var DD = {
        margin: "0",
        minWidth: "0",
        overflowWrap: "anywhere",
        color: "var(--dsw-alias-label-secondary, inherit)",
        fontSize: "12px",
        lineHeight: "17px",
      };
      var PILL = {
        flex: "none",
        fontSize: "11px",
        lineHeight: "16px",
        padding: "1px 7px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4))",
        color: "var(--dsw-alias-label-secondary, inherit)",
        whiteSpace: "nowrap",
      };
      var PILL_APPEND = Object.assign({}, PILL, {
        borderColor: "var(--dsw-alias-state-business-primary, rgba(59,130,246,.7))",
        color: "var(--dsw-alias-state-business-primary, #3b82f6)",
      });
      // 警告色徽章（目前用于「id 非法」这类表单校验提示）
      var PILL_WARN = Object.assign({}, PILL, {
        borderColor: "var(--dsw-alias-state-warn-primary, rgba(245,158,11,.8))",
        color: "var(--dsw-alias-state-warn-label, #f59e0b)",
      });
      var CARD_HEADING = { display: "flex", alignItems: "baseline", gap: "7px", padding: "0 2px" };
      var HEADING_TITLE = { fontSize: "13px", fontWeight: 600, lineHeight: "20px" };
      var HEADING_COUNT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontVariantNumeric: "tabular-nums",
        fontSize: "12px",
        lineHeight: "18px",
      };
      var DETAIL_BTN = {
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        padding: "3px 10px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.45))",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      };
      var DETAIL_BTN_BUSY = Object.assign({}, DETAIL_BTN, { opacity: 0.5, cursor: "default" });
      var DETAIL_BTN_DANGER = Object.assign({}, DETAIL_BTN, {
        color: "var(--dsw-alias-state-error-primary, #ef4444)",
        borderColor: "var(--dsw-alias-state-error-primary, rgba(239,68,68,.6))",
      });
      var CARD_ACTIONS = {
        display: "flex",
        gap: "6px",
        alignItems: "center",
        flexShrink: 0,
        marginTop: "10px",
        flexWrap: "wrap",
      };
      var FORM = { display: "flex", flexDirection: "column", gap: "8px" };
      var FORM = { display: "flex", flexDirection: "column", gap: "8px" };
      var FORM_LINE = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
      var FORM_LABEL = {
        fontSize: "11px",
        lineHeight: "17px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        minWidth: "38px",
        flex: "none",
      };
      var FORM_INPUT = {
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        padding: "4px 8px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.45))",
        background: "var(--dsw-alias-bg-layer-1, transparent)",
        color: "var(--dsw-alias-label-primary, inherit)",
        flex: "1 1 150px",
        minWidth: "0",
        outline: "none",
      };
      var FORM_INPUT_NUM = Object.assign({}, FORM_INPUT, { flex: "0 0 84px", minWidth: "84px" });
      var FORM_TEXTAREA = {
        fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
        fontSize: "12px",
        lineHeight: "1.6",
        padding: "8px 10px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.45))",
        background: "var(--dsw-alias-bg-layer-1, transparent)",
        color: "var(--dsw-alias-label-primary, inherit)",
        width: "100%",
        boxSizing: "border-box",
        minHeight: "220px",
        resize: "vertical",
        outline: "none",
      };
      var HINT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "12.5px",
        lineHeight: "18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "4px 8px",
        margin: "0",
      };
      var STATUS_LINE = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "13px",
        lineHeight: "20px",
      };

      function PromptEditor() {
        var listSt = react.useState(null);
        var list = listSt[0];
        var setList = listSt[1];
        var busySt = react.useState(false);
        var busy = busySt[0];
        var setBusy = busySt[1];
        var errSt = react.useState(null);
        var err = errSt[0];
        var setErr = errSt[1];
        var editSt = react.useState(null);
        var edit = editSt[0];
        var setEdit = editSt[1];
        var msgSt = react.useState(null);
        var message = msgSt[0];
        var setMessage = msgSt[1];
        // 展开的卡片 id（同一时刻只展开一张，跟原生插件列表一致）。
        // ⚠️ 放在最后：测试是按索引塞状态的，加在中间会打乱已有断言。
        var openSt = react.useState(null);
        var openId = openSt[0];
        var setOpenId = openSt[1];
        // 全局默认的编辑草稿（勾选状态）。同样是"改了还没保存"的临时态。
        var defSt = react.useState(null);
        var defaultsDraft = defSt[0];
        var setDefaultsDraft = defSt[1];
        var defBusySt = react.useState(false);
        var defaultsBusy = defBusySt[0];
        var setDefaultsBusy = defBusySt[1];
        // ── 「系统提示词」区块的状态 ────────────────────────────────────────
        // ⚠️ 一律加在**最后**：测试是按索引塞状态的，插在中间会打乱已有断言。
        /** GET /sections 的结果（原生段落 + 覆盖判定） */
        var secSt = react.useState(null);
        var sections = secSt[0];
        var setSections = secSt[1];
        var secBusySt = react.useState(false);
        var sectionsBusy = secBusySt[0];
        var setSectionsBusy = secBusySt[1];
        /** 展开的段落名（同一时刻只展开一张卡片） */
        var secOpenSt = react.useState(null);
        var openSection = secOpenSt[0];
        var setOpenSection = secOpenSt[1];
        /** 正在编辑的正文草稿：{ [name]: string } */
        var secDraftSt = react.useState({});
        var sectionDrafts = secDraftSt[0];
        var setSectionDrafts = secDraftSt[1];
        // ── 改写写到哪一层 ─────────────────────────────────────────────────
        //
        // "global"  = 全局默认，所有会话都用
        // "session" = 只影响选中的那个会话，**盖住**全局那条
        //
        // ⚠️ 仍然加在**最后**：测试按索引塞状态，插在中间会打乱已有断言。
        var secScopeSt = react.useState("global");
        var sectionScope = secScopeSt[0];
        var setSectionScope = secScopeSt[1];
        /** scope = session 时用哪个会话 */
        var secSidSt = react.useState("");
        var sectionSessionId = secSidSt[0];
        var setSectionSessionId = secSidSt[1];
        // ── 提示词组合 / 快速预设 ────────────────────────────────────────
        // 同样加在最后。
        // ⚠️ **作用范围复用 sectionScope / sectionSessionId** —— 「生效列表改哪个
        //    会话的注入」和「段落改写写到哪个会话」本来就是同一层的意思。
        //    两处各渲染一个开关，改的是同一份状态。
        var preSt = react.useState(null);
        var presetsData = preSt[0];
        var setPresetsData = preSt[1];
        var preBusySt = react.useState(false);
        var presetsBusy = preBusySt[0];
        var setPresetsBusy = preBusySt[1];
        var preNameSt = react.useState("");
        var presetName = preNameSt[0];
        var setPresetName = preNameSt[1];
        /** 总开关的本地态（带乐观更新 —— 拨一下立刻变色，失败再回滚） */
        var enSt = react.useState(null);
        var enabledDraft = enSt[0];
        var setEnabledDraft = enSt[1];
        // 被**手动折起来**的类别卡片（存 `"cat:<分类id>"`，空 = 全都展开）。
        // 见 renderGroupCard 里那段说明：默认开，折叠是显式动作。
        // ⚠️ 新钩子加在末尾 —— 测试按索引塞状态，插在中间会打乱既有断言。
        var catSt = react.useState([]);
        var closedCats = catSt[0];
        var setClosedCats = catSt[1];
        var timerRef = react.useRef(null);
        var mountedRef = react.useRef(true);

        var flash = react.useCallback(function (t) {
          setMessage(t);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(function () {
            if (mountedRef.current) setMessage(null);
          }, 4000);
        }, []);

        react.useEffect(function () {
          mountedRef.current = true;
          return function () {
            mountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
          };
        }, []);

        var load = react.useCallback(function () {
          fetch(ROUTE_EDIT, { method: "GET" })
            .then(function (res) {
              if (!res.ok) throw new Error("GET HTTP " + res.status);
              return res.json();
            })
            .then(function (d) {
              if (!mountedRef.current) return;
              setList(d);
              // 总开关的本地态跟服务端对齐（第一次读、以及每次 refresh 之后）
              setEnabledDraft(d.enabled !== false);
              // 刷新时把默认的草稿重置成服务端的值（丢弃未保存的勾选）
              setDefaultsDraft(Array.isArray(d.defaults) ? d.defaults.slice() : []);
              setErr(null);
            })
            .catch(function (e) {
              if (mountedRef.current) setErr((e && e.message) || String(e));
            });
        }, []);

        react.useEffect(function () {
          load();
        }, [load]);

        /**
         * 拨总开关。
         *
         * ⚠️ **乐观更新** —— 拨一下立刻变色（不然点了没反应会让人以为卡住），
         *    失败再回滚并把错误说出来。
         *
         * 关掉的效果：本插件对提示词的一切干预全部停用（不注入、不改写），
         * 等价于原生 dsh。**不用去清空各项配置** —— 配置都留着，开回来就恢复。
         */
        var toggleEnabled = react.useCallback(
          function (next) {
            var prev = enabledDraft;
            setEnabledDraft(next);
            return fetch(ROUTE_STATE, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled: next }),
            })
              .then(function (res) {
                return res.json().then(function (j) {
                  if (!res.ok) throw new Error((j && j.error) || "HTTP " + res.status);
                  return j;
                });
              })
              .then(function (d) {
                if (!mountedRef.current) return null;
                flash(d && d.note ? d.note : "已更新");
                load();
                return null;
              })
              .catch(function (e) {
                if (!mountedRef.current) return null;
                setEnabledDraft(prev); // 回滚
                flash("失败：" + ((e && e.message) || String(e)));
                return null;
              });
          },
          [enabledDraft, flash, load],
        );

        // ── 系统提示词段落：读取 / 改写 / 关掉 / 还原 ────────────────────────
        var loadSections = react.useCallback(function (scope, sid) {
          var useScope = scope || "global";
          var url = ROUTE_SECTIONS;
          if (useScope === "session" && sid) url += "?session=" + encodeURIComponent(sid);
          return fetch(url, { method: "GET" })
            .then(function (res) {
              if (!res.ok) throw new Error("GET HTTP " + res.status);
              return res.json();
            })
            .then(function (d) {
              if (!mountedRef.current) return null;
              setSections(d);
              return null;
            })
            .catch(function (e) {
              if (mountedRef.current) setErr((e && e.message) || String(e));
            });
        }, []);

        // 换会话/换层时重新读 —— 两层看到的内容不一样
        react.useEffect(function () {
          loadSections(sectionScope, sectionSessionId);
        }, [loadSections, sectionScope, sectionSessionId]);

        // ── 提示词组合 / 快速预设：读取 ────────────────────────────────────
        var loadPresets = react.useCallback(function (scope, sid) {
          var url = ROUTE_PRESETS;
          var useScope = scope || "global";
          if (useScope === "session" && sid) url += "?session=" + encodeURIComponent(sid);
          return fetch(url, { method: "GET" })
            .then(function (res) {
              if (!res.ok) throw new Error("GET HTTP " + res.status);
              return res.json();
            })
            .then(function (d) {
              if (!mountedRef.current) return null;
              setPresetsData(d);
              return null;
            })
            .catch(function (e) {
              if (mountedRef.current) setErr((e && e.message) || String(e));
            });
        }, []);

        react.useEffect(function () {
          loadPresets(sectionScope, sectionSessionId);
        }, [loadPresets, sectionScope, sectionSessionId]);

        /** 预设类操作：save / apply / delete。完事两边都重读。 */
        var doPreset = react.useCallback(
          function (payload, scope, sid) {
            setPresetsBusy(true);
            var url = ROUTE_PRESETS;
            var useScope = scope || "global";
            if (useScope === "session" && sid) url += "?session=" + encodeURIComponent(sid);
            return fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            })
              .then(function (res) {
                return res.json().then(function (j) {
                  if (!res.ok) throw new Error((j && j.error) || "HTTP " + res.status);
                  return j;
                });
              })
              .then(function (d) {
                if (!mountedRef.current) return null;
                flash(
                  payload.action === "save"
                    ? "已存为「" + payload.name + "」"
                    : payload.action === "apply"
                      ? "已切换到「" + (d && d.name) + "」"
                      : "已删除",
                );
                // 应用预设会动 defaults / assignments，注入那边也要重读
                loadPresets(scope, sid);
                loadSections(scope, sid);
                setErr(null);
                return null;
              })
              .catch(function (e) {
                if (mountedRef.current) flash("失败：" + ((e && e.message) || String(e)));
              })
              .then(function () {
                if (mountedRef.current) setPresetsBusy(false);
              });
          },
          [flash, loadPresets, loadSections],
        );

        /**
         * 把一条提示词移进/移出生效列表。
         *
         * 走的是既有的 DEFAULTS_PATH（全局）和 ASSIGN_PATH（按会话）——
         * **没有另造一套接口**，所以这里改完，会话头那个徽章看到的东西是一致的。
         */
        var setActivePrompts = react.useCallback(
          function (nextIds, scope, sid) {
            setPresetsBusy(true);
            var useScope = scope || "global";
            if (useScope === "session" && !sid) {
              setPresetsBusy(false);
              flash("先选一个会话");
              return Promise.resolve();
            }
            var url = useScope === "session" ? ROUTE_ASSIGN : ROUTE_DEFAULTS;
            var body =
              useScope === "session"
                ? { sessionId: sid, promptIds: nextIds }
                : { promptIds: nextIds };
            return fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
              .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return null;
              })
              .then(function () {
                if (!mountedRef.current) return null;
                loadPresets(scope, sid);
                return null;
              })
              .catch(function (e) {
                if (mountedRef.current) flash("失败：" + ((e && e.message) || String(e)));
              })
              .then(function () {
                if (mountedRef.current) setPresetsBusy(false);
              });
          },
          [flash, loadPresets],
        );

        /** 改一段：action = replace | disable | restore | acknowledge */
        var applySection = react.useCallback(
          function (name, action, text, scope, sid) {
            setSectionsBusy(true);
            var useScope = scope || "global";
            var body = { name: name, action: action, scope: useScope };
            if (action === "replace") body.text = text;
            var url = ROUTE_SECTIONS;
            if (useScope === "session") {
              if (!sid) { setSectionsBusy(false); flash("先选一个会话"); return Promise.resolve(); }
              url += "?session=" + encodeURIComponent(sid);
            }
            return fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
              .then(function (res) {
                return res.json().then(function (j) {
                  if (!res.ok) throw new Error((j && j.error) || "HTTP " + res.status);
                  return j;
                });
              })
              .then(function (d) {
                if (!mountedRef.current) return null;
                // 服务端已经把新的判定算好了，直接整份替换，
                // 不在前端自己推算状态（免得两边逻辑漂移）
                setSections(function (prev) {
                  return Object.assign({}, prev || {}, {
                    applied: d.applied,
                    drifted: d.drifted,
                    stale: d.stale,
                    untouched: d.untouched,
                    counts: d.counts,
                    summary: d.summary,
                  });
                });
                setErr(null);
                flash(
                  (action === "replace"
                    ? "已改写"
                    : action === "disable"
                      ? "已关掉"
                      : action === "restore"
                        ? "已还原成官方原文"
                        : "知道了") + "：" + name + (useScope === "session" ? "（仅本会话）" : "（全局）"),
                );
                return null;
              })
              .catch(function (e) {
                if (mountedRef.current) flash("失败：" + ((e && e.message) || String(e)));
              })
              .then(function () {
                if (mountedRef.current) setSectionsBusy(false);
              });
          },
          [flash],
        );

        /** 段落的状态徽章。 */
        function sectionBadge(row) {
          if (row.status === "stale") return { text: "已失效", style: BADGE_WARN };
          if (row.status === "untouched") return { text: "官方原文", style: BADGE_MUTED };
          if (row.action === "disable") return { text: "已关掉", style: BADGE_OFF };
          if (row.drifted && !row.driftAcknowledged) return { text: "官方已更新", style: BADGE_WARN };
          return { text: "已改写", style: BADGE_OK };
        }

        /** 一张段落卡片。 */
        function renderSectionCard(row) {
          var badge = sectionBadge(row);
          var isOpen = openSection === row.name;
          // 显示什么：改写过的显示用户的，否则显示官方原文
          var shown = row.status === "apply" && row.action === "replace" ? row.text : row.original;
          var draft = sectionDrafts[row.name];
          var editing = typeof draft === "string";
          var changed = row.status === "apply";

          var cardChildren = [
            react.createElement(
              "div",
              {
                key: "head",
                className: "pm-head",
                // ⚠️ 两个坑叠在一起，改之前先看这段：
                //
                //   1. **内边距**要用 `CARD_HEAD`（12px 14px）。`CARD_MAIN_ROW` 只是
                //      个布局行、没有 padding —— 只用它会让内容贴着卡片边框。
                //
                //   2. **`CARD_HEAD` 是 `flexDirection: "column"`**（原生卡片头是竖排：
                //      标题 + 副标题），而 `CARD_MAIN_ROW` **没有设 flexDirection**，
                //      所以 Object.assign 之后 column 会赢 —— 名字、徽章、字数
                //      变成竖着三行居中。这里要的是**一行**，必须显式改回 row。
                //      （真机上就是这么错的：卡片又粗又居中。）
                style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
                  flexDirection: "row",
                  minHeight: "0",
                  padding: "10px 14px",
                  cursor: "pointer",
                }),
                onClick: function () {
                  setOpenSection(isOpen ? null : row.name);
                },
              },
              [
                react.createElement(
                  "span",
                  { key: "n", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) },
                  sectionLabel(row.name) || row.name,
                ),
                // 原始 name 小字跟在后面 —— 中文名给人看，这个给排查用。
                // 同一行，不额外占高度。
                react.createElement(
                  "span",
                  { key: "raw", style: RAW_NAME, title: row.name },
                  row.name,
                ),
                react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                react.createElement("span", { key: "b", style: badge.style }, badge.text),
                react.createElement(
                  "span",
                  { key: "c", style: HEADING_COUNT },
                  (shown || "").length + " 字",
                ),
              ],
            ),
          ];

          // 漂移提醒：只对「官方改过、用户还没点掉」的显示。
          // 注意措辞 —— 用户的口径是**照旧用他写的**，不是"已停用"。
          if (row.status === "apply" && row.drifted && !row.driftAcknowledged) {
            cardChildren.push(
              react.createElement("div", { key: "drift", style: CARD_NOTICE }, [
                react.createElement("div", { style: WARN }, [
                  react.createElement("strong", { key: "t" }, "官方更新过这一段。"),
                  "你改的版本照旧生效。点「知道了」消掉这条提醒，或点「还原默认」改用官方新版。",
                  react.createElement(
                    "button",
                    {
                      key: "a",
                      type: "button",
                      className: "pm-btn",
                      style: sectionsBusy ? BTN_BUSY : BTN,
                      disabled: sectionsBusy,
                      onClick: function (e) {
                        e.stopPropagation();
                        applySection(row.name, "acknowledge", sectionScope, sectionSessionId);
                      },
                    },
                    "知道了",
                  ),
                ]),
              ]),
            );
          }

          if (row.status === "stale") {
            cardChildren.push(
              react.createElement("div", { key: "stale", style: CARD_NOTICE }, [
                react.createElement(
                  "div",
                  { style: WARN },
                  "官方已经没有这一段了（删掉或改名了）。你的改写不会再生效，数据还留着；要清理就点「还原默认」。",
                ),
              ]),
            );
          }

          if (isOpen) {
            var bodyChildren;
            if (editing) {
              bodyChildren = [
                react.createElement("textarea", {
                  key: "ta",
                  className: "pm-input",
                  style: TEXTAREA,
                  value: draft,
                  disabled: sectionsBusy,
                  spellCheck: false,
                  onChange: function (e) {
                    var v = e.target.value;
                    setSectionDrafts(function (prev) {
                      return Object.assign({}, prev, { [row.name]: v });
                    });
                  },
                }),
                react.createElement("div", { key: "act", style: ACTIONS }, [
                  react.createElement(
                    "button",
                    {
                      key: "s",
                      type: "button",
                      className: "pm-btn",
                      style: sectionsBusy ? BTN_BUSY : BTN_PRIMARY,
                      disabled: sectionsBusy,
                      onClick: function () {
                        applySection(row.name, "replace", draft, sectionScope, sectionSessionId).then(function () {
                          setSectionDrafts(function (prev) {
                            var next = Object.assign({}, prev);
                            delete next[row.name];
                            return next;
                          });
                        });
                      },
                    },
                    "保存改写",
                  ),
                  react.createElement(
                    "button",
                    {
                      key: "c",
                      type: "button",
                      className: "pm-btn",
                      style: BTN,
                      disabled: sectionsBusy,
                      onClick: function () {
                        setSectionDrafts(function (prev) {
                          var next = Object.assign({}, prev);
                          delete next[row.name];
                          return next;
                        });
                      },
                    },
                    "取消",
                  ),
                ]),
              ];
            } else {
              bodyChildren = [
                react.createElement("pre", { key: "pre", style: PRE }, shown || "（空）"),
                react.createElement("div", { key: "act", style: ACTIONS }, [
                  react.createElement(
                    "button",
                    {
                      key: "e",
                      type: "button",
                      className: "pm-btn",
                      style: sectionsBusy ? BTN_BUSY : BTN,
                      disabled: sectionsBusy,
                      onClick: function () {
                        setSectionDrafts(function (prev) {
                          return Object.assign({}, prev, {
                            [row.name]:
                              changed && row.action === "replace" ? row.text : row.original,
                          });
                        });
                      },
                    },
                    changed && row.action === "replace" ? "继续编辑" : "改写",
                  ),
                  react.createElement(
                    "button",
                    {
                      key: "d",
                      type: "button",
                      className: "pm-btn",
                      style: sectionsBusy || (changed && row.action === "disable") ? BTN_BUSY : BTN_DANGER,
                      disabled: sectionsBusy || (changed && row.action === "disable"),
                      title: "让这一段完全不出现（注册为空正文，dsh 会丢弃空段落）",
                      onClick: function (e) {
                        e.stopPropagation();
                        applySection(row.name, "disable", sectionScope, sectionSessionId);
                      },
                    },
                    "关掉",
                  ),
                  changed
                    ? react.createElement(
                        "button",
                        {
                          key: "r",
                          type: "button",
                          className: "pm-btn",
                          style: sectionsBusy ? BTN_BUSY : BTN,
                          disabled: sectionsBusy,
                          title: "删掉你的改动，回到官方当前的文本（官方更新过的话就是新版）",
                          onClick: function (e) {
                            e.stopPropagation();
                            applySection(row.name, "restore", sectionScope, sectionSessionId);
                          },
                        },
                        "还原默认",
                      )
                    : null,
                ]),
                row.status === "apply" && row.drifted && row.basedOn
                  ? react.createElement("details", { key: "cmp", style: { marginTop: "6px" } }, [
                      react.createElement("summary", { key: "s", style: HINT_TEXT }, "对照：你当初依据的官方版本"),
                      react.createElement("pre", { key: "p", style: PRE }, row.basedOn),
                    ])
                  : null,
              ];
            }
            cardChildren.push(
              react.createElement("div", { key: "body", style: CARD_DETAILS }, bodyChildren),
            );
          }

          return react.createElement(
            "div",
            { key: row.name, style: Object.assign({}, CARD, { marginBottom: "8px" }) },
            cardChildren,
          );
        }

        /** 一张「没被注册的槽位」灰卡片 —— 不可操作，只说明为什么这里没有内容。 */
        function renderEmptySlot(slot) {
          // 有确定段名的显示中文名 + 段名；没有名字的只能显示 order 键
          var title = slot.name ? sectionLabel(slot.name) : "";
          var raw = slot.name || slot.key;
          return react.createElement(
            "div",
            { key: "slot-" + slot.key, style: Object.assign({}, CARD, { marginBottom: "8px", opacity: 0.5 }) },
            [
              react.createElement(
                "div",
                { key: "head", style: SLOT_HEAD },
                [
                  title
                    ? react.createElement("span", { key: "n", style: CARD_TITLE }, title)
                    : null,
                  react.createElement("span", { key: "raw", style: RAW_NAME, title: raw }, raw),
                  react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                  // 没名字的跟「功能没加载」是两回事，徽章要分开
                  react.createElement(
                    "span",
                    { key: "b", style: BADGE_MUTED },
                    slot.name ? "未加载" : "无对应包",
                  ),
                  react.createElement("span", { key: "o", style: HEADING_COUNT }, "order " + slot.order),
                ],
              ),
              react.createElement("div", { key: "why", style: SLOT_WHY }, slot.reason),
            ],
          );
        }


        /**
         * 选哪些提示词生效（当前层）。
         *
         * 为什么只留一份清单、不做「生效 / 可用」两栏：
         *   两栏是**同一批条目**的两个视图 —— 一条提示词要么在这边要么在那边，
         *   占两倍宽度却不增加信息。一列勾选就够了。
         *
         * 为什么不做拖动排序：
         *   顺序根本不是这里定的 —— 每条提示词有自己的 `order`，dsh 按它排。
         *   这里能拖出「顺序」，纯粹是两栏板给人的错觉。勾选就够了。
         *
         * 这一段管的是「选哪些」，上面那堆卡片管的是「每条长什么样」——
         * 两件事，所以两块都留，但这一块不该铺得比卡片还大。
         */
        function renderPicker() {
          // 当前层的生效 id 列表（组合区自己算，不从 renderCombo 里借变量）
          var layer =
            sectionScope === "session"
              ? presetsData.layers && presetsData.layers.session
              : presetsData.layers && presetsData.layers.global;
          var activeIds = (layer && Array.isArray(layer.prompts) ? layer.prompts : []).slice();

          var usable = [];
          for (var pi = 0; pi < prompts.length; pi++) {
            if (prompts[pi] && prompts[pi].mode !== "none") usable.push(prompts[pi]);
          }
          var byId = {};
          for (var bi = 0; bi < usable.length; bi++) byId[usable[bi].id] = usable[bi];

          // 生效的排前面（按真实注入顺序），其余在后
          var ordered = [];
          var picked = {};
          for (var ai = 0; ai < activeIds.length; ai++) {
            var hit = byId[activeIds[ai]];
            if (hit) {
              ordered.push(hit);
              picked[hit.id] = true;
            }
          }
          for (var ri = 0; ri < usable.length; ri++) {
            if (!picked[usable[ri].id]) ordered.push(usable[ri]);
          }

          if (usable.length === 0) {
            return react.createElement(
              "div",
              { style: HINT_TEXT },
              "库里还没有可选的提示词。上面「新建」加一条。",
            );
          }

          var totalTokens = 0;
          for (var ki = 0; ki < activeIds.length; ki++) {
            if (byId[activeIds[ki]]) totalTokens += byId[activeIds[ki]].tokens || 0;
          }

          var rows = [];
          for (var oi = 0; oi < ordered.length; oi++) {
            (function (p) {
              var on = !!picked[p.id];
              rows.push(
                react.createElement(
                  "label",
                  { key: p.id, style: Object.assign({}, COMBO_ROW, { cursor: presetsBusy ? "default" : "pointer" }) },
                  [
                    react.createElement("input", {
                      key: "cb",
                      type: "checkbox",
                      checked: on,
                      disabled: presetsBusy,
                      onChange: function () {
                        var next = on
                          ? activeIds.filter(function (x) { return x !== p.id; })
                          : activeIds.concat([p.id]);
                        setActivePrompts(next, sectionScope, sectionSessionId);
                      },
                    }),
                    react.createElement("span", { key: "n", style: { flex: "1 1 auto" } }, p.name || p.id),
                    react.createElement(
                      "span",
                      { key: "o", style: HEADING_COUNT },
                      "order " + (p.order == null ? "?" : p.order),
                    ),
                    react.createElement("span", { key: "t", style: HEADING_COUNT }, fmtTokens(p.tokens)),
                  ],
                ),
              );
            })(ordered[oi]);
          }

          return react.createElement("div", null, [
            react.createElement(
              "div",
              { key: "sum", style: HINT_TEXT },
              activeIds.length === 0
                ? "一条都没选 —— 这个" + (sectionScope === "global" ? "默认" : "会话") + "不会注入任何提示词"
                : "已选 " + activeIds.length + " 条 · 共 " + fmtTokens(totalTokens) +
                  "（插入位置由各自的 order 决定）",
            ),
            react.createElement("div", { key: "rows", style: COMBO_CHIPS }, rows),
          ]);
        }

        /**
         * 总开关（胶囊）—— **用 dsh 自己的开关**。
         *
         * ⚠️ 这是「一键回到原生」的出口：关掉 = 不注入自设提示词、不改写原生段落，
         *    等价于原生 dsh。但**配置全留着** —— 拨回来就原样恢复，所以装配时清空的
         *    是自己注入的段落，不是配置。
         *
         * ── 为什么用原生类名，而不是自己写内联样式 ──────────────────────────
         *
         * dsh 的开关是一段编译过的 CSS module（`_switch_15ung_5` / `_thumb_15ung_33`），
         * 它在**全局样式表**里（web-frontend/dist/assets/index-*.css，由 index.html
         * 直接引入），不是某个包的私有注入 —— 所以插件能直接借。
         *
         * 借它的好处是自动跟着主题走：
         *     background:var(--dsw-alias-border-l3) / [aria-checked=true]→var(--dsw-alias-brand-primary)
         *     thumb 用 transform:translate(16px)，transition .12s
         *     自带 :disabled（opacity .5）和 :focus-visible 焦点环
         *
         * ⚠️⚠️ **凡是原生 css 已经管了的属性，内联里一个都不能写。**
         *    踩过两次：
         *      1) 内联 `background:"#fff"` 把 thumb 的主题令牌顶掉了 ——
         *         深色模式下滑块本该是**深色**（开启态的 brand-primary 在深色下偏亮，
         *         滑块要反过来才看得清），结果一直是白的。
         *      2) 内联 `transform` 覆盖了 `[aria-checked=true] .thumb{translate(16px)}`
         *         —— 值恰好一样所以没露馅，但原生那条规则已经失效了。
         *    内联样式**永远赢** class，所以只留「原生不管」的兜底几何。
         *
         * 那个哈希是**内容派生**的，dsh 升级改了开关的 css 就会变。所以兜底留下的
         * 是「形状」而不是「配色」：类名一旦失效，至少还是个圆角胶囊、不会退回方按钮；
         * 颜色交给原生 —— 宁可失效时朴素，也不要**在好的时候是错的**。
         */
        var NATIVE_SWITCH = "_switch_15ung_5";
        var NATIVE_THUMB = "_thumb_15ung_33";
        // 只兜形状和布局：原生 css 失效时才起作用，生效时被 class 覆盖（值相同）
        var SWITCH_FALLBACK = {
          position: "relative",
          display: "inline-block",
          flex: "0 0 auto",
          boxSizing: "border-box",
          width: "36px",
          height: "20px",
          padding: "2px",
          border: "0",
          borderRadius: "999px",
          cursor: "pointer",
        };
        // ⚠️ 这里**没有** background、**没有** transform —— 见上面那段。
        var THUMB_FALLBACK = {
          display: "block",
          width: "16px",
          height: "16px",
          borderRadius: "50%",
        };
        /**
         * 开关本体：形状兜底 + 仅当原生类名失效时才需要的一点颜色。
         *
         * background 用**原生同一套令牌**，这样即使写到内联也还是跟着主题走；
         * 原生类名生效时它和 class 里的值一致，不会打架。
         */
        function switchStyle(on) {
          return Object.assign({}, SWITCH_FALLBACK, {
            background: on
              ? "var(--dsw-alias-brand-primary)"
              : "var(--dsw-alias-border-l3)",
          });
        }
        /**
         * 滑块：**只有形状兜底，没有颜色、没有 transform**。
         *
         * 背景交给原生的 `var(--dsw-alias-label-primary-foreground)` ——
         * 那个令牌在浅色下是白、深色下是**深色**（开启态的 brand-primary 在深色下
         * 偏亮，滑块得反过来）。写死白色就是深色模式下看起来不对的原因。
         * 位移交给原生的 `[aria-checked=true] .thumb{transform:translate(16px)}`。
         */
        function thumbStyle() {
          return THUMB_FALLBACK;
        }

        /**
         * 提示词全局注入开关。
         *
         * ⚠️ 语义（用户定的）：**它管的是「默认」那一层。**
         *    开启 → 每个新会话都自动挂「新会话默认」里那几条。
         *    关闭 → 不再往每个会话都塞默认；但**会话页自己选的照旧注入**，
         *          段落改写也照旧生效（改原生段落跟注不注入是两件事）。
         *
         *    名字和说明都得照这个说 —— 写成「全部停用」就过头了，
         *    写「使用我的提示词配置」又太含糊（听起来像另有个配置开关）。
         *
         * 说明收进 title（不占常驻行）：这段是「怎么回事」，不是「现在什么状态」。
         */
        function renderMasterSwitch() {
          var on = enabledDraft !== false;
          var busy = enabledDraft === null;
          var help =
            "提示词注入的总开关，管的是「默认」那一层。\n\n" +
            "开启：每个新会话都自动挂「新会话默认」里那几条。\n" +
            "关闭：不再往每个会话都塞默认 —— 但你在会话页自己选过的提示词照旧注入，" +
            "段落改写也照旧生效。\n\n" +
            "你的配置都留着，开回来就恢复。";
          return react.createElement(
            "div",
            { style: Object.assign({}, CARD, { padding: "12px 14px", marginBottom: "12px" }) },
            [
              react.createElement("div", { key: "row", style: { display: "flex", alignItems: "center", gap: "10px" } }, [
                // 结构照抄原生：button[role=switch][aria-checked] + span(thumb)。
                // 视觉状态由 aria-checked 驱动，所以别再往里塞自己的 display 样式。
                react.createElement(
                  "button",
                  {
                    key: "sw",
                    type: "button",
                    role: "switch",
                    "aria-checked": on,
                    "aria-label": "提示词全局注入",
                    className: NATIVE_SWITCH,
                    title: help,
                    disabled: busy,
                    onClick: function () {
                      toggleEnabled(!on);
                    },
                    style: switchStyle(on),
                  },
                  react.createElement("span", { className: NATIVE_THUMB, style: thumbStyle() }),
                ),
                react.createElement(
                  "span",
                  { key: "t", style: { fontSize: "13px", fontWeight: 600 } },
                  "提示词全局注入",
                ),
                renderHelpIcon(help),
                react.createElement(
                  "span",
                  { key: "st", style: HEADING_COUNT },
                  // 「开 · 所有会话都注入」—— 说的是**默认这一层的作用范围**，
                  // 不是「禁止/允许注入」。措辞别写成全停。
                  on ? "开 · 新会话自动挂默认" : "关 · 只在会话页自己选的还注入",
                ),
              ]),
            ],
          );
        }

        /**
         * 提示词配置：**选哪些提示词生效 + 快速预设**，合成一块。
         *
         * ⚠️ 原来这是**两段独立内容**（「提示词组合」和「快速预设」各一个标题行），
         *    但它们本来就是一件事：
         *      · 前者是「当前这套配置选了什么」；
         *      · 后者是「把这套配置整体存下来 / 换一套」。
         *    分开摆的后果是同一层意思被切成两段，中间还夹一个标题行，
         *    看着像两个不相干的功能。
         *
         * 现在一个标题、一块内容：
         *    标题（含作用范围）
         *    选哪些 ── 勾选清单
         *    存/换 ── 预设胶囊 + 「存为预设」输入
         *    覆盖提示
         *
         * ⚠️ 「改的是哪一层」必须留在**看得见**的地方 —— 全局默认和「只改这个
         *    会话」改错了地方很要紧，藏进 title 用户就不会去看了；但也不该占
         *    一整行灰字，放进标题就够。
         */
        function renderCombo() {
          var head = react.createElement(
            "div",
            { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
            [
              react.createElement("span", { key: "n", style: HEADING_TITLE }, "提示词组合"),
              react.createElement(
                "span",
                { key: "scope", style: HEADING_COUNT },
                sectionScope === "session"
                  ? (sectionSessionId ? "只改这个会话" : "还没挑会话")
                  : "全局默认 · 所有会话",
              ),
              // 预设的匹配状态也挂在这一行的末尾 —— 它描述的是「当前这套配置」
              react.createElement(
                "span",
                { key: "c", style: HEADING_COUNT },
                presetsData && presetsData.matched
                  ? (presetsData.matched[sectionScope === "session" ? "session" : "global"]
                      ? "· 预设「" +
                        presetsData.matched[sectionScope === "session" ? "session" : "global"].name +
                        "」"
                      : "· 相对预设已改动")
                  : "",
              ),
              react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
              react.createElement(
                "button",
                {
                  key: "r",
                  type: "button",
                  className: "pm-btn",
                  style: presetsBusy ? BTN_BUSY : BTN,
                  disabled: presetsBusy,
                  onClick: function () {
                    loadPresets(sectionScope, sectionSessionId);
                  },
                },
                "重新读取",
              ),
            ],
          );

          if (presetsData === null) {
            return react.createElement("div", null, [
              head,
              react.createElement("div", { key: "l", style: STATUS_LINE }, "读取中…"),
            ]);
          }

          var children = [head];

          // ── 选哪些生效 ──────────────────────────────────────────────────
          // （「还没挑会话」不放常驻警告条 —— 标题上已经写了，真去勾选时
          //   setActivePrompts 也会 flash 一句「先选一个会话」。）
          children.push(react.createElement("div", { key: "pick" }, renderPicker()));

          // ── 存 / 换一套（快速预设）──────────────────────────────────────
          var list = presetsData.presets || [];
          if (list.length === 0) {
            children.push(
              react.createElement(
                "div",
                { key: "pe", style: HINT_TEXT },
                "还没有预设。下面调好一套（哪些提示词生效 + 哪些段落改写），再存下来。",
              ),
            );
          } else {
            var matchedId =
              presetsData.matched &&
              presetsData.matched[sectionScope === "session" ? "session" : "global"]
                ? presetsData.matched[sectionScope === "session" ? "session" : "global"].id
                : null;
            var chips = [];
            for (var li = 0; li < list.length; li++) {
              (function (p) {
                chips.push(
                  react.createElement(
                    "span",
                    { key: p.id, style: { display: "inline-flex", alignItems: "center", gap: "2px" } },
                    [
                      react.createElement(
                        "button",
                        {
                          key: "a",
                          type: "button",
                          className: "pm-btn",
                          style: presetsBusy ? BTN_BUSY : p.id === matchedId ? BTN_PRIMARY : BTN,
                          disabled: presetsBusy,
                          title: p.summary + (p.note ? " · " + p.note : ""),
                          onClick: function () {
                            doPreset({ action: "apply", id: p.id }, p.scope, sectionSessionId);
                          },
                        },
                        p.name + (p.id === matchedId ? " ✓" : ""),
                      ),
                      react.createElement(
                        "button",
                        {
                          key: "d",
                          type: "button",
                          className: "pm-btn",
                          style: presetsBusy ? BTN_BUSY : BTN,
                          disabled: presetsBusy,
                          title: "删除这个预设（不影响当前配置）",
                          onClick: function () {
                            doPreset({ action: "delete", id: p.id }, sectionScope, sectionSessionId);
                          },
                        },
                        "×",
                      ),
                    ],
                  ),
                );
              })(list[li]);
            }
            children.push(react.createElement("div", { key: "pl", style: COMBO_CHIPS }, chips));
          }

          // 存为预设 —— 紧跟在预设胶囊下面，它们是一件事
          children.push(
            react.createElement("div", { key: "ps", style: ACTIONS }, [
              react.createElement("span", { key: "l", style: HINT_TEXT }, "把当前这套存为预设："),
              react.createElement("input", {
                key: "i",
                type: "text",
                className: "pm-input",
                style: SELECT_SM,
                value: presetName,
                placeholder: "名字，比如「写代码」",
                disabled: presetsBusy,
                onChange: function (e) {
                  setPresetName(e.target.value);
                },
              }),
              react.createElement(
                "button",
                {
                  key: "s",
                  type: "button",
                  className: "pm-btn",
                  style: presetsBusy || !presetName.trim() ? BTN_BUSY : BTN_PRIMARY,
                  disabled: presetsBusy || !presetName.trim(),
                  onClick: function () {
                    doPreset(
                      { action: "save", name: presetName.trim(), scope: sectionScope },
                      sectionScope,
                      sectionSessionId,
                    ).then(function () {
                      setPresetName("");
                    });
                  },
                },
                "存下来",
              ),
            ]),
          );
          children.push(
            react.createElement(
              "div",
              { key: "pn", style: HINT_TEXT },
              "⚠️ 应用预设是**覆盖**不是合并 —— 它会把你当前的配置整个换成预设里那份" +
                "（包括去掉预设里没有的提示词）。所以先存再切。",
            ),
          );

          return react.createElement("div", null, children);
        }

        /**
         * 一个「?」图标，说明挂在 title 上（悬停出原生提示，也能点、能聚焦）。
         *
         * 为什么不用一小段灰字：
         *   这两段说明（段落是干什么的 + 改的是哪一层）以前是两行常驻灰字，
         *   压在标题下面，每一眼都要读一遍。挪进 title 之后，需要的时候才有。
         *
         * ⚠️ 用 `title` 而不是自己写弹层：原生提示不用管点击外部关闭、
         *    不用管层级（z-index）、不用管 Esc，也不会被设置页的滚动容器裁掉。
         *    dsh 自己的图标提示也是这么给的。
         */
        function renderHelpIcon(text) {
          return react.createElement(
            "span",
            {
              key: "help",
              title: text,
              "aria-label": text,
              tabIndex: 0,
              style: {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                width: "14px",
                height: "14px",
                color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))",
                cursor: "help",
              },
            },
            react.createElement(
              "svg",
              { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true" },
              react.createElement("circle", {
                cx: "8",
                cy: "8",
                r: "6.6",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: "1.3",
              }),
              react.createElement(
                "text",
                {
                  x: "8",
                  y: "11.4",
                  textAnchor: "middle",
                  fontSize: "9",
                  fontWeight: "700",
                  fill: "currentColor",
                },
                "?",
              ),
            ),
          );
        }

        /** 「系统提示词」整块。 */
        function renderSections() {
          var head = react.createElement(
            "div",
            // ⚠️ 间距给足。这一块跟上面「提示词组合」是两个不相干的功能，
            //    标题又长得跟卡片标题很像 —— 只隔 4px 时视觉上糊成一片，
            //    看着像同一块内容的一部分（用户提的就是这个）。
            { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
            [
              react.createElement("span", { key: "n", style: HEADING_TITLE }, "系统提示词"),
              // 两段说明并成一个「?」—— 详见 renderHelpIcon
              renderHelpIcon(
                "这些是 dsh 自己往系统提示词里放的段落。可以逐段改写或关掉，也能还原。" +
                  "官方以后新增段落会自动出现在这里，改过的会标出来 —— 你的改动不会被官方更新顶掉。" +
                  "\n\n" +
                  "这里改的是全局默认，所有会话都生效。" +
                  "只想改某一个会话的话，用会话头那一行的「提示词」按钮。",
              ),
              react.createElement(
                "span",
                { key: "c", style: HEADING_COUNT },
                sections && sections.counts ? sections.summary : "读取中…",
              ),
              react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
              react.createElement(
                "button",
                {
                  key: "r",
                  type: "button",
                  className: "pm-btn",
                  style: sectionsBusy ? BTN_BUSY : BTN,
                  disabled: sectionsBusy,
                  onClick: function () {
                    loadSections(sectionScope, sectionSessionId);
                  },
                },
                "重新读取",
              ),
            ],
          );

          if (sections === null) {
            return react.createElement("div", null, [
              head,
              react.createElement("div", { key: "l", style: STATUS_LINE }, "读取中…"),
            ]);
          }

          var items = [];
          if (sections.outcome !== "ok") {
            items.push(
              react.createElement(
                "div",
                { key: "err", style: WARN },
                (sections.error || "读取失败") + "（还没有存活的会话时读不到，先开个会话再回来）",
              ),
            );
          }

          // 改动过的排前面，方便一眼看到自己动过什么
          var ordered = []
            .concat(sections.applied || [])
            .concat(sections.stale || [])
            .concat(sections.untouched || []);
          for (var si = 0; si < ordered.length; si++) items.push(renderSectionCard(ordered[si]));

          // ── 没被注册的槽位（灰卡片，不可操作）──────────────────────────
          //
          // 「为什么 bash 不在」——因为 dsh 这次没往那个位置放东西，不是列表出错。
          // 只列判断确定的（静态段名 / 没有包注册它），模板名不列（详见
          // scripts/lib/section-slots.mjs）。
          var slots = sections.emptySlots || [];
          if (slots.length > 0) {
            items.push(
              react.createElement(
                "div",
                { key: "slots-head", style: Object.assign({}, CARD_HEADING, { marginTop: "14px" }) },
                [
                  react.createElement("span", { key: "n", style: HEADING_TITLE }, "没有被注册的位置"),
                  react.createElement(
                    "span",
                    { key: "c", style: HEADING_COUNT },
                    slots.length + " 个 · dsh 预留了但这些功能这次没加载",
                  ),
                ],
              ),
            );
            for (var sj = 0; sj < slots.length; sj++) items.push(renderEmptySlot(slots[sj]));
          }

          return react.createElement("div", null, [head].concat(items));
        }

        /**
         * ⚠️ 这里原来有个 `saveDefaults()`（POST /defaults）。
         *
         * 它只被「新会话默认」那张卡片调用，卡片去掉之后就是死代码了。
         * **全局默认仍然可写** —— 走「提示词组合」那块：scope = 全局默认时
         * `setActivePrompts()` 打的就是 ROUTE_DEFAULTS。所以这一层没被砍掉，
         * 只是不再有第二张卡片重复提供同一个入口。
         *
         * 注：对应的 `defaultsDraft` / `defaultsBusy` 两个 state 还留着。
         * 删掉它们会让**后面所有 useState 的下标前移**，而测试是按索引塞状态的
         * （见 client_render_test.mjs 里那张顺序表）。等测试改成按名字定位再一起清。
         */

        var send = react.useCallback(
          function (payload, okText) {
            setBusy(true);
            fetch(ROUTE_EDIT, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            })
              .then(function (res) {
                return res.json().then(function (j) {
                  if (!res.ok) throw new Error((j && j.error) || "HTTP " + res.status);
                  return j;
                });
              })
              .then(function (d) {
                if (!mountedRef.current) return null;
                setList(function (prev) {
                  return Object.assign({}, prev || {}, { prompts: d.prompts || [] });
                });
                setErr(null);
                flash(okText);
                setEdit(null);
                return null;
              })
              .catch(function (e) {
                if (!mountedRef.current) return;
                var m = (e && e.message) || String(e);
                setErr(m);
                flash("保存失败：" + m);
              })
              .then(function () {
                if (mountedRef.current) setBusy(false);
              });
          },
          [flash],
        );

        var prompts = (list && list.prompts) || [];

        /** 内置分类表（含建议 order）+ 目录里已存在的自定义分类。 */
        var builtinCategories = (list && list.categories) || [];
        var customCategories = (list && list.customCategories) || [];

        /** 取某个分类的建议 order；自定义分类返回 null（没有建议值）。 */
        function suggestedOrderOf(category) {
          for (var i = 0; i < builtinCategories.length; i++) {
            if (builtinCategories[i].id === category) return builtinCategories[i].order;
          }
          return null;
        }

        function categoryName(id) {
          for (var i = 0; i < builtinCategories.length; i++) {
            if (builtinCategories[i].id === id) return builtinCategories[i].name;
          }
          return id || "其他";
        }

        /**
         * 改分类时**带出建议 order**（用户选的方案）。之后 order 仍然可以手改。
         * 自定义分类没有建议值，那就保持原样不动。
         */
        function setCategory(v) {
          setEdit(function (prev) {
            var next = Object.assign({}, prev, { category: v });
            var sug = suggestedOrderOf(v);
            if (sug !== null) next.order = sug;
            return next;
          });
        }

        function newPrompt() {
          var base = "my-prompt";
          var n = 1;
          var ids = {};
          for (var i = 0; i < prompts.length; i++) ids[prompts[i].id] = true;
          while (ids[base + "-" + n]) n += 1;
          // 新条目默认落在「身份」类 —— 这是最常见的自定义提示词
          var cat = "identity";
          var sug = suggestedOrderOf(cat);
          setEdit({
            isNew: true,
            id: base + "-" + n,
            name: "新提示词",
            description: "",
            category: cat,
            mode: "append",
            order: sug === null ? 100 : sug,
            text: "",
            source: "none",
          });
        }

        function field(key) {
          return function (e) {
            var v = e.target.value;
            setEdit(function (prev) {
              return Object.assign({}, prev, { [key]: v });
            });
          };
        }

        function renderForm() {
          if (!edit) return null;
          var idOk = /^[a-z0-9][a-z0-9._-]*$/i.test(edit.id || "");
          return react.createElement("div", { style: FORM }, [
            react.createElement("div", { key: "r1", style: FORM_LINE }, [
              react.createElement("span", { key: "l", style: FORM_LABEL }, "id"),
              react.createElement("input", {
                key: "i",
                className: "pm-input", style: FORM_INPUT,
                value: edit.id,
                disabled: !edit.isNew,
                onChange: field("id"),
                placeholder: "只允许字母数字 . _ -",
                title: edit.isNew ? "唯一标识，创建后不可改" : "已存在的条目不能改 id（改 id 等于换一条）",
              }),
              !idOk ? react.createElement("span", { key: "w", style: PILL_WARN }, "id 非法") : null,
            ]),
            react.createElement("div", { key: "r2", style: FORM_LINE }, [
              react.createElement("span", { key: "l", style: FORM_LABEL }, "名称"),
              react.createElement("input", {
                key: "i",
                className: "pm-input", style: FORM_INPUT,
                value: edit.name,
                onChange: field("name"),
                placeholder: "显示名",
              }),
              react.createElement("span", { key: "l2", style: FORM_LABEL }, "模式"),
              react.createElement(
                "select",
                { key: "s", style: Object.assign({}, FORM_INPUT, { flex: "0 0 110px" }), value: edit.mode, onChange: field("mode") },
                [
                  react.createElement("option", { key: "a", value: "append" }, "追加"),
                  react.createElement("option", { key: "n", value: "none" }, "不注入"),
                ],
              ),
            ]),
            // 分类：**用 <select>，不用 <datalist>**。
            //
            // 曾经用 `<input list="…">` + `<datalist>` 想"既能挑又能写"，
            // 但用户反馈**下拉弹不出来、选不了**。datalist 是原生控件，
            // 弹出行为受浏览器/样式环境影响，我在这边看不到也调不动 ——
            // 换成 select，行为完全由我控制。
            //
            // 五个内置类是固定表，本来就适合 select；自定义部分用
            // 「已存在的自定义分类」进选项、再加一个「＋ 自定义…」。
            // 改分类会带出该类别的建议 order（order 输入框仍可手改）。
            react.createElement("div", { key: "r2b", style: FORM_LINE }, [
              react.createElement("span", { key: "l", style: FORM_LABEL }, "分类"),
              (function () {
                var CAT_CUSTOM = "\u0000custom";
                var current = edit.category || "";
                var isBuiltin = builtinCategories.some(function (c) {
                  return c.id === current;
                });
                // 当前值既不是内置、也不在已知自定义里 → 也是"自定义"
                var isKnownCustom = customCategories.indexOf(current) >= 0;
                var selectValue = isBuiltin ? current : isKnownCustom ? current : CAT_CUSTOM;
                var opts = [];
                for (var i = 0; i < builtinCategories.length; i++) {
                  (function (c) {
                    opts.push(react.createElement("option", { key: c.id, value: c.id }, c.name + "（" + c.id + "）"));
                  })(builtinCategories[i]);
                }
                for (var j = 0; j < customCategories.length; j++) {
                  (function (c) {
                    opts.push(react.createElement("option", { key: "c-" + c, value: c }, c + "（自定义）"));
                  })(customCategories[j]);
                }
                opts.push(react.createElement("option", { key: "custom", value: CAT_CUSTOM }, "＋ 自定义…"));
                return react.createElement(
                  "span",
                  { key: "cw", style: { display: "inline-flex", gap: "6px", alignItems: "center", flex: "0 1 auto", minWidth: "0" } },
                  [
                    react.createElement(
                      "select",
                      {
                        key: "sel",
                        className: "pm-input",
                        style: Object.assign({}, FORM_INPUT, { flex: "0 0 auto", minWidth: "132px" }),
                        value: selectValue,
                        "data-pm-category": "select",
                        onChange: function (e) {
                          var v = e.target.value;
                          if (v === CAT_CUSTOM) {
                            // 切到"自定义"：给个空框让用户写，不动 order（自定义没有建议值）
                            setEdit(function (prev) {
                              return Object.assign({}, prev, { category: "" });
                            });
                            return;
                          }
                          setCategory(v);
                        },
                      },
                      opts,
                    ),
                    // 只有"自定义"时才出现输入框
                    isBuiltin || isKnownCustom
                      ? null
                      : react.createElement("input", {
                          key: "txt",
                          className: "pm-input",
                          style: Object.assign({}, FORM_INPUT, { flex: "0 1 150px" }),
                          value: current,
                          "data-pm-category": "text",
                          onChange: function (e) {
                            var v = e.target.value;
                            setEdit(function (prev) {
                              return Object.assign({}, prev, { category: v });
                            });
                          },
                          placeholder: "自己起个分类名",
                          title: "自定义分类没有建议 order，不会动你已填的 order。",
                        }),
                  ],
                );
              })(),
              react.createElement("span", { key: "l3", style: FORM_LABEL }, "order"),
              react.createElement("input", {
                key: "o",
                style: FORM_INPUT_NUM,
                type: "number",
                value: edit.order,
                onChange: field("order"),
                title: "插入位置。100 = persona 之后、工具说明之前；2900 = 工具说明之后",
              }),
            ]),
            react.createElement(
              "div",
              { key: "r2c", style: STATUS_LINE },
              (function () {
                var hint = null;
                for (var i = 0; i < builtinCategories.length; i++) {
                  if (builtinCategories[i].id === edit.category) hint = builtinCategories[i].hint;
                }
                var pos = "order " + edit.order + "：";
                if (edit.order < 900) pos += "在 dsh 自带 persona 之后、文件引用之前";
                else if (edit.order < 3000) pos += "在文件引用与工具说明之间";
                else if (edit.order < 9000) pos += "在所有工具说明之后";
                else pos += "在交付物相关段落之间";
                return (hint ? hint + "　" : "") + pos;
              })(),
            ),
            react.createElement("div", { key: "r3", style: FORM_LINE }, [
              react.createElement("span", { key: "l", style: FORM_LABEL }, "说明"),
              react.createElement("input", {
                key: "i",
                className: "pm-input", style: FORM_INPUT,
                value: edit.description,
                onChange: field("description"),
                placeholder: "一句话说明，会显示在选择器里",
              }),
            ]),
            edit.mode === "none"
              ? react.createElement(
                  "div",
                  { key: "none-note", style: MUTED },
                  "不注入模式不需要正文 —— 已有的正文文件在保存时会被删除。",
                )
              : react.createElement("textarea", {
                  key: "t",
                  className: "pm-input", style: FORM_TEXTAREA,
                  value: edit.text,
                  onChange: field("text"),
                  placeholder: "提示词正文（保存后写到 prompts/" + edit.id + ".md）",
                }),
            react.createElement("div", { key: "foot", style: CARD_ACTIONS }, [
              react.createElement(
                "span",
                { key: "n", style: STATUS_LINE },
                edit.mode === "none" ? "" : "约 " + edit.text.length + " 字符 · 保存到 prompts/" + edit.id + ".md",
              ),
              react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
              react.createElement(
                "button",
                {
                  key: "c",
                  type: "button",
                  className: "pm-btn", style: busy ? DETAIL_BTN_BUSY : DETAIL_BTN,
                  disabled: busy,
                  onClick: function () {
                    setEdit(null);
                  },
                },
                "取消",
              ),
              react.createElement(
                "button",
                {
                  key: "s",
                  type: "button",
                  style: busy || !idOk ? DETAIL_BTN_BUSY : DETAIL_BTN,
                  disabled: busy || !idOk,
                  onClick: function () {
                    send(
                      {
                        action: "upsert",
                        prompt: {
                          id: edit.id,
                          name: edit.name,
                          description: edit.description,
                          category: edit.category || "other",
                          mode: edit.mode,
                          order: Number(edit.order),
                          text: edit.text,
                        },
                      },
                      edit.isNew ? "已新建「" + edit.name + "」" : "已保存「" + edit.name + "」",
                    );
                  },
                },
                busy ? "保存中…" : "保存",
              ),
            ]),
          ]);
        }

        /** 展开某张卡片（原生插件列表就是这个交互：点卡片头展开详情）。 */
        function toggleOpen(id) {
          setOpenId(function (prev) {
            return prev === id ? null : id;
          });
        }

        function pillFor(mode) {
          if (mode === "append") return react.createElement("span", { style: PILL_APPEND }, "追加");
          return react.createElement("span", { style: PILL }, "不注入");
        }

        /**
         * 一张个人提示词卡片。
         *
         * ⚠️ 头部结构**与系统提示词卡片（renderSectionCard）保持一致** ——
         *    两块内容在同一个页面里上下挨着，头部长得不一样会显得是两套东西：
         *      一行：名字（+ 原始 id 小字） → 徽章 → 字数 → 箭头
         *      两行：id / 描述（有才显示）
         *    原来这里是「标题 + 徽章 + 箭头」挤在 CARD_MAIN_ROW 里、下面单独一行
         *    id、再一行描述 —— 高度和信息排布都跟系统那边对不上。
         *
         * ⚠️ 两个坑沿用 renderSectionCard 的结论（那边踩过，这边照抄）：
         *    1. 内边距要用 `CARD_HEAD`（12px 14px）—— `CARD_MAIN_ROW` 只是布局行、
         *       没有 padding，只用它内容会贴着边框；
         *    2. `CARD_HEAD` 是 `flexDirection: "column"`，`CARD_MAIN_ROW` 没设
         *       flexDirection，Object.assign 之后 column 会赢 —— 要一行就得显式
         *       改回 row。否则名字/徽章/箭头竖成三行居中（真机上就是这么错的）。
         */
        /**
         * 一个大类别卡片，里面装这个类别的个人提示词卡片。
         *
         * 用户要的：**个人提示词的卡片跟系统提示词的卡片长得一样，
         * 外面再套一层大类别卡片。**
         *
         * 为什么要套这一层（而不只是给分组标题加个框）：
         *   原来分类是「一段灰字标题 + 一个网格」，网格里的卡片各自独立，
         *   分类归属只靠标题的位置暗示。套上类别卡片之后边界是画出来的，
         *   而且可以折叠 —— 库大了以后能整类收起来。
         *
         * 折叠状态复用 openId（存 `"cat:<id>"`）：
         *   个人提示词的 id 不可能以 `cat:` 开头（id 是文件名派生、不许有冒号），
         *   所以两边塞进同一个格不会撞。
         *
         * ⚠️ 卡片头**照抄系统提示词卡片那套**（CARD_HEAD + CARD_MAIN_ROW +
         *    显式 flexDirection: "row"），理由见 renderRow 上面那段。
         */
        function renderGroupCard(g, isCustom) {
          var openKey = "cat:" + g.id;
          // ⚠️ 默认**展开**。
          //
          //    全折叠的话，打开设置页只能看见一排分类名，库里有什么一条都看不到
          //    —— 而「库里有几条提示词」正是进这个页面最先要知道的事。
          //    所以折叠要做成**显式动作**：用户自己点了才折，没点过就一直是开的。
          //    （不是「默认 null = 全折」那种，那样每次进来都得手点一遍。）
          var isOpen = closedCats.indexOf(openKey) < 0;
          var cards = [];
          for (var i = 0; i < g.items.length; i++) cards.push(renderRow(g.items[i]));
          return react.createElement(
            "div",
            {
              key: "grp-" + g.id,
              style: Object.assign({}, CARD, { marginBottom: "10px" }),
            },
            [
              react.createElement(
                "button",
                {
                  key: "head",
                  type: "button",
                  className: "pm-head",
                  style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
                    flexDirection: "row",
                    minHeight: "0",
                    padding: "10px 14px",
                    cursor: "pointer",
                  }),
                  "aria-expanded": isOpen,
                  onClick: function () {
                    var next = closedCats.slice();
                    var at = next.indexOf(openKey);
                    if (at >= 0) next.splice(at, 1);
                    else next.push(openKey);
                    setClosedCats(next);
                  },
                },
                [
                  react.createElement("span", { key: "n", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) }, categoryName(g.id)),
                  isCustom
                    ? react.createElement("span", { key: "t", style: PILL }, "自定义分类")
                    : null,
                  react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                  react.createElement("span", { key: "c", style: HEADING_COUNT }, g.items.length + " 条"),
                  react.createElement("span", { key: "ch", style: isOpen ? CHEVRON_OPEN : CHEVRON }, "›"),
                ],
              ),
              isOpen
                ? react.createElement(
                    "div",
                    { key: "body", style: CARD_DETAILS },
                    react.createElement("div", { style: CARDS_GRID }, cards),
                  )
                : null,
            ],
          );
        }

        function renderRow(p) {
          if (!p || !p.id) return null;
          var isEditing = edit && edit.id === p.id && !edit.isNew;
          var isOpen = openId === p.id || isEditing;
          return react.createElement(
            // 与原生 .card 对齐：.5px 描边 + settings-card-fill + radius-xl + overflow hidden
            "div",
            { key: p.id, style: isOpen ? Object.assign({}, CARD, { borderColor: "var(--dsw-alias-border-l3, rgba(128,128,128,.4))" }) : CARD },
            react.createElement(
              "button",
              {
                type: "button",
                className: "pm-head",
                style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
                  flexDirection: "row",
                  minHeight: "0",
                  padding: "10px 14px",
                  cursor: "pointer",
                }),
                "aria-expanded": isOpen,
                onClick: function () {
                  toggleOpen(p.id);
                },
              },
              [
                react.createElement(
                  "span",
                  { key: "t", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) },
                  p.name || p.id,
                ),
                // 原始 id 小字跟在后面 —— 名字给人看，这个给排查用。同一行，不占高度。
                react.createElement("span", { key: "raw", style: RAW_NAME, title: p.id }, p.id),
                react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                pillFor(p.mode),
                react.createElement("span", { key: "c", style: HEADING_COUNT }, fmtTokens(p.tokens)),
                react.createElement("span", { key: "ch", style: isOpen ? CHEVRON_OPEN : CHEVRON }, "›"),
              ],
            ),
            // 第二行留给描述：没有就不占位（原来无论有没有都留一行空）
            p.description && !isOpen
              ? react.createElement("div", { key: "d", style: CARD_DESC_ROW }, p.description)
              : null,
            isOpen
              ? react.createElement(
                  "div",
                  { style: CARD_DETAILS },
                  isEditing
                    ? renderForm()
                    : react.createElement("div", null, [
                        // 原生的详情区是 `dt/dd` 两列网格
                        react.createElement("dl", { key: "meta", style: DETAILS_GRID }, [
                          react.createElement("dt", { key: "l1", style: DT }, "模式"),
                          react.createElement(
                            "dd",
                            { key: "v1", style: DD },
                            MODE_LABEL[p.mode] || p.mode,
                          ),
                          react.createElement("dt", { key: "l2", style: DT }, "order"),
                          react.createElement(
                            "dd",
                            { key: "v2", style: DD },
                            String(p.order) + "　（100 = persona 之后；2900 = 工具说明之后）",
                          ),
                          react.createElement("dt", { key: "l3", style: DT }, "规模"),
                          react.createElement(
                            "dd",
                            { key: "v3", style: DD },
                            fmtTokens(p.tokens) + " · " + p.chars + " 字符",
                          ),
                          react.createElement("dt", { key: "l4", style: DT }, "正文"),
                          react.createElement(
                            "dd",
                            { key: "v4", style: DD },
                            p.source === "file"
                              ? p.file
                              : p.source === "inline"
                                ? "内联在 catalog.json 里（保存后会转成文件）"
                                : "无（不注入模式）",
                          ),
                        ]),
                        p.text
                          ? react.createElement("pre", { key: "body", style: MONO }, p.text)
                          : null,
                        react.createElement("div", { key: "act", style: CARD_ACTIONS }, [
                          react.createElement(
                            "button",
                            {
                              key: "e",
                              type: "button",
                              className: "pm-btn", style: busy ? DETAIL_BTN_BUSY : DETAIL_BTN,
                              disabled: busy,
                              onClick: function () {
                                setEdit({
                                  isNew: false,
                                  id: p.id,
                                  name: p.name || p.id,
                                  description: p.description || "",
                                  category: p.category || "other",
                                  mode: p.mode || "append",
                                  order: p.order == null ? 100 : p.order,
                                  text: p.text || "",
                                  source: p.source,
                                });
                              },
                            },
                            "编辑",
                          ),
                          react.createElement(
                            "button",
                            {
                              key: "d",
                              type: "button",
                              className: "pm-btn", style: busy ? DETAIL_BTN_BUSY : DETAIL_BTN_DANGER,
                              disabled: busy,
                              title: "删除这条（正文文件一并删除）",
                              onClick: function () {
                                if (typeof window !== "undefined" && window.confirm) {
                                  if (!window.confirm("删除「" + (p.name || p.id) + "」？正文文件也会删掉。")) return;
                                }
                                send({ action: "delete", id: p.id }, "已删除「" + (p.name || p.id) + "」");
                              },
                            },
                            "删除",
                          ),
                        ]),
                      ]),
                )
              : null,
          );
        }


        // 分组标题（对齐原生 .catalogHeading：h3 + 计数）
        //
        // ⚠️ 间距跟「系统提示词」那个标题行**取同一组值**（下面 22 / 10）。
        //    两个区块在同一个页面里上下挨着，标题跟卡片的距离不一样会显得
        //    一个是「标题+内容」、另一个是「一条独立的说明条」。
        var header = react.createElement(
          "div",
          { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
          [
          react.createElement("h3", { key: "t", style: Object.assign({}, HEADING_TITLE, { margin: 0 }) }, "个人提示词"),
          react.createElement("span", { key: "c", style: HEADING_COUNT }, prompts.length + " 条"),
          react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
          message
            ? react.createElement("span", { key: "m", style: err ? MSG_ERR : MSG_OK, title: message }, message)
            : null,
          react.createElement(
            "button",
            {
              key: "n",
              type: "button",
              className: "pm-btn", style: busy || !!edit ? DETAIL_BTN_BUSY : DETAIL_BTN,
              disabled: busy || !!edit,
              onClick: newPrompt,
            },
            "新建",
          ),
          react.createElement(
            "button",
            { key: "r", type: "button", className: "pm-btn", style: DETAIL_BTN, disabled: busy, onClick: load },
            "刷新",
          ),
          ],
        );

        var body = [];
        if (err) {
          body.push(
            react.createElement("div", { key: "err", style: WARN }, [
              react.createElement("strong", { key: "t" }, "出错："),
              err,
            ]),
          );
        }
        if (list === null) {
          body.push(react.createElement("div", { key: "loading", style: STATUS_LINE }, "读取中…"));
        } else {
          // ⚠️ 顺序（用户定的）：
          //    全局注入开关 → 提示词组合 + 快速预设 → 个人提示词 → 系统提示词
          //    从「管什么」到「管具体哪条」再到「dsh 自己的段落」，一层层收窄。
          body.push(react.createElement("div", { key: "master" }, renderMasterSwitch()));
          // 提示词组合 + 快速预设 —— 管「哪些生效」，在具体条目之前
          body.push(react.createElement("div", { key: "combo" }, renderCombo()));
          // 个人提示词：标题行 + 分类卡片，最后作为一个块推入（见下面那段说明）
          var cards = [];
          // 按分类分组显示。组内顺序：内置五类的固定次序 → 自定义分类按名字排。
          // 空分类不显示标题（只有一条也不显示，免得满屏小标题）。
          var seen = {};
          var groups = [];
          for (var gi = 0; gi < builtinCategories.length; gi++) {
            groups.push({ id: builtinCategories[gi].id, items: [] });
            seen[builtinCategories[gi].id] = true;
          }
          var customs = [];
          for (var pi = 0; pi < prompts.length; pi++) {
            var c = (prompts[pi] && prompts[pi].category) || "other";
            if (!seen[c]) {
              seen[c] = true;
              customs.push(c);
            }
          }
          customs.sort();
          for (var ci = 0; ci < customs.length; ci++) groups.push({ id: customs[ci], items: [] });
          for (var qi = 0; qi < prompts.length; qi++) {
            var qc = (prompts[qi] && prompts[qi].category) || "other";
            for (var gj = 0; gj < groups.length; gj++) {
              if (groups[gj].id === qc) {
                groups[gj].items.push(prompts[qi]);
                break;
              }
            }
          }

          if (prompts.length === 0) {
            // "新建"表单放在卡片列之外（它需要整行宽度）
            if (edit && edit.isNew) {
              cards.push(
                react.createElement(
                  "div",
                  { key: "new", style: Object.assign({}, CARD, { marginBottom: "10px" }) },
                  react.createElement("div", { style: CARD_DETAILS }, renderForm()),
                ),
              );
            }
            cards.push(
              react.createElement(
                "div",
                { key: "empty", style: STATUS_LINE },
                "提示词库是空的，点「新建」加一条。",
              ),
            );
          } else {
            // "新建"表单放在卡片列最前（它需要整行宽度）
            if (edit && edit.isNew) {
              cards.push(
                react.createElement(
                  "div",
                  { key: "new", style: Object.assign({}, CARD, { marginBottom: "10px" }) },
                  react.createElement("div", { style: CARD_DETAILS }, renderForm()),
                ),
              );
            }
            // 按分类分组显示。组内顺序：内置五类的固定次序 → 自定义分类按名字排。
            // 空分类不显示（只有一条也不显示，免得满屏小标题）。
            var seen = {};
            var groups = [];
            for (var gi = 0; gi < builtinCategories.length; gi++) {
              groups.push({ id: builtinCategories[gi].id, items: [] });
              seen[builtinCategories[gi].id] = true;
            }
            var customs = [];
            for (var pi = 0; pi < prompts.length; pi++) {
              var c = (prompts[pi] && prompts[pi].category) || "other";
              if (!seen[c]) {
                seen[c] = true;
                customs.push(c);
              }
            }
            customs.sort();
            for (var ci = 0; ci < customs.length; ci++) groups.push({ id: customs[ci], items: [] });
            for (var qi = 0; qi < prompts.length; qi++) {
              var qc = (prompts[qi] && prompts[qi].category) || "other";
              for (var gj = 0; gj < groups.length; gj++) {
                if (groups[gj].id === qc) {
                  groups[gj].items.push(prompts[qi]);
                  break;
                }
              }
            }
            for (var gk = 0; gk < groups.length; gk++) {
              var g = groups[gk];
              if (g.items.length === 0) continue;
              // ⚠️ 第二个参数是「这是不是自定义分类」，**不是** `seen[g.id]`。
              //
              //    `seen` 是「这个 id 有没有被处理过」的记账表，内置分类在初始化时
              //    就全被标成 true —— 直接把它传进去的后果是**每个分类都被打上
              //    「自定义分类」徽章**（用户看到「领域」标着自定义，就是这个 bug）。
              //    判据要用「在不在内置表里」反推。
              cards.push(
                renderGroupCard(
                  g,
                  !builtinCategories.some(function (b) { return b.id === g.id; }),
                ),
              );
            }
          }

          // ⚠️ 标题行和卡片必须**在同一个 body 项里**。
          //
          //    `SECTION` 是 `display:flex; gap:14px` 的列 —— body 里每一项之间
          //    都隔 14px。原来把 header 和卡片拆成两个 body 项，等于**标题行
          //    和卡片之间硬隔了 14px，还各自和上下邻居等距**，看着就像标题是
          //    独立的一条、跟卡片没关系。
          //    系统提示词那块（renderSections）从来就是一个块，标题和卡片挨着
          //    （间距 10px）—— 个人提示词现在对齐它。
          // ⚠️ 标题行和卡片必须**在同一个 body 项里**。
          //
          //    `SECTION` 是 `display:flex; gap:14px` 的列 —— body 里每一项之间
          //    都隔 14px。原来把 header 和卡片拆成两个 body 项，等于**标题行
          //    和卡片之间硬隔了 14px，还各自和上下邻居等距**，看着就像标题是
          //    独立的一条、跟卡片没关系。
          //    系统提示词那块（renderSections）从来就是一个块，标题和卡片挨着
          //    （间距 10px）—— 个人提示词现在对齐它。
          body.push(react.createElement("div", { key: "personal" }, [header].concat(cards)));
        }

        body.push(
          react.createElement("div", { key: "sections" }, renderSections()),
        );

        // 页脚只留一行。原来这里有四条并列说明（order 怎么算、哪层生效、
        // 保存后会发生什么、正文写在哪），叠在一起就是一片灰字，没人看。
        // 真正需要的时候会出现在用得着的地方：order 在每条卡片里、层次在标题上。
        body.push(
          react.createElement(
            "div",
            { key: "hint", style: HINT },
            list && list.promptsDir
              ? react.createElement("span", null, "正文写在 " + list.promptsDir)
              : null,
          ),
        );

        // ⚠️ `header` 已经并进 personal 块了（见上面那段说明），这里**只拼 body**。
        //    原来写成 `[header].concat(body)` —— 那样个人提示词的标题会出现两次。
        return react.createElement("div", { style: SECTION }, body);
      }

      // ── 注入一小段样式表 ──────────────────────────────────────────────────
      // 内联 style 做不了 `:hover` / `:focus-visible`，而这两样正是原生卡片的关键手感。
      // 一方插件（dsh-client-ui-settings-*）也是往文档里塞一个带 data-plugin 标记的
      // `<style>`（CSS module 编译成字符串后注入），这里照做。
      // 类名统一加 `pm-` 前缀，避免和别的插件撞。
      const CSS_TAG_ID = "dsh-prompt-manager-editor-css";
      const EDITOR_CSS = [
        ".pm-head{transition:background .12s ease}",
        ".pm-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09))}",
        ".pm-head:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b82f6));outline-offset:-2px}",
        ".pm-btn{transition:background .12s ease}",
        ".pm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09))}",
        ".pm-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b82f6));outline-offset:1px}",
        ".pm-input:focus-visible{border-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b82f6));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b82f6)) 18%,transparent)}",
      ].join("");

      function ensureEditorStyles() {
        try {
          if (typeof document === "undefined" || !document.head) return;
          if (document.getElementById(CSS_TAG_ID)) return;
          var tag = document.createElement("style");
          tag.id = CSS_TAG_ID;
          tag.setAttribute("data-plugin", "dsh-prompt-manager");
          tag.textContent = EDITOR_CSS;
          document.head.appendChild(tag);
        } catch {
          /* 拿不到 document 就算了 —— 只是少了悬停效果，功能不受影响 */
        }
      }


      return {
        PromptEditor: PromptEditor,
        installStyles: ensureEditorStyles,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
