// 测试样板 —— 9 个测试文件本来各抄一份，抽出来。
//
// ═══════════════════════════════════════════════════════════════════════════
// 为什么要抽
// ═══════════════════════════════════════════════════════════════════════════
//
// 抽之前：9 个测试文件里有 9 份一模一样的 `pass` 计数器、`ok()`、`eq()`、
// 失败清单、退出码 —— **约 270 行纯复制**。
//
// 复制的不只是行数，还有**行为分叉的风险**：改一处的输出格式（比如
// 加个截断），另外 8 个不会跟着改。实际上已经分叉过一次 ——
// 只有 client_render_test.mjs 有 `brief()` 截断，因为只有它踩过
// 「比对 700KB 文件时把整个文件刷到终端」那个坑。
//
// 现在截断是**所有人都有**的。
//
// ═══════════════════════════════════════════════════════════════════════════
// 用法
// ═══════════════════════════════════════════════════════════════════════════
//
//     import { createSuite } from "./lib/test-harness.mjs";
//
//     const { ok, eq, done } = createSuite("槽位表测试");
//
//     ok(cond, "说明");                 // 断言为真
//     eq(actual, expected, "说明");     // 断言相等（长值自动截断）
//     ...
//     done();                          // 打印汇总 + process.exit
//
// `done()` 里按失败数决定退出码 —— 直接跑或交给 `npm test` 都对。

/** 断言失败时打印用的简短预览 —— 长值截断，别把终端刷爆。 */
export function brief(value) {
  let s;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (typeof s !== "string") s = String(s);
  return s.length > 160 ? `${s.slice(0, 160)}…（共 ${s.length} 字符）` : s;
}

/**
 * 造一个测试套件。
 *
 * @param {string} label 汇总那行的名字，比如"槽位表测试"
 * @returns {{ ok: Function, eq: Function, done: Function, pass: number, fail: number, failures: string[] }}
 */
export function createSuite(label) {
  const s = {
    pass: 0,
    fail: 0,
    failures: [],
  };

  /** 断言为真。 */
  s.ok = function ok(cond, name) {
    if (cond) {
      s.pass += 1;
      return true;
    }
    s.fail += 1;
    s.failures.push(name);
    console.error("  ❌ " + name);
    return false;
  };

  /**
   * 断言相等。
   *
   * ⚠️ **打印要截断** —— 有的用例会拿几百 KB 的真文件比对，
   *    不截断的话一条失败就把整个文件刷进终端（踩过，输出直接爆掉）。
   */
  s.eq = function eq(a, b, name) {
    const same =
      typeof a === "string" && typeof b === "string" ? a === b : JSON.stringify(a) === JSON.stringify(b);
    return s.ok(same, `${name}（实际 ${brief(a)}，期望 ${brief(b)}）`);
  };

  /** 打印汇总并退出。 */
  s.done = function done() {
    console.log(`\n${label}：${s.pass} 通过, ${s.fail} 失败`);
    if (s.failures.length > 0) {
      console.log("失败项：");
      for (const f of s.failures) console.log("  - " + f);
    }
    process.exit(s.fail === 0 ? 0 : 1);
  };

  return s;
}
