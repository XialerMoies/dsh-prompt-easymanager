/**
 * 投稿前自查：把 `scripts/awesome-entry.yml` 里**每一句话**对着代码核一遍。
 *
 * ═══ 这个脚本是干什么的 ═══
 *
 * 投稿指南明说：「描述必须属实，会被逐句对着代码核」，
 * 而且「夸大是让一个本来不错的插件被打回的主要原因」。
 * 所以它的用途是**拦住我自己** —— 描述里说的每件事，代码里都得真有。
 *
 * ═══ 判据的设计（改过三次，记下来免得再走弯路）═══
 *
 * ⚠️ **非对称的**：指南没有「必须声称所有功能」这一条，它要求的是
 *    「**说出来的都得是真的**」。所以：
 *
 *      声称了某能力 + 代码里没有  →  ❌ 不实（要拦）
 *      声称了某能力 + 代码里有    →  ✔
 *      **没声称**某能力           →  ✔ 不算错（只是没提）
 *
 *    第一版不是这样：它要求「描述里必须提到段落数 / preview / replace...」，
 *    于是你把描述改得简短一点就一堆假红 —— 而那些描述其实完全属实。
 *
 * ⚠️ 措辞不固定：判据要卡在「**声明的粒度**」上。
 *    · 太窄（写成 `/per session or globally/`）→ 描述换个说法就假红
 *    · 太宽（写成 `/preset/`）→ 删掉「存成预设」这个声明也红不了（实测过）
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

// ── 描述里的声明，对着代码核（非对称：没声称不算错）────────────────────
console.log("");
console.log("═══ 描述里的声明（声称了就必须真）═══");

const slots = await import(pathToFileURL(path.join(ROOT, "scripts/lib/section-slots.mjs")).href);
const ov = await import(pathToFileURL(path.join(ROOT, "scripts/lib/section-overrides.mjs")).href);
const idx = read("index.js");
const clip = read("client.js");

/** 「某能力被声称了吗」—— 中英任一版提到就算。 */
const claims = (re) => re.test(en) || re.test(zh);

/**
 * 一条声明：`描述里怎么算声称` → `去代码哪儿找证据`。
 *
 * ⚠️ 加新声明时**两条都要写清楚**，别只写一半 ——
 *    只写「声称」不写「证据」的话，这个表就成了摆设。
 */
const CLAIMS = [
  {
    label: "段落数",
    said: () => /\b(\d+)\s+(?:named\s+)?sections\b/i.test(en) || /(\d+)\s*个(?:具名)?段落/.test(zh),
    verify: () => {
      // 抠出数字，逐个跟代码对
      const nums = [];
      for (const m of en.matchAll(/\b(\d+)\s+(?:named\s+)?sections\b/gi)) nums.push(["en", Number(m[1])]);
      for (const m of zh.matchAll(/(\d+)\s*个(?:具名)?段落/g)) nums.push(["zh", Number(m[1])]);
      const wrong = nums.filter(([, n]) => n !== slots.SECTION_SLOTS.length);
      return {
        pass: wrong.length === 0,
        detail: nums.map(([l, n]) => l + "=" + n).join(", ") + " vs 代码 " + slots.SECTION_SLOTS.length,
      };
    },
  },
  {
    label: "改写 / 关闭段落",
    said: () => claims(/replace|disable|rewrite/i) || claims(/改写|关闭/),
    verify: () => ({
      pass: ov.OVERRIDE_ACTIONS.includes("replace") && ov.OVERRIDE_ACTIONS.includes("disable"),
      detail: "OVERRIDE_ACTIONS=" + JSON.stringify(ov.OVERRIDE_ACTIONS),
    }),
  },
  {
    label: "存成预设",
    // ⚠️ 不能只写 `/preset|预设/` —— 那个词描述里到处都有（"applies one preset"），
    //    于是删掉「存成预设」这个声明也红不了。要卡在**这个声明**的粒度上。
    said: () => claims(/as a preset|save[ds]? (?:the|it as|them as)|存成预设|存为预设/i),
    verify: () => ({
      pass: /normalizePresets|capturePreset/.test(idx),
      detail: "index.js 有 normalizePresets / capturePreset",
    }),
  },
  {
    label: "个人提示词",
    said: () => claims(/personal prompts?/i) || claims(/个人提示词/),
    verify: () => {
      const pre = read("scripts/lib/presets.mjs");
      return { pass: /prompts/.test(pre), detail: "预设里有 prompts 字段" };
    },
  },
  {
    label: "修改系统提示词",
    said: () => claims(/system[- ]prompt (?:edit|change|modif)/i) || claims(/修改系统提示词|系统提示词改动/),
    verify: () => {
      const pre = read("scripts/lib/presets.mjs");
      return { pass: /sections/.test(pre), detail: "预设里有 sections 字段" };
    },
  },
  {
    label: "全局范围",
    said: () => claims(/\bglobal\b/i) || claims(/全局/),
    verify: () => ({
      pass: /global/i.test(idx) && /presetId/.test(idx),
      detail: "index.js 有 global.presetId",
    }),
  },
  {
    label: "单独会话",
    said: () => claims(/session/i) || claims(/会话/),
    verify: () => ({ pass: /assignments/.test(idx), detail: "index.js 有 assignments" }),
  },
  {
    label: "预览",
    said: () => claims(/preview/i) || claims(/预览/),
    verify: () => ({ pass: /assemble/.test(idx), detail: "index.js 真的调 assemble()" }),
  },
];

for (const c of CLAIMS) {
  if (!c.said()) {
    console.log("  ○ " + c.label + "：描述里没声称（不算错，只是没提）");
    continue;
  }
  const r = c.verify();
  ok(r.pass, "声称了「" + c.label + "」→ **代码里真有**", r.detail);
}

// 反向也要核一条：描述**不许声称**我们往草稿塞文字
// —— 那会跟列表里 13 个「塞文字」的同类插件混淆，而我们确实不做这件事。
//
// ⚠️ **判据怎么写的，以及它的边界**：
//
//    一开始我枚举动词（`insert …` / `fill …`），结果 `Fills saved prompts
//    into the composer` 认不出来 —— 中间隔了词。**枚举动词永远枚举不完。**
//
//    改成「写入动作 + 任意内容 + 草稿/输入框」之后覆盖面够了。
//    但它终究是**按关键词认的** —— 换个完全不提「草稿/输入框」的说法
//    （比如「把它变成你消息的一部分」）还是可能漏。
//
//    为什么还留着：它拦得住**直白的**错误声称，比没有强。
//    而真正的保证是**我不去那么写** —— 这个脚本只是最后一道网。
const DRAFT_WORDS = String.raw`(?:draft|composer|input box|输入框|草稿|对话框)`;
const DRAFT_VERBS = String.raw`(?:insert|fill|put|paste|drop|add|inject|write|place|填|插|塞|写)`;
const saysDraft =
  new RegExp(DRAFT_VERBS + String.raw`[^.]{0,60}?` + DRAFT_WORDS, "i").test(en) ||
  new RegExp(DRAFT_VERBS + String.raw`[^。]{0,30}?` + DRAFT_WORDS, "i").test(zh);
const insertsIntoDraft = /draft\.insert|composer\.insert|insertText\(/.test(clip);
ok(!saysDraft || insertsIntoDraft, "没有声称「往草稿里塞文字」（客户端确实不做这件事）");

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
console.log(bad === 0 ? "✅ 全部核实通过（描述里说的都是真的）" : "❌ " + bad + " 条不实 —— 去改 entry 或代码");
process.exit(bad === 0 ? 0 : 1);
