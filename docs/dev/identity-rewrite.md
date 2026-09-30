# 换掉 agent 的身份认知

> **状态：已在真机验证有效**（2026-09-30，用户实测）。
> 只改 `harness:identity` / `deployment:persona-prefix` 是**不够的** ——
> 身份散在多处，前前后后互相矛盾，模型会挑「更具体、更像事实」的那套信。

---

## 一、身份散在哪（实测扫描）

**扫描对象：agent 实际收到的系统提示词**（不是源码，是自己活在里面看到的那份）。

| # | 段落 | order | 命中原文 | 能改 |
|---|---|---|---|---|
| 1 | `harness:identity` | -1000 | `You are an AI agent powered by DeepSeek Harness.` | ✅ |
| 2 | `deployment:persona-prefix` | 0 | `You are a coding agent powered by the deepseek-flash model.` | ✅ |
| 3 | `harness:source` | 10000 | `The DeepSeek Harness implementation checkout is at D:\...\@deepseek-ai\dsh\.` + `extend DSH itself` | ✅ |
| 4 | `app:web-surface` | 10100 | `the DeepSeek Harness Web GUI` + `dsh web` + `window.__DSH_BOOT__` | ✅ |
| 5 | `deployment:persona-suffix` | 10200 | `Your working directory is E:\ai-talk\杂谈.` | ✅（无泄漏，可不动） |
| 6 | **运行时上下文 · 沙箱策略** | — | `Current **DSH** file policy: workspace-write` | ❌ **改不了** |

**为什么模型不遵守人设：** 第 1、2 条是「声明」，第 3、4 条是「硬事实」（安装路径、
GUI 地址、命令行参数）。**两者冲突时，模型信硬事实。**

---

## 二、改法的核心原则

### ① 别只删旧的，要给个**一样具体**的新身份

空洞的「你是私人助手」顶不过 `D:\...\@deepseek-ai\dsh`。
要**用同等具体度的新环境描述去占位**。

### ② 功能句一个字都不能删，只换里面的名词

`harness:source` 里这两句是**真防 bug 的**：

> The checkout location and current working directory are separate values and may
> differ; never infer the working directory from this path.

删了模型会拿安装路径当工作目录。

`deployment:persona-prefix` 里的 **`coding agent`** 也不能删 —— 它在告诉模型
"你是写代码的"，删了行为会变。

### ③ 有些字面量换不掉，认了就行

| 漏点 | 为什么堵不住 |
|---|---|
| `D:\...\@deepseek-ai\dsh` | 你机器上真实存在的路径 |
| `window.__DSH_BOOT__` | 真实存在的全局变量名 |
| 工具集与 schema | 工具名、参数、行为都是这套框架的 |

**目标是「不再主动声称是 DSH」，不是「让模型查不出来」。** 后者要改框架源码。

---

## 三、可直接粘贴的替换文本（已验证）

### ① `harness:identity`

```
你是一个运行在本机的 AI 开发助手。
```

**保留「AI 代理 / 助手」这个框架** —— 后面的工具用法说明都假设模型知道自己是代理。

### ② `deployment:persona-prefix`

```
你是一个编程代理。
```

**就这些。** 原句里除了 `coding agent`，其余（`powered by`、`{{model}}`）全是身份标签。

### ③ `harness:source`

```
本地实现代码位于 D:\Node\node_global\node_modules\@deepseek-ai\dsh\。
代码位置和当前工作目录是两个不同的值，可能不一致；不要从代码路径推断工作目录。
用 pwd 确定当前工作目录。这个代码目录只用来查看和扩展这套运行时本身。
```

### ④ `app:web-surface`

```
你和用户之间的界面是本机 Web GUI，地址 http://127.0.0.1:3080。
当用户说"这个页面""这个界面""这个应用"而没有指明别的目标时，指的就是这个 GUI。
（其余 HMR / 构建 / 别起替代服务器 那几段原样保留）
```

**建议顺手删掉 `` `dsh web` flags: [--host H] ... `` 那一整句** ——
它讲的是命令行参数，跟人设无关。**删掉既能减泄漏、又不影响日常能力。**

### ⑤ `deployment:persona-suffix`

**不用改。** 它没有身份泄漏，只有工作目录，而且是有用的信息。

---

## 四、验证方法

```
1. 只改 ①②③④（⑤ 可不动）
2. 问 agent：「你是谁？你在什么环境里运行？」
3. 看它还提不提 DSH
```

**实测结果：有效。** 而且**第 6 条（运行时上下文里的 `Current DSH file policy`）
并没有拦住人设生效** —— 它改不了，但也不是决定性的。

> ⚠️ 我一开始把这个"改不了"说成硬限制，是**说得太满了**。
> 实测表明：**只要主动声称的那几处改掉，残留的几处硬事实不足以把身份拉回去。**

---

## 五、下一步（未做）

**「身份体检」功能**：扫一遍最终提示词，把还命中原身份的地方列出来，
点一下就跳到那一段去改。

**判据**：在 `assembly.sections` 的文本里搜一组关键词
（`DeepSeek Harness` / `dsh` / `harness` / `DSH`），按段落汇总命中。

**为什么值得做**：这件事的本质是**一致性检查**。你不知道最后还有哪句在漏，
**扫一遍是唯一可靠的办法** —— 靠肉眼翻二十几段找肯定会漏。
