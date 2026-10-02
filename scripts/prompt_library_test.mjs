// 提示词库测试：目录解析、模式校验、正文来源、错误收集
// 运行：node scripts/prompt_library_test.mjs
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("提示词库测试");
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPromptLibrary,
  escapeTemplateBraces,
  estimateTokens,
  CATEGORIES,
  suggestedOrder,
} from "./lib/prompt-library.mjs";


const dir = mkdtempSync(join(tmpdir(), "pm-lib-"));
const promptsDir = join(dir, "prompts");
mkdirSync(promptsDir, { recursive: true });
writeFileSync(join(promptsDir, "a.md"), "# A\n正文甲\n");
writeFileSync(join(promptsDir, "braces.md"), "变量 {{cwd}} 与 {{自定义}}\n");

const catalogPath = join(promptsDir, "catalog.json");
function writeCatalog(obj) {
  writeFileSync(catalogPath, JSON.stringify(obj, null, 2));
}

// ── 1. 正常解析 ──────────────────────────────────────────────────────────────
writeCatalog({
  version: 1,
  prompts: [
    { id: "none", name: "不注入", mode: "none" },
    { id: "a", name: "甲", description: "d", mode: "append", order: 100, file: "a.md" },
    { id: "b", name: "乙", mode: "append", order: 10, inline: "内联正文" },
  ],
});
let lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 3, "解析出 3 条");
eq(lib.errors(), [], "无错误");
ok(lib.resolve("a").text.includes("正文甲"), "file 来源正文可读");
eq(lib.resolve("b").text, "内联正文", "inline 来源正文可读");
eq(lib.resolve("b").mode, "append", "append 模式保留");
eq(lib.resolve("a").sectionName, "prompt-manager:a", "section 名由 id 派生");
eq(lib.resolve("none").text, "", "none 模式正文为空");
ok(lib.has("a") && !lib.has("zzz"), "has() 正确");

// list() 不含正文，但含 token/字符数
const listed = lib.list();
eq(listed.length, 3, "list() 返回 3 条");
ok(listed.every((p) => p.text === undefined), "list() 不返回正文");
ok(listed.find((p) => p.id === "a").tokens > 0, "list() 带 token 估算");

// ── 2. 错误收集（不抛错） ────────────────────────────────────────────────────
writeCatalog({
  prompts: [
    { id: "ok1", mode: "append", inline: "x" },
    { id: "", mode: "append", inline: "x" },
    { id: "bad mode", mode: "append", inline: "x" },
    { id: "nomode", mode: "whatever", inline: "x" },
    { id: "nobody", mode: "append" },
    { id: "missingfile", mode: "append", file: "不存在.md" },
    { id: "old-replace", mode: "replace", inline: "x" },
    { id: "ok1", mode: "append", inline: "重复 id" },
    "不是对象",
  ],
});
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 1, "只有 1 条合法条目");
eq(lib.errors().length, 8, "收集到 8 条错误");
ok(
  lib.errors().some((e) => e.includes("id 非法")),
  "错误里有 id 非法",
);
// 已删除的 replace 模式要给专门的迁移提示，而不是混在「mode 非法」里
{
  const repErr = lib.errors().find((e) => e.includes("old-replace"));
  ok(!!repErr, "replace 条目报错");
  ok(repErr.includes("已移除的 replace"), "说明该模式已被移除");
  ok(repErr.includes('改成 "append"'), "给出具体的迁移动作");
}
ok(
  lib.errors().some((e) => e.includes("mode 非法")),
  "错误里有 mode 非法",
);
ok(
  lib.errors().some((e) => e.includes("缺少 file 或 inline")),
  "错误里有缺正文来源",
);
ok(
  lib.errors().some((e) => e.includes("读正文失败")),
  "错误里有文件读取失败",
);
ok(
  lib.errors().some((e) => e.includes("id 重复")),
  "错误里有 id 重复",
);

// catalog.json 里的 file 字段不可信，读取也必须拒绝越出 prompts/。
writeFileSync(join(dir, "outside.md"), "不应被读取");
writeCatalog({ prompts: [{ id: "escape", mode: "append", file: "../outside.md" }] });
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 0, "越界正文不加载");
ok(lib.errors().some((e) => e.includes("之外")), "越界读取错误说明目录边界");

// ── 3. catalog 本身坏掉 ──────────────────────────────────────────────────────
writeFileSync(catalogPath, "{ 这不是 JSON");
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 0, "坏 JSON → 0 条");
ok(lib.errors()[0].includes("读取"), "坏 JSON 有可读错误");

writeCatalog({ version: 1 });
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 0, "缺 prompts 数组 → 0 条");
ok(
  lib.errors().some((e) => e.includes("没有 prompts 数组")),
  "缺 prompts 数组有错误说明",
);

// ── 4. reload() ─────────────────────────────────────────────────────────────
writeCatalog({ prompts: [{ id: "one", mode: "none" }] });
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
eq(lib.size(), 1, "reload 前 1 条");
writeCatalog({
  prompts: [
    { id: "one", mode: "none" },
    { id: "two", mode: "append", inline: "x" },
  ],
});
const r = lib.reload();
eq(r.count, 2, "reload 返回 2 条");
eq(lib.size(), 2, "reload 后生效");
eq(lib.errors(), [], "reload 后错误清空");

// ── 5. 花括号转义 ───────────────────────────────────────────────────────────
eq(escapeTemplateBraces("{{cwd}}"), "{{cwd}}", "内置变量 cwd 不转义");
eq(escapeTemplateBraces("{{model}}"), "{{model}}", "内置变量 model 不转义");
eq(escapeTemplateBraces("{{provider}}"), "{{provider}}", "内置变量 provider 不转义");
eq(escapeTemplateBraces("{{自定义}}"), "{ {自定义}}", "非内置变量被转义");
writeCatalog({ prompts: [{ id: "br", mode: "append", file: "braces.md" }] });
lib = createPromptLibrary({ catalogPath, baseDir: promptsDir });
ok(lib.resolve("br").text.includes("{{cwd}}"), "文件内的内置变量保持原样");
ok(lib.resolve("br").text.includes("{ {自定义}}"), "文件内的非内置变量被转义");

// ── 6. token 估算 ───────────────────────────────────────────────────────────
// 口径：CJK 1 字 = 1 token，其余每 4 个字符 = 1 token（向上取整）。
// 注意空格也算"其余字符"，所以带空格与不带空格的结果不同。
eq(estimateTokens(""), 0, "空串 0 token");
eq(estimateTokens("abcd"), 1, "4 个英文 = 1 token");
eq(estimateTokens("abcdefgh"), 2, "8 个英文 = 2 token");
eq(estimateTokens("中文"), 2, "2 个中文 = 2 token");
eq(estimateTokens("中文abcd"), 3, "中英紧邻 = 2 + 1");
eq(estimateTokens("中文 abcd"), 4, "含空格：2 个 CJK + 5 个其余字符 → 2 + 1.25 → 4");
ok(estimateTokens("中".repeat(100)) === 100, "100 个中文 = 100 token");

// ── 7. 分类（category）──────────────────────────────────────────────────────
{
  // 内置分类表：五类，各带建议 order，且 order 互不相同
  eq(CATEGORIES.length, 5, "内置 5 类");
  eq(
    CATEGORIES.map((c) => c.id),
    ["identity", "domain", "tool", "output", "other"],
    "分类 id 与顺序",
  );
  ok(
    CATEGORIES.every((c) => typeof c.name === "string" && c.name && typeof c.hint === "string"),
    "每类都有 name 与 hint",
  );
  const orders = CATEGORIES.map((c) => c.order);
  eq(new Set(orders).size, orders.length, "建议 order 互不相同");

  // 建议 order 的**值**。
  //
  // ⚠️ 这里只钉住数字本身。**「有没有跟 dsh 原生 section 撞车」不在这里测** ——
  //    那组断言在 section_order_test.mjs 里，它拿 dsh 真实的 SECTION_ORDERS
  //    逐个比对。改这里的数字之前先跑那个测试。
  //
  //    踩过的坑：v0.4.0 里 domain=500（撞 PLAN_POLICY）、tool=3000（撞 TOOL_COMPUTER_USE），
  //    而当时这里写的是「领域在 file-reference(900) 之前」这种**区间断言** ——
  //    话没说错，但没问一句「那 500 是不是正好等于别人」，所以没拦住。
  eq(suggestedOrder("identity"), 20, "身份的建议 order");
  eq(suggestedOrder("domain"), 950, "领域的建议 order");
  eq(suggestedOrder("tool"), 3200, "工具的建议 order");
  eq(suggestedOrder("output"), 9500, "输出的建议 order");
  eq(suggestedOrder("other"), 100, "其他用通用位置");
  eq(suggestedOrder("我自己起的分类"), null, "自定义分类没有建议 order");

  // 读取：有 category 就用，没有就落到 other（老目录不用改）
  writeCatalog({
    prompts: [
      { id: "withcat", mode: "append", category: "tool", inline: "x" },
      { id: "nocat", mode: "append", inline: "y" },
      { id: "emptycat", mode: "append", category: "   ", inline: "z" },
      { id: "customcat", mode: "append", category: "安全审查", inline: "w" },
      { id: "badcat", mode: "append", category: 123, inline: "v" },
    ],
  });
  const l = createPromptLibrary({ catalogPath, baseDir: promptsDir });
  eq(l.size(), 5, "五条都加载（分类不影响合法性）");
  eq(l.resolve("withcat").category, "tool", "读出 category");
  eq(l.resolve("nocat").category, "other", "缺 category → other");
  eq(l.resolve("emptycat").category, "other", "空白 category → other");
  eq(l.resolve("customcat").category, "安全审查", "自定义分类原样保留");
  eq(l.resolve("badcat").category, "other", "非字符串 category → other");
  eq(l.errors(), [], "分类问题不产生错误");

  // list() 要带上 category（UI 靠它分组）
  const items = l.list();
  eq(items.length, 5, "list() 五条");
  ok(items.every((p) => typeof p.category === "string" && p.category), "list() 每条都带 category");
  eq(items.find((p) => p.id === "customcat").category, "安全审查", "list() 保留自定义分类");
}

rmSync(dir, { recursive: true, force: true });

done();
