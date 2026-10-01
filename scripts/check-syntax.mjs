// 语法检查：把每个客户端文件都过一遍 `node --check`。
//
// ⚠️ **不写死文件列表** —— 原来 package.json 里是
//      node --check client.js && node --check client.picker.js && …
//    加一个 chunk 就会漏检，而漏检的表现是「检查通过但那个文件根本没看」。
//    这里按 dsh 的规则自动发现包根下所有 client*.js。
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "index.js",
  ...readdirSync(ROOT)
    .filter((f) => /^client.*\.js$/.test(f))
    .sort(),
  // 其余参与运行的脚本（测试与工具）
  ...readdirSync(join(ROOT, "scripts"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => join("scripts", f)),
  ...readdirSync(join(ROOT, "scripts", "lib"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => join("scripts", "lib", f)),
];

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("✗ " + f);
    bad += 1;
  }
}

// ── 行尾检查：不许出现 `\r\r\n` ─────────────────────────────────────────────
//
// ⚠️ **`node --check` 抓不到这个**，所以单独查。
//
//    成因：按 `\n` 切开一个 CRLF 文件时，每段末尾**本来就带着 `\r`**；
//    如果这时又 `join("\r\n")` 写回去，就变成 `\r\r\n`。
//    踩过：一个测试文件被写坏 **1396 行**（双 CR），语法照样过，但
//        · 任何按行比对的锚点全都对不上（`includes` 永远 false）
//        · 行号在 `Select-String` 和编辑器之间**对不上**（差得很远）
//        · git diff 整片变红
//    排查花了一轮才想到是行尾，所以钉在这里。
let eolBad = 0;
for (const f of files) {
  const text = readFileSync(join(ROOT, f), "utf8");
  const n = (text.match(/\r\r\n/g) || []).length;
  if (n > 0) {
    console.error("✗ " + f + "：有 " + n + " 处 `\\r\\r\\n`（双 CR）");
    eolBad += 1;
    bad += 1;
  }
}
console.log(
  `语法检查：${files.length} 个文件，${bad} 个有问题` +
    (eolBad ? `（其中 ${eolBad} 个是行尾问题）` : ""),
);
process.exit(bad === 0 ? 0 : 1);
