// 语法检查：把每个客户端文件都过一遍 `node --check`。
//
// ⚠️ **不写死文件列表** —— 原来 package.json 里是
//      node --check client.js && node --check client.picker.js && …
//    加一个 chunk 就会漏检，而漏检的表现是「检查通过但那个文件根本没看」。
//    这里按 dsh 的规则自动发现包根下所有 client*.js。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
console.log(`语法检查：${files.length} 个文件，${bad} 个有问题`);
process.exit(bad === 0 ? 0 : 1);
