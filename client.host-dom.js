// dsh-prompt-easymanager · 新会话页 DOM 适配
//
// dsh 目前没有给 conversation.hero.agentPreset 暴露第三个槽位，
// 因此这个入口只能在宿主 DOM 渲染后插入一个容器，再把原生 picker 挂进去。
// 这里不定义任何外观组件，只负责 DOM 定位和 chunk 挂载。

window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.host-dom.js",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");
    var reactDom = require("react-dom");

    function create(api) {
      var document = api.document;
      var CHUNK_API = api.chunkApi;
      var PLUGIN_ID = api.pluginId;
      var loadPicker = api.loadPicker;
      var loadPickerShared = api.loadPickerShared;
      var loadPickerSession = api.loadPickerSession;
      var loadPickerHero = api.loadPickerHero;

      function mountHeroPicker(box) {
        Promise.all([loadPicker(), loadPickerShared(), loadPickerSession(), loadPickerHero()]).then(function (mods) {
          try {
            var picker = mods[0].create(CHUNK_API, {
              shared: mods[1],
              session: mods[2],
              hero: mods[3],
            });
            if (typeof picker.installStyles === "function") picker.installStyles();
            reactDom.render(react.createElement(picker.HeroPresetChip, { container: box }), box);
          } catch (err) {
            console.error("[" + PLUGIN_ID + "] hero 下拉框挂载失败：" + (err && err.message));
          }
          return null;
        });
      }

      function patchHeroPreset() {
        if (!document || !document.body) return;
        var HOST_ATTR = "data-pm-hero-preset";
        var HERO_SLOT = "conversation.hero.agentPreset";
        var tries = 0;
        var lastState = "";

        function describe(el) {
          try {
            if (!el) return "(null)";
            var tag = el.tagName ? el.tagName.toLowerCase() : "?";
            var cls = (el.className || "").toString().split(/\s+/).slice(0, 2).join(".");
            var kids = el.children ? el.children.length : 0;
            var parts = [];
            for (var k = 0; k < kids && k < 5; k++) {
              var c = el.children[k];
              parts.push((c.tagName || "?").toLowerCase() + (c.getAttribute && c.getAttribute("aria-haspopup") ? "[menu]" : ""));
            }
            return tag + (cls ? "." + cls : "") + " kids=" + kids + " [" + parts.join(", ") + "]";
          } catch {
            return "(描述失败)";
          }
        }

        function describeChain(el) {
          var out = [];
          for (var k = 0; el && k < 4; k++) {
            out.push(describe(el));
            el = el.parentElement;
          }
          return out.join("  ↑  ") || "(null)";
        }

        function note(message) {
          var state = message.indexOf("已插入") === 0 ? "ok" : "fail";
          if (state === lastState) return;
          lastState = state;
          try {
            console.info("[dsh-prompt-easymanager] hero 下拉框：" + message);
          } catch {
            /* 没有 console 就算了 */
          }
        }

        function rowOf() {
          try {
            var anchor = document.querySelector('[data-slot="' + HERO_SLOT + '"]');
            if (!anchor) return null;
            // 槽位容器是 display:contents，必须插到它的父元素里。
            var row = anchor.parentElement;
            if (!row || row.querySelector("[" + HOST_ATTR + "]")) return null;
            return row;
          } catch {
            return null;
          }
        }

        function apply() {
          tries++;
          try {
            if (document.querySelector("[" + HOST_ATTR + "]")) return true;
            var row = rowOf();
            if (!row) {
              note(
                "没找到目标行（第 " + tries + " 次尝试）；页面上有 " +
                  document.querySelectorAll("[data-slot]").length +
                  " 个槽位容器，其中 hero 那个（" + HERO_SLOT + "）有 " +
                  document.querySelectorAll('[data-slot="' + HERO_SLOT + '"]').length +
                  " 个；第一个槽位的父链：" + describeChain(document.querySelector("[data-slot]")),
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
            /* 补丁失败不影响插件主体功能。 */
          }
          return false;
        }

        apply();
        try {
          var MutationObserver = document.defaultView && document.defaultView.MutationObserver;
          if (typeof MutationObserver !== "function" && typeof globalThis.MutationObserver === "function") {
            MutationObserver = globalThis.MutationObserver;
          }
          if (typeof MutationObserver === "function") {
            var observer = new MutationObserver(function () { apply(); });
            observer.observe(document.body, { childList: true, subtree: true });
          }
        } catch {
          /* 没有 MutationObserver 时只生效一次。 */
        }
      }

      return { patchHeroPreset: patchHeroPreset };
    }

    module.exports.create = create;
    return module.exports;
  },
});
