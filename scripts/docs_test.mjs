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

// ── 3. README 不写版本历史 ──────────────────────────────────────────────────
{
  // 版本变更进 CHANGELOG。README 里出现「## v0.」就是在长胖。
  ok(!/^##\s*v?\d+\.\d+/m.test(readme), "README 里没有版本流水账（那是 CHANGELOG 的事）");
  const lines = readme.split("\n").length;
  ok(lines <= 220, `README 不超过 220 行（现在 ${lines}）`);
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

done();
