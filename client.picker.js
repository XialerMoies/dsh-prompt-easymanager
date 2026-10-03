// dsh-prompt-easymanager · 多选面板与会话头部入口（包内 chunk）
//
// 由 client.js 用 require.async("./client.picker.js") 拉起；必须注册成
// id "dsh-prompt-easymanager" + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。

window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
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
      var HERO_CHIP = api.style.HERO_CHIP;
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
      var MENU_ITEM_HOVER = api.style.MENU_ITEM_HOVER;
      var ADVISE = api.style.ADVISE;
      var MUTED = api.style.MUTED;
      var HEADING = api.style.HEADING;
      var SUMSUM = api.style.SUMSUM;
      var ROW = api.style.ROW;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_TITLE = api.style.CARD_TITLE;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var DETAIL_BTN = api.style.DETAIL_BTN;
      var OVERLAY = api.style.OVERLAY;
      var PANEL_SM = api.style.PANEL_SM;
      var PANEL = api.style.PANEL;
      var BTN = api.style.BTN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var BTN_PRIMARY = api.style.BTN_PRIMARY;
      var PANEL_BODY = api.style.PANEL_BODY;
      var MENU_LABEL = api.style.MENU_LABEL;
      var MENU_LABEL_ROW = api.style.MENU_LABEL_ROW;
      var MENU_ITEM = api.style.MENU_ITEM;
      var MENU_ITEM_ON = api.style.MENU_ITEM_ON;
      var MENU_MARK = api.style.MENU_MARK;
      var MENU_TEXT = api.style.MENU_TEXT;
      var MENU_HINT = api.style.MENU_HINT;
      var MENU_SEP = api.style.MENU_SEP;
      var PANEL_FOOT = api.style.PANEL_FOOT;
      var BTN_ERR = api.style.BTN_ERR;
      var MSG_ERR = api.style.MSG_ERR;
      var MSG_OK = api.style.MSG_OK;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_GLOBAL = api.route.ROUTE_GLOBAL;
      var ROUTE_SECTIONS = api.route.ROUTE_SECTIONS;
      var ROUTE_STATE = api.route.ROUTE_STATE;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
      var ROUTE_PREVIEW = api.route.ROUTE_PREVIEW;
      var ROUTE_RELOAD = api.route.ROUTE_RELOAD;

      // ⚠️ 这里原来有一份**本地兜底**的 SELECT_SM（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。

      // ⚠️ 这里原来有一份**本地兜底**的 ADVISE（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。
      // ⚠️ 这里原来有一份**本地兜底**的 ROW（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。
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
        // ⚠️ **鼠标划过去要高亮** —— 原生菜单是 `.item:hover`，而内联样式
        //    写不了 `:hover`，所以自己跟一个 state 手动做。
        //    少了它列表像坏死的：划过去一点反馈都没有。
        var hovSt = react.useState("");
        var hoverId = hovSt[0];
        var setHoverId = hovSt[1];
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
              // ⚠️ **选完自动关** —— 用户要的是「点一下就生效」。
              //    留着浮窗反而让人以为没生效（他就是这么报告的）。
              if (props.onClose) props.onClose();
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
        // ⚠️ 头用 **MENU_LABEL_ROW**（照原生菜单的 `.label`），不是 PANEL_HEAD。
        //    PANEL_HEAD 自带 `borderBottom` —— 那条分隔线加上「项没有内边距」，
        //    就成了用户报的「选项紧贴分隔线」。原生菜单的标题是**一小行灰字**，
        //    没有分隔线。
        var head = react.createElement("div", { key: "h", style: MENU_LABEL_ROW }, [
          react.createElement("span", { key: "t", style: MENU_LABEL }, "这个会话用什么"),
          react.createElement(
            "button",
            { key: "x", type: "button", className: "pm-btn", style: BTN, onClick: onClose },
            "关闭",
          ),
        ]);
        rows.push(head);

        if (err) {
          rows.push(react.createElement("div", { key: "e", style: MSG_ERR }, err));
        } else if (msg) {
          rows.push(react.createElement("div", { key: "m", style: MSG_OK }, msg));
        }

        // ── 选项 ────────────────────────────────────────────────────
        for (var i = 0; i < presets.length; i++) {
          // ⚠️ **必须把完整的 props 合进去，不能只传 hover** ——
          //    曾经写成 `renderOption(presets[i], { hoverId, setHoverId })`，
          //    结果 renderOption 里 `props.sessionId` 是 undefined，
          //    点下去发出去的请求**没有 sessionId** → 后端 400「缺少 sessionId」
          //    → 表现就是**点了没反应**（真机上踩了很久才定位到）。
          //
          //    hover 那两个在闭包里、不在 props 上，所以得手动合进去。
          rows.push(
            renderOption(
              presets[i],
              Object.assign({}, props, {
                hoverId: hoverId,
                setHoverId: setHoverId,
                // ⚠️ **面板自己包好的「点完了」回调** ——
                //    这几件事都得在**面板的闭包**里做，模块级的 `pickOption`
                //    看不到 `tick` / `setTick`。
                //
                //    （踩过：我把 setTick 写进了 pickOption，ReferenceError 被
                //      里面的 catch 吞了 —— 表现就是「切了但要关掉浮窗才看到」。）
                onDone: function () {
                  // 刷新**面板自己那份** /presets —— 这样勾会立刻挪到新选项上，
                  // 而**面板保持打开**。
                  setTick(tick + 1);
                  // ⚠️ **不要自动关**（用户明确要求）：
                  //    「为什么一切换就退出选择框而不是和初始会话页的一样
                  //      **自由切换自主关闭**」
                  //    —— 留在这儿才能连着点几个、比较一下，自己决定什么时候关。
                },
              }),
            ),
          );
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
        // 预设是用户明确命名的配置。即使它只包含系统段落，也要显示这个名字，
        // 否则会和“系统提示词（原生）”混成同一项，选中后无法确认自己用的是哪套。
        if (typeof p.name === "string" && p.name.trim() && p.name !== "系统提示词（原生）") return p.name.trim();
        var ps = Array.isArray(p.prompts) ? p.prompts : [];
        if (ps.length > 0) return p.name || "（无名预设）";
        var selection = p.selection && typeof p.selection === "object" ? p.selection : {};
        var legacySections = p.sections && typeof p.sections === "object" ? p.sections : {};
        var n = selection.sections && typeof selection.sections === "object"
          ? Object.keys(selection.sections).length : Object.keys(legacySections).length;
        n += Array.isArray(selection.listed) ? selection.listed.length : 0;
        n += Array.isArray(selection.excluded) ? selection.excluded.length : 0;
        // 旧服务端可能仍把改写预设标成 label="系统提示词"；正文才是权威信号。
        if (n > 0) return "系统提示词 · 改";
        if (typeof p.label === "string" && p.label) return p.label;
        return "系统提示词";
      }

      /** 纯原生预设与选择器里的“系统提示词（原生）”是同一个效果，隐藏重复项。 */
      function isNativePreset(p) {
        if (p && typeof p.isNative === "boolean") return p.isNative;
        // 只隐藏内置默认预设。用户新建的空配置也许有自己的名字，不能因为内容
        // 恰好为空就从选择器里抹掉。
        if (!p || (p.name !== "系统提示词（原生）" && p.name !== "系统提示词")) return false;
        if (!p || (Array.isArray(p.prompts) && p.prompts.length > 0)) return false;
        if (p.sections && typeof p.sections === "object" && Object.keys(p.sections).length > 0) return false;
        var s = p.selection;
        if (!s || typeof s !== "object") return true;
        return !(Array.isArray(s.listed) && s.listed.length > 0) &&
          !(Array.isArray(s.excluded) && s.excluded.length > 0) &&
          !(s.sections && typeof s.sections === "object" && Object.keys(s.sections).length > 0);
      }

      /** 服务端已按签名收敛重复项；前端只尊重服务端结果，不自行猜内容相等。 */
      function mergeEquivalentPresets(list, preferredId) {
        var out = [];
        var positions = {};
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (!p) continue;
          // 没有 signature 只可能是旧 dsh 缓存/旧服务端响应；兼容一次，
          // 新响应始终由服务端提供签名。
          var key = typeof p.signature === "string" ? p.signature : legacyPresetKey(p);
          if (!(key in positions)) {
            positions[key] = out.length;
            out.push(p);
          } else if (p.id === preferredId) {
            out[positions[key]] = p;
          }
        }
        return out;
      }

      function legacyPresetKey(p) {
        var s = p && p.selection && typeof p.selection === "object" ? p.selection : {};
        var sec = s.sections && typeof s.sections === "object" ? s.sections : (p && p.sections) || {};
        return JSON.stringify({
          prompts: Array.isArray(p && p.prompts) ? p.prompts.slice().sort() : [],
          listed: Array.isArray(s.listed) ? s.listed.slice().sort() : [],
          excluded: Array.isArray(s.excluded) ? s.excluded.slice().sort() : [],
          sections: Object.keys(sec).sort().map(function (k) { return [k, sec[k] && sec[k].text || ""]; }),
        });
      }

      /** 给同名预设加序号，避免不同 id 在选择器里看起来像重复项。 */
      function presetDisplayLabel(list, index) {
        var p = list[index] || {};
        var base = presetLabelOf(p);
        var total = 0;
        var order = 0;
        for (var i = 0; i < list.length; i++) {
          if (presetLabelOf(list[i]) === base) {
            total++;
            if (i <= index) order++;
          }
        }
        // 选择器另有一条“系统提示词（原生）”入口；即使预设刚好也叫这个名字，
        // 也要明确标出它是预设，避免出现两个一模一样的选项。
        if (base === "系统提示词（原生）") base += " · 预设";
        return total > 1 ? base + "（" + order + "）" : base;
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
              selection: one.selection,
              signature: one.signature,
              isNative: one.isNative,
              label: presetLabelOf(one),
              summary: "",
            });
          }
        }
        // extras 也要合进来 —— 它是 /presets?session= 的响应，
        // 带一份**带 label 的预设数组**和 session / effective。
        // props.data（/state）里那份预设表没有 label，只有这边有。
        var ex = props.extras || null;
        // /presets?session= 返回完整 selection，是选择器的权威数据源；
        // /state 只在它尚未加载时作为首屏回退，否则改写段落会被丢掉。
        if (ex && Array.isArray(ex.presets)) {
          list = ex.presets.filter(Boolean);
        }
        list = list.filter(function (p) { return !isNativePreset(p); });
        var preferredId = d && d.global && typeof d.global.presetId === "string" ? d.global.presetId : null;
        if (!preferredId && d && d.assignments && typeof d.assignments === "object" && props.sessionId) {
          preferredId = d.assignments[props.sessionId];
        }
        list = mergeEquivalentPresets(list, preferredId);
        // 统一用预设的实际名字，并为同名副本加序号。
        for (var li = 0; li < list.length; li++) {
          list[li] = Object.assign({}, list[li], { label: presetDisplayLabel(list, li) });
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

        // ① 跟随全局
        //
        // ⚠️ **两个条件，缺一不可**：
        //      开关开着（关掉 = 全局这一层整体停用，那时**不能**跟随）
        //      而且真有一条预设可跟
        //
        //    只看 `g.presetId` 是不够的 —— 开关关掉时它**仍然指着上次选的那条**
        //    （那是设计：配置留着，打开开关就能用）。所以开关关着的时候，
        //    这一项会照样出现、还被标成当前项 → 用户看到的「默认是测试t-1」。
        var gp = null;
        if (g.enabled === true) {
          for (var k = 0; k < list.length; k++) {
            if (list[k] && list[k].id === g.presetId) gp = list[k];
          }
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
            // ⚠️ 照原生 `.item` / `.selectedFill` —— 选中**只加填充**，
            //    不换字号不换粗细（原生菜单就是这样：勾是唯一的标记）。
            //    划过去也要高亮（原生是 `.item:hover`）。
            style: o.active
              ? MENU_ITEM_ON
              : props.hoverId === o.kind + (o.id || "")
                ? MENU_ITEM_HOVER
                : MENU_ITEM,
            "aria-current": o.active ? "true" : undefined,
            onMouseEnter: function () {
              props.setHoverId(o.kind + (o.id || ""));
            },
            onMouseLeave: function () {
              props.setHoverId("");
            },
            onClick: function () {
              if (o.active) {
                props.onClose && props.onClose();
                return;
              }
              pickOption(o, props);
            },
          },
          [
            // 勾那一列：照原生 `.itemIcon`（14×14，固定宽，没有勾也占位）
            react.createElement("span", { key: "g", style: MENU_MARK }, o.active ? "✓" : ""),
            // 主文字：照原生 `.itemLabel`
            react.createElement("span", { key: "l", style: MENU_TEXT }, o.label),
            // 副文字：照原生 `.shortcut` —— 它自己 `margin-inline-start: auto` 靠右，
            // 所以**不用再塞一个弹簧**（原来那样会撑出空洞）
            o.sub ? react.createElement("span", { key: "s", style: MENU_HINT }, o.sub) : null,
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
            // ⚠️ **点完之后的三件事由调用方（面板）做** ——
            //    刷新它自己那份 /presets、关掉面板。
            //
            //    ⚠️ 踩过：我一开始把这两件事写在这里，而 `setTick` / `onClose`
            //    是**面板闭包里的**，这个模块级函数根本看不到 ——
            //    `setTick(tick + 1)` 直接 ReferenceError，而下面的 catch
            //    把错误吞了（「失败不影响功能」），于是**一直是坏的而没人知道**。
            //
            //    所以改成**回调**：谁调谁负责。
            if (props.onDone) props.onDone();
            return null;
          })
          .catch(function (e) {
            // ⚠️ **失败要说出来** —— 原来是「失败时不动面板，让用户重试」，
            //    结果是点了没反应、控制台一个 400，谁都不知道为什么。
            //    （真机上踩过：点预设一直 400，界面上毫无提示。）
            var m = (e && e.message) || String(e);
            try {
              console.warn("[dsh-prompt-easymanager] 切换预设失败：" + m + "；请求体=" + JSON.stringify(body));
            } catch {
              /* 没有 console 就算了 */
            }
          });
      }
      /**
       * 新会话页那一行里的小控件：一个按钮 + 点开的面板。
       *
       * ⚠️ **没有 sessionId** —— 新会话页还没有会话。所以它改的是
       *    **全局那条预设**（`POST /global`），不是某个会话的分配。
       *    真按会话存要 dsh 给「会话创建」钩子，而 hero 的渲染上下文里
       *    连 sessionId 都没有（查过槽位表）。
       */
      function HeroPresetChip(props) {
        var st = react.useState(null);
        var data = st[0];
        var setData = st[1];
        var openSt = react.useState(false);
        var open = openSt[0];
        var setOpen = openSt[1];

        /**
         * 挂载后往控制台说一句「我在哪儿」。
         *
         * ⚠️ 为什么要这个：这个控件是**渲染后插进去的**（dsh 那一行没有第三个
         *    槽位），所以「插到哪儿了」只有真机上才知道。前面为这个位置
         *    已经返工三轮，每轮都靠猜。现在让它自己说 —— 一次说清。
         *
         *    只在浏览器里跑（`typeof document`），测试环境里没有真实 DOM。
         */
        react.useEffect(function () {
          try {
            if (typeof document === "undefined") return undefined;
            var el = document.querySelector("[data-pm-hero-preset]");
            if (!el) return undefined;
            var parent = el.parentElement;
            var kids = parent ? parent.children.length : 0;
            var who = [];
            for (var k = 0; k < kids && k < 6; k++) {
              var c = parent.children[k];
              who.push(
                (c.tagName || "?").toLowerCase() +
                  (c === el ? "(我)" : "") +
                  (c.getAttribute && c.getAttribute("aria-haspopup") ? "[menu]" : ""),
              );
            }
            var box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            console.info(
              "[dsh-prompt-easymanager] hero 框位置：父 " +
                (parent ? (parent.tagName || "?").toLowerCase() : "?") +
                "." +
                (parent && parent.className ? String(parent.className).split(/\s+/)[0] : "?") +
                " 共 " +
                kids +
                " 个孩子 [" +
                who.join(", ") +
                "]" +
                (box ? "；我的位置 x=" + Math.round(box.left) + " y=" + Math.round(box.top) : ""),
            );
            return undefined;
          } catch {
            return undefined;
          }
        }, []);

        var load = react.useCallback(function () {
          return fetch(ROUTE_PRESETS)
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; })
            .then(function (d) {
              setData(d);
              return null;
            });
        }, []);

        react.useEffect(function () {
          var alive = true;
          load().then(function () { return alive; });
          return function () {
            alive = false;
          };
        }, [load]);

        // ⚠️ **开关关着就不该显示那条预设** —— 那时全局这一层整体停用，
        //    新会话什么都不挂。只判 `presetId` 是字符串的话，开关关掉之后
        //    它**仍然指着上次选的那条**，于是显示成「测试t-1」（用户报的
        //    「初始会话页显示的预设是测试t-1」就是这么来的）。
        var label = "系统提示词（原生）";
        if (
          data &&
          data.global &&
          data.global.enabled === true &&
          typeof data.global.presetId === "string"
        ) {
          var list = Array.isArray(data.presets)
            ? mergeEquivalentPresets(
                data.presets.filter(function (p) { return !isNativePreset(p); }),
                data.global && data.global.presetId,
              )
            : [];
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === data.global.presetId) label = list[i].name || list[i].label;
          }
        }

        return react.createElement(
          react.Fragment,
          null,
          [
            react.createElement(
              "button",
              {
                key: "b",
                type: "button",
                className: "pm-btn",
                // ⚠️ 用 HERO_CHIP（照原生 .select 抄的），不是 SELECT_SM ——
                //    后者是带边框的输入框，插到那一行里长得完全不一样。
                style: HERO_CHIP,
                "aria-haspopup": "menu",
                "aria-expanded": open ? "true" : "false",
                title: "这个新会话用哪套提示词组合",
                onClick: function () {
                  setOpen(true);
                },
              },
              // ⚠️ **不带 ▾** —— 那是原生 `<select>` 的视觉语言，而这一行里
              //    工作区 / 模式那两个也都是**没有箭头**的（用户指出过）。
              label,
            ),
            open
              ? react.createElement(HeroPresetPanel, {
                  data: data,
                  onClose: function () {
                    setOpen(false);
                  },
                  onApplied: load,
                })
              : null,
          ],
        );
      }

      /**
       * 新会话页的面板。
       *
       * ⚠️ **跟会话页那个面板的区别**：
       *      · 没有「跟随全局」—— 这里就是全局本身，自己跟随自己没有意义
       *      · 有「系统提示词」—— 但它在这里的含义是「**回到原生**」
       *        （全局不指任何预设），而不是会话页那个「这个会话什么都不挂」
       *
       * ⚠️ 用户报过「只有预设选择没有原生提示词选择，选择预设后无法回退到原生」
       *    —— 就是缺了这一项。
       *
       * ⚠️ 宿主 `/global` 有条规则：`enabled === true && !presetId` → 400
       *    （「要开启全局注入，得先选一个预设」）。所以回退到原生是
       *    **`presetId: null` + `enabled: false`** —— 两个一起传。
       */
      function HeroPresetPanel(props) {
        var errSt = react.useState(null);
        var err = errSt[0];
        var setErr = errSt[1];
        // ⚠️ 同 PresetDropdown：内联样式写不了 `:hover`，自己跟一个 state。
        var hovSt = react.useState("");
        var hoverId = hovSt[0];
        var setHoverId = hovSt[1];

        /** @param o 选项；`o.id === null` 表示**回到原生**。 */
        function pick(o) {
          setErr(null);
          var toNative = o.id === null;
          return fetch(ROUTE_GLOBAL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // ⚠️ 选预设 = 顺带把全局注入打开（用户定的规则是「要开就得先选预设」，
            //    反过来「选了预设」也就是要开的意思）。
            // ⚠️ 回原生 = `presetId: null` **且** `enabled: false` ——
            //    只传 null 会被宿主按「开了却没选预设」挡掉（400）。
            body: JSON.stringify(
              toNative ? { presetId: null, enabled: false } : { presetId: o.id, enabled: true },
            ),
          })
            .then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
                return j;
              });
            })
            .then(function () {
              props.onApplied && props.onApplied();
              // ⚠️ **不要自动关** —— 跟会话页那个面板保持一致
              //    （用户要求「自由切换自主关闭」，两边都该是这样）。
              //    面板自己那份数据由 `onApplied`（外面的 load）刷新。
              return null;
            })
            .catch(function (e) {
              setErr((e && e.message) || String(e));
            });
        }

        var d = props.data;
        var g = (d && d.global) || {};
        var nativeGlobal = d && Array.isArray(d.presets)
          ? d.presets.some(function (p) {
              return p && p.id === g.presetId && isNativePreset(p);
            })
          : false;
        var list = d && Array.isArray(d.presets)
          ? mergeEquivalentPresets(
              d.presets.filter(function (p) { return !isNativePreset(p); }),
              g.presetId,
            )
          : [];
        var rows = [
          react.createElement("div", { key: "h", style: MENU_LABEL_ROW }, [
            react.createElement("span", { key: "t", style: MENU_LABEL }, "新会话用哪套"),
            react.createElement(
              "button",
              { key: "x", type: "button", className: "pm-btn", style: BTN, onClick: props.onClose },
              "关闭",
            ),
          ]),
        ];
        if (err) rows.push(react.createElement("div", { key: "e", style: MSG_ERR }, err));

        // ── ① 回到原生 ────────────────────────────────────────────────────
        //
        // ⚠️ 这一项**必须有** —— 用户报的「只有预设选择没有原生提示词选择，
        //    选择预设后无法回退到原生」就是它缺了。
        //
        //    当前项判据：全局**没**指任何预设（`presetId` 为空）——
        //    那正是「新会话不挂任何自设提示词」的状态。
        // 旧状态可能仍把全原生预设的 id 挂在 global 上；它和回到原生
        // 是同一个效果，选择器应合并成这一项并正确显示当前勾选。
        var nativeOn = !g.presetId || nativeGlobal;
        rows.push(
          react.createElement(
            "button",
            {
              key: "o-native",
              type: "button",
              className: "pm-btn",
              style: nativeOn
                ? MENU_ITEM_ON
                : hoverId === "native"
                  ? MENU_ITEM_HOVER
                  : MENU_ITEM,
              "aria-current": nativeOn ? "true" : undefined,
              onMouseEnter: function () {
                setHoverId("native");
              },
              onMouseLeave: function () {
                setHoverId("");
              },
              onClick: function () {
                if (nativeOn) {
                  props.onClose && props.onClose();
                  return;
                }
                pick({ id: null, label: "系统提示词" });
              },
            },
            [
              react.createElement("span", { key: "g", style: MENU_MARK }, nativeOn ? "✓" : ""),
              react.createElement("span", { key: "l", style: MENU_TEXT }, "系统提示词（原生）"),
              react.createElement("span", { key: "s", style: MENU_HINT }, "不挂任何自设提示词"),
            ],
          ),
        );

        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (!p) continue;
          var active = g.enabled === true && g.presetId === p.id;
          rows.push(
            react.createElement(
              "button",
              {
                key: "o-" + p.id,
                type: "button",
                className: "pm-btn",
                style: active
                  ? MENU_ITEM_ON
                  : hoverId === "p" + p.id
                    ? MENU_ITEM_HOVER
                    : MENU_ITEM,
                "aria-current": active ? "true" : undefined,
                onMouseEnter: function () {
                  setHoverId("p" + p.id);
                },
                onMouseLeave: function () {
                  setHoverId("");
                },
                onClick: (function (oo, isActive) {
                  return function () {
                    if (isActive) {
                      props.onClose && props.onClose();
                      return;
                    }
                    pick(oo);
                  };
                })(p, active),
              },
              [
                react.createElement("span", { key: "g", style: MENU_MARK }, active ? "✓" : ""),
                react.createElement("span", { key: "l", style: MENU_TEXT }, presetDisplayLabel(list, i)),
                p.summary ? react.createElement("span", { key: "s", style: MENU_HINT }, p.summary) : null,
              ],
            ),
          );
        }
        if (list.length === 0) {
          rows.push(
            react.createElement(
              "div",
              { key: "none", style: MUTED },
              "还没有任何提示词组合。去「设置 → 提示词管理 → 提示词组合」存一条。",
            ),
          );
        }
        return react.createElement(Overlay, { narrow: true, onClose: props.onClose }, [
          react.createElement("div", { key: "b", style: PANEL_BODY }, rows),
        ]);
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
            // ⚠️ **不带 ▾** —— 那是原生 `<select>` 的视觉语言。会话页头部
            //    跟新会话页那一行都统一成「只有文字」。
            label,
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
          HeroPresetChip: HeroPresetChip,
        PromptPicker: PromptPicker,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
