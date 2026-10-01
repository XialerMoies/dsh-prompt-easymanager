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

      // ⚠️ 这里原来有 **27 个本地样式常量副本**（233 行）。它们跟宿主那份
      //    **逐字相同**（唯一不同的 CARDS_GRID 是个没人用的死常量）——
      //    而 render 函数搬进 chunk 之后，样式引用也跟着走了，24 个删完根本
      //    没人读。现在样式的**唯一来源是 api.style**（顶部那批声明），
      //    不再有「同名声明两遍、靠顺序决定谁生效」。
      //    要改样式改 client.js 里那 56 个常量，别在这儿再加副本。

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
          body.push(
            react.createElement("div", { key: "combo" },
              /**
               * 「提示词组合 + 预设」整块 —— 渲染在 client.editor.combo.js 里。
               *
               * props 全从这边递：**状态和动作都留在本组件**（presetsData /
               * presetsBusy / presetName / renaming / renameDraft，以及
               * doPreset / applyPreset / savePreset / commitRename /
               * setActivePrompts / loadPresets / flash）—— 它们跟 /defaults、
               * /presets、/edit 几条接口的数据流缠在一起，而且测试按 hook 下标
               * 塞状态，搬走会让按索引塞状态的地方全错位。这一块只搬了渲染。
               */
              props.ComboBlock
                ? react.createElement(props.ComboBlock, {
                    presetsData: presetsData,
                    presetsBusy: presetsBusy,
                    prompts: prompts,
                    renaming: renaming,
                    renameDraft: renameDraft,
                    setRenaming: setRenaming,
                    setRenameDraft: setRenameDraft,
                    presetName: presetName,
                    setPresetName: setPresetName,
                    loadPresets: loadPresets,
                    flash: flash,
                    doPreset: doPreset,
                    setActivePrompts: setActivePrompts,
                  })
                : null,
            ),
          );


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
          body.push(
            /**
             * 「个人提示词」整块 —— 渲染在 client.editor.library.js 里。
             *
             * props 全从这边递：**状态和动作都留在本组件**（prompts / busy /
             * edit / openId / closedCats / message / err，以及 send / load）——
             * 它们跟 /state、/edit、/reload 几条接口的数据流缠在一起，而且测试按
             * hook 下标塞状态，搬走会让按索引塞状态的地方全错位。本块只搬渲染。
             */
            props.LibraryBlock
              ? react.createElement(props.LibraryBlock, {
                  prompts: prompts,
                  busy: busy,
                  edit: edit,
                  openId: openId,
                  closedCats: closedCats,
                  builtinCategories: builtinCategories,
                  customCategories: customCategories,
                  message: message,
                  err: err,
                  send: send,
                  setEdit: setEdit,
                  setOpenId: setOpenId,
                  setClosedCats: setClosedCats,
                  load: load,
                })
              : null,
          );
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
