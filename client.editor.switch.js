// dsh-prompt-manager · 总开关 + 「?」图标（包内 chunk）
//
// 由 client.editor.js 用 require.async("./client.editor.switch.js") 拉起；
// 必须注册成 id "dsh-prompt-manager" + chunk 文件名，否则宿主报
// 「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走，
//    浏览器会拿旧 rev 请求，文件对不上就是 404，表现为设置页整片空白。
//    改了 chunk 之后跑 `npm run bump:rev` 把 client.js 顶新。
//
// 为什么这两样在一起：
//   · 总开关自己是一块，控件和样式函数（switchStyle / thumbStyle + 两个回退常量）
//     只有它用；
//   · renderHelpIcon 是**零依赖**的纯函数，而总开关、提示词组合、系统提示词
//     三处都要用它 —— 跟开关一起搬出来，由宿主把它交回给编辑器那一份用。

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  chunk: "client.editor.switch.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    /**
     * 宿主调用入口。
     *
     * ⚠️ 组件用到的样式常量一律从 `api.style` 取，别在本文件里另写一份 ——
     *    同一个东西在几个文件里各写一份，迟早改一处漏一处
     *    （这个仓库已经踩过多次：SECTION 的 gap、NAV_TITLE、CARDS_GRID）。
     */
    function create(api) {
      var CARD = api.style.CARD;
      var HEADING_COUNT = api.style.HEADING_COUNT;

      // ── 切出来的两段（原样搬过来，只把 MasterSwitch 改成收 props）────────
          /**
           * 总开关（胶囊）—— **用 dsh 自己的开关**。
           *
           * ⚠️ 这是「一键回到原生」的出口：关掉 = 不注入自设提示词、不改写原生段落，
           *    等价于原生 dsh。但**配置全留着** —— 拨回来就原样恢复，所以装配时清空的
           *    是自己注入的段落，不是配置。
           *
           * ── 为什么用原生类名，而不是自己写内联样式 ──────────────────────────
           *
           * dsh 的开关是一段编译过的 CSS module（`_switch_15ung_5` / `_thumb_15ung_33`），
           * 它在**全局样式表**里（web-frontend/dist/assets/index-*.css，由 index.html
           * 直接引入），不是某个包的私有注入 —— 所以插件能直接借。
           *
           * 借它的好处是自动跟着主题走：
           *     background:var(--dsw-alias-border-l3) / [aria-checked=true]→var(--dsw-alias-brand-primary)
           *     thumb 用 transform:translate(16px)，transition .12s
           *     自带 :disabled（opacity .5）和 :focus-visible 焦点环
           *
           * ⚠️⚠️ **凡是原生 css 已经管了的属性，内联里一个都不能写。**
           *    踩过两次：
           *      1) 内联 `background:"#fff"` 把 thumb 的主题令牌顶掉了 ——
           *         深色模式下滑块本该是**深色**（开启态的 brand-primary 在深色下偏亮，
           *         滑块要反过来才看得清），结果一直是白的。
           *      2) 内联 `transform` 覆盖了 `[aria-checked=true] .thumb{translate(16px)}`
           *         —— 值恰好一样所以没露馅，但原生那条规则已经失效了。
           *    内联样式**永远赢** class，所以只留「原生不管」的兜底几何。
           *
           * 那个哈希是**内容派生**的，dsh 升级改了开关的 css 就会变。所以兜底留下的
           * 是「形状」而不是「配色」：类名一旦失效，至少还是个圆角胶囊、不会退回方按钮；
           * 颜色交给原生 —— 宁可失效时朴素，也不要**在好的时候是错的**。
           */
          var NATIVE_SWITCH = "_switch_15ung_5";
          var NATIVE_THUMB = "_thumb_15ung_33";
          // 只兜形状和布局：原生 css 失效时才起作用，生效时被 class 覆盖（值相同）
          var SWITCH_FALLBACK = {
            position: "relative",
            display: "inline-block",
            flex: "0 0 auto",
            boxSizing: "border-box",
            width: "36px",
            height: "20px",
            padding: "2px",
            border: "0",
            borderRadius: "999px",
            cursor: "pointer",
          };
          // ⚠️ 这里**没有** background、**没有** transform —— 见上面那段。
          var THUMB_FALLBACK = {
            display: "block",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
          };
          /**
           * 开关本体：形状兜底 + 仅当原生类名失效时才需要的一点颜色。
           *
           * background 用**原生同一套令牌**，这样即使写到内联也还是跟着主题走；
           * 原生类名生效时它和 class 里的值一致，不会打架。
           */
          function switchStyle(on) {
            return Object.assign({}, SWITCH_FALLBACK, {
              background: on
                ? "var(--dsw-alias-brand-primary)"
                : "var(--dsw-alias-border-l3)",
            });
          }
          /**
           * 滑块：**只有形状兜底，没有颜色、没有 transform**。
           *
           * 背景交给原生的 `var(--dsw-alias-label-primary-foreground)` ——
           * 那个令牌在浅色下是白、深色下是**深色**（开启态的 brand-primary 在深色下
           * 偏亮，滑块得反过来）。写死白色就是深色模式下看起来不对的原因。
           * 位移交给原生的 `[aria-checked=true] .thumb{transform:translate(16px)}`。
           */
          function thumbStyle() {
            return THUMB_FALLBACK;
          }
  
          /**
           * 提示词全局注入开关。
           *
           * ⚠️ 语义（用户定的）：**它管的是「默认」那一层。**
           *    开启 → 每个新会话都自动挂「新会话默认」里那几条。
           *    关闭 → 不再往每个会话都塞默认；但**会话页自己选的照旧注入**，
           *          段落改写也照旧生效（改原生段落跟注不注入是两件事）。
           *
           *    名字和说明都得照这个说 —— 写成「全部停用」就过头了，
           *    写「使用我的提示词配置」又太含糊（听起来像另有个配置开关）。
           *
           * 说明收进 title（不占常驻行）：这段是「怎么回事」，不是「现在什么状态」。
           */
          function MasterSwitch(props) {
            var on = props.enabled !== false;
            var busy = props.busy === true;
            var help =
              "提示词注入的总开关，管的是「默认」那一层。\n\n" +
              "开启：每个新会话都自动挂「新会话默认」里那几条。\n" +
              "关闭：不再往每个会话都塞默认 —— 但你在会话页自己选过的提示词照旧注入，" +
              "段落改写也照旧生效。\n\n" +
              "你的配置都留着，开回来就恢复。";
            return react.createElement(
              "div",
              { style: Object.assign({}, CARD, { padding: "12px 14px", marginBottom: "12px" }) },
              [
                react.createElement("div", { key: "row", style: { display: "flex", alignItems: "center", gap: "10px" } }, [
                  // 结构照抄原生：button[role=switch][aria-checked] + span(thumb)。
                  // 视觉状态由 aria-checked 驱动，所以别再往里塞自己的 display 样式。
                  react.createElement(
                    "button",
                    {
                      key: "sw",
                      type: "button",
                      role: "switch",
                      "aria-checked": on,
                      "aria-label": "提示词全局注入",
                      className: NATIVE_SWITCH,
                      title: help,
                      disabled: busy,
                      onClick: function () {
                        props.onToggle(!on);
                      },
                      style: switchStyle(on),
                    },
                    react.createElement("span", { className: NATIVE_THUMB, style: thumbStyle() }),
                  ),
                  react.createElement(
                    "span",
                    { key: "t", style: { fontSize: "13px", fontWeight: 600 } },
                    "提示词全局注入",
                  ),
                  renderHelpIcon(help),
                  react.createElement(
                    "span",
                    { key: "st", style: HEADING_COUNT },
                    // 「开 · 所有会话都注入」—— 说的是**默认这一层的作用范围**，
                    // 不是「禁止/允许注入」。措辞别写成全停。
                    on ? "开 · 新会话自动挂默认" : "关 · 只在会话页自己选的还注入",
                  ),
                ]),
              ],
            );
          }

          /**
           * 一个「?」图标，说明挂在 title 上（悬停出原生提示，也能点、能聚焦）。
           *
           * 为什么不用一小段灰字：
           *   这两段说明（段落是干什么的 + 改的是哪一层）以前是两行常驻灰字，
           *   压在标题下面，每一眼都要读一遍。挪进 title 之后，需要的时候才有。
           *
           * ⚠️ 用 `title` 而不是自己写弹层：原生提示不用管点击外部关闭、
           *    不用管层级（z-index）、不用管 Esc，也不会被设置页的滚动容器裁掉。
           *    dsh 自己的图标提示也是这么给的。
           */
          function renderHelpIcon(text) {
            return react.createElement(
              "span",
              {
                key: "help",
                title: text,
                "aria-label": text,
                tabIndex: 0,
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                  width: "14px",
                  height: "14px",
                  color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))",
                  cursor: "help",
                },
              },
              react.createElement(
                "svg",
                { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true" },
                react.createElement("circle", {
                  cx: "8",
                  cy: "8",
                  r: "6.6",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: "1.3",
                }),
                react.createElement(
                  "text",
                  {
                    x: "8",
                    y: "11.4",
                    textAnchor: "middle",
                    fontSize: "9",
                    fontWeight: "700",
                    fill: "currentColor",
                  },
                  "?",
                ),
              ),
            );
          }

      /** 这一块没有 CSS module，只有内联样式；保留成接口形状，宿主会调。 */
      function installStyles() {}

      return {
        MasterSwitch: MasterSwitch,
        helpIcon: renderHelpIcon,
        installStyles: installStyles,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
