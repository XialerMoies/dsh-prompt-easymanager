// 提示词管理 (dsh-prompt-manager) · 客户端宿主
//
// 这个文件现在只做三件事：
//   1. 把两个槽位注册给宿主（会话头部入口 / 设置页那一栏）
//   2. 渲染会话头部那一个按钮本身
//   3. 用具名 chunk 把大块 UI 按需拉起来
//
// 组件在哪儿：
//   client.helpers.js   原生段落中文名 + fmtTokens（纯函数，无 React）
//   client.picker.js    多选面板 + 会话头部入口
//   client.preview.js   最终系统提示词预览
//   client.editor.js    设置页「提示词管理」整栏（最大的一块）
//
// 浮层外壳（Overlay + OVERLAY / PANEL 那一族常量）没有独立 chunk：
// 面板和预览各自在里面定义同一个 Overlay 组件，常量则从这里随 api.style 交下去。
// 原文备查见 docs/overlay-component.md。
//
// ── 为什么样式常量留在这个文件 ────────────────────────────────────────────────
// 宿主自己渲染会话头部那一个按钮，**注册期**就得有；而 chunk 是异步到的，等不了。
// 所以这一批留在宿主，给 chunk 用的那几个纯函数通过 CHUNK_API 传过去 ——
// 同一个东西在几个文件里各写一份，迟早改一处漏一处。
//
// ── 三条踩过的坑，别再踩 ──────────────────────────────────────────────────────
// ⚠️ chunk 的注册键必须写全："<包名>/<chunk 文件名>"。
//    register() 拿 id 去掉结尾的 /client 当 ownerId，再拼上 chunk 字段；
//    importChunk 找的正是 ownerId + "/" + 文件名。写短了会在**运行时**报
//    「bundle loaded without registering」，不是构建期。
//
// ⚠️ dsh.client.external 帮不上忙：那里列的名字必须是**别的包**的 boot row，
//    写本包的文件名会被判成「本包要求自己」，构建期直接抛错。
//    官方 dsh-client-ui-sidebar-documentpreview 的 client.pdf.js 也是按需拉的。
//
// ⚠️ chunk 的 rev 跟着 **client.js 的 mtime** 走。改完 chunk 必须重启 dsh，
//    否则浏览器拿着旧 rev 请求，文件对不上就是 404，表现是设置页整片空白。
//
// ⚠️ 浮层必须 portal 到 document.body —— 渲染在会话头部那一行里面的话，
//    position:fixed 会被祖先的 transform/overflow/contain 关住而**完全看不见**
//    （点击有响应、fetch 也成功，但画面上什么都没有）。
//    一方插件（dsh-client-ui-attachment、dsh-client-ui-chat）都这么做的。
//
// ⚠️ 所有 style 常量必须有定义。读一个从未声明的标识符会抛 ReferenceError
//    （不是静默的 undefined），React 随即卸载整棵子树 —— 表现就是
//    「点了之后所有控件消失」。scripts/client_render_test.mjs 有静态扫描盯着这点。
//
// 渲染期对数据必须容错：数组里的 null 项、缺字段，都不能让渲染抛错。

(() => {
  try {
    // ── chunk 的加载器 ──────────────────────────────────────────────────────
    //
    // ⚠️ 必须放在 factory **外面**（模块级，每个文件只求值一次）。
    //    useChunk 拿 loader 当缓存键；loader 每次渲染都新建的话，
    //    缓存永远 miss，每次都重新 await 一个 Promise —— 组件就一直抛，
    //    表现是「那一栏一直是空的」，而且不报错。
    //
    // ⚠️ require.async 收的是**相对说明符**（"./client.xxx.js"），不是注册键。
    //    注册键 "dsh-prompt-manager/client.xxx.js" 由 importChunk 自己拼：
    //      ownerId = 本包 id 去掉结尾的 /client  →  "dsh-prompt-manager"
    //      key     = ownerId + "/" + 文件名
    //    一开始这里写成了完整注册键，被 `if (!spec.startsWith("./"))` 当成
    //    「别的包」去 import，找不到 —— chunk 永远拉不起来。
    //    （scripts/client_render_test.mjs 复刻了同一条规则，抓住了它。）
    var loadHelpers = function () { return req.async("./client.helpers.js"); };
    var loadPicker = function () { return req.async("./client.picker.js"); };
    var loadPreview = function () { return req.async("./client.preview.js"); };
    var loadEditor = function () { return req.async("./client.editor.js"); };

    // 宿主的 module-table require（就是 factory 的那个参数）。见下方 factory 开头。
    var req = null;

    // chunk 缓存：loader → { p, m, e, done }
    var chunkCache = new Map();

    /**
     * 取一个 chunk（Suspense 风格：没到就抛 Promise，到了就返回模块）。
     *
     * ⚠️ 别把状态挂在 useState 的初值上再改它 —— 那条路是看运气的：
     *    `useState(loader)` 每次渲染都返回**新**对象，没有 `.s`，
     *    于是「首次进入」永远不成立，chunk 根本没被拉起来。
     *    （调试时 `box.s === 0` 恒为 false，就是栽在这。）
     *
     * 这里的键是 loader 本身 —— 上面那几个常量函数，每次渲染引用相同，
     * 所以命中与否只取决于「拉过没有」，跟渲染次数、时序都无关。
     */
    function useChunk(loader) {
      var box = chunkCache.get(loader);
      if (box === undefined) {
        box = { p: null, m: null, e: null, done: false };
        chunkCache.set(loader, box);
        box.p = loader().then(
          function (m) {
            box.m = m;
            box.done = true;
            return m;
          },
          function (e) {
            box.e = e;
            box.done = true;
            throw e;
          },
        );
      }
      if (!box.done) throw box.p; // 等这个 Promise 落地后重试
      if (box.e) throw box.e;
      return box.m;
    }

    window.__ModuleLoader__.load({
      id: "dsh-prompt-manager",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        // factory 只被材料化一次，在这里把 require 交给模块级的加载器。
        req = require;

        var react = require("react");
        var reactDom = require("react-dom");

        var inject = ["slots"];

        // ── 会话头部那一个按钮 + 它要用的样式 ────────────────────────────────
        var ROW = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "none" };
        var BTN = {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 6px",
          borderRadius: "5px",
          border: "1px solid rgba(128,128,128,.35)",
          background: "transparent",
          color: "inherit",
          fontFamily: "inherit",
          fontSize: "11px",
          lineHeight: "16px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          flex: "none",
        };
        var BTN_BUSY = Object.assign({}, BTN, { opacity: 0.55, cursor: "default" });
        var BTN_ERR = Object.assign({}, BTN, { borderColor: "rgba(239,68,68,.85)" });
        // ── 「系统提示词」段落卡片用的样式 ──────────────────────────────────
        // 跟上面同风格：都从 BTN 派生，只改需要改的那一项。
        var BTN_PRIMARY = Object.assign({}, BTN, {
          borderColor: "var(--dsw-alias-state-business-primary, rgba(59,130,246,.7))",
          color: "var(--dsw-alias-state-business-primary, #3b82f6)",
        });
        var BTN_DANGER = Object.assign({}, BTN, {
          borderColor: "var(--dsw-alias-state-error-primary, rgba(239,68,68,.6))",
          color: "var(--dsw-alias-state-error-primary, #ef4444)",
        });
        var ACTIONS = {
          display: "flex",
          gap: "6px",
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: "8px",
        };
        /** 段落卡片标题右侧的小徽章。 */
        var BADGE = {
          flex: "none",
          fontSize: "10.5px",
          lineHeight: "16px",
          padding: "0 6px",
          borderRadius: "999px",
          border: ".5px solid transparent",
          whiteSpace: "nowrap",
        };
        var BADGE_WARN = Object.assign({}, BADGE, {
          borderColor: "rgba(245,158,11,.7)",
          background: "rgba(245,158,11,.12)",
          color: "#b45309",
        });
        var BADGE_OK = Object.assign({}, BADGE, {
          borderColor: "rgba(16,185,129,.6)",
          background: "rgba(16,185,129,.12)",
          color: "#047857",
        });
        var BADGE_OFF = Object.assign({}, BADGE, {
          borderColor: "rgba(128,128,128,.5)",
          background: "rgba(128,128,128,.14)",
          color: "var(--dsw-alias-label-secondary, inherit)",
        });
        var BADGE_MUTED = Object.assign({}, BADGE, {
          borderColor: "var(--dsw-alias-border-l2, rgba(128,128,128,.3))",
          color: "var(--dsw-alias-label-tertiary, inherit)",
        });
        /** 段落正文的只读显示。 */
        var PRE = {
          fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
          fontSize: "11.5px",
          lineHeight: "1.6",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "260px",
          overflow: "auto",
          margin: "0",
          padding: "8px 10px",
          borderRadius: "var(--dsw-radius-sm, 4px)",
          background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,.16))",
          border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
          color: "var(--dsw-alias-label-secondary, inherit)",
        };
        var TEXTAREA = Object.assign({}, PRE, {
          width: "100%",
          minHeight: "180px",
          resize: "vertical",
          boxSizing: "border-box",
        });
        /** 说明性小字（跟 HINT 同色，但不带内边距那套容器样式）。 */
        var HINT_TEXT = {
          fontSize: "11.5px",
          lineHeight: "17px",
          color: "var(--dsw-alias-label-tertiary, inherit)",
          margin: "2px 0 8px",
        };
        /**
         * 卡片正文区**之外**的提示框（漂移提醒 / 失效说明）的外层。
         *
         * ⚠️ 这些框是直接塞进卡片的（不在 CARD_DETAILS 里），而 WARN 自身没有水平外边距
         *    —— 套一层这个，否则提示框会紧贴卡片左右边框。
         *    内边距跟卡片头（CARD_HEAD 的 12px 14px）保持一致。
         */
        var CARD_NOTICE = { padding: "10px 14px" };
        /**
         * 浮层外壳 + 面板骨架。
         *
         * 面板和预览两个 chunk 都要用（各自在里面定义同一个 Overlay 组件），
         * 所以这几个常量只能住在这里，随 api.style 交下去。
         *
         * ⚠️ **浮窗背景必须用 dsh 的主题变量，而且兜底值不能写死深色。**
         *
         * 真机上踩过：这里原来写的是 `var(--dsh-surface, #1e1e1e)` ——
         *   · `--dsh-surface` 这个变量**在 dsh 里根本不存在**（全树 0 次出现），
         *     正确的命名空间是 `--dsw-alias-*`（本文件其它地方用的都是它）
         *   · 兜底 `#1e1e1e` 是写死的深色
         * 两个错叠在一起 → 变量永远取不到 → 浮窗**永远是深色**。
         * 用户是在远程访问（本机主题深色、远端浅色）时发现的。
         *
         * 最后一层兜底用 CSS 系统色 `Canvas` —— 它跟着浏览器/系统主题走，
         * 比写死一个颜色安全得多。
         */
        var OVERLAY = {
          position: "fixed",
          inset: "0",
          // 遮罩用 dsh 自己的 mask 变量 —— 深色遮罩在明暗两种主题下都是惯例，
          // 所以这里保留一个 rgba 兜底是安全的（不像浮窗背景必须跟着主题）。
          background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45))",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        };
        var PANEL = {
          background: "var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2, Canvas))",
          color: "var(--dsw-alias-label-primary, CanvasText)",
          border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
          borderRadius: "8px",
          maxWidth: "860px",
          width: "100%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,.28)",
          fontFamily: "inherit",
          fontSize: "12px",
        };
        var PANEL_SM = Object.assign({}, PANEL, { maxWidth: "560px" });
        var PANEL_HEAD = {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(128,128,128,.25)",
        };
        var PANEL_BODY = { padding: "10px 12px", overflow: "auto", flex: "1 1 auto" };
        var PANEL_FOOT = {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 12px",
          borderTop: "1px solid rgba(128,128,128,.25)",
          flexWrap: "wrap",
        };
        var PILL_SWITCH = {
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          width: "34px",
          height: "20px",
          borderRadius: "999px",
          border: "1px solid rgba(128,128,128,.4)",
          background: "rgba(128,128,128,.22)",
          cursor: "pointer",
          padding: "0",
          flex: "none",
          transition: "background .15s ease",
        };
        var PILL_ON = Object.assign({}, PILL_SWITCH, {
          background: "var(--dsw-alias-state-business-primary, rgba(59,130,246,.85))",
          borderColor: "transparent",
        });
        var PILL_OFF = PILL_SWITCH;
        var PILL_KNOB = {
          position: "absolute",
          top: "2px",
          left: "2px",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
          transition: "transform .15s ease",
        };

        var helpersBox = useChunk(loadHelpers);

        // 交给 chunk 的那一份：宿主独有的东西（注册期就存在、chunk 等不到）
        // 全部显式列在这里，chunk 那边 create(api) 解构回去。
        var CHUNK_API = {
          style: {
            ROW: ROW,
            BTN: BTN,
            BTN_BUSY: BTN_BUSY,
            BTN_ERR: BTN_ERR,
            BTN_PRIMARY: BTN_PRIMARY,
            BTN_DANGER: BTN_DANGER,
            ACTIONS: ACTIONS,
            BADGE: BADGE,
            BADGE_WARN: BADGE_WARN,
            BADGE_OK: BADGE_OK,
            BADGE_OFF: BADGE_OFF,
            BADGE_MUTED: BADGE_MUTED,
            PRE: PRE,
            TEXTAREA: TEXTAREA,
            HINT_TEXT: HINT_TEXT,
            CARD_NOTICE: CARD_NOTICE,
            OVERLAY: OVERLAY,
            PANEL: PANEL,
            PANEL_SM: PANEL_SM,
            PANEL_HEAD: PANEL_HEAD,
            PANEL_BODY: PANEL_BODY,
            PANEL_FOOT: PANEL_FOOT,
            PILL_SWITCH: PILL_SWITCH,
            PILL_ON: PILL_ON,
            PILL_OFF: PILL_OFF,
            PILL_KNOB: PILL_KNOB,
          },
          label: helpersBox.sectionLabel,
          mode: helpersBox.MODE_LABEL,
          tokens: helpersBox.fmtTokens,
          route: helpersBox,
        };

        /**
         * 会话头部那一份：多选面板 + 预览面板一起备好。
         *
         * ⚠️ 这两块必须**一起**拉，不能各拉各的。
         *    多选面板里点「预览」会直接渲染 PreviewPanel（面板是常驻的，
         *    预览是弹层，两者同一个 React 树）—— 只拉面板的话，点预览那一刻
         *    就是 `PreviewPanel is not defined`，而且是**点了才炸**：
         *    React 随即卸载整棵子树，看起来就是「点了预览之后控件全没了」。
         *
         *    预览那一份在这里就解出来，随 props 交给面板；面板自己不做异步 ——
         *    chunk 之间的依赖全收在宿主这一层，哪块依赖哪块一眼可见。
         */
        function loadPromptUi() {
          // 预览先、面板后：面板要用到一个现成的 PreviewPanel（见上面那段注释）。
          return loadPreview().then(function (previewMod) {
            return loadPicker().then(function (pickerMod) {
              return {
                PreviewPanel: previewMod.PreviewPanel,
                PromptPicker: pickerMod.PromptPicker,
              };
            });
          });
        }

        /** 会话头部的入口 —— 同步渲染，按钮本身不依赖任何 chunk。 */
        function HeaderSlot(props) {
          var ui = useChunk(loadPromptUi);
          return react.createElement(ui.PromptPicker, Object.assign({}, props, { PreviewPanel: ui.PreviewPanel }));
        }

        /** 设置页那一栏。 */
        function EditorSlot() {
          var m = useChunk(loadEditor);
          if (!m.box) m.box = m.create(CHUNK_API);
          m.box.installStyles();
          return react.createElement(m.box.PromptEditor, null);
        }

        function apply(ctx) {
          // 会话头部：每个会话的多选器
          ctx.slots.inject("conversation.session.header.actions", () =>
            ctx.slots.register(
              { name: "conversation.session.header.actions", id: "prompt-picker", order: 40 },
              HeaderSlot,
            ),
          );
          // 设置 → 插件 → 提示词管理（root 作用域）
          ctx.slots.inject("settings.plugins.tab", () =>
            ctx.slots.register(
              {
                name: "settings.plugins.tab",
                id: "prompt-manager",
                order: 40,
                label: () => "提示词管理",
              },
              EditorSlot,
            ),
          );
        }

        exports.name = "dsh-prompt-manager";
        exports.inject = inject;
        exports.apply = apply;
        exports.ROUTES = {
          ROUTE_STATE: helpersBox.ROUTE_STATE,
          ROUTE_ASSIGN: helpersBox.ROUTE_ASSIGN,
          ROUTE_PREVIEW: helpersBox.ROUTE_PREVIEW,
          ROUTE_RELOAD: helpersBox.ROUTE_RELOAD,
          ROUTE_DEFAULTS: helpersBox.ROUTE_DEFAULTS,
          ROUTE_EDIT: helpersBox.ROUTE_EDIT,
        };
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[AI Client Sandbox] dsh-prompt-manager runtime error:", err);
  }
})();
