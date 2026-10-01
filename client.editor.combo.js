// dsh-prompt-manager · 提示词组合 + 预设（包内 chunk）
//
// 由 client.editor.js 用 require.async 拉起；必须注册成 id "dsh-prompt-manager"
// + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走。改完跑
//    `npm run bump:rev`。
//
// 这一块管两件事，它们本来就是一件事所以放在一起：
//   · 勾选清单 —— 当前这套配置选了什么；
//   · 预设     —— 把这套配置整体存下来 / 换一套 / 改名。
//
// ⚠️ **状态和数据流都不在这里**。presetsData / presetsBusy / presetName /
//    renaming / renameDraft，以及所有动作（doPreset / applyPreset / savePreset /
//    commitRename / setActivePrompts / loadPresets / flash）全留在
//    client.editor.js —— 它们跟 /defaults、/presets、/edit 几条接口的数据流
//    缠在一起，而且测试是按 hook 下标塞状态的，搬走会让所有按索引塞状态的地方
//    错位。这一块只搬**渲染**。

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  chunk: "client.editor.combo.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    function create(api) {
      var BTN = api.style.BTN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var CARD = api.style.CARD;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_TITLE = api.style.CARD_TITLE;
      var DETAIL_BTN = api.style.DETAIL_BTN;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var SELECT_SM = api.style.SELECT_SM;
      var STATUS_LINE = api.style.STATUS_LINE;
      var TAG = api.style.TAG;

      /**
       * 卡片体的内容：勾选网格（已选的排前面）。
       *
       * ⚠️ **只吐内容，不自带卡片** —— 卡片是 renderCombo 那层的。
       *    这里返回 CARD 的话，「预设名 / 下拉 / 保存」就只能摆在卡片外面，
       *    变成三层（踩过：用户问「下拉框和保存不都说是卡片顶部了吗」）。
       */
      /**
       * 取「全局指向的那条预设」。
       *
       * ⚠️ 新形状：全局**指向一条预设**（`global.presetId`），内容在 `presets` 里查 ——
       *    不再是老版本那种「一层裸 prompt id」（`layers.global.prompts`）。
       *    读老字段不会报错，只会静默拿到 undefined，所以专门有「宿主契约」守卫盯着。
       */
      function globalPresetOf(props) {
        var d = props.presetsData;
        if (!d || !d.global || typeof d.global.presetId !== "string") return null;
        var list = Array.isArray(d.presets) ? d.presets : [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === d.global.presetId) return list[i];
        }
        return null;
      }

      /**
       * 「系统提示词」那组 tag 要列哪些段落、各自勾没勾。
       *
       * ⚠️ 来源**两处合并**：
       *      预设自己带的（presetSections）        → 勾着
       *      全局改写里的（globalOverrides）        → 只有不在预设里才算「没勾」
       *
       *    只认第二处的话，预设里存着的改动在重开之后就不显示了。
       */
      function sectionTagRows(props) {
        var seen = {};
        var out = [];
        var presetSec = props.presetSections;
        var globalOv = (props.sectionsData && props.sectionsData.globalOverrides) || {};
        function push(name, on) {
          if (!name || seen[name]) return;
          seen[name] = true;
          out.push({ name: name, on: on });
        }
        if (presetSec && typeof presetSec === "object") {
          for (var a in presetSec) {
            if (Object.prototype.hasOwnProperty.call(presetSec, a)) push(a, true);
          }
        }
        for (var b in globalOv) {
          if (Object.prototype.hasOwnProperty.call(globalOv, b)) push(b, false);
        }
        out.sort(function (x, y) {
          return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
        });
        return out;
      }

      /** 收进 / 移出这一段（只改草稿，保存才写盘）。 */
      function toggleSection(props, name) {
        var cur =
          props.presetSections && typeof props.presetSections === "object" ? props.presetSections : {};
        var next = {};
        for (var k in cur) {
          if (Object.prototype.hasOwnProperty.call(cur, k) && k !== name) next[k] = cur[k];
        }
        if (!Object.prototype.hasOwnProperty.call(cur, name)) {
          // 原来不在里面 → 现在要收进来。值取全局改写里那份（有就用，没有给个空对象占位）。
          var ov = (props.sectionsData && props.sectionsData.globalOverrides) || {};
          next[name] = Object.prototype.hasOwnProperty.call(ov, name) ? ov[name] : {};
        }
        props.setPresetSections(next);
      }

      function renderPickerBody(props) {
        // ⚠️ 只取 global 层。不带 ?session= 时后端**根本不返回** session 层，
        //    原来那个三元的 session 分支永远取到 undefined（死代码，已删）。
        var globalPreset = globalPresetOf(props);
        // ⚠️ **草稿优先**：用户勾了还没保存时，看到的应该是勾选状态本身，
  //    而不是盘上那条预设的旧内容。
  //    （踩过：勾一下弹 410，勾选框弹回去 —— 因为写的还是退役的 /defaults。）
  var activeIds = Array.isArray(props.presetDraft)
    ? props.presetDraft.slice()
    : (globalPreset && Array.isArray(globalPreset.prompts) ? globalPreset.prompts : []).slice();

        var usable = [];
        for (var pi = 0; pi < props.prompts.length; pi++) {
          if (props.prompts[pi] && props.prompts[pi].mode !== "none") usable.push(props.prompts[pi]);
        }
        var byId = {};
        for (var bi = 0; bi < usable.length; bi++) byId[usable[bi].id] = usable[bi];

        // 生效的排前面（按真实注入顺序），其余在后
        var ordered = [];
        var picked = {};
        for (var ai = 0; ai < activeIds.length; ai++) {
          var hit = byId[activeIds[ai]];
          if (hit) {
            ordered.push(hit);
            picked[hit.id] = true;
          }
        }
        for (var ri = 0; ri < usable.length; ri++) {
          if (!picked[usable[ri].id]) ordered.push(usable[ri]);
        }

        if (usable.length === 0) {
          return react.createElement(
            "div",
            { style: STATUS_LINE },
            "库里还没有可选的提示词 —— 在下面「新建」加一条。",
          );
        }

        var rows = [];
        for (var oi = 0; oi < ordered.length; oi++) {
          (function (p) {
            var on = !!picked[p.id];
            rows.push(
              react.createElement(
                "label",
                {
                  key: p.id,
                  title: p.description || p.id,
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    minWidth: "0",
                    cursor: props.presetsBusy ? "default" : "pointer",
                  },
                },
                [
                  react.createElement("input", {
                    key: "cb",
                    type: "checkbox",
                    checked: on,
                    disabled: props.presetsBusy,
                    onChange: function () {
                      var next = on
                        ? activeIds.filter(function (x) { return x !== p.id; })
                        : activeIds.concat([p.id]);
                      // ⚠️ **只改草稿** —— 保存时才写进预设。
                      //    预设是唯一载体，所以勾选不是「另一份生效列表」。
                      props.setPresetDraft(next);
                    },
                  }),
                  // 名字占满剩余宽度。
                  // ⚠️ 这里原来还跟了 `order 950` 和 `1 tokens` —— 用户明确说
                  //    不要。勾选清单只回答「哪几条生效」，order / token 数
                  //    在下面「个人提示词」的卡片详情里本来就有。
                  react.createElement(
                    "span",
                    {
                      key: "n",
                      style: Object.assign({}, CARD_TITLE, {
                        flex: "1 1 auto",
                        fontSize: "13px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }),
                    },
                    p.name || p.id,
                  ),
                ],
              ),
            );
          })(ordered[oi]);
        }

        var grid = react.createElement(
          "div",
          {
            key: "grid",
            style: {
              display: "grid",
              // 两列：库大了不至于拉成一条长龙；列宽自适应，窄屏自动收成一列
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "8px 18px",
            },
          },
          rows,
        );

        // ── 系统提示词 tag ────────────────────────────────────────────────
        //
        // ⚠️ 取消勾 = 这一段**回到原生**（从预设的 sections 里去掉），
        //    不是「关掉这段提示词」—— 那是「系统提示词」那栏的 disable 干的事。
        var tagRows = sectionTagRows(props);
        if (tagRows.length === 0) return grid;
        var tagEls = [];
        for (var ti = 0; ti < tagRows.length; ti++) {
          (function (row) {
            tagEls.push(
              react.createElement(
                "label",
                {
                  key: "s-" + row.name,
                  title: row.on
                    ? "这段的改动留在预设里（取消勾 = 回到原生）"
                    : "有一段改动还没进这条预设（勾上 = 收进来）",
                  style: TAG,
                },
                [
                  react.createElement("input", {
                    key: "cb",
                    type: "checkbox",
                    checked: row.on,
                    disabled: props.presetsBusy,
                    "data-section-tag": row.name,
                    onChange: function () {
                      toggleSection(props, row.name);
                    },
                  }),
                  react.createElement("span", { key: "n", style: { fontSize: "12px" } }, row.name),
                ],
              ),
            );
          })(tagRows[ti]);
        }
        return react.createElement("div", null, [
          react.createElement(
            "div",
            { key: "l", style: Object.assign({}, STATUS_LINE, { fontWeight: 600 }) },
            "系统提示词",
          ),
          react.createElement(
            "div",
            { key: "t", style: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" } },
            tagEls,
          ),
          grid,
        ]);
      }

      /**
       * 提示词组合 —— **一整张卡片**：标题就是「你现在在哪套配置上」。
       *
       *     写代码 ✎  全局默认 · 所有会话   已选 2 条  [写代码 ▾] [保存] [↻]
       *     ─────────────────────────────────────────────────────────────
       *     ☐ 格式契约  order 9500  1200 tokens
       *     ☐ 编码规范  order 950    300 tokens
       *
       * ⚠️ 头和体在**同一张卡片**里。这里踩了两次，都记下：
       *    1) 外面单独一行标题、下面再套一张卡片 → 三层结构；
       *    2) 下拉和保存留在卡片**外面** → 用户要的「卡片顶部」没做到
       *       （他的原话：「下拉框和保存不都说是卡片顶部了吗」）。
       */
      function renderCombo(props) {
        var matched = globalPresetOf(props);
        var list = (props.presetsData && props.presetsData.presets) || [];
        var currentId = matched ? matched.id : "";
        var currentName = matched ? matched.name : "未保存的配置";
        var bus = props.presetsBusy || !props.presetsData;

        // ⚠️ 这里原来先算了一遍「已选 N 条 · 共 X tokens」给卡片头用。
        //    用户说那些数字不需要，头里就不显示了 —— 计算也跟着删掉，
        //    免得留一段没人读的死代码。

        // 标题：预设名 + 改名铅笔；改名时就地变输入框
        var titleNode;
        if (props.renaming) {
          titleNode = react.createElement("input", {
            key: "rn",
            type: "text",
            className: "pm-input",
            style: Object.assign({}, SELECT_SM, { maxWidth: "200px" }),
            value: props.renameDraft,
            autoFocus: true,
            disabled: props.presetsBusy,
            onChange: function (ev) {
              props.setRenameDraft(ev.target.value);
            },
            onKeyDown: function (ev) {
              if (ev.key === "Enter") commitRename(props);
              if (ev.key === "Escape") props.setRenaming(false);
            },
            onBlur: function () {
              props.setRenaming(false);
            },
          });
        } else {
          titleNode = react.createElement(
            "span",
            { key: "t", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) },
            currentName,
          );
        }

        var head = react.createElement(
          "div",
          {
            style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
              flexDirection: "row",
              minHeight: "0",
              padding: "10px 14px",
              gap: "8px",
            }),
          },
          [
            // ⚠️ 这里**只有「当前配置名」**，没有功能标题。
            //
            //    「提示词组合」是**区块标题**，在卡片外面、跟「个人提示词」
            //    「系统提示词」同一套样式（见 renderCombo 末尾的 headLine）。
            //    卡片头这一行的语义是「你现在在哪套配置上」——
            //    塞个静态标题进来会把两件事混在一行。
            //    （踩过两轮：先是把区块标题整个换成预设名 → 标题没了；
            //      再把标题塞进卡片头 → 用户说「为什么功能标题在卡片顶部」。）
            // ⚠️ **全局注入开关在这一行行首** —— 用户要求「全局注入开关合入提示词组合」：
            //    它管的是**全局这一层整体注不注入**（关掉 = 没记录的会话什么都不挂），
            //    跟这一块是同一件事的两个面，所以放同一张卡。
            //    原来它自己占一张卡，用户分不清两个控件的边界。
            props.MasterSwitch
              ? react.createElement(props.MasterSwitch, {
                  key: "sw",
                  enabled: props.globalEnabled,
                  busy: props.presetsBusy,
                  onToggle: props.onToggleGlobal,
                // ⚠️ 裸装：摘掉它自带的卡片内边距。不传的话标题会被挤成竖排一个字。
                bare: true,
                })
              : null,
            titleNode,
            // 改名铅笔：只有「当前这套是一条真预设」时才有意义
            currentId && !props.renaming
              ? react.createElement(
                  "button",
                  {
                    key: "pen",
                    type: "button",
                    className: "pm-btn",
                    style: Object.assign({}, DETAIL_BTN, { padding: "1px 6px" }),
                    disabled: bus,
                    title: "改这套预设的名字",
                    onClick: function () {
                      props.setRenaming(true);
                      props.setRenameDraft(currentName);
                    },
                  },
                  "✎",
                )
              : null,
            react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
            // ⚠️ 这里原来还有两样，都删了：
            //    · 「全局默认 · 所有会话」——作用范围当时是因为这一块**没有**
            //      功能标题，得靠它说明自己是什么；现在标题回来了，它是纯噪音；
            //    · 「已选 N 条 · 共 X tokens」——勾选框自己会说，数字没人看。
            // 预设下拉：换一套
            react.createElement(
              "select",
              {
                key: "sel",
                className: "pm-input",
                style: SELECT_SM,
                disabled: bus,
                value: currentId,
                title: list.length === 0 ? "还没有预设 —— 勾好之后点「保存」存一套" : "换一套配置",
                onChange: function (ev) {
                  var id = ev.target.value;
                  if (id) applyPreset(id, props);
                },
              },
              [
                // 手改过（没匹配上任何预设）时给个占位项，否则 select 会跳到第一条
                currentId
                  ? null
                  : react.createElement("option", { key: "__none", value: "" }, "未保存的配置"),
                list.length === 0
                  ? react.createElement("option", { key: "__empty", value: "" }, "（还没有预设）")
                  : null,
                list.map(function (p) {
                  return react.createElement("option", { key: p.id, value: p.id }, p.name);
                }),
              ],
            ),
            // 保存：当前这套有名字就覆盖它自己，没名字就存新的
            react.createElement(
              "button",
              {
                key: "sav",
                type: "button",
                className: "pm-btn",
                style: bus ? BTN_BUSY : BTN,
                disabled: bus,
                title: currentId
                  ? "把当前勾选覆盖到预设「" + currentName + "」"
                  : "把当前勾选存成一套新预设",
                onClick: function () {
                  savePreset(props);
                },
              },
              props.presetsBusy ? "保存中…" : "保存",
            ),
              // ── 删除这条预设 ────────────────────────────────────────────────
              // ⚠️ 位置是用户指定的：**保存和刷新之间**。
              //    只在「当前这套是一条真预设」时才有意义（手改过的状态没东西可删）。
              //    ⚠️ 不新增 state —— hook 下标一动，测试里所有按序号塞状态的用例
              //       都要跟着挪。做完就走，反馈交给 flash。
              currentId
                ? react.createElement(
                    "button",
                    {
                      key: "del",
                      type: "button",
                      className: "pm-btn",
                      style: bus ? BTN_BUSY : BTN,
                      disabled: bus,
                      title: "删掉预设「" + currentName + "」（用它挂着的全局/会话会自动退回）",
                      onClick: function () {
                        props.doPreset({ action: "delete", id: currentId });
                      },
                    },
                    "删除",
                  )
                : null,
            react.createElement(
              "button",
              {
                key: "r",
                type: "button",
                className: "pm-btn",
                style: bus ? BTN_BUSY : BTN,
                disabled: bus,
                title: "重新从盘上读一遍",
                onClick: function () {
                  props.loadPresets();
                },
              },
              "↻",
            ),
          ],
        );

        var bodyNode = react.createElement(
          "div",
          { key: "body", style: CARD_DETAILS },
          props.presetsData
            ? renderPickerBody(props)
            : react.createElement("div", { style: STATUS_LINE }, "读取中…"),
        );

        // ⚠️ 区块标题在**卡片外面**，跟「个人提示词」「系统提示词」同一套样式
        //    （CARD_HEADING + 同一组间距）。
        //
        //    这里的两次返工值得记：先是把区块标题整个换成预设名（标题没了），
        //    再把标题塞进卡片头（用户说「为什么功能标题在卡片顶部」）。
        //    结论：**区块标题归区块，卡片头归卡片头** ——
        //    标题说明「这块干什么」，卡片头说明「当前在哪套配置上」。
        var headLine = react.createElement(
          "div",
          { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
          [react.createElement("span", { key: "n", style: HEADING_TITLE }, "提示词组合")],
        );

        // ⚠️ 卡片是独立一层，**不带 marginTop**（标题那行已经给了间距）。
        return react.createElement("div", null, [
          headLine,
          react.createElement(
            "div",
            { key: "card", style: CARD },
            [head, bodyNode],
          ),
        ]);
      }

      /**
       * 换一套：应用预设（把它的内容写回**全局层**）。
       *
       * ⚠️ 不需要传「写到哪一层」—— 应用是**写回预设自己那一层**
       *    （预设里存着 scope），后端按预设的 scope 决定。面板这边
       *    只能存全局预设，所以永远写全局层。
       */
      function applyPreset(id, props) {
        props.doPreset({ action: "apply", id: id });
      }

      /**
       * 保存当前勾选。
       *
       * ⚠️ 当前这套**已经有名字**时是**覆盖它自己**，不是又存一份同名的 ——
       *    同名会让列表里堆一串「写代码」「写代码 2」「写代码 3」。
       *    覆盖走同一条 save（同名 → presetId 命中同一条）。
       */
      function savePreset(props) {
    // ⚠️ 草稿要**一起交上去** —— 不然「勾了几条 → 保存」只会存下预设的旧内容。
    var draft = Array.isArray(props.presetDraft) ? props.presetDraft : null;
        var matched = globalPresetOf(props);
        if (matched) {
          props.doPreset(Object.assign({ action: "save", name: matched.name }, draft ? { prompts: draft } : {}));
          return;
        }
        var name = props.presetName.trim();
        if (!name) {
          props.flash("先给它起个名字");
          props.setRenaming(true);
          props.setRenameDraft("");
          return;
        }
        props.doPreset(Object.assign({ action: "save", name: name }, draft ? { prompts: draft } : {})).then(function () {
          props.setPresetName("");
        });
      }

      /** 改名：把当前这条预设换个名字（id 跟着变，所以要跟着更新选中）。 */
      function commitRename(props) {
        var next = props.renameDraft.trim();
        props.setRenaming(false);
        if (!next) return;
        var matched = globalPresetOf(props);
        if (!matched || matched.name === next) return;
        props.doPreset({ action: "update", id: matched.id, name: next });
      }

      /** 这一块没有 CSS module，只有内联样式；保留成接口形状，宿主会调。 */
      function installStyles() {}

      return {
        ComboBlock: renderCombo,
        installStyles: installStyles,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
