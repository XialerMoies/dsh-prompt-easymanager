# 原生段落：键 ↔ 段名（**从源码直接读出，不是推测**）

> 生成方式：见 `scripts/_extract_section_names.mjs`。
> 它把 dsh 树里所有 `.section({...})` 注册点的 `name` 和
> `order: getSectionOrder("KEY")` **配对抠出来** —— 键和段名在代码里是**挨着写的**。
>
> ```
> this.section({
>   name: "harness:identity",
>   order: this.getSectionOrder("HARNESS_IDENTITY"),   // ← 对应关系在这里，不用猜
>   text: "..."
> })
> ```

## 为什么不能用推的

我推过两次，都错了，而且**推错不会报错，只会静默失效**：

| 我推的 | 实际 | 后果 |
|---|---|---|
| `PTC_ONLY` → `ptc:only` | **`tools:ptc-only`** | 映射表里那个键永不命中，界面一路走兜底 |
| `HARNESS_IDENTITY` → 「环境自述」 | 正文是 "You are an AI agent powered by DeepSeek Harness." | 中文名跟内容对不上 |

**而且推错的东西看着很像对的** —— `ptc:only` 和 `tools:ptc-only` 长得都合理。

---

## 一、代码里明写的（27 个键）

**全部从 `.section({ name, order: getSectionOrder("KEY") })` 里读出来的：**

| order 键 | 段名 | 来源包 |
|---|---|---|
| `HARNESS_IDENTITY` | `harness:identity` | dsh-system-prompt（构造器里写死） |
| `DEPLOYMENT_PERSONA_PREFIX` | `deployment:persona-prefix` | dsh-system-prompt |
| `DEPLOYMENT_PERSONA_SUFFIX` | `deployment:persona-suffix` | dsh-system-prompt |
| `PLAN_POLICY` | `plan:policy` | dsh-base |
| `TEAM_POLICY` | `team:policy` | dsh-experimental-tool-agent-team |
| `PTC_ONLY` | `tools:ptc-only` | **dsh-tools** |
| `TOOLS_SDK` | `tools:sdk` | **dsh-tools** |
| `FILE_REFERENCE` | `context:file-reference` | dsh-file-reference-local |
| `TOOL_BASH` | `tool:bash` | dsh-tool-bash |
| `TOOL_PWSH` | `tool:pwsh` | dsh-tool-pwsh |
| `TOOL_READ` / `TOOL_WRITE` / `TOOL_EDIT` | `tool:read` / `tool:write` / `tool:edit` | dsh-tool-fs |
| `TOOL_GLOB` / `TOOL_GREP` | `tool:glob` / `tool:grep` | dsh-tool-fs-search |
| `TOOL_WEB_SEARCH` / `TOOL_WEB_FETCH` | `tool:web_search` / `tool:web_fetch` | dsh-tool-web |
| `TOOL_JOBS` | `tool:jobs` | dsh-tool-jobs |
| `TOOL_GOAL` | `tool:goal` | dsh-tool-goal |
| `TOOL_RALPH` | `tool:ralph` | dsh-tool-ralph |
| `TOOL_WORKFLOW` | `tool:${toolName}`（动态） | dsh-tool-workflow |
| `TOOL_SUBAGENT` | `tool:${toolName}`（动态） | dsh-tool-subagent |
| `MCP_SERVERS` | `mcp-resource-servers` **和** `mcp:${server}`（动态） | dsh-mcp-client |
| `STRUCTURED_OUTPUT` | `tool:${STRUCTURED_OUTPUT_TOOL}`（动态） | — |
| `DELIVERABLE_FILE_REFERENCES` | `ui:deliverable-file-references` | dsh-client-ui-deliverables |
| `HARNESS_SOURCE` | `harness:source` | dsh-app-boot |
| `WEB_SURFACE` | `app:web-surface` | dsh-web-app |

⚠️ **注意 `TOOL_SUBAGENT` 和 `TOOL_WORKFLOW` 用的是模板名** ——
所以运行时会看到 `tool:subagent`、`tool:subagent_fork`、`tool:workflow`
（同一个 order 位置，不同名字）。**`tool:subagent_fork` 没有独立的 order 键。**

---

## 二、只有位置、没有名字的（5 个键）

| order 键 | 说明 |
|---|---|
| `TOOL_PTY` | **dsh 里没有任何包注册它** |
| `TOOL_LSP` | 同上 |
| `TOOL_SESSION_QUERY` | 同上 |
| `TOOL_REPORT` | 同上 |
| `TOOL_COMPUTER_USE` | 同上 |

**这 5 个在整个 dsh 树里各只出现 2 次** —— 一次在 `SECTION_ORDERS` 定义，一次在类型声明。
**没有任何 `.section()` 会创建它们。**

**所以「没有名字」是事实，不是我没查到。** 界面上只能显示 order 键本身。

**不要把它们机械地推成 `tool:pty` / `tool:lsp`** —— 看着对，但没有依据；
真要哪天有包注册了，名字是那个包说了算。

---

## 三、给插件的结论

1. **`SECTION_LABELS` 里现有的 12 条，全部核对通过**（含 `tools:ptc-only`、`tools:sdk`、`team:policy`）
2. **`TOOL_LABELS` 的兜底路径是对的** —— `tool:${toolName}` 这类动态名必须走兜底
3. **空槽位只能显示 order 键** —— 那 5 个就是没有名字
4. **这份表要定期重新生成**（dsh 升级可能增删键），跟 `section_order_test.mjs` 的漂移检测合用
