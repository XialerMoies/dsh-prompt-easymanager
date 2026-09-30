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
// README 里写过 `file:E:/ai-talk/杂谈/dsh-prompt-manager`，例子里还出现过
// 作者自己那条提示词的名字 —— 用户既看不懂，也不需要知道。
{
  // 只查**会给用户看**的东西：README、docs/ 顶层的两份。
  const userFacing = ["README.md", "docs/system-prompt.md", "docs/section-overrides-design.md"];

  // 作者环境：绝对路径、仓库 owner、作者自用的提示词名。
  const AUTHOR = [
    /E:\\/,
    /E:\//,
    /[A-Z]:\\\\?(?:Users|ai-)/i,
    /ai-talk/,
    /杂谈/,
    /XialerMoies/,
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
  const USER_DOCS = new Set(["system-prompt.md", "section-overrides-design.md"]);
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

// ── 10. 出厂提示词库必须是空的 ──────────────────────────────────────────────
//
// ⚠️ 这条是踩出来的。`prompts/catalog.json` 同时扮演两个角色：
//    **出厂默认**（随包发布）+ **用户的运行时库**（在界面上建一条提示词，
//    插件就往这里写）。所以在自己机器上随手建的测试条目，会**原样提交进仓库、
//    再发布给所有装这个插件的人** —— 别人打开就看到一条不相干的「测试」。
//
//    真发生过：提交里混进了一条 `{id:"test", name:"测试", description:"测试用"}`。
//
// 不能靠 .gitignore 挡（package.json 的 files 里含 prompts，忽略了发布包会缺文件），
// 所以用这条断言盯着：**catalog 必须空**。真想让插件出厂带一条示例提示词时，
// 明确改这条断言 —— 别让它悄悄溜进去。
{
  const raw = JSON.parse(readFileSync(at("prompts", "catalog.json"), "utf8"));
  ok(Array.isArray(raw.prompts), "catalog.json 里有 prompts 数组");
  eq(
    raw.prompts,
    [],
    "**出厂提示词库是空的**（非空说明把你的运行时库提交进去了，会发布给所有人）",
  );
}

done();
