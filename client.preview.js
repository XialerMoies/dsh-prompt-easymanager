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
    var reactDom = require("react-dom");

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
      var WARN = api.style.WARN;
      var ADVISE = api.style.ADVISE;
      var MUTED = api.style.MUTED;
      var HEADING = api.style.HEADING;
      var SUMSUM = api.style.SUMSUM;
      var OVERLAY = api.style.OVERLAY;
      var PANEL_SM = api.style.PANEL_SM;
      var PANEL = api.style.PANEL;
      var PANEL_HEAD = api.style.PANEL_HEAD;
      var BTN = api.style.BTN;
      var PANEL_BODY = api.style.PANEL_BODY;
      var MODE_LABEL = api.mode;
      var fmtTokens = api.tokens;

      // ⚠️ 这里原来有一份**本地兜底**的 SEC（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。
      // ⚠️ 这里原来有一份**本地兜底**的 ADVISE（同一作用域重复 var，后声明者赢）——
      //    它会**悄悄覆盖**上面从 api 取的那份，让 strictApi 守卫失效。已删。
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
      function PreviewPanel(props) {
        var data = props.data;
        if (!data) return null;

        var rows = [];
        if (data.error) {
          rows.push(react.createElement("div", { key: "err", style: WARN }, "预览失败：" + data.error));
          if (data.hint) {
            rows.push(react.createElement("div", { key: "hint", style: MUTED }, "可能原因：" + data.hint));
          }
        } else {
          if (data.conflict) {
            rows.push(
              react.createElement("div", { key: "conflict", style: WARN }, [
                react.createElement("strong", { key: "t" }, "⚠ 冲突："),
                data.conflict.message,
                react.createElement("div", { key: "h", style: MUTED }, data.conflict.hint || ""),
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
            rows.push(react.createElement("div", { key: "logged-none", style: ADVISE }, reasons));
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

          // 工具 schema
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
              rows.push(
                react.createElement("div", { key: "t" + i, style: SEC }, [
                  react.createElement("span", { key: "i", style: MUTED }, i + 1 + ". "),
                  react.createElement("strong", { key: "n" }, t.name),
                  react.createElement(
                    "span",
                    { key: "t", style: MUTED },
                    "  " + fmtTokens(t.tokens) + " · " + t.chars + " 字符" + (t.deferLoading ? " · deferLoading" : ""),
                  ),
                ]),
              );
            });
          }
        }

        return react.createElement(
          Overlay,
          { onClose: props.onClose },
          react.createElement(
            "div",
            { style: PANEL_HEAD },
            react.createElement("strong", null, "最终系统提示词预览"),
            react.createElement("button", { type: "button", style: BTN, onClick: props.onClose }, "关闭"),
          ),
          react.createElement("div", { style: PANEL_BODY }, rows),
        );
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
