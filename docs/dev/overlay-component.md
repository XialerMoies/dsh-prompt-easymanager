# Overlay（浮层外壳）· 备查

这个组件一度独立成 `client.overlay.js`，之后删了 —— 它是**死代码**：
多选面板和预览各自在自己的 `create()` 里带了一份，谁也没用那个 chunk 的导出。
（拆包时按「两边各留一份，只有 17 行」处理，结果宿主白拉了一个没人用的文件。）

留这份原文是为了以后真要共用时直接搬，不用翻 git 历史。

## 为什么浮层必须 portal 到 `document.body`

渲染在会话头部那一行里面的话，`position:fixed` 会被祖先的
`transform` / `overflow` / `contain` 关住而**完全看不见** ——
点击有响应、fetch 也成功，但画面上什么都没有。
一方插件（`dsh-client-ui-attachment`、`dsh-client-ui-chat`）都这么做。

## 原文

```js
      var OVERLAY = {
        position: "fixed",
        inset: "0",
        // 遮罩用 dsh 自己的 mask 变量 —— 深色遮罩在明暗两种主题下都是惯例，
        // 所以这里保留一个 rgba 兜底是安全的（不像浮窗背景必须跟着主题）。
        background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45))",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      };
      var PANEL = {
        // ⚠️ **浮窗背景必须用 dsh 的主题变量，而且兜底值不能写死深色。**
        //
        // 真机上踩过：这里原来写的是 `var(--dsh-surface, #1e1e1e)` ——
        //   · `--dsh-surface` 这个变量**在 dsh 里根本不存在**（全树 0 次出现），
        //     正确的命名空间是 `--dsw-alias-*`（本文件其它地方用的都是它）
        //   · 兜底 `#1e1e1e` 是写死的深色
        // 两个错叠在一起 → 变量永远取不到 → 浮窗**永远是深色**。
        // 用户是在远程访问（本机主题深色、远端浅色）时发现的。
        //
        // 最后一层兜底用 CSS 系统色 `Canvas` —— 它跟着浏览器/系统主题走，
        // 比写死一个颜色安全得多。
        background: "var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2, Canvas))",
        color: "var(--dsw-alias-label-primary, CanvasText)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
        borderRadius: "8px",
        maxWidth: "860px",
        width: "100%",
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 12px 40px rgba(0,0,0,.28)",
        fontFamily: "inherit",
        fontSize: "12px",
      };
      var PANEL_SM = Object.assign({}, PANEL, { maxWidth: "560px" });
      var PANEL_HEAD = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "10px 12px",
        borderBottom: "1px solid rgba(128,128,128,.25)",
      };
      var PANEL_BODY = { padding: "10px 12px", overflow: "auto", flex: "1 1 auto" };
      var PANEL_FOOT = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "10px 12px",
        borderTop: "1px solid rgba(128,128,128,.25)",
        flexWrap: "wrap",
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
```
