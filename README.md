# 提示词管理 · dsh-prompt-manager

> 为 DeepSeek Harness 的**每个会话**挂载若干条系统提示词，在设置页里编辑提示词库、设定全局默认，
> 并直接看到**模型实际收到的**最终结果。

---

## v0.11.0：客户端拆包

`client.js` 原来是 **3817 行**的单文件，其中 `PromptEditor` 一个函数就占 **1878 行**（49%）。
现在拆成宿主 + 4 个包内 chunk：

| 文件 | 行数 | 装什么 |
|---|---:|---|
| `client.js` | 434 | 注册、会话头部那一个按钮、样式常量、按需加载 |
| `client.helpers.js` | 112 | 原生段落中文名 + `fmtTokens`（纯函数，无 React） |
| `client.picker.js` | 1133 | 多选面板 + 会话头部入口 |
| `client.preview.js` | 363 | 最终系统提示词预览 |
| `client.editor.js` | 2239 | 设置页那一栏（原来挤在宿主里的那一大块） |

（中途还有一个 `client.overlay.js`，后来删了 —— 见下面「顺手修掉的两个真 bug」第 3 条。）

### 用的是什么机制

DSH 的客户端模块系统支持**包内 chunk**：把文件命名成 `client.<名字>.js`、
注册时带上 `chunk` 字段，宿主就能用 `require.async("./client.xxx.js")` 按需拉。
官方 `dsh-client-ui-sidebar-documentpreview` 的 PDF / Excel 预览就是这么做的
（那两个 chunk 各有 7MB）。

**注册键必须写全**，这是踩过的坑：

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

3. **`client.overlay.js` 是死代码。** 拆的时候按「浮层只有 17 行，两边各留一份」
   处理，结果宿主白拉了一个**没有任何人读它导出**的文件。
   删掉了；那份 `Overlay` 的原文留在 `docs/overlay-component.md` 备查。

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

宿主的静态扫描（样式常量是否都有定义、有没有编出来的段落键、主题变量写法）现在扫
**全部 5 个文件**：只扫 `client.js` 的话，那些东西大多搬进了 chunk，断言会
「全绿但什么都没扫到」，比没有还糟。

`client_render_test.mjs` 从 229 条断言涨到 **282 条**；全仓 **1085 条，全过**。

---

## v0.3.7：两个分类的建议 order 跟 dsh 自己的段落撞了

### 问题

五个分类各有一个「建议插入位置」（order），新建提示词时会带出这个数。**其中两个正好等于 dsh 原生段落的 order：**

| 分类 | 原来的 order | 撞上了谁 |
|---|---|---|
| 领域 | **500** | `PLAN_POLICY`（计划策略） |
| 工具 | **3000** | `TOOL_COMPUTER_USE`（电脑操作工具） |

### 撞了会怎样

dsh 的排序规则是：

```js
comparePromptSections(a, b) = a.order - b.order || compareNames(a.name, b.name)
```

**order 相同时，按 section 名字的字典序排。** 所以同名次的两段谁在前，看的是**提示词自己的名字**：

```
id 叫 abc-规则  →  a < p  →  排到 plan:policy 前面
id 叫 zzz-规则  →  z > p  →  排到后面
```

**同一个分类、同一个 order，位置随名字变** —— 这不是设计意图，是巧合。

### 还有一个说明写错了

`工具` 那一类的提示语写的是「插在**所有**工具说明之后」，但：

- 3000 跟最后一个工具说明（`TOOL_COMPUTER_USE=3000`）**并列**，不是「之后」
- 后面还有 `MCP_SERVERS(3100)` 没算进去

### 改动

| 分类 | 旧 | 新 | 落点 |
|---|---|---|---|
| 身份 | 20 | **20** | 不变（`persona-prefix(0)` 与 `PLAN_POLICY(500)` 之间的空档） |
| 领域 | 500 | **950** | `FILE_REFERENCE(900)` 与 `TOOL_BASH(1000)` 之间 |
| 工具 | 3000 | **3200** | `MCP_SERVERS(3100)` 与 `TOOLS_SDK(5000)` 之间 |
| 输出 | 9500 | **9500** | 不变（`DELIVERABLE(9000)` 与 `STRUCTURED_OUTPUT(9900)` 之间） |
| 其他 | 100 | **100** | 不变 |

950 反而更贴「领域」自己的说明（"工具说明之前"），3200 才真的叫"所有工具说明**和 MCP** 之后"。

> **建议 order 只在新建提示词时带出，已存在的条目不受影响。** 你现有那几条都是"输出"类、用的 9500。

### 为什么原来的测试没拦住

`prompt_library_test.mjs` 里写的断言是：

```js
eq(suggestedOrder("domain"), 500, "领域在 file-reference(900) 之前");
eq(suggestedOrder("tool"), 3000, "工具在 TOOL_REPORT(2900) 之后、MCP_SERVERS(3100) 之前");
```

**这些话都没说错** —— `500 ∈ (0, 900)` 成立，`3000 ∈ (2900, 3100)` 也成立。
**但它们断言的是"落在区间里"，没问一句"那这个数是不是正好等于别人"。**

### 补的测试：`scripts/section_order_test.mjs`（26 条断言）

1. **五个建议 order 一个都不许等于任何原生段落的 order** ← 核心
2. 每个建议 order 落在**预期的两个原生段之间**（不是随便哪个区间）
3. `hint` 不许撒谎（"工具说明之后"就必须真的 > `MCP_SERVERS`）
4. 附带一段**可执行的证据**：复现 dsh 的排序规则，演示同一 order 换个名字就换位置

而且**原生表是从 dsh 源码实时读的**（`dsh-system-prompt/lib/index.js`）：

- 读到了 → 跟快照逐项比对，**dsh 升级改了表就当场红**，提示去看它改了什么
- 读不到 → 只用快照（抄自 dsh 0.1.7-rc.2），并打印一行提示

想指定路径：`DSH_SYSTEM_PROMPT_PATH=<...>/dsh-system-prompt/lib/index.js`

### 这一类错误的共同点

**「检查了自己写的对不对，没拿去跟真实系统碰一碰」。**

功能测试能验逻辑，但验不到「我的设计跟宿主实际结构冲不冲突」—— 那种只能靠**把宿主的真实数据抄进测试里比对**。


---

## v0.3.6：分类改回 `<select>`

**用户反馈**：编辑提示词时，「分类」那里**下拉弹不出来、选不了**。

原来用的是：

```jsx
<input list="pm-category-list" … />
<datalist id="pm-category-list">
  <option value="identity">身份</option>
  …
</datalist>
```

想的是"既能从建议里挑、又能自己写"。但 `<datalist>` 是**原生控件**，
弹出与否受浏览器和样式环境影响，**我在这边看不到也调不动** —— 所以不猜了，换掉。

现在是：

```
分类 [ 工具（tool）      ▾ ]  order [ 3000 ]
      ├ 身份（identity）
      ├ 领域（domain）
      ├ 工具（tool）          ← 五个内置类，带上 id 好认
      ├ 输出（output）
      ├ 其他（other）
      ├ 安全审查（自定义）      ← 目录里已用过的自定义分类
      └ ＋ 自定义…            ← 选它才出现自由输入框
```

- **内置 / 已知自定义**：只显示下拉框
- **选了「＋ 自定义…」或当前值是没见过的名字**：下拉框旁边多一个自由输入框
- **改分类仍然带出该类别的建议 order**；自定义分类没有建议值，**不动**你已填的 order

---

## v0.3.5 修的两处预览细节

### 一、「第 66 轮」看着旧，其实是对的

`system/message` **只在提示词变化时才写**：

```js
// dsh-agent-loop/lib/index.js:264 project()
if (latest.text === rendered) return [];     // ← 内容没变就不写
```

实测：一个会话 66 轮、10476 条事件，`system/message` **只有 12 条**，
而且多次读数之间事件涨了几百条、这 12 条纹丝不动（提示词没变）。

**所以日志里的轮次旧 ≠ 内容过期。** 界面现在会说明这一点，免得每次看都犯嘀咕。

### 二、取日志要取「最后一条**有正文**的」

`project()` 有个分支会先把多余节点 `replace` 成空串、再更新 head：

```js
const updates = nodes.slice(1).filter((n) => n.text !== "").map((n) => this.replace(n.seq, ""));
if (head.text !== rendered) updates.push(this.replace(head.seq, rendered));
return updates;
```

head 已经正确、只是要清掉多余节点时，**最后追加的那条是空文本**。
只取最后一条会误报「取不到文本」。现在倒着找第一条有正文的，
并额外回报 `isLatestEvent` 说明它是不是时间上的最后一条。

### 三、顺手：纯文本 UI 里混进了 markdown 星号

`"运行时上下文是**单独一条消息**"` —— React 不渲染 markdown，
**屏幕上会原样显示成 `**单独一条消息**`**。改成「」并加了防回归断言（扫描整份 client.js，
任何非注释行出现 `**…**` 就失败）。

---

## v0.3.4 修的两个「看着像没事、其实在骗人」的问题

**来源**：点开预览，看到 `上下文段 2 段 = 0 tokens`。查下去发现两件事。

### 一、`assemble()` 漏传了 `agent`

```js
// 官方权威用法 dsh-agent/lib/types/dispatch.js:92
export function assembleContextFor(agent, signal) {
  return { agent, scope: agent, ... };      // ← agent 和 scope 都要
}

// 我以前的代码（注释里甚至抄了上面这段，代码却没照做）
assembly = await sp.assemble({ scope: agent });   // ← 漏了 agent
```

凡读 `context.agent` 的段落都写着 `if (agent === void 0) return ""`：

- `approval:policy`（用户审批策略）
- `sandbox:policy`（沙箱策略）

**于是它们全返回空串**，预览显示成「0 tokens」—— **看着像"这些段落是空的"，其实是我没喂参数。**
修完：`0 tokens` → `95 tokens`，总数 `8522` → `8617`。

### 二、那行汇总本身也在误导

原来写 `sections 23 段 · 上下文段 2 段 · 工具 schema 33 个`，读起来像三样是一回事。其实：

```js
// dsh-system-prompt/lib/index.js:113 —— renderPrompt 只拼 sections
function renderPrompt(assembly) {
  return assembly.sections.map(...);        // ← 不含 contexts
}

// dsh-agent-loop/lib/index.js:909-917 —— contexts 走另一条路
const sections = renderContextSections(assembly);
const context = this.runtimeContext.project(joinContextSections(sections), sections);
...messages: [...claimed, context]          // ← 单独一条消息
```

**运行时上下文是独立的一条消息**（开头是「Current runtime context. This snapshot supersedes…」），
**不进 `system/message`**。

所以：

- 会话日志里看不到它 —— **正常，不是丢了**
- 正文比总数少一块 —— **正常，差的就在那条独立消息里**

现在汇总写成：

```
模型实际收到 ≈ 8617 tokens
系统提示词 23 段 = 2672 tokens　·　工具 schema 33 个 = 5850 tokens　·　运行时上下文 2 段 = 95 tokens
运行时上下文是「单独一条消息」，不在下面的正文里 —— 所以下面的正文比总数少一块。
```

---

## ⚠️ 部署坑：`file:` 依赖会被 pnpm **拷贝**，改了源码不生效

**踩过一次**：改了半天源码，跑起来的还是旧版本，重启也没用。

profile 里写的是

```json
"dsh-prompt-manager": "file:E:/ai-talk/杂谈/dsh-prompt-manager"
```

而 profile 的 `pnpm-workspace.yaml` 里是 `nodeLinker: hoisted` ——
**pnpm 遇到 `file:` 会把整个目录复制一份到 `node_modules/`，不是做链接。**
于是：

- 改源码 → **运行时完全看不到**（改的是另一个目录）
- 重启 Harness → **也没用**（拷贝本身就是旧的）
- 更阴的：**设置页里的编辑写进的是那份拷贝**，两边越飘越远

**修法**：依赖改成 `link:`，pnpm 才会建符号链接：

```json
"dsh-prompt-manager": "link:E:/ai-talk/杂谈/dsh-prompt-manager"
```

改完把 `node_modules/dsh-prompt-manager` 换成 junction（或跑一次 `pnpm install`）。
验证链接是活的：往源码里写个临时文件，看能不能从 `node_modules` 那边读到。

> 判别方法：`(Get-Item $path -Force).LinkType` 是 `Junction` / `SymbolicLink` 才对；
> 空字符串就是实拷贝。

---

## ⚠️ 三个载荷是**同一个东西**，不是三代

`infinite-gen-4` / `infinite-gen-4.1-flash` / `infinite-gen-3` 三个文件的 SHA256 **完全相同**。

这**不是 bug，是原设计** —— 老插件的校验脚本里有一条硬断言：

```js
// 插件内所有承载注入文本的文件（Order 100 / Order 200 / 历史兼容），必须逐字同源
sha256(p) === canonHash
```

它们是一个载荷的三个**入口**：
`gen-4` 是主入口，`gen-4.1-flash` 是老插件里用不同 `order` 给 V4.1 Flash 路由用的镜像，
`gen-3` 是给早期挂过这个名字的会话留的兼容别名。

**所以挂哪一个，模型收到的字一个不差，没法用来"对比"。**
（v0.3.3 之前这三条的描述写着"上一代载荷，保留以便对比" —— **是错的**，已改。）

## v0.3.2 修的一个 bug：删掉「正在被用」的提示词会留烂摊子

**症状**（删掉一条被默认或某会话引用的提示词之后）：

1. **所有新会话静默地什么都挂不上** —— 默认里留着已删条目的 id，新会话照着挂，挂不上
2. 已有会话的状态显示 `attached: true` 是**假的** —— 读的是上一次的结论
3. 那条已删提示词的旧正文**永远卡在会话里卸不掉**

第 3 条最阴：`assign()` 遇到未知 id 会**提前 return，不走 detach**。

**根因**是设计上把「未知 id」一律当成**用户输错了**，整组拒绝。
对用户手选那是对的；但**库里少了一条**时，拒绝等于把烂摊子留在原地。

**修法**：新增 `injector.pruneMissing()` —— **库是唯一真相**，
引用到已不存在条目的地方清掉，然后把受影响的会话重挂：

```js
// 编辑路由和重载路由保存后都调它
library.reload();
const pruned = injector.pruneMissing();   // 剔掉幽灵 id，并重挂受影响的会话
```

清理规则：

| 情形 | 处理 |
|---|---|
| `["keep", "victim"]` 里 victim 没了 | → `["keep"]`，**保留还成立的部分** |
| `["victim"]` 里唯一的没了 | → `[]`，即「显式不注入」（**不回落默认**，免得"我设了个空的反而挂上了东西"） |
| 默认里混进了幽灵 | → 剔掉，新会话恢复正常 |
| 完全没引用到它的会话 | → **不碰** |

路由的响应里会带 `pruned` 字段，说明这次清理动了什么。

## 它解决什么问题

dsh 的系统提示词由很多段拼成：persona、AGENTS.md、技能、工具说明、时间上下文……
想换一段提示词，通常只能去改 profile 的 YAML；想知道"改完到底长什么样"，只能靠猜。

**四样东西：**

1. **每会话挂多条** —— 一个会话可以同时挂「身份补丁」「领域知识」「输出契约」，
   各自按 `order` 插到不同位置，不必揉成一大段
2. **分类** —— 身份 / 领域 / 工具 / 输出 / 其他，让一堆提示词有条理；
   选分类会自动带出该类别的建议插入位置
3. **全局默认** —— 新会话自动用默认那几条，不用逐个手点（界面上可勾选设定）
4. **设置页编辑器 + 最终提示词预览** —— 不用手编 JSON；
   预览读的是 dsh 写进会话日志的 `system/message`，那是**模型真正收到过的**内容

---

## v0.3.1：删掉了做不到事的子代理工具

v0.3.0 曾加过 `list_personas` / `get_persona` 两个工具，**v0.3.1 删掉了**。

**原因**：我原以为 dsh 的 `subagent` 工具有个 `persona` 参数可以让模型传。
**没有。** 模型能传的只有这些：

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

技术上可行（自己调 `ctx.subagents.start`），但那是重造 `dsh-tool-subagent` ——
run 生命周期、流式、结果回收都得自己来，而且会跟内置的 `subagent` 工具并存，
模型面对两个长得差不多的工具更容易用错。**不划算。**

## v0.2.3 的变化

- **新增分类（category）**：内置五类，也可以自己写任意分类
- **选分类自动带出建议 `order`**（仍可手改）—— 建议值对着 dsh 真实的 section 空档挑的
- 编辑器**按分类分组显示**；选词面板也分组，并支持**整类全选 / 清空**

## v0.2.2 的变化

- **删除了 `replace`（替换）模式** —— 它会把 dsh 原生的harness 身份和二十余段工具
  用法说明全部顶掉，收益极低、代价极高。整条路删掉，不留隐藏入口。见下文「两种模式」
- **新增「新会话默认」的界面** —— 以前只能「跟随默认」，却没地方设定默认是什么，
  只能手打 HTTP 请求。现在设置页里有勾选框
- 随之删掉了「组合护栏」（模式只剩 `none`/`append`，任意组合都合法）

## v0.2.1 的变化

- **新增设置页编辑器**（设置 → 插件 → 提示词管理）：列表、新建、编辑、删除，
  改完立即重载并自动重挂已分配的会话
- **移除了「下次将生效（本地渲染）」那一块** —— 它依赖从插件里 import dsh 的
  `renderPrompt()`，实测**解析不到**（dsh 的解析路由按 parentURL 装，`scripts/lib/`
  下没有路由），于是那块永远显示"不可用"，是纯噪音。真实内容走会话日志那条路。

## v0.2.0 的变化

| | v0.1.0 | v0.2.0 |
|---|---|---|
| 每会话挂几条 | 只能 1 条 | **多条**，各自 `order` |
| 新会话 | 默认「不注入」，要逐个手点 | **跟随全局默认** |
| 存储格式 | `{ sessionId: "promptId" }` | `{ version: 2, defaults: [...], assignments: { sessionId: [ids] } }` |
| 组合违例 | 不检查，挂上去才发现不行 | **分配时就拦**（见下） |

旧格式会自动升级：`"promptId"` → `["promptId"]`，`"none"` → `[]`。

---

## 任意组合都合法（v0.2.2 起）

v0.2.0 曾有两道「组合护栏」，因为 `replace` 模式有个要命的特性：

| 曾经的组合 | 曾经的后果 |
|---|---|
| 两条「替换」 | dsh 直接抛错 `multiple complete prompt sections are active` |
| 「替换」+「追加」 | 追加那条**被静默丢弃** |

**替换模式删除后，这两条规则一并作废** —— 模式只剩 `none` / `append`，
你想挂几条就挂几条，各自按 `order` 插入，不会互相顶掉。

唯一的拒绝条件变成了：**id 在库里不存在**（整组拒绝，不改状态）。

---

## 生效时机（已从 dsh 源码确认，不是推断）

| 问题 | 答案 |
|---|---|
| 换提示词对新会话有效吗？ | **有效** |
| 对**已经开着**的会话呢？ | **同样有效 —— 下一步就生效** |
| 为什么？ | `assemble()` 在**每个模型步骤前**重新执行，且**不缓存结果**。见 `dsh-agent-loop/lib/index.js` 的 `preStep()`，以及 `dsh-system-prompt` 自述 "assembled before each model step" |
| 有什么前提？ | 那个会话的 **agent 必须活着**。没加载的会话（比如没打开）会在被打开时自动补挂，状态点显示为黄色 |
| 代价？ | 改了系统提示词会**让模型侧的 prompt cache 失效**，下一轮更贵。别在一轮对话里反复切 |

---

## 两种模式

| 模式 | 行为 |
|---|---|
| `none` | 不注册任何 section。会话的默认状态 |
| `append` | 注册一个普通 section，与 dsh 原有的其他段落**共存**，按 `order` 排序 |

### ⚠️ `replace`（替换）模式已在 v0.2.2 **删除**

它曾经注册一个 `complete: true` 的 section，**独占**整个系统提示词 ——
代价是把 dsh 原生的身份声明（harness:identity）和二十余段工具用法说明
**全部顶掉**：模型仍拿得到工具 schema，却失去「什么时候用哪个、怎么用」的
所有文字说明，表现通常明显变差。而且两个替换模式同时存在会让 dsh 的组装直接抛错。

收益极低、代价极高，所以**整条路一并删掉**，而不是留个隐藏入口。

**迁移**：目录里若还有 `mode: "replace"` 的条目，加载时会报错并告诉你改成 `"append"`：

```
提示词「xxx」用的是已移除的 replace（替换）模式。
该模式会顶掉 dsh 原生的harness 身份和全部工具用法说明，已在 v0.2.2 删除。
请把它的 mode 改成 "append"。
```

> 顺带：因为模式只剩 `none` / `append`，**任意组合都合法** ——
> v0.2.0 里那两条「组合护栏」（两个替换会崩、替换+追加会被静默丢弃）也随之删掉了。

### dsh 默认有哪些 section

预览面板列出的那些段落，绝大多数是**每个工具自己的用法说明**。
权威清单在 `dsh-system-prompt/lib/index.js` 的 `SECTION_ORDERS`：

```
HARNESS_IDENTITY              -1000    harness 身份（我是谁、可用能力）
DEPLOYMENT_PERSONA_PREFIX         0    persona
PLAN_POLICY                     500
FILE_REFERENCE                  900
TOOL_BASH                      1000
TOOL_PWSH                      1010
TOOL_READ                      1100
TOOL_WRITE                     1200
TOOL_EDIT                      1300
TOOL_GLOB                      1400
TOOL_GREP                      1500
TOOL_JOBS / TOOL_PTY           1600 / 1700
TOOL_WEB_SEARCH / FETCH        2000 / 2100
TOOL_LSP                       2200
TOOL_SESSION_QUERY             2300
TOOL_GOAL                      2400
TOOL_WORKFLOW                  2600
TOOL_RALPH                     2700
TOOL_SUBAGENT                  2800
TOOL_REPORT                    2900
MCP_SERVERS                    3100
TOOLS_SDK                      5000
DELIVERABLE_FILE_REFERENCES    9000
STRUCTURED_OUTPUT              9900
HARNESS_SOURCE                 10000
WEB_SURFACE                    10100
DEPLOYMENT_PERSONA_SUFFIX      10200
```

### 别的插件若开启独占覆盖，我们的 section 会消失

`assemble()` 在 complete section 生效时这样返回：

```js
return {
  ...transformed,
  sections: completeSection === void 0 ? transformed.sections : [completeSection],
  contexts: runtimeContextSuppressed ? [] : transformed.contexts
};
```

**本插件自己不会再造成这种情况**（替换模式已删除，我们从不设 `complete`）。
但 **dsh 自带的 persona 插件也能做覆盖** —— 那时所有其他 section（包括我们的）都会消失。

预览功能会检测到并报出来（红框），并提示往 persona 的覆盖开关上查：

```
⚠ 有别的插件在这个会话上开启了「独占系统提示词」覆盖（section：deployment:persona-prefix），
  本插件挂的 section 不在最终结果里。
```

---

## 提示词库

文件：`prompts/catalog.json`

```json
{
  "version": 1,
  "prompts": [
    {
      "id": "my-prompt",
      "name": "显示名",
      "description": "一句话说明，会显示在选择器里",
      "mode": "append",
      "order": 100,
      "file": "my-prompt.md"
    },
    {
      "id": "another",
      "name": "另一条",
      "mode": "replace",
      "order": 10,
      "inline": "正文直接写在这里"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一标识，只允许字母数字 `.` `_` `-` |
| `mode` | ✅ | `none` / `append`（`replace` 已删除） |
| `name` | | 显示名，缺省用 `id` |
| `description` | | 说明文字 |
| `category` | | 分类，缺省 `other`。**自由字符串** —— 内置五类只是建议 |
| `order` | | section 排序，缺省 100。**多条并存时靠它决定插在哪** |
| `file` | ▵ | 正文文件（相对 `prompts/`） |
| `inline` | ▵ | 正文直接写。`file` 与 `inline` 二选一 |

### 分类：给人看的组织维度

**分类和 `order` 是两件独立的事**：

- `category` —— 给人看的，决定界面上归到哪一组、怎么分组显示
- `order` —— 给机器看的，真正决定插到系统提示词的哪个位置

但**新建时选分类会带出该类别的建议 `order`**（之后随便改）。

| 分类 | 名称 | 建议 order | 插在哪 |
|---|---|---|---|
| `identity` | 身份 | **20** | dsh 自带 persona（order 0）的正后方 |
| `domain` | 领域 | **500** | 项目知识、业务规则；工具说明之前 |
| `tool` | 工具 | **3000** | 所有工具说明（到 2900）之后、MCP_SERVERS（3100）之前 |
| `output` | 输出 | **9500** | 交付物相关段落（9000）之后、STRUCTURED_OUTPUT（9900）之前 |
| `other` | 其他 | **100** | 通用位置 |

这些数字**不是随便取的** —— 对着 dsh 真实的 `SECTION_ORDERS` 挑的空档，见下节。

**自定义分类**：`category` 接受任意字符串（比如 `"安全审查"`）。
目录里出现过的自定义分类会被自动收集，出现在编辑器的建议列表里；
自定义分类**没有建议 `order`**，改分类时不会动你已填的 order。

### `order` 决定插在哪

`order` 是真实生效的字段 —— dsh 按它升序排 section
（`dsh-system-prompt/lib/index.js` 的 `comparePromptSections: a.order - b.order`）：

```
-1000  harness:identity        ← harness 身份
    0  deployment:persona-prefix
   20  ← 身份类
  100  ← 其他类（通用位置）
  500  ← 领域类
  900  context:file-reference
 1000~ tool:*（每个工具各一段，共二十余段，到 2900 为止）
 3000  ← 工具类
 9000  ui:deliverable-file-references
 9500  ← 输出类
 9900  STRUCTURED_OUTPUT
10000  harness:source
10100  app:web-surface
10200  deployment:persona-suffix
```

想让某条紧跟在 `tool:subagent`（2800）之后，就把它的 `order` 设成 2801。

**改完不用重启** —— 点会话头部那个 `↻` 按钮即可重载。

**错误不会让插件挂掉**：目录格式错、文件缺失、id 重复等等都会收集成错误列表，
通过 `prompt_manager` 工具和 `GET /api/prompt-manager/state` 的 `diag.libraryErrors` 暴露。

**模板花括号**：非内置变量（`cwd` / `model` / `provider` 之外）的连续 `{{` 会被自动转义成 `{ {`，
避免 dsh 的插值引擎抛 malformed prompt variable reference。

---

## 用法

### 设置页编辑器

**设置 → 插件 → 提示词管理**（挂在 `settings.plugins.tab`，root 作用域）。

**样式全部对齐 dsh 原生的设计令牌**（`--dsw-alias-*` / `--dsw-radius-*`），
取值来自一方实现的 CSS module（`dsh-client-ui-settings-plugin-inventory`）：

```css
.card        { border:.5px solid var(--dsw-alias-settings-card-stroke);
               border-radius:var(--dsw-radius-xl);
               background:var(--dsw-alias-settings-card-fill) }
.cardContent { padding:12px 14px }   hover → var(--dsw-alias-interactive-bg-hover)
.cards       { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px }
.cardTitle   { font-size:14px; font-weight:600 }
.cardIdentity{ font-family:var(--ds-font-family-code); font-size:12px;
               color:var(--dsw-alias-label-tertiary) }
.cardDetails { border-top:.5px solid var(--dsw-alias-border-l2);
               background:var(--dsw-alias-bg-module-platform) }
.section     { max-width:760px }
```

**交互也照原生**：两列网格；卡片头显示「名字 + 模式徽章 + 展开箭头」，
点开才展开详情（`dt/dd` 两列 + 正文 + 编辑/删除），同一时刻只展开一张。

**最上面是「新会话默认」卡片**（常驻展开）—— 勾选哪些提示词，新会话就自动挂哪些：

```
提示词管理   4 条                              [已保存「甲」] [新建] [刷新]
┌──────────────────────────────────────────────────────────────────────┐
│ 新会话默认                                          当前 1 条         │
│ 新开的会话自动挂这几条。已经单独指定过的会话不受影响；                │
│ 想让它改跟默认，在会话头部点「跟随默认」。                            │
├──────────────────────────────────────────────────────────────────────┤
│ ☑ 无限四代  1197 tokens   ☐ 无限四代·Flash  1197 tokens              │
│ ☐ 无限三代  1197 tokens                                              │
│ 新会话将挂 1 条                          [清空]  [保存默认]           │
└──────────────────────────────────────────────────────────────────────┘
提示词管理   4 条                              [已保存「甲」] [新建] [刷新]
```

```
提示词管理   5 条                              [已保存「甲」] [新建] [刷新]
┌────────────────────────────┬────────────────────────────┐
│ 无限四代        [追加]  ›  │ 无限四代·Flash  [追加]  ‹  │
│ infinite-gen-4             │ infinite-gen-4.1-flash     │
│ 正向格式载荷：首行必须是…   │ 面向 V4.1 Flash 的同构载荷 │
└────────────────────────────┴────────────────────────────┘
   ↓ 点开第一张
┌──────────────────────────────────────────────────────────┐
│ 无限四代        [追加]  ⌄                                 │
│ infinite-gen-4                                           │
│ 正向格式载荷：首行必须是命名交付物的标题或围栏             │
├──────────────────────────────────────────────────────────┤
│ 模式   追加                                               │
│ order  100　（100 = persona 之后；2900 = 工具说明之后）    │
│ 规模   1197 tokens · 4290 字符                            │
│ 正文   infinite-gen-4.md                                 │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [MODE: SANDBOX] …                                    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                    [编辑]  [删除]        │
└──────────────────────────────────────────────────────────┘
order 决定插入位置：100 在 persona 之后、工具说明之前；2900 在工具说明之后。
改动保存后立即重载，并自动重挂所有已分配的会话 —— 下一步就生效。
```

> 悬停/聚焦效果用一段**注入的 `<style>`** 实现（类名带 `pm-` 前缀）——
> 内联 `style` 做不了 `:hover` / `:focus-visible`，而一方插件也是这么做的
> （CSS module 编译成字符串后塞进文档，带 `data-plugin` 标记）。

**编辑器的行为：**

- **正文一律写进 `prompts/<id>.md`**，条目改成 `file` 形态（原本是 `inline` 的会转成文件）
- 改成「不注入」模式时，**旧正文文件会被删掉**，不留孤儿
- 删除条目时，**正文文件一并删除**
- `id` 创建后不可改（改 id 等于换一条）
- 保存后**立即重载**，并自动重挂所有已分配的会话

**安全边界**：所有写/删都先解析绝对路径并确认落在 `prompts/` 里 ——
`catalog.json` 的 `file` 字段是用户可编辑的，不能当可信输入。

### 会话头部

```
[●] [无限四代 +1 ·默认 ▾]  [预览]  [↻]
 │                          │       └─ 重读 catalog.json
 │                          └─ 展开最终系统提示词
 └─ 状态点：灰=未挂 / 绿=显式指定且已挂 / 蓝=来自默认且已挂 /
            黄=agent 未加载 / 红=通信失败
```

按钮上的文字就是当前选择：单条显示名字，多条显示「首条 +N」，
**来自全局默认时加 `·默认` 后缀**（否则你分不清这是本会话专门设的、还是跟着默认走的）。

### 多选面板

点按钮展开：

```
┌ 选择本会话的提示词            可以多选；各自按 order 排序插入（当前来自全局默认） ┐
│ ✓ 格式契约      追加 · order 100 · 1197 tokens                                  │
│   渗透测试约定   追加 · order 2900 · 340 tokens                                  │
│   只读审查      替换 · order 10 · 132 tokens     ← 选中替换时会被标红并警告        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 已选 2 条 · 共 1537 tokens（格式契约@100 → 渗透测试约定@2900）                    │
│                          [应用]  [跟随默认]  [不注入]                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

三个按钮的区别：

| 按钮 | 状态文件的写法 | 含义 |
|---|---|---|
| **应用** | `assignments[s] = [ids...]` | 显式用这几条 |
| **跟随默认** | 删掉 `assignments[s]` | 回到全局默认 |
| **不注入** | `assignments[s] = []` | **显式**不注入（即使默认里有东西也不挂） |

组合不合法时「应用」是禁用的，面板顶部直接说明原因。

### 预览面板

点「预览」后列出：

- **模型上次实际收到的系统提示词正文** —— 来自会话日志的 `system/message`，
  变量已由 dsh 替换完毕（这是唯一可信的一路）
- **分类 token 合计**：sections / 上下文段 / 工具 schema 各自多少
- 每个 section 的**名称、token 数、字符数**与**正文**；属于本插件的用**绿框**标出
- **别的插件**若开启独占覆盖，本插件的 section 会消失 —— 预览会**报出来**并列出竞争的 section

> ⚠️ 会话日志里**只有文字段落**，不含工具定义 —— 工具走的是模型 API 自己的
> `tools` 参数，不写进 `system/message`。所以"模型实际收到 ≈ N"是两者之和。

### 工具（模型侧）

只有一个：`prompt_manager`（无参数）。

返回：全局默认、提示词清单、逐会话的生效列表与挂载状态、存活 agent 明细、诊断信息。
**用于排查「选了提示词但没生效」** —— 它会告诉你某个会话是挂上了、
在等 agent 加载、还是根本没匹配上。

> v0.3.0 曾加过 `list_personas` / `get_persona` 两个给子代理挑角色的工具，
> v0.3.1 删掉了（做不到事，见上文）。

### HTTP 路由

| 路径 | 方法 | 用途 |
|---|---|---|
| `/api/prompt-manager/state` | GET | 分配表 + 默认 + 提示词清单 + 诊断 |
| `/api/prompt-manager/assign` | POST | `{ sessionId, promptIds: [...] }`；`null`=跟随默认，`[]`=不注入 |
| `/api/prompt-manager/defaults` | GET/POST | 读/写全局默认 `{ promptIds: [...] }` |
| `/api/prompt-manager/preview` | GET | `?session=<id>` 取该会话最终系统提示词 |
| `/api/prompt-manager/reload` | POST | 重读 catalog.json |
| `/api/prompt-manager/edit` | GET | **带正文**的完整清单（设置页编辑器用） |
| `/api/prompt-manager/edit` | POST | `{ action: "upsert", prompt: {...} }` 或 `{ action: "delete", id }` |

> 兼容 v0.1.0 的旧写法：`{ sessionId, promptId: "a" }` 仍可用，会被当成单条；
> `promptId: "none"` 当成空数组。

---

## 状态与默认值

- **新会话跟随全局默认**；显式「不注入」的会话即使默认里有东西也不挂
- 状态存 `$DSH_HOME/dsh-prompt-manager-state.json`（缺省 `~/.dsh/`）
- 形态：

```json
{
  "version": 2,
  "defaults": ["infinite-gen-4"],
  "assignments": {
    "session-abc": ["infinite-gen-4", "my-rule"],
    "session-def": []
  },
  "updatedAt": "..."
}
```

- 文件不存在或损坏 → 等价于「没有默认、没有指定」
- 旧格式（`assignments` 的值是字符串）会自动升级

### 关于状态文件的增长

每条记录约 **60 字节**（一个 session id 加一个提示词 id）。就算攒到 10,000 个会话，
也只有约 **600 KB** —— 不是需要担心的问题。

**所以本插件不做自动清理。** 原因：dsh 的 `SessionStore` 没有"某会话是否还存在"的
查询接口，按"agent 是否活着"删会**误删已关闭会话的分配** —— 而那正是用户想保留的
数据（重新打开会话时要按它重新挂上）。

`injector.prune(existsFn)` 作为手动 API 保留，由调用方决定判据。

---

## 安装

profile 的依赖指向本地源码：

```json
"dsh-prompt-manager": "file:E:/ai-talk/杂谈/dsh-prompt-manager"
```

`node_modules/dsh-prompt-manager` 是指向源码目录的 **junction**，所以改源码即刻生效。

> ⚠️ profile 设了 `nodeLinker: hoisted`，**再跑一次 `pnpm install` 会把 junction 换成实体拷贝**。
> 不会丢改动（pnpm 是从源码目录拷的），但之后改源码需要重新建 junction：
>
> ```powershell
> $nm = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
> Remove-Item "$nm\dsh-prompt-manager" -Recurse -Force
> New-Item -ItemType Junction -Path "$nm\dsh-prompt-manager" -Target "E:\ai-talk\杂谈\dsh-prompt-manager"
> ```

---

## 测试

```powershell
node scripts/prompt_library_test.mjs      #  62 断言：目录解析、分类、模式校验（含 replace 迁移提示）
node scripts/prompt_store_test.mjs        #  46 断言：写入、删除、分类、路径穿越防护
node scripts/session_injection_test.mjs   # 199 断言：多条挂载、全局默认、未知 id、子代理过滤、预览
node scripts/host_integration_test.mjs    # 177 断言：HTTP 路由、持久化、会话校验、编辑器/默认/分类路由、工具
node scripts/client_render_test.mjs       # 187 断言：组件渲染（用 react 影子层真跑一遍）
```

共 **671 断言**。宿主集成测试用 `DSH_HOME` 指向临时目录，**不会碰你真实的 `~/.dsh`**。

> ⚠️ 宿主集成测试里那几条**编辑器路由**的断言会真的往插件的 `prompts/` 目录写文件 ——
> 测试用的条目 id 是 `zz-test-only`，每条都会在测试内删掉。
> 跑完后 `prompts/` 里应该只有目录原本那几个文件。

> `client_render_test.mjs` 用最小的 react / react-dom 影子层执行 `client.js` 并真的调用组件，
> 专门挡「渲染期抛异常导致整棵组件树消失」这类问题 —— 这个坑踩过一次
> （一个样式常量漏了定义，读取未声明的标识符抛 `ReferenceError`，点预览后所有控件消失）。
> 它还有一条**静态扫描**：所有 `style: XXX` 常量必须有定义。

---

## 实现要点（踩过的坑，留给以后）

**注册方式**必须用 `agent.ctx.inject(["systemPrompt"], cb)` —— scoped ctx 不把宿主服务
当普通属性暴露，要先 inject 才保证可用。权威范例：`dsh-file-reference-local/lib/index.js:339-347`。

**卸载器要抓两个来源**：`section()` 的返回值（卸载这一节的函数）**和** `ctx.inject()` 的返回值
（可能是 fiber 对象，有 `.dispose()`；也可能是函数）。回调必须**返回** `section()` 的结果 ——
写成块体 `{ section(...) }` 会返回 `undefined`，卸载器退化成空函数、旧 section 永远留着，
换提示词时就会两段共存。

**子代理过滤**不要用 `delegationDepth !== undefined` —— 顶层会话的 `delegationDepth`
**就是 0**，字段确实存在，那样写会把每个顶层会话都当子代理拒掉。只在
`origin === 'subagent'` 或 `delegationDepth > 0` 时拒绝。也不要用 `parentSession` 过滤 ——
那是 fork 的 seed lineage。

**预览的 scope**：`assemble({ scope: agent })` —— scope 必须传 agent，
见 `dsh-agent/lib/types/dispatch.js` 的 `assembleContextFor(agent) => { agent, scope: agent }`。

**不要对同一个 ctx 重复 apply** —— 路由会重复注册而抛错
（`dsh-client-connection`: `if (this.fetchRoutes.has(route.path)) throw`）。

**单实例假设**：`hostCtxRef` / `activeInjector` / `activeLibrary` 是模块级变量，
后一次 `apply()` 会覆盖前一次。dsh 里插件只加载一次，不影响使用。

---

## ⚠️ 两个曾经"点了没反应"的坑（v0.1.0 修复）

### 1. HTTP 路由的 `path` 必须是单个字符串，不能传数组

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

### 2. 浮层必须 portal 到 `document.body`

预览弹窗原本渲染在会话头部那一行**里面**。`position: fixed` 会被祖先的
`transform` / `overflow` / `contain` 关住 —— 点击有响应、fetch 也成功，
但**画面上什么都没出现**。

一方插件（`dsh-client-ui-attachment`、`dsh-client-ui-chat`）统一用
`reactDom.createPortal(..., document.body)`。客户端半体要 `require("react-dom")`。

### 另外：现在操作都有可见反馈

- 选提示词 → 「已挂载，下一步生效」/「已选择，但未挂载（原因）」
- 点预览 → 弹窗；失败时红色提示条
- 点 ↻ → 「已重载 N 条提示词」，有格式问题时显示第一条问题
- 按钮忙碌时 ↻ 变成 `…`，下拉框变半透明
- 提示 4 秒后自动消失

---

## 目录

```
index.js                     宿主半体：提示词库 + 会话分配 + HTTP 路由 + 工具
client.js                    客户端半体：会话头部选择器 + 预览面板
cordis.patch.yml             插件挂载声明
prompts/catalog.json         提示词库清单
prompts/*.md                 提示词正文
scripts/lib/prompt-library.mjs    库加载与校验
scripts/lib/session-injection.mjs 注入核心（分配、挂载、预览、冲突检测）
scripts/*_test.mjs           三套测试
legacy/                      旧版「无限四代」的评分器与基准测试，已不在用途内，留档
```

---

## 版本

**0.3.7** —— 领域/工具两个分类的建议 order 避开 dsh 原生段落（500→950、3000→3200），
并新增 `section_order_test.mjs` 拿 dsh 真实的 `SECTION_ORDERS` 逐个比对。

**0.3.6** —— 分类改回 `<select>`（`<datalist>` 在真机上选不了）。

**0.3.5** —— 预览取「最后一条**有正文**的」system/message（原来可能取到最后那条空事件）。

**0.3.4** —— 修预览里上下文段为 0 tokens：`assemble()` 必须传 `{ agent, scope: agent }`。

**0.3.2** —— 修删提示词后的悬挂引用：`pruneMissing()`。

**0.1.0** —— 首次发布。由 `dsh-infinite-gen-4` v0.9.3 改造而来，
从「按会话开关一段写死的载荷」变成「按会话选择任意提示词 + 预览最终结果」。

原版评分器与 prompt-bank 基准测试在 `legacy/`，不与当前用途相关。