// Portable Markdown format for preset backups. The JSON block is deliberately
// data-only: importing it never evaluates Markdown or runs any command.
const MAX_BYTES = 1024 * 1024;
const BEGIN = "```json dsh-prompt-easymanager";
const END = "```";

function clean(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function serializePresetBundle({ preset, prompts = [], sectionOverrides = {}, dshVersion = null }) {
  if (!preset || typeof preset !== "object") throw new Error("缺少预设");
  const payload = {
    format: "dsh-prompt-preset",
    version: 1,
    dshVersion: dshVersion || null,
    preset: {
      name: clean(preset.name, "未命名预设"),
      note: clean(preset.note),
      selection: preset.selection || { listed: [], excluded: [], sections: {}, known: [] },
      prompts: prompts.map((p) => ({
        id: clean(p.id), name: clean(p.name, p.id), description: clean(p.description),
        category: clean(p.category, "other"), mode: clean(p.mode, "append"),
        order: Number.isFinite(p.order) ? p.order : 100, text: clean(p.text),
      })),
      sectionOverrides: Object.fromEntries(Object.entries(sectionOverrides || {}).map(([name, v]) => [name, {
        action: "replace", text: clean(v?.text), original: clean(v?.original),
        originalHash: clean(v?.originalHash), savedAt: clean(v?.savedAt), acceptedDrift: v?.acceptedDrift === true,
      }])),
    },
  };
  return [
    "---", "format: dsh-prompt-preset", "version: 1", `name: ${payload.preset.name}`, "---", "",
    `# ${payload.preset.name}`, "", "这是 DSH 提示词管理器导出的预设包。导入后不会自动启用。", "",
    "## 包含内容", "", "- 个人提示词正文与元数据", "- 系统提示词改写正文", "- 预设中的注入 tag 选择", "",
    BEGIN, JSON.stringify(payload, null, 2), END, "",
  ].join("\n");
}

export function parsePresetBundle(markdown) {
  const text = clean(markdown);
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("文件太大（最大 1 MB）");
  const start = text.indexOf(BEGIN);
  if (start < 0) throw new Error("不是 dsh 提示词预设文件");
  const bodyStart = start + BEGIN.length;
  const end = text.indexOf("\n" + END, bodyStart);
  if (end < 0) throw new Error("预设文件内容不完整");
  let data;
  try { data = JSON.parse(text.slice(bodyStart, end).trim()); } catch { throw new Error("预设数据不是合法格式"); }
  if (data?.format !== "dsh-prompt-preset" || data?.version !== 1 || !data?.preset) throw new Error("不支持的预设格式");
  const p = data.preset;
  if (!Array.isArray(p.prompts) || !isRecord(p.sectionOverrides)) throw new Error("预设内容缺失");
  const promptIds = new Set();
  for (const prompt of p.prompts) {
    if (!isRecord(prompt) || typeof prompt.id !== "string" || !prompt.id.trim()) {
      throw new Error("预设中的个人提示词缺少 id");
    }
    if (promptIds.has(prompt.id)) throw new Error(`预设中的个人提示词 id 重复：${prompt.id}`);
    promptIds.add(prompt.id);
    if (typeof prompt.text !== "string") throw new Error(`个人提示词「${prompt.id}」缺少正文`);
  }
  for (const [name, override] of Object.entries(p.sectionOverrides)) {
    if (!name || !isRecord(override) || typeof override.text !== "string") {
      throw new Error(`系统提示词改写「${name || "未命名"}」格式不正确`);
    }
  }
  if (!isRecord(p.selection)) throw new Error("预设缺少 tag 选择");
  return data;
}

export { MAX_BYTES };
