// 个人提示词 (dsh-prompt-easymanager) · 客户端宿主
//
// 这个文件只做三件事：注册两个槽位、渲染会话头部那一个按钮、按需拉下面的 chunk。
//
//   client.picker.js    多选面板 + 会话头部入口
//   client.preview.js   最终系统提示词预览
//   client.editor.js    设置页「个人提示词」整栏（最大的一块）
//   client.host-dom.js  新会话页 DOM 补丁与 picker 挂载
//
// 浮层外壳（Overlay + OVERLAY / PANEL 那一族常量）没有独立 chunk：面板和预览
// 各自定义同一个 Overlay 组件，常量从这里随 api.style 交下去。
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
    const ROUTE_STATE = "/api/prompt-easymanager/state";
    const ROUTE_ASSIGN = "/api/prompt-easymanager/assign";
    const ROUTE_PREVIEW = "/api/prompt-easymanager/preview";
    const ROUTE_RELOAD = "/api/prompt-easymanager/reload";
        const ROUTE_EDIT = "/api/prompt-easymanager/edit";
    const ROUTE_SECTIONS = "/api/prompt-easymanager/sections";
    const ROUTE_PRESETS = "/api/prompt-easymanager/presets";
/**
 * 全局那份配置（开关 + 指向哪条预设）。
 *
 * ⚠️ 新会话页那个下拉框改的是**全局**（那边还没有会话），所以要用它。
 */
const ROUTE_GLOBAL = "/api/prompt-easymanager/global";
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

    // 预设选择器的纯数据规则集中在宿主层，设置页和会话页共用同一份。
    function presetLabelOf(p) {
      if (!p) return "系统提示词";
      if (typeof p.name === "string" && p.name.trim() && p.name !== "系统提示词（原生）") return p.name.trim();
      var prompts = Array.isArray(p.prompts) ? p.prompts : [];
      if (prompts.length > 0) return p.name || "（无名预设）";
      var selection = p.selection && typeof p.selection === "object" ? p.selection : {};
      var legacySections = p.sections && typeof p.sections === "object" ? p.sections : {};
      var n = selection.sections && typeof selection.sections === "object"
        ? Object.keys(selection.sections).length : Object.keys(legacySections).length;
      n += Array.isArray(selection.listed) ? selection.listed.length : 0;
      n += Array.isArray(selection.excluded) ? selection.excluded.length : 0;
      if (n > 0) return "系统提示词 · 改";
      if (typeof p.label === "string" && p.label) return p.label;
      return "系统提示词";
    }

    function isNativePreset(p) {
      if (p && typeof p.isNative === "boolean") return p.isNative;
      if (!p || (p.name !== "系统提示词（原生）" && p.name !== "系统提示词")) return false;
      if (Array.isArray(p.prompts) && p.prompts.length > 0) return false;
      var s = p.selection && typeof p.selection === "object" ? p.selection : {};
      var sec = s.sections && typeof s.sections === "object" ? s.sections : (p.sections || {});
      return Object.keys(sec).length === 0 &&
        !(Array.isArray(s.listed) && s.listed.length > 0) &&
        !(Array.isArray(s.excluded) && s.excluded.length > 0);
    }

    function presetKey(p) {
      if (p && typeof p.signature === "string") return p.signature;
      var s = p && p.selection && typeof p.selection === "object" ? p.selection : {};
      var sec = s.sections && typeof s.sections === "object" ? s.sections : (p && p.sections) || {};
      return JSON.stringify({
        prompts: Array.isArray(p && p.prompts) ? p.prompts.slice().sort() : [],
        listed: Array.isArray(s.listed) ? s.listed.slice().sort() : [],
        excluded: Array.isArray(s.excluded) ? s.excluded.slice().sort() : [],
        sections: Object.keys(sec).sort().map(function (k) { return [k, sec[k] && sec[k].text || ""]; }),
      });
    }

    function mergeEquivalentPresets(list, preferredId) {
      var out = [];
      var seen = {};
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p) continue;
        var key = presetKey(p);
        if (!(key in seen)) {
          seen[key] = out.length;
          out.push(p);
        } else if (p.id === preferredId) {
          out[seen[key]] = p;
        }
      }
      return out;
    }

    function presetDisplayLabel(list, index) {
      var base = presetLabelOf(list[index]);
      var count = 0;
      var order = 0;
      for (var i = 0; i < list.length; i++) {
        if (presetLabelOf(list[i]) === base) {
          count++;
          if (i <= index) order++;
        }
      }
      if (base === "系统提示词（原生）") base += " · 预设";
      return count > 1 ? base + "（" + order + "）" : base;
    }

    // ── chunk 的加载器（模块级，只求值一次）────────────────────────────────
    //
    // loader 是缓存的键，每次渲染都新建的话缓存永远 miss —— 组件会一直加载不完。
    //
    // require.async 收的是相对说明符（"./client.xxx.js"），**不是**注册键
    // "dsh-prompt-easymanager/client.xxx.js" —— 那个是 importChunk 自己拼的。
    var loadPicker = function () { return req.async("./client.picker.js"); };
    var loadPickerShared = function () { return req.async("./client.picker.shared.js"); };
    var loadPickerSession = function () { return req.async("./client.picker.session.js"); };
    var loadPickerHero = function () { return req.async("./client.picker.hero.js"); };
    var loadHostDom = function () { return req.async("./client.host-dom.js"); };
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

    /** 设置面板侧边栏那一项的文案。图标补丁按这份文案定位入口。 */
    var NAV_TITLE = "提示词管理";
    var PLUGIN_ID = "dsh-prompt-easymanager";

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
        return Promise.all([loadPicker(), loadPickerShared(), loadPickerSession(), loadPickerHero()]).then(function (mods) {
          var pickerMod = mods[0];
          // 顺手把单件也缓存上 —— 面板以后要单独取预览
          chunkCache.set(loadPreview, previewMod);
          chunkCache.set(loadPicker, pickerMod);
          chunkCache.set(loadPickerShared, mods[1]);
          chunkCache.set(loadPickerSession, mods[2]);
          chunkCache.set(loadPickerHero, mods[3]);
          return {
            previewMod: previewMod,
            pickerMod: pickerMod,
            pickerParts: { shared: mods[1], session: mods[2], hero: mods[3] },
          };
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
        // dsh 的官方插件共用这一组 UI primitives。它们由宿主模块加载器提供，
        // 不打进插件包；插件 UI 不再维护 HTML 控件回退。
        var hostUi = require("@deepseek-ai/dsh-client-ui-primitives");
        function ActionButton(props) {
          var next = Object.assign({}, props);
          delete next.children;
          delete next.style;
          delete next.className;
          delete next.type;
          next.style = { whiteSpace: "nowrap" };
          next.variant = next.variant || "ghost";
          next.size = next.size || "sm";
          return react.createElement(hostUi.Button, next, props.children);
        }

        /**
         * 三个入口共用的预设选择器。
         *
         * 数据来源和保存路由由调用方决定；这里统一 DSH 原生按钮、编辑图标、
         * chevron、菜单定位和打开/关闭行为，避免设置页、新会话页、已有会话页
         * 各自维护一套外观和菜单状态。
         */
        function PresetSelector(props) {
          var open = props.open === true;

          function setOpen(next) {
            if (typeof props.onOpenChange === "function") props.onOpenChange(next);
          }

          var label = props.label || "系统提示词（原生）";
          var icon = props.icon === false
            ? undefined
            : react.createElement(hostUi.IconEditOutlineRegular, { size: 14 });
          var anchorProps = Object.assign(
            {
              type: "button",
              variant: props.variant || "ghost",
              size: props.size || "sm",
              icon: icon,
              disabled: props.disabled,
              title: props.title || "选择提示词预设",
              "aria-label": props["aria-label"] || "选择提示词预设",
              "aria-haspopup": "menu",
              "aria-expanded": open ? "true" : "false",
              onClick: function () {
                setOpen(!open);
              },
            },
            props.anchorProps || {},
          );
          var anchor = react.createElement(
            ActionButton,
            anchorProps,
            [
              react.createElement(
                "span",
                {
                  key: "label",
                  style: {
                    minWidth: "0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                label,
              ),
              react.createElement(
                "span",
                {
                  key: "chevron",
                  style: {
                    color: "var(--dsw-alias-menu-icon)",
                    display: "inline-flex",
                    flex: "none",
                  },
                },
                react.createElement(hostUi.IconChevronDownOutlineRegular, { size: 12 }),
              ),
            ],
          );

          return react.createElement(hostUi.Menu, {
            open: open,
            anchor: anchor,
            items: props.items || [],
            selectedId: props.selectedId,
            onSelect: function (id) {
              if (props.closeOnSelect === true) setOpen(false);
              if (typeof props.onSelect === "function") props.onSelect(id);
            },
            onClose: function () {
              setOpen(false);
              if (typeof props.onClose === "function") props.onClose();
            },
            align: props.align || "start",
            side: props.side || "bottom",
            portal: props.portal !== false,
          });
        }

        /** DSH 0.17-rc2 没有 settings.section 图标字段，保留插件原有铅笔图标。 */
        function patchNavIcon() {
          if (typeof document === "undefined" || !document.body) return;
          var KEY = "pmNavIconDone";
          var SVG_NS = "http://www.w3.org/2000/svg";

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
              var buttons = document.querySelectorAll("button");
              for (var i = 0; i < buttons.length; i++) {
                var button = buttons[i];
                if (button.textContent !== NAV_TITLE || button.getAttribute(KEY) === "1") continue;
                var nativeIcon = button.querySelector("svg");
                if (!nativeIcon) continue;
                nativeIcon.replaceWith(makeIcon());
                button.setAttribute(KEY, "1");
                return true;
              }
            } catch {
              /* 图标补丁失败不影响插件主体功能。 */
            }
            return false;
          }

          apply();
          try {
            var observer = new MutationObserver(function () {
              apply();
            });
            observer.observe(document.body, { childList: true, subtree: true });
          } catch {
            /* 没有 MutationObserver 时只尝试当前 DOM。 */
          }
        }
        var inject = ["slots"];

        // ── 会话头部那一个按钮 + 它要用的样式 ────────────────────────────────
        var ROW = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "none" };
        var ACTIONS = {
          display: "flex",
          gap: "6px",
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: "8px",
        };
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
          borderRadius: "var(--dsw-radius-sm)",
          background: "var(--dsw-alias-bg-layer-1)",
          border: ".5px solid var(--dsw-alias-border-l2)",
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
         * 这些提示行直接放在卡片正文区之外，因此需要与卡片头对齐的内边距。
         *    内边距跟卡片头（CARD_HEAD 的 12px 14px）保持一致。
         */
        var CARD_NOTICE = { padding: "10px 14px" };
        var NOTICE_ROW = {
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "4px 8px",
          minWidth: "0",
        };
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
        // 浮层和菜单由 dsh 的 Modal/MenuSurface 原生组件负责外观。

  /**
   * 面板里的**标题行** —— 照原生菜单的 `.label`。
   *
   *  ⚠️ 原来我自己画了一个「带下边框的头 + 关闭按钮」，那是**另一套视觉语言**：
   *     原生菜单的标题是**一小行灰字**，跟项同样的左右内边距，**没有分隔线**。
   *     画了分隔线之后，项又紧贴那条线 → 用户看到的「位置混乱」。
   */
  // MenuSurface/MenuItemButton supply the menu title and item styling.


        // ── 面板 / 卡片 / 表单：给 chunk 用的样式 ─────────────────────────
        //
        // ⚠️ 拆包时这 62 个常量被漏在了半路 —— chunk 里只有 `var X = api.style.X`
        //    取值行，宿主却没给 X，于是编辑器那一栏整片空白（渲染期全是 undefined）。
        //    补的时候是从切分前的单文件（62eeb75:client.js）逐字搬回来的。
        //    定义只留这一份，chunk 那边靠 api.style 取。
      var CARD = {
        border: ".5px solid var(--dsw-alias-settings-card-stroke)",
        borderRadius: "var(--dsw-radius-xl)",
        background: "var(--dsw-alias-settings-card-fill)",
        minWidth: "0",
        overflow: "hidden",
      };
      var CARDS_GRID = {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
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
        borderColor: "var(--dsw-alias-state-error-primary)",
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
        borderTop: ".5px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-bg-module-platform)",
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
        textAlign: "left",
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
        display: "inline-flex",
        transition: "transform .14s ease-in-out",
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
        borderRadius: "var(--dsw-radius-sm)",
        cursor: "grab",
        fontSize: "12px",
      };
      var COMBO_ROW_HL = { background: "var(--dsw-alias-bg-layer-2)" };
      var COMBO_SIDE = {
        border: ".5px solid var(--dsw-alias-border-l2)",
        borderRadius: "var(--dsw-radius-sm)",
        padding: "8px 10px",
        minHeight: "90px",
        background: "var(--dsw-alias-bg-layer-1)",
      };
      var COMBO_SIDE_HL = { borderColor: "var(--dsw-alias-state-business-primary)" };
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
      var DT = {
        color: "var(--dsw-alias-label-tertiary, inherit)",
        fontSize: "11px",
        lineHeight: "17px",
      };
      var FORM = { display: "flex", flexDirection: "column", gap: "12px", width: "100%", minWidth: "0" };
      var FORM_FIELD = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "4px", minWidth: "0" };
      var FORM_ROW = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "12px", minWidth: "0" };
      var FORM_LABEL = {
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
      };
      var FORM_TEXTAREA = {
        fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
        fontSize: "12px",
        lineHeight: "1.6",
        padding: "8px 10px",
        borderRadius: "var(--dsw-radius-sm, 4px)",
        border: ".5px solid var(--dsw-alias-border-l4)",
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-primary, inherit)",
        width: "100%",
        boxSizing: "border-box",
        minHeight: "240px",
        resize: "vertical",
        outline: "none",
      };
      var HEADING = {
        margin: "14px 0 6px",
        paddingBottom: "4px",
        borderBottom: ".5px solid var(--dsw-alias-border-l2)",
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
      var MUTED = { opacity: 0.65 };
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
        border: ".5px solid var(--dsw-alias-border-l2)",
        borderRadius: "var(--dsw-radius-sm)",
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
      var SEC_OURS = Object.assign({}, SEC, { borderColor: "var(--dsw-alias-state-success-primary)" });
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
        border: ".5px solid var(--dsw-alias-border-l2)",
        borderRadius: "var(--dsw-radius-sm)",
        padding: "8px 10px",
        marginBottom: "4px",
        lineHeight: "1.7",
      };
    /** 下拉里「当前生效」那一项的高亮（跟普通行区分开）。 */
    var ROW_ACTIVE = {
      background: "var(--dsw-alias-interactive-bg-hover)",
      borderRadius: "var(--dsw-radius-md)",
    };

    /** 勾那一列 —— 固定宽度，免得没勾的行跟有勾的行对不齐。 */
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
          ui: {
            ActionButton: ActionButton,
            PresetSelector: PresetSelector,
            Button: hostUi.Button,
            Checkbox: hostUi.Checkbox,
            Input: hostUi.Input,
            Menu: hostUi.Menu,
            Modal: hostUi.Modal,
            Switch: hostUi.Switch,
            Tag: hostUi.Tag,
            StateDot: hostUi.StateDot,
            IconEditOutlineRegular: hostUi.IconEditOutlineRegular,
            IconChevronDownOutlineRegular: hostUi.IconChevronDownOutlineRegular,
            IconEllipsisOutlineRegular: hostUi.IconEllipsisOutlineRegular,
            IconQuestionOutlineRegular: hostUi.IconQuestionOutlineRegular,
            IconCodeOutlineRegular: hostUi.IconCodeOutlineRegular,
            DisclosureRow: hostUi.DisclosureRow,
            Tooltip: hostUi.Tooltip,
          },
          style: {
            ROW: ROW,
            ROW_ACTIVE: ROW_ACTIVE,
            ROW_MARK: ROW_MARK,
            ACTIONS: ACTIONS,
            PRE: PRE,
            TEXTAREA: TEXTAREA,
            HINT_TEXT: HINT_TEXT,
            CARD_NOTICE: CARD_NOTICE,
            NOTICE_ROW: NOTICE_ROW,
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
            DT: DT,
            FORM: FORM,
            FORM_FIELD: FORM_FIELD,
            FORM_LABEL: FORM_LABEL,
            FORM_ROW: FORM_ROW,
            FORM_TEXTAREA: FORM_TEXTAREA,
            HEADING: HEADING,
            HEADING_COUNT: HEADING_COUNT,
            HEADING_TITLE: HEADING_TITLE,
            HINT: HINT,
            MONO: MONO,
            MONO_TAIL: MONO_TAIL,
            MUTED: MUTED,
            RAW_NAME: RAW_NAME,
            SEC: SEC,
            SECTION: SECTION,
            SEC_OURS: SEC_OURS,
            SLOT_HEAD: SLOT_HEAD,
            SLOT_WHY: SLOT_WHY,
            STATUS_LINE: STATUS_LINE,
            SUMSUM: SUMSUM,
          },
          label: sectionLabel,
          mode: MODE_LABEL,
          tokens: fmtTokens,
          route: {
            ROUTE_STATE: ROUTE_STATE,
            ROUTE_ASSIGN: ROUTE_ASSIGN,
            ROUTE_PREVIEW: ROUTE_PREVIEW,
            ROUTE_RELOAD: ROUTE_RELOAD,
            ROUTE_EDIT: ROUTE_EDIT,
            ROUTE_SECTIONS: ROUTE_SECTIONS,
            ROUTE_PRESETS: ROUTE_PRESETS,
          ROUTE_GLOBAL: ROUTE_GLOBAL,
          },
          preset: {
            presetLabelOf: presetLabelOf,
            isNativePreset: isNativePreset,
            mergeEquivalentPresets: mergeEquivalentPresets,
            presetDisplayLabel: presetDisplayLabel,
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
          if (!ui.pickerMod.box) ui.pickerMod.box = ui.pickerMod.create(CHUNK_API, ui.pickerParts);
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
         * 新会话页（hero）那一行插一个「提示词组合」下拉框。
         *
         * ⚠️ **只能 DOM 补丁** —— 那一行的两个槽位都是 `kind: "single"`
         *    且已被占，抢会抛错；也没有第三个槽位。详见上面那段说明。
         *
         * ⚠️ 找不到目标就**什么都不做** —— 不抛错、不插半个控件。
         *    dsh 改版之后这个补丁会静默失效，但页面照常能用。
         */
        function patchHeroPreset() {
          loadHostDom().then(function (mod) {
            var box = mod.create({
              document: typeof document === "undefined" ? null : document,
              chunkApi: CHUNK_API,
              pluginId: PLUGIN_ID,
              loadPicker: loadPicker,
              loadPickerShared: loadPickerShared,
              loadPickerSession: loadPickerSession,
              loadPickerHero: loadPickerHero,
            });
            box.patchHeroPreset();
          }).catch(function (err) {
            console.error("[" + PLUGIN_ID + "] DOM 适配 chunk 加载失败：" + (err && err.message));
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
          ROUTE_EDIT: ROUTE_EDIT,
        };
        return module.exports;
      },
    });
  } catch (err) {
    console.error("[AI Client Sandbox] dsh-prompt-easymanager runtime error:", err);
  }
})();
