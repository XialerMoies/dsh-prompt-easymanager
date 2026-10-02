// dsh-prompt-easymanager · 系统提示词段落改写（包内 chunk）
//
// 由 client.editor.js 用 require.async 拉起；必须注册成 id "dsh-prompt-easymanager"
// + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走。改完跑
//    `npm run bump:rev`。
//
// 这一块管的是「dsh 自己往系统提示词里放的段落」：逐段改写 / 关掉 / 还原。
// 跟个人提示词库是两件事 —— 那个管「额外挂哪几条」，这个管「原生段落长什么样」。
//
// ⚠️ **状态不在这里**。sections / sectionsBusy / openSection / sectionDrafts /
//    applySection 全留在 client.editor.js，由宿主那一层当 props 递进来。
//    原因：测试是按 hook 下标塞状态的，把状态搬进 chunk 会让所有按索引塞状态的
//    地方错位。这一步只搬**渲染**。

window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.editor.sections.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    function create(api) {
      // 段落名 → 中文标签（宿主给的那一份，别在这儿再写一个）
      var sectionLabel = api.label;
      var ACTIONS = api.style.ACTIONS;
      var BADGE_MUTED = api.style.BADGE_MUTED;
      var BADGE_OFF = api.style.BADGE_OFF;
      var BADGE_OK = api.style.BADGE_OK;
      var BADGE_WARN = api.style.BADGE_WARN;
      var BTN = api.style.BTN;
      var BTN_BUSY = api.style.BTN_BUSY;
      var BTN_DANGER = api.style.BTN_DANGER;
      var BTN_PRIMARY = api.style.BTN_PRIMARY;
      var CARD = api.style.CARD;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_NOTICE = api.style.CARD_NOTICE;
      var CARD_TITLE = api.style.CARD_TITLE;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      var HINT_TEXT = api.style.HINT_TEXT;
      var PRE = api.style.PRE;
      var RAW_NAME = api.style.RAW_NAME;
      var SLOT_HEAD = api.style.SLOT_HEAD;
      var SLOT_WHY = api.style.SLOT_WHY;
      var STATUS_LINE = api.style.STATUS_LINE;
      var TEXTAREA = api.style.TEXTAREA;
      var WARN = api.style.WARN;

      function sectionBadge(row) {
        if (row.status === "stale") return { text: "已失效", style: BADGE_WARN };
        if (row.status === "untouched") return { text: "官方原文", style: BADGE_MUTED };
        if (row.action === "disable") return { text: "已关掉", style: BADGE_OFF };
        if (row.drifted && !row.driftAcknowledged) return { text: "官方已更新", style: BADGE_WARN };
        return { text: "已改写", style: BADGE_OK };
      }

      function renderSectionCard(row, props) {
        var badge = sectionBadge(row);
        var isOpen = props.openSection === row.name;
        // 显示什么：改写过的显示用户的，否则显示官方原文
        var shown = row.status === "apply" && row.action === "replace" ? row.text : row.original;
        var draft = props.sectionDrafts[row.name];
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
                props.setOpenSection(isOpen ? null : row.name);
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
                    style: props.sectionsBusy ? BTN_BUSY : BTN,
                    disabled: props.sectionsBusy,
                    onClick: function (e) {
                      e.stopPropagation();
                      props.applySection(row.name, "acknowledge");
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
                disabled: props.sectionsBusy,
                spellCheck: false,
                onChange: function (e) {
                  var v = e.target.value;
                  props.setSectionDrafts(function (prev) {
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
                    style: props.sectionsBusy ? BTN_BUSY : BTN_PRIMARY,
                    disabled: props.sectionsBusy,
                    onClick: function () {
                      props.applySection(row.name, "replace", draft).then(function () {
                        props.setSectionDrafts(function (prev) {
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
                    disabled: props.sectionsBusy,
                    onClick: function () {
                      props.setSectionDrafts(function (prev) {
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
                    style: props.sectionsBusy ? BTN_BUSY : BTN,
                    disabled: props.sectionsBusy,
                    onClick: function () {
                      props.setSectionDrafts(function (prev) {
                        return Object.assign({}, prev, {
                          [row.name]:
                            changed && row.action === "replace" ? row.text : row.original,
                        });
                      });
                    },
                  },
                  changed && row.action === "replace" ? "继续编辑" : "改写",
                ),
                // ⚠️ **「关掉」按钮已删** —— 新模型里它就是**「不勾」**。
                //
                //    老模型把「关闭一段」做成一个独立的动作（`action: "disable"`，
                //    正文注册成空、dsh 丢弃空段落）。新模型里段落的三种状态是：
                //
                //        改过的     →  用你改的那份
                //        取消勾选   →  不进提示词     ← 「关闭」现在就是这个
                //        都没提到   →  用 dsh 原版
                //
                //    所以不需要单独一个按钮 —— 上面「📁 系统提示词」那块
                //    把勾去掉就行，而且那样**一眼能看出哪些没进提示词**，
                //    比一个按钮留下的状态清楚得多。
                //
                //    ⚠️ 后端的 `disable` 动作**保留**（老客户端 / 第三方调用还用），
                //       它现在等价于「取消勾选」。
                changed
                  ? react.createElement(
                      "button",
                      {
                        key: "r",
                        type: "button",
                        className: "pm-btn",
                        style: props.sectionsBusy ? BTN_BUSY : BTN,
                        disabled: props.sectionsBusy,
                        title: "删掉你的改动，回到官方当前的文本（官方更新过的话就是新版）",
                        onClick: function (e) {
                          e.stopPropagation();
                          props.applySection(row.name, "restore");
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

      function renderEmptySlot(slot, props) {
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
       * 「系统提示词」整块。
       *
       * ⚠️ 收 props：sections / sectionsBusy / openSection / sectionDrafts /
       *    applySection / loadSections / helpIcon 全由编辑器那一层递进来
       *    （**状态留在编辑器**，测试按 hook 下标塞状态，搬走会全错位）。
       */
      function SectionsBlock(props) {
        var head = react.createElement(
          "div",
          // ⚠️ 间距给足。这一块跟上面「提示词组合」是两个不相干的功能，
          //    标题又长得跟卡片标题很像 —— 只隔 4px 时视觉上糊成一片，
          //    看着像同一块内容的一部分（用户提的就是这个）。
          { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
          [
            react.createElement("span", { key: "n", style: HEADING_TITLE }, "系统提示词"),
            // 两段说明并成一个「?」—— 详见 client.editor.switch.js
            props.helpIcon(
              "这些是 dsh 自己往系统提示词里放的段落。可以逐段改写或关掉，也能还原。" +
                "官方以后新增段落会自动出现在这里，改过的会标出来 —— 你的改动不会被官方更新顶掉。" +
                "\n\n" +
                "这里改的是全局默认，所有会话都生效。" +
                "只想改某一个会话的话，用会话头那一行的「提示词」按钮。",
            ),
            react.createElement(
              "span",
              { key: "c", style: HEADING_COUNT },
              props.sections && props.sections.counts ? props.sections.summary : "读取中…",
            ),
            react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
            react.createElement(
              "button",
              {
                key: "r",
                type: "button",
                className: "pm-btn",
                style: props.sectionsBusy ? BTN_BUSY : BTN,
                disabled: props.sectionsBusy,
                onClick: function () {
                  props.loadSections();
                },
              },
              "重新读取",
            ),
          ],
        );

        if (props.sections === null) {
          return react.createElement("div", null, [
            head,
            react.createElement("div", { key: "l", style: STATUS_LINE }, "读取中…"),
          ]);
        }

        var items = [];
        if (props.sections.outcome !== "ok") {
          items.push(
            react.createElement(
              "div",
              { key: "err", style: WARN },
              (props.sections.error || "读取失败") + "（还没有存活的会话时读不到，先开个会话再回来）",
            ),
          );
        }

        // 改动过的排前面，方便一眼看到自己动过什么
        var ordered = []
          .concat(props.sections.applied || [])
          .concat(props.sections.stale || [])
          .concat(props.sections.untouched || []);
        for (var si = 0; si < ordered.length; si++) items.push(renderSectionCard(ordered[si], props));

        // ── 没被注册的槽位（灰卡片，不可操作）──────────────────────────
        //
        // 「为什么 bash 不在」——因为 dsh 这次没往那个位置放东西，不是列表出错。
        // 只列判断确定的（静态段名 / 没有包注册它），模板名不列（详见
        // scripts/lib/section-slots.mjs）。
        var slots = props.sections.emptySlots || [];
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
          for (var sj = 0; sj < slots.length; sj++) items.push(renderEmptySlot(slots[sj], props));
        }

        return react.createElement("div", null, [head].concat(items));
      }

      /** 这一块没有 CSS module，只有内联样式；保留成接口形状，宿主会调。 */
      function installStyles() {}

      return {
        SectionsBlock: SectionsBlock,
        installStyles: installStyles,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
