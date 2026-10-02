/**
 * 用**真的 semver** 交叉验证 `docs_test` 里那个自制比较器 + `engines.dsh`。
 *
 * ⚠️ 为什么必须做：`docs_test` 里的 `satisfies()` 是我手写的。
 *    它写错的话，那些兼容性断言会「全过」得毫无意义 ——
 *    而我加那些断言正是因为**原来的 engines 范围是错的**。
 *    自己写的判据验自己写的声明，不引入外部真值就是个闭环。
 *
 * ⚠️ **这个脚本真抓到过一个错**，记在这儿：
 *
 *     范围写 `>=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1`（**第二段没上界**）时，
 *     `0.3.0-rc.1` 会被判定为**匹配** —— 因为第一段的 `-rc.2` 让
 *     `preAllowed` 变真，于是第二段把所有 ≥0.2.0-rc.1 的预发布版全放行了。
 *     我们自己写的比较器当时也这么算（跟真 semver 一致），
 *     所以**不是比较器错，是范围写错**。补上 `<0.3.0-0` 才对。
 *
 * semver 从 dsh 的依赖树里借（本机已有），不额外装包。
 * 借不到就明确跳过 —— 不假装验过。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const SEMVER_DIR = path.join(
  process.env.USERPROFILE ?? os.homedir(),
  ".dsh",
  "profiles",
  "node_modules",
  "semver",
);

if (!fs.existsSync(SEMVER_DIR)) {
  console.log("");
  console.log("semver 交叉验证：○ 跳过（本机依赖树里没有 semver，没法引入外部真值）");
  process.exit(0);
}

const real = require(SEMVER_DIR);
const PKG = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

// ── 把 docs_test 里那个自制实现抄过来 ─────────────────────────────────
//
// ⚠️ **这份是「旧版」，故意留着的。**
//
//    `docs_test` 里那份后来修精确了（要求比较符跟待判版本**同一个
//    x.y.z** 才放行预发布）。这份停在旧规则（子句里任一个带预发布就放行），
//    所以它在下面那个反例范围上会跟真 semver 不一致 ——
//    **那正是不一致的可视化**：说明「第二段没上界」那种写法确实会错误放行。
//
//    两件事别搞混：
//      · 比较器**算法**不精确 → 已修（见 docs_test）
//      · 范围**写法**漏了上界 → 已修（见 package.json）
//    这个脚本让两者都留在明面上。

const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : null };
};
const cmpPre = (a, b) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
};
const cmp = (a, b) => {
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  return cmpPre(A.pre, B.pre);
};
const mine = (version, range) => {
  const V = parse(version);
  for (const clause of String(range).split("||")) {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    let allOk = true;
    let preAllowed = false;
    for (const p of parts) {
      const m = /^(>=|>|<=|<|=)?\s*(.+)$/.exec(p);
      const op = m[1] ?? "=";
      const T = parse(m[2].trim());
      if (!T) {
        allOk = false;
        break;
      }
      if (T.pre) preAllowed = true;
      const c = cmp(version, m[2].trim());
      if (op === ">=" && c < 0) allOk = false;
      else if (op === ">" && c <= 0) allOk = false;
      else if (op === "<=" && c > 0) allOk = false;
      else if (op === "<" && c >= 0) allOk = false;
      else if (op === "=" && c !== 0) allOk = false;
      if (!allOk) break;
    }
    if (allOk && (V.pre === null || preAllowed)) return true;
  }
  return false;
};

// ── 交叉验证 ──────────────────────────────────────────────────────────
const VERSIONS = [
  "0.0.9", "0.1.6", "0.1.6-alpha.2",
  "0.1.7-alpha.1", "0.1.7-rc.1", "0.1.7-rc.2", "0.1.7", "0.1.8", "0.1.9",
  "0.2.0-0", "0.2.0-rc.1", "0.2.0-rc.2", "0.2.0", "0.2.1",
  "0.3.0-0", "0.3.0-rc.1", "0.3.0", "0.4.0", "1.0.0",
];

/**
 * 要交叉验证的范围。
 *
 * ⚠️ 前两个是**故意留着的反例** —— 它们曾经写进过 package.json，
 *    而且都能「看起来对」。留着它们，是为了让这个脚本在有人
 *    把范围改回那种写法时**立刻报出不一致**。
 */
const RANGES = [
  ["（反例）没有上界的第一段", ">=0.1.7"],
  ["（反例）第二段没有上界", ">=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1"],
  ["package.json 里现在这个", PKG.engines.dsh],
];

console.log("");
console.log("semver 交叉验证（用 dsh 依赖树里的真 semver）");
console.log("");

let mismatch = 0;
for (const [label, range] of RANGES) {
  const diffs = [];
  for (const v of VERSIONS) {
    const a = mine(v, range);
    const b = real.satisfies(v, range);
    if (a !== b) diffs.push(v + "（我=" + a + " 真=" + b + "）");
  }
  console.log("  " + label);
  console.log("    " + range);
  if (diffs.length === 0) {
    console.log("    ✔ " + VERSIONS.length + " 个版本判定一致");
  } else {
    // ⚠️ 反例不一致是**预期**的 —— 那正说明它们有问题
    const isCounterExample = label.includes("反例");
    if (!isCounterExample) mismatch += diffs.length;
    console.log(
      "    " + (isCounterExample ? "○" : "❌") + " " + diffs.length + " 处不一致（" +
        (isCounterExample ? "反例，预期如此" : "**这个是真问题**") + "）：",
    );
    for (const d of diffs) console.log("        " + d);
  }
  console.log("");
}

// 当前范围必须同时做到这两件事
const cur = PKG.engines.dsh;
const mustMatch = ["0.1.7-rc.2", "0.2.0-rc.1", "0.2.0-rc.2"];
const mustNotMatch = ["0.1.7-rc.1", "0.3.0-rc.1", "0.3.0", "0.0.9"];
for (const v of mustMatch) {
  if (!real.satisfies(v, cur)) {
    mismatch++;
    console.log("  ❌ " + v + " **应该匹配却不匹配**");
  }
}
for (const v of mustNotMatch) {
  if (real.satisfies(v, cur)) {
    mismatch++;
    console.log("  ❌ " + v + " **不该匹配却匹配了**（没测过的版本不该放行）");
  }
}

console.log(mismatch === 0 ? "✅ 自制比较器与真 semver 一致，且范围判定符合预期" : "❌ " + mismatch + " 处问题");
if (mismatch !== 0) process.exit(1);
