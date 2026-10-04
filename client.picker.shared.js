// Shared preset normalization and assignment helpers for picker chunks.
window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.picker.shared.js",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");
    function create(api) {
      var presetModel = api.preset;
      var presetLabelOf = presetModel.presetLabelOf;
      var isNativePreset = presetModel.isNativePreset;
      var mergeEquivalentPresets = presetModel.mergeEquivalentPresets;
      var presetDisplayLabel = presetModel.presetDisplayLabel;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
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

      return { metaOf: metaOf, pickOption: pickOption };
    }
    module.exports.create = create;
    return module.exports;
  },
});
