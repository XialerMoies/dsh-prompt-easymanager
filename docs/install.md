# 安装与更新

## 安装

一条命令：

```powershell
dsh plugin --profile web add github:XialerMoies/dsh-prompt-easymanager
```

> `web` 是 profile 名，按你自己的来（`dsh profile list` 能看到）。

> ⚠️ **下面命令里的 `v0.3.N` 是占位符**，不是真标签 —— 复制前换成你要的版本，
> 比如 `#v0.3.4`。具体发过哪些版本看
> [releases](https://github.com/XialerMoies/dsh-prompt-easymanager/releases)。
>
> （用占位符是因为那些数字是**示意**，不是真相。写死的话每次发版都要手改文档，
> 早晚有一次忘掉，然后文档就指着一个不存在的标签。）

装完**重启 DSH Web**。

### 想钉住某个版本

```powershell
dsh plugin --profile web add github:XialerMoies/dsh-prompt-easymanager#v0.3.N
```

`#` 后面可以是**标签**、**分支**或**精确提交**：

```
#v0.3.N     标签    —— 钉死在这个版本
#main       分支    —— 装的时候取当时最新的
#15ba362    提交    —— 最精确
```

不写 `#` 就是**默认分支**（`main`）。

---

## 更新

### 先把机制说清楚

pnpm 会把 GitHub 依赖**解析成精确的 commit**，写进 `pnpm-lock.yaml`：

```yaml
dsh-prompt-easymanager:
  specifier: github:XialerMoies/dsh-prompt-easymanager#v0.3.N
  version: https://codeload.github.com/…/tar.gz/15ba3627ef4673b98f8dd7193bf53c6e6d8edd45
```

**这个设计是故意的**：保证「装的是什么就是什么」，上游改代码不会悄悄影响你机器上的东西。

更新就是**让 pnpm 重新去解析这个引用**。

### 推荐：跑 update

```powershell
dsh plugin --profile web update dsh-prompt-easymanager
```

装完**重启 DSH Web**。

> **实测过**：`pnpm update`、`pnpm update <包名>`、`pnpm install --force`
> 三个都会重新解析 GitHub 引用（`add` 同一个 spec 则不会 —— 那条路别走）。

### ⚠️ 你装的是标签的话，还得上游先发新标签

```
你装的：#v0.3.N     →  lockfile 钉在 v0.3.N 那个 commit
上游发了 v0.3.N+1   →  但你的 spec 还是 #v0.3.N
跑 update          →  重新解析 #v0.3.N，还是那个 commit（没变化）
```

**所以装标签的用户要两步**：先换 spec，再装。

```powershell
dsh plugin --profile web add github:XialerMoies/dsh-prompt-easymanager#v0.3.N+1
```

（`add` 换新标签会重新解析 —— 因为 spec 变了。）

### 装分支的话，一条 update 就够

```
你装的：#main   →  lockfile 钉在装的那一刻
跑 update      →  重新解析 #main，拿到现在最新的 commit
```

⚠️ 代价：拿到的是「当时的 `main`」，**不是某个发布版本**。上游有半成品时会装到半成品。

### 对照表

| 你装的是 | 更新怎么做 | 拿到什么 |
|---|---|---|
| `#v0.3.N` | **先换成 `#v0.3.N+1`** 再 add | 那个发布版本，确定 |
| `#main` | `update dsh-prompt-easymanager` | 当时的 `main`，不确定 |
| 不写 `#` | 同上 | 当时的默认分支，不确定 |

### 想确认自己装的是哪个 commit

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\web\pnpm-lock.yaml" -Pattern "prompt-easymanager" -Context 0,2
```

---

## 卸载

```powershell
dsh plugin --profile web remove dsh-prompt-easymanager
```

⚠️ **你的数据不会被删。** 这三个路径留着：

```
$DSH_HOME/dsh-prompt-easymanager-state.json   预设、会话选择、段落改写
$DSH_HOME/prompts/catalog.json                提示词库的条目
$DSH_HOME/prompts/<id>.md                     每条提示词的正文
```

想清干净就手工删掉它们；想备份就整个拷走。

---

## 装不上时

### 报 `allowBuilds` / 构建脚本被拦

从 GitHub 装的包如果带 `prepare` / `postinstall` 之类的构建脚本，
pnpm 10 以上会**默认拦住**（供应链防护）。报错里会给你一个 key，
加到 `pnpm-workspace.yaml` 的 `allowBuilds` 里再重试。

**这个插件没有任何构建脚本** —— 发出去就是能直接跑的 `index.js` 和
`client*.js`，所以正常情况下遇不到这条。

### 没有 pnpm

```powershell
corepack enable pnpm
```

---

## 版本历史

见 [CHANGELOG.md](../CHANGELOG.md)。发布版本对应仓库的标签：

```
https://github.com/XialerMoies/dsh-prompt-easymanager/tags
```
