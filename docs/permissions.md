# 权限、依赖与失败边界

这份文件回答三个问题：**它碰了什么**、**它连了什么**、**坏了会怎样**。

给两拨人看：装之前想确认安全的用户，和做上架审核的工具。
机器可读的那份摘要在 `package.json` 的 `dsh.capabilities` 里，两边内容一致。

---

## 兼容范围

```json
"engines": {
  "node": "^22.19.0 || >=24.0.0",
  "dsh":  ">=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0"
}
```

⚠️ 上面这份是**手抄**的。真相在 `package.json` —— 有两处守卫盯着它别抄错
（`npm test` 里的文档测试会核对这里跟 `package.json` 一致）。

**实测环境**：DSH `0.1.7-rc.2`、Node `22.23.2`、Windows x64。

### 为什么写成这种一串

因为**预发布版本需要单独列**。semver 的规则是：

> 范围里不含预发布标识时，**预发布版本永远匹配不上**。

而我们跑的 dsh 全是 `-rc.N`。所以 `dsh: ">=0.1.7"` 这种写法看着没问题，
实际上**匹配不上 `0.1.7-rc.2`** —— 包管理器会认为「不兼容当前环境」。
（这是真踩过的 bug，不是假设。）

而且 `>=X` 这种形式**永远够不到下一个预发布版**（`0.2.0-rc.1`），
所以只能一个次版本一个次版本地列：

```
>=0.1.7-rc.2 <0.2.0-0    ← 0.1.7 那一线（含 rc）
||
>=0.2.0-rc.1 <0.3.0-0    ← 0.2.0 那一线（含 rc）
```

**不声明上限**（不写 `|| >=0.3.0`）：我们没在 0.3.x 上跑过，
凭什么说它行。dsh 出了 0.3 之后我们会实测再往上加。

### 声明里那个 `compatibility` 字段

`package.json` 的 `dsh.compatibility.dshReleases` 逐版本标了**证据等级**：

| 标记 | 含义 |
|---|---|
| `tested` | 在**这个版本上真跑过**（`0.1.7-rc.2`） |
| `api-identical` | 没跑过，但我们依赖的两个 dsh 包跟跑过的那个版本**逐字节相同** |

`api-identical` 不是拍脑袋：比的是 `dsh-system-prompt` 和
`dsh-agent-instructions` 两个包的 `lib/index.js` 的 SHA-256 前 16 位。
复现方法写在那个字段的 `method` 里。

> `0.2.0-rc.1` / `0.2.0-rc.2` 就是 `api-identical` —— 两个包都跟
> `0.1.7-rc.2` 的**完全相同**（`FF422AFAC6BA85F8` / `E15B1A6340EA1CB7`）。

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
  "version": "0.3.5",
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

在一份**隔离的** `DSH_HOME` 里从 tarball 装、加载、核对、卸载，全程不碰真实配置。

**实测环境**：DSH `0.1.7-rc.2` / Node `22.23.2` / Windows x64。
**包**：`dsh-prompt-easymanager-0.3.5.tgz`。

```
① 隔离的 DSH_HOME（临时目录）
② dsh plugin --profile evidence add <tgz>          exit 0
③ dsh --profile evidence --dump-config             exit 0   dump 里有本插件
④ 真启动一次，看心跳落不落盘
     → 落盘了：version = 0.3.5（跟 package.json 一致）
     → 且**不含任何用户数据**（逐项核过：没有 text / prompt /
       content / sessionId / cwd / username / apiKey）
     → phase 停在 "starting"（见下面的说明 —— **这是预期**）
⑤ dsh plugin --profile evidence remove …           exit 0
⑥ 卸载后：插件目录没了，心跳文件**还在**（数据不被卸载删掉）
⑦ 心跳里同时报 stateFile 和 stateWriteFile 两个路径
     （老用户升级后是「读老的、写新的」，只报一个分不清）
```

> ⚠️ **④ 里 `phase` 停在 `starting` 是预期的，不是失败。**
>
> 空白 profile 里 dsh 会打印：
>
> ```
> dsh: warning: 1 entry did not activate
> dsh-prompt-easymanager: pending (waiting for service: connection)
> ```
>
> 那是 **dsh 自己的插件激活状态** —— 它在等它的连接层，而**连接层要等有会话**。
> 空白 profile 一个会话都没有，所以 `apply()` 一直没被调用
> （心跳的 `starting` 是**模块加载时**写的，`ready` 才是 `apply` 里写的）。
>
> ⚠️ **这一条**（`phase: ready`）**在隔离环境里验不了**，别在这儿写 ✔。
> 本插件**没有声明任何服务依赖**（`cordis.patch.yml` 里没有 `inject`，
> `apply` 里也没有 `ctx.inject`），所以那个 `pending` 不是本插件要求的。
>
> 真实 profile（有会话）里的心跳是 `phase: ready / ok: true` ——
> 那是本插件 `ready` 路径的**实测证据**。
>
> ⚠️ **中途踩过**：一开始给真启动那步设了 25 秒固定超时，拿到 `starting`
> 就以为「插件挂了」。**那是脚本没等对。** 现在轮询到 ready/failed 才停。
>
> ⚠️ **杀进程必须 `taskkill /T /F`**：Windows 上 `child.kill("SIGTERM")`
> 对 `shell: true` 起的进程树**不生效** —— 子进程活着、管道不关，
> 父进程退不出去（脚本挂死过一次）。

> ⚠️ **③ 为什么用 `--dump-config` 而不是真启动**：真启动要占
> `127.0.0.1:3080`，端口被别处占用就是 `EADDRINUSE`（退出码 1），
> **那跟插件无关**，混在一起会让这条记录说不清话。
>
> ⚠️ **别自己造 profile 目录**：`dsh plugin --profile <名>` 会在
> `$DSH_HOME/profiles/<名>` 下**自己初始化**一份，跟你手写的那个没关系。
> 第一次就是这么错的：包装到了 dsh 建的那份，却去自己造的目录里找 ——
> 于是每一项都报「正确地没有」，**那几个 ✔ 全是假阳性**。

**装进去的东西**（发布包白名单逐项核对过，缺 0 项、多 0 项）：

```
✔ 在        package.json  index.js  client.js  client.editor.js
            cordis.patch.yml  README.md  CHANGELOG.md  LICENSE
            scripts/lib/session-injection.mjs  scripts/lib/heartbeat.mjs
            docs/permissions.md  docs/install.md
✔ 正确地没有  scripts/lib/test-harness.mjs       （测试脚手架）
✔ 正确地没有  scripts/client_render_test.mjs     （测试）
✔ 正确地没有  scripts/heartbeat_test.mjs         （测试）
✔ 正确地没有  scripts/bump-client-rev.mjs        （开发工具）
✔ 正确地没有  scripts/semver_crosscheck.mjs      （开发工具）
✔ 正确地没有  prompts                            （运行时数据）
✔ 正确地没有  assets                             （仓库门面图）
```

---

## 测试能保证什么、不能保证什么

`npm test` 跑 **14 个套件**（跑一下会打印实际条数 —— 这里不写死数字，
写死了每次改动都要来改文档，然后就没人改了）。

**套件分三类，保证的东西不一样：**

| 类别 | 套件（各对应 `scripts/<名字>_test.mjs`） | 在什么上跑 | 能保证 |
|---|---|---|---|
| **纯逻辑** | `presets` · `preset_adapter` · `section_slots` · `section_override` · `section_order` · `prompt_selection` · `prompt_library` · `prompt_store` · `library_migration` · `heartbeat` | 无 —— 纯函数，进出都是值 | 算法、边界、坏数据处理 |
| **宿主集成** | `session_injection` · `host_integration` | 一份**进程内的桩**，不是真 dsh | 路由契约、装配顺序、状态读写、错误路径 |
| **界面** | `client_render` | **最小的 react / react-dom 影子层**，不是浏览器 | 组件逻辑、文案、各类畸形数据不炸 |
| **文档** | `docs` | 读文件 | README 长度/内容边界、包白名单、路由常量一致、版本声明不自相矛盾 |

### ⚠️ 它们**不**保证这些

说清楚，免得你按错误的前提信任它：

- **不驱动真浏览器。** 界面测试用的是自己写的 react 影子层 ——
  真 DOM 的布局、样式、事件冒泡、主题变量（`--dsw-*`）**都没测**。
  界面长什么样、点起来顺不顺，靠**人工核对**。
- **不连真 dsh。** 宿主那份 API（`ctx.systemPrompt.assemble`、
  `agent.session` 的事件流）在测试里是**桩**。dsh 改了这些接口的话，
  测试可能照样全绿，而真机上已经坏了 —— 所以 `engines.dsh`
  和 `dsh.compatibility` 那两处声明才是配套的保险。
- **不发真请求给模型。** 提示词到底怎么影响模型输出，测不了也不该测。
- **不测并发/多进程。** 状态文件是「读-改-写」，没有锁；
  同时跑两个 dsh 实例写同一份状态，不保证谁赢。

### 跑测试

```bash
npm test              # 全部
npm run test:docs     # 只跑文档与包边界那套（改 README / package.json 后先跑这个）
npm run test:client   # 只跑界面那套
npm run test:semver   # 用真的 semver 交叉验证版本范围声明
```

