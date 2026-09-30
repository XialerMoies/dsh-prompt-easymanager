// 提示词管理 —— 提示词库（目录解析、分类、模式校验）
//
// 职责：把 prompts/catalog.json 读成一组可用的提示词条目。
//
// 设计要点：
//   1. **不抛错，只收集错误。** 目录或条目坏掉时，插件要能把问题显示给用户，
//      而不是让整个插件加载失败。所有问题进 errors[]，由诊断接口暴露。
//   2. **按需重读。** reload() 会重新读盘，所以改完 catalog.json 不必重启宿主
//      （前提是有东西触发 reload；UI 上的「刷新」按钮或重新加载插件都行）。
//   3. **文本来源二选一**：`file`（相对 prompts/ 的文件）或 `inline`（直接写正文）。
//
// 两种模式（mode）：
//   none    —— 不注册任何 section。这是会话的默认状态。
//   append  —— 注册一个普通 section，与 dsh 原有的其他段落共存、按 order 排序。
//
// ⚠️ v0.2.2 起**移除了 replace（替换）模式**。
//    它靠 section 的 `complete: true` 独占整个系统提示词，会把 dsh 原生的
//    身份声明（harness:identity）和二十余段工具用法说明**全部顶掉** ——
//    模型仍拿得到工具 schema，却失去「什么时候用哪个、怎么用」的所有说明，
//    表现通常明显变差。而且两个替换模式同时存在会让 dsh 的组装直接抛错。
//    收益极低、代价极高，所以整条路一并删掉，而不是留个隐藏入口。
//    目录里若还有 mode: "replace" 的条目，会在加载时报错并提示改成 "append"。
//
// v0.2.3 起有了**分类（category）**：
//   给人看的组织维度，和「给机器看的插入位置」（order）分开，但**新建时会带出建议 order**。
//   内置五类，也可以自己写任意字符串（自由分类不会带出建议 order）。

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

export const MODES = ["none", "append"];
export const DEFAULT_ORDER = 100;

/**
 * 内置分类。
 *
 * `order` 是**建议插入位置** —— 数值对着 dsh 真实的 section 顺序挑的空档。
 *
 * ⚠️ **硬性要求：这五个数一个都不能等于 dsh 原生 SECTION_ORDERS 里的任何值。**
 *    撞了的话，dsh 会按 section 名字的字典序决定先后
 *    （`comparePromptSections = a.order - b.order || compareNames(a.name, b.name)`），
 *    于是同一个分类的提示词，插在哪**取决于用户给它起的名字首字母**，不是设计意图。
 *
 *    真踩过：v0.3.6 里 `domain` 用了 500（= PLAN_POLICY）、`tool` 用了 3000
 *    （= TOOL_COMPUTER_USE），两个都撞。`prompt_library_test.mjs` 里有一组断言
 *    拿 dsh 的原始表逐个比对，改这两个数之前先看那组测试。
 *
 * 原生表（dsh 0.1.7-rc.2，`dsh-system-prompt/lib/index.js` 的 SECTION_ORDERS）：
 *
 *   -1000  harness:identity             harness 身份
 *       0  deployment:persona-prefix    dsh 自带 persona
 *      20  ← 身份       persona 之后、策略段之前的空档
 *     500  plan:policy                 ⚠️ 曾经被 domain 占用过
 *     600  team:policy
 *     800  ptc:only
 *     900  context:file-reference
 *     950  ← 领域       文件引用之后、第一个工具说明(1000)之前
 *    1000~ tool:*（每个工具一段，到 3000 为止）
 *    3100  mcp:servers
 *    3200  ← 工具       所有工具说明 + MCP 之后
 *    5000  tools:sdk
 *    9000  ui:deliverable-file-references
 *    9500  ← 输出       交付物相关段落之间
 *    9900  structured-output
 *   10000  harness:source
 *   10100  web:surface
 *   10200  deployment:persona-suffix
 *
 * 注意这些只是**新建时的默认值**，之后随便改 —— 分类和 order 是两个独立的字段，
 * 改分类不会偷偷挪动已有条目的 order（只有点「新建」或显式改分类时才带出建议值）。
 */
export const CATEGORIES = [
  {
    id: "identity",
    name: "身份",
    order: 20,
    hint: "你是谁、语气、风格。插在 dsh 自带 persona 的正后方。",
  },
  {
    id: "domain",
    name: "领域",
    order: 950,
    hint: "项目知识、业务规则、术语约定。插在文件引用之后、工具说明之前。",
  },
  {
    id: "tool",
    name: "工具",
    order: 3200,
    hint: "怎么用工具、工具偏好、禁用某些工具。插在所有工具说明和 MCP 之后。",
  },
  {
    id: "output",
    name: "输出",
    order: 9500,
    hint: "输出格式、交付物约定。插在交付物相关段落之间。",
  },
  {
    id: "other",
    name: "其他",
    order: 100,
    hint: "不属于以上几类。用通用位置。",
  },
];

export const DEFAULT_CATEGORY = "other";

/** 取某分类的建议 order；自定义分类返回 null（表示"没有建议值"）。 */
export function suggestedOrder(category) {
  const hit = CATEGORIES.find((c) => c.id === category);
  return hit ? hit.order : null;
}

/**
 * 转义提示词里的连续花括号，避免 DSH 的模板插值引擎把非内置变量当成引用而抛错。
 * 内置变量只有 cwd / model / provider 三个。
 */
export function escapeTemplateBraces(text) {
  return String(text ?? "").replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");
}

/** 校验并规范化一条目录条目。返回 { entry } 或 { error }。 */
function normalizeEntry(raw, index) {
  if (!raw || typeof raw !== "object") {
    return { error: `第 ${index + 1} 条不是对象` };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return { error: `第 ${index + 1} 条缺少 id` };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    return { error: `提示词 id 非法（只允许字母数字 . _ -）：${id}` };
  }
  const mode = MODES.includes(raw.mode) ? raw.mode : null;
  if (!mode) {
    // 单独给 replace 一条明确的迁移提示 —— 老目录里可能有，直接报「非法」太生硬
    if (raw.mode === "replace") {
      return {
        error:
          `提示词「${id}」用的是已移除的 replace（替换）模式。` +
          `该模式会顶掉 dsh 原生的身份声明和全部工具用法说明，已在 v0.2.2 删除。` +
          `请把它的 mode 改成 "append"。`,
      };
    }
    return { error: `提示词「${id}」的 mode 非法：${JSON.stringify(raw.mode)}（应为 ${MODES.join(" / ")}）` };
  }
  const source = typeof raw.file === "string" && raw.file ? { kind: "file", value: raw.file }
    : typeof raw.inline === "string" && raw.inline ? { kind: "inline", value: raw.inline }
    : null;
  if (mode !== "none" && !source) {
    return { error: `提示词「${id}」缺少 file 或 inline，无法取到正文` };
  }
  // 分类是**自由字符串** —— 内置五类只是建议，写别的也行。
  // 空 / 缺失 / 非字符串 → 落到 "other"，这样老目录不用改。
  const category =
    typeof raw.category === "string" && raw.category.trim()
      ? raw.category.trim()
      : DEFAULT_CATEGORY;
  return {
    entry: {
      id,
      name: typeof raw.name === "string" && raw.name ? raw.name : id,
      description: typeof raw.description === "string" ? raw.description : "",
      category,
      mode,
      order: Number.isFinite(raw.order) ? raw.order : DEFAULT_ORDER,
      source,
      // section 名随 id 走，保证不同提示词不会互相遮蔽
      sectionName: `prompt-manager:${id}`,
    },
  };
}

/**
 * @param {object} options
 * @param {string} options.catalogPath  catalog.json 的绝对路径
 * @param {string} options.baseDir      相对文件（file 字段）的解析基准目录，通常是 prompts/
 */
export function createPromptLibrary({ catalogPath, baseDir }) {
  /** id -> entry（已解析文本） */
  let prompts = new Map();
  /** 加载过程中的问题，全部暴露给用户 */
  let errors = [];
  let loadedAt = null;

  function readTextOf(entry) {
    if (entry.mode === "none" || !entry.source) return "";
    if (entry.source.kind === "inline") return entry.source.value;
    const full = join(baseDir, entry.source.value);
    return readFileSync(full, "utf8");
  }

  function reload() {
    prompts = new Map();
    errors = [];
    let raw;
    try {
      raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    } catch (err) {
      errors.push(`读取 ${catalogPath} 失败：${err?.message ?? String(err)}`);
      loadedAt = Date.now();
      return { count: 0, errors };
    }
    const list = Array.isArray(raw?.prompts) ? raw.prompts : null;
    if (!list) {
      errors.push("catalog.json 里没有 prompts 数组");
      loadedAt = Date.now();
      return { count: 0, errors };
    }
    list.forEach((item, i) => {
      const { entry, error } = normalizeEntry(item, i);
      if (error) {
        errors.push(error);
        return;
      }
      if (prompts.has(entry.id)) {
        errors.push(`提示词 id 重复：${entry.id}（后面的被忽略）`);
        return;
      }
      // 文本在这里一次性读入并缓存；文件缺失只影响这一条，不影响其他条目
      let text = "";
      try {
        text = escapeTemplateBraces(readTextOf(entry));
      } catch (err) {
        errors.push(`提示词「${entry.id}」读正文失败：${err?.message ?? String(err)}`);
        return;
      }
      prompts.set(entry.id, { ...entry, text });
    });
    loadedAt = Date.now();
    return { count: prompts.size, errors };
  }

  reload();

  return {
    reload,
    errors: () => [...errors],
    loadedAt: () => loadedAt,
    /** 全量条目（含正文），供 UI 列表使用 */
    list: () =>
      [...prompts.values()].map(({ id, name, description, category, mode, order, text }) => ({
        id, name, description, category, mode, order,
        tokens: estimateTokens(text),
        chars: text.length,
      })),
    /** 取一条（含正文），找不到返回 undefined */
    resolve: (id) => prompts.get(id),
    has: (id) => prompts.has(id),
    size: () => prompts.size,
    /** 编辑器要改原始条目（含 file/inline 的来源形态），这里给出目录里的原样 */
    raw: () => readRawCatalogAt(catalogPath).entries,
  };
}

// ── 写入（设置页的编辑器用）─────────────────────────────────────────────────
//
// 设计原则：
//   1. **只动 prompts/ 目录内的文件。** 所有写/删前先解析绝对路径并确认它落在
//      baseDir 里 —— 目录里的 file 字段来自 catalog.json，那是用户可编辑的，
//      不能拿它当可信输入。
//   2. **正文一律写进 prompts/<id>.md**，条目改成 `file` 形态。原先若为 `inline`
//      就转成文件 —— 编辑器里长文本放 JSON 里不好维护。
//   3. **写目录用覆盖式重写**（保留未知字段的顺序会失真，但可读性优先）；
//      条目按原顺序保留，新条目追加在末尾。

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** 读原始 catalog.json（不做校验），返回 { root, entries }。 */
function readRawCatalogAt(catalogPath) {
  try {
    const root = JSON.parse(readFileSync(catalogPath, "utf8"));
    return { root, entries: Array.isArray(root?.prompts) ? root.prompts : [] };
  } catch {
    return { root: { version: 1, prompts: [] }, entries: [] };
  }
}

/** 把 baseDir 之外的路径挡掉。返回绝对路径或抛错。 */
function safeJoin(baseDir, relPath, what) {
  const abs = resolve(baseDir, relPath);
  const rel = relative(baseDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${what} 指向 prompts/ 目录之外，已拒绝：${relPath}`);
  }
  return abs;
}

/**
 * @param {object} options
 * @param {string} options.catalogPath
 * @param {string} options.baseDir    prompts/ 的绝对路径
 */
export function createPromptStore({ catalogPath, baseDir }) {
  function readRawCatalog() {
    return readRawCatalogAt(catalogPath);
  }

  function writeCatalog(root) {
    writeFileSync(catalogPath, JSON.stringify(root, null, 2) + "\n", "utf8");
  }

  return {
    raw: () => readRawCatalog().entries,

    /**
     * 新增或更新一条。
     * @returns {{ok: true, id: string, created: boolean}|{ok: false, error: string}}
     */
    save(input) {
      const id = typeof input?.id === "string" ? input.id.trim() : "";
      if (!id) return { ok: false, error: "id 不能为空" };
      if (!ID_RE.test(id)) {
        return { ok: false, error: `id 非法（只允许字母数字 . _ -）：${id}` };
      }
      const mode = MODES.includes(input?.mode) ? input.mode : null;
      if (!mode) return { ok: false, error: `mode 非法：${JSON.stringify(input?.mode)}` };

      const name = typeof input?.name === "string" && input.name.trim() ? input.name.trim() : id;
      const description = typeof input?.description === "string" ? input.description : "";
      const category =
        typeof input?.category === "string" && input.category.trim()
          ? input.category.trim()
          : DEFAULT_CATEGORY;
      let order = Number(input?.order);
      if (!Number.isFinite(order)) order = DEFAULT_ORDER;
      const text = typeof input?.text === "string" ? input.text : "";

      const { root, entries } = readRawCatalog();
      const idx = entries.findIndex((e) => e && e.id === id);
      const created = idx < 0;

      // none 模式没正文；其余一律落到文件
      let entry = {
        id,
        name,
        description,
        category,
        mode,
        order,
      };
      if (mode !== "none") {
        let fileAbs;
        try {
          fileAbs = safeJoin(baseDir, `${id}.md`, "正文文件");
        } catch (err) {
          return { ok: false, error: err.message };
        }
        try {
          writeFileSync(fileAbs, text, "utf8");
        } catch (err) {
          return { ok: false, error: `写正文文件失败：${err?.message ?? String(err)}` };
        }
        entry.file = `${id}.md`;
      } else {
        // 从有正文改成 none：把旧文件删掉，别留孤儿
        const old = idx >= 0 ? entries[idx] : null;
        if (old && typeof old.file === "string" && old.file) {
          try {
            unlinkSync(safeJoin(baseDir, old.file, "旧正文文件"));
          } catch {
            /* 文件不在就算了 */
          }
        }
      }

      if (created) entries.push(entry);
      else entries[idx] = entry;

      root.prompts = entries;
      if (!root.version) root.version = 1;
      try {
        writeCatalog(root);
      } catch (err) {
        return { ok: false, error: `写 catalog.json 失败：${err?.message ?? String(err)}` };
      }
      return { ok: true, id, created };
    },

    /**
     * 删除一条。正文文件是它自己管的话一并删掉。
     * @returns {{ok: true, id: string, fileRemoved: boolean}|{ok: false, error: string}}
     */
    remove(id) {
      if (typeof id !== "string" || !id) return { ok: false, error: "id 不能为空" };
      const { root, entries } = readRawCatalog();
      const idx = entries.findIndex((e) => e && e.id === id);
      if (idx < 0) return { ok: false, error: `目录里没有 id=${id}` };
      const entry = entries[idx];

      let fileRemoved = false;
      if (entry && typeof entry.file === "string" && entry.file) {
        try {
          const abs = safeJoin(baseDir, entry.file, "正文文件");
          if (existsSync(abs)) {
            unlinkSync(abs);
            fileRemoved = true;
          }
        } catch (err) {
          // 文件删不掉不该阻断条目删除，但要如实报告
          return { ok: false, error: `删除正文文件失败：${err?.message ?? String(err)}` };
        }
      }
      entries.splice(idx, 1);
      root.prompts = entries;
      try {
        writeCatalog(root);
      } catch (err) {
        return { ok: false, error: `写 catalog.json 失败：${err?.message ?? String(err)}` };
      }
      return { ok: true, id, fileRemoved };
    },
  };
}


/** 中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token（与旧版保持同一口径） */
export function estimateTokens(text) {
  const s = String(text || "");
  let cjk = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) cjk += 1;
  }
  return Math.ceil(cjk + (s.length - cjk) / 4);
}
