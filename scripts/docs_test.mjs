// 文档测试
//
// 跑：node scripts/docs_test.mjs
//
// 为什么值得有：README 被写胖过两次 —— 一次是版本记录堆到 1101 行，
// 一次是「开发」和「文件都干什么」又长了回来。这两次都不是打字错误，
// 是**边界没有东西守着**。所以把边界钉成断言。
//
// 这里管的不是文笔，是**读者**：README 只给用户看。

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createSuite } from "./lib/test-harness.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { ok, eq, done } = createSuite("文档测试");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const at = (...p) => join(ROOT, ...p);

const readme = readFileSync(at("README.md"), "utf8");

// ── 1. README 是给用户的 ────────────────────────────────────────────────────
{
  // 用户不关心我们怎么测、代码分几个文件、内部数据结构长什么样。
  const DEV_WORDS = [
    "npm test",
    "harness:check",
    "client.js",
    "client.*",
    "scripts/",
    "injector.",
    "legacy/",
    "SessionStore",
    "chunk",
    "factory",
    "require.async",
    "mtime",
  ];
  const hit = DEV_WORDS.filter((w) => readme.includes(w));
  eq(hit, [], "README 里没有开发者词汇（命中的：见左）");
}

// ── 2. README 不链自用文档 ──────────────────────────────────────────────────
{
  const SELF_ONLY = [
    "docs/dev/",
    "implementation-notes",
    "native-sections-verified",
    "identity-rewrite",
    "overlay-component",
    "CHANGELOG",
    "DEV.md",
  ];
  const hit = SELF_ONLY.filter((w) => readme.includes(w));
  eq(hit, [], "README 不链自用文档");
}

// ── 2b. 面向用户的地方不暴露作者环境 ────────────────────────────────────────
//
// README 里写过 `file:E:/ai-talk/杂谈/dsh-prompt-easymanager`，例子里还出现过
// 作者自己那条提示词的名字 —— 用户既看不懂，也不需要知道。
{
  // 只查**会给用户看**的东西：README、docs/ 顶层的三份。
  const userFacing = [
    "README.md",
    "docs/system-prompt.md",
    "docs/section-overrides-design.md",
    "docs/permissions.md",
  ];

  // 作者环境：**本机路径**、作者自用的提示词名。
  //
  // ⚠️ 这里**故意不挡 `XialerMoies`** —— 它是**发布者名字**，出现在
  //    README 的安装地址里是正当的：
  //        dsh plugin --profile web add github:XialerMoies/dsh-prompt-easymanager#v0.3.3
  //
  //    当初加这条是因为它只以**本地路径**形式出现过
  //    （`file:E:/ai-talk/杂谈/…`）—— 那种由下面那几条路径判据挡住。
  //    「作者名」和「作者的本机路径」是两回事，判据要分开。
  const AUTHOR = [
    /E:\\/,
    /E:\//,
    /[A-Z]:\\\\?(?:Users|ai-)/i,
    /ai-talk/,
    /杂谈/,
    /无限[三四]代/,
    /infinite-gen/,
  ];

  const leaks = [];
  for (const f of userFacing) {
    const src = readFileSync(at(f), "utf8");
    src.split("\n").forEach((line, i) => {
      for (const re of AUTHOR) {
        if (re.test(line)) leaks.push(`${f}:${i + 1} ${line.trim().slice(0, 60)}`);
      }
    });
  }
  eq(leaks, [], "面向用户的文档里没有作者环境痕迹");
}

// ── 2c. 面向用户的文档里不许点名私有条目 ────────────────────────────────────
{
  // 例子要用通用名字（「代码规范」这种），不能拿作者库里的条目标题当示例。
  const src = readFileSync(at("README.md"), "utf8");
  const blocks = [...src.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const bad = blocks.filter((b) => /无限|infinite-gen|gen-4|gen-3/.test(b));
  eq(bad.length, 0, "README 的示例块里用的是通用名字");
}

// ── 2d. ASCII 框的每行显示宽度要一致 ────────────────────────────────────────
{
  // 替换示例文字时框线歪过 —— 中文算 2 宽，靠肉眼数不出来。
  const dw = (s) =>
    [...s].reduce((a, c) => a + (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c) ? 2 : 1), 0);
  const src = readFileSync(at("README.md"), "utf8");
  const boxes = [...src.matchAll(/^┌[^\n]*\n(?:[^└\n]*\n)*?^└[^\n]*/gm)].map((m) => m[0]);
  const uneven = [];
  for (const box of boxes) {
    const ws = [...new Set(box.split("\n").map(dw))];
    if (ws.length > 1) uneven.push(ws.join("/"));
  }
  eq(uneven, [], `README 里的框线宽度一致（扫了 ${boxes.length} 个框）`);
}

// ── 3. README 不写版本历史 ──────────────────────────────────────────────────
{
  // 版本变更进 CHANGELOG。README 里出现「## v0.」就是在长胖。
  ok(!/^##\s*v?\d+\.\d+/m.test(readme), "README 里没有版本流水账（那是 CHANGELOG 的事）");
  const lines = readme.split("\n").length;
  ok(lines <= 220, `README 不超过 220 行（现在 ${lines}）`);
}

// ── 3b. 版本号三处必须一致 ──────────────────────────────────────────────────
//
// 版本号写在三个地方，每次发版都要手动同步，**漏过三次**：
//   v0.10.2（测试断言没跟）、v0.11.1（同上）、重排版本号（同上）。
// 现在测试改成从 package.json 读，这条断言负责盯住剩下两处。
{
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const idx = readFileSync(at("index.js"), "utf8");
  const m = idx.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/);

  ok(m !== null, "index.js 里有 PLUGIN_VERSION");
  eq(m?.[1], pkg.version, "index.js 的 PLUGIN_VERSION 跟 package.json 一致");
  eq(pkg.dsh?.version, pkg.version, "package.json 里 dsh.version 跟顶层 version 一致");
  ok(/^\d+\.\d+\.\d+$/.test(pkg.version), `版本号是 x.y.z 形态（${pkg.version}）`);
}

// ── 3c. 版本号只在一处硬编码 ────────────────────────────────────────────────
{
  // 测试里不许再硬编码版本号 —— 那样每发一版都要来改测试。
  const tests = readdirSync(at("scripts"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith("_test.mjs"))
    .map((e) => e.name);
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));

  const hard = [];
  for (const f of tests) {
    const src = readFileSync(at("scripts", f), "utf8");
    if (src.includes(`"${pkg.version}"`)) hard.push(f);
  }
  eq(hard, [], "测试里没有硬编码当前版本号（应从 package.json 读）");
}

// ── 4. docs/ 顶层只放给用户的 ───────────────────────────────────────────────
{
  // ⚠️ 白名单是**显式的** —— 加一份新文档就得来这里加名字。
  //    这样「随手写份自用笔记扔进 docs/」会被挡住。
  const USER_DOCS = new Set([
    "system-prompt.md",
    "section-overrides-design.md",
    // 权限/依赖/失败边界 —— 给「装之前想确认安全」的用户，也给上架审核
    "permissions.md",
  ]);
  const top = readdirSync(at("docs"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
  eq(
    top.filter((f) => !USER_DOCS.has(f)),
    [],
    "docs/ 顶层只有给用户的文档（自用的进 docs/dev/）",
  );
  ok(top.length > 0, "docs/ 顶层不是空的");
}

// ── 5. 所有 markdown 里的相对链接都落得到文件 ───────────────────────────────
{
  const files = ["README.md", "CHANGELOG.md"];
  for (const dir of ["docs", "docs/dev"]) {
    for (const e of readdirSync(at(dir), { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md")) files.push(join(dir, e.name));
    }
  }

  const broken = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, "/");
    const src = readFileSync(at(f), "utf8");
    for (const m of src.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1];
      if (/^https?:/.test(target) || target.startsWith("#")) continue;
      const p = resolve(dirname(at(f)), target);
      if (!existsSync(p)) broken.push(`${rel} → ${target}`);
    }
  }
  eq(broken, [], "markdown 里的相对链接都落得到文件");
}

// ── 6. CHANGELOG 覆盖当前版本 ──────────────────────────────────────────────
{
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const changelog = readFileSync(at("CHANGELOG.md"), "utf8");
  ok(
    changelog.includes(pkg.version),
    `CHANGELOG 里有当前版本 ${pkg.version}`,
  );
  ok(
    changelog.includes(pkg.dsh.version),
    `CHANGELOG 里有 dsh.version ${pkg.dsh.version}`,
  );
}

// ── 6b. docs 里的 order 对照表必须跟 SECTION_SLOTS 逐行一致 ─────────────────
//
// ⚠️ 这张表我**凭印象手打过**，每个关键数字都错（`plan:policy` 写成 300 实际 500、
//    领域类写成 500 实际 950、`tools:ptc-only` 写成和 `tools:sdk` 都在 2900）。
//    用户照着它调 order 就会插错位置。所以钉死：表里每一行都得能在
//    `SECTION_SLOTS`（从 dsh 源码读出、另有测试盯着的表）里找到。
{
  const { SECTION_SLOTS } = await import("./lib/section-slots.mjs");
  const { CATEGORIES } = await import("./lib/prompt-library.mjs");

  const md = readFileSync(at("docs", "system-prompt.md"), "utf8");
  const block = md.match(/^```\n((?:\s*-?\d+\s+.*\n)+)```/m);
  ok(block !== null, "docs/system-prompt.md 里有 order 对照表");

  if (block) {
    const rows = [...block[1].matchAll(/^\s*(-?\d+)\s+(.*?)\s*$/gm)].map((m) => ({
      order: Number(m[1]),
      label: m[2],
    }));

    // 原生段落那几行必须逐条对上（带「本插件」标记的是我们自己的建议位，跳过）
    const nativeRows = rows.filter((r) => !r.label.includes("本插件"));
    const expected = SECTION_SLOTS.map((s) => ({ order: s.order, name: s.name }));

    const mismatch = [];
    for (const s of expected) {
      const hit = nativeRows.find((r) => r.order === s.order);
      if (!hit) {
        mismatch.push(`表里缺 ${s.order}（${s.name ?? "无 name"}）`);
        continue;
      }
      if (s.name === null) {
        // 官方预留没人注册的：表里的说明文字可以随便写，但不能写出一个具体段名
        if (/^[a-z]+[:_]/.test(hit.label) && !hit.label.includes("（")) {
          mismatch.push(`${s.order} 是孤儿槽位，表里却写了段名「${hit.label}」—— 那是猜的`);
        }
      } else if (!hit.label.startsWith(s.name)) {
        mismatch.push(`${s.order} 表里写「${hit.label}」，实际是「${s.name}」`);
      }
    }
    eq(mismatch, [], "order 对照表跟 SECTION_SLOTS 逐条一致");

    // 本插件的建议 order 也要在表里，且不能撞原生值
    const nativeValues = new Set(SECTION_SLOTS.map((s) => s.order));
    const missingMine = CATEGORIES.filter(
      (c) => !nativeValues.has(c.order) && !rows.some((r) => r.order === c.order),
    ).map((c) => c.id);
    eq(missingMine, [], "本插件的每个建议 order 都在表里（否则用户看不见自己会插哪）");
  }
}

// ── 7. 引用的 docs 路径都带对了前缀 ────────────────────────────────────────
{
  // 源码注释里写 `docs/xxx.md` 的，路径必须真的存在 —— 挪文件时最容易漏。
  const srcFiles = ["index.js", "client.js", "client.picker.js", "client.preview.js", "client.editor.js"];
  for (const e of readdirSync(at("scripts/lib"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".mjs")) srcFiles.push(join("scripts", "lib", e.name));
  }

  const stale = [];
  for (const f of srcFiles) {
    const src = readFileSync(at(f), "utf8");
    for (const m of src.matchAll(/docs\/[\w./-]+\.md/g)) {
      if (!existsSync(at(m[0]))) stale.push(`${f} → ${m[0]}`);
    }
  }
  eq(stale, [], "源码注释里引用的 docs 路径都存在");
}

// ── 9. chunk 的 rev 会不会失效 ──────────────────────────────────────────────
//
// ⚠️ 这一条是防我自己的，踩过一次很贵的坑：
//
// dsh 给插件资源发的缓存头是 `public, max-age=31536000, immutable`（一年），
// chunk 的 URL 是 `/plugins/<id>/client.editor.js?rev=<rev>`，而
// **rev = sha1(client.js 的 mtimeMs + ctimeMs + size)** —— 只跟 client.js 走，
// 不看任何 chunk（dsh-client-modules: artifactRevision / captureArtifactBaseline）。
//
// 所以只改 client.editor.js 而不动 client.js 时，rev 不变 → chunk URL 不变 →
// 浏览器直接用手里的旧模块，改动**根本不生效**。
// 表现是「改了、重启了、刷新了，界面还是老样子」，然后开始怀疑代码 —— 白查半天。
//
// 约定：**改了任何 client.<name>.js，就顺手碰一下 client.js 的 mtime**
//       （`npm run bump:rev`），让 rev 必然变号。
{
  const { staleness } = await import("./bump-client-rev.mjs");
  const { delta, newestChunk } = staleness();
  // 留 2 秒容差：git checkout / 批量写盘会让 mtime 有毫秒级抖动
  ok(
    delta <= 2000,
    "**没有「chunk 比 client.js 新」的情况**（否则 rev 不变、改动不生效）" +
      (delta > 2000
        ? ` —— 现在 ${newestChunk ? newestChunk.split(/[\\/]/).pop() : "?"} 比 client.js 新 ` +
          `${Math.round(delta / 1000)}s，跑一下 npm run bump:rev`
        : ""),
  );
}

// ── 10. 发布包里不许有测试，但运行时文件一个都不能少 ──────────────────────
//
// ⚠️ **两头都会出事**，所以两边都要盯：
//
//   · 带了测试 → 用户装完多出 400 KB 用不到的东西（12 个测试文件 + 测试脚手架）
//   · 漏了运行时文件 → **装了直接跑不起来**（`index.js` 会 import 不到）
//
// ⚠️ 为什么用 `files` 白名单而不是 `.npmignore`：**实测 `.npmignore` 根本没被读** ——
//    往里加 `CHANGELOG.md` / `README.md` 两条，`npm pack --dry-run` 里两个都还在、
//    文件数一动不动（46）。而 `files` 确实生效。
//    白名单比黑名单危险（漏一个就坏），所以这里**从 index.js 反推**要哪些文件。
{
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  ok(files.length > 0, "package.json 有 files 白名单");

  // ① 测试与开发工具不该在里面
  const badEntries = files.filter((f) => /_test\.mjs$|test-harness|check-|bump-client-rev|extract_section_names/.test(f));
  eq(badEntries, [], "**files 里没有测试 / 开发工具**");

  // ② 也不该整个目录地放 scripts —— 那样测试就跟着进去了
  ok(!files.includes("scripts"), "`files` 里没有整个 scripts 目录（会带进测试）");
  ok(!files.includes("scripts/lib"), "`files` 里没有整个 scripts/lib（会带进 test-harness）");

  // ③ **运行时文件一个都不能漏** —— 从 index.js 的 import 反推
  //
  //    ⚠️ 这条是这套白名单的**安全网**。以后给 index.js 加一个
  //       `./scripts/lib/xxx.mjs` 的 import 却忘了加进 files，
  //       发布出去就是「装了跑不起来」—— 而且本地 link: 装法**测不出来**。
  const idx = readFileSync(at("index.js"), "utf8");
  const needed = new Set();
  /** 递归收 —— 被 import 的模块自己还 import 别人。 */
  const collect = (file) => {
    if (needed.has(file)) return;
    needed.add(file);
    const p = at("scripts", "lib", file);
    if (!existsSync(p)) return;
    for (const m of readFileSync(p, "utf8").matchAll(/from "\.\/([a-z-]+\.mjs)"/g)) collect(m[1]);
  };
  for (const m of idx.matchAll(/from "\.\/scripts\/lib\/([a-z-]+\.mjs)"/g)) collect(m[1]);

  ok(needed.size > 0, "从 index.js 反推出了运行时依赖", [...needed].join(", "));
  const missing = [...needed].filter((f) => !files.includes("scripts/lib/" + f));
  eq(missing, [], "**运行时依赖都在 files 里**（漏一个就是「装了跑不起来」）");

  // ④ 客户端那 8 个要能被打包 —— DSH 按「包名 + 文件名」加载它们
  ok(files.includes("client.js"), "files 里有 client.js");
  ok(files.includes("client.*.js"), "files 里有 client.*.js（8 个 chunk）");
  ok(files.includes("index.js"), "files 里有 index.js");
  ok(files.includes("cordis.patch.yml"), "files 里有 cordis.patch.yml");

  // ⑤ 库绝不能进包 —— 它是本机运行时数据（v0.3.2 起在 $DSH_HOME/prompts/）
  ok(!files.includes("prompts"), "**files 里没有 prompts**（那是运行时数据，不是源码）");

  // ⑥ 别把仓库门面图塞进包：banner 917 KB，占包体九成，而且 README 没引用它
  ok(
    !files.includes("assets/banner.png"),
    "**没有把 banner 图打进包**（917 KB，README 里并没有引用）",
  );
}

// ── 11. 路由前缀跟包名一致，而且两份常量不许飘 ────────────────────────────
//
// ⚠️ 踩过：**改名那次路由没跟着改**。改名脚本替换的是包名
//    （`dsh-prompt-manager`），而路由前缀是**短名字**（`prompt-manager`，
//    没有 `dsh-` 前缀），所以没被命中 —— 我在报告里说「跟着变了」是错的，
//    查 git 才发现从没改过。
//
// ⚠️ 还有一份隐患：路由常量在 **`index.js` 和 `client.js` 里各有一份**
//    （宿主注册用一份，客户端兜底 + 通过 `api.route` 发给各 chunk 用一份）。
//    少改一边就是前端 404，而且是**运行时才发现**。
{
  const idx = readFileSync(at("index.js"), "utf8");
  const cli = readFileSync(at("client.js"), "utf8");
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));

  /** 抠出 `const/export const NAME = "/api/…"` 那些。 */
  const routesOf = (src) => {
    const out = new Map();
    for (const m of src.matchAll(/(?:export )?const (\w+_PATH|\w+_ROUTE|ROUTE_\w+)\s*=\s*"(\/api\/[^"]+)"/g)) {
      out.set(m[1], m[2]);
    }
    return out;
  };

  const idxRoutes = routesOf(idx);
  const cliRoutes = routesOf(cli);
  ok(idxRoutes.size >= 8, "index.js 里抠出了路由常量", String(idxRoutes.size) + " 条");
  ok(cliRoutes.size >= 8, "client.js 里抠出了路由常量", String(cliRoutes.size) + " 条");

  // ① 前缀必须跟包名一致
  //
  //    ⚠️ 比的是**去掉 `dsh-` 前缀的包名** —— 路由用短名字。
  const slug = pkg.name.replace(/^dsh-/, "");
  const wantPrefix = "/api/" + slug + "/";
  const wrong = [...idxRoutes, ...cliRoutes].filter(([, v]) => !v.startsWith(wantPrefix));
  eq(wrong, [], `**全部路由用 /api/${slug}/ 前缀**`);

  // ② 两份常量的值必须一样
  //
  //    ⚠️ 名字不同（index.js 是 `STATE_PATH`，client.js 是 `ROUTE_STATE`），
  //       所以按**路径**比，不按常量名。
  const idxPaths = new Set(idxRoutes.values());
  const cliPaths = new Set(cliRoutes.values());
  const onlyIdx = [...idxPaths].filter((p) => !cliPaths.has(p));
  const onlyCli = [...cliPaths].filter((p) => !idxPaths.has(p));
  eq(onlyIdx, [], "**index.js 里的路由 client.js 也有**（少一个就是前端 404）");
  eq(onlyCli, [], "client.js 里的路由 index.js 也有");

  // ③ 一个都不许是旧的短前缀（改名前的残留）
  const stale = [...idxPaths, ...cliPaths].filter((p) => /^\/api\/prompt-manager\//.test(p));
  eq(stale, [], "**没有改名前的旧前缀残留**");
}

// ── 断言描述不许在同一个文件里重复 ──────────────────────────────────────
//
// ⚠️ 描述是断言失败时**唯一的定位信息**。同名两条的话，红了一条你不知道是哪个 ——
//    实测 host_integration_test.mjs 里有 4 条都叫「非法 action → 400」或
//    「坏 JSON → 400」，但它们在**三个不同路由**里（编辑器 / 段落 / 预设）。
//    那些描述是从别的用例抄过来的，一红就得靠行号猜。
//
//    只查「文件内」重复，**不跨文件** —— 跨文件同名大多是合理的：同一个不变量
//    在不同场景各验一遍（比如 `h.sections.length === 1` 出现在 5 个状态流里）。
{
  // ⚠️ 测试**在 scripts/ 里**，不在包根 —— 第一版写成 `at("")`（包根），
  //    于是 filter 出 0 个文件、循环一次都没进，断言恒过 —— **守卫是空的**，
  //    而且从「通过数不变」才看出来（加了 10 条断言，数字一个没涨）。
  //    所以下面第一条先确认「扫到的文件数正常」，免得目录再写错时又静默失效。
  const tested = readdirSync(at("scripts")).filter((x) => x.endsWith("_test.mjs"));
  ok(tested.length >= 10, `扫到 ${tested.length} 个测试文件（少于 10 个说明目录写错了）`);
  for (const file of tested) {
    const src = readFileSync(at("scripts", file), "utf8");
    const lines = src.split("\n");

    // ⚠️ 判据试了**四种**写法，记一下免得再绕：
    //    ① 「字符串后紧跟 `)`」→ 一行多个字符串时中间的也被算成描述
    //       （`eq(readFileSync(join(pd,"new1.md"),"utf8"), "正文甲", "文件内容正确")`
    //         里的 "new1.md" / "utf8" 被误判）；
    //    ② 「行首不是 ok/eq/ne 就全当实参」→ 描述本身也是 eq 的实参，全被排掉，
    //       循环恒空、守卫是空的（注入验证时才发现）；
    //    ③ 「取行内最后一个字符串」→ 表达式的最后一个字面量**未必是描述**：
    //       `ok(false, "渲染不炸: " + label + " —— 抛了 " + e.message)` 的最后
    //       一个字符串是 `" —— 抛了 "`，于是三条不同的断言被当成同一个描述。
    //    ④ **最终：取整行去掉缩进和结尾分号**。描述是拼出来的也能区分，而且
    //       `collectByClass(el, "pm-head")` 这种行首不是 helper 的天然不算。
    //       代价是「同一行写法不同但语义相同」不算重复 —— 那是可接受的漏报。
    const asDesc = new Map();
    for (const [n, line] of lines.entries()) {
      if (!/^\s*(?:ok|eq|ne)\(/.test(line)) continue;
      const key = line.trim().replace(/;$/, "");
      if (key.length < 12) continue;
      if (!asDesc.has(key)) asDesc.set(key, []);
      asDesc.get(key).push(n + 1);
    }

    const dups = [...asDesc.entries()].filter(([, v]) => v.length > 1);
    eq(
      dups.map(([d, v]) => d + "@" + v.join(",")).join(" | "),
      "",
      `**${file} 里断言描述不重复**（重了就看不出红的是哪一条）`,
    );
  }
}

done();
