/**
 * 把 client.js 的 mtime 顶到现在。
 *
 * ── 为什么需要这个 ─────────────────────────────────────────────────────────
 *
 * dsh 给插件资源的缓存头是 `public, max-age=31536000, immutable`（一年），
 * 而 chunk 的 URL 长这样：`/plugins/<id>/client.editor.js?rev=<rev>`，
 * 其中 `rev = sha1(client.js 的 mtimeMs + ctimeMs + size)`。
 *
 * ⚠️ **rev 只跟 client.js 走，不看任何 chunk。**（dsh-client-modules:
 *    `artifactRevision(baseline)` / `captureArtifactBaseline(clientPath)`）
 *
 * 后果：只改 client.editor.js / client.picker.js / client.preview.js 而不动
 * client.js 时，rev 不变 → chunk URL 不变 → 浏览器直接用手里那份旧模块，
 * 改动根本不生效。表现是「明明改了、重启了、刷新了，界面还是老样子」。
 *
 * 这个脚本不写内容，只 `utimes` 一下 —— rev 里含 mtime，所以必然变号，
 * 旧 URL 404、浏览器被迫取新的。发版前 / 改完 chunk 后跑一次就行。
 *
 * 用法：node scripts/bump-client-rev.mjs
 */
import { readdirSync, statSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 宿主 bundle —— rev 就是它的元数据算出来的。 */
const HOST = join(ROOT, "client.js");

/** 包内 chunk（`client.<name>.js`，不含宿主自己）。 */
export function listChunks(root = ROOT) {
  return readdirSync(root)
    .filter((f) => /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(f))
    .map((f) => join(root, f));
}

/**
 * chunk 里最晚的一个 mtime 比宿主新多少毫秒（负数 = 宿主更新，安全）。
 *
 * 这是**发版前该看的那个数**：> 0 就意味着「改了 chunk 但 rev 没跟着动」。
 */
export function staleness(root = ROOT) {
  const host = statSync(join(root, "client.js")).mtimeMs;
  let newest = 0;
  let who = null;
  for (const f of listChunks(root)) {
    const t = statSync(f).mtimeMs;
    if (t > newest) {
      newest = t;
      who = f;
    }
  }
  return { delta: newest - host, newestChunk: who };
}

function main() {
  const { delta, newestChunk } = staleness();
  if (delta <= 0) {
    console.log("chunk 都不比 client.js 新，rev 不会失效，不用动。");
  }
  const now = new Date();
  // atime 保持原值不动（只改 mtime）
  utimesSync(HOST, now, now);
  console.log(
    `已顶 client.js 的 mtime 到 ${now.toISOString()}` +
      (newestChunk ? `（最新的 chunk 是 ${newestChunk.split(/[\\/]/).pop()}，比它新 ${Math.round(delta / 1000)}s）` : ""),
  );
  console.log("重启 dsh 之后，chunk 的 ?rev= 就会变号，浏览器会取新的。");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
