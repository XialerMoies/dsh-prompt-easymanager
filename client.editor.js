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
    // ⚠️ 这里原来还 require 了 "react-dom"，但本文件从头到尾没用过它
    //    （用 createPortal 的预览弹窗在 client.preview.js 里）。
    //    顺手删掉 —— chunk 的依赖越少越好。


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
      var ROUTE_DEFAULTS = api.route.ROUTE_DEFAULTS;
      // ⚠️ 这里原来还拿了 `ROUTE_ASSIGN`（按会话分配），但设置面板只写全局层，
      //    所以那份从删掉 sectionScope 起就没人用了 —— 一并删掉。
      //    会话页的 picker 自己拿自己那份，两边互不影响。

      var SECTION = {
        width: "100%",
        maxWidth: "760px",
        color: "var(--dsw-alias-label-primary, inherit)",
        display: "flex",
        flexDirection: "column",
        // ⚠️ 12px —— 跟 dsh 其它内容页一致（模型页 / 智能体预设页的 `.section`
        //    都是 `gap:12px`）。
        //
        // ⚠️⚠️ **宿主里还有一份同名常量，而且会被这份覆盖** ——
        //    改间距时两处都要改（踩过：只改了宿主那份，页面纹丝不动，
        //    「功能之间」还是 14px）。测试里有一条断言专门盯这个值。
        gap: "12px",
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

      function PromptEditor(props) {
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
        // ── 提示词组合 / 快速预设 ────────────────────────────────────────
        // 同样加在最后。
        //
        // ⚠️ 这里原来还有一对 `sectionScope` / `sectionSessionId`（「编辑写进
        //    哪一层」的开关，global / session）。**两个 setter 从没被调用过** ——
        //    界面上从来没有这个入口，所以恒为 "global"。已删除：设置面板只编辑
        //    全局层，会话层走会话页（那边天然带着 sessionId）。
        //    后端的 `scope: "session"` / `?session=` 能力保留，只是面板不用。
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
        /**
         * 正在改预署名（标题变成输入框）。
         * 跟 `presetName` 分开：那个是「存新预设时填的名字」，这个是「改现有预设名」。
         */
        var rnSt = react.useState(false);
        var renaming = rnSt[0];
        var setRenaming = rnSt[1];
        var rnDraftSt = react.useState("");
        var renameDraft = rnDraftSt[0];
        var setRenameDraft = rnDraftSt[1];
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
        var loadSections = react.useCallback(function () {
          // 只读全局层（不带 ?session=）。会话层由会话页负责。
          var url = ROUTE_SECTIONS;
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

        react.useEffect(function () {
          loadSections();
        }, [loadSections]);

        // ── 提示词组合 / 快速预设：读取 ────────────────────────────────────
        var loadPresets = react.useCallback(function () {
          // 只读全局层（不带 ?session=）。
          var url = ROUTE_PRESETS;
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
          loadPresets();
        }, [loadPresets]);

        /** 预设类操作：save / apply / delete。完事两边都重读。 */
        var doPreset = react.useCallback(
          function (payload) {
            setPresetsBusy(true);
            var url = ROUTE_PRESETS;
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
                      : payload.action === "rename"
                        ? "已改名为「" + (d && d.name) + "」"
                        : "已删除",
                );
                // 应用预设会动 defaults，注入那边也要重读
                loadPresets();
                loadSections();
                setErr(null);
                // ⚠️ 把响应交出去 —— 改名会**换 id**（id 从名字派生），
                //    调用方要拿新 id 更新「当前选中是哪条」。
                return d || null;
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
          function (nextIds) {
            setPresetsBusy(true);
            // 只写全局层。会话层的分配由会话页负责（那边天然带着 sessionId）。
            var url = ROUTE_DEFAULTS;
            var body = { promptIds: nextIds };
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
          function (name, action, text) {
            setSectionsBusy(true);
            // 只写全局层。会话层的段落改写由会话页负责（那边天然带着 sessionId）。
            var body = { name: name, action: action, scope: "global" };
            if (action === "replace") body.text = text;
            var url = ROUTE_SECTIONS;
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
        /**
         * 卡片体的内容：勾选网格（已选的排前面）。
         *
         * ⚠️ **只吐内容，不自带卡片** —— 卡片是 renderCombo 那层的。
         *    这里返回 CARD 的话，「预设名 / 下拉 / 保存」就只能摆在卡片外面，
         *    变成三层（踩过：用户问「下拉框和保存不都说是卡片顶部了吗」）。
         */
        function renderPickerBody() {
          // ⚠️ 只取 global 层。不带 ?session= 时后端**根本不返回** session 层，
          //    原来那个三元的 session 分支永远取到 undefined（死代码，已删）。
          var layer = presetsData.layers && presetsData.layers.global;
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
              { style: STATUS_LINE },
              "库里还没有可选的提示词 —— 在下面「新建」加一条。",
            );
          }

          var rows = [];
          for (var oi = 0; oi < ordered.length; oi++) {
            (function (p) {
              var on = !!picked[p.id];
              rows.push(
                react.createElement(
                  "label",
                  {
                    key: p.id,
                    title: p.description || p.id,
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: "0",
                      cursor: presetsBusy ? "default" : "pointer",
                    },
                  },
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
                        setActivePrompts(next);
                      },
                    }),
                    // 名字占满剩余宽度。
                    // ⚠️ 这里原来还跟了 `order 950` 和 `1 tokens` —— 用户明确说
                    //    不要。勾选清单只回答「哪几条生效」，order / token 数
                    //    在下面「个人提示词」的卡片详情里本来就有。
                    react.createElement(
                      "span",
                      {
                        key: "n",
                        style: Object.assign({}, CARD_TITLE, {
                          flex: "1 1 auto",
                          fontSize: "13px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }),
                      },
                      p.name || p.id,
                    ),
                  ],
                ),
              );
            })(ordered[oi]);
          }

          return react.createElement(
            "div",
            {
              key: "grid",
              style: {
                display: "grid",
                // 两列：库大了不至于拉成一条长龙；列宽自适应，窄屏自动收成一列
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "8px 18px",
              },
            },
            rows,
          );
        }

        /**
         * 总开关那一块 —— 组件在 client.editor.switch.js 里。
         *
         * 这里只负责把宿主给的 api 交给它、把「当前开没开」递进去。
         *
         * ⚠️ **状态仍留在本组件**（enabledDraft / toggleEnabled）—— 拨开关会牵动
         *    load()，而且测试是按 hook 下标塞状态的，把状态搬走会让所有按索引
         *    塞状态的地方错位。所以这一步只搬**渲染**。
         */
        function renderMasterSwitch() {
          var C = props && props.MasterSwitch;
          if (!C) return null;
          return react.createElement(C, {
            enabled: enabledDraft,
            busy: enabledDraft === null,
            onToggle: toggleEnabled,
          });
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
        /**
         * 提示词组合 —— **一整张卡片**：标题就是「你现在在哪套配置上」。
         *
         * 结构（用户定的）：
         *     标题（预设名 / 未保存的配置）+ ✎      [预设下拉] [保存] [重新读取]
         *     ─────────────────────────────────────────────────────
         *     ☐ 提示词 …  ☐ 提示词 …        ← 勾选就是在改当前这套
         *
         * 为什么是这个形状：
         *   · 预设 = 一套配置的**名字**。所以它该是这张卡片的**标题**，
         *     而不是别处的一个按钮 —— 一眼就知道自己在哪套上。
         *   · 勾选 = 改这套配置。改完按 [保存] 落盘；换一套用下拉。
         *   · 以前把「选哪些」和「预设」拆成两张卡片、外加一排胶囊，
         *     同一件事在三处出现，用户问「你为什么要做到那么麻烦」。
         */
        /**
         * 提示词组合 —— **一整张卡片**：标题就是「你现在在哪套配置上」。
         *
         *     写代码 ✎  全局默认 · 所有会话   已选 2 条  [写代码 ▾] [保存] [↻]
         *     ─────────────────────────────────────────────────────────────
         *     ☐ 格式契约  order 9500  1200 tokens
         *     ☐ 编码规范  order 950    300 tokens
         *
         * ⚠️ 头和体在**同一张卡片**里。这里踩了两次，都记下：
         *    1) 外面单独一行标题、下面再套一张卡片 → 三层结构；
         *    2) 下拉和保存留在卡片**外面** → 用户要的「卡片顶部」没做到
         *       （他的原话：「下拉框和保存不都说是卡片顶部了吗」）。
         */
        function renderCombo() {
          var matched = presetsData && presetsData.matched ? presetsData.matched.global : null;
          var list = (presetsData && presetsData.presets) || [];
          var currentId = matched ? matched.id : "";
          var currentName = matched ? matched.name : "未保存的配置";
          var bus = presetsBusy || !presetsData;

          // ⚠️ 这里原来先算了一遍「已选 N 条 · 共 X tokens」给卡片头用。
          //    用户说那些数字不需要，头里就不显示了 —— 计算也跟着删掉，
          //    免得留一段没人读的死代码。

          // 标题：预设名 + 改名铅笔；改名时就地变输入框
          var titleNode;
          if (renaming) {
            titleNode = react.createElement("input", {
              key: "rn",
              type: "text",
              className: "pm-input",
              style: Object.assign({}, SELECT_SM, { maxWidth: "200px" }),
              value: renameDraft,
              autoFocus: true,
              disabled: presetsBusy,
              onChange: function (ev) {
                setRenameDraft(ev.target.value);
              },
              onKeyDown: function (ev) {
                if (ev.key === "Enter") commitRename();
                if (ev.key === "Escape") setRenaming(false);
              },
              onBlur: function () {
                setRenaming(false);
              },
            });
          } else {
            titleNode = react.createElement(
              "span",
              { key: "t", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) },
              currentName,
            );
          }

          var head = react.createElement(
            "div",
            {
              style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
                flexDirection: "row",
                minHeight: "0",
                padding: "10px 14px",
                gap: "8px",
              }),
            },
            [
              // ⚠️ 这里**只有「当前配置名」**，没有功能标题。
              //
              //    「提示词组合」是**区块标题**，在卡片外面、跟「个人提示词」
              //    「系统提示词」同一套样式（见 renderCombo 末尾的 headLine）。
              //    卡片头这一行的语义是「你现在在哪套配置上」——
              //    塞个静态标题进来会把两件事混在一行。
              //    （踩过两轮：先是把区块标题整个换成预设名 → 标题没了；
              //      再把标题塞进卡片头 → 用户说「为什么功能标题在卡片顶部」。）
              titleNode,
              // 改名铅笔：只有「当前这套是一条真预设」时才有意义
              currentId && !renaming
                ? react.createElement(
                    "button",
                    {
                      key: "pen",
                      type: "button",
                      className: "pm-btn",
                      style: Object.assign({}, DETAIL_BTN, { padding: "1px 6px" }),
                      disabled: bus,
                      title: "改这套预设的名字",
                      onClick: function () {
                        setRenaming(true);
                        setRenameDraft(currentName);
                      },
                    },
                    "✎",
                  )
                : null,
              react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
              // ⚠️ 这里原来还有两样，都删了：
              //    · 「全局默认 · 所有会话」——作用范围当时是因为这一块**没有**
              //      功能标题，得靠它说明自己是什么；现在标题回来了，它是纯噪音；
              //    · 「已选 N 条 · 共 X tokens」——勾选框自己会说，数字没人看。
              // 预设下拉：换一套
              react.createElement(
                "select",
                {
                  key: "sel",
                  className: "pm-input",
                  style: SELECT_SM,
                  disabled: bus,
                  value: currentId,
                  title: list.length === 0 ? "还没有预设 —— 勾好之后点「保存」存一套" : "换一套配置",
                  onChange: function (ev) {
                    var id = ev.target.value;
                    if (id) applyPreset(id);
                  },
                },
                [
                  // 手改过（没匹配上任何预设）时给个占位项，否则 select 会跳到第一条
                  currentId
                    ? null
                    : react.createElement("option", { key: "__none", value: "" }, "未保存的配置"),
                  list.length === 0
                    ? react.createElement("option", { key: "__empty", value: "" }, "（还没有预设）")
                    : null,
                  list.map(function (p) {
                    return react.createElement("option", { key: p.id, value: p.id }, p.name);
                  }),
                ],
              ),
              // 保存：当前这套有名字就覆盖它自己，没名字就存新的
              react.createElement(
                "button",
                {
                  key: "sav",
                  type: "button",
                  className: "pm-btn",
                  style: bus ? BTN_BUSY : BTN,
                  disabled: bus,
                  title: currentId
                    ? "把当前勾选覆盖到预设「" + currentName + "」"
                    : "把当前勾选存成一套新预设",
                  onClick: function () {
                    savePreset();
                  },
                },
                presetsBusy ? "保存中…" : "保存",
              ),
              react.createElement(
                "button",
                {
                  key: "r",
                  type: "button",
                  className: "pm-btn",
                  style: bus ? BTN_BUSY : BTN,
                  disabled: bus,
                  title: "重新从盘上读一遍",
                  onClick: function () {
                    loadPresets();
                  },
                },
                "↻",
              ),
            ],
          );

          var bodyNode = react.createElement(
            "div",
            { key: "body", style: CARD_DETAILS },
            presetsData
              ? renderPickerBody()
              : react.createElement("div", { style: STATUS_LINE }, "读取中…"),
          );

          // ⚠️ 区块标题在**卡片外面**，跟「个人提示词」「系统提示词」同一套样式
          //    （CARD_HEADING + 同一组间距）。
          //
          //    这里的两次返工值得记：先是把区块标题整个换成预设名（标题没了），
          //    再把标题塞进卡片头（用户说「为什么功能标题在卡片顶部」）。
          //    结论：**区块标题归区块，卡片头归卡片头** ——
          //    标题说明「这块干什么」，卡片头说明「当前在哪套配置上」。
          var headLine = react.createElement(
            "div",
            { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
            [react.createElement("span", { key: "n", style: HEADING_TITLE }, "提示词组合")],
          );

          // ⚠️ 卡片是独立一层，**不带 marginTop**（标题那行已经给了间距）。
          return react.createElement("div", null, [
            headLine,
            react.createElement(
              "div",
              { key: "card", style: CARD },
              [head, bodyNode],
            ),
          ]);
        }

        /**
         * 换一套：应用预设（把它的内容写回**全局层**）。
         *
         * ⚠️ 不需要传「写到哪一层」—— 应用是**写回预设自己那一层**
         *    （预设里存着 scope），后端按预设的 scope 决定。面板这边
         *    只能存全局预设，所以永远写全局层。
         */
        function applyPreset(id) {
          doPreset({ action: "apply", id: id });
        }

        /**
         * 保存当前勾选。
         *
         * ⚠️ 当前这套**已经有名字**时是**覆盖它自己**，不是又存一份同名的 ——
         *    同名会让列表里堆一串「写代码」「写代码 2」「写代码 3」。
         *    覆盖走同一条 save（同名 → presetId 命中同一条）。
         */
        function savePreset() {
          var matched = presetsData && presetsData.matched ? presetsData.matched.global : null;
          if (matched) {
            doPreset({ action: "save", name: matched.name, scope: "global" });
            return;
          }
          var name = presetName.trim();
          if (!name) {
            flash("先给它起个名字");
            setRenaming(true);
            setRenameDraft("");
            return;
          }
          doPreset({ action: "save", name: name, scope: "global" }).then(function () {
            setPresetName("");
          });
        }

        /** 改名：把当前这条预设换个名字（id 跟着变，所以要跟着更新选中）。 */
        function commitRename() {
          var next = renameDraft.trim();
          setRenaming(false);
          if (!next) return;
          var matched = presetsData && presetsData.matched ? presetsData.matched.global : null;
          if (!matched || matched.name === next) return;
          doPreset({ action: "rename", id: matched.id, name: next });
        }

        /**
         * 「?」图标。
         *
         * ⚠️ 它归 client.editor.switch.js（跟总开关一起搬出去了），但本文件里
         *    三处要用 —— 所以这里**优先用宿主递进来的**（props.helpIcon），
         *    没有就先用 switch chunk 自己的那一份。
         *
         *    为什么要兜底：宿主那边是异步等两个 chunk 都到了才渲染本组件的，
         *    但**测试**里是直接造本组件、不过宿主 —— 只认 props 的话会直接抛
         *    「props.helpIcon is not a function」。宁可少一个图标，也不要整块崩。
         */
        function helpIcon(text) {
          var fn = props && props.helpIcon;
          return fn ? fn(text) : null;
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
          react.createElement("div", { key: "sections" },
            /**
             * 「系统提示词」整块 —— 渲染在 client.editor.sections.js 里。
             *
             * props 全从这边递：**状态留在本组件**（sections / openSection /
             * sectionDrafts），测试按 hook 下标塞状态，搬走会让按索引塞状态的
             * 地方全错位。这一块只搬了渲染。
             */
            props.SectionsBlock
              ? react.createElement(props.SectionsBlock, {
                  sections: sections,
                  sectionsBusy: sectionsBusy,
                  openSection: openSection,
                  setOpenSection: setOpenSection,
                  sectionDrafts: sectionDrafts,
                  setSectionDrafts: setSectionDrafts,
                  applySection: applySection,
                  loadSections: loadSections,
                  helpIcon: helpIcon,
                })
              : null,
          ),
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
        //
        // ── 页头 + 间距 ────────────────────────────────────────────────────
        //
        // 页头（标题 + 一句话说明）放**最前**，跟 dsh 其它设置页同一套。
        // 参照物是模型页（`ModelsSection`）：
        //
        //     <div className={css.section}>        // max-width:720px; column; gap:12px
        //       <h2 className={css.title}>…</h2>   // margin:0; 16px/500
        //       <p  className={css.intro}>…</p>    // margin:0; 14px
        //       <ul className={css.rows}>…</ul>    // margin:12px 0 0
        //     </div>
        //
        // 于是两档距离的**具体数值**是：
        //   · **功能 ↔ 功能** = 父级 gap = **12px**；
        //   · **页头 ↔ 第一个功能** = gap + 内容块自带的 margin-top = **24px**。
        // 这就是「页头离功能远一点、功能之间近一点」的来源 ——
        // 不是拍脑袋定的，是照抄参考页。
        // 第一个功能块外面套一层只负责 margin 的 div。
        // ⚠️ 不用 `react.cloneElement`（测试的 react 替身里没有它，真机才需要那种写法）；
        //    而且这里也不需要克隆 —— 包一层更直白，也不改原块的 key。
        var spaced = body.slice();
        if (spaced.length > 0) {
          spaced[0] = react.createElement(
            "div",
            { key: "gap-before-first", style: { marginTop: "12px" } },
            spaced[0],
          );
        }
        return react.createElement("div", { style: SECTION }, [PAGE_HEAD].concat(spaced));
      }

      /**
       * 页头：标题 + 一句话说明。
       *
       * 字号照抄参考页：模型页 title 是 16/500、插件页 heading 是 18/600 ——
       * 我们按插件页（原来就住在那一页里）。说明用 label-tertiary + 13px。
       * 标题和说明之间 4px：比「页头↔功能」那 24px 近得多，读起来是一块。
       */
      var PAGE_HEAD = react.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "4px" } },
        [
          react.createElement(
            "h2",
            { key: "t", style: { margin: "0", fontSize: "18px", fontWeight: "600" } },
            "提示词管理",
          ),
          react.createElement(
            "p",
            {
              key: "i",
              style: {
                margin: "0",
                fontSize: "13px",
                lineHeight: "20px",
                color: "var(--dsw-alias-label-tertiary, inherit)",
              },
            },
            "给每个会话挑一套提示词：选哪几条生效、存成预设随时切换，也能改写 dsh 的原生段落。",
          ),
        ],
      );

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
