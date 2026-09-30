// 提示词写入（编辑器后端）测试
// 运行：node scripts/prompt_store_test.mjs
import { createPromptStore, createPromptLibrary } from "./lib/prompt-library.mjs";
import { createSuite } from "./lib/test-harness.mjs";

const { ok, eq, done } = createSuite("写入测试");
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "pm-store-"));
  const pd = join(dir, "prompts");
  mkdirSync(pd, { recursive: true });
  const catalogPath = join(pd, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify({
      version: 1,
      prompts: [
        { id: "keep", name: "保留", mode: "none" },
        { id: "inline-one", name: "内联", mode: "append", order: 100, inline: "内联正文" },
        { id: "file-one", name: "文件", mode: "append", order: 200, file: "file-one.md" },
      ],
    }),
  );
  writeFileSync(join(pd, "file-one.md"), "文件正文");
  const store = createPromptStore({ catalogPath, baseDir: pd });
  const lib = createPromptLibrary({ catalogPath, baseDir: pd });
  return { dir, pd, catalogPath, store, lib };
}

// ── 1. 新增 ─────────────────────────────────────────────────────────────────
{
  const { pd, store, lib } = fresh();
  const r = store.save({ id: "new1", name: "新的", description: "说明", mode: "append", order: 150, text: "正文甲" });
  eq(r.ok, true, "新增成功");
  eq(r.created, true, "标记为新建");
  ok(existsSync(join(pd, "new1.md")), "正文写成了文件");
  eq(readFileSync(join(pd, "new1.md"), "utf8"), "正文甲", "文件内容正确");
  lib.reload();
  eq(lib.size(), 4, "库里有 4 条");
  const e = lib.resolve("new1");
  eq(e.name, "新的", "名字正确");
  eq(e.order, 150, "order 正确");
  eq(e.text, "正文甲", "正文可读");
  eq(e.mode, "append", "模式正确");
}

// ── 2. 更新已存在的 ─────────────────────────────────────────────────────────
{
  const { pd, store, lib } = fresh();
  store.save({ id: "file-one", name: "改过的名字", mode: "append", order: 999, text: "改过的正文" });
  lib.reload();
  eq(lib.resolve("file-one").name, "改过的名字", "名字被更新");
  eq(lib.resolve("file-one").order, 999, "order 被更新");
  eq(readFileSync(join(pd, "file-one.md"), "utf8"), "改过的正文", "正文文件被覆盖");
  eq(lib.size(), 3, "条数不变（是更新不是新增）");
}

// ── 3. inline → 文件 ────────────────────────────────────────────────────────
{
  const { pd, store, lib } = fresh();
  store.save({ id: "inline-one", name: "内联", mode: "append", order: 100, text: "转成文件了" });
  lib.reload();
  ok(existsSync(join(pd, "inline-one.md")), "inline 条目改成文件形态");
  eq(lib.resolve("inline-one").text, "转成文件了", "正文来自新文件");
  const raw = JSON.parse(readFileSync(join(pd, "catalog.json"), "utf8"));
  const e = raw.prompts.find((x) => x.id === "inline-one");
  eq(e.file, "inline-one.md", "目录里写成 file");
  eq(e.inline, undefined, "不再有 inline 字段");
}

// ── 4. 改成 none：正文文件要清掉 ────────────────────────────────────────────
{
  const { pd, store, lib } = fresh();
  const r = store.save({ id: "file-one", name: "文件", mode: "none", order: 200 });
  eq(r.ok, true, "改成 none 成功");
  ok(!existsSync(join(pd, "file-one.md")), "旧的正文文件被删掉，不留孤儿");
  lib.reload();
  eq(lib.resolve("file-one").text, "", "none 模式正文为空");
}

// ── 5. 删除 ─────────────────────────────────────────────────────────────────
{
  const { pd, store, lib } = fresh();
  const r = store.remove("file-one");
  eq(r.ok, true, "删除成功");
  eq(r.fileRemoved, true, "报告删掉了正文文件");
  ok(!existsSync(join(pd, "file-one.md")), "文件确实没了");
  lib.reload();
  eq(lib.size(), 2, "库剩 2 条");
  ok(!lib.has("file-one"), "删掉的条目查不到");
  // 删不存在的
  eq(store.remove("不存在").ok, false, "删不存在的返回失败");
}

// ── 6. 非法输入 ─────────────────────────────────────────────────────────────
{
  const { store } = fresh();
  eq(store.save({ id: "", mode: "append" }).ok, false, "空 id 被拒");
  eq(store.save({ id: "ok", mode: "乱写" }).ok, false, "非法 mode 被拒");
  eq(store.save({ id: "../逃逸", mode: "append", text: "x" }).ok, false, "含路径分隔的 id 被拒");
  eq(store.save({ id: "有中文", mode: "append", text: "x" }).ok, false, "非法字符的 id 被拒");
  eq(store.save({ id: "ok", mode: "append" }).ok, true, "合法 id 通过");
  eq(store.remove("").ok, false, "空 id 删除被拒");
}

// ── 7. 目录穿越防护（file 字段不可信）──────────────────────────────────────
{
  const { pd, store, catalogPath } = fresh();
  // 手工往目录里塞一个指向外面的 file
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  raw.prompts.push({ id: "evil", name: "坏", mode: "append", order: 1, file: "../../outside.md" });
  writeFileSync(catalogPath, JSON.stringify(raw));
  const r = store.remove("evil");
  eq(r.ok, false, "指向 prompts/ 之外的文件删除被拒");
  ok(r.error.includes("之外"), "错误说明指明越界");
  void pd;
}

// ── 8. 顺序与未知字段保留 ───────────────────────────────────────────────────
{
  const { catalogPath, store } = fresh();
  const raw0 = JSON.parse(readFileSync(catalogPath, "utf8"));
  eq(raw0.prompts.map((p) => p.id), ["keep", "inline-one", "file-one"], "初始顺序");
  store.save({ id: "zzz", name: "新的", mode: "none", order: 5 });
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  eq(raw.prompts.map((p) => p.id), ["keep", "inline-one", "file-one", "zzz"], "新条目追加在末尾");
  eq(raw.version, 1, "顶层 version 保留");
}

// ── 9. 写出来的 catalog 是可读 JSON ─────────────────────────────────────────
{
  const { catalogPath, store } = fresh();
  store.save({ id: "fmt", name: "格式", mode: "none", order: 1 });
  const text = readFileSync(catalogPath, "utf8");
  ok(text.includes("\n  "), "是缩进过的 JSON，不是一行");
  ok(text.endsWith("\n"), "以换行结尾");
}

// ── 10. 分类的读写 ──────────────────────────────────────────────────────────
{
  const { catalogPath, store, lib } = fresh();
  // 新建时带分类
  store.save({ id: "withcat", name: "带分类", category: "tool", mode: "append", order: 3000, text: "x" });
  lib.reload();
  eq(lib.resolve("withcat").category, "tool", "分类被写入并读回");
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  eq(raw.prompts.find((p) => p.id === "withcat").category, "tool", "catalog 里也有 category");

  // 自定义分类原样保留
  store.save({ id: "custom", name: "自定义", category: "安全审查", mode: "append", order: 100, text: "y" });
  lib.reload();
  eq(lib.resolve("custom").category, "安全审查", "自定义分类保留");

  // 不给分类 → other
  store.save({ id: "nocat", name: "无分类", mode: "append", order: 100, text: "z" });
  lib.reload();
  eq(lib.resolve("nocat").category, "other", "缺分类 → other");

  // 空白分类 → other
  store.save({ id: "blankcat", name: "空分类", category: "   ", mode: "append", order: 100, text: "w" });
  lib.reload();
  eq(lib.resolve("blankcat").category, "other", "空白分类 → other");

  // 更新时能改分类
  store.save({ id: "withcat", name: "带分类", category: "output", mode: "append", order: 9500, text: "x" });
  lib.reload();
  eq(lib.resolve("withcat").category, "output", "分类可被更新");

  // 老条目（没有 category 字段）不会被覆盖成 other —— 保存别的条目时不动它
  store.save({ id: "另一个", name: "新的", mode: "none", order: 100 });
  const raw2 = JSON.parse(readFileSync(catalogPath, "utf8"));
  const kept = raw2.prompts.find((p) => p.id === "keep");
  eq(kept.category, undefined, "保存别的条目不会给老条目补 category 字段");
}

done();
