// ───────────────────────────────────────────────────────────────────────────
// dsh-prompt-manager · CHUNK
//
// 这是**包内 chunk**，由 client.js 用 require.async("./client.xxx.js") 拉起。
// 不是独立插件：必须注册成 "dsh-prompt-manager" 的 chunk，否则宿主报
// 「bundle loaded without registering」。
//
// 改完**必须重启 dsh** —— chunk 的 rev 跟着 client.js 的 mtime 走，浏览器会拿
// 旧 rev 去请求，文件对不上就是 404，表现为设置页整片空白。
// ───────────────────────────────────────────────────────────────────────────
// 共用常量与小工具（无 React 依赖，纯常量与小工具）

window.__ModuleLoader__.load({
  id: "dsh-prompt-manager",
  chunk: "client.helpers.js",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;

const ROUTE_STATE = "/api/prompt-manager/state";
const ROUTE_ASSIGN = "/api/prompt-manager/assign";
const ROUTE_PREVIEW = "/api/prompt-manager/preview";
const ROUTE_RELOAD = "/api/prompt-manager/reload";
const ROUTE_DEFAULTS = "/api/prompt-manager/defaults";
const ROUTE_EDIT = "/api/prompt-manager/edit";
const ROUTE_SECTIONS = "/api/prompt-manager/sections";
const ROUTE_PRESETS = "/api/prompt-manager/presets";
/** 原生段落中文名 —— 查不到就走 sectionLabel 的兜底。见 client.js 顶部说明。 */
const SECTION_LABELS = {
  "harness:identity": "harness 身份",
  "harness:source": "Harness 安装位置",
  "deployment:persona-prefix": "部署人设 · 前",
  "deployment:persona-suffix": "部署人设 · 后",
  "plan:policy": "计划策略",
  "team:policy": "团队策略",
  // PTC = Programmatic Tool Calling。官方 preset 的原文：
  //   "PTC means Programmatic Tool Calling. In this built-in preset, the agent
  //    uses run_code to write a TypeScript program that calls tools..."
  // 这一段只在 PTC 模式下有正文，其余模式返回空串。
  "tools:ptc-only": "编程式工具调用 · 约束",
  "tools:sdk": "编程式工具调用 · SDK",
  "context:file-reference": "文件引用",
  "mcp-resource-servers": "MCP 资源服务器",
  "ui:deliverable-file-references": "交付物文件引用",
  "app:web-surface": "网页界面",
};
/** `tool:xxx` 里 xxx 的中文。查不到就用原文。 */
const TOOL_LABELS = {
  bash: "bash",
  pwsh: "PowerShell",
  read: "读文件",
  write: "写文件",
  edit: "改文件",
  glob: "找文件",
  grep: "搜内容",
  jobs: "后台任务",
  pty: "终端",
  "web-search": "网页搜索",
  web_search: "网页搜索",
  "web-fetch": "抓网页",
  web_fetch: "抓网页",
  lsp: "代码索引",
  "session-query": "会话查询",
  goal: "目标",
  workflow: "工作流",
  ralph: "长跑",
  subagent: "子代理",
  // 实测存在的名字（2026-09 按真机列表核对）：我一开始漏了 `subagent_fork`，
  // 于是它显示成兜底的「工具 · subagent_fork 用法」。
  subagent_fork: "子代理 · 派生",
  report: "汇报",
  "computer-use": "电脑操作",
};
/** 段落的中文显示名。永远只用于显示。 */
function sectionLabel(name) {
  if (typeof name !== "string" || name === "") return "";
  if (SECTION_LABELS[name]) return SECTION_LABELS[name];
  if (name.startsWith("tool:")) {
    const key = name.slice(5);
    // 「工具用法 · 读文件」比「工具 · 读文件 用法」顺 —— 后缀吊在最后读着断句很怪。
    return "工具用法 · " + (TOOL_LABELS[key] || key);
  }
  if (name.startsWith("mcp:")) return "MCP · " + name.slice(4);
  // ⚠️ 插件**自己注入**的段落也会出现在这个列表里（比如 prompt-manager:infinite-gen-3）。
  //    这是修「列表只有全局层」那个 bug 之后的必然结果 —— 带 scope 读就看得见自己。
  //    标成「本插件注入」是**故意的**：它跟原生段落不是一回事，用户要能一眼分出来。
  if (name.startsWith("prompt-manager:")) return "本插件注入 · " + name.slice(16);
  // 兜底：把分隔符换成人话，别原样甩一串英文键名
  return name.replace(/[:_-]+/g, " · ");
}

// v0.2.2 起没有 replace 模式了（见 prompt-library.mjs 顶部说明）
const MODE_LABEL = { none: "不注入", append: "追加" };
    function fmtTokens(n) {
      return String(n || 0) + " tokens";
    }
exports.ROUTE_STATE = ROUTE_STATE;
exports.ROUTE_ASSIGN = ROUTE_ASSIGN;
exports.ROUTE_PREVIEW = ROUTE_PREVIEW;
exports.ROUTE_RELOAD = ROUTE_RELOAD;
exports.ROUTE_DEFAULTS = ROUTE_DEFAULTS;
exports.ROUTE_EDIT = ROUTE_EDIT;
exports.ROUTE_SECTIONS = ROUTE_SECTIONS;
exports.ROUTE_PRESETS = ROUTE_PRESETS;
exports.sectionLabel = sectionLabel;
exports.fmtTokens = fmtTokens;
exports.MODE_LABEL = MODE_LABEL;

    return module.exports;
  },
});
