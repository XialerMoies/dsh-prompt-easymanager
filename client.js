// 提示词管理 (dsh-prompt-manager) · 客户端宿主
//
// 这个文件只做三件事：注册两个槽位、渲染会话头部那一个按钮、按需拉下面的 chunk。
//
//   client.picker.js    多选面板 + 会话头部入口
//   client.preview.js   最终系统提示词预览
//   client.editor.js    设置页「提示词管理」整栏（最大的一块）
//
// 浮层外壳（Overlay + OVERLAY / PANEL 那一族常量）没有独立 chunk：面板和预览
// 各自定义同一个 Overlay 组件，常量从这里随 api.style 交下去。原文见
// docs/overlay-component.md。
//
// 各处的坑写在**挨着代码的地方**，不堆在这儿 —— 头注释写得越长越没人看。

(() => {
  try {
    // ── 共用常量与小工具（模块级）──────────────────────────────────────────
    //
    // ⚠️ 只能同步定义在模块级，不能做成 chunk：factory 是同步的，在里面等 Promise
    //    就等于抛异常，宿主报 `import failed: [object Promise]`；而且
    //    `fmtTokens(p.tokens)` 是当函数调的，拿不到就是 undefined is not a function。
    //    这里曾经是一个独立的 client.helpers.js —— 别改回去。
    const ROUTE_STATE = "/api/prompt-manager/state";
    const ROUTE_ASSIGN = "/api/prompt-manager/assign";
    const ROUTE_PREVIEW = "/api/prompt-manager/preview";
    const ROUTE_RELOAD = "/api/prompt-manager/reload";
    const ROUTE_DEFAULTS = "/api/prompt-manager/defaults";
    const ROUTE_EDIT = "/api/prompt-manager/edit";
    const ROUTE_SECTIONS = "/api/prompt-manager/sections";
    const ROUTE_PRESETS = "/api/prompt-manager/presets";
    /** 原生段落的中文显示名。⚠️ **只用于显示**，存储/匹配一律用原始 name。 */
    const SECTION_LABELS = {
      "harness:identity": "harness 身份",
      "harness:source": "Harness 安装位置",
      "deployment:persona-prefix": "部署人设 · 前",
      "deployment:persona-suffix": "部署人设 · 后",
      "plan:policy": "计划策略",
      "team:policy": "团队策略",
      // PTC = Programmatic Tool Calling。官方 preset 的原文：
      //   "PTC means Programmatic Tool Calling. In this built-in preset, the agent
      //    uses run_code to write a TypeScript program that calls tools..."
      // 这一段只在 PTC 模式下有正文，其余模式返回空串。
      "tools:ptc-only": "编程式工具调用 · 约束",
      "tools:sdk": "编程式工具调用 · SDK",
      "context:file-reference": "文件引用",
      "mcp-resource-servers": "MCP 资源服务器",
      "ui:deliverable-file-references": "交付物文件引用",
      "app:web-surface": "网页界面",
    };
    /** `tool:xxx` 里 xxx 的中文。查不到就用原文。 */
    const TOOL_LABELS = {
      bash: "bash",
      read: "读文件",
      write: "写文件",
      edit: "改文件",
      glob: "找文件",
      grep: "搜内容",
      pwsh: "命令行",
      web_search: "联网搜索",
      web_fetch: "抓网页",
      jobs: "后台任务",
      goal: "目标",
      workflow: "工作流",
      // 实测存在的名字（2026-09 按真机列表核对）：我一开始漏了 `subagent_fork`，
      // 于是它一路走兜底显示成「subagent · fork」。
      subagent: "子代理",
      subagent_fork: "子代理 · 派生",
      report: "汇报",
      "computer-use": "电脑操作",
    };
    /** 段落的中文显示名。永远只用于显示。 */
    function sectionLabel(name) {
      if (typeof name !== "string" || name === "") return "";
      if (SECTION_LABELS[name]) return SECTION_LABELS[name];
      if (name.startsWith("tool:")) {
        const key = name.slice(5);
        // 「工具用法 · 读文件」比「工具 · 读文件 用法」顺 —— 后缀吊在最后读着断句很怪。
        return "工具用法 · " + (TOOL_LABELS[key] || key);
      }
      if (name.startsWith("mcp:")) return "MCP · " + name.slice(4);
      // ⚠️ 插件**自己注入**的段落也会出现在这个列表里（比如 prompt-manager:infinite-gen-3）。
      //    这是修「列表只有全局层」那个 bug 之后的必然结果 —— 带 scope 读就看得见自己。
      //    标成「本插件注入」是**故意的**：它跟原生段落不是一回事，用户要能一眼分出来。
      if (name.startsWith("prompt-manager:")) return "本插件注入 · " + name.slice(16);
      // 兜底：把分隔符换成人话，别原样甩一串英文键名
      return name.replace(/[:_-]+/g, " · ");
    }

    // v0.2.2 起没有 replace 模式了（见 prompt-library.mjs 顶部说明）
    const MODE_LABEL = { none: "不注入", append: "追加" };

    function fmtTokens(n) {
      return String(n || 0) + " tokens";
    }

    // ── chunk 的加载器（模块级，只求值一次）────────────────────────────────
    //
    // loader 是 useChunk 的缓存键，每次渲染都新建的话缓存永远 miss ——
    // 组件会一直抛 Promise，表现是「那一栏一直是空的」且不报错。
    //
    // require.async 收的是相对说明符（"./client.xxx.js"），**不是**注册键
    // "dsh-prompt-manager/client.xxx.js" —— 那个是 importChunk 自己拼的。
    var loadPicker = function () { return req.async("./client.picker.js"); };
    var loadPreview = function () { return req.async("./client.preview.js"); };
    var loadEditor = function () { return req.async("./client.editor.js"); };

    var req = null; // factory 的材料化参数，见下面 factory 开头

    // chunk 缓存：loader → { p, m, e, done }
    var chunkCache = new Map();

    /**
     * 取一个 chunk（Suspense 风格：没到就抛 Promise，到了就返回模块）。
     *
     * 键是 loader 本身，所以命中与否只取决于「拉过没有」，跟渲染次数、时序无关。
     * ⚠️ 别改成「把状态挂在 useState 初值上再改它」——每次渲染都是新对象，恒不命中。
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

        /**
         * 交给 chunk 的那一份：宿主独有的东西显式列在这里，chunk 的 create(api)
         * 解构回去 —— 同一个东西在几个文件里各写一份，迟早改一处漏一处。
         *
         * 样式常量留在宿主是因为宿主注册期就要用（把 chunk 的异步依赖收在这一层）。
         *
         * ⚠️ 这一段在 factory 里，**不许**出现 await / throw Promise ——
         *    factory 必须同步 `return module.exports`，否则宿主报
         *    `import failed: [object Promise]`。
         */
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
          label: sectionLabel,
          mode: MODE_LABEL,
          tokens: fmtTokens,
          route: {
            ROUTE_STATE: ROUTE_STATE,
            ROUTE_ASSIGN: ROUTE_ASSIGN,
            ROUTE_PREVIEW: ROUTE_PREVIEW,
            ROUTE_RELOAD: ROUTE_RELOAD,
            ROUTE_DEFAULTS: ROUTE_DEFAULTS,
            ROUTE_EDIT: ROUTE_EDIT,
            ROUTE_SECTIONS: ROUTE_SECTIONS,
            ROUTE_PRESETS: ROUTE_PRESETS,
          },
        };

        /**
         * 会话头部那一份：多选面板 + 预览一起备好。
         *
         * ⚠️ 必须**一起**拉。面板里点「预览」会直接渲染 PreviewPanel（面板常驻、
         *    预览是弹层，同一个 React 树）—— 只拉面板的话，点预览那一刻就是
         *    `PreviewPanel is not defined`，React 随即卸载整棵子树。
         *    预览在这里解出来随 props 交给面板，面板自己不做异步。
         */
        function loadPromptUi() {
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
          ROUTE_STATE: ROUTE_STATE,
          ROUTE_ASSIGN: ROUTE_ASSIGN,
          ROUTE_PREVIEW: ROUTE_PREVIEW,
          ROUTE_RELOAD: ROUTE_RELOAD,
          ROUTE_DEFAULTS: ROUTE_DEFAULTS,
          ROUTE_EDIT: ROUTE_EDIT,
        };
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[AI Client Sandbox] dsh-prompt-manager runtime error:", err);
  }
})();
