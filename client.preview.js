// dsh-prompt-easymanager · 最终提示词预览（包内 chunk）
//
// 由 client.js 用 require.async("./client.preview.js") 拉起；必须注册成
// id "dsh-prompt-easymanager" + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。

window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.preview.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    /**
     * 宿主调用入口，把「注册期就存在、chunk 等不到」的东西注入进来。
     *
     * ⚠️ 下面这些名字原先在本文件里是**闭包白拿**的（外层 var 内层直接用），
     *    拆成 chunk 后必须靠 api 显式传，漏传就是渲染期 ReferenceError ——
     *    React 随即卸载整棵子树，表现是「点了之后控件全没了」。
     */
    function create(api) {
      var SEC = api.style.SEC;
      var SEC_OURS = api.style.SEC_OURS;
      var MONO = api.style.MONO;
      var MONO_TAIL = api.style.MONO_TAIL;
      var NOTICE_ROW = api.style.NOTICE_ROW;
      var MUTED = api.style.MUTED;
      var HEADING = api.style.HEADING;
      var SUMSUM = api.style.SUMSUM;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;
      var DisclosureRow = api.ui.DisclosureRow;
      var Tag = api.ui.Tag;
      var IconCodeOutlineRegular = api.ui.IconCodeOutlineRegular;

      // ⚠️ 这里原来有一份**本地兜底**的 SEC（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。
      function Overlay(props) {
        return react.createElement(
          api.ui.Modal,
          { open: true, onClose: props.onClose, title: "最终系统提示词预览", closeLabel: "关闭" },
          props.children,
        );
      }

      // ── 多选面板 ──────────────────────────────────────────────────────────
      /**
   * 「我们的增量」那一行。
   *
   * ⚠️ **两个来源分开报**，因为性质不同：
   *
   *     ① 我们自己加的段落（名字是 `prompt-manager:<id>`，整段都是我们的）
   *     ② 段落改写的净增减（改的通常是**原生**段落，正文变长变短）
   *
   *    合计才是「相对原生装配，本插件多花了多少」。
   *
   * ⚠️ 算不出来时（`overridesDeltaTokens === null`）**不显示那一半** ——
   *    宁可少说，也别给个看着像真的的数字。
   */
  function oursLines(data) {
    var parts = [];
    var added = data.oursSectionsTokens;
    if (typeof added === "number") {
      parts.push("自加段落 " + (data.oursSectionCount || 0) + " 段 = " + fmtTokens(added));
    }
    var delta = data.overridesDeltaTokens;
    var deltaShown = typeof delta === "number";
    if (deltaShown) {
      var n = data.overridesDeltaCount || 0;
      var cleared = data.overridesSectionsCleared || 0;
      parts.push(
        "段落改写 " + n + " 处 = " + (delta >= 0 ? "+" : "") + fmtTokens(delta) +
          (cleared ? "（含关闭 " + cleared + " 段）" : ""),
      );
    }

    // ⚠️ **一个都报不出来时返回空数组，不能返回 null。**
    //
    //    调用处是 `...oursLines(data)`（参数里的展开）——
    //    `...null` 会抛 `TypeError: oursLines is not a function or its
    //    return value is not iterable`。
    //
    //    那个报错信息**极具误导性**：它说 "is not a function"，让人以为是作用域问题，
    //    而实际上函数好好的、只是返回了 null。我为此查了半天作用域。
    //    这条教训值一条注释：**参数里的展开，空值必须是 `[]`，不能是 `null`。**
    if (!parts.length) return [];

    var total = (typeof added === "number" ? added : 0) + (deltaShown ? delta : 0);
    // ⚠️ 返回**数组**（可能 1–2 个 div），调用处用 `rows.push(...oursLines(data))` 展开。
    //    第一版返回单个元素、调用处直接 push —— 那还好；但两个部分都想分行显示时
    //    就得返回数组，别让调用处去判断类型。
    return [
      react.createElement(
        "div",
        { key: "ours-a" },
        "本插件的增量：" + parts.join("　·　") +
          (parts.length > 1 ? "　→　合计 " + (total >= 0 ? "+" : "") + fmtTokens(total) : ""),
      ),
      !data.prompts || !data.prompts.length
        ? react.createElement(
            "div",
            { key: "ours-b" },
            "（本会话没挂任何预设，增量只来自段落改写）",
          )
        : null,
    ].filter(Boolean);
  }

  function PreviewPanel(props) {
        var data = props.data;
        if (!data) return null;

        var rows = [];
        if (data.error) {
          rows.push(react.createElement("div", { key: "err", style: NOTICE_ROW }, [
            react.createElement(Tag, { key: "t", tone: "danger" }, "预览失败"),
            react.createElement("span", { key: "m" }, data.error),
          ]));
          if (data.hint) {
            rows.push(react.createElement("div", { key: "hint", style: MUTED }, "可能原因：" + data.hint));
          }
        } else {
          if (data.conflict) {
            rows.push(
              react.createElement("div", { key: "conflict", style: NOTICE_ROW }, [
                react.createElement(Tag, { key: "t", tone: "danger" }, "冲突"),
                react.createElement("span", { key: "m" }, data.conflict.message),
                data.conflict.hint
                  ? react.createElement("span", { key: "h", style: MUTED }, data.conflict.hint)
                  : null,
              ]),
            );
          }
          // 汇总：分开报 sections / contexts / tools
          rows.push(
            react.createElement("div", { key: "sum", style: SUMSUM }, [
              react.createElement(
                "div",
                { key: "a" },
                react.createElement("strong", null, "模型实际收到 ≈ " + fmtTokens(data.totalTokens)),
              ),
              react.createElement(
                "div",
                { key: "b", style: MUTED },
                "系统提示词 " + (data.sectionCount || 0) + " 段 = " + fmtTokens(data.sectionTokens) +
                  "　·　工具 schema " + (data.toolCount || 0) + " 个 = " + fmtTokens(data.toolTokens) +
                  "　·　运行时上下文 " + (data.contextCount || 0) + " 段 = " + fmtTokens(data.contextTokens),
              ),
              // ── 「我们的增量」────────────────────────────────────────────
              //
              // ⚠️ 上面的 totalTokens 是**原生 + 我们**的合计，看不出「我挂的这东西
              //    到底花了多少」。这块专门回答那个问题，分两个来源报，
              //    因为两者性质不同：
              //
              //      ① 我们**自己加的段落**（整段都是我们加的）
              //      ② 段落**改写**的净增减（改的通常是原生段落）
              //
              //    ⚠️ `overridesDeltaTokens` 是 null 时那一半**不显示** ——
              //       算不出来就别说，别给个看着像真的的数字。
              ...oursLines(data),
              react.createElement(
                "div",
                { key: "cost", style: MUTED },
                // 这两句是 dsh 官方文档里的说法（@deepseek-ai/dsh-system-prompt 的
                // "Token effect" / "KV Cache effect" 两节），不是我们编的：
                //   · 系统提示词是**每轮请求**的固定成本，不是一次性开销
                //   · 前缀不变时 KV cache 才有效；改了段落 = 前缀变了 = 缓存失效
                //
                // ⚠️ 这是**界面文案**，不能写 markdown 星号 ——
                //    它不会变粗体，只会原样显示两个 `*`。有一条守卫盯着这个
                //    （「没有会原样显示的 markdown 星号」），已经抓到过我一次。
                "这些 token 每轮请求都要重算一次（不是一次性开销）。改了哪一段，" +
                  "前缀就变了，那一轮之后模型侧的 KV cache 会失效 —— 下一轮更贵。",
              ),
              react.createElement(
                "div",
                { key: "c", style: MUTED },
                // 说清两件事，免得看着像"少了东西"：
                //   1. 运行时上下文是**独立一条消息**，本来就不在 system/message 里
                //   2. 0 段不代表出错 —— 没有 goal / todo 时那些提供者本来就该是空的
                (data.contextCount || 0) === 0
                  ? "运行时上下文是「单独一条消息」（「Current runtime context…」），不在下面的正文里；" +
                    "当前会话没有，属正常。"
                  : "运行时上下文是「单独一条消息」，不在下面的正文里 —— 所以下面的正文比总数少一块。",
              ),
            ]),
          );

          // 当前挂的是哪几条
          if ((data.prompts || []).length) {
            rows.push(
              react.createElement(
                "div",
                { key: "mine", style: MUTED },
                "本会话挂载：" +
                  data.prompts
                    .map(function (p) {
                      return (p.name || p.id) + "(" + (MODE_LABEL[p.mode] || p.mode) + ",order=" + p.order + ")";
                    })
                    .join(" → ") +
                  (data.source === "default" ? "　［来自全局默认］" : "　［显式指定］"),
              ),
            );
          }

          // 第一优先：会话日志里的 ground truth
          rows.push(
            react.createElement(
              "div",
              { key: "h-logged", style: HEADING },
              data.logged && data.logged.ok
                ? "系统提示词正文（模型上次实际收到的）· " + fmtTokens(data.logged.tokens)
                : "系统提示词正文（模型上次实际收到的）— 读不到",
            ),
          );
          if (data.logged && data.logged.ok) {
            rows.push(
              react.createElement("div", { key: "logged", style: SEC_OURS }, [
                react.createElement(
                  "div",
                  { key: "m", style: MUTED },
                  "第 " + (data.logged.turn == null ? "?" : data.logged.turn) +
                    " 轮 / 第 " + (data.logged.step == null ? "?" : data.logged.step) +
                    " 步 · " + data.logged.chars + " 字符 · 日志共 " +
                    (data.logged.eventCount == null ? "?" : data.logged.eventCount) +
                    " 条事件、其中 " + data.logged.messageCount +
                    " 条 system/message。{{变量}} 已由 dsh 替换完毕。",
                ),
                react.createElement(
                  "div",
                  { key: "why", style: MUTED },
                  // 轮次看着旧是正常的：dsh 只在提示词**变化时**才写这条日志
                  // （dsh-agent-loop project() 里 `if (latest.text === rendered) return []`）。
                  // 没说清的话，用户会以为这份是过期的。
                  "轮次看着旧是正常的 —— dsh 只在提示词「发生变化时」才写这条日志。" +
                    "没变就说明当前生效的就是这一份。",
                ),
                react.createElement(
                  "div",
                  { key: "n", style: MUTED },
                  "⚠ 这份只含文字段落，不含下面的工具定义 —— 工具走的是模型 API 自己的 " +
                    "tools 参数，不写进 system/message。",
                ),
                react.createElement("pre", { key: "t", style: MONO_TAIL }, data.logged.text),
              ]),
            );
          } else {
            var reasons = [
              react.createElement(
                "div",
                { key: "r0" },
                react.createElement("strong", null, "原因："),
                (data.logged && data.logged.reason) || "未知（宿主没有返回 logged 字段）",
              ),
            ];
            if (data.logged && data.logged.eventTypes) {
              reasons.push(
                react.createElement(
                  "div",
                  { key: "r1", style: MUTED },
                  "日志里真实出现的事件类型：" +
                    data.logged.eventTypes
                      .map(function (p) {
                        return p[0] + "×" + p[1];
                      })
                      .join("、"),
                ),
              );
            }
            if (data.logged && data.logged.availableMethods) {
              reasons.push(
                react.createElement(
                  "div",
                  { key: "r2", style: MUTED },
                  "session 上可用的方法：" + (data.logged.availableMethods.join("、") || "（一个都没取到）"),
                ),
              );
            }
            rows.push(react.createElement("div", { key: "logged-none", style: NOTICE_ROW }, [
              react.createElement(Tag, { key: "t", tone: "warning" }, "提示"),
              react.createElement("div", { key: "m" }, reasons),
            ]));
          }

          // 逐段
          rows.push(
            react.createElement(
              "div",
              { key: "h-sections", style: HEADING },
              "Sections（未插值原文）· " + fmtTokens(data.sectionTokens),
            ),
          );
          (data.sections || []).forEach(function (s, i) {
            if (!s || typeof s !== "object") return;
            var ours = (data.prompts || []).some(function (p) {
              return "prompt-manager:" + p.id === s.name;
            });
            rows.push(
              react.createElement("div", { key: "s" + i, style: ours ? SEC_OURS : SEC }, [
                react.createElement("div", { key: "h" }, [
                  react.createElement("strong", { key: "n" }, s.name),
                  s.complete
                    ? react.createElement("span", { key: "c", style: MUTED }, "  [complete 覆盖]")
                    : null,
                  react.createElement(
                    "span",
                    { key: "t", style: MUTED },
                    "  " + fmtTokens(s.tokens) + " · " + s.chars + " 字符" + (ours ? "  ← 本插件" : ""),
                  ),
                ]),
                s.text
                  ? react.createElement("pre", { key: "p", style: MONO }, s.text + (s.truncated ? "\n…（已截断）" : ""))
                  : null,
              ]),
            );
          });

          // 上下文段
          if ((data.contexts || []).length) {
            rows.push(
              react.createElement(
                "div",
                { key: "h-ctx", style: HEADING },
                "上下文段（runtime context）· " + fmtTokens(data.contextTokens),
              ),
            );
            (data.contexts || []).forEach(function (c, i) {
              if (!c || typeof c !== "object") return;
              rows.push(
                react.createElement("div", { key: "c" + i, style: SEC }, [
                  react.createElement("div", { key: "h" }, [
                    react.createElement("strong", { key: "n" }, c.name),
                    react.createElement("span", { key: "t", style: MUTED }, "  " + fmtTokens(c.tokens) + " · " + c.chars + " 字符"),
                  ]),
                  c.text
                    ? react.createElement("pre", { key: "p", style: MONO }, c.text + (c.truncated ? "\n…（已截断）" : ""))
                    : null,
                ]),
              );
            });
          }

          // 工具 schema：默认收起，避免工具定义把正文推到弹窗中间；展开后显示完整描述和参数。
          if ((data.tools || []).length) {
            rows.push(
              react.createElement(
                "div",
                { key: "h-tools", style: HEADING },
                "工具 schema · " + data.tools.length + " 个 · " + fmtTokens(data.toolTokens) +
                  "（按 名字+描述+参数 JSON 估算）",
              ),
            );
            (data.tools || []).forEach(function (t, i) {
              if (!t || typeof t !== "object") return;
              rows.push(react.createElement(ToolDisclosure, { key: "t" + i, tool: t, index: i }));
            });
          }
        }

        return react.createElement(
          Overlay,
          { onClose: props.onClose },
          react.createElement("div", { style: { maxHeight: "calc(100vh - 140px)", overflowY: "auto" } }, rows),
        );
      }

      function ToolDisclosure(props) {
        var state = react.useState(false);
        var open = state[0];
        var setOpen = state[1];
        var t = props.tool || {};
        var parameters = "";
        try {
          parameters = JSON.stringify(t.parameters || {}, null, 2);
        } catch (err) {
          parameters = "{}";
        }
        var detail = [
          t.description
            ? react.createElement("div", { key: "d", style: MUTED }, t.description)
            : react.createElement("div", { key: "d", style: MUTED }, "无工具描述"),
          react.createElement("pre", { key: "p", style: MONO }, parameters),
        ];
        return react.createElement(DisclosureRow, {
          icon: react.createElement(IconCodeOutlineRegular, { size: 14 }),
          title:
            props.index + 1 + ". " + (t.name || "(未命名)") +
            "  " + fmtTokens(t.tokens) + " · " + t.chars + " 字符" +
            (t.deferLoading ? " · deferLoading" : ""),
          open: open,
          expandable: true,
          onToggle: function () { setOpen(function (value) { return !value; }); },
          expandOnRowClick: true,
          collapsedContent: react.createElement("span", { style: MUTED }, "展开查看描述和参数"),
          children: react.createElement("div", { style: SEC }, detail),
        });
      }

      // ── 会话头部的入口 ────────────────────────────────────────────────────

      return {
        PreviewPanel: PreviewPanel,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
