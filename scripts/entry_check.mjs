/**
 * 投稿前自查：把 `scripts/awesome-entry.yml` 里**每一句话**对着代码核一遍。
 *
 * ⚠️ 投稿指南明说：「描述必须属实，会被逐句对着代码核」，
 *    而且「夸大是让一个本来不错的插件被打回的主要原因」。
 *    所以这个脚本的作用是**拦住我自己**：写进描述里的每个数字、
 *    每个 API 名字，都得在代码里找得到。
 *
 * ⚠️ 顺带核对截图声明 —— 指南警告过「声明了不存在的图 = 静默烂掉」
 *    （已发布的 773 张截图里有 41 张就是这样变成 404 的）。
 *
 * 用法：node scripts/entry_check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

let bad = 0;
const ok = (cond, label, detail) => {
  console.log("  " + (cond ? "✔" : "❌") + " " + label + (detail ? "   → " + detail : ""));
  if (!cond) bad++;
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── 读条目文件 ─────────────────────────────────────────────────────────
const entryRaw = read("scripts/awesome-entry.yml");
const yaml = entryRaw.split(/^---$/m).pop().trim();

function field(name) {
  const m = new RegExp("^" + name + ":\\s*(.+)$", "m").exec(yaml);
  return m ? m[1].trim() : null;
}
function descField(lang) {
  const m = new RegExp("^\\s{2}" + lang + ":\\s*(.+)$", "m").exec(yaml);
  return m ? m[1].trim().replace(/^'|'$/g, "") : null;
}

const url = field("url");
const name = field("name");
const category = field("category");
const tarball = field("tarball");
const en = descField("en");
const zh = descField("zh");

console.log("═══ 条目文件本身的格式 ═══");
ok(!!url, "有 url");
ok(!!name, "有 name");
ok(!!category, "有 category");
ok(!!en, "有 description.en（唯一必填的描述字段）");
ok(!!zh, "有 description.zh（可选，但不写维护者要补）");
ok(!/^\s*(npm|screenshots):/m.test(yaml), "**没有手写 `npm:` 键**（指南说会被校验拒绝）");

ok(url === "https://github.com/XialerMoies/dsh-prompt-easymanager", "url 跟仓库一致", url);
ok(name === "XialerMoies/dsh-prompt-easymanager", "name 是 owner/repo 形态", name);

const CATEGORIES = "agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun".split(" ");
ok(CATEGORIES.includes(category), "category 在允许取值里", category);

ok(/\.$/.test(en), "en 以句号结尾");
const sentences = en.split(/\.\s+/).filter((s) => s.trim());
ok(sentences.length === 1, "en 只有一句话", String(sentences.length) + " 句");
const MARKETING = ["best", "powerful", "amazing", "seamless", "revolutionary", "ultimate", "perfect", "easy to use", "强大", "最好", "完美", "极致"];
const hitMkt = MARKETING.filter((w) => new RegExp(w, "i").test(en + " " + zh));
ok(hitMkt.length === 0, "没有营销词", hitMkt.join(", ") || "干净");

if (tarball) {
  ok(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v[\d.]+\/.+\.tgz$/.test(tarball),
    "tarball 是「钉住标签」的 github.com https .tgz", tarball);
  ok(!/latest\/download/.test(tarball), "**没有用 `latest/download/`**（文件名带版本号会烂掉）");
  const fname = tarball.split("/").pop();
  const pkg0 = JSON.parse(read("package.json"));
  ok(fname.includes(pkg0.version), "tarball 文件名里的版本跟 package.json 一致", fname + " vs " + pkg0.version);
}

// ── 描述里的每个声明，对着代码核 ──────────────────────────────────────
console.log("");
console.log("═══ 描述里的声明 ═══");

const slots = await import(pathToFileURL(path.join(ROOT, "scripts/lib/section-slots.mjs")).href);
const ov = await import(pathToFileURL(path.join(ROOT, "scripts/lib/section-overrides.mjs")).href);
const idx = read("index.js");
const cli = read("client.js");

const m32 = /\b(\d+)\s+native sections\b/i.exec(en);
ok(!!m32, "en 里写了段落数", m32 ? m32[1] : "（没写）");
if (m32) {
  ok(
    Number(m32[1]) === slots.SECTION_SLOTS.length,
    "  **段落数对得上代码**",
    m32[1] + " vs SECTION_SLOTS.length=" + slots.SECTION_SLOTS.length,
  );
}
const m32zh = /(\d+)\s*个原生段落/.exec(zh);
ok(!!m32zh && m32zh[1] === (m32 ? m32[1] : ""), "中英两版的数字一致", m32zh ? m32zh[1] : "（没写）");

ok(/replace or disable/i.test(en), "en 里写了 replace/disable");
ok(
  ov.OVERRIDE_ACTIONS.includes("replace") && ov.OVERRIDE_ACTIONS.includes("disable"),
  "  **两个动作代码里都有**",
  JSON.stringify(ov.OVERRIDE_ACTIONS),
);

ok(/per session or globally/i.test(en), "en 里写了「按会话或全局」");
ok(/assignments/.test(idx), "  代码里有 assignments（按会话）");
ok(/global/i.test(idx) && /presetId/.test(idx), "  代码里有 global.presetId（全局）");

ok(/preview/i.test(en), "en 里写了 preview");
ok(/assemble/.test(idx), "  代码里真的调 assemble()");

const insertsIntoDraft = /draft\.insert|composer\.insert|insertText/.test(cli);
ok(!insertsIntoDraft, "**确实不往草稿里塞文字**（「rather than the conversation」这句成立）");

ok(/preset/i.test(en), "en 里写了 preset");
ok(/normalizePresets|capturePreset/.test(idx), "  代码里真的有预设模型");

// ── 截图声明 ───────────────────────────────────────────────────────────
console.log("");
console.log("═══ 截图声明（可选，但声明了就必须存在）═══");
if (!fs.existsSync(path.join(ROOT, "screenshots.json"))) {
  ok(true, "没声明 screenshots.json（可选，市场会从 README 抽）");
} else {
  const raw = JSON.parse(read("screenshots.json"));
  const list = Array.isArray(raw) ? raw : raw.screenshots;
  ok(Array.isArray(list), "screenshots.json 是数组（或 {screenshots: [...]}）");
  ok(list.length >= 1 && list.length <= 8, "1–8 张", String(list.length) + " 张");
  const escaping = list.filter((p) => p.startsWith("/") || p.includes(".."));
  ok(escaping.length === 0, "**没有跳出仓库的路径**（不能 `/` 开头、不能含 `..`）", escaping.join(", "));
  const missing = list.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  ok(
    missing.length === 0,
    "**声明的图都真的在仓库里**（不存在的会变成 404）",
    missing.length ? "缺：" + missing.join(", ") : "都在",
  );
}

// ── 仓库层面的硬性要求 ─────────────────────────────────────────────────
console.log("");
console.log("═══ 仓库层面的要求 ═══");
const pkg = JSON.parse(read("package.json"));
ok(!!pkg.dsh?.bundle?.patch, "**声明了 dsh.bundle**（最常见的被拒原因）");
ok(fs.existsSync(path.join(ROOT, pkg.dsh.bundle.patch)), "  patch 文件在");
ok(!!pkg.dsh?.client, "声明了 dsh.client（带前端 UI）");
const patchTxt = read(pkg.dsh.bundle.patch);
ok(patchTxt.includes("id: " + pkg.dsh.id), "  patch 里的 id 对", pkg.dsh.id);
ok(patchTxt.includes("name: " + pkg.name), "  patch 里的 name 对", pkg.name);
ok(fs.existsSync(path.join(ROOT, "LICENSE")), "有 LICENSE");
ok(fs.existsSync(path.join(ROOT, "README.md")), "有 README");

console.log("");
console.log("═══ 还需要人工在 GitHub 上做的 ═══");
console.log("  □ 仓库加 `dsh-plugin` topic");
console.log("  □ 建 Release v" + pkg.version + "，把 dsh-prompt-easymanager-" + pkg.version + ".tgz 传上去");
console.log("  □ 开 PR，加 data/plugins/XialerMoies__dsh-prompt-easymanager.yml");

console.log("");
console.log(bad === 0 ? "✅ 全部核实通过" : "❌ " + bad + " 条不实 —— 去改 entry 或代码");
process.exit(bad === 0 ? 0 : 1);
