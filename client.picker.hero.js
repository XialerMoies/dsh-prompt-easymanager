// New-session hero selector and global preset panel.
window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.picker.hero.js",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");
    function create(api) {
      var PresetSelector = api.ui.PresetSelector;
      var presetModel = api.preset;
      var presetLabelOf = presetModel.presetLabelOf;
      var isNativePreset = presetModel.isNativePreset;
      var mergeEquivalentPresets = presetModel.mergeEquivalentPresets;
      var presetDisplayLabel = presetModel.presetDisplayLabel;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_GLOBAL = api.route.ROUTE_GLOBAL;
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
            if (list[i] && list[i].id === data.global.presetId) label = presetLabelOf(list[i]);
          }
        }

        return react.createElement(HeroPresetPanel, {
          data: data,
          open: open,
          onOpenChange: setOpen,
          label: label,
          onClose: function () {
            setOpen(false);
          },
          onApplied: load,
        });
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
        var options = [{
          id: "native",
          label: "系统提示词（原生）",
          icon: nativeOn ? "✓" : undefined,
          preset: { id: null },
          active: nativeOn,
        }];
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (!p) continue;
          var active = g.enabled === true && g.presetId === p.id;
          options.push({
            id: "preset:" + p.id,
            label: presetDisplayLabel(list, i),
            icon: active ? "✓" : undefined,
            preset: p,
            active: active,
          });
        }
        var menuItems = [{ type: "label", id: "hero-title", text: "新会话用哪套" }];
        if (err) menuItems.push({ type: "label", id: "hero-error", text: err });
        menuItems = menuItems.concat(options.map(function (o) {
          return { id: o.id, label: o.label };
        }));
        var activeMenuId = options.find(function (o) { return o.active; });
        var selectOption = function (id) {
          var chosen = options.find(function (o) { return o.id === id; });
          if (!chosen) return;
          if (chosen.active) {
            props.onClose && props.onClose();
            return;
          }
          pick(chosen.preset);
        };
        if (list.length === 0) {
          menuItems.push({
            type: "label",
            id: "hero-empty",
            text: "还没有任何提示词组合。去「设置 → 提示词管理 → 提示词组合」存一条。",
          });
        }
        return react.createElement(PresetSelector, {
          open: props.open,
          onOpenChange: props.onOpenChange,
          label: props.label || "系统提示词（原生）",
          title: "这个新会话用哪套提示词组合",
          "aria-label": "选择新会话的提示词预设",
          items: menuItems,
          selectedId: activeMenuId && activeMenuId.id,
          onSelect: selectOption,
          onClose: props.onClose,
        });
      }

      return { HeroPresetChip: HeroPresetChip, HeroPresetPanel: HeroPresetPanel };
    }
    module.exports.create = create;
    return module.exports;
  },
});
