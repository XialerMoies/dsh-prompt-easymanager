// dsh-prompt-manager · 多选面板与会话头部入口（包内 chunk）
//
// 由 client.js 用 require.async("./client.picker.js") 拉起；必须注册成
// id "dsh-prompt-manager" + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
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
      var ADVISE = api.style.ADVISE;
      var MUTED = api.style.MUTED;
      var HEADING = api.style.HEADING;
      var SUMSUM = api.style.SUMSUM;
      var ROW = api.style.ROW;
      var CARD_HEADING = api.style.CARD_HEADING;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var DETAIL_BTN = api.style.DETAIL_BTN;
      var OVERLAY = api.style.OVERLAY;
      var PANEL_SM = api.style.PANEL_SM;
      var PANEL = api.style.PANEL;
      var BTN = api.style.BTN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var BTN_PRIMARY = api.style.BTN_PRIMARY;
      var PANEL_HEAD = api.style.PANEL_HEAD;
      var PANEL_BODY = api.style.PANEL_BODY;
      var PANEL_FOOT = api.style.PANEL_FOOT;
      var BTN_ERR = api.style.BTN_ERR;
      var MSG_ERR = api.style.MSG_ERR;
      var MSG_OK = api.style.MSG_OK;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;
      var ROUTE_PRESETS = api.route.ROUTE_PRESETS;
      var ROUTE_SECTIONS = api.route.ROUTE_SECTIONS;
      var ROUTE_STATE = api.route.ROUTE_STATE;
      var ROUTE_ASSIGN = api.route.ROUTE_ASSIGN;
      var ROUTE_PREVIEW = api.route.ROUTE_PREVIEW;
      var ROUTE_RELOAD = api.route.ROUTE_RELOAD;

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
      var ROW = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "none" };
      var PILL_SWITCH = {
        position: "relative",
        flex: "0 0 auto",
        width: "36px",
        height: "20px",
        borderRadius: "999px",
        padding: "0",
        transition: "background .15s ease, border-color .15s ease",
      };
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
        PickerPanel: PickerPanel,
        PromptPicker: PromptPicker,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
