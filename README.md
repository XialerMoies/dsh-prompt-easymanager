# 提示词管理 · dsh-prompt-manager

为 DeepSeek Harness 的**每个会话**挂载任意几条系统提示词，并直接看到**模型实际收到的**最终结果。

---

## 它解决什么问题

dsh 的系统提示词是很多段拼起来的：persona、AGENTS.md、技能、工具说明、时间上下文……
想换掉其中一段，通常只能去改 profile 的 YAML；想知道"改完到底长什么样"，只能靠猜。

这个插件给两样东西：

- **按会话挂提示词** —— 一个会话可以同时挂「身份补丁」「领域知识」「输出契约」，
  各自按 `order` 插到不同位置，不用揉成一大段。新会话自动用全局默认那几条。
- **看清最终结果** —— 预览读的是 dsh 写进会话日志的 `system/message`，
  那是**模型真正收到过的**内容，变量都已替换完毕。

还有一层：**原生段落可以单独改写、关掉、还原**（见下面「段落改写」）。

---

## 安装

profile 的依赖指向本地源码：

```json
"dsh-prompt-manager": "file:E:/ai-talk/杂谈/dsh-prompt-manager"
```

`node_modules/dsh-prompt-manager` 是指向源码目录的 **junction**，改源码即刻生效。

> ⚠️ **profile 设了 `nodeLinker: hoisted`，再跑 `pnpm install` 会把 junction 换成实体拷贝。**
> 不会丢改动（pnpm 是从源码目录拷的），但之后改源码不再生效，需要重建 junction：
>
> ```powershell
> $nm = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
> Remove-Item "$nm\dsh-prompt-manager" -Recurse -Force
> New-Item -ItemType Junction -Path "$nm\dsh-prompt-manager" -Target "E:\ai-talk\杂谈\dsh-prompt-manager"
> ```

装完**重启 dsh**。改了客户端代码（`client.js` / `client.*.js`）也必须重启 —— 原因见「注意事项」。

---

## 用法

> `order` 插在哪、什么时候生效、目录格式怎么写 —— 都在
> **[docs/system-prompt.md](docs/system-prompt.md)**，这里只说怎么点。

### 会话头部

```
[●] [无限四代 +1 ·默认 ▾]  [预览]  [↻]
 │                          │       └─ 重读 catalog.json
 │                          └─ 展开最终系统提示词
 └─ 状态点：灰=未挂 / 绿=显式指定且已挂 / 蓝=来自默认且已挂 /
            黄=agent 未加载 / 红=通信失败
```

按钮文字就是当前选择：单条显示名字，多条显示「首条 +N」，
**来自全局默认时加 `·默认`**（否则分不清是本会话专门设的、还是跟着默认走的）。

点开是多选面板：

```
┌ 选择本会话的提示词            可以多选；各自按 order 排序插入（当前来自全局默认） ┐
│ ✓ 格式契约      追加 · order 100 · 1197 tokens                                  │
│   渗透测试约定   追加 · order 2900 · 340 tokens                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 已选 2 条 · 共 1537 tokens（格式契约@100 → 渗透测试约定@2900）                    │
│                          [应用]  [跟随默认]  [不注入]                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

| 按钮 | 状态文件里写成 | 含义 |
|---|---|---|
| **应用** | `assignments[s] = [ids...]` | 显式用这几条 |
| **跟随默认** | 删掉 `assignments[s]` | 回到全局默认 |
| **不注入** | `assignments[s] = []` | **显式**不注入（即使默认里有东西也不挂） |

三个状态是分开的 —— 「跟随默认」和「显式不注入」不是一回事。
组合不合法时「应用」是禁用的，面板顶部直接说明原因。

### 设置页

**设置 → 插件 → 提示词管理**。最上面是「新会话默认」卡片，下面是全部提示词的卡片网格，
点开一张才展开详情（模式 / order / 规模 / 正文）和编辑、删除。

改完保存**立即重载并重挂所有已分配的会话**，下一步就生效。不用手动重启。

正文一律写进 `prompts/<id>.md`；删条目、或把模式改成「不注入」，正文文件会一并删掉。

### 预览

列出**模型上次实际收到的系统提示词正文**，以及 sections / 运行时上下文 / 工具 schema
各自的 token 合计。属于本插件注入的段落用绿框标出。

> ⚠️ 会话日志里**只有文字段落，不含工具定义** —— 工具走模型 API 自己的 `tools` 参数，
> 不写进 `system/message`。所以「模型实际收到 ≈ N」是两者之和。

### 段落改写

除了「挂自己的提示词」，还能**单独改写 dsh 原生段落**：改正文、临时关掉、一键还原官方原文。
官方更新了某一段会标「官方已更新」，你可以选跟随新原文或保留自己的改写。

设计取舍写在 [docs/section-overrides-design.md](docs/section-overrides-design.md)。

---

## 注意事项

**① 改客户端代码必须重启 dsh。**

`client.js` 和三个 `client.*.js` 是宿主用 `require.async` 按需拉的**包内 chunk**，
chunk 的 `rev` 跟着 `client.js` 的 mtime 走。只改 chunk 不重启，浏览器会拿旧 rev 请求，
文件对不上就是 404 —— 表现是**设置页整片空白**。

**② 状态文件不会自动清理，这是故意的。**

存在 `$DSH_HOME/dsh-prompt-manager-state.json`（缺省 `~/.dsh/`），每条记录约 60 字节。
攒到 10,000 个会话也只有约 600 KB，不值得为它冒误删的风险 ——
dsh 的 `SessionStore` 没有「某会话是否还存在」的查询接口，按「agent 还活着吗」删会
**误删已关闭会话的分配**，而那正是要保留的数据（重新打开会话时要按它重新挂上）。

需要清理时用 `injector.prune(existsFn)`，判据由调用方给。

**③ `legacy/` 已经不在用途内**，是旧版「无限四代」评分器的留档。

---

## 开发

```powershell
npm test              # 全部 1086 条断言
npm run harness:check # 六个半体的语法检查
```

宿主集成测试用 `DSH_HOME` 指向临时目录，**不会碰你真实的 `~/.dsh`**。

动代码之前先看 [docs/implementation-notes.md](docs/implementation-notes.md) ——
注册/卸载、子代理过滤、`assemble` 的 scope、客户端 chunk 的规矩，坑都在那儿。

---

## 文件都干什么

```
index.js                  宿主半体：提示词库 + 会话分配 + 段落改写 + HTTP 路由 + 工具
client.js                 客户端宿主：槽位注册 + 会话头部入口 + 按需拉 chunk
client.picker.js          chunk：多选面板 + 会话头部入口
client.preview.js         chunk：最终提示词预览
client.editor.js          chunk：设置页「提示词管理」整栏
cordis.patch.yml          插件挂载声明
prompts/catalog.json      提示词库清单
prompts/*.md              提示词正文
scripts/lib/              库加载、注入核心、段落覆盖、槽位表、预设……（都有测试）
scripts/*_test.mjs        九套测试
docs/                     设计说明与核验记录，见下表
legacy/                   旧版「无限四代」评分器，留档
```

### docs/

| 文件 | 内容 |
|---|---|
| [system-prompt.md](docs/system-prompt.md) | **dsh 系统提示词的机制与参考** —— 生效时机、`order` 对照、提示词库格式、分类建议值 |
| [native-sections-verified.md](docs/native-sections-verified.md) | 原生段落键 ↔ 段名对照（从 dsh 源码直接读出，不是推测） |
| [section-overrides-design.md](docs/section-overrides-design.md) | 段落改写 / 关掉 / 还原的取舍 |
| [implementation-notes.md](docs/implementation-notes.md) | 实现笔记：跟 dsh 内部搏斗踩过的坑（改代码前值得看） |
| [identity-rewrite.md](docs/identity-rewrite.md) | 换掉 agent 身份认知的核验记录 |
| [overlay-component.md](docs/overlay-component.md) | 浮层外壳（备查） |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本改了什么、为什么 |

---

## 许可

MIT
