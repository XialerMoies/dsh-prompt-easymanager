/**
 * 检查 chunk 里 `props` 的可见性。
 *
 * 规则：`props` 要么是所在函数的**参数**，要么在外层某个函数的**参数**里
 *       （闭包可见）。否则就是 `props is not defined`。
 *
 * ⚠️ 这个坑踩了三次（sections / combo / library），所以写成脚本而不是靠眼睛。
 */
import fs from "node:fs";

const file = process.argv[2] || "client.editor.library.js";
const L = fs.readFileSync(file, "utf8").split("\n");

// 找出所有函数定义（含嵌套），建立 行号 → {name, params, depth}
const defs = [];
for (let i = 0; i < L.length; i++) {
  const m = L[i].match(/^(\s*)function\s+(\w+)\s*\(([^)]*)\)/);
  if (!m) continue;
  const indent = m[1].length;
  defs.push({ name: m[2], params: m[3], indent, line: i, end: -1 });
}
// 算结束行（大括号配平）
const strip = (l) =>
  l
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/.*$/, "");
for (const d of defs) {
  let n = 0;
  let begun = false;
  for (let k = d.line; k < L.length; k++) {
    for (const ch of strip(L[k])) {
      if (ch === "{") {
        n++;
        begun = true;
      } else if (ch === "}") n--;
    }
    if (begun && n === 0) {
      d.end = k;
      break;
    }
  }
}
const hasPropsParam = (d) => /(^|,\s*)props(\s*$|,)/.test(d.params.replace(/\s+/g, " "));

// 对每一处 `props.` 找到最内层包含它的函数，再看作用域链上有没有 props 参数
const problems = [];
for (let i = 0; i < L.length; i++) {
  if (!/\bprops\s*\./.test(L[i])) continue;
  if (/^\s*(\*|\/\/)/.test(L[i])) continue; // 注释
  const chain = defs.filter((d) => d.line <= i && i <= d.end).sort((a, b) => b.line - a.line);
  const visible = chain.some(hasPropsParam);
  if (!visible) {
    problems.push({
      line: i + 1,
      fn: chain.length ? chain[0].name : "(顶层)",
      text: L[i].trim().slice(0, 66),
    });
  }
}

console.log("文件：" + file);
console.log("函数定义 " + defs.length + " 个");
console.log("");
if (problems.length === 0) {
  console.log("✅ 没有 `props` 不可见的用法");
} else {
  console.log("❌ 有 " + problems.length + " 处 `props` 在作用域里不可见：");
  for (const p of problems) console.log("   行 " + p.line + "  [" + p.fn + "]  " + p.text);
}
// 另外：哪些函数用了 props 但自己没接参数（可能靠闭包，也列出来供参考）
console.log("");
console.log("用了 props 但自己没接参数的函数（靠闭包可见就没问题）：");
let listed = 0;
for (const d of defs) {
  if (d.end < 0) continue;
  if (d.name === "create") continue; // 它收 api，不收 props；注释里提到不算
  // ⚠️ 只看**代码行**，注释里的 props 不算。
  const seg = L.slice(d.line, d.end + 1)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  if (/\bprops\s*\./.test(seg) && !hasPropsParam(d)) {
    const outer = defs.filter((o) => o !== d && o.line < d.line && d.end <= o.end && hasPropsParam(o));
    console.log(
      "   " + d.name.padEnd(18) + (outer.length ? "（闭包来自 " + outer[0].name + "）" : "  ❌ 没有任何外层提供"),
    );
    listed += 1;
  }
}
if (listed === 0) console.log("   （没有 —— 每个用 props 的函数都自己接了参数）");
process.exit(problems.length === 0 ? 0 : 1);
