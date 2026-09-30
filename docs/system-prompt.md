# dsh 系统提示词：机制与参考

用这个插件需要知道的背景。凡是标了源码位置的，都是**读出来的，不是推断的**。

---

## 生效时机

| 问题 | 答案 |
|---|---|
| 换提示词对新会话有效吗？ | **有效** |
| 对**已经开着**的会话呢？ | **同样有效 —— 下一步就生效** |
| 为什么？ | `assemble()` 在**每个模型步骤前**重新执行，且**不缓存结果**。见 `dsh-agent-loop/lib/index.js` 的 `preStep()`，以及 `dsh-system-prompt` 自述 "assembled before each model step" |
| 有什么前提？ | 那个会话的 **agent 必须活着**。没加载的会话（比如没打开）会在被打开时自动补挂，状态点显示**黄色** |
| 代价？ | 改了系统提示词会**让模型侧的 prompt cache 失效**，下一轮更贵。别在一轮对话里反复切 |

---

## HTTP 路由

界面用的接口。一般不用手调，排查时有用。

| 路径 | 方法 | 用途 |
|---|---|---|
| `/api/prompt-manager/state` | GET | 分配表 + 默认 + 提示词清单 + 诊断 |
| `/api/prompt-manager/assign` | POST | `{ sessionId, promptIds: [...] }`；`null`=跟随默认，`[]`=不注入 |
| `/api/prompt-manager/defaults` | GET/POST | 读/写全局默认 `{ promptIds: [...] }` |
| `/api/prompt-manager/preview` | GET | `?session=<id>` 取该会话最终系统提示词 |
| `/api/prompt-manager/reload` | POST | 重读 `catalog.json` |
| `/api/prompt-manager/edit` | GET | **带正文**的完整清单（设置页编辑器用） |
| `/api/prompt-manager/edit` | POST | `{ action: "upsert", prompt: {...} }` 或 `{ action: "delete", id }` |
| `/api/prompt-manager/sections` | GET | 段落改写现状（原生段落列表 + 覆盖状态） |

> 兼容 v0.1.0 的旧写法：`{ sessionId, promptId: "a" }` 仍可用，会被当成单条；
> `promptId: "none"` 当成空数组。

---

## 模型侧的工具

只有一个：`prompt_manager`（无参数）。

返回全局默认、提示词清单、逐会话的生效列表与挂载状态、存活 agent 明细、诊断信息。
**用于排查「选了提示词但没生效」** —— 它会告诉你某个会话是挂上了、在等 agent 加载、
还是根本没匹配上。

---

## 两种模式

| 模式 | 行为 |
|---|---|
| `none` | 不注册任何 section。会话的默认状态 |
| `append` | 注册一个普通 section，与 dsh 原有的其他段落**共存**，按 `order` 排序 |

因为只剩这两种，**任意组合都合法** —— 想挂几条挂几条，各自按 `order` 插入，不会互相顶掉。
唯一的拒绝条件是 **id 在库里不存在**（整组拒绝，不改状态）。

> `replace`（替换）模式曾在 v0.2.0 存在，v0.2.2 删除。它注册 `complete: true` 的
> section，会顶掉 dsh 原生的身份声明和二十余段工具用法说明 —— 收益极低、代价极高。
> 想改某一段，用「段落改写」。

---

## `order` 决定插在哪

dsh 按 `order` 升序排 section（`dsh-system-prompt/lib/index.js` 的
`comparePromptSections: a.order - b.order`）。原生段落的真实位置：

```
-1000  harness:identity        ← harness 身份
    0  deployment:persona-prefix
   20  ← 身份类（本插件建议值）
  100  ← 其他类（通用位置）
  300  plan:policy
  400  team:policy
  500  ← 领域类
  900  context:file-reference
  950  ← 领域类（v0.3.7 起）
 1000~ tool:*（每个工具各一段，共二十余段，到 2900 为止）
 2900  tools:ptc-only / tools:sdk
 3100  mcp-resource-servers
 3200  ← 工具类（v0.3.7 起）
 9000  ui:deliverable-file-references
 9500  ← 输出类
 9900  structured-output
10000  harness:source
10100  app:web-surface
10200  deployment:persona-suffix
```

想让某条紧跟在某段之后，就把它的 `order` 设成那一段的值 +1。

⚠️ **不要照抄原生段落的 order 当分界线。** `2900` 就是 `tools:ptc-only` **自己的**
order，填 2900 会正好和它撞在同一格，谁在前谁在后取决于稳定排序的实现。

**改完不用重启** —— 点会话头部那个 `↻` 按钮重载即可（编辑路由保存后是自动重载）。

---

## 原生段落键 ↔ 段名

界面上显示的段落中文名，都是从 dsh 源码里 `section({ name, order })` 成对读出来的，
不是从键名猜的。键名写错比译错更隐蔽 —— 曾经写过 `ptc:only`，而真实的键是
`tools:ptc-only`，那个键一次都没命中过，界面上一路走兜底显示成「tools · ptc · only」。

**官方以后新增段落，这里查不到会走兜底**：`tool:xxx` → 「工具用法 · xxx」，
其余 → 把 `:` 换成「 · 」。不用改代码也能有个像样的名字。

---

## 别的插件若开启独占覆盖，本插件的 section 会消失

`assemble()` 在 complete section 生效时这样返回：

```js
return {
  ...transformed,
  sections: completeSection === void 0 ? transformed.sections : [completeSection],
  contexts: runtimeContextSuppressed ? [] : transformed.contexts
};
```

**本插件自己不会再造成这种情况**（从不设 `complete`）。
但 **dsh 自带的 persona 插件也能做覆盖** —— 那时所有其他 section（包括本插件的）都会消失。

预览功能会检测到并报出来（红框），并提示往 persona 的覆盖开关上查：

```
⚠ 有别的插件在这个会话上开启了「独占系统提示词」覆盖（section：deployment:persona-prefix），
  本插件挂的 section 不在最终结果里。
```

---

## 提示词库格式

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
      "mode": "append",
      "inline": "正文直接写在这里"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一标识，只允许字母数字 `.` `_` `-` |
| `mode` | ✅ | `none` / `append` |
| `name` | | 显示名，缺省用 `id` |
| `description` | | 说明文字 |
| `category` | | 分类，缺省 `other`。**自由字符串** —— 内置五类只是建议 |
| `order` | | section 排序，缺省 100。**多条并存时靠它决定插在哪** |
| `file` | ▵ | 正文文件（相对 `prompts/`） |
| `inline` | ▵ | 正文直接写。`file` 与 `inline` 二选一 |

**错误不会让插件挂掉**：目录格式错、文件缺失、id 重复等等都会收集成错误列表，
通过 `prompt_manager` 工具和 `GET /api/prompt-manager/state` 的 `diag.libraryErrors` 暴露。

**模板花括号**：非内置变量（`cwd` / `model` / `provider` 之外）的连续 `{{` 会被自动
转义成 `{ {`，避免 dsh 的插值引擎抛 malformed prompt variable reference。

---

## 分类：给人看的组织维度

**分类和 `order` 是两件独立的事：**

- `category` —— 给人看的，决定界面上归到哪一组
- `order` —— 给机器看的，真正决定插到哪个位置

但**新建时选分类会带出该类别的建议 `order`**（之后随便改）。

| 分类 | 名称 | 建议 order | 插在哪 |
|---|---|---|---|
| `identity` | 身份 | **20** | dsh 自带 persona（order 0）的正后方 |
| `domain` | 领域 | **950** | 策略段（300/400）之后、技能段之前 |
| `tool` | 工具 | **3200** | 所有工具说明（到 2900）之后 |
| `output` | 输出 | **9500** | 交付物段落（9000）之后、`structured-output`（9900）之前 |
| `other` | 其他 | **100** | 通用位置 |

这些数字是**对着真实的 `SECTION_ORDERS` 挑的空档**（v0.3.7 修过一次，原本
领域 500 / 工具 3000 都跟官方撞了）。

**自定义分类**：`category` 接受任意字符串（比如 `"安全审查"`）。
目录里出现过的自定义分类会被自动收集，出现在编辑器的建议列表里；
自定义分类**没有建议 `order`**，改分类时不会动你已填的 order。

---

## 三个载荷是**同一个东西**，不是三代

`infinite-gen-4` / `infinite-gen-4.1-flash` / `infinite-gen-3` 三个文件的
SHA256 **完全相同**。

这**不是 bug，是原设计** —— 老插件的校验脚本里有一条硬断言：

```js
// 插件内所有承载注入文本的文件（Order 100 / Order 200 / 历史兼容），必须逐字同源
sha256(p) === canonHash
```

它们是一个载荷的三个**入口**：`gen-4` 是主入口，`gen-4.1-flash` 是老插件里用不同
`order` 给 V4.1 Flash 路由用的镜像，`gen-3` 是给早期挂过这个名字的会话留的兼容别名。

**所以挂哪一个，模型收到的字一个不差。**
