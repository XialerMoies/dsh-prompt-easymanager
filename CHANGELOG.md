# 版本记录

倒序。每条写「改了什么」和「为什么」—— 踩过的坑比结论值钱，所以坑都留着。

---

## v0.11.1 — 修 `import failed: [object Promise]`

拆包之后真机上启动就挂：

```
Failed to load plugins
dsh-prompt-manager: import failed: [object Promise]
```

**原因：在 `factory` 里等了 chunk。**

DSH 的 client bundle 是**同步 CJS 工厂**：

```js
window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  factory: (require) => {
    var module = { exports: {} };
    // …
    return module.exports;   // ← 必须直接返回
  },
});
```

为了「label 这类东西第一帧就要用」，在 factory 里写了
`var helpersBox = useChunk(loadHelpers)`。而 `require.async` 在浏览器里返回的是
**真 Promise** —— 在 factory 里等它 = factory 抛出一个 pending Promise，
`module.exports` 永远返回不了，宿主拿到的是「没有导出」，报 `[object Promise]`。

**两处都错，都得改：**

1. **factory 必须同步。** `client.helpers.js` 那 66 行（段落中文名表 +
   `sectionLabel` + `fmtTokens` + 路由常量）搬回宿主的模块级。
   `fmtTokens(p.tokens)` 是当函数调的，做成延迟 getter 也没用 —— 拿不到就是
   `undefined is not a function`。不为省 66 行留一个「factory 不许异步」的隐性约束。

2. **factory 里不许调 hooks。** `useChunk` 内部是 `react.useState`，
   在 factory 里调它就是 `Invalid hook call`。

### 测试为什么没拦住：影子层比真 React 宽松

两处都补上了，都是**通用**检查，不是给这一个 bug 打补丁：

| 补的检查 | 在哪 | 拦什么 |
|---|---|---|
| factory 返回值必须是对象、不能是 thenable | `scripts/lib/client-loader.mjs` 的 `load()` | 「在 factory 里等 chunk」这一类 |
| 渲染之外调 `useState` 直接抛 | `client_render_test.mjs` 的影子层 | 「在 factory 里调 hooks」这一类 |

影子层以前对 `useState` 是照单全收的，所以 `useChunk(loadHelpers)` 在测试里
一路绿灯。现在它跟真 React 一样会抛。

**教训**：影子层每宽松一处，就有一类真机故障在测试里隐形。宽松必须是**故意**的、
写下来的，不能是「顺手就没检查」。

---

## v0.11.0 — 客户端拆包

`client.js` 原来是 **3817 行**的单文件，其中 `PromptEditor` 一个函数就占 **1878 行**（49%）。
拆成宿主 + 3 个包内 chunk：

| 文件 | 行数 | 装什么 |
|---|---:|---|
| `client.js` | 480 | 注册、会话头部那一个按钮、样式常量、纯函数、按需加载 |
| `client.picker.js` | 1129 | 多选面板 + 会话头部入口 |
| `client.preview.js` | 359 | 最终系统提示词预览 |
| `client.editor.js` | 2227 | 设置页那一栏（原来挤在宿主里的那一大块） |

（中途还有过一个 `client.overlay.js` 和一个 `client.helpers.js`，都删了 ——
前者是死代码，后者是上面那个 `[object Promise]` 的根因。）

### 用的是什么机制

DSH 的客户端模块系统支持**包内 chunk**：把文件命名成 `client.<名字>.js`、
注册时带上 `chunk` 字段，宿主就能用 `require.async("./client.xxx.js")` 按需拉。
官方 `dsh-client-ui-sidebar-documentpreview` 的 PDF / Excel 预览就是这么做的
（那两个 chunk 各有 7MB）。

**注册键必须写全**：

```
register() 里：ownerId = id 去掉结尾的 /client  →  "dsh-prompt-manager"
              key     = ownerId + "/" + chunk 字段
importChunk 找的正是： "dsh-prompt-manager/client.picker.js"
```

而 `require.async` 收的是**相对说明符**（`"./client.picker.js"`），不是这个键 ——
一开始把完整注册键传了进去，被 `if (!spec.startsWith("./"))` 当成「别的包」去 import，
chunk 永远拉不起来。

**`dsh.client.external` 帮不上忙**：那里列的名字必须是**别的包**的 boot row，
写本包的文件名会被判成「本包要求自己」，构建期直接抛错。

### 样式常量为什么留在宿主

宿主自己还要渲染会话头部那一个按钮，**注册期**就得有；chunk 是异步到的，等不了。
给 chunk 用的那几个纯函数通过 `CHUNK_API` 显式传过去 —— 同一个东西在几个文件里
各写一份，迟早改一处漏一处。

### 顺手修掉的三个真问题

拆的过程中测试抓出来的。**都不是「拆坏了」，是原来就有毛病、只是没人看得见**：

1. **多选面板里点「预览」会炸。** 面板和预览本来在同一个文件里，靠闭包互相看得见。
   拆开之后面板那一份里 `PreviewPanel` 成了未定义 —— 而且**点了才炸**：
   React 随即卸载整棵子树，看起来就是「点了预览之后控件全没了」。
   现在宿主把面板和预览**一起**拉好，预览随 props 交给面板。

2. **`useChunk` 的缓存键曾经是每次渲染都新建的函数。** 上面第 1 条的同一类问题：
   缓存永远 miss，组件每次都重新等一个 Promise，表现是「那一栏一直是空的」而且不报错。
   现在加载器放在模块级，引用恒定。

3. **`client.overlay.js` 是死代码。** 按「浮层只有 17 行，两边各留一份」处理，
   结果宿主白拉了一个**没有任何人读它导出**的文件。删掉了，
   原文留在 [docs/dev/overlay-component.md](docs/dev/overlay-component.md) 备查。

   顺带发现一个更值钱的：`OVERLAY` / `PANEL` / `PANEL_HEAD` 那一族常量
   其实是被**面板和预览两个 chunk 从 `api.style` 取的** —— 不是各自复制的。
   所以它们必须留在宿主，删 `client.overlay.js` 的时候差点一起删掉。

### 测试也跟着改了

`scripts/lib/client-loader.mjs` 新增一个客户端沙箱：**复刻 DSH 真实的注册规则**
（`ownerId + "/" + chunk`），把 chunk 当脚本读出来执行一遍。
注册键写错的话它就直接报「bundle loaded without registering」——
而不是简单地 `require` 一下文件让测试变成「自己考自己」。

宿主那份 api 也是**抓来的**（`sandbox.lastApi`），不是测试照着复刻的 ——
复刻的话宿主漏传一个样式常量，测试照样全绿。

静态扫描（样式常量是否都有定义、有没有编出来的段落键、主题变量写法）现在扫
**全部 4 个客户端文件**：只扫 `client.js` 的话，那些东西大多搬进了 chunk，断言会
「全绿但什么都没扫到」，比没有还糟。

`client_render_test.mjs` 从 229 条断言涨到 **283 条**。

---

## v0.3.7 — 两个分类的建议 order 跟 dsh 自己的段落撞了

### 问题

`order` 决定段落在最终提示词里插在哪。本插件给分类配了「建议 order」，
选分类时自动带出来。但这两个值是**拍脑袋定的**，没跟 dsh 原生段落对过：

| 分类 | 原来的建议 order |
|---|---:|
| 领域 | 500 |
| 工具 | 3000 |

而 dsh 原生段落的 `order` 是：

```
plan:policy     300
team:policy     400
tools:ptc-only  2900
tools:sdk       2900
```

### 撞了会怎样

| 我们的 | 原生 | 结果 |
|---|---|---|
| 领域 500 | `plan:policy` 300 / `team:policy` 400 | 领域提示词**插在计划策略之后** —— 但它讲的是业务知识，应该在策略之前 |
| 工具 3000 | `tools:ptc-only` 2900 | 正好都在 2900 之后，**这条其实没错** |

第二条是碰巧对的。**碰巧对的东西最危险** —— 官方哪天把 `tools:*` 挪到 3100，它就错了。

### 还有一个说明写错了

界面上那句提示原来是：

> `order 决定插入位置：100 在 persona 之后、工具说明之前；2900 在工具说明之后。`

2900 就是 `tools:ptc-only` **自己的** order。把「别人的 order」当成「分界线」写进说明，
用户照着填 2900，就会**正好和官方段落撞在同一格**，谁在前谁在后取决于稳定排序的实现。

### 改动

| 分类 | 原 | 新 | 为什么 |
|---|---:|---:|---|
| 领域 | 500 | **950** | 落在 `team:policy`(400) 之后、技能段(~1000) 之前 |
| 工具 | 3000 | **3200** | 明确在 `tools:*`(2900) 之后，留 300 的余量 |
| 身份 | 100 | 100 | 本來就对（`deployment:persona-*` 是 10/20） |
| 输出 | 3300 | 3300 | 本來就对 |

界面那句提示改成：

> `100 = persona 之后；950 = 策略之后；3200 = 工具说明之后。`

**报的是分类名，不再是别人的 order 数字。**

### 为什么原来的测试没拦住

`section_order_test.mjs` 当时**只检查插件自己的分类之间有没有冲突**，
从来没拿 dsh 真实段落的 `order` 比对过 —— 而冲突恰恰发生在「我们的」和「官方的」之间。

### 补的测试：`scripts/section_order_test.mjs`（26 条断言）

从 dsh 源码里读出真实的 `SECTION_ORDERS`，逐个跟分类建议 order 比对：

- 任何分类的建议 order **不得等于**任何原生段落的 order
- 「领域」必须 > `team:policy` 且 < 技能段
- 「工具」必须 > `tools:*`

**这是从「自己和自己比」升级成「跟真实数据比」。**

### 这一类错误的共同点

**用一个值去表达「跟别人的相对位置」，却不检查别人现在在哪。**

修法不是把 500 改成 950，是**把检查补上** —— 否则下次还是拍脑袋。

---

## v0.3.6 — 分类改回 `<select>`

原来用 `<input list="…">` + `<datalist>`，想「既能挑又能写」。真机上 `<datalist>`
在部分浏览器/主题下**弹不出来**，等于选不了。改回原生 `<select>`。

---

## v0.3.5 — 修的两处预览细节

### 一、「第 66 轮」看着旧，其实是对的

预览取会话日志里最后一条 `system/message`。有问题的那次取到了**最后一条空事件**，
显示成很旧的轮次。改成取**最后一条有正文的**。

### 二、取日志要取「最后一条**有正文**的」

同上。

### 三、顺手：纯文本 UI 里混进了 markdown 星号

预览正文里原本直接显示 `**粗体**` 的字面量。纯文本环境不做 markdown 渲染，去掉星号。

---

## v0.3.4 — 修的两个「看着像没事、其实在骗人」的问题

### 一、`assemble()` 漏传了 `agent`

预览里**上下文段恒为 0 tokens**。原因是调用 `assemble({ agent })` 时没传 `scope`，
而 `assemble` 是 **scope 分发**的 —— 不带 scope 读，scoped 注册的段落一个都看不见。

正确写法见 `dsh-agent/lib/types/dispatch.js` 的
`assembleContextFor(agent) => { agent, scope: agent }`。

### 二、那行汇总本身也在误导

同一处，汇总把「读不到」显示成「就是 0」。**0 和「没读到」必须能分开。**

---

## v0.3.2 — 修删掉「正在被用」的提示词后留烂摊子

删掉一条正在被会话引用的提示词，会话的分配表里就留下一个**指向不存在 id 的悬挂引用**。
挂载时静默跳过，界面上却显示「已挂载 N 条」。

加了 `pruneMissing()`：装载提示词库后把悬挂引用清掉，并回报清了哪些。

---

## v0.3.1 — 删掉了做不到事的子代理工具

v0.3.0 曾加过 `list_personas` / `get_persona` 两个工具，**v0.3.1 删掉了**。

**原因**：原以为 dsh 的 `subagent` 工具有个 `persona` 参数可以让模型传。**没有。**
模型能传的只有这些：

```
description（必填）、prompt（必填）
provider / model / reasoning_effort、run_in_background
```

`persona` 是**插件级 config**（`dsh-tool-subagent` 的 `Config` 里的一项），
由 `config.persona` 填进内部请求 —— 模型够不着。
所以那两个工具取回正文也**没地方送**，是死路。

**留着比没有更糟** —— 模型会以为能用，然后白折腾一轮。

### 那到底能不能设子代理人格？能，但是全局的

在 profile 的 `cordis.patch.yml` 里配置 `tool-subagent`：

```yaml
- id: tool-subagent
  config:
    persona: |
      # 角色
      你是代码审查员。只读文件，不改不写。
      发现问题分「必须修」「建议」两档，每条附文件路径和行号。
```

| | 效果 |
|---|---|
| 谁决定用不用 | **平台强制加**，不依赖模型选择 |
| 生效范围 | **所有**子代理，不能这次派审查员、下次派研究员 |
| 何时生效 | `cordis.patch.yml` 是 `patchReload: live`，改完即生效 |
| 和本插件的关系 | **没有关系** —— 本插件管不到它，这里只是把方法记下来 |

**顺带说清一件容易混的事**：这个 `persona` 是**顶掉**子代理的 persona 段
（`deployment:persona-prefix`），不是追加。子代理的其余段落（工具说明、harness 身份）照旧。
它要求 provider 支持 `persona` 能力；两个内置 provider
（`dsh-subagent-spawn-in-process` / `dsh-subagent-fork-in-process`）都声明了 `persona: true`。

### 为什么不做成「自己实现一个带 persona 的子代理工具」

那要自己重写 spawn 逻辑、自己管生命周期，等于把 `dsh-tool-subagent` 抄一遍 ——
而它已经有完整的进程内/派生两条路径。**为了一个参数抄一个工具，不值。**

---

## v0.2.3

小的界面与文案调整。

## v0.2.2

- **删掉 `replace`（替换）模式** —— 见下。目录里残留 `replace` 模式会给出迁移提示。
- 「任意组合都合法」：不再有互斥约束。

### ⚠️ `replace`（替换）模式已在 v0.2.2 删除

原来是「用这条提示词**替掉** dsh 的全部原生段落」。
问题：一旦替掉，工具说明、harness 身份这些也一起没了，agent 直接不会用工具。
**这不是一个用户能安全使用的开关**，删掉。

想改某一段，用「段落改写」（v0.4.0 起）—— 它只动你指定的那一段。

## v0.2.1

修文案与状态点颜色。

## v0.2.0

- 每条提示词有自己的 `order`，插到指定位置（原来是固定追加到末尾）
- 分类 + 建议 order
- 会话头部状态点

---

## v0.1.0 — 首次发布

由 `dsh-infinite-gen-4` v0.9.3 改造而来：从「按会话开关一段写死的载荷」
变成「按会话选择任意提示词 + 预览最终结果」。

### ⚠️ 两个曾经「点了没反应」的坑（v0.1.0 修复）

#### 1. HTTP 路由的 `path` 必须是单个字符串，不能传数组

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

#### 2. 浮层必须 portal 到 `document.body`

预览弹窗原本渲染在会话头部那一行**里面**。`position: fixed` 会被祖先的
`transform` / `overflow` / `contain` 关住 —— 点击有响应、fetch 也成功，
但**画面上什么都没出现**。

一方插件（`dsh-client-ui-attachment`、`dsh-client-ui-chat`）统一用
`reactDom.createPortal(..., document.body)`。客户端半体要 `require("react-dom")`。

#### 3. 操作都要有可见反馈

- 选提示词 → 「已挂载，下一步生效」/「已选择，但未挂载（原因）」
- 点预览 → 弹窗；失败时红色提示条
- 点 ↻ → 「已重载 N 条提示词」，有格式问题时显示第一条问题
- 按钮忙碌时 ↻ 变成 `…`，下拉框变半透明
- 提示 4 秒后自动消失
