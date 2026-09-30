(() => {
  try {
    /* 提示词管理 (dsh-prompt-manager) client half — 会话头部多选器 + 预览 (v0.2.0)
     *
     * 会话头部三样东西：
     *   [●] [无限四代 +1 ▾]  [预览]  [↻]
     *    │        │             │      └─ 重读 catalog.json
     *    │        │             └─ 展开最终系统提示词
     *    │        └─ 点开多选面板
     *    └─ 状态点：灰=未挂 / 绿=生效中（显式）/ 蓝=生效中（来自默认）/ 黄=agent 未加载 / 红=通信失败
     *
     * 槽位：`conversation.session.header.actions`
     *   —— dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:134
     *      kind: 'list', scope: 'session' → 真正的 per-session 位置。
     *   占用者的 props 里带 `sessionId`（session 作用域槽位由宿主注入）。
     *
     * 为什么不在侧边栏会话行的三点菜单里加一行：
     *   那个菜单不是 slot，是 ui-workspace 里写死的数组
     *   （dsh-client-ui-workspace/lib/client.js:948 `const sessionMenuItems = [...]`）。
     *
     * ⚠️ 浮层必须 portal 到 document.body —— 渲染在会话头部那一行里面的话，
     *    position:fixed 会被祖先的 transform/overflow/contain 关住而**完全看不见**
     *    （点击有响应、fetch 也成功，但画面上什么都没有）。
     *    一方插件（dsh-client-ui-attachment、dsh-client-ui-chat）都这么做的。
     *
     * ⚠️ 所有 style 常量必须有定义。读一个从未声明的标识符会抛 ReferenceError
     *    （不是静默的 undefined），React 随即卸载整棵子树 —— 表现就是
     *    「点了之后所有控件消失」。client_render_test.mjs 里有静态扫描盯着这点。
     *
     * 渲染期对数据必须容错：数组里的 null 项、缺字段，都不能让渲染抛错。
     */

    const ROUTE_STATE = "/api/prompt-manager/state";
    const ROUTE_ASSIGN = "/api/prompt-manager/assign";
    const ROUTE_PREVIEW = "/api/prompt-manager/preview";
    const ROUTE_RELOAD = "/api/prompt-manager/reload";
    const ROUTE_DEFAULTS = "/api/prompt-manager/defaults";
    const ROUTE_EDIT = "/api/prompt-manager/edit";
    const ROUTE_SECTIONS = "/api/prompt-manager/sections";
    const ROUTE_PRESETS = "/api/prompt-manager/presets";

    // ── 原生段落的中文显示名 ──────────────────────────────────────────────
    //
    // ⚠️ **只用于显示。** 存储、匹配、跟服务端对照用的始终是原始的 `name`
    //    （`harness:identity` 这种）—— 改了 name 就跟服务端的判定对不上了。
    //    所以卡片上**中文名和原始名都显示**：中文给人看，原始名给排查用。
    //
    // 官方以后新增段落时，这里查不到就走 `sectionLabel()` 的兜底：
    //   `tool:xxx` → 「工具 · xxx 用法」，其余 → 把 `:` 换成「 · 」。
    // 不用改代码也能有个像样的名字。
    //
    // ⚠️ **中文名必须对得上正文，不能从键名猜。** 核验时抓出三类错：
    //
    //   · `harness:identity` 我译成「环境自述」—— 正文是
    //     "You are an AI agent powered by DeepSeek Harness."
    //     说的是**身份**，一个字没提环境（cwd / 系统 / 模型都不在里面）。
    //   · `harness:source` 我译成「Harness 源码」—— 正文其实是
    //     "The DeepSeek Harness implementation checkout is at …"
    //     讲的是**装在哪**，还特意提醒 checkout 位置 ≠ 工作目录。
    //   · **键名写错**（比译错更隐蔽）：我写了 `ptc:only`，实际是 `tools:ptc-only`
    //     —— 那个键根本不存在，于是这一段一直走兜底、显示成「tools · ptc · only」。
    //     同一批还编了 `mcp:servers` / `web:surface` / `structured-output` 三个
    //     不存在的键，看着像是做了映射，其实一次都没命中过。
    //
    // **改这里的任何一条之前，先确认那个 name 真的存在。** 怎么确认：
    //   `grep -r 'name: *"<name>"' <dsh>/node_modules/@deepseek-ai/`
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
      pwsh: "PowerShell",
      read: "读文件",
      write: "写文件",
      edit: "改文件",
      glob: "找文件",
      grep: "搜内容",
      jobs: "后台任务",
      pty: "终端",
      "web-search": "网页搜索",
      web_search: "网页搜索",
      "web-fetch": "抓网页",
      web_fetch: "抓网页",
      lsp: "代码索引",
      "session-query": "会话查询",
      goal: "目标",
      workflow: "工作流",
      ralph: "长跑",
      subagent: "子代理",
      // 实测存在的名字（2026-09 按真机列表核对）：我一开始漏了 `subagent_fork`，
      // 于是它显示成兜底的「工具 · subagent_fork 用法」。
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

    window.__ModuleLoader__.load({
      id: "dsh-prompt-manager",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");
        var reactDom = require("react-dom");

        var inject = ["slots"];

        // ── 样式 ──────────────────────────────────────────────────────────────
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
        var CARD_NOTICE = { padding: "10px 14px 0" };
        /** 作用范围里的会话下拉（窄一点，别撑满） */
        /** 生效列表：左右两栏 */
        /** 总开关的胶囊本体 */
        var PILL_SWITCH = {
          position: "relative",
          flex: "0 0 auto",
          width: "36px",
          height: "20px",
          borderRadius: "999px",
          padding: "0",
          transition: "background .15s ease, border-color .15s ease",
        };
        var PILL_ON = {
          background: "var(--dsw-alias-state-business-primary, #3b82f6)",
          borderColor: "var(--dsw-alias-state-business-primary, #3b82f6)",
        };
        var PILL_OFF = {
          background: "var(--dsw-alias-bg-layer-3, rgba(128,128,128,.3))",
          borderColor: "var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
        };
        var PILL_KNOB = {
          position: "absolute",
          top: "2px",
          width: "16px",
          height: "16px",
          borderRadius: "999px",
          background: "#fff",
          transition: "left .15s ease",
        };
        var COMBO_BOARD = {
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "10px",
          alignItems: "start",
        };
        var COMBO_SIDE = {
          border: ".5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))",
          borderRadius: "6px",
          padding: "8px 10px",
          minHeight: "90px",
          background: "var(--dsw-alias-bg-layer-1, transparent)",
        };
        var COMBO_SIDE_HL = { borderColor: "var(--dsw-alias-state-business-primary, #3b82f6)" };
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
        var COMBO_CHIPS = { display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 10px" };

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
        /** 灰卡片（没被注册的槽位）的头 —— 内边距跟正常卡片头对齐。 */
        var SLOT_HEAD = Object.assign({}, CARD_MAIN_ROW, {
          flexDirection: "row",
          minHeight: "0",
          padding: "10px 14px",
        });
        /** 灰卡片的说明行。 */
        var SLOT_WHY = {
          padding: "0 14px 10px",
          fontSize: "11.5px",
          lineHeight: "17px",
          color: "var(--dsw-alias-label-tertiary, inherit)",
        };
        /**
         * 段落卡片标题旁的小字原始名（`harness:identity` 这种）。
         * 中文名给人看，原始名给排查用 —— 同一个 name 才能在服务端对上。
         */
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
        var DOT = {
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          flex: "none",
          background: "rgba(128,128,128,.6)",
        };
        var DOT_OK = Object.assign({}, DOT, { background: "#10b981" });
        var DOT_DEFAULT = Object.assign({}, DOT, { background: "#3b82f6" });
        var DOT_WAIT = Object.assign({}, DOT, { background: "#f59e0b" });
        var DOT_ERR = Object.assign({}, DOT, { background: "#ef4444" });
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
          // ⚠️ **浮窗背景必须用 dsh 的主题变量，而且兜底值不能写死深色。**
          //
          // 真机上踩过：这里原来写的是 `var(--dsh-surface, #1e1e1e)` ——
          //   · `--dsh-surface` 这个变量**在 dsh 里根本不存在**（全树 0 次出现），
          //     正确的命名空间是 `--dsw-alias-*`（本文件其它地方用的都是它）
          //   · 兜底 `#1e1e1e` 是写死的深色
          // 两个错叠在一起 → 变量永远取不到 → 浮窗**永远是深色**。
          // 用户是在远程访问（本机主题深色、远端浅色）时发现的。
          //
          // 最后一层兜底用 CSS 系统色 `Canvas` —— 它跟着浏览器/系统主题走，
          // 比写死一个颜色安全得多。
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
        var SEC = {
          border: "1px solid rgba(128,128,128,.22)",
          borderRadius: "6px",
          padding: "8px 10px",
          marginBottom: "8px",
        };
        var SEC_OURS = Object.assign({}, SEC, { borderColor: "rgba(16,185,129,.7)" });
        var PICK = {
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "7px 9px",
          borderRadius: "6px",
          border: "1px solid rgba(128,128,128,.22)",
          marginBottom: "6px",
          cursor: "pointer",
        };
        var PICK_ON = Object.assign({}, PICK, {
          borderColor: "rgba(16,185,129,.7)",
          background: "rgba(16,185,129,.08)",
        });
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
        var WARN = {
          border: "1px solid rgba(239,68,68,.7)",
          background: "rgba(239,68,68,.08)",
          borderRadius: "6px",
          padding: "8px 10px",
          marginBottom: "10px",
        };
        var ADVISE = {
          border: "1px solid rgba(245,158,11,.7)",
          background: "rgba(245,158,11,.08)",
          borderRadius: "6px",
          padding: "8px 10px",
          marginBottom: "10px",
        };
        var MUTED = { opacity: 0.65 };
        var HEADING = {
          margin: "14px 0 6px",
          paddingBottom: "4px",
          borderBottom: "1px solid rgba(128,128,128,.28)",
          fontWeight: "bold",
          opacity: 0.9,
        };
        var SUMSUM = {
          border: "1px solid rgba(128,128,128,.3)",
          borderRadius: "6px",
          padding: "8px 10px",
          marginBottom: "4px",
          lineHeight: "1.7",
        };
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
        var MSG_ERR = Object.assign({}, MSG_OK, {
          background: "rgba(239,68,68,.15)",
          maxWidth: "320px",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });

        // ── 编辑器（设置页那个 tab）用的样式 ──────────────────────────────────
        // ⚠️ 全部对齐 dsh 原生的设计令牌（`--dsw-alias-*` / `--dsw-radius-*`）。
        //    取值来自一方实现的 CSS module：dsh-client-ui-settings-plugin-inventory
        //      .card        { border:.5px solid var(--dsw-alias-settings-card-stroke);
        //                     border-radius:var(--dsw-radius-xl);
        //                     background:var(--dsw-alias-settings-card-fill) }
        //      .cardContent { padding:12px 14px }  hover → --dsw-alias-interactive-bg-hover
        //      .cards       { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px }
        //      .cardTitle   { font-size:14px; font-weight:600 }
        //      .cardIdentity{ font-family:var(--ds-font-family-code); font-size:12px;
        //                     color:var(--dsw-alias-label-tertiary) }
        //      .cardDetails { border-top:.5px solid var(--dsw-alias-border-l2);
        //                     background:var(--dsw-alias-bg-module-platform) }
        //      .section     { max-width:760px }
        //    每个 var() 都带兜底值 —— 万一变量名变了也不会变成透明/无边框。
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
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "10px",
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

        function fmtTokens(n) {
          return String(n || 0) + " tokens";
        }

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
        function PickerPanel(props) {
          var data = props.data;
          var sessionId = props.sessionId;
          var busy = props.busy;
          var onClose = props.onClose;
          var onApply = props.onApply;

          // 打开时的初始选择：显式有记录就用它，否则用默认
          var initial = (function () {
            var a = (data && data.assignments) || {};
            if (Object.prototype.hasOwnProperty.call(a, sessionId)) {
              var v = a[sessionId];
              return Array.isArray(v) ? v.slice() : typeof v === "string" && v !== "none" ? [v] : [];
            }
            return ((data && data.defaults) || []).slice();
          })();

          var selSt = react.useState(initial);
          var selected = selSt[0];
          var setSelected = selSt[1];
          var errSt = react.useState(null);
          var err = errSt[0];
          var setErr = errSt[1];
          // ── 这个会话的预设 + 段落改写 ─────────────────────────────────────
          //
          // ⚠️ **会话级的东西放会话头**，不塞进设置页 —— 设置页天然是「全局配置」，
          //    把「只改这个会话」的开关混在那儿，用户分不清自己改的是哪一层。
          var exSt = react.useState(null);
          var extras = exSt[0];
          var setExtras = exSt[1];
          var exBusySt = react.useState(false);
          var exBusy = exBusySt[0];
          var setExBusy = exBusySt[1];
          var exMsgSt = react.useState("");
          var exMsg = exMsgSt[0];
          var setExMsg = exMsgSt[1];

          var loadExtras = react.useCallback(function () {
            return Promise.all([
              fetch(ROUTE_PRESETS + "?session=" + encodeURIComponent(sessionId))
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; }),
              fetch(ROUTE_SECTIONS + "?session=" + encodeURIComponent(sessionId))
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; }),
            ]).then(function (pair) {
              return { presets: pair[0], sections: pair[1] };
            });
          }, [sessionId]);

          react.useEffect(function () {
            var alive = true;
            loadExtras().then(function (d) {
              if (alive) setExtras(d);
              return null;
            });
            return function () {
              alive = false;
            };
          }, [loadExtras]);

          /** 应用一条会话层预设。 */
          function applySessionPreset(id) {
            setExBusy(true);
            setExMsg("");
            return fetch(ROUTE_PRESETS + "?session=" + encodeURIComponent(sessionId), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "apply", id: id }),
            })
              .then(function (r) {
                return r.json().then(function (j) {
                  if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
                  return j;
                });
              })
              .then(function (d) {
                setExMsg("已切换到「" + d.name + "」—— 关掉这个面板后生效");
                onApplied && onApplied();
                return loadExtras();
              })
              .then(function (d) {
                setExtras(d);
                return null;
              })
              .catch(function (e) {
                setExMsg("失败：" + ((e && e.message) || String(e)));
              })
              .then(function () {
                setExBusy(false);
              });
          }

          /** 还原这个会话的一条段落改写。 */
          function restoreSessionSection(name) {
            setExBusy(true);
            return fetch(ROUTE_SECTIONS + "?session=" + encodeURIComponent(sessionId), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: name, action: "restore", scope: "session" }),
            })
              .then(function (r) {
                return r.json().then(function (j) {
                  if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
                  return j;
                });
              })
              .then(function () {
                setExMsg("已还原：" + name);
                return loadExtras();
              })
              .then(function (d) {
                setExtras(d);
                return null;
              })
              .catch(function (e) {
                setExMsg("失败：" + ((e && e.message) || String(e)));
              })
              .then(function () {
                setExBusy(false);
              });
          }

          var prompts = (data && data.prompts) || [];
          var byId = {};
          for (var i = 0; i < prompts.length; i++) byId[prompts[i].id] = prompts[i];

          var hasExplicit =
            data && data.assignments && Object.prototype.hasOwnProperty.call(data.assignments, sessionId);

          // v0.2.2 起没有 replace 模式了，因此**不存在非法组合** ——
          // 以前这里有「两个替换」「替换+追加」两条前端护栏，随模式一起删掉了。

          function toggle(id) {
            setErr(null);
            var next = selected.slice();
            var at = next.indexOf(id);
            if (at >= 0) next.splice(at, 1);
            else next.push(id);
            setSelected(next);
          }

          /** 内置分类表 + 目录里的自定义分类（选词面板按它分组）。 */
          var pickerCategories = (data && data.categories) || [];
          var pickerCustom = (data && data.customCategories) || [];

          function pickerCategoryName(id) {
            for (var i = 0; i < pickerCategories.length; i++) {
              if (pickerCategories[i].id === id) return pickerCategories[i].name;
            }
            return id || "其他";
          }

          /** 整类全选 / 全不选。 */
          function toggleCategory(ids, makeAllOn) {
            setErr(null);
            var next = selected.slice();
            for (var i = 0; i < ids.length; i++) {
              var at = next.indexOf(ids[i]);
              if (makeAllOn && at < 0) next.push(ids[i]);
              else if (!makeAllOn && at >= 0) next.splice(at, 1);
            }
            setSelected(next);
          }

          function renderItem(p) {
            var on = selected.indexOf(p.id) >= 0;
            return react.createElement(
              "div",
              {
                key: p.id,
                style: on ? PICK_ON : PICK,
                onClick: function () {
                  toggle(p.id);
                },
                title: p.description || "",
              },
              react.createElement("span", {
                style: {
                  flex: "none",
                  width: "14px",
                  textAlign: "center",
                  fontWeight: "bold",
                },
              }, on ? "✓" : "　"),
              react.createElement(
                "div",
                { style: { flex: "1 1 auto", minWidth: "0" } },
                react.createElement(
                  "div",
                  null,
                  [
                    react.createElement("strong", { key: "n" }, p.name || p.id),
                    react.createElement(
                      "span",
                      { key: "m", style: MUTED },
                      "  " + (MODE_LABEL[p.mode] || p.mode) + " · order " + (p.order == null ? "?" : p.order) +
                        " · " + fmtTokens(p.tokens),
                    ),
                  ],
                ),
                p.description
                  ? react.createElement(
                      "div",
                      { style: Object.assign({}, MUTED, { marginTop: "3px" }) },
                      p.description,
                    )
                  : null,
              ),
            );
          }

          /** 按分类分组渲染，每组带「全选 / 清空」。 */
          function rows() {
            var out = [];
            if (prompts.length === 0) {
              out.push(react.createElement("div", { key: "empty", style: MUTED }, "提示词库是空的。"));
              return out;
            }

            // 分组顺序：内置五类的固定次序 → 自定义分类按名字排
            var groups = [];
            var known = {};
            for (var a = 0; a < pickerCategories.length; a++) {
              groups.push({ id: pickerCategories[a].id, builtin: true, items: [] });
              known[pickerCategories[a].id] = true;
            }
            var extras = [];
            for (var b = 0; b < prompts.length; b++) {
              var c = (prompts[b] && prompts[b].category) || "other";
              if (!known[c]) {
                known[c] = true;
                extras.push(c);
              }
            }
            extras.sort();
            for (var d = 0; d < extras.length; d++) groups.push({ id: extras[d], builtin: false, items: [] });
            for (var e = 0; e < prompts.length; e++) {
              var pc = (prompts[e] && prompts[e].category) || "other";
              for (var f = 0; f < groups.length; f++) {
                if (groups[f].id === pc) {
                  groups[f].items.push(prompts[e]);
                  break;
                }
              }
            }

            for (var g = 0; g < groups.length; g++) {
              var grp = groups[g];
              if (grp.items.length === 0) continue;
              // 单组只有一条时不显示组标题，免得满屏小标题
              var single = groups.filter(function (x) { return x.items.length > 0; }).length <= 1;
              var ids = grp.items.map(function (x) { return x.id; });
              var allOn = ids.every(function (id) { return selected.indexOf(id) >= 0; });
              if (!single) {
                out.push(
                  react.createElement(
                    "div",
                    { key: "gh-" + grp.id, style: Object.assign({}, CARD_HEADING, { marginBottom: "6px" }) },
                    [
                      react.createElement("span", { key: "n", style: HEADING_TITLE }, pickerCategoryName(grp.id)),
                      react.createElement("span", { key: "c", style: HEADING_COUNT }, grp.items.length + " 条"),
                      !grp.builtin
                        ? react.createElement("span", { key: "t", style: HEADING_COUNT }, "自定义分类")
                        : null,
                      react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                      react.createElement(
                        "button",
                        {
                          key: "all",
                          type: "button",
                          className: "pm-btn",
                          style: BTN,
                          "data-cat-toggle": grp.id,
                          onClick: function () {
                            toggleCategory(ids, !allOn);
                          },
                        },
                        allOn ? "清空本类" : "全选本类",
                      ),
                    ],
                  ),
                );
              }
              for (var h = 0; h < grp.items.length; h++) out.push(renderItem(grp.items[h]));
            }
            void pickerCustom;
            return out;
          }

          var selInOrder = selected
            .filter(function (id) {
              return byId[id];
            })
            .slice()
            .sort(function (a, b) {
              return (byId[a].order || 0) - (byId[b].order || 0);
            });
          var totalTokens = selInOrder.reduce(function (n, id) {
            return n + (byId[id].tokens || 0);
          }, 0);

          // ── 这个会话的预设 + 段落改写 ─────────────────────────────────────
          //
          // 只列**这个会话层**的东西。全局层改了什么不在这儿显示 ——
          // 那是设置页的事，混在一起又变成"分不清改的是哪一层"。
          var sessionExtras = (function () {
            var kids = [];

            if (exMsg) {
              kids.push(react.createElement("div", { key: "msg", style: MUTED }, exMsg));
            }

            // 预设
            var plist = (extras && extras.presets && extras.presets.presets) || [];
            var mine = plist.filter(function (p) {
              return p.scope === "session";
            });
            kids.push(
              react.createElement(
                "div",
                { key: "pt", style: Object.assign({}, MUTED, { marginTop: "10px", fontWeight: 600 }) },
                "这个会话的预设",
              ),
            );
            if (mine.length === 0) {
              kids.push(
                react.createElement(
                  "div",
                  { key: "pn", style: MUTED },
                  "还没有。在设置页调好这个会话的配置后，可以存成预设。",
                ),
              );
            } else {
              var matched =
                extras && extras.presets && extras.presets.matched && extras.presets.matched.session;
              kids.push(
                react.createElement(
                  "div",
                  { key: "pc", style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" } },
                  mine.map(function (p) {
                    var isCur = matched && matched.id === p.id;
                    return react.createElement(
                      "button",
                      {
                        key: p.id,
                        type: "button",
                        className: "pm-btn",
                        style: exBusy ? BTN_BUSY : isCur ? BTN_PRIMARY : BTN,
                        disabled: exBusy,
                        title: p.summary,
                        onClick: function () {
                          applySessionPreset(p.id);
                        },
                      },
                      p.name + (isCur ? " ✓" : ""),
                    );
                  }),
                ),
              );
            }

            // 段落改写（只列被改过的）
            var applied =
              (extras && extras.sections && extras.sections.applied) || [];
            var stale = (extras && extras.sections && extras.sections.stale) || [];
            var changed = applied.concat(stale);
            kids.push(
              react.createElement(
                "div",
                { key: "st", style: Object.assign({}, MUTED, { marginTop: "10px", fontWeight: 600 }) },
                "这个会话改写过的原生段落",
              ),
            );
            if (changed.length === 0) {
              kids.push(
                react.createElement(
                  "div",
                  { key: "se", style: MUTED },
                  "这个会话没单独改过段落。要改的话去设置页（那里配的是全局，或在这里…）",
                ),
              );
            } else {
              kids.push(
                react.createElement(
                  "div",
                  { key: "sl", style: { marginTop: "4px" } },
                  changed.map(function (row) {
                    return react.createElement(
                      "div",
                      {
                        key: row.name,
                        style: { display: "flex", alignItems: "center", gap: "8px", padding: "2px 0" },
                      },
                      [
                        react.createElement(
                          "span",
                          { key: "n", style: { flex: "1 1 auto", fontSize: "12px" } },
                          row.name + (row.action === "disable" ? "（已关掉）" : "（已改写）"),
                        ),
                        react.createElement(
                          "button",
                          {
                            key: "r",
                            type: "button",
                            className: "pm-btn",
                            style: exBusy ? BTN_BUSY : BTN,
                            disabled: exBusy,
                            title: "删掉这个会话对它的改写，回落到全局/官方",
                            onClick: function () {
                              restoreSessionSection(row.name);
                            },
                          },
                          "还原",
                        ),
                      ],
                    );
                  }),
                ),
              );
            }

            return react.createElement("div", { key: "extras" }, kids);
          })();

          return react.createElement(
            Overlay,
            { onClose: onClose },
            react.createElement(
              "div",
              { style: PANEL_HEAD },
              react.createElement(
                "div",
                null,
                [
                  react.createElement("strong", { key: "t" }, "选择本会话的提示词"),
                  react.createElement(
                    "span",
                    { key: "s", style: MUTED },
                    "　可以多选；各自按 order 排序插入" +
                      (hasExplicit ? "（本会话已显式指定）" : "（当前来自全局默认）"),
                  ),
                ],
              ),
              react.createElement("button", { type: "button", style: BTN, onClick: onClose }, "关闭"),
            ),
            react.createElement("div", { style: PANEL_BODY }, [
              err
                ? react.createElement(
                    "div",
                    { key: "err", style: WARN },
                    [react.createElement("strong", { key: "t" }, "应用失败："), err],
                  )
                : null,
              react.createElement("div", { key: "list" }, rows()),
              // ── 这个会话的预设 / 段落改写 ──────────────────────────────
              //
              // ⚠️ **会话级的东西放会话头**，不塞进设置页。
              //    设置页天然是「全局配置」的地方；把「只改这个会话」的开关
              //    混在那儿，用户分不清自己改的是哪一层。
              sessionExtras,
            ]),
            react.createElement(
              "div",
              { style: PANEL_FOOT },
              react.createElement(
                "div",
                { style: MUTED },
                selInOrder.length === 0
                  ? "未选任何提示词 → 该会话不注入"
                  : "已选 " + selInOrder.length + " 条 · 共 " +
                    fmtTokens(totalTokens) + "（" +
                    selInOrder
                      .map(function (id) {
                        return (byId[id].name || id) + "@" + (byId[id].order == null ? "?" : byId[id].order);
                      })
                      .join(" → ") +
                    "）",
              ),
              react.createElement(
                "div",
                { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
                [
                  react.createElement(
                    "button",
                    {
                      key: "apply",
                      type: "button",
                      style: busy ? BTN_BUSY : BTN,
                      disabled: busy,
                      onClick: function () {
                        onApply(selected, setErr);
                      },
                    },
                    "应用",
                  ),
                  react.createElement(
                    "button",
                    {
                      key: "def",
                      type: "button",
                      style: busy ? BTN_BUSY : BTN,
                      disabled: busy,
                      title: "清除本会话的指定，改回跟随全局默认",
                      onClick: function () {
                        onApply(null, setErr);
                      },
                    },
                    "跟随默认",
                  ),
                  react.createElement(
                    "button",
                    {
                      key: "none",
                      type: "button",
                      style: busy ? BTN_BUSY : BTN,
                      disabled: busy,
                      title: "显式指定为不注入（即使默认里有东西也不挂）",
                      onClick: function () {
                        onApply([], setErr);
                      },
                    },
                    "不注入",
                  ),
                ],
              ),
            ),
          );
        }

        // ── 预览面板 ──────────────────────────────────────────────────────────
        function PreviewPanel(props) {
          var data = props.data;
          if (!data) return null;

          var rows = [];
          if (data.error) {
            rows.push(react.createElement("div", { key: "err", style: WARN }, "预览失败：" + data.error));
            if (data.hint) {
              rows.push(react.createElement("div", { key: "hint", style: MUTED }, "可能原因：" + data.hint));
            }
          } else {
            if (data.conflict) {
              rows.push(
                react.createElement("div", { key: "conflict", style: WARN }, [
                  react.createElement("strong", { key: "t" }, "⚠ 冲突："),
                  data.conflict.message,
                  react.createElement("div", { key: "h", style: MUTED }, data.conflict.hint || ""),
                ]),
              );
            }
            // 汇总：分开报 sections / contexts / tools
            rows.push(
              react.createElement("div", { key: "sum", style: SUMSUM }, [
                react.createElement(
                  "div",
                  { key: "a" },
                  react.createElement("strong", null, "模型实际收到 ≈ " + fmtTokens(data.totalTokens)),
                ),
                react.createElement(
                  "div",
                  { key: "b", style: MUTED },
                  "系统提示词 " + (data.sectionCount || 0) + " 段 = " + fmtTokens(data.sectionTokens) +
                    "　·　工具 schema " + (data.toolCount || 0) + " 个 = " + fmtTokens(data.toolTokens) +
                    "　·　运行时上下文 " + (data.contextCount || 0) + " 段 = " + fmtTokens(data.contextTokens),
                ),
                react.createElement(
                  "div",
                  { key: "c", style: MUTED },
                  // 说清两件事，免得看着像"少了东西"：
                  //   1. 运行时上下文是**独立一条消息**，本来就不在 system/message 里
                  //   2. 0 段不代表出错 —— 没有 goal / todo 时那些提供者本来就该是空的
                  (data.contextCount || 0) === 0
                    ? "运行时上下文是「单独一条消息」（「Current runtime context…」），不在下面的正文里；" +
                      "当前会话没有，属正常。"
                    : "运行时上下文是「单独一条消息」，不在下面的正文里 —— 所以下面的正文比总数少一块。",
                ),
              ]),
            );

            // 当前挂的是哪几条
            if ((data.prompts || []).length) {
              rows.push(
                react.createElement(
                  "div",
                  { key: "mine", style: MUTED },
                  "本会话挂载：" +
                    data.prompts
                      .map(function (p) {
                        return (p.name || p.id) + "(" + (MODE_LABEL[p.mode] || p.mode) + ",order=" + p.order + ")";
                      })
                      .join(" → ") +
                    (data.source === "default" ? "　［来自全局默认］" : "　［显式指定］"),
                ),
              );
            }

            // 第一优先：会话日志里的 ground truth
            rows.push(
              react.createElement(
                "div",
                { key: "h-logged", style: HEADING },
                data.logged && data.logged.ok
                  ? "系统提示词正文（模型上次实际收到的）· " + fmtTokens(data.logged.tokens)
                  : "系统提示词正文（模型上次实际收到的）— 读不到",
              ),
            );
            if (data.logged && data.logged.ok) {
              rows.push(
                react.createElement("div", { key: "logged", style: SEC_OURS }, [
                  react.createElement(
                    "div",
                    { key: "m", style: MUTED },
                    "第 " + (data.logged.turn == null ? "?" : data.logged.turn) +
                      " 轮 / 第 " + (data.logged.step == null ? "?" : data.logged.step) +
                      " 步 · " + data.logged.chars + " 字符 · 日志共 " +
                      (data.logged.eventCount == null ? "?" : data.logged.eventCount) +
                      " 条事件、其中 " + data.logged.messageCount +
                      " 条 system/message。{{变量}} 已由 dsh 替换完毕。",
                  ),
                  react.createElement(
                    "div",
                    { key: "why", style: MUTED },
                    // 轮次看着旧是正常的：dsh 只在提示词**变化时**才写这条日志
                    // （dsh-agent-loop project() 里 `if (latest.text === rendered) return []`）。
                    // 没说清的话，用户会以为这份是过期的。
                    "轮次看着旧是正常的 —— dsh 只在提示词「发生变化时」才写这条日志。" +
                      "没变就说明当前生效的就是这一份。",
                  ),
                  react.createElement(
                    "div",
                    { key: "n", style: MUTED },
                    "⚠ 这份只含文字段落，不含下面的工具定义 —— 工具走的是模型 API 自己的 " +
                      "tools 参数，不写进 system/message。",
                  ),
                  react.createElement("pre", { key: "t", style: MONO_TAIL }, data.logged.text),
                ]),
              );
            } else {
              var reasons = [
                react.createElement(
                  "div",
                  { key: "r0" },
                  react.createElement("strong", null, "原因："),
                  (data.logged && data.logged.reason) || "未知（宿主没有返回 logged 字段）",
                ),
              ];
              if (data.logged && data.logged.eventTypes) {
                reasons.push(
                  react.createElement(
                    "div",
                    { key: "r1", style: MUTED },
                    "日志里真实出现的事件类型：" +
                      data.logged.eventTypes
                        .map(function (p) {
                          return p[0] + "×" + p[1];
                        })
                        .join("、"),
                  ),
                );
              }
              if (data.logged && data.logged.availableMethods) {
                reasons.push(
                  react.createElement(
                    "div",
                    { key: "r2", style: MUTED },
                    "session 上可用的方法：" + (data.logged.availableMethods.join("、") || "（一个都没取到）"),
                  ),
                );
              }
              rows.push(react.createElement("div", { key: "logged-none", style: ADVISE }, reasons));
            }

            // 逐段
            rows.push(
              react.createElement(
                "div",
                { key: "h-sections", style: HEADING },
                "Sections（未插值原文）· " + fmtTokens(data.sectionTokens),
              ),
            );
            (data.sections || []).forEach(function (s, i) {
              if (!s || typeof s !== "object") return;
              var ours = (data.prompts || []).some(function (p) {
                return "prompt-manager:" + p.id === s.name;
              });
              rows.push(
                react.createElement("div", { key: "s" + i, style: ours ? SEC_OURS : SEC }, [
                  react.createElement("div", { key: "h" }, [
                    react.createElement("strong", { key: "n" }, s.name),
                    s.complete
                      ? react.createElement("span", { key: "c", style: MUTED }, "  [complete 覆盖]")
                      : null,
                    react.createElement(
                      "span",
                      { key: "t", style: MUTED },
                      "  " + fmtTokens(s.tokens) + " · " + s.chars + " 字符" + (ours ? "  ← 本插件" : ""),
                    ),
                  ]),
                  s.text
                    ? react.createElement("pre", { key: "p", style: MONO }, s.text + (s.truncated ? "\n…（已截断）" : ""))
                    : null,
                ]),
              );
            });

            // 上下文段
            if ((data.contexts || []).length) {
              rows.push(
                react.createElement(
                  "div",
                  { key: "h-ctx", style: HEADING },
                  "上下文段（runtime context）· " + fmtTokens(data.contextTokens),
                ),
              );
              (data.contexts || []).forEach(function (c, i) {
                if (!c || typeof c !== "object") return;
                rows.push(
                  react.createElement("div", { key: "c" + i, style: SEC }, [
                    react.createElement("div", { key: "h" }, [
                      react.createElement("strong", { key: "n" }, c.name),
                      react.createElement("span", { key: "t", style: MUTED }, "  " + fmtTokens(c.tokens) + " · " + c.chars + " 字符"),
                    ]),
                    c.text
                      ? react.createElement("pre", { key: "p", style: MONO }, c.text + (c.truncated ? "\n…（已截断）" : ""))
                      : null,
                  ]),
                );
              });
            }

            // 工具 schema
            if ((data.tools || []).length) {
              rows.push(
                react.createElement(
                  "div",
                  { key: "h-tools", style: HEADING },
                  "工具 schema · " + data.tools.length + " 个 · " + fmtTokens(data.toolTokens) +
                    "（按 名字+描述+参数 JSON 估算）",
                ),
              );
              (data.tools || []).forEach(function (t, i) {
                if (!t || typeof t !== "object") return;
                rows.push(
                  react.createElement("div", { key: "t" + i, style: SEC }, [
                    react.createElement("span", { key: "i", style: MUTED }, i + 1 + ". "),
                    react.createElement("strong", { key: "n" }, t.name),
                    react.createElement(
                      "span",
                      { key: "t", style: MUTED },
                      "  " + fmtTokens(t.tokens) + " · " + t.chars + " 字符" + (t.deferLoading ? " · deferLoading" : ""),
                    ),
                  ]),
                );
              });
            }
          }

          return react.createElement(
            Overlay,
            { onClose: props.onClose },
            react.createElement(
              "div",
              { style: PANEL_HEAD },
              react.createElement("strong", null, "最终系统提示词预览"),
              react.createElement("button", { type: "button", style: BTN, onClick: props.onClose }, "关闭"),
            ),
            react.createElement("div", { style: PANEL_BODY }, rows),
          );
        }

        // ── 会话头部的入口 ────────────────────────────────────────────────────
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
            : (data && data.defaults) || [];

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
          var label = "不注入";
          if (currentIds.length > 0) {
            var first = byId[currentIds[0]];
            label = (first && first.name) || currentIds[0];
            if (currentIds.length > 1) label += " +" + (currentIds.length - 1);
            // 来源要**看得见**，不能只靠状态点颜色 + tooltip。
            // 「来自默认」是常态（正是全局默认的意义），标出来才知道这条不是为
            // 本会话专门设的。
            if (!hasExplicit) label += " ·默认";
          } else if (overrideNames.length > 0) {
            // 没加自设提示词，但改了原生段落 —— 不能说「不注入」（那是在骗人）
            label = "默认";
          }
          // 改写原生段落：追加，不覆盖上面的名字
          if (overrideNames.length > 0) label += " ·改原生 " + overrideNames.length + " 段";

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
          var title = "提示词管理 · " + statusText;

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
              ? react.createElement(PickerPanel, {
                  data: data,
                  sessionId: sessionId,
                  busy: busy,
                  onClose: function () {
                    setPicking(false);
                  },
                  onApply: doAssign,
                })
              : null,
            preview
              ? react.createElement(PreviewPanel, {
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
        //   ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register(
        //     { name: "settings.plugins.tab", id, order, label: () => "…" }, Component))
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
          /** 拖动经过哪一侧（"active" / "avail" / null）—— 只用于高亮 */
          var dragSt = react.useState(null);
          var dragOver = dragSt[0];
          var setDragOver = dragSt[1];
          /** 总开关的本地态（带乐观更新 —— 拨一下立刻变色，失败再回滚） */
          var enSt = react.useState(null);
          var enabledDraft = enSt[0];
          var setEnabledDraft = enSt[1];
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
           * 生效列表的一侧（可勾选、可拖放）。
           *
           * ⚠️ **勾选和拖动走同一条路** —— 两个入口都是为了表达「这条提示词在不在
           *    生效列表里」，最终都调 setActivePrompts 写一次完整集合。
           *    不做「拖动只改顺序」这种事：顺序由每条提示词自己的 order 决定，
           *    不在这里管。
           */
          function renderComboSide(side, title, rows, ids, otherIds) {
            var isActive = side === "active";
            var highlighted = dragOver === side;
            var children = [
              react.createElement(
                "div",
                { key: "h", style: { fontSize: "12px", fontWeight: 600, margin: "0 0 6px" } },
                title + "（" + rows.length + "）",
              ),
            ];

            if (rows.length === 0) {
              children.push(
                react.createElement(
                  "div",
                  { key: "e", style: Object.assign({}, HINT_TEXT, { padding: "8px 0" }) },
                  isActive ? "还没有 —— 从左边勾选或拖进来" : "都已在生效列表里",
                ),
              );
            }

            for (var i = 0; i < rows.length; i++) {
              (function (p) {
                var activeNow = ids.indexOf(p.id) >= 0;
                children.push(
                  react.createElement(
                    "div",
                    {
                      key: p.id,
                      // 拖动：HTML5 DnD。拖起时把 id 放进 dataTransfer，
                      // 放下的那一侧读出来决定加还是减。
                      draggable: !presetsBusy,
                      onDragStart: function (e) {
                        try {
                          e.dataTransfer.setData("text/plain", p.id);
                          e.dataTransfer.effectAllowed = "move";
                        } catch {
                          /* 某些浏览器只读，忽略 */
                        }
                      },
                      onDragOver: function (e) {
                        e.preventDefault(); // 不 preventDefault 就不允许放下
                        if (dragOver !== side) setDragOver(side);
                      },
                      onDragLeave: function () {
                        if (dragOver === side) setDragOver(null);
                      },
                      onDrop: function (e) {
                        e.preventDefault();
                        setDragOver(null);
                        var id = "";
                        try {
                          id = e.dataTransfer.getData("text/plain");
                        } catch {
                          /* 忽略 */
                        }
                        if (!id) return;
                        // 放下 = 把这条移进这一侧
                        var base = ids.indexOf(id) < 0 ? ids.concat([id]) : ids;
                        if (side === "avail") base = base.filter(function (x) { return x !== id; });
                        if (base.length === ids.length && base.indexOf(id) >= 0) return; // 没变化
                        setActivePrompts(computeOrder(base, prompts), sectionScope, sectionSessionId);
                      },
                      style: Object.assign({}, COMBO_ROW, highlighted ? COMBO_ROW_HL : {}),
                    },
                    [
                      react.createElement("input", {
                        key: "cb",
                        type: "checkbox",
                        checked: activeNow,
                        disabled: presetsBusy,
                        onChange: function () {
                          var next = activeNow
                            ? ids.filter(function (x) { return x !== p.id; })
                            : ids.concat([p.id]);
                          setActivePrompts(next, sectionScope, sectionSessionId);
                        },
                      }),
                      react.createElement("span", { key: "n", style: { flex: "1 1 auto" } }, p.name || p.id),
                      react.createElement(
                        "span",
                        { key: "c", style: HEADING_COUNT },
                        (p.category || "") + (p.mode === "none" ? "" : ""),
                      ),
                    ],
                  ),
                );
              })(rows[i]);
            }

            return react.createElement(
              "div",
              {
                key: side,
                style: Object.assign({}, COMBO_SIDE, highlighted ? COMBO_SIDE_HL : {}),
              },
              children,
            );
          }

          /**
           * 按分类建议顺序排一下 —— 让拖动进来的提示词落在合理位置。
           *
           * 只做**稳定排序**，不改任何人的 order（order 是每条提示词自己的属性，
           * 由 editor 那边管）。看起来是"拖动改了顺序"，实际上是"顺序本来就按
           * 分类定的"，这里只是保持一致。
           */
          function computeOrder(ids, allPrompts) {
            return ids.slice();
          }

          /**
           * 总开关（胶囊）。
           *
           * ⚠️ **这是「一键回到原生」的出口。**
           *
           *    关掉 = 本插件对提示词的一切干预全部停用：不注入自设提示词、
           *    不改写原生段落。等价于原生 dsh。
           *
           *    但要**保留所有配置** —— 用户拨回来就该原样恢复。所以这里不是
           *    「清空配置」，而是装配时清空自己注入的段落（见 session-injection.mjs）。
           *
           *    为什么需要它：调完一堆东西之后想对比「原生 dsh 是什么样」，
           *    或者怀疑某个改动搞坏了什么想一键排除 —— 没有这个开关就只能
           *    一条条去清。
           */
          function renderMasterSwitch() {
            var on = enabledDraft !== false;
            var busy = enabledDraft === null;
            return react.createElement(
              "div",
              { style: Object.assign({}, CARD, { padding: "12px 14px", marginBottom: "12px" }) },
              [
                react.createElement("div", { key: "row", style: { display: "flex", alignItems: "center", gap: "10px" } }, [
                  // 胶囊本体 —— 用 button 做，键盘可达
                  react.createElement(
                    "button",
                    {
                      key: "pill",
                      type: "button",
                      className: "pm-btn",
                      title: on ? "点击关闭：完全用 dsh 原始提示词" : "点击开启：使用你配置的提示词",
                      disabled: busy,
                      onClick: function () {
                        toggleEnabled(!on);
                      },
                      style: Object.assign({}, PILL_SWITCH, on ? PILL_ON : PILL_OFF),
                    },
                    react.createElement("span", { style: Object.assign({}, PILL_KNOB, on ? { left: "18px" } : { left: "2px" }) }),
                  ),
                  react.createElement(
                    "span",
                    { key: "t", style: { fontSize: "13px", fontWeight: 600 } },
                    on ? "使用我的提示词配置" : "正在使用 dsh 原始提示词",
                  ),
                ]),
                react.createElement(
                  "div",
                  { key: "h", style: Object.assign({}, HINT_TEXT, { margin: "6px 0 0 46px" }) },
                  on
                    ? "关掉它就完全回到原生 dsh —— 不注入自设提示词，也不改写原生段落。配置都留着，开回来就恢复。"
                    : "你配好的东西都还在，只是暂时不生效。开回来即可恢复。",
                ),
              ],
            );
          }

          /** 提示词组合 + 快速预设 整块。 */
          function renderCombo() {
            var head = react.createElement(
              "div",
              { style: Object.assign({}, CARD_HEADING, { marginTop: "4px" }) },
              [
                react.createElement("span", { key: "n", style: HEADING_TITLE }, "提示词组合"),
                react.createElement(
                  "span",
                  { key: "c", style: HEADING_COUNT },
                  presetsData && presetsData.matched
                    ? (presetsData.matched[sectionScope === "session" ? "session" : "global"]
                        ? "当前：预设「" +
                          presetsData.matched[sectionScope === "session" ? "session" : "global"].name +
                          "」"
                        : "相对预设已改动")
                    : "读取中…",
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

            // 当前层的生效 id 列表
            var layer =
              sectionScope === "session"
                ? presetsData.layers && presetsData.layers.session
                : presetsData.layers && presetsData.layers.global;
            var activeIds = (layer && Array.isArray(layer.prompts) ? layer.prompts : []).slice();

            var usable = [];
            for (var pi = 0; pi < prompts.length; pi++) {
              // 「不注入」这种 mode:none 的条目不参与 —— 它是占位，不是提示词
              if (prompts[pi] && prompts[pi].mode !== "none") usable.push(prompts[pi]);
            }
            var activeRows = [];
            var availRows = [];
            for (var ui = 0; ui < usable.length; ui++) {
              if (activeIds.indexOf(usable[ui].id) >= 0) activeRows.push(usable[ui]);
              else availRows.push(usable[ui]);
            }
            // 生效列表按 activeIds 的顺序显示（那是真实的注入顺序）
            activeRows.sort(function (a, b) {
              return activeIds.indexOf(a.id) - activeIds.indexOf(b.id);
            });

            var children = [head];

            if (sectionScope === "session" && !sectionSessionId) {
              children.push(
                react.createElement(
                  "div",
                  { key: "nosid", style: WARN },
                  "选了「只改某个会话」但还没挑会话 —— 在下面「系统提示词」的开关那里选一个。",
                ),
              );
            }

            children.push(
              react.createElement("div", { key: "board", style: COMBO_BOARD }, [
                renderComboSide("active", "生效", activeRows, activeIds, []),
                renderComboSide("avail", "可用", availRows, activeIds, []),
              ]),
            );
            children.push(
              react.createElement(
                "div",
                { key: "tip", style: HINT_TEXT },
                "勾选或拖动切换。顺序由每条提示词自己的 order 决定，这里不管顺序。" +
                  (sectionScope === "global"
                    ? "当前改的是**全局默认**（影响所有会话）。"
                    : "当前改的是**这一个会话**。"),
              ),
            );

            // ── 快速预设 ────────────────────────────────────────────────────
            children.push(
              react.createElement(
                "div",
                { key: "ph", style: Object.assign({}, CARD_HEADING, { marginTop: "12px" }) },
                [react.createElement("span", { key: "n", style: HEADING_TITLE }, "快速预设")],
              ),
            );

            var list = presetsData.presets || [];
            if (list.length === 0) {
              children.push(
                react.createElement(
                  "div",
                  { key: "pe", style: HINT_TEXT },
                  "还没有预设。调好一套配置（哪些提示词生效 + 哪些段落改写），然后存下来。",
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
                              doPreset(
                                { action: "apply", id: p.id },
                                p.scope,
                                sectionSessionId,
                              );
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

            // 存为预设
            children.push(
              react.createElement("div", { key: "ps", style: ACTIONS }, [
                react.createElement("span", { key: "l", style: HINT_TEXT }, "把当前状态存为预设："),
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

          /** 「系统提示词」整块。 */
          function renderSections() {
            var head = react.createElement(
              "div",
              { style: Object.assign({}, CARD_HEADING, { marginTop: "4px" }) },
              [
                react.createElement("span", { key: "n", style: HEADING_TITLE }, "系统提示词"),
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

            var intro = react.createElement(
              "div",
              { style: HINT_TEXT },
              "这些是 dsh 自己往系统提示词里放的段落。可以逐段改写或关掉，也能还原。" +
                "官方以后新增段落会自动出现在这里，改过的会标出来 —— 你的改动不会被官方更新顶掉。",
            );

            // ── 这里只配**全局默认** ──────────────────────────────────────
            //
            // ⚠️ 会话级的选择**不放在设置页** —— 设置页天然是「全局配置」的地方，
            //    把「只改这个会话」的开关混在这儿，用户分不清自己改的是哪一层。
            //    会话级的东西在**会话头**那个按钮里（跟「标准模式」同一行）。
            var scopeHint = react.createElement(
              "div",
              { style: HINT_TEXT },
              "这里改的是**全局默认**，所有会话都生效。" +
                "只想改某一个会话的话，用会话头那一行的「提示词」按钮。",
            );

            if (sections === null) {
              return react.createElement("div", null, [
                head,
                intro,
                scopeHint,
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

            return react.createElement("div", null, [head, intro, scopeHint].concat(items));
          }

          /** 保存全局默认。 */
          var saveDefaults = react.useCallback(
            function (ids) {
              setDefaultsBusy(true);
              fetch(ROUTE_DEFAULTS, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ promptIds: ids }),
              })
                .then(function (res) {
                  return res.json().then(function (j) {
                    if (!res.ok) throw new Error((j && j.error) || "HTTP " + res.status);
                    return j;
                  });
                })
                .then(function (d) {
                  if (!mountedRef.current) return null;
                  var next = Array.isArray(d.defaults) ? d.defaults : ids;
                  setDefaultsDraft(next.slice());
                  setList(function (prev) {
                    return Object.assign({}, prev || {}, { defaults: next.slice() });
                  });
                  setErr(null);
                  flash(
                    next.length === 0
                      ? "已清空默认 —— 新会话将不注入"
                      : "新会话将默认挂 " + next.length + " 条" +
                        (d.refreshed ? "（已更新 " + d.refreshed + " 个进行中的会话）" : ""),
                  );
                  return null;
                })
                .catch(function (e) {
                  if (!mountedRef.current) return;
                  var m = (e && e.message) || String(e);
                  setErr(m);
                  flash("保存默认失败：" + m);
                })
                .then(function () {
                  if (mountedRef.current) setDefaultsBusy(false);
                });
            },
            [flash],
          );

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
                  style: CARD_HEAD,
                  "aria-expanded": isOpen,
                  onClick: function () {
                    toggleOpen(p.id);
                  },
                },
                react.createElement("div", { style: CARD_MAIN_ROW }, [
                  react.createElement("span", { key: "t", style: CARD_TITLE }, p.name || p.id),
                  pillFor(p.mode),
                  react.createElement("span", { key: "c", style: isOpen ? CHEVRON_OPEN : CHEVRON }, "›"),
                ]),
                react.createElement("span", { key: "id", style: CARD_ID }, p.id),
                p.description
                  ? react.createElement("span", { key: "d", style: CARD_DESC }, p.description)
                  : null,
              ),
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

          /**
           * 「新会话默认」卡片。
           *
           * 这块以前**完全没有界面** —— 会话里能点「跟随默认」，却没地方设定默认是什么，
           * 只能手打 POST /api/prompt-manager/defaults。现在补上。
           */
          function renderDefaults() {
            var saved = (list && Array.isArray(list.defaults) ? list.defaults : []).slice();
            var draft = Array.isArray(defaultsDraft) ? defaultsDraft : saved;
            var dirty = JSON.stringify(draft.slice().sort()) !== JSON.stringify(saved.slice().sort());

            function toggleDefault(id) {
              var next = draft.slice();
              var at = next.indexOf(id);
              if (at >= 0) next.splice(at, 1);
              else next.push(id);
              setDefaultsDraft(next);
            }

            var boxes = [];
            for (var i = 0; i < prompts.length; i++) {
              (function (p) {
                if (!p || !p.id || p.mode === "none") return; // 不注入的条目不参与默认
                var on = draft.indexOf(p.id) >= 0;
                boxes.push(
                  react.createElement(
                    "label",
                    {
                      key: p.id,
                      style: Object.assign({}, FORM_LINE, { flex: "0 0 auto", cursor: "pointer" }),
                      title: p.description || p.id,
                    },
                    react.createElement("input", {
                      type: "checkbox",
                      checked: on,
                      onChange: function () {
                        toggleDefault(p.id);
                      },
                    }),
                    react.createElement("span", null, p.name || p.id),
                    react.createElement("span", { style: HEADING_COUNT }, fmtTokens(p.tokens)),
                  ),
                );
              })(prompts[i]);
            }

            return react.createElement("div", { style: Object.assign({}, CARD, { marginBottom: "10px" }) }, [
              react.createElement(
                "div",
                { key: "head", style: CARD_HEAD },
                react.createElement("div", { style: CARD_MAIN_ROW }, [
                  react.createElement("span", { key: "t", style: CARD_TITLE }, "新会话默认"),
                  react.createElement(
                    "span",
                    { key: "c", style: HEADING_COUNT },
                    saved.length === 0 ? "当前：不注入" : "当前 " + saved.length + " 条",
                  ),
                ]),
                react.createElement(
                  "span",
                  { key: "d", style: CARD_DESC },
                  "新开的会话自动挂这几条。已经单独指定过的会话不受影响；" +
                    "想让它改跟默认，在会话头部点「跟随默认」。",
                ),
              ),
              react.createElement("div", { key: "body", style: CARD_DETAILS }, [
                boxes.length
                  ? react.createElement(
                      "div",
                      { key: "boxes", style: { display: "flex", flexWrap: "wrap", gap: "6px 18px" } },
                      boxes,
                    )
                  : react.createElement(
                      "div",
                      { key: "none", style: STATUS_LINE },
                      "库里还没有可用的提示词（「不注入」这种条目不参与默认）。",
                    ),
                react.createElement("div", { key: "act", style: CARD_ACTIONS }, [
                  react.createElement(
                    "span",
                    { key: "st", style: STATUS_LINE },
                    (draft.length === 0
                      ? "新会话将不注入任何提示词"
                      : "新会话将挂 " + draft.length + " 条") + (dirty ? "　·　有未保存的改动" : ""),
                  ),
                  react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
                  react.createElement(
                    "button",
                    {
                      key: "clear",
                      type: "button",
                      className: "pm-btn",
                      style: defaultsBusy || draft.length === 0 ? DETAIL_BTN_BUSY : DETAIL_BTN,
                      disabled: defaultsBusy || draft.length === 0,
                      onClick: function () {
                        setDefaultsDraft([]);
                        saveDefaults([]);
                      },
                    },
                    "清空",
                  ),
                  react.createElement(
                    "button",
                    {
                      key: "save",
                      type: "button",
                      className: "pm-btn",
                      style: defaultsBusy || !dirty ? DETAIL_BTN_BUSY : DETAIL_BTN,
                      disabled: defaultsBusy || !dirty,
                      onClick: function () {
                        saveDefaults(draft.slice());
                      },
                    },
                    defaultsBusy ? "保存中…" : "保存默认",
                  ),
                ]),
              ]),
            ]);
          }

          // 分组标题（对齐原生 .catalogHeading：h3 + 计数）
          var header = react.createElement("div", { style: CARD_HEADING }, [
            react.createElement("h3", { key: "t", style: Object.assign({}, HEADING_TITLE, { margin: 0 }) }, "提示词管理"),
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
          ]);

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
            // 「新会话默认」放在最前面 —— 它管的是所有新会话，比单条提示词重要
            body.push(react.createElement("div", { key: "defaults" }, renderDefaults()));
            // "新建"表单放在网格之外（它需要整行宽度）
            if (edit && edit.isNew) {
              body.push(
                react.createElement(
                  "div",
                  { key: "new", style: Object.assign({}, CARD, { marginBottom: "10px" }) },
                  react.createElement("div", { style: CARD_DETAILS }, renderForm()),
                ),
              );
            }
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
              body.push(
                react.createElement(
                  "div",
                  { key: "empty", style: STATUS_LINE },
                  "提示词库是空的，点「新建」加一条。",
                ),
              );
            }
            for (var gk = 0; gk < groups.length; gk++) {
              var g = groups[gk];
              if (g.items.length === 0) continue;
              body.push(
                react.createElement(
                  "div",
                  { key: "grp-" + g.id, style: Object.assign({}, CARD_HEADING, { marginTop: "4px" }) },
                  [
                    react.createElement("span", { key: "n", style: HEADING_TITLE }, categoryName(g.id)),
                    react.createElement("span", { key: "c", style: HEADING_COUNT }, g.items.length + " 条"),
                    seen[g.id] && !builtinCategories.some(function (b) { return b.id === g.id; })
                      ? react.createElement("span", { key: "t", style: HEADING_COUNT }, "自定义分类")
                      : null,
                  ],
                ),
              );
              var groupCards = [];
              for (var gm = 0; gm < g.items.length; gm++) groupCards.push(renderRow(g.items[gm]));
              body.push(react.createElement("div", { key: "grid-" + g.id, style: CARDS_GRID }, groupCards));
            }
          }

          body.push(
            react.createElement("div", { key: "master" }, renderMasterSwitch()),
            react.createElement("div", { key: "combo" }, renderCombo()),
            react.createElement("div", { key: "sections" }, renderSections()),
          );

          body.push(
            react.createElement("div", { key: "hint", style: HINT }, [
              react.createElement("span", { key: "a" }, "order 决定插入位置：100 在 persona 之后、工具说明之前；2900 在工具说明之后。"),
              react.createElement("span", { key: "b" }, "改动保存后立即重载，并自动重挂所有已分配的会话 —— 下一步就生效。"),
              list && list.promptsDir
                ? react.createElement("span", { key: "c" }, "正文写在：" + list.promptsDir)
                : null,
            ]),
          );

          return react.createElement("div", { style: SECTION }, [header].concat(body));
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

        function apply(ctx) {
          ensureEditorStyles();
          // 会话头部：每个会话的多选器
          ctx.slots.inject("conversation.session.header.actions", () =>
            ctx.slots.register(
              { name: "conversation.session.header.actions", id: "prompt-picker", order: 40 },
              PromptPicker,
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
              PromptEditor,
            ),
          );
        }

        exports.name = "dsh-prompt-manager";
        exports.inject = inject;
        exports.apply = apply;
        exports.ROUTES = { ROUTE_STATE, ROUTE_ASSIGN, ROUTE_PREVIEW, ROUTE_RELOAD, ROUTE_DEFAULTS, ROUTE_EDIT };
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[AI Client Sandbox] dsh-prompt-manager runtime error:", err);
  }
})();