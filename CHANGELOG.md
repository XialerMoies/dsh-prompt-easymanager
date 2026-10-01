# 版本记录

倒序。每条写「改了什么」和「为什么」—— 踩过的坑比结论值钱，所以坑都留着。

## 关于版本号

**v0.2.8 起重新编号。** 之前号跳得随意（`0.3.7` 之后直接 `0.10.1` → `0.11.1`），
那次按**真实开发顺序**连成一条递减的线，从 `0.2.8` 往下排。

`0.3.0` 起回到**语义化**：修 bug 进末位，加功能进中位 ——
所以 `0.2.8` 之后不是 `0.2.9`，而是 `0.3.0`（那一版换掉了数据模型）。

对应关系，方便跟旧的 git 历史 / 本地装过的版本对上：

| 现在 | 曾经 | 现在 | 曾经 |
|---|---|---|---|
| 0.2.8 | 0.11.1 | 0.2.1 | 0.3.1 |
| 0.2.7 | 0.11.0 | 0.2.0 | 0.2.3 |
| 0.2.6 | 0.3.7 | 0.1.9 | 0.2.2 |
| 0.2.5 | 0.3.6 | 0.1.8 | 0.2.1 |
| 0.2.4 | 0.3.5 | 0.1.7 | 0.2.0 |
| 0.2.3 | 0.3.4 | 0.1.6 | 0.1.0 |
| 0.2.2 | 0.3.2 | | |

> 上面这张表只对 **0.2.8 及以下**有效 —— 那时是「按开发顺序补记」的。
> 从 `0.3.0` 起按语义化走，不再有「曾经叫什么」的问题。

---

## v0.3.3 — 回应 DSH STORE 的上架检查

DSH STORE 的自动检查把项目标成 **Catalog blocked**，四条原因：

    DSH compatibility is not explicitly declared;
    runtime source contains the files permission signal;
    runtime source contains the network permission signal;
    runtime source contains the commands permission signal;
    runtime source contains the credentials permission signal

逐条处理如下。

### ① DSH 兼容范围 —— **这一条是真缺**

以前只有 engines.node。查了 @deepseek-ai/dsh-package-manifest 的
DshEnginesManifest，它明确有 dsh 字段：

    /** Compatible DSH versions as a SemVer range, including an exact version. *\/
    dsh?: string;

补上：

    "engines": {
      "node": "^22.19.0 || >=24.0.0",
      "dsh":  ">=0.1.7"
    }

⚠️ 用 \`>=\` 不用 \`^\`：semver 里 \`^0.1.7\` 等于 \`>=0.1.7 <0.2.0\`，
而 0.x 的次版本号算破坏性变更 —— 那个上限是**假精确**，会把同一个
API 的 0.2.x 挡在外面。

⚠️ **只声明下限不声明上限**：声明上限需要有版本矩阵的测试，而我没有。
实测环境是 DSH 0.1.7-rc.2 / Node 22.23.2 / Windows x64。

### ② 四个权限信号 —— 扫了一遍，性质各不相同

    files        真的读写文件。**这是它的工作** —— 它就是靠存文件做持久化的。
    network      真的 fetch。但**全是调自己注册的本地路由**
                 （/api/prompt-easymanager/*，由 dsh 的 webServer 提供），
                 **零外部服务**。
    commands     没有真信号。那条命中只是注释里出现了「命令」二字。
    credentials  **假阳性**。命中的 token 一词**全是 LLM token 计数**
                 （估算一条提示词占多少上下文），跟身份凭据无关。

⚠️ dsh 那边**没有权限模型**可声明（参考 dsh-xray 那篇
"The dsh Plugin Ecosystem Has No Permission Model"），package.json 里
没有对应的字段。所以按商店给的第二条建议办：**写清楚**。

  · 新增 \`docs/permissions.md\` —— 人读的完整说明：碰什么、连什么、
    坏了会怎样、卸载后留什么
  · \`package.json\` 的 \`dsh.capabilities\` —— 同一份内容的**机器可读摘要**，
    四条信号逐条对应，每条带 scope

⚠️ **文档里的每条断言都有脚本核实**（不只是写完就算）：不执行子进程、
每个 fetch 都指向本地路由常量、零外部依赖、路由清单跟代码一致、
engines 跟代码一致。写完先跑一遍，抓到两条我自己写得不实的地方。

### ③ 一次性 Profile 的安装/启动/卸载证据

在**隔离的 DSH_HOME** 里从 tarball 走完整流程（真实 ~/.dsh 全程没碰）：

    ① 建一次性 profile（从随包发的 web 模板）
    ② dsh plugin --profile evidence add <tgz>      exit 0
    ③ dsh --profile evidence --dump-config         exit 0  条目里有本插件
    ④ dsh plugin --profile evidence remove …       exit 0  node_modules 与依赖都清掉

⚠️ **第 ① 步是 1，原因跟插件无关**：\`--from-default-profile\` 建完 profile
**会立刻启动它**，而默认 web profile 要占 \`127.0.0.1:3080\` —— 验证时那个端口
正被另一个 dsh 实例占着（\`EADDRINUSE\`）。**换个没被占用的端口就能到 0。**
第 ②–④ 步都是 0，装/启/卸本身没问题。

### ④ 顺手修的两个**真 bug**

**路由前缀一直是旧的。**

    /api/prompt-manager/*   →   /api/prompt-easymanager/*      （18 处）

改名那次**没改到这里** —— 改名脚本替换的是包名（\`dsh-prompt-manager\`），
而路由前缀是**短名字**（\`prompt-manager\`，没有 \`dsh-\` 前缀），所以没被命中。
⚠️ 我在当时的报告里说「路由前缀跟着变了」是**错的**，查 git 才发现从没改过。
现在改了（还没发布，没有兼容负担），并且加守卫盯住**两份常量不许飘** ——
路由常量在 \`index.js\` 和 \`client.js\` 里各有一份，少改一边就是前端 404。

**\`/defaults\` 这条退役路由删掉了。**

它原来是「留着但不干活，回 410 告诉调用方去哪儿」。那个设计的前提是
**有老客户端** —— 而这个插件从没发布过，没有老客户端。
路由、常量、客户端那份死常量（\`ROUTE_DEFAULTS\`，只在注释里出现过）一起删。

> 同一个道理，之前那两处「改名兼容读」（老状态文件名、老环境变量）也是
> 白带的复杂度，v0.3.2 已经去掉了。

---


## v0.3.2 — 提示词库移出包外（能发 npm 的前提）

### 为什么必须搬

库原来在**包内**（<包>/prompts/）。本地 link: 装法**看不出问题** ——
包里就是源码目录，读写都正常，所以一直没暴露。

但装在 node_modules 里的包目录**是可以被覆盖的**：

    用户 pnpm update
      → 包目录整个换掉
      → 他攒的提示词**全没了**

这是发 npm 的硬前提 —— 不搬就不能发。

### 搬到哪

    ~/.dsh/dsh-prompt-easymanager-state.json   预设、会话选择、段落改写（本来就在这）
    ~/.dsh/prompts/catalog.json                库的目录（条目元数据）  ← 新
    ~/.dsh/prompts/<id>.md                     每条提示词的正文        ← 新

跟状态文件并排。DSH_HOME 改了它跟着走。

### 迁移（会动你现有的库）

老位置有货、新位置没有 → **自动搬过去**（catalog + 所有正文）。
**老位置留着不动**（不是删）—— 新版有问题时能退回去。

四个边界都做了测试，每个错了都会**丢数据或覆盖数据**：

    ① 老位置有货、新位置空   → 要搬
    ② 老位置是空库           → **不搬**（发布包里那个就是空的，别当用户数据）
    ③ 老位置没 catalog       → 不搬（不新建空文件）
    ④ 新位置已经有库         → **不许覆盖**

⚠️ ②特别要紧：发布包里的 catalog 恒为空库。要是「存在就搬」，
新装的人一打开就被塞一份空迁移。

### 顺手删掉的东西

库搬出去之后，下面这些**全变成多余的**：

    prompts/.gitignore              不用挡了（库不在仓库里）
    scripts/pack-release.mjs        不用「清空再打包」了（包里本来就没库）
    package.json 的 pack:release、files 里的 prompts
    docs_test 里守这套机制的那一节（11 条断言）
    根 .gitignore 里那段解释

**不能只删测试** —— 删了机制还留着守它的断言，测试就红；
只删断言不删机制，代码里就留着死文件。两边一起动。

### 顺带修的

  · 老环境变量名 DSH_PROMPT_MANAGER_CATALOG 不再认了 —— 只认
    DSH_PROMPT_EASYMANAGER_CATALOG。**没发布过，没有「老用户」**，
    留着兼容读只是白带的复杂度。（原来那两处「改名兼容」也一并去掉。）
  · 状态文件的**改名兼容读**同样去掉了 —— 同理。

### 这一版踩到的坑

  · **fs.cpSync 在这个环境里崩**（退出码 0xC0000409）—— 测试里造临时目录时
    踩到，逐个 copyFileSync 就没事。成因不明，绕开了。

  · **测试崩了 ≠ 测试红了**。去掉 mkdirSync 的 recursive 之后，
    测试**进程直接崩**（读一个不存在的文件），报出来是「? 条」、
    后面所有断言都没跑。加固成「文件不在 = 一条正常的失败断言」，
    这样才看得出是哪坏了。

  · **注入验证脚本必须 try/finally 还原**。第一版没有，
    spawn 崩了之后**注入留在了源文件里** —— 我手工看才发现。

  · **Node 的 ESM 缓存不认查询串**。所以「用不同环境变量加载插件四次」
    在一个进程里做不到（模块只求值一次）。改法：把迁移逻辑抽成
    scripts/lib/library-migration.mjs 里的**纯函数**，直接测它 ——
    想测几个场景就测几个。

---


## v0.3.1 — 改名 dsh-prompt-easymanager（为发 npm）

**改名的原因**：npm 上的 \`dsh-prompt-manager\` 已经被别人占了
（SaiSenBox 的另一个实现，2026-08-15 首发，跟这个插件**没有关系**）。
不换名字就没法发 npm。

### 改了哪些地方

这个字符串同时是**好几种身份**，所以不是「全局替换」那么简单 —— 扫出 82 处：

| 身份 | 改法 |
|---|---|
| npm 包名 / DSH 插件 id / cordis 注册名 | 全改 |
| **chunk 注册 id**（\`__ModuleLoader__.load({id})\`） | 全改（8 个文件） |
| URL 路由前缀 | 全改（\`/api/prompt-manager/*\` → \`/api/prompt-easymanager/*\`） |
| 状态文件名 | 改，**但要兼容读老文件**（见下） |
| 环境变量 | **新名字也认，老名字继续认** |
| CHANGELOG 里的历史 | **不改** —— 那是事实 |

⚠️ **chunk 注册 id 漏一个就加载不到**：DSH 解析包内 chunk 靠
「包名 + 文件名」（\`dsh-prompt-easymanager/client.picker.js\`），
所以 \`client.js\` 和每个 \`client.*.js\` 里的 id 必须字字一致。

### 兼容读老状态文件（不然老用户配置全丢）

状态文件名跟着包名变了：

    ~/.dsh/dsh-prompt-manager-state.json      → 老
    ~/.dsh/dsh-prompt-easymanager-state.json  → 新

只认新名字的话，升级后**读不到自己那份配置**，打开插件一片空白
（跟 v0.3.0 那个「开关关着就丢配置」是同一类后果）。

策略：**新名字优先；新文件不在而老文件在 → 读老的**。
写的时候一律写新名字，所以读一次就迁过来了；**老文件留着不动** ——
万一新版有问题，退回去还能用。

### 环境变量也留了旧名

    DSH_PROMPT_EASYMANAGER_CATALOG    ← 新
    DSH_PROMPT_MANAGER_CATALOG        ← 老，继续认

已经按老名字配了的人**不该因此静默失效** —— 那种失败不报错，
只是「以为配了却没生效」，最难查。

### 顺手补的包元数据（要发 npm 就得像个正经包）

    author / repository / homepage / bugs / keywords / engines / publishConfig
    \`pack:check\` 脚本
    \`dsh.repo\` 从 \`local/dsh-prompt-easymanager\` 改成真的仓库地址（原来是过时的）

\`engines\` 写的是 \`^22.19.0 || >=24.0.0\` —— 跟另一个实现对齐，
免得装到不支持的 Node 上再出怪问题。

### 升级方法

    dsh plugin --profile web remove dsh-prompt-manager
    dsh plugin --profile web add dsh-prompt-easymanager

---


## v0.3.0 — 预设成为「唯一载体」；会话页换成预设下拉框

这一版是**加功能**（所以进中位），也是改动最大的一版 —— 数据模型换了。

### 换了什么模型

以前是「两层提示词」：

    全局默认 defaults[]        一串裸的提示词 id
    会话分配 assignments[sid]  另一串裸的提示词 id
    段落改写 sectionOverrides  又是单独一份

现在**预设**是唯一的载体 —— 一条预设 = 个人提示词 + 系统提示词改动：

    global:      { enabled, presetId }
    assignments: { "<会话>": "<预设 id>" | null }
    presets:     { "<id>": { name, prompts[], sections{} } }

**「原生」是一个状态，不是一个选项** —— 一段没被预设改过，它就是原生的。

### 界面上变了什么

  · **会话页头部**：原来的多选面板 → **一个预设下拉框**（532 行削到 210 行）。
    点一下就生效，没有「应用」按钮。三个状态分得清清楚楚：

        具体预设    这个会话用它
        系统提示词  显式什么都不挂（压过全局）
        跟随全局    吃全局那条（全局改了就跟着变）

    > 后两个**不能合并**：全局开着时，前者一条都不挂，后者吃全局那条。
    > 合并了就没法表达「这个会话别挂全局的」。

  · **标签按场景显示**：有个人提示词→预设名；只有系统改动→「系统提示词 · 改」；
    都没改→「系统提示词」。

  · **新会话页**：工作区 / agent 预设后面插了同一个下拉框。
    只能 **DOM 补丁** —— 那一行的两个槽位都是 kind 为 single 且已被占，
    也没有第三个槽位。好处是**不碰 dsh 的文件、它更新不会覆盖**。

  · **设置页**：全局注入开关**合进提示词组合卡片**（它管的就是这一层）；
    卡片头一行就是全部动作 —— 开关 / 标题 / 下拉 / 保存 / **删除** / 刷新；
    勾选区加了一排**系统提示词 tag**（勾 = 这段的改动留在预设里）。

  · 开关**关掉 = 全局这一层整体停用**：没自己选过的会话什么都不挂，
    会话页也只能选「具体预设」或「系统提示词」，**不能跟随全局**。

### 迁移：会动你现有的配置

老数据（defaults 数组 + 裸 id 的 assignments）会自动搬成预设。
**演练真机状态文件时发现过一个会丢配置的 bug**：

    你的状态是 defaults: ["my-prompt-1"] + enabled: false
    原来的迁移只在**开关开着**时才搬 → 你那一条**什么都不剩**

修成「不管开关开着还是关着都搬」，并且**开关照原位保留**
（迁移的职责是保住配置，不是替你决定要不要开）。

### 这一版踩过的坑（都留在代码注释里）

  · **面板背景用了遮罩色**（--dsw-alias-bg-overlay）—— 变量存在、明暗也不同，
    但深色下它是中灰 #61666b，把面板糊成一片灰。
    正解是弹层自己用的 --dsw-specific-menu + --dsw-menu-backdrop-filter。
    **判据从「变量存不存在」升级成「语义对不对」**。

  · **props 被换成了两个字段** —— renderOption(p, { hoverId, setHoverId })
    把完整 props 顶掉了，sessionId 丢了 → 后端 400「缺少 sessionId」
    → 表现是**点了没反应**。断言只查了「发的是什么」，没查「带全了没有」。

  · **DOM 补丁找了四次位置**：往上两层走太高 →
    精确的 aria 属性太紧（0 个）→ 数孩子太松（插到发送按钮后面）→
    最后**读 dsh 源码**找到它自己的槽位键 data-slot="conversation.hero.agentPreset"。
    **前三次都在猜结构，第四次才去读源码。**

  · **同一件事写在两个地方**：会话页的「点完刷新 + 关面板」写进了模块级函数，
    而那函数看不到面板闭包里的 tick —— ReferenceError 被 catch 吞了，
    **一直是坏的而没人知道**。改成回调，两个面板走同一条路。

  · **整节测试被压成一行**：加测试的脚本把数组跟字符串相加
    （BLOCK + anchor 会变成 join(",")），语法上是**逗号表达式**，
    node --check 过得去，**整节不执行**、测试全绿。
    靠「加完断言总数没变」发现。**踩了两次。**

### 顺带

  · 界面跟随 dsh 明暗主题（11 处硬编码灰度改成主题变量）
  · 下拉菜单按 **dsh 原生菜单项**重做（34px / 6px 8px / radius-md / 13px）
  · 补了 hover 反馈（内联样式写不了 :hover，得自己跟 state）
  · 删掉 5 处「本地兜底的样式常量」—— 它们**顶掉了**宿主给的值，
    让「宿主漏给常量」那条守卫**形同虚设**
    （注入验证：删之前全绿，删之后当场抛）

---


## v0.2.8 — 修 `import failed: [object Promise]`

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

## v0.2.7 — 客户端拆包

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

## v0.2.6 — 两个分类的建议 order 跟 dsh 自己的段落撞了

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

## v0.2.5 — 分类改回 `<select>`

原来用 `<input list="…">` + `<datalist>`，想「既能挑又能写」。真机上 `<datalist>`
在部分浏览器/主题下**弹不出来**，等于选不了。改回原生 `<select>`。

---

## v0.2.4 — 修的两处预览细节

### 一、「第 66 轮」看着旧，其实是对的

预览取会话日志里最后一条 `system/message`。有问题的那次取到了**最后一条空事件**，
显示成很旧的轮次。改成取**最后一条有正文的**。

### 二、取日志要取「最后一条**有正文**的」

同上。

### 三、顺手：纯文本 UI 里混进了 markdown 星号

预览正文里原本直接显示 `**粗体**` 的字面量。纯文本环境不做 markdown 渲染，去掉星号。

---

## v0.2.3 — 修的两个「看着像没事、其实在骗人」的问题

### 一、`assemble()` 漏传了 `agent`

预览里**上下文段恒为 0 tokens**。原因是调用 `assemble({ agent })` 时没传 `scope`，
而 `assemble` 是 **scope 分发**的 —— 不带 scope 读，scoped 注册的段落一个都看不见。

正确写法见 `dsh-agent/lib/types/dispatch.js` 的
`assembleContextFor(agent) => { agent, scope: agent }`。

### 二、那行汇总本身也在误导

同一处，汇总把「读不到」显示成「就是 0」。**0 和「没读到」必须能分开。**

---

## v0.2.2 — 修删掉「正在被用」的提示词后留烂摊子

删掉一条正在被会话引用的提示词，会话的分配表里就留下一个**指向不存在 id 的悬挂引用**。
挂载时静默跳过，界面上却显示「已挂载 N 条」。

加了 `pruneMissing()`：装载提示词库后把悬挂引用清掉，并回报清了哪些。

---

## v0.2.1 — 删掉了做不到事的子代理工具

v0.3.0 曾加过 `list_personas` / `get_persona` 两个工具，**v0.2.1 删掉了**。

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

## v0.2.0

小的界面与文案调整。

## v0.1.9

- **删掉 `replace`（替换）模式** —— 见下。目录里残留 `replace` 模式会给出迁移提示。
- 「任意组合都合法」：不再有互斥约束。

### ⚠️ `replace`（替换）模式已在 v0.1.9 删除

原来是「用这条提示词**替掉** dsh 的全部原生段落」。
问题：一旦替掉，工具说明、harness 身份这些也一起没了，agent 直接不会用工具。
**这不是一个用户能安全使用的开关**，删掉。

想改某一段，用「段落改写」（v0.4.0 起）—— 它只动你指定的那一段。

## v0.1.8

修文案与状态点颜色。

## v0.1.7

- 每条提示词有自己的 `order`，插到指定位置（原来是固定追加到末尾）
- 分类 + 建议 order
- 会话头部状态点

---

## v0.1.6 — 首次发布

由 `dsh-infinite-gen-4` v0.9.3 改造而来：从「按会话开关一段写死的载荷」
变成「按会话选择任意提示词 + 预览最终结果」。

### ⚠️ 两个曾经「点了没反应」的坑（v0.1.6 修复）

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
