// 把 dsh 树里**所有** `.section({...})` 注册点的 name ↔ order 键对应关系抠出来。
//
// 为什么不用推的：每个注册点长这样 ——
//
//     this.section({
//       name: "harness:identity",
//       order: this.getSectionOrder("HARNESS_IDENTITY"),   // ← 键就在名字旁边
//       text: "..."
//     });
//
// **键 → 段名 的对应关系是代码里明写的。** 之前我一直从键名猜段名
// （`HARNESS_IDENTITY` → 猜 `harness:identity` ✓ 但 `PTC_ONLY` → 猜 `ptc:only` ✗），
// 猜错了还发现不了。直接解析就不会错。
//
// 常量形式的 name（`name: PERSONA_PREFIX_SECTION`）要回查 `const X = "..."`。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ⚠️ 别硬编码安装路径（原来写死了作者本机的 D:/Node/node_global/…）。
// 按「候选 node_modules 根 × 相对路径」找，跟 section_order_test.mjs 同一套思路。
function candidateRoots() {
  const roots = [];
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };
  let dir = dirname(process.execPath);
  for (let i = 0; i < 4 && dir; i++) {
    push(join(dir, "node_modules"));
    for (const name of ["node_global", "npm-global", "global"]) push(join(dir, name, "node_modules"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (process.env.npm_config_prefix) push(join(process.env.npm_config_prefix, "node_modules"));
  if (process.env.APPDATA) push(join(process.env.APPDATA, "npm", "node_modules"));
  push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
  return roots;
}

const RELS = [
  "@deepseek-ai/dsh/node_modules/@deepseek-ai",
  "@deepseek-ai/dsh-system-prompt",
];

function roots() {
  if (process.env.DSH_ROOT) return [process.env.DSH_ROOT];
  const found = [];
  for (const root of candidateRoots()) {
    for (const rel of RELS) {
      const p = join(root, rel);
      if (existsSync(p)) found.push(p);
    }
  }
  return found;
}

const ROOTS = roots();
if (ROOTS.length === 0) {
  console.error("找不到 dsh 的安装位置。设 DSH_ROOT 指向 dsh 的 node_modules 根，例如：");
  console.error("  $env:DSH_ROOT = '<...>/node_modules'");
  process.exit(1);
}

/** 收集所有 .js/.ts/.d.ts 文件（跳过太深的 node_modules 嵌套）。 */
function walk(dir, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === ".git" || e === "test" || e === "tests") continue;
      walk(p, depth + 1, out);
    } else if (/\.(js|mjs|cjs|ts)$/.test(e) && !e.endsWith(".map")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 从源码文本里抠出 `const NAME = "值"` 这样的字符串常量。
 * 只认字符串字面量 —— 函数/表达式解析不了，那就老实用原文。
 */
function stringConstants(src) {
  const map = new Map();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]{2,80})"/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

const rows = [];
const seenFiles = new Set();

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!src.includes(".section(")) continue;
    const consts = stringConstants(src);

    // 逐个 `.section(` 位置，取它后面一小段做解析
    for (const hit of src.matchAll(/\.section\s*\(\s*\{/g)) {
      const block = src.slice(hit.index, hit.index + 700);

      // name
      const nm = block.match(/name\s*:\s*([^\n,]+)/);
      if (!nm) continue;
      let raw = nm[1].trim();
      let name = null;
      let via = "";
      const lit = raw.match(/^["'`]([^"'`]+)["'`]$/);
      if (lit) {
        name = lit[1];
        via = "字面量";
      } else if (/^[A-Z][A-Z0-9_]*$/.test(raw) && consts.has(raw)) {
        name = consts.get(raw);
        via = "常量 " + raw;
      } else if (raw.includes("${")) {
        name = raw;
        via = "模板（动态）";
      } else {
        continue; // 认不出来就跳过，不猜
      }

      // order 键
      const om = block.match(/getSectionOrder\s*\(\s*["']([A-Z0-9_]+)["']\s*\)/);
      const key = om ? om[1] : null;

      const isDynamic = name.includes("${") || raw.startsWith("`");
      rows.push({ key, name, via, file: file.replace(/\\/g, "/").split("/node_modules/").pop(), dynamic: isDynamic });
    }
  }
}

// ── 按 order 键汇总 ────────────────────────────────────────────────────────
const byKey = new Map();
for (const r of rows) {
  if (!r.key) continue;
  if (!byKey.has(r.key)) byKey.set(r.key, new Set());
  byKey.get(r.key).add(r.name);
}

console.log("=== 键 → 段名（**代码里明写的，不是推的**）===");
for (const key of [...byKey.keys()].sort()) {
  const names = [...byKey.get(key)];
  console.log("  " + key.padEnd(30) + " → " + names.join("  |  "));
}

console.log("\n=== 有段名但 order 不是 getSectionOrder 的（可能漏解析）===");
const noKey = [...new Set(rows.filter((r) => !r.key).map((r) => r.name))];
console.log(noKey.length ? "  " + noKey.join("\n  ") : "  （无）");

console.log("\n=== 认不出 name 的（没往表里塞，只报数量）===");
console.log("  解析到的注册点共 " + rows.length + " 处，涉及 " + new Set(rows.map((r) => r.name)).size + " 个不同的 name");
