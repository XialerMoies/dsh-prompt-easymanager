# 实现笔记（踩过的坑）

写这个插件时和 dsh 内部实现搏斗的记录。**改代码之前值得先看这里** ——
下面每一条都是真机上错过的，不是理论。

---

## 注册与卸载

**必须用 `agent.ctx.inject(["systemPrompt"], cb)`** —— scoped ctx 不把宿主服务当普通
属性暴露，要先 inject 才保证可用。权威范例：`dsh-file-reference-local/lib/index.js:339-347`。

**卸载器要抓两个来源**：`section()` 的返回值（卸载这一节的函数）**和**
`ctx.inject()` 的返回值（可能是 fiber 对象，有 `.dispose()`；也可能是函数）。

回调必须**返回** `section()` 的结果 —— 写成块体 `{ section(...) }` 会返回 `undefined`，
卸载器退化成空函数、旧 section 永远留着，换提示词时就会**两段共存**。

---

## 子代理过滤

**不要用 `delegationDepth !== undefined`。** 顶层会话的 `delegationDepth` **就是 0**，
字段确实存在 —— 那样写会把每个顶层会话都当子代理拒掉。

只在 `origin === 'subagent'` 或 `delegationDepth > 0` 时拒绝。

**也不要用 `parentSession` 过滤** —— 那是 fork 的 seed lineage。

---

## 预览的 scope

`assemble({ scope: agent })` —— **scope 必须传 agent**。
见 `dsh-agent/lib/types/dispatch.js` 的 `assembleContextFor(agent) => { agent, scope: agent }`。

不传 scope 时 `assemble()` **跳过所有 scoped 注册**，预览里 scoped 段落全是
「0 tokens」，看起来像「本来就没有」—— 而它其实是「没读到」。**两者必须能分开。**

---

## 不要对同一个 ctx 重复 apply

路由会重复注册而抛错：

```
dsh-client-connection: if (this.fetchRoutes.has(route.path)) throw
```

**单实例假设**：`hostCtxRef` / `activeInjector` / `activeLibrary` 是模块级变量，
后一次 `apply()` 会覆盖前一次。dsh 里插件只加载一次，不影响使用。

---

## HTTP 路由的 `path` 必须是单个字符串，不能传数组

曾经写 `connection.fetch.register({ path: [A, B, C, D], ... })`，
结果**四条路由全部失效** —— 界面上所有按钮点了都没有任何反应。

原因：`dsh-client-connection` 把路由存在 `Map` 里，按 `url.pathname` **精确匹配**：

```
lib/index.js:611  const route = this.fetchRoutes.get(url.pathname);
lib/index.js:634  this.fetchRoutes.set(route.path, registered);
```

键写成数组，`get(pathname)` 就永远取不到，请求落到服务器的默认处理（404）。
类型也写明了：`dsh-host-webserver/lib/types/index.d.ts:36` → `path: string`。
所有一方插件（`/api/file`、file-upload、deliverables）传的都是单个字符串。

**正确做法**：

```js
[A, B, C, D].map((p) =>
  connection.fetch.register({ path: p, methods: [...], requestBody: "buffered", fetch: handler })
)
```

四条路径共用一个 handler，内部按 pathname 分发。测试里有专门的防回归断言
盯住「每个 path 都是字符串」。

---

## 浮层必须 portal 到 `document.body`

预览弹窗原本渲染在会话头部那一行**里面**。`position: fixed` 会被祖先的
`transform` / `overflow` / `contain` 关住 —— 点击有响应、fetch 也成功，
但**画面上什么都没出现**。

一方插件（`dsh-client-ui-attachment`、`dsh-client-ui-chat`）统一用
`reactDom.createPortal(..., document.body)`。客户端半体要 `require("react-dom")`。

组件原文备查：[overlay-component.md](overlay-component.md)。

---

## 客户端 bundle 是同步 CJS 工厂

```js
window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  factory: (require) => {
    var module = { exports: {} };
    // …
    return module.exports;   // ← 必须直接返回，不能 await、不能 throw Promise
  },
});
```

**在 factory 里等任何东西 = 抛出一个 pending Promise**，`module.exports` 永远返回不了，
宿主的界面报：

```
dsh-prompt-easymanager: import failed: [object Promise]
```

同理，**factory 里不许调 hooks**（`useState` 在渲染之外会抛 `Invalid hook call`）。

需要给 chunk 的东西要么同步定义在模块级，要么放进 `CHUNK_API` 显式传下去。

---

## 包内 chunk 的三条规矩

1. **注册键**是 `<包名>/<chunk 文件名>`，由 `importChunk` 自己拼
   （`ownerId` = 本包 id 去掉结尾的 `/client`）。
   而 **`require.async` 收的是相对说明符** `"./client.x.js"`，两回事。

2. **`dsh.client.external` 帮不上忙** —— 那里列的名字必须是**别的包**的 boot row，
   写本包的文件名会被判成「本包要求自己」，构建期直接抛错。

3. **chunk 的 `rev` 跟着 `client.js` 的 mtime 走。** 只改 chunk 不重启 dsh，
   浏览器会拿旧 rev 请求，文件对不上就是 404，表现是**设置页整片空白**。

---

## 删掉「正在被用」的提示词之后要收尾

**症状**（删掉一条被默认或某会话引用的提示词之后）：

1. **所有新会话静默地什么都挂不上** —— 默认里留着已删条目的 id
2. 已有会话的状态显示 `attached: true` 是**假的** —— 读的是上一次的结论
3. 那条已删提示词的旧正文**永远卡在会话里卸不掉** ——
   `assign()` 遇到未知 id 会**提前 return，不走 detach**

**根因**是把「未知 id」一律当成**用户输错了**，整组拒绝。对用户手选那是对的；
但**库里少了一条**时，拒绝等于把烂摊子留在原地。

**修法**：`injector.pruneMissing()` —— **库是唯一真相**：

```js
library.reload();
const pruned = injector.pruneMissing();   // 剔掉幽灵 id，并重挂受影响的会话
```

| 情形 | 处理 |
|---|---|
| `["keep", "victim"]` 里 victim 没了 | → `["keep"]`，**保留还成立的部分** |
| `["victim"]` 里唯一的没了 | → `[]`，即「显式不注入」（**不回落默认**） |
| 默认里混进了幽灵 | → 剔掉，新会话恢复正常 |
| 完全没引用到它的会话 | → **不碰** |

路由的响应里带 `pruned` 字段，说明这次清理动了什么。

---

## 部署：`file:` 依赖会被 pnpm 拷贝

profile 设了 `nodeLinker: hoisted` 时，**再跑一次 `pnpm install` 会把
`node_modules/dsh-prompt-easymanager` 从 junction 换成实体拷贝** —— 之后改源码不生效。
（不会丢改动，pnpm 是从源码目录拷的。）重建 junction 的命令在 README 的「安装」。
