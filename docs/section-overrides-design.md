# 系统提示词段落：拆分 / 编辑 / 关掉 / 还原

设计稿 + 已确认的 API 事实。**实现前先读这份，因为有几条是"看着能这么干其实不行"。**

---

## 一、官方提供的机制（已从源码确认）

### 1. 注册同名 section = 遮蔽，不是重复

`dsh-system-prompt/lib/types/index.d.ts`：

```ts
/**
 * Register an ordered prompt section in the calling context's scope. A scoped
 * section **shadows a global section with the same name**; duplicates within one
 * layer and non-finite orders throw.
 * @returns the exact Cordis effect disposer.
 */
section(section: PromptSection): () => void;
```

- **同名 → 遮蔽**（scoped 层的盖住 global 层的）
- **同一个层内重名 → 抛错**（所以绝不能在自己的 scope 里注册两次同名）
- **返回 disposer** → 「还原默认」= 调它

> 官方自己就这么用。`PERSONA_PREFIX_SECTION` 的注释：
> 「a composition can replace this slot — an agent preset shadows the
> deployment's persona with its own — and **both sides naming the same section
> is what makes the replacement work rather than duplicate**」

### 2. 空正文 = 关掉

`renderPrompt` 的文档：

> Interpolate strict `{{variable}}` references, **drop empty sections**, and join
> the rest with blank lines.

**所以「关掉某段」= 注册一个同名、正文为空字符串的 section。** 不用自己发明开关。

（dsh 自己也有 `includeHarnessIdentity?: boolean`、`includeRuntimeContext?: boolean`
这类配置级开关，说明"关掉某段"是它认可的操作。）

### 3. 拿官方原文：**不带 scope 的 assemble**

```js
async assemble(context = {}) {
  const scope = context.scope;
  const sectionByName = this.layers.merge(scope, (layer) => layer.sections);
```

`dsh-scope` 的 `merge` 文档：

> Materialize global named entries followed by scope-chain shadows, farthest
> ancestor first, so the nearest scope's entry wins a name.
> @param scope - viewing scope, or **`undefined` for the global view**.

**⇒ `assemble({ agent })`（不带 `scope`）拿到的就是"没有 scoped 遮蔽"的全局视图，
也就是官方原文。**

这条是整个功能的地基 —— 因为一旦我们注册了覆盖，`assemble({agent, scope: agent})`
返回的就是**我们的文本**，原文就看不见了。

⚠️ 注意「全局视图」**不等于**「模型实际看到的」：
agent preset 之类的插件也在 scoped 层遮蔽 `deployment:persona-prefix`。
所以界面上要**两个都显示**：

| 视图 | 怎么取 | 用途 |
|---|---|---|
| **实际生效** | `assemble({ agent, scope: agent })` | 模型现在收到的是什么 |
| **全局原文** | `assemble({ agent })` | 「还原默认」的基准、漂移检测 |

### 4. 段落顺序从哪来

`AssembledSection` 只有 `{ name, text, interpolate? }` —— **没有 `order`**。

- 顺序：返回的数组已经是排好序的（`sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)`），**用下标即可**
- 数字 order：用 `sp.getSectionOrder(name)`（只认官方分配的名字），拿不到就没有

---

## 一·五、**实际用的是瀑布，不是「注册同名 section」**

一开始打算用「注册同名 section 遮蔽」，但查原生插件的注册代码时发现**这条路走不通**：

```js
// dsh-app-boot        getSectionOrder("HARNESS_SOURCE")
// dsh-client-ui-deliverables  name: "ui:deliverable-file-references",  getSectionOrder("DELIVERABLE_FILE_REFERENCES")
// dsh-file-reference-local    name: "context:file-reference",          getSectionOrder("FILE_REFERENCE")
// dsh-mcp-client              name: `mcp:${server}`,                   getSectionOrder("MCP_SERVERS")
```

**注册时必须给出正确的 `order`，而没有任何公开接口能读到「某个已注册 section 的 order」：**

- `AssembledSection` 只有 `{ name, text, interpolate? }` —— **没有 order**
- `getSectionOrder(name)` 只认 `"TOOL_BASH"` 这种**键名**
- 而 section 名是 `"tool:bash"` / `"mcp:${server}"` / `"ui:deliverable-file-references"` ——
  **跟键名之间没有可推导的对应关系**（`mcp:${server}` 还是动态的）

**order 给错，这一段就会跑到别的位置去。**

### 改用 `system-prompt/assemble` 瀑布

```
/** Expert waterfall over the assembled sections... The returned value is authoritative. */
'system-prompt/assemble'(this, assembly, context, next)
```

真实用法（`dsh-session-reference`）：

```js
ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
  const assembly = await next();
  ...
  return assembly;
}, { prepend: true });
```

**好处：**

1. **拿到的是已经排好序的最终结果** → 直接改 `text` 就行，**位置天然不变**，完全不需要 order
2. **它按 `scope` 分发**（`dsh-scope` 把事件的键映射成 `args[1]["scope"]`）：
   - 正常装配（带 `scope`）→ 我们的监听器**触发** → 覆盖生效
   - 探测官方原文（**不带 `scope`**）→ 监听器**不触发** → 拿到未被改动的原文
3. 一个机制同时解决「应用覆盖」和「读取原文」两件事

**注意：原地改 `assembly.sections[i].text`，绝不重排、绝不增删。**
（「关掉」是置空文本，不是删掉数组元素 —— 空段落由 `renderPrompt` 丢弃。）

---

## 二、❌ 不做的事

**不用 `complete: true`。**

插件 v0.2.2 已经把它删了，原因写在 `session-injection.mjs` 里：

> 它靠 section 的 `complete: true` 独占整个系统提示词，会把 dsh 原生的harness 身份
> （HARNESS_IDENTITY）和二十余段工具用法说明**全部顶掉** ——
> 模型仍拿得到工具 schema，却失去「什么时候用哪个、怎么用」的所有说明，表现通常明显变差。

**这次做的是"逐段遮蔽"，一次只动一段，不会连带。**

---

## 三、存储结构

**键是 section 的 `name`，不是下标、不是 order。**

```jsonc
{
  "version": 3,
  "sectionOverrides": {
    "harness:identity": {
      "action": "replace",            // replace | disable
      "text": "……",                   // replace 时的正文；disable 时忽略
      "original": "……",               // 保存时的官方原文（原文快照）
      "originalHash": "a1b2c3d4e5f60718",  // original 的 sha256 前 16
      "savedAt": "2026-09-29T01:20:00.000Z",
      "acceptedDrift": false          // 用户是否已确认"官方改过，仍用我的"
    }
  }
}
```

### 为什么按 name 存？（这是"向后兼容官方未来新增段落"的关键）

| 官方做了什么 | 我们的行为 |
|---|---|
| **新增**一段 | 自动出现在列表里，状态「未改动」，**不用改我们的任何代码或数据** |
| **改动**某段正文 | 检出漂移（见下），**默认不覆盖**，界面上标红 |
| **删掉/改名**某段 | 我们的覆盖变成「已失效」——**保留但不注册**，界面标灰，可一键清掉 |
| **调整**某段的 order | 跟着走 —— 我们从 `assemble()` 现读顺序，不缓存数字 |

**如果按"第 3 段"这种下标存，官方插一段就全错位了。** 所以必须按 name。

---

## 四、漂移检测（`planOverrides`）—— 向后兼容的核心

每次装配时，拿**全局视图**（官方原文）跟存储的 `originalHash` 比：

| 情况 | 判定 | 行为 |
|---|---|---|
| 用户没动过 | `untouched` | 原样保留 |
| 官方原文哈希 **等于** 存下来的 | `apply`，`drifted: false` | 正常覆盖 |
| 官方原文哈希 **不等于** 存下来的 | `apply`，**`drifted: true`** | **照旧覆盖**，但在界面上标出来：「你改的这段，官方已经更新过」 |
| name 在全局视图里**找不到** | `stale` | **不应用**，界面标灰，可一键清掉 |

**`drifted` 是 `apply` 上的一个标记，不是独立状态** —— 按用户定的口径，
**官方改过这段也照旧用用户写的**。

### 「还原默认」= 还原回**新文本**

删掉覆盖 → 官方**当前**的文本自然生效。所以官方更新过之后点「还原默认」，
拿到的是**新版**，不是用户当初依据的旧版。

> 这一条是用户明确要求的：「照旧覆盖，同时还原回默认的是还原回新文本」。

### 副作用：漂移的段落会一直显示提醒

界面上对 `drifted && !driftAcknowledged` 的段落标红。用户点一下「知道了」，
`acceptedDrift` 置 true，提醒消失，覆盖照旧。

**不会自动改用户的东西，也不会自动停用。**

---

## 五、危险段落

有些段落改坏了模型会明显变差。界面上要标出来：

| 段落 | 为什么危险 |
|---|---|
| `harness:identity` | 模型的自我认知 |
| `tool:*`（21 段） | **工具用法说明**。删了模型仍有工具 schema，但不知道什么时候用、怎么用 |
| `mcp:servers` | 同上 |
| `deployment:persona-prefix` / `-suffix` | 部署人设，agent preset 也在这层遮蔽 |

**关掉 `tool:*` 类的要二次确认。**

---

## 六、实现清单

```
scripts/lib/section-overrides.mjs      ← 纯逻辑：哈希、漂移判定、计划（无副作用，好测）
scripts/lib/session-injection.mjs      ← 加：注册/卸载覆盖 section
index.js                               ← 加：状态接口回传段落列表 + 编辑/关掉/还原的路由
client.js                              ← 加：「系统提示词」区块
scripts/section_override_test.mjs      ← 含「官方新增段落」「官方改动段落」用例
```

**纯逻辑跟副作用分开**，因为漂移判定的分支多，必须能脱离 dsh 单测。
