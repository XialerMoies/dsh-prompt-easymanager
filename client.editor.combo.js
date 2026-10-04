// dsh-prompt-easymanager · 提示词组合 + 预设（包内 chunk）
//
// 由 client.editor.js 用 require.async 拉起；必须注册成 id "dsh-prompt-easymanager"
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
  id: "dsh-prompt-easymanager",
  chunk: "client.editor.combo.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    function create(api) {
      var ActionButton = api.ui.ActionButton;
      var PresetSelector = api.ui.PresetSelector;
      var Menu = api.ui.Menu;
      var IconChevronDownOutlineRegular = api.ui.IconChevronDownOutlineRegular;
      var IconEditOutlineRegular = api.ui.IconEditOutlineRegular;
      var IconEllipsisOutlineRegular = api.ui.IconEllipsisOutlineRegular;
      var Checkbox = api.ui.Checkbox;
      var Input = api.ui.Input;
      var presetModel = api.preset;
      var isNativePreset = presetModel.isNativePreset;
      var mergeEquivalentPresets = presetModel.mergeEquivalentPresets;
      var presetLabelOf = presetModel.presetLabelOf;
      var presetDisplayLabel = presetModel.presetDisplayLabel;
      var CARD = api.style.CARD;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_TITLE = api.style.CARD_TITLE;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var STATUS_LINE = api.style.STATUS_LINE;
      // 只在前端草稿里使用的哨兵：选中「新建」后，当前内容会作为新预设保存，
      // 不会误覆盖当前已选中的那条预设。
      var NEW_PRESET_SENTINEL = "__new_preset__";

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
        var hasSelection = !!(props.presetSelection && typeof props.presetSelection === "object");
        var selection = hasSelection ? props.presetSelection : {
          listed: props.presetSections && typeof props.presetSections === "object"
            ? Object.keys(props.presetSections)
            : [],
          excluded: [],
          sections: props.presetSections || {},
        };
        // Once the new selection shape exists, it is authoritative. Falling
        // back to the legacy `presetSections` here can turn a native-only
        // exclusion into a phantom edited tag after a rerender.
        var presetSec = hasSelection ? selection.sections : props.presetSections;
        var listed = Array.isArray(selection.listed) ? selection.listed : [];
        function push(name, on) {
          if (!name || seen[name]) return;
          seen[name] = true;
          out.push({ name: name, on: on });
        }
        if (presetSec && typeof presetSec === "object") {
          for (var a in presetSec) {
            if (Object.prototype.hasOwnProperty.call(presetSec, a)) push(a, listed.indexOf(a) >= 0);
          }
        }
        out.sort(function (x, y) {
          return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
        });
        return out;
      }

      /** 收进 / 移出这一段（只改草稿，保存才写盘）。 */
      function toggleSection(props, name) {
        var current = props.presetSelection || { listed: [], excluded: [], sections: {}, known: [] };
        var listed = Array.isArray(current.listed) ? current.listed.slice() : [];
        var excluded = Array.isArray(current.excluded) ? current.excluded.slice() : [];
        var isListed = listed.indexOf(name) >= 0;
        listed = listed.filter(function (x) { return x !== name; });
        if (!isListed) listed.push(name);
        var setter = props.setPresetSelection || function (next) {
          if (props.setPresetSections) props.setPresetSections(next.sections || {});
        };
        setter({
          listed: listed,
          excluded: excluded,
          sections: Object.assign({}, current.sections || {}),
          known: Array.isArray(current.known) ? current.known.slice() : [],
        });
      }

      function toggleNativeSection(props, name) {
        var current = props.presetSelection || { listed: [], excluded: [], sections: {}, known: [] };
        var excluded = Array.isArray(current.excluded) ? current.excluded.slice() : [];
        var at = excluded.indexOf(name);
        if (at >= 0) excluded.splice(at, 1);
        else excluded.push(name);
        var setter = props.setPresetSelection || function (next) {
          if (props.setPresetSections) props.setPresetSections(next.sections || {});
        };
        setter({
          listed: Array.isArray(current.listed) ? current.listed.slice() : [],
          excluded: excluded,
          sections: Object.assign({}, current.sections || {}),
          known: Array.isArray(current.known) ? current.known.slice() : [],
        });
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

        // ⚠️ **库里一条提示词都没有时，不能整个 return。**
        //
        //    老版本在这儿直接返回「库里还没有可选的提示词」——
        //    于是**段落那一块也跟着不渲染了**（它以 grid 为兄弟节点）。
        //    新模型要求三块一直可见（个人提示词 / 改动提示词 / 系统提示词），
        //    所以改成：个人提示词那块显示成一句提示，**段落照常渲染**。
        var rows = [];
        if (usable.length === 0) {
          rows.push(
            react.createElement(
              "div",
              { key: "no-prompts", style: STATUS_LINE },
              "库里还没有可选的提示词 —— 在下面「新建」加一条。",
            ),
          );
        }

        for (var oi = 0; oi < ordered.length; oi++) {
          (function (p) {
            var on = !!picked[p.id];
            var toggle = function () {
              var next = on
                ? activeIds.filter(function (x) { return x !== p.id; })
                : activeIds.concat([p.id]);
              props.setPresetDraft(next);
            };
            rows.push(react.createElement(Checkbox, {
              key: p.id,
              checked: on,
              disabled: props.presetsBusy,
              label: p.name || p.id,
              title: p.description || p.id,
              onChange: toggle,
            }));
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

        // ── 三个文件夹的 tag 区域 ─────────────────────────────────────────
        //
        // 用户要的就这一句：**预设 = 从三个文件夹里勾出来的清单。**
        //
        //     📁 个人提示词        你写的那些
        //     📁 改动提示词        你改过的段落
        //     📁 系统提示词        dsh 原生的那些段
        //
        // ⚠️ **「改动」和「原始」分成两块，靠的是「原始」那份快照。**
        //    没有它的话，用户只能看到「改过的那几段」，看不到
        //    「还有哪些原生段在、哪些被排除了」—— 而后者正是这次要补的视野。
        var sectionsArea = function () {
          var tagRows = sectionTagRows(props);
          var sd = props.sectionsData || {};
          var avail = Array.isArray(sd.availableNative) ? sd.availableNative : [];
          // ⚠️ **`excluded` 要从服务端给的名单来。**
          //    光看 `applied` 分不出「没改过」和「明确不要」—— 那边长得一样。
          //    服务端在 `/sections` 的响应里回 `excludedSections`。
          var excluded = {};
          // Native checkbox state follows the local preset draft. The server
          // value is only the initial fallback; using it on every render makes
          // a click appear to do nothing until the preset is saved.
          var exList = props.presetSelection && Array.isArray(props.presetSelection.excluded)
            ? props.presetSelection.excluded
            : (Array.isArray(sd.excludedSections) ? sd.excludedSections : []);
          for (var xi = 0; xi < exList.length; xi++) excluded[exList[xi]] = true;

          var mkTag = function (name, on, keyPrefix, title, onToggle) {
            return react.createElement(Checkbox, {
              key: keyPrefix + "-" + name,
              checked: on,
              disabled: props.presetsBusy,
              title: title,
              label: name,
              "data-section-tag": name,
              onChange: function () {
                (onToggle || function () { toggleSection(props, name); })();
              },
            });
          };

          var rowStyle = { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" };
          var headStyle = Object.assign({}, STATUS_LINE, { fontWeight: 600 });

          // ① 个人提示词 —— 勾了哪几条（列表放在这个标题下面）
          //
          // ⚠️ 优先看**草稿**（用户正在勾的那份）；没有草稿才回落到
          //    全局那条预设存的条数。看错的话数字会跟下面清单对不上。
          var personalOn = 0;
          if (Array.isArray(props.presetDraft)) {
            personalOn = props.presetDraft.length;
          } else {
            var gp = globalPresetOf(props.presetsData);
            personalOn = gp && Array.isArray(gp.prompts) ? gp.prompts.length : 0;
          }

          // ② 改动提示词 —— `tagRows` 里勾着的那些
          var editedEls = [];
          for (var ei = 0; ei < tagRows.length; ei++) {
            editedEls.push(
              mkTag(
                tagRows[ei].name,
                tagRows[ei].on,
                "edited",
                tagRows[ei].on ? "这段的改动留在预设里（取消勾 = 使用原生）" : "这段改动暂不注入（勾上 = 使用改写）",
              ),
            );
          }

          // ③ 系统提示词 —— **全部原生段都列出来**。
          //    改写副本和原生段是两个独立 tag；同名是有意的：一个控制
          //    原生正文，一个控制改写正文，不能因为改写过就把原生段藏掉。
          var nativeEls = [];
          for (var ni = 0; ni < avail.length; ni++) {
            var nm = avail[ni];
            nativeEls.push(
            (function (nativeName) {
              return mkTag(
                nativeName,
                !excluded[nativeName],
                "native",
                "这段用 dsh 原生的（取消勾 = 不要它）",
                function () { toggleNativeSection(props, nativeName); },
              );
            })(nm),
            );
          }

          var groups = [
            react.createElement("div", { key: "g1" }, [
              react.createElement(
                "div",
                { key: "l", style: headStyle },
                "个人提示词" + (personalOn > 0 ? "（勾了 " + personalOn + " 条）" : "（一条没勾）"),
              ),
              react.createElement(
                "div",
                { key: "h", style: Object.assign({}, STATUS_LINE, { marginBottom: "8px" }) },
                personalOn > 0 ? "要注入的提示词在下面的清单里打勾。" : "下面清单里打勾就会加进来。",
              ),
              grid,
            ]),
          ];

          groups.push(
            react.createElement("div", { key: "g2" }, [
              react.createElement(
                "div",
                { key: "l", style: headStyle },
                "改动提示词" + (editedEls.length > 0 ? "（" + editedEls.length + " 段）" : "（还没改过）"),
              ),
              editedEls.length > 0
                ? react.createElement("div", { key: "t", style: rowStyle }, editedEls)
                : react.createElement(
                    "div",
                    { key: "h", style: Object.assign({}, STATUS_LINE, { marginBottom: "12px" }) },
                    "在下面「系统提示词」那一栏改一段，它就会挪到这儿。",
                  ),
            ]),
          );

          groups.push(
            react.createElement("div", { key: "g3" }, [
              react.createElement(
                "div",
                { key: "l", style: headStyle },
                "系统提示词（原生 " + nativeEls.length + " 段）",
              ),
              nativeEls.length > 0
                ? react.createElement("div", { key: "t", style: rowStyle }, nativeEls)
                : react.createElement(
                    "div",
                    { key: "h", style: Object.assign({}, STATUS_LINE, { marginBottom: "12px" }) },
                    "读不到原生段落 —— 先开一个会话再回来。",
                  ),
              react.createElement(
                "div",
                { key: "sum", style: Object.assign({}, STATUS_LINE, { marginBottom: "12px" }) },
                "预设 = 上面三块里勾出来的一份清单。" +
                  // ⚠️ **纯文本 UI，不能写 markdown 星号** —— 会原样显示出来。
                  //    这里原来写的是「取消勾的**不进提示词**」，
                  //    真机截图里那两个星号明晃晃地显示着。
                  "勾着的段用 dsh 原版，改过的用你改的那份，取消勾的不进提示词。",
              ),
            ]),
          );

          return react.createElement("div", { key: "sections-area" }, groups);
        };

        return react.createElement("div", null, [sectionsArea()]);
      }

      /** Prompt selection and preset actions, grouped by their scope. */
      function renderCombo(props) {
        var menuState = react.useState(false);
        var menuTarget = menuState[0];
        var setMenuTarget = menuState[1];
        var matched = globalPresetOf(props);
        var allPresets = (props.presetsData && props.presetsData.presets) || [];
        // 原生入口是选择器的固定项，不属于用户预设列表。
        var nativeMatched = isNativePreset(matched);
        var list = mergeEquivalentPresets(
          allPresets.filter(function (p) { return !isNativePreset(p); }),
          nativeMatched ? null : matched && matched.id,
        );
        var newPresetMode = props.presetName === NEW_PRESET_SENTINEL;
        var currentId = newPresetMode ? "" : (matched && !nativeMatched ? matched.id : "__native");
        var globalPresetId = props.presetsData && props.presetsData.global
          ? props.presetsData.global.presetId
          : null;
        var currentName = newPresetMode
          ? "新建预设"
          : !props.presetsData
            ? "未保存的配置"
          : matched && !nativeMatched
            ? presetLabelOf(matched)
            : (matched && nativeMatched) || globalPresetId == null
              ? "系统提示词（原生）"
              : "未保存的配置";
        var bus = props.presetsBusy || !props.presetsData;

        // ⚠️ 这里原来先算了一遍「已选 N 条 · 共 X tokens」给卡片头用。
        //    用户说那些数字不需要，头里就不显示了 —— 计算也跟着删掉，
        //    免得留一段没人读的死代码。

        // ── 第 1 段：全局注入开关 ──────────────────────────────────────────
        //
        // ⚠️ 它**自己占一行** —— 它管的是「整个全局层注不注入」，
        //    跟「这个会话/全局用哪套配置」是两件事。挤在同一行会让人以为
        //    它是这套配置的一个属性。
        //
        //    另外它自带 CARD + 内边距（单独占一张卡时是对的），塞进来会
        //    把旁边的标题挤到只剩一个字宽 → 竖排。所以传 `bare` 摘掉卡片感。
        var swRow = props.MasterSwitch
          ? react.createElement(
              "div",
              {
                key: "sw",
                style: {
                  display: "flex",
                  alignItems: "center",
                  minWidth: "0",
                  paddingBottom: "8px",
                  borderBottom: ".5px solid var(--dsw-alias-border-l2)",
                },
              },
              react.createElement(props.MasterSwitch, {
                enabled: props.globalEnabled,
                busy: props.presetsBusy,
                onToggle: props.onToggleGlobal,
                bare: true,
              }),
            )
          : null;

        // ── 第 2 段：当前预设 + 常用动作 ────────────────────────────────────
        var presetControl = props.renaming
          ? react.createElement(
              "div",
              { key: "rename-wrap", style: { flex: "1 1 180px", minWidth: "0" } },
              react.createElement(Input, {
                type: "text",
                value: props.renameDraft,
                autoFocus: true,
                disabled: props.presetsBusy,
                "aria-label": newPresetMode ? "新预设名称" : "预设名称",
                onChange: function (ev) {
                  props.setRenameDraft(ev.target.value);
                },
                onKeyDown: function (ev) {
                  if (ev.key === "Enter" && !newPresetMode) commitRename(props);
                  if (ev.key === "Escape") props.setRenaming(false);
                },
              }),
            )
          : react.createElement(
              "div",
              { key: "preset-wrap", style: { flex: "1 1 180px", minWidth: "0" } },
              react.createElement(PresetSelector, {
                open: menuTarget === "preset",
                onOpenChange: function (next) { setMenuTarget(next ? "preset" : null); },
                closeOnSelect: true,
                label: currentName,
                variant: "ghost",
                disabled: bus,
                title: list.length === 0 ? "还没有预设 —— 勾好之后点「保存」存一套" : "切换当前预设",
                "aria-label": "选择提示词预设",
                items: [
                  { id: "__native", label: "系统提示词（原生）" },
                ].concat(
                  currentId ? [] : [{ id: "__unsaved", label: "未保存的配置", disabled: true }],
                  list.map(function (p, pIndex) {
                    return { id: p.id, label: presetDisplayLabel(list, pIndex) };
                  }),
                  list.length === 0 ? [{ type: "label", id: "__empty", text: "还没有预设" }] : [],
                ),
                selectedId: currentId || (newPresetMode ? "__unsaved" : "__native"),
                onSelect: function (id) {
                  if (id === "__native") {
                    if (props.onToggleGlobal) props.onToggleGlobal(false, null);
                  } else if (id) applyPreset(id, props);
                },
                align: "start",
                side: "bottom",
                portal: true,
              }),
            );

        var moreItems = [
          { id: "__reload", label: "重新读取", disabled: bus },
        ].concat(
          currentId && currentId !== "__native"
            ? [
                { type: "separator", id: "__preset-actions-separator" },
                { id: "__delete", label: "删除预设", danger: true, disabled: bus },
              ]
            : [],
        );

        var actRow = react.createElement(
          "div",
          {
            key: "act",
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              minWidth: "0",
              flexWrap: "wrap",
            },
          },
          [
            presetControl,
            // 改名：只有当前选择了用户预设时才显示。
            currentId && currentId !== "__native" && !props.renaming
              ? react.createElement(
                  ActionButton,
                  {
                    key: "pen",
                    type: "button",
                    variant: "ghost",
                    disabled: bus,
                    title: "改这套预设的名字",
                    "aria-label": "编辑预设名称",
                    onClick: function () {
                      props.setRenaming(true);
                      props.setRenameDraft(currentName);
                    },
                  },
                  react.createElement(IconEditOutlineRegular, { size: 14 }),
                )
              : null,
            // 新建时预设名已进入编辑状态，不再重复展示新建按钮。
            !props.renaming
              ? react.createElement(
                  ActionButton,
                  {
                    key: "new",
                    type: "button",
                    variant: "outline",
                    disabled: bus,
                    title: "以当前勾选内容新建一套预设",
                    onClick: function () {
                      props.setPresetName(NEW_PRESET_SENTINEL);
                      props.setRenameDraft("");
                      props.setRenaming(true);
                    },
                  },
                  "新建预设",
                )
              : null,
            react.createElement(
              "div",
              {
                key: "grp",
                style: { display: "flex", alignItems: "center", gap: "6px", flex: "none", marginLeft: "auto" },
              },
              [
                props.renaming
                  ? react.createElement(
                      ActionButton,
                      {
                        key: "cancel-rename",
                        type: "button",
                        variant: "ghost",
                        disabled: bus,
                        onClick: function () {
                          if (newPresetMode) props.setPresetName("");
                          props.setRenaming(false);
                        },
                      },
                      "取消",
                    )
                  : null,
                react.createElement(
                  ActionButton,
                  {
                    key: "sav",
                    type: "button",
                    variant: "primary",
                    disabled: bus,
                    title: newPresetMode
                      ? "创建这套预设"
                      : props.renaming
                        ? "保存预设名称"
                        : currentId && currentId !== "__native"
                          ? "把当前勾选覆盖到预设「" + currentName + "」"
                          : "把当前勾选存成一套新预设",
                    "data-pm-save-preset": "1",
                    onClick: function () {
                      if (props.renaming && !newPresetMode) commitRename(props);
                      else savePreset(props);
                    },
                  },
                  newPresetMode
                    ? "创建预设"
                    : props.renaming
                      ? "保存名称"
                      : props.presetsBusy
                        ? "保存中…"
                        : "保存",
                ),
                !props.renaming
                  ? react.createElement(
                      Menu,
                      {
                        key: "more",
                        open: menuTarget === "more",
                        anchor: react.createElement(
                          ActionButton,
                          {
                            type: "button",
                            variant: "ghost",
                            disabled: bus,
                            title: "更多预设操作",
                            "aria-label": "更多预设操作",
                            "aria-haspopup": "menu",
                            "aria-expanded": menuTarget === "more" ? "true" : "false",
                            onClick: function () {
                              setMenuTarget(menuTarget === "more" ? null : "more");
                            },
                          },
                          react.createElement(IconEllipsisOutlineRegular, { size: 16 }),
                        ),
                        items: moreItems,
                        onSelect: function (id) {
                          setMenuTarget(null);
                          if (id === "__reload") props.loadPresets();
                          if (id === "__delete" && currentId && currentId !== "__native") {
                            props.doPreset({ action: "delete", id: currentId });
                          }
                        },
                        onClose: function () { setMenuTarget(null); },
                        align: "end",
                        side: "bottom",
                        portal: true,
                      },
                    )
                  : null,
              ],
            ),
          ],
        );

        // ⚠️ 两段**竖排**：开关一行，标题+动作一行。
        //    之前 7 样全塞一行、靠 wrap 兜底 → 换行位置随机（用户说「按钮位置问题」）。
        var head = react.createElement(
          "div",
          {
            // ⚠️ **标记**：测试（以及以后可能的 DOM 补丁）靠它定位，不用猜结构。
            //    猜过一版（「直接子元素里有 role=switch 的 div」）—— 失败：
            //    `swRow` 的直接子元素是 MasterSwitch **返回的那个 div**，
            //    带 role="switch" 的 span 在更深一层，判据一路钻到了外层容器。
            "data-pm-card-head": "1",
            style: Object.assign({}, CARD_HEAD, {
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minWidth: "0",
              padding: "10px 14px",
            }),
          },
            [swRow, actRow],
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
    var selection = props.presetSelection || null;
        var matched = props.presetName === NEW_PRESET_SENTINEL ? null : globalPresetOf(props);
        if (matched) {
          // 覆盖当前预设必须走 update。`save` 会按同名生成新 id，
          // 全局仍指向旧预设，于是用户刚勾上的改写看似保存却继续 pending，
          // 同时列表里不断出现重复预设。
          props.doPreset(Object.assign({ action: "update", id: matched.id }, draft ? { prompts: draft } : {}, selection ? { selection: selection } : {}));
          return;
        }
        var name = (props.renameDraft || props.presetName || "").trim();
        if (name === NEW_PRESET_SENTINEL) name = "";
        if (!name) {
          props.flash("先给它起个名字");
          props.setRenaming(true);
          props.setRenameDraft("");
          return;
        }
        props.doPreset(Object.assign({ action: "save", name: name }, draft ? { prompts: draft } : {}, selection ? { selection: selection } : {})).then(function (saved) {
          props.setPresetName("");
          props.setRenaming(false);
          // 新建完成后立即把新预设设为当前项，用户能马上看到名字和生效状态。
          // 已有预设的“保存”仍然只覆盖当前项，不改变选择。
          if (saved && saved.id) props.doPreset({ action: "apply", id: saved.id });
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
