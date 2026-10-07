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
      var ActionButton = api.ui.ActionButton;
      var Button = api.ui.Button;
      var Tag = api.ui.Tag;
      var Modal = api.ui.Modal;
      // 段落名 → 中文标签（宿主给的那一份，别在这儿再写一个）
      var sectionLabel = api.label;
      var ACTIONS = api.style.ACTIONS;
      var EDITOR_FOOTER = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginTop: "8px",
        width: "100%",
        boxSizing: "border-box",
      };
      var CARD = api.style.CARD;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_NOTICE = api.style.CARD_NOTICE;
      var NOTICE_ROW = api.style.NOTICE_ROW;
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

      var TEXT_SWITCH = {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "8px",
        marginTop: "8px",
        marginBottom: "0",
        minHeight: "18px",
      };
      var TEXT_SWITCH_BUTTON = {
        minWidth: "30px",
        width: "30px",
        height: "18px",
        padding: "4px 0",
        justifyContent: "center",
        borderRadius: "var(--dsw-radius-sm)",
      };
      var TEXT_SWITCH_BAR = {
        display: "block",
        width: "24px",
        height: "3px",
        borderRadius: "999px",
        background: "currentColor",
        transition: "transform 160ms ease, opacity 160ms ease",
      };
      var TEXT_SWITCH_TRACK = {
        width: "100%",
        overflow: "hidden",
      };
      var TEXT_SWITCH_RAIL = {
        display: "flex",
        width: "200%",
        transition: "transform 180ms ease",
        willChange: "transform",
      };
      var TEXT_SWITCH_PANEL = {
        flex: "0 0 50%",
        minWidth: "0",
      };
      var TEXT_VIEW_LABEL = {
        display: "block",
        marginBottom: "6px",
        color: "var(--dsw-alias-label-secondary, inherit)",
        fontSize: "12px",
        lineHeight: "18px",
      };

      function sectionBadge(row) {
        if (row.status === "stale") return { text: "已失效", tone: "danger" };
        if (row.status === "pending") return { text: "已改写，未勾选", tone: "outline" };
        if (row.status === "untouched") return { text: "官方原文", tone: "quiet" };
        if (row.action === "disable") return { text: "未勾选", tone: "outline" };
        if (row.drifted && !row.driftAcknowledged) return { text: "官方已更新", tone: "warning" };
        return { text: "已改写", tone: "success" };
      }

      // 查看和编辑共用同一个操作栏；只替换按钮内容，避免两套布局互相影响。
      function renderSectionActions(row, props, options) {
        var editing = options.editing;
        var changed = options.changed;
        var buttons = editing
          ? [
              react.createElement(
                ActionButton,
                {
                  key: "s",
                  type: "button",
                  variant: "primary",
                  disabled: props.sectionsBusy,
                  onClick: function (e) {
                    e.stopPropagation();
                    props.applySection(row.name, "replace", options.draft).then(function (saved) {
                      if (!saved) return;
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
                ActionButton,
                {
                  key: "c",
                  type: "button",
                  variant: "outline",
                  disabled: props.sectionsBusy,
                  onClick: function (e) {
                    e.stopPropagation();
                    if (typeof props.setTextView === "function") props.setTextView(row.name, "rewrite");
                    props.setSectionDrafts(function (prev) {
                      var next = Object.assign({}, prev);
                      delete next[row.name];
                      return next;
                    });
                  },
                },
                "取消",
              ),
            ]
          : [
              react.createElement(
                ActionButton,
                {
                  key: "e",
                  type: "button",
                  variant: "outline",
                  disabled: props.sectionsBusy,
                  onClick: function (e) {
                    e.stopPropagation();
                    if (typeof props.setTextView === "function") props.setTextView(row.name, "rewrite");
                    props.setSectionDrafts(function (prev) {
                      return Object.assign({}, prev, {
                        [row.name]: changed && row.action === "replace" ? row.text : row.original,
                      });
                    });
                  },
                },
                "编辑",
              ),
              changed
                ? react.createElement(
                    ActionButton,
                    {
                      key: "r",
                      type: "button",
                      variant: "outline",
                      disabled: props.sectionsBusy,
                      title: "彻底删除这段改写正文；预设本身不会删除",
                      onClick: function (e) {
                        e.stopPropagation();
                        props.requestDelete(row.name);
                      },
                    },
                    "删除",
                  )
                : null,
            ];
        return react.createElement(
          "div",
          {
            key: "act",
            style: EDITOR_FOOTER,
            onClick: function (e) { e.stopPropagation(); },
          },
          [
            options.switchControls || react.createElement("span", { key: "spacer", style: { flex: "1 1 auto" } }),
            react.createElement(
              "div",
              { key: "buttons", style: Object.assign({}, ACTIONS, { width: "auto", marginTop: 0 }) },
              buttons,
            ),
          ],
        );
      }

      function renderSectionCard(row, props) {
        var badge = sectionBadge(row);
        var isOpen = props.openSection === row.name;
        // 显示什么：改写过的显示用户的，否则显示官方原文
        var shown = (row.status === "apply" || row.status === "pending") && row.action === "replace"
          ? row.text
          : row.original;
        var draft = props.sectionDrafts[row.name];
        var editing = typeof draft === "string";
        var changed = row.status === "apply" || row.status === "pending";

        var cardChildren = [
          react.createElement(
            Button,
            {
              key: "head",
              type: "button",
              variant: "ghost",
              size: "md",
              "data-pm-disclosure": "1",
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
                height: "auto",
                padding: "10px 14px",
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
              react.createElement(Tag, { key: "b", tone: badge.tone }, badge.text),
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
              react.createElement("div", { style: NOTICE_ROW }, [
                react.createElement(Tag, { key: "t", tone: "warning" }, "官方已更新"),
                react.createElement("span", { key: "m" }, "你改的版本照旧生效。点「知道了」消掉这条提醒，或点「还原默认」改用官方新版。"),
                react.createElement(
                  ActionButton,
                  {
                    key: "a",
                    type: "button",
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
                { style: NOTICE_ROW },
                [
                  react.createElement(Tag, { key: "t", tone: "danger" }, "段落已失效"),
                  react.createElement("span", { key: "m" }, "官方已经没有这一段了（删掉或改名了）。你的改写不会再生效，数据还留着；要清理就点「还原默认」。"),
                ],
              ),
            ]),
          );
        }

        if (isOpen) {
          var bodyChildren;
          if (editing) {
            // 编辑态只编辑一份草稿：新建改写时以原文为起点，已有改写时编辑改写正文。
            var editLabel = changed && row.action === "replace" ? "改写系统提示词" : "原生系统提示词";
            bodyChildren = [
              react.createElement("div", { key: "text-view" }, [
                react.createElement("span", { key: "label", style: TEXT_VIEW_LABEL }, editLabel),
                react.createElement("textarea", {
                  key: "editor-textarea",
                  style: TEXTAREA,
                  value: draft,
                  disabled: props.sectionsBusy,
                  spellCheck: false,
                  "aria-label": editLabel,
                  onChange: function (e) {
                    var v = e.target.value;
                    props.setSectionDrafts(function (prev) {
                      return Object.assign({}, prev, { [row.name]: v });
                    });
                  },
                }),
              ]),
              renderSectionActions(row, props, {
                editing: true,
                changed: changed,
                hasRewrite: false,
                draft: draft,
              }),
            ];
          } else {
            var textView = props.textViews && props.textViews[row.name] === "native" ? "native" : "rewrite";
            var showNative = textView === "native";
            var hasRewrite = changed && row.action === "replace";
            var switchButton = function (id, label) {
              var selected = showNative === (id === "native");
              return react.createElement(
                Button,
                {
                  key: id,
                  type: "button",
                  variant: "ghost",
                  size: "sm",
                  style: Object.assign({}, TEXT_SWITCH_BUTTON, {
                    color: selected
                      ? "var(--dsw-alias-label-primary, inherit)"
                      : "var(--dsw-alias-label-tertiary, inherit)",
                  }),
                  "aria-label": label + "系统提示词",
                  title: "查看" + label + "系统提示词",
                  "aria-pressed": selected,
                  onClick: function (e) {
                    e.stopPropagation();
                    if (typeof props.setTextView === "function") props.setTextView(row.name, id);
                  },
                },
                react.createElement("span", {
                  style: Object.assign({}, TEXT_SWITCH_BAR, {
                    opacity: selected ? 1 : 0.45,
                    transform: selected ? "scaleX(1)" : "scaleX(0.82)",
                  }),
                }),
              );
            };
            var displayPanel = function (key, label, text) {
              return react.createElement(
                "div",
                { key: key, style: TEXT_SWITCH_PANEL },
                [
                  react.createElement("span", { key: "label", style: TEXT_VIEW_LABEL }, label),
                  react.createElement("textarea", {
                    key: "textarea",
                    style: TEXTAREA,
                    value: text || "",
                    readOnly: true,
                    spellCheck: false,
                    "aria-label": label,
                  }),
                ],
              );
            };
            var displayRail = hasRewrite
              ? react.createElement("div", { key: "text-rail", style: TEXT_SWITCH_TRACK }, [
                  react.createElement("div", {
                    key: "rail",
                    style: Object.assign({}, TEXT_SWITCH_RAIL, {
                      transform: showNative ? "translateX(0)" : "translateX(-50%)",
                    }),
                  }, [
                    displayPanel("native", "原生系统提示词", row.original),
                    displayPanel("rewrite", "改写系统提示词", row.text),
                  ]),
                ])
              : null;
            var switchControls = hasRewrite
              ? react.createElement("div", { key: "text-switch", style: Object.assign({}, TEXT_SWITCH, { margin: 0 }) }, [
                  switchButton("native", "原生"),
                  switchButton("rewrite", "改写"),
                ])
              : null;
            bodyChildren = [
              !hasRewrite
                ? react.createElement("div", { key: "native-view" }, [
                    react.createElement("span", { key: "label", style: TEXT_VIEW_LABEL }, "原生系统提示词"),
                    react.createElement("textarea", {
                      key: "textarea",
                      style: TEXTAREA,
                      value: row.original || "",
                      readOnly: true,
                      spellCheck: false,
                      "aria-label": "原生系统提示词",
                    }),
                ])
                : displayRail,
              renderSectionActions(row, props, {
                editing: false,
                changed: changed,
                hasRewrite: hasRewrite,
                switchControls: switchControls,
              }),
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
                  Tag,
                  { key: "b", tone: "quiet" },
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
        var viewState = react.useState({});
        var textViews = viewState[0];
        var setTextViews = viewState[1];
        var deleteState = react.useState(null);
        var deleteTarget = deleteState[0];
        var setDeleteTarget = deleteState[1];
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
              "管理 dsh 原生系统提示词段落，可改写或还原。\n" +
              "这里是全局默认；单会话请用会话头部的「提示词」按钮。",
            ),
            react.createElement(
              "span",
              { key: "c", style: HEADING_COUNT },
              props.sections && props.sections.counts ? props.sections.summary : "读取中…",
            ),
            react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
            react.createElement(
              ActionButton,
              {
                key: "r",
                type: "button",
                variant: "outline",
                disabled: props.sectionsBusy,
                onClick: function () {
                  props.loadSections();
                },
              },
              "重新读取",
            ),
          ],
        );
        var messageNode = props.message
          ? react.createElement("div", {
              key: "message",
              style: Object.assign({}, HINT_TEXT, NOTICE_ROW, {
                margin: "2px 0 8px",
              }),
            }, [
              react.createElement(
                Tag,
                { key: "t", tone: String(props.message).indexOf("失败：") === 0 ? "danger" : "success" },
                String(props.message).indexOf("失败：") === 0 ? "出错" : "提示",
              ),
              react.createElement("span", { key: "m" }, props.message),
            ])
          : null;

        if (props.sections === null) {
          return react.createElement("div", null, [
            head,
            messageNode,
            react.createElement("div", { key: "l", style: STATUS_LINE }, "读取中…"),
          ]);
        }

        var items = [];
        if (props.sections.outcome === "stored-only") {
          // 保存/还原成功后 message 已经说明了操作结果，不再追加一条重复的
          // “原生段落暂不可读”。首次进入设置页或主动重新读取时才显示会话状态。
          if (!props.message) {
            items.push(
              react.createElement(
                "div",
                { key: "stored-only", style: NOTICE_ROW },
                [
                  react.createElement(Tag, { key: "t", tone: "warning" }, "原生段落暂不可读"),
                  react.createElement("span", { key: "m" }, "当前没有打开的会话。下面仍显示已保存的改写和保存时的原文；打开一个会话后可重新读取原生段落。"),
                ],
              ),
            );
          }
        } else if (props.sections.outcome !== "ok") {
          // 旧版后端在没有存活会话时返回 error；只要响应带有已保存改写，
          // 这仍然是离线可编辑状态，不应再显示成阻断式红色错误。
          var hasStoredRewrite =
            (Array.isArray(props.sections.pending) && props.sections.pending.length > 0) ||
            (props.sections.globalOverrides && Object.keys(props.sections.globalOverrides).length > 0);
          items.push(
            react.createElement(
              "div",
              { key: "err", style: NOTICE_ROW },
              [
                react.createElement(Tag, { key: "t", tone: hasStoredRewrite ? "warning" : "danger" }, hasStoredRewrite ? "原生段落暂不可读" : "读取失败"),
                react.createElement("span", { key: "m" }, hasStoredRewrite
                  ? "当前没有打开的会话。已保存的改写仍可编辑；打开一个会话后可重新读取原生段落。"
                  : (props.sections.error || "读取失败")),
              ],
            ),
          );
        }

        // 改动过的排前面，方便一眼看到自己动过什么
        var ordered = []
          .concat(props.sections.applied || [])
            .concat(props.sections.pending || [])
            .concat(props.sections.stale || [])
          .concat(props.sections.untouched || []);
        var cardProps = Object.assign({}, props, {
          textViews: textViews,
          requestDelete: setDeleteTarget,
          setTextView: function (name, value) {
            setTextViews(function (prev) { return Object.assign({}, prev, { [name]: value }); });
          },
        });
        for (var si = 0; si < ordered.length; si++) items.push(renderSectionCard(ordered[si], cardProps));

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

        if (deleteTarget) {
          items.push(
            react.createElement(
              Modal,
              {
                key: "delete-rewrite-modal",
                open: true,
                title: "删除改写提示词",
                closeLabel: "关闭",
                onClose: function () { setDeleteTarget(null); },
              },
              [
                react.createElement("p", { key: "message", style: { margin: "0 0 14px", lineHeight: "1.6" } },
                  "删除「" + (sectionLabel(deleteTarget) || deleteTarget) + "」的改写正文？相关预设中的改写 tag 会一并清理，预设和原生段落不会删除。"),
                react.createElement("div", { key: "actions", style: ACTIONS }, [
                  react.createElement(ActionButton, {
                    key: "delete",
                    type: "button",
                    variant: "primary",
                    onClick: function () {
                      var name = deleteTarget;
                      setDeleteTarget(null);
                      props.applySection(name, "delete").then(function (deleted) {
                        if (!deleted) return;
                        props.setSectionDrafts(function (prev) {
                          var next = Object.assign({}, prev);
                          delete next[name];
                          return next;
                        });
                      });
                    },
                  }, "删除"),
                  react.createElement(ActionButton, {
                    key: "cancel",
                    type: "button",
                    variant: "outline",
                    onClick: function () { setDeleteTarget(null); },
                  }, "取消"),
                ]),
              ],
            ),
          );
        }
        return react.createElement("div", null, [head, messageNode].concat(items));
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
