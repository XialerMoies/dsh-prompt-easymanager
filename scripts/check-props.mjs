/**
 * 检查 chunk 里 `props` 的可见性与转发。
 *
 * 三类问题（都是实际踩过的，而且**都不报错**）：
 *   ① `props.` 在作用域里不可见 —— 函数没接参数
 *   ② 自己收了 props 的函数，**调用点没转发**（扫不出 `props` 字样，得看实参）
 *   ③ 字符串字面量里混进 `props.` / `api.style.` —— 批量替换的典型误伤
 *
 * ⚠️ ② 的实现踩过一次坑：**按行**收集实参会把跨行的其它括号算进来，
 *    于是 25 个假阳性。改成**逐字符**扫整个文件、只在「本层」逗号处切分。
 *
 * 用法：
 *   node scripts/check-props.mjs            # 自动检查包根下所有 client*.js
 *   node scripts/check-props.mjs <文件>      # 只检查一个
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const STRIP = (l) =>
  l
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/.*$/, "");

/** 找函数定义并算它们的行范围。 */
function defsOf(L) {
  const defs = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(\s*)function\s+(\w+)\s*\(([^)]*)\)/);
    if (m) defs.push({ name: m[2], params: m[3], line: i, end: -1 });
  }
  for (const d of defs) {
    let n = 0;
    let begun = false;
    for (let k = d.line; k < L.length; k++) {
      for (const ch of STRIP(L[k])) {
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
  return defs;
}
const hasPropsParam = (d) => /(^|,\s*)props(\s*$|,)/.test(d.params.replace(/\s+/g, " "));

/**
 * 逐字符扫源码，产出所有「函数调用」：{name, start, end, args}
 * args 是**顶层逗号**切开的实参字符串数组。
 */
function callsOf(src) {
  const out = [];
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // 跳过字符串 / 模板 / 正则（粗略）/ 注释
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      // 读一个标识符
      let j = i;
      while (j < n && isId(src[j])) j++;
      const name = src.slice(i, j);
      // 跳过空白看是不是 `(`
      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === "(" && !/^(if|for|while|switch|catch|return|function|typeof|new)$/.test(name)) {
        // 找配对 `)`，顶层切逗号
        const args = [];
        let depth = 1;
        let cur = "";
        let p = k + 1;
        while (p < n && depth > 0) {
          const ch = src[p];
          if (ch === '"' || ch === "'" || ch === "`") {
            const q = ch;
            cur += ch;
            p++;
            while (p < n && src[p] !== q) {
              if (src[p] === "\\") {
                cur += src[p];
                p++;
              }
              cur += src[p];
              p++;
            }
            cur += src[p] ?? "";
            p++;
            continue;
          }
          if ("([{".includes(ch)) {
            depth++;
            if (depth > 1) cur += ch;
          } else if (")]}".includes(ch)) {
            depth--;
            if (depth === 0) {
              args.push(cur);
              break;
            }
            cur += ch;
          } else if (ch === "," && depth === 1) {
            args.push(cur);
            cur = "";
          } else if (depth >= 1) {
            cur += ch;
          }
          p++;
        }
        const line = src.slice(0, i).split("\n").length;
        out.push({ name, line, args: args.map((a) => a.trim()) });
        i = p;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function checkFile(file, label) {
  const raw = readFileSync(file, "utf8");
  const L = raw.split("\n");
  const defs = defsOf(L);
  const problems = [];

  // ① `props.` 不可见
  for (let i = 0; i < L.length; i++) {
    if (!/\bprops\s*\./.test(L[i])) continue;
    if (/^\s*(\*|\/\/)/.test(L[i])) continue;
    const chain = defs.filter((d) => d.line <= i && i <= d.end).sort((a, b) => b.line - a.line);
    if (!chain.some(hasPropsParam)) {
      problems.push({
        line: i + 1,
        what: "props 不可见（函数没接参数）",
        text: L[i].trim().slice(0, 66),
      });
    }
  }

  // ② 收了 props 的函数，调用点要转发
  //
  //    ⚠️ 实参里会有**空字符串尾巴**：多行调用（`foo(\n a,\n b,\n)`）在配对 `)` 之前
  //    会多切出一项空的。不过滤掉的话「最后一项是 props」永远不成立 ——
  //    第一版就是这么漏判的（注入验证时才发现：改坏了还是绿的）。
  const calls = callsOf(raw);
  const takesProps = new Map(defs.filter(hasPropsParam).map((d) => [d.name, d]));
  for (const c of calls) {
    const d = takesProps.get(c.name);
    if (!d) continue;
    const args = c.args.filter((a) => a !== "");
    const last = args[args.length - 1];
    if (last !== "props") {
      problems.push({
        line: c.line,
        what:
          "调用 " + c.name + " 时没转发 props（最后实参是 " + JSON.stringify((last ?? "").slice(0, 22)) + "）",
        text: (L[c.line - 1] || "").trim().slice(0, 66),
      });
    }
  }

  // ③ 字符串字面量里混进 props. / api.style.
  for (let i = 0; i < L.length; i++) {
    for (const m of L[i].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      if (/\bprops\.[a-zA-Z]/.test(m[1]) || /\bapi\.style\./.test(m[1])) {
        problems.push({
          line: i + 1,
          what: "字符串字面量里出现 props./api.style.（批量替换误伤）",
          text: m[1].slice(0, 66),
        });
      }
    }
  }

  console.log(
    "  " +
      (problems.length === 0 ? "✅ " : "❌ ") +
      label.padEnd(30) +
      defs.length +
      " 个函数" +
      (problems.length ? "，" + problems.length + " 个问题" : ""),
  );
  for (const p of problems) console.log("       行 " + p.line + "  " + p.what + "\n         " + p.text);
  return problems;
}

const arg = process.argv[2];
const files = arg
  ? [arg]
  : readdirSync(ROOT)
      .filter((f) => /^client.*\.js$/.test(f))
      .sort();

console.log("props 检查：" + files.length + " 个文件");
let total = 0;
for (const f of files) total += checkFile(arg ? f : join(ROOT, f), f).length;
console.log(total === 0 ? "\n✅ 全部通过" : "\n❌ 共 " + total + " 个问题");
process.exit(total === 0 ? 0 : 1);
