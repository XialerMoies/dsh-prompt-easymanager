// 个人提示词 (dsh-prompt-easymanager) · 客户端宿主
//
// 这个文件只做三件事：注册两个槽位、渲染会话头部那一个按钮、按需拉下面的 chunk。
//
//   client.picker.js    多选面板 + 会话头部入口
//   client.preview.js   最终系统提示词预览
//   client.editor.js    设置页「个人提示词」整栏（最大的一块）
//
// 浮层外壳（Overlay + OVERLAY / PANEL 那一族常量）没有独立 chunk：面板和预览
// 各自定义同一个 Overlay 组件，常量从这里随 api.style 交下去。原文见
// docs/dev/overlay-component.md。
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
/**
 * 全局那份配置（开关 + 指向哪条预设）。
 *
 * ⚠️ 新会话页那个下拉框改的是**全局**（那边还没有会话），所以要用它。
 */
const ROUTE_GLOBAL = "/api/prompt-manager/global";
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
      // ⚠️ 插件**自己注入**的段落也会出现在这个列表里（名字形如
      //    `prompt-manager:<条目id>`）。这是修「列表只有全局层」那个 bug 之后的
      //    必然结果 —— 带 scope 读就看得见自己。
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
    // loader 是缓存的键，每次渲染都新建的话缓存永远 miss —— 组件会一直加载不完。
    //
    // require.async 收的是相对说明符（"./client.xxx.js"），**不是**注册键
    // "dsh-prompt-easymanager/client.xxx.js" —— 那个是 importChunk 自己拼的。
    var loadPicker = function () { return req.async("./client.picker.js"); };
    var loadPreview = function () { return req.async("./client.preview.js"); };
    var loadEditor = function () { return req.async("./client.editor.js"); };
    /** 设置页里的「总开关」那一块 + 共用的「?」图标。 */
    var loadEditorSwitch = function () { return req.async("./client.editor.switch.js"); };
    /** 设置页里的「系统提示词段落改写」那一块。 */
    var loadEditorSections = function () { return req.async("./client.editor.sections.js"); };
    /** 设置页里的「提示词组合 + 预设」那一块。 */
    var loadEditorCombo = function () { return req.async("./client.editor.combo.js"); };
    /** 设置页里的「个人提示词库」那一块。 */
    var loadEditorLibrary = function () { return req.async("./client.editor.library.js"); };

    var req = null; // factory 的材料化参数，见下面 factory 开头
    var react = null; // 同上 —— useChunk 在模块级，读不到 factory 里的局部变量

    /**
     * 设置面板侧边栏那一项的文案。
     *
     * ⚠️ **必须只有这一份** —— 侧边栏图标补丁是**按这段文案找按钮**的
     *    （见 patchNavIcon，因为 dsh 的 `SettingsSectionRow` 只有
     *    `{id, order, label}`，没有 icon，认不出就换不了图标）。
     *    把文案写两遍的话，改一处就会让另一处静默失效。
     */
    var NAV_TITLE = "提示词管理";

    // 已加载好的 chunk：loader → 模块本体（失败了就删掉，下次重试）
    var chunkCache = new Map();
    /** 「正在加载」的占位符 —— 只用来占住缓存键，绝不作为模块交出去。 */
    var PENDING = {};

    /**
     * 取一个 chunk，没到就先用 effect 去拉。
     *
     * ⚠️ **不许用「抛 Promise 挂起」（Suspense）那条路。**
     *    槽位是 dsh-client-ui-renderer 渲染的，它只包了 componentDidCatch（错误边界），
     *    **没有 Suspense**。在槽位入口抛 Promise 会一路冒到根，报
     *      Minified React error #426（A component suspended while responding to
     *      synchronous input），结果是会话头和设置页两个占用**一起崩**。
     *    官方那个 dsh-client-ui-sidebar-documentpreview 是**在自己组件内部**包
     *    `<Suspense>` 才敢用 lazy 的 —— 槽位这一层没有。
     *
     * 这里改成 effect 异步拉 + 到位后 setState，全程不挂起。代价是首帧空白，
     * 对「点开设置页」这种交互无所谓。
     */
    function useChunk(loader) {
      var st = react.useState(function () {
        return chunkCache.get(loader) || null;
      });
      var mod = st[0];
      var setMod = st[1];

      react.useEffect(
        function () {
          if (mod) return undefined;
          // ⚠️ 「加载中」也要占住这个键，否则同一个 loader 会被并发拉两遍
          //    （两个组件同时首次渲染就会），白拉一次脚本。
          if (chunkCache.get(loader) === undefined) chunkCache.set(loader, PENDING);
          var alive = true;
          loader().then(
            function (m) {
              chunkCache.set(loader, m);
              if (alive) setMod(m);
            },
            function (err) {
              // 失败不缓存，下次进这个页面会重试。
              // ⚠️ 必须留一行日志 —— 静默的话表现就是「那一栏一直是空的」，
              //    而控制台什么都不说（这个坑踩过一次）。
              chunkCache.delete(loader);
              console.error("[prompt-manager] chunk 加载失败：", err);
            },
          );
          return function () {
            alive = false;
          };
        },
        [loader, mod],
      );

      // PENDING 只是占位符，不能当模块交出去 —— 否则调用方拿到一个假模块，
      // 下一步就是 React #130（type 是 undefined）。
      if (mod === PENDING) return null;
      return mod;
    }

    /**
     * 组合加载器：面板 + 预览两个 **chunk** 一起备好。
     *
     * ⚠️ 返回的是**两个模块**，不是组件 —— 组件要宿主自己 `create(api)` 造出来。
     *    这里少调一次 create 就是 React #130（Element type is invalid:
     *    got undefined），而槽位的错误边界会把整个占用吞掉、只留一行日志。
     *
     * ⚠️ 也不能各拉各的。面板里点「预览」会直接渲染 PreviewPanel（面板常驻、
     *    预览是弹层，同一个 React 树）—— 只拉面板的话，点预览那一刻就是
     *    `PreviewPanel is not defined`，React 随即卸载整棵子树。
     *
     * 单独包一层是为了让它成为**稳定的引用**：useChunk 拿它当缓存键，
     * 内联写箭头函数的话每次渲染都是新键，缓存永远不命中。
     */
    function loadPromptUi() {
      // ⚠️ 入口先把这个键删掉。它是「组合加载器」，缓存里那个值只有**全部**拉完
      //    才写得进去；不删的话卸载重挂会读到上一次的（形状可能已经变了）。
      chunkCache.delete(loadPromptUi);
      return loadPreview().then(function (previewMod) {
        return loadPicker().then(function (pickerMod) {
          // 顺手把单件也缓存上 —— 面板以后要单独取预览
          chunkCache.set(loadPreview, previewMod);
          chunkCache.set(loadPicker, pickerMod);
          return { previewMod: previewMod, pickerMod: pickerMod };
        });
      });
    }

    window.__ModuleLoader__.load({
      id: "dsh-prompt-easymanager",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        // factory 只被材料化一次，在这里把 require / react 交给模块级的辅助函数。
        // ⚠️ useChunk 定义在模块级，看不到 factory 里的局部变量 —— 必须记出来。
        req = require;
        react = require("react");
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
          border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
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
          borderColor: "var(--dsw-alias-border-l3, rgba(128,128,128,.45))",
          background: "var(--dsw-specific-menu, rgba(128,128,128,.14))",
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
          // ⚠️ **弹层配方**，照 dsh 自己的 `MenuSurface.module.css` 抄：
  //      background: var(--dsw-menu-surface-fill)
  //      backdrop-filter: var(--dsw-menu-backdrop-filter)
  //
  //    别用 `--dsw-alias-bg-overlay` —— 那是**遮罩层**（浮层背后压暗那一层），
  //    深色下它是中灰 #61666b，拿它当面会把面板糊成一片灰（真机截图里就是这个）。
  background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14)))",
  backdropFilter: "var(--dsw-menu-backdrop-filter, none)",
          color: "var(--dsw-alias-label-primary, rgba(128,128,128,.95))",
          border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
          borderRadius: "8px",
          maxWidth: "860px",
          width: "100%",
          maxHeight: "80vh",
          // ⚠️ 照原生 `.list` —— **卡片内边距 4px**。
          //    没有它的话项会**紧贴面板边缘和标题那条线**（用户报的「选项紧贴分隔线」）。
          padding: "4px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,.28)",
          fontFamily: "inherit",
          fontSize: "12px",
        };

  /**
   * 面板里的**标题行** —— 照原生菜单的 `.label`。
   *
   *  ⚠️ 原来我自己画了一个「带下边框的头 + 关闭按钮」，那是**另一套视觉语言**：
   *     原生菜单的标题是**一小行灰字**，跟项同样的左右内边距，**没有分隔线**。
   *     画了分隔线之后，项又紧贴那条线 → 用户看到的「位置混乱」。
   */
  var MENU_LABEL = {
    padding: "6px 8px",
    fontSize: "11px",
    lineHeight: "15px",
    color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))",
    fontWeight: 600,
  };

  /** 标题行的右侧（放「关闭」之类的小按钮）：同一行、靠右、不撑高。 */
  var MENU_LABEL_ROW = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    padding: "6px 8px",
  };

  /**
   * 菜单项 —— 照原生 `.item`。
   *
   *     min-height 34px / padding 6px 8px / radius --dsw-radius-md
   *     font-size 13px / line-height 20px / color --dsw-alias-label-primary
   */
  var MENU_ITEM = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    minHeight: "34px",
    padding: "6px 8px",
    border: "none",
    borderRadius: "var(--dsw-radius-md, 8px)",
    background: "transparent",
    cursor: "pointer",
    fontSize: "13px",
    lineHeight: "20px",
    color: "var(--dsw-alias-label-primary, rgba(128,128,128,.95))",
    textAlign: "left",
    fontFamily: "inherit",
  };

  /** 勾那一列 —— 照原生 `.itemIcon`（14×14，用 menu-icon 那个色）。 */
  var MENU_MARK = {
    display: "inline-flex",
    flex: "none",
    width: "14px",
    height: "14px",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--dsw-alias-menu-icon, rgba(128,128,128,.9))",
  };

  /** 项的主文字 —— 照原生 `.itemLabel`（占满、省略号）。 */
  var MENU_TEXT = {
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  /** 项的副文字 —— 照原生 `.shortcut`（靠右、更淡更小）。 */
  var MENU_HINT = {
    flex: "none",
    marginInlineStart: "auto",
    color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))",
    fontSize: "11px",
    lineHeight: "16px",
  };

  /** 划过去的高亮 —— 照原生 `.item:hover`（跟选中用的是同一个填充）。 */
  var MENU_ITEM_HOVER = Object.assign({}, MENU_ITEM, {
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))",
  });

  /** 选中态 —— 照原生 `.selectedFill`（**就是 hover 那个填充**，不是另造一个色）。 */
  var MENU_ITEM_ON = Object.assign({}, MENU_ITEM, {
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))",
  });

  /** 分隔线 —— 照原生 `.separator`（.5px、左右缩 2px）。 */
  var MENU_SEP = {
    height: ".5px",
    margin: "3px 2px",
    background: "var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
  };
        var PANEL_SM = Object.assign({}, PANEL, { maxWidth: "560px" });
        var PANEL_HEAD = {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 12px",
          borderBottom: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        };
        var PANEL_BODY = { padding: "10px 12px", overflow: "auto", flex: "1 1 auto" };
        var PANEL_FOOT = {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 12px",
          borderTop: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
          flexWrap: "wrap",
        };

        // ── 面板 / 卡片 / 表单：给 chunk 用的样式 ─────────────────────────
        //
        // ⚠️ 拆包时这 62 个常量被漏在了半路 —— chunk 里只有 `var X = api.style.X`
        //    取值行，宿主却没给 X，于是编辑器那一栏整片空白（渲染期全是 undefined）。
        //    补的时候是从切分前的单文件（62eeb75:client.js）逐字搬回来的。
        //    定义只留这一份，chunk 那边靠 api.style 取。
      var ADVISE = {
        border: "1px solid rgba(245,158,11,.7)",
        background: "rgba(245,158,11,.08)",
        borderRadius: "6px",
        padding: "8px 10px",
        marginBottom: "10px",
      };
      var CARD = {
        border: ".5px solid var(--dsw-alias-settings-card-stroke, rgba(128,128,128,.3))",
        borderRadius: "var(--dsw-radius-xl, 10px)",
        background: "var(--dsw-alias-settings-card-fill, rgba(128,128,128,.06))",
        minWidth: "0",
        overflow: "hidden",
      };
      var CARDS_GRID = {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "10px",
        alignItems: "start",
        listStyle: "none",
        margin: "0",
        padding: "0",
      };
      var CARD_ACTIONS = {
        display: "flex",
        gap: "6px",
        alignItems: "center",
        flexShrink: 0,
        marginTop: "10px",
        flexWrap: "wrap",
      };
      var CARD_BAD = Object.assign({}, CARD, {
        borderColor: "var(--dsw-alias-state-error-primary, rgba(239,68,68,.7))",
      });
      var CARD_DESC = {
        fontSize: "12.5px",
        lineHeight: "18px",
        color: "var(--dsw-alias-label-secondary, inherit)",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      };
      /**
       * 描述单独占一行时用的样式（在卡片头**下面**，不是里面）。
       *
       * ⚠️ 卡片头改成了 `flexDirection: "row"` 的一行（名字/徽章/字数/箭头），
       *    描述塞进去会把那一行挤变形，所以它得挪到头的**外面**当第二行。
       *    这是按钮之外的普通 `div`，所以要自己补横向内边距 —— 按钮有
       *    `CARD_HEAD` 的 14px，这里没有。
       */
      var CARD_DESC_ROW = Object.assign({}, CARD_DESC, {
        padding: "0 14px 10px",
      });
      var CARD_DETAILS = {
        borderTop: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        background: "var(--dsw-alias-bg-module-platform, rgba(128,128,128,.08))",
        padding: "10px 14px 12px",
      };
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
      var CARD_HEADING = { display: "flex", alignItems: "baseline", gap: "7px", padding: "0 2px" };
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
      var CHEVRON = {
        flex: "none",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        transition: "transform .14s ease-in-out",
        fontSize: "12px",
        lineHeight: "16px",
      };
      var CHEVRON_OPEN = Object.assign({}, CHEVRON, { transform: "rotate(90deg)" });
      var COMBO_BOARD = {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "10px",
        alignItems: "start",
      };
      var COMBO_CHIPS = { display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 10px" };
      var COMBO_ROW = {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 6px",
        borderRadius: "4px",
        cursor: "grab",
        fontSize: "12px",
      };
      var COMBO_ROW_HL = { background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))" };
      var COMBO_SIDE = {
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))",
        borderRadius: "6px",
        padding: "8px 10px",
        minHeight: "90px",
        background: "var(--dsw-alias-bg-layer-1, transparent)",
      };
      var COMBO_SIDE_HL = { borderColor: "var(--dsw-alias-state-business-primary, #3b82f6)" };
      var DD = {
        margin: "0",
        minWidth: "0",
        overflowWrap: "anywhere",
        color: "var(--dsw-alias-label-secondary, inherit)",
        fontSize: "12px",
        lineHeight: "17px",
      };
      var DETAILS_GRID = {
        display: "grid",
        gridTemplateColumns: "58px minmax(0,1fr)",
        gap: "6px 10px",
        margin: "0 0 10px",
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
      var DOT = {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        flex: "none",
        background: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.6))",
      };
      var DOT_DEFAULT = Object.assign({}, DOT, { background: "#3b82f6" });
      var DOT_ERR = Object.assign({}, DOT, { background: "#ef4444" });
      var DOT_OK = Object.assign({}, DOT, { background: "#10b981" });
      var DOT_WAIT = Object.assign({}, DOT, { background: "#f59e0b" });
      var DT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "11px",
        lineHeight: "17px",
      };
      var ERRBOX = {
        border: "1px solid rgba(239,68,68,.7)",
        background: "rgba(239,68,68,.1)",
        borderRadius: "5px",
        padding: "2px 6px",
        fontSize: "11px",
        lineHeight: "16px",
        maxWidth: "260px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: "none",
      };
      var FORM = { display: "flex", flexDirection: "column", gap: "8px" };
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
      var FORM_LABEL = {
        fontSize: "11px",
        lineHeight: "17px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        minWidth: "38px",
        flex: "none",
      };
      var FORM_LINE = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
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
      var HEADING = {
        margin: "14px 0 6px",
        paddingBottom: "4px",
        borderBottom: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        fontWeight: "bold",
        opacity: 0.9,
      };
      var HEADING_COUNT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontVariantNumeric: "tabular-nums",
        fontSize: "12px",
        lineHeight: "18px",
      };
      var HEADING_TITLE = { fontSize: "13px", fontWeight: 600, lineHeight: "20px" };
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
      var MONO = {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: "180px",
        overflow: "auto",
        margin: "6px 0 0",
        opacity: 0.9,
      };
      var MONO_TAIL = Object.assign({}, MONO, { maxHeight: "420px" });
      var MSG_OK = {
        fontSize: "11px",
        lineHeight: "16px",
        padding: "2px 6px",
        borderRadius: "5px",
        background: "rgba(16,185,129,.15)",
        color: "inherit",
        whiteSpace: "nowrap",
        flex: "none",
      };
      var MUTED = { opacity: 0.65 };
      var PICK = {
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "7px 9px",
        borderRadius: "6px",
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        marginBottom: "6px",
        cursor: "pointer",
      };
      var PICK_ON = Object.assign({}, PICK, {
        borderColor: "rgba(16,185,129,.7)",
        background: "rgba(16,185,129,.08)",
      });
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
      var PILL_WARN = Object.assign({}, PILL, {
        borderColor: "var(--dsw-alias-state-warn-primary, rgba(245,158,11,.8))",
        color: "var(--dsw-alias-state-warn-label, #f59e0b)",
      });
      var RAW_NAME = {
        flex: "0 1 auto",
        minWidth: "0",
        fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
        fontSize: "10.5px",
        lineHeight: "16px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        opacity: 0.75,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      };
      var SEC = {
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
        borderRadius: "6px",
        padding: "8px 10px",
        marginBottom: "8px",
      };
      var SECTION = {
        width: "100%",
        maxWidth: "760px",
        color: "var(--dsw-alias-label-primary, inherit)",
        display: "flex",
        flexDirection: "column",
        // ⚠️ 12px —— 跟 dsh 其它内容页**一致**（模型页 / 智能体预设页的 `.section`
        //    都是 `flex-direction:column;gap:12px`）。
        //    原来是 14px：数值自己拍的，比参考页松，一眼看得出不是一家。
        gap: "12px",
      };
      var SEC_OURS = Object.assign({}, SEC, { borderColor: "rgba(16,185,129,.7)" });
      var SELECT_SM = {
        flex: "0 0 auto",
        width: "220px",
        font: "inherit",
        fontSize: "12px",
        padding: "2px 6px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
        background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.1))",
        color: "inherit",
      };
      /**
     * 新会话页那一行里的小下拉框 —— **照原生 `.select` 抄的**。
     *
     * ⚠️ 别拿 SELECT_SM 顶替：那是「带边框的输入框」，插到工作区/模式
     *    那一行里长得完全不一样（真机上出过）。
     *
     *    那个箭头用**背景图**画（跟原生同一段 data URI），所以右边留 20px。
     */
    var HERO_CHIP = {
      flex: "none",
      maxWidth: "220px",
      height: "28px",
      color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.95))",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      cursor: "pointer",
      appearance: "none",
      backgroundColor: "transparent",
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
      backgroundPosition: "right 4px center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "12px 12px",
      border: "none",
      outline: "none",
      padding: "0 20px 0 8px",
      fontSize: "13px",
      fontWeight: 500,
      lineHeight: "20px",
      fontFamily: "inherit",
      borderRadius: "var(--dsw-radius-sm, 4px)",
    };

    var SLOT_HEAD = Object.assign({}, CARD_MAIN_ROW, {
        flexDirection: "row",
        minHeight: "0",
        padding: "10px 14px",
      });
      var SLOT_WHY = {
        padding: "0 14px 10px",
        fontSize: "11.5px",
        lineHeight: "17px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
      };
      var STATUS_LINE = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "13px",
        lineHeight: "20px",
      };
      var SUMSUM = {
        border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))",
        borderRadius: "6px",
        padding: "8px 10px",
        marginBottom: "4px",
        lineHeight: "1.7",
      };
      var WARN = {
        border: "1px solid rgba(239,68,68,.7)",
        background: "rgba(239,68,68,.08)",
        borderRadius: "6px",
        padding: "8px 10px",
        marginBottom: "10px",
      };
      var MSG_ERR = Object.assign({}, MSG_OK, {
        background: "rgba(239,68,68,.15)",
        maxWidth: "320px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

    /** 下拉里「当前生效」那一项的高亮（跟普通行区分开）。 */
    var ROW_ACTIVE = {
      background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))",
      borderRadius: "var(--dsw-radius-md, 8px)",
    };

    /** 勾那一列 —— 固定宽度，免得没勾的行跟有勾的行对不齐。 */
    /** 段落 tag —— 一行小胶囊，多个自动换行。 */
    var TAG = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "1px 8px",
      border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
      borderRadius: "999px",
      cursor: "pointer",
      fontSize: "12px",
    };

    var ROW_MARK = {
      flex: "none",
      width: "14px",
      textAlign: "center",
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
            ROW_ACTIVE: ROW_ACTIVE,
            ROW_MARK: ROW_MARK,
            TAG: TAG,
            HERO_CHIP: HERO_CHIP,
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
            MENU_LABEL: MENU_LABEL,
            MENU_LABEL_ROW: MENU_LABEL_ROW,
            MENU_ITEM: MENU_ITEM,
            MENU_ITEM_ON: MENU_ITEM_ON,
            MENU_ITEM_HOVER: MENU_ITEM_HOVER,
            MENU_MARK: MENU_MARK,
            MENU_TEXT: MENU_TEXT,
            MENU_HINT: MENU_HINT,
            MENU_SEP: MENU_SEP,
            PANEL_SM: PANEL_SM,
            PANEL_HEAD: PANEL_HEAD,
            PANEL_BODY: PANEL_BODY,
            PANEL_FOOT: PANEL_FOOT,
            ADVISE: ADVISE,
            CARD: CARD,
            CARDS_GRID: CARDS_GRID,
            CARD_ACTIONS: CARD_ACTIONS,
            CARD_BAD: CARD_BAD,
            CARD_DESC: CARD_DESC,
            CARD_DESC_ROW: CARD_DESC_ROW,
            CARD_DETAILS: CARD_DETAILS,
            CARD_HEAD: CARD_HEAD,
            CARD_HEADING: CARD_HEADING,
            CARD_ID: CARD_ID,
            CARD_MAIN_ROW: CARD_MAIN_ROW,
            CARD_TITLE: CARD_TITLE,
            CHEVRON: CHEVRON,
            CHEVRON_OPEN: CHEVRON_OPEN,
            COMBO_BOARD: COMBO_BOARD,
            COMBO_CHIPS: COMBO_CHIPS,
            COMBO_ROW: COMBO_ROW,
            COMBO_ROW_HL: COMBO_ROW_HL,
            COMBO_SIDE: COMBO_SIDE,
            COMBO_SIDE_HL: COMBO_SIDE_HL,
            DD: DD,
            DETAILS_GRID: DETAILS_GRID,
            DETAIL_BTN: DETAIL_BTN,
            DETAIL_BTN_BUSY: DETAIL_BTN_BUSY,
            DETAIL_BTN_DANGER: DETAIL_BTN_DANGER,
            DOT: DOT,
            DOT_DEFAULT: DOT_DEFAULT,
            DOT_ERR: DOT_ERR,
            DOT_OK: DOT_OK,
            DOT_WAIT: DOT_WAIT,
            DT: DT,
            ERRBOX: ERRBOX,
            FORM: FORM,
            FORM_INPUT: FORM_INPUT,
            FORM_INPUT_NUM: FORM_INPUT_NUM,
            FORM_LABEL: FORM_LABEL,
            FORM_LINE: FORM_LINE,
            FORM_TEXTAREA: FORM_TEXTAREA,
            HEADING: HEADING,
            HEADING_COUNT: HEADING_COUNT,
            HEADING_TITLE: HEADING_TITLE,
            HINT: HINT,
            MONO: MONO,
            MONO_TAIL: MONO_TAIL,
            MSG_OK: MSG_OK,
            MUTED: MUTED,
            PICK: PICK,
            PICK_ON: PICK_ON,
            PILL: PILL,
            PILL_APPEND: PILL_APPEND,
            PILL_WARN: PILL_WARN,
            RAW_NAME: RAW_NAME,
            SEC: SEC,
            SECTION: SECTION,
            SEC_OURS: SEC_OURS,
            SELECT_SM: SELECT_SM,
            SLOT_HEAD: SLOT_HEAD,
            SLOT_WHY: SLOT_WHY,
            STATUS_LINE: STATUS_LINE,
            SUMSUM: SUMSUM,
            WARN: WARN,
            MSG_ERR: MSG_ERR,
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
          ROUTE_GLOBAL: ROUTE_GLOBAL,
          },
        };

        /**
         * 会话头部的入口。
         *
         * `loadPromptUi` 定义在模块级（useChunk 拿它当缓存键，必须是稳定引用）。
         * 还没加载好就渲染 null —— 不挂起，见 useChunk 上面那段说明。
         *
         * ⚠️ 拿到的是两个 **chunk 模块**，得自己 `create(api)` 造组件。
         *    漏掉这一步就是 React #130（type 是 undefined），而且因为槽位外面
         *    只有错误边界，界面上只会看到「会话头部空了一块」。
         */
        function HeaderSlot(props) {
          var ui = useChunk(loadPromptUi);
          if (!ui) return null;
          if (!ui.pickerMod.box) ui.pickerMod.box = ui.pickerMod.create(CHUNK_API);
          if (!ui.previewMod.box) ui.previewMod.box = ui.previewMod.create(CHUNK_API);
          return react.createElement(
            ui.pickerMod.box.PromptPicker,
            Object.assign({}, props, { PreviewPanel: ui.previewMod.box.PreviewPanel }),
          );
        }

        /** 设置页那一栏。 */
        function EditorSlot() {
          var m = useChunk(loadEditor);
          // 兄弟 chunk —— editor 自己要渲染这几块，所以都得等到。
          var sw = useChunk(loadEditorSwitch);
          var sec = useChunk(loadEditorSections);
          var combo = useChunk(loadEditorCombo);
          var lib = useChunk(loadEditorLibrary);
          if (!m || !sw || !sec || !combo || !lib) return null;
          // ⚠️ `installStyles` 在 **create() 的返回值**里，不在模块上 ——
          //    chunk 的 module.exports 只有 `{ create }`。
          //
          //    `boxOf` 把「造一次、缓存住、装样式」收成一句：
          //    这一段原来每个 chunk 抄三行，加一个 chunk 就要多抄三行
          //    （这轮已经加了三个）。
          function boxOf(mod) {
            if (!mod.box) mod.box = mod.create(CHUNK_API);
            if (typeof mod.box.installStyles === "function") mod.box.installStyles();
            return mod.box;
          }
          var eb = boxOf(m);
          var sb = boxOf(sw);
          var cb = boxOf(sec);
          var combob = boxOf(combo);
          var lb = boxOf(lib);
          // ⚠️ 拆出去的那几块由宿主**当 props 递进去**，而不是让编辑器自己去拉 ——
          //    自己拉会让两边各有一份缓存、还要各自处理加载态。
          return react.createElement(eb.PromptEditor, {
            MasterSwitch: sb.MasterSwitch,
            helpIcon: sb.helpIcon,
            SectionsBlock: cb.SectionsBlock,
            ComboBlock: combob.ComboBlock,
            LibraryBlock: lb.LibraryBlock,
          });
        }

        /**
         * 把侧边栏里那一项的图标从**兜底齿轮**换成我们自己的。
         *
         * ── 为什么只能这么干 ────────────────────────────────────────────────
         *
         * dsh 的侧边导航图标是**硬编码白名单**：
         *
         *     function navIcon(id) {
         *       if (id === "account") return <IconUser…/>;
         *       if (id === "models")  return <IconData…/>;
         *       …
         *       return <IconSettings…/>;   // ← 未知 id 一律齿轮
         *     }
         *
         * 而注册表能带的信息只有三个字段（设置壳的 contract 里写着）：
         *
         *     interface SettingsSectionRow { id: string; order: number; label: string }
         *
         * **没有 icon 字段，也没有图标注册表** —— 第三方插件无法通过 API 指定图标。
         * 所以只能渲染后替换。
         *
         * ⚠️ 这是 DOM 补丁，dsh 改版就可能失效，所以：
         *    · 全程 try/catch，失败就保持原样（齿轮也不难看）；
         *    · 用 MutationObserver 兜住 React 的重新渲染（否则切一次面板就被还原）；
         *    · 只在**确实找到那一项**时才动它，认不出就什么都不做。
         */
        function patchNavIcon() {
          if (typeof document === "undefined" || !document.body) return;

          var KEY = "pmNavIconDone";
          var SVG_NS = "http://www.w3.org/2000/svg";

          /** 改名/编辑那支笔 —— 跟这块的语义（管理提示词）对得上。 */
          function makeIcon() {
            var svg = document.createElementNS(SVG_NS, "svg");
            svg.setAttribute("viewBox", "0 0 16 16");
            svg.setAttribute("width", "16");
            svg.setAttribute("height", "16");
            svg.setAttribute("fill", "none");
            svg.setAttribute("aria-hidden", "true");
            svg.style.flex = "none";
            var path = document.createElementNS(SVG_NS, "path");
            path.setAttribute("d", "M11.2 2.3l2.5 2.5-8 8L3 13.4l.6-2.7 7.6-8.4z");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", "1.3");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("stroke-linecap", "round");
            svg.appendChild(path);
            return svg;
          }

          function apply() {
            try {
              // 找导航里**文案就是这一项**的那个按钮（用同一份常量，见 NAV_TITLE）。
              // 不靠 class（那是 CSS module 的哈希，会变），靠文案。
              var buttons = document.querySelectorAll("button");
              for (var i = 0; i < buttons.length; i++) {
                var b = buttons[i];
                if (b.textContent !== NAV_TITLE) continue;
                if (b.getAttribute(KEY) === "1") continue; // 已经是我们的图标
                var old = b.querySelector("svg");
                if (!old) continue;
                old.replaceWith(makeIcon());
                b.setAttribute(KEY, "1");
                return true;
              }
            } catch {
              /* 补丁失败不影响功能 */
            }
            return false;
          }

          // 立刻试一次；没找到（面板还没开）就靠 observer 等
          apply();
          try {
            var obs = new MutationObserver(function () {
              apply();
            });
            obs.observe(document.body, { childList: true, subtree: true });
          } catch {
            /* 没有 MutationObserver 就只生效一次 */
          }
        }

        /**
         * 新会话页（hero）那一行插一个「提示词组合」下拉框。
         *
         * ⚠️ **只能 DOM 补丁** —— 那一行的两个槽位都是 `kind: "single"`
         *    且已被占，抢会抛错；也没有第三个槽位。详见上面那段说明。
         *
         * ⚠️ 找不到目标就**什么都不做** —— 不抛错、不插半个控件。
         *    dsh 改版之后这个补丁会静默失效，但页面照常能用。
         */
        function patchHeroPreset() {
          if (typeof document === "undefined" || !document.body) return;
          var HOST_ATTR = "data-pm-hero-preset";

          /**
           * 找「工作区 / agent 预设」那一行。
           *
           * ── 现在靠什么找：**槽位属性** ──────────────────────────────────
           *
           * dsh 的槽位渲染器（`dsh-client-ui-renderer` 的 `SlotOutlet`）给每个
           * 槽位容器都加了 `data-slot="<slotKey>"`：
           *
           *     <div data-slot="conversation.hero.agentPreset" style="display:contents">…</div>
           *
           * 这是 **dsh 自己定义的键**，不随 CSS module 的哈希 class 变，
           * 也不随它内部塞几个孩子变 —— **比数孩子稳得多**。
           *
           *     槽位容器（display:contents）的**父元素**就是那一行。
           *
           * ── 踩过的四次（每次都是判据太松或太紧）─────────────────────────
           *
           *   ① `btn.parentElement.parentElement` —— 走太高，插到「包住整块输入区」
           *      的外层容器上 → 控件另起一行。
           *   ② 只认 `[aria-haspopup='menu']` —— 真机返回 0 个（那时页面还没渲染），
           *      而日志设成「只打一次」，只留下最早那次失败的样子。
           *   ③ 判据放宽成「孩子数 2–4、至少 2 个 button」—— **太松**：
           *      匹配到了输入框那行的 `standardControls`（正好 2 个孩子），
           *      于是控件被插到了**发送按钮后面**（用户贴的 DOM 里能看到）。
           *   ④ 所以现在**不再数孩子**，直接认槽位键。
           */
          /** 试过几次（诊断用）。⚠️ 必须声明在 apply **之前** ——
           *  `var` 会提升，但值是 undefined，`tries++` 就成了 NaN。 */
          var tries = 0;

          /** 那一行的槽位键（dsh 定的，见上面说明）。 */
          var HERO_SLOT = "conversation.hero.agentPreset";

          function rowOf() {
            try {
              var anchor = document.querySelector('[data-slot="' + HERO_SLOT + '"]');
              if (!anchor) return null;
              // ⚠️ 槽位容器自己是 `display:contents`（**没有盒子**），
              //    往里 append 子元素布局上会散架 —— 要插到它**父元素**里。
              var row = anchor.parentElement;
              if (!row) return null;
              if (row.querySelector("[" + HOST_ATTR + "]")) return null; // 已插过
              return row;
            } catch {
              /* 结构变了就算了 */
            }
            return null;
          }

          /**
           * 把「找到/没找到」说清楚 —— 打一行紧凑的诊断。
           *
           * ⚠️ 为什么要这个：DOM 补丁靠结构匹配，而**结构只有真机上才有**。
           *    没有它的时候每次失效都只能靠猜（已经猜过两轮）。
           *    现在失败时从控制台能一眼看出「匹配到了什么、为什么没插」。
           */
          function describe(el) {
            try {
              if (!el) return "(null)";
              var tag = el.tagName ? el.tagName.toLowerCase() : "?";
              var cls = (el.className || "").toString().split(/\s+/).slice(0, 2).join(".");
              var kids = el.children ? el.children.length : 0;
              var parts = [];
              for (var k = 0; k < kids && k < 5; k++) {
                var c = el.children[k];
                parts.push(
                  (c.tagName || "?").toLowerCase() +
                    (c.getAttribute && c.getAttribute("aria-haspopup") ? "[menu]" : ""),
                );
              }
              return tag + (cls ? "." + cls : "") + " kids=" + kids + " [" + parts.join(", ") + "]";
            } catch {
              return "(描述失败)";
            }
          }

          function apply() {
            tries++;
            try {
              if (document.querySelector("[" + HOST_ATTR + "]")) return true; // 已经插过
              var row = rowOf();
              if (!row) {
                // ⚠️ 失败时**说清楚看到了什么** —— 这个补丁靠结构匹配，
                //    而结构只有真机上有。没有这行日志，失效时只能靠猜。
                //    （上一版「只打一次」害了自己：第一次是「还没渲染」，
                //      之后成功了也不打，于是我只看到失败那次的样子。）
                note(
                  "没找到目标行（第 " + tries + " 次尝试）；" +
                    "页面上有 " +
                    document.querySelectorAll("[data-slot]").length +
                    " 个槽位容器，其中 hero 那个（" +
                    HERO_SLOT +
                    "）有 " +
                    document.querySelectorAll('[data-slot="' + HERO_SLOT + '"]').length +
                    " 个；第一个槽位的父链：" +
                    describeChain(document.querySelector("[data-slot]")),
                );
                return false;
              }
              var box = document.createElement("span");
              box.setAttribute(HOST_ATTR, "1");
              box.style.display = "inline-flex";
              box.style.alignItems = "center";
              row.appendChild(box);
              note("已插入（第 " + tries + " 次尝试），目标行：" + describe(row) + "；它的父：" + describe(row.parentElement));
              mountHeroPicker(box);
              return true;
            } catch {
              /* 补丁失败不影响功能 */
            }
            return false;
          }

          /** 把一个元素往上四层描述一遍（帮助判断「插到哪儿了」）。 */
          function describeChain(el) {
            var out = [];
            for (var k = 0; el && k < 4; k++) {
              out.push(describe(el));
              el = el.parentElement;
            }
            return out.join("  ↑  ") || "(null)";
          }

          /**
           * 诊断输出。
           *
           * ⚠️ **只在「状态变了」的时候打**：
           *      第一次失败打一条
           *      成功打一条（**一定会打**，哪怕前面失败过很多次）
           *      之后不再重复（MutationObserver 会刷屏）
           *
           *    上一版是「总共只打一次」，结果只留下最早那次失败 ——
           *    而那次是「页面还没渲染完」，完全误导。
           */
          var lastState = "";
          function note(msg) {
            var state = msg.indexOf("已插入") === 0 ? "ok" : "fail";
            if (state === lastState) return;
            lastState = state;
            try {
              console.info("[dsh-prompt-easymanager] hero 下拉框：" + msg);
            } catch {
              /* 没有 console 就算了 */
            }
          }

          apply();
          try {
            var obs = new MutationObserver(function () {
              apply();
            });
            obs.observe(document.body, { childList: true, subtree: true });
          } catch {
            /* 没有 MutationObserver 就只生效一次 */
          }
        }

        /**
         * 把 picker chunk 的面板挂进那个容器。
         *
         * ⚠️ 用 **portal** 把它挂进我们自己的容器：面板内部走的是
         *    `reactDom.createPortal(..., document.body)`，所以它本来就
         *    不依赖 React 树的位置 —— 从这儿挂进去跟从槽位挂进去一样。
         *
         * ⚠️ `sessionId` 传 **undefined** —— 新会话页还没有会话，
         *    面板会去改**全局那条预设**（见上面那段说明）。
         */
        function mountHeroPicker(box) {
          require.async("./client.picker.js").then(function (mod) {
            try {
              var box2 = mod.create(CHUNK_API);
              if (typeof box2.installStyles === "function") box2.installStyles();
              reactDom.render(
                react.createElement(box2.HeroPresetChip, { container: box }),
                box,
              );
            } catch (err) {
              console.error("[" + PLUGIN_ID + "] hero 下拉框挂载失败：" + (err && err.message));
            }
            return null;
          });
        }

        function apply(ctx) {
          // 会话头部：每个会话的多选器
          ctx.slots.inject("conversation.session.header.actions", () =>
            ctx.slots.register(
              { name: "conversation.session.header.actions", id: "prompt-picker", order: 40 },
              HeaderSlot,
            ),
          );
          // ⚠️ 注册到 `settings.section`（**设置面板侧边栏的独立一项**），
          //    不是 `settings.plugins.tab`（那会塞进「插件」标签页里面当个子 Tab）。
          //
          //    dsh 的设置面板是按 `settings.section` 注册表渲染导航的
          //    （`rows.map(row => <button>{navIcon(row.id)}{row.label}</button>)`），
          //    所以 `id` + `order` + `label` 给全就是一个独立入口。
          //    内置几项的 order：general 0 / models 10 / plugins 15 / agent-presets 20。
          //    这里放 50，排在它们后面。
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              {
                name: "settings.section",
                id: "prompt-manager",
                order: 50,
                label: () => NAV_TITLE,
              },
              EditorSlot,
            ),
          );
          // 侧边栏那一项的图标：dsh 只给白名单 id 配图标，我们落到了兜底齿轮
          // （原因见 patchNavIcon 上面那段）。渲染后替换掉。
          patchNavIcon();
          // 新会话页那一行：在工作区 / agent 预设之后插我们的下拉框
          patchHeroPreset();
        }

        exports.name = "dsh-prompt-easymanager";
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
    console.error("[AI Client Sandbox] dsh-prompt-easymanager runtime error:", err);
  }
})();
