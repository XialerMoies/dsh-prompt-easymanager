# 权限、依赖与失败边界

这份文件回答三个问题：**它碰了什么**、**它连了什么**、**坏了会怎样**。

给两拨人看：装之前想确认安全的用户，和做上架审核的工具。
机器可读的那份摘要在 `package.json` 的 `dsh.capabilities` 里，两边内容一致。

---

## 兼容范围

```json
"engines": {
  "node": "^22.19.0 || >=24.0.0",
  "dsh":  ">=0.1.7"
}
```

**实测环境**：DSH `0.1.7-rc.2`、Node `22.23.2`、Windows x64。

⚠️ **只声明下限，不声明上限**，理由：声明上限需要有版本矩阵的测试，
而我没有。用 0.2.x 时如果出问题，那是我的兼容性声明写宽了 —— 报个 issue。

`dsh` 用 `>=` 而不是 `^`：semver 里 `^0.1.7` 等于 `>=0.1.7 <0.2.0`，
而 0.x 的次版本号在 semver 里算破坏性变更 —— 那个上限是**假精确**。

---

## 依赖

**运行时依赖：零。** 只用 Node 内置模块（`node:fs`、`node:path`、`node:os`、
`node:url`）和 dsh 自己提供的接入点。

```
dependencies     无
peerDependencies 无
```

界面那一半用的是 dsh 注入的 `react` / `react-dom`，不自己带一份。

---

## 它碰什么

### 文件

| 路径 | 做什么 |
|---|---|
| `$DSH_HOME/dsh-prompt-easymanager-state.json` | 读写。预设、会话选了什么、段落改写记录 |
| `$DSH_HOME/dsh-prompt-easymanager-heartbeat.json` | **只写**。加载心跳（见下） |
| `$DSH_HOME/prompts/catalog.json` | 读写。提示词库的条目元数据 |
| `$DSH_HOME/prompts/<id>.md` | 读写。每条提示词的正文 |

`$DSH_HOME` 缺省是 `~/.dsh`，可以用环境变量改。

**不碰的东西**：插件自己的包目录（只在升级时**读**一次旧位置做迁移）、
dsh 的安装目录、你的项目文件、任何别的地方。

#### 加载心跳是什么

一份**诊断信息**，每次启动重写，随时可以删。排查「插件到底加载了没、
读到哪个文件、为什么没生效」的时候，`cat` 一下就行，不用开 F12 翻控制台。

```jsonc
{
  "ok": true,
  "phase": "ready",          // starting / ready / failed
  "at": "2026-10-02T05:46:01.418Z",
  "version": "0.3.3",
  "dsh": "0.1.7-rc.2",
  "node": "v22.23.2",
  "paths": { "state": "…", "prompts": "…", "catalog": "…" },
  "registered": { "routes": 8, "sectionSlots": 32 },
  "libraryMigration": { "moved": false, "reason": "新位置已有库" },
  "counts": { "prompts": 3, "errors": 0 }
}
```

- **`ok: false` + `phase: "starting"`** = 插件被加载了，但 `apply()` **没跑完** —— 功能是死的
- **`ok: true` + `phase: "ready"`** = 真的起来了
- **`phase: "failed"`** = `apply()` 抛错了，`error` 字段里有原因和堆栈

> ⚠️ **心跳里没有任何用户数据**（没有预设名、没有提示词正文），
> 所以你可以放心把它贴出来求助。
>
> ⚠️ **它跟状态文件是两个文件**，故意的 —— 删心跳永远不会误伤配置。

> ⚠️ v0.3.2 之前库在**包内**（`<包>/prompts/`）。那一版会在首次启动时
> 把库**复制**到 `$DSH_HOME/prompts/`，**原文件保留**。

### 网络

**只连自己**。插件在 dsh 里注册了一组本地路由，界面那半通过它们读写数据：

```
/api/prompt-easymanager/state
/api/prompt-easymanager/presets
/api/prompt-easymanager/assign
/api/prompt-easymanager/global
/api/prompt-easymanager/preview
/api/prompt-easymanager/sections
/api/prompt-easymanager/edit
/api/prompt-easymanager/reload
```

**外部服务：无。** 不上传任何数据，不调任何第三方 API，
没有遥测、没有"检查更新"。

> 路由默认只接受来自本机的请求（dsh 的 `webServer` 管这件事）。
> 想远程访问得你自己在 dsh 那边配。

### 命令

**不执行任何子进程、shell 命令或外部程序。** 源码里没有 `child_process`。

### 凭据

**不读、不存、不传任何凭据。** 不碰 `.npmrc`、环境变量里的密钥、
dsh 的 `.credentials.yaml`。

> ⚠️ **这一条被自动扫描误报过。** 运行时代码里出现的 `token` 一词
> 指的是 **LLM 的 token 计数**（估算一条提示词占多少上下文），
> 跟身份凭据无关。全仓搜 `token` 得到的都是这一种。

### 系统提示词

这是插件的**核心能力**，所以单独列出来：

通过 dsh 的 `systemPrompt` 服务注册和改写**本会话装配时**的系统提示词段落。

- 改的是**内存里那一份**，不改 dsh 自己的任何文件
- 作用域是**当前会话**，不跨会话
- 可以关掉（设置页那个总开关），关掉之后就是原生的
- 「还原」能把它退回原样

---

## 失败边界

原则：**插件坏了不能把 dsh 弄坏。**

| 哪里坏了 | 会怎样 |
|---|---|
| 状态文件坏了 / 不是 JSON | 当成「没有状态」，用默认值跑；**不覆盖**原文件 |
| 提示词库读不出来 | 界面上明确报「读不出来」，不静默假装空库 |
| 迁移出错 | **不挡启动**，控制台说一句原因，库保持原样 |
| 路由出错 | 前端显示错误信息，不假装成功 |
| 客户端 chunk 加载失败 | 界面那半不出现；**宿主那半照常工作** |
| dsh 改版导致 DOM 补丁失效 | 新会话页那个下拉框**不出现**，**页面不会坏** |

没做的：**没有崩溃上报、没有遥测** —— 出问题只能靠你看控制台或提 issue。

---

## 数据与卸载

**卸载不会删你的数据。** 这三个路径留着：

```
$DSH_HOME/dsh-prompt-easymanager-state.json
$DSH_HOME/prompts/catalog.json
$DSH_HOME/prompts/
```

想清干净就手工删掉它们。想备份就整个拷走。

```powershell
dsh plugin --profile <profile> remove dsh-prompt-easymanager
```

⚠️ 卸载后**设置页那一项和会话头部的选择器都不见了** ——
因为它们是插件注册的。dsh 本身不受影响。

---

## 一次性 Profile 的验证记录

在一份**隔离的** `DSH_HOME` 里从 tarball 装、启动、卸载，全程不碰真实配置。

**实测环境**：DSH `0.1.7-rc.2` / Node `22.23.2` / Windows x64。

```
① 初始化一次性 profile（手写 package.json）        exit 0
② dsh plugin --profile evidence add <tgz>          exit 0
③ dsh --profile evidence --dump-config             exit 0   条目里有本插件
④ dsh plugin --profile evidence remove …           exit 0   node_modules 与依赖都清掉
```

**装进去的东西**（发布包白名单逐项核对过）：

```
✔ 在        package.json  index.js  client.js  client.editor.js
            cordis.patch.yml  scripts/lib/session-injection.mjs
            scripts/lib/library-migration.mjs  docs/permissions.md
✔ 正确地没有  scripts/lib/test-harness.mjs     （测试脚手架）
✔ 正确地没有  scripts/client_render_test.mjs   （测试）
✔ 正确地没有  scripts/bump-client-rev.mjs      （开发工具）
✔ 正确地没有  prompts                          （运行时数据）
✔ 正确地没有  assets                           （仓库门面图）
```

> ⚠️ **① 为什么是「手写」而不是 `--from-default-profile web`**：
> 那个开关建完 profile 会**立刻启动它**，而默认 web profile 要占用
> `127.0.0.1:3080` —— 端口被别处占用就是 `EADDRINUSE`（退出码 1），
> **那跟插件无关**。手写一份等价的 `package.json` 就不会启动，
> 退出码也就能解释了。
