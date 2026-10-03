// 真浏览器回归入口。
// 用法：
//   BROWSER_CDP_PORT=9223 DSH_URL="http://127.0.0.1:3080/?token=..." node scripts/browser_regression.mjs
// 该脚本只依赖 Node 22 的 WebSocket，不把浏览器或用户数据打进插件包。

import { writeFileSync } from "node:fs";

const port = Number(process.env.BROWSER_CDP_PORT || 9222);
const url = process.env.DSH_URL;
if (!url) {
  console.error("缺少 DSH_URL（例如带 token 的本地 Web URL）");
  process.exit(2);
}

async function target() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  const pages = await res.json();
  const page = pages.find((x) => x.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("CDP 没有可用 page target");
  return page.webSocketDebuggerUrl;
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.next = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const done = this.pending.get(msg.id);
      if (!done) return;
      this.pending.delete(msg.id);
      if (msg.error) done.reject(new Error(msg.error.message || "CDP error"));
      else done.resolve(msg.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = true) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value) => JSON.stringify(value);
const wsUrl = await target();
const cdp = new Cdp(wsUrl);
try {
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Page.navigate", { url });
  await sleep(Number(process.env.BROWSER_WAIT_MS || 2500));

  async function pageApi(path, init = {}) {
    const request = { ...init };
    if (request.body && typeof request.body !== "string") request.body = json(request.body);
    const expression = `fetch(${json(path)}, ${json(request)}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`;
    const result = await cdp.eval(expression);
    if (result.status >= 400) throw new Error(`${path} HTTP ${result.status}: ${result.body?.error || "请求失败"}`);
    return result.body;
  }

  async function waitFor(predicate, label, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await cdp.eval(`(${predicate.toString()})()`)) return;
      await sleep(100);
    }
    throw new Error(`等待真实页面状态超时：${label}`);
  }

  async function waitForText(text, label, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = await cdp.eval("document.body?.innerText || ''");
      if (current.includes(text)) return;
      await sleep(100);
    }
    throw new Error(`等待真实页面状态超时：${label}`);
  }

  async function waitForTagChecked(name, index, label, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const checked = await cdp.eval(`([...document.querySelectorAll('input[data-section-tag]')].filter((x) => x.dataset.sectionTag === ${json(name)})[${index}]?.checked === true)`);
      if (checked) return;
      await sleep(100);
    }
    throw new Error(`等待真实页面状态超时：${label}`);
  }

  async function openEditor() {
    await cdp.eval(`(() => { const b = document.querySelector('[aria-label="设置"]'); if (b) b.click(); return true; })()`);
    await waitFor(() => !![...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "提示词管理"), "设置页");
    await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "提示词管理"); if (b) b.click(); return true; })()`);
    await waitFor(() => (document.body?.innerText || "").includes("改动提示词"), "提示词管理页数据");
  }

  const before = await cdp.eval(`({
    url: location.href,
    title: document.title,
    text: document.body?.innerText || "",
    buttons: [...document.querySelectorAll("button")].map((x) => ({ text: x.innerText.trim(), aria: x.getAttribute("aria-label"), title: x.title })).filter((x) => x.text),
    controls: [...document.querySelectorAll("[aria-label],a,[role=button]")].map((x) => ({ tag: x.tagName, text: x.innerText?.trim() || "", aria: x.getAttribute("aria-label"), title: x.title, href: x.href || "" })).filter((x) => x.text || x.aria || x.title),
    selects: [...document.querySelectorAll("select")].map((x) => ({ value: x.value, options: [...x.options].map((o) => o.text) })),
  })`);
  // 真实会话页：点击原生选择器，确认三种入口和用户预设来自同一菜单。
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("系统提示词（原生）")); if (!b) return false; b.click(); return true; })()`);
  await sleep(400);
  const menu = await cdp.eval(`({ text: document.body?.innerText || "", buttons: [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean) })`);
  await cdp.eval(`(() => { const b = document.querySelector('[aria-label="设置"]'); if (!b) return false; b.click(); return true; })()`);
  await sleep(700);
  const settings = await cdp.eval(`({ text: document.body?.innerText || "", buttons: [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean) })`);
  const snapshot = { ...before, menu, settings };

  const required = ["系统提示词（原生）", "不挂任何自设提示词"];
  const missing = required.filter((label) => !menu.text.includes(label));
  if (missing.length > 0) {
    throw new Error(`真实页面缺少插件界面：${missing.join("、")}`);
  }
  if (!settings.text.includes("提示词管理")) {
    throw new Error("真实设置页没有加载提示词管理入口");
  }
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "提示词管理"); if (!b) return false; b.click(); return true; })()`);
  await sleep(900);
  const editor = await cdp.eval(`({ text: document.body?.innerText || "", buttons: [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean) })`);
  snapshot.editor = editor;
  if (!editor.text.includes("个人提示词") || !editor.text.includes("系统提示词")) {
    throw new Error("真实提示词管理页未渲染三块内容");
  }

  // 服务端状态签名必须可读，前端展示的数据不能靠本地猜测。
  const state = await cdp.eval(`fetch("/api/prompt-easymanager/state", { cache: "no-store" }).then((r) => r.json())`);
  if (state.schemaVersion !== 3) throw new Error(`状态 schemaVersion=${state.schemaVersion}，期望 3`);
  const presets = Object.values(state.presets || {});
  if (presets.some((p) => typeof p.signature !== "string" || typeof p.isNative !== "boolean")) {
    throw new Error("状态预设缺少服务端 signature/isNative");
  }

  // 真实浏览器回归：改写和原生段落必须是两个独立的 tag。
  // 这组动作只操作临时预设，finally 会恢复原来的全局状态并删除它们。
  const originalGlobal = state.global;
  const sections = await pageApi("/api/prompt-easymanager/sections");
  const nativeName = sections.availableNative?.[0];
  const nativeRow = [...(sections.untouched || []), ...(sections.applied || []), ...(sections.pending || [])].find((x) => x.name === nativeName);
  if (!nativeName || !nativeRow) throw new Error("真实页面没有可用于回归的原生段落");
  const marker = `浏览器回归改写 ${Date.now()}`;
  const known = sections.availableNative.slice();
  const pendingSelection = {
    listed: [],
    excluded: [],
    known,
    sections: { [nativeName]: { text: marker, original: nativeRow.original || "" } },
  };
  const pendingName = `__browser-regression-pending-${Date.now()}`;
  const pendingSaved = await pageApi("/api/prompt-easymanager/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { action: "save", name: pendingName, selection: pendingSelection, availableNative: known },
  });
  const pendingId = pendingSaved.id;
  const excludedName = `__browser-regression-excluded-${Date.now()}`;
  const excludedSaved = await pageApi("/api/prompt-easymanager/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { action: "save", name: excludedName, selection: { listed: [], excluded: [nativeName], known, sections: {} }, availableNative: known },
  });
  const excludedId = excludedSaved.id;

  try {
    // 应用后，改写正文先显示在“改动提示词”，但默认未勾选，服务端投影为 pending。
    await pageApi("/api/prompt-easymanager/presets", { method: "POST", headers: { "content-type": "application/json" }, body: { action: "apply", id: pendingId } });
    const pendingSections = await pageApi("/api/prompt-easymanager/sections");
    if (!pendingSections.pending?.some((x) => x.name === nativeName && x.text === marker)) {
      throw new Error("改写保存后没有保持“未勾选 / pending”状态");
    }
    await cdp.eval("location.reload()");
    await sleep(1200);
    await openEditor();
    const pendingUi = await cdp.eval(`(() => {
      const tags = [...document.querySelectorAll('input[data-section-tag]')].filter((x) => x.dataset.sectionTag === ${json(nativeName)});
      const text = document.body?.innerText || '';
      return { text, tags: tags.map((x) => ({ checked: x.checked, parent: x.parentElement?.innerText || '' })) };
    })()`);
    if (!pendingUi.text.includes("改动提示词（1 段）")) {
      throw new Error(`真实管理页没有显示改写后的 tag；页面片段：${pendingUi.text.slice(-1800)}`);
    }
    if (pendingUi.tags.length < 2 || pendingUi.tags[0].checked || !pendingUi.tags[1].checked) {
      throw new Error("改写 tag 默认应未勾选，原生 tag 应保持勾选");
    }
    await cdp.eval(`(() => { const h = [...document.querySelectorAll('.pm-head')].find((x) => x.innerText.includes(${json(nativeName)})); if (h) h.click(); return !!h; })()`);
    await waitForText(marker, "展开改写段落正文");

    // 通过真实 checkbox + 保存完成注入；保存前后服务端投影必须变化。
    await cdp.eval(`(() => { window.__pmRegressionRequests = []; const originalFetch = window.fetch; window.fetch = function (...args) { if (String(args[0]).includes('/api/prompt-easymanager/presets')) { try { window.__pmRegressionRequests.push(args[1]?.body || ''); } catch {} } return originalFetch.apply(this, args); }; })()`);
    await cdp.eval(`(() => { const x = [...document.querySelectorAll('input[data-section-tag]')].find((x) => x.dataset.sectionTag === ${json(nativeName)}); if (!x || x.checked) return false; x.click(); return true; })()`);
    await waitForTagChecked(nativeName, 0, "勾选改动 tag");
    const saveButton = await cdp.eval(`([...document.querySelectorAll('button')].find((x) => x.title?.startsWith('把当前勾选覆盖')) || null) !== null`);
    if (!saveButton) throw new Error("真实管理页没有找到当前预设的保存按钮");
    await cdp.eval(`(() => { const x = [...document.querySelectorAll('button')].find((x) => x.title?.startsWith('把当前勾选覆盖')); if (x) x.click(); return true; })()`);
    await waitFor(async () => false, "占位", 1).catch(() => {});
    await sleep(700);
    const appliedSections = await pageApi("/api/prompt-easymanager/sections");
    if (!appliedSections.applied?.some((x) => x.name === nativeName && x.text === marker)) {
      const afterState = await pageApi("/api/prompt-easymanager/state");
      const requests = await cdp.eval("window.__pmRegressionRequests || []");
      throw new Error(`保存勾选后改写没有进入生效投影：${JSON.stringify({ nativeName, requests, global: afterState.global, presets: Object.values(afterState.presets || {}).filter((p) => String(p.name).includes("__browser-regression")).map((p) => ({ name: p.name, selection: p.selection })), applied: appliedSections.applied, pending: appliedSections.pending, excluded: appliedSections.excludedSections })}`);
    }

    // 只取消原生副本时，不得在“改动提示词”凭空生成同名 tag。
    await pageApi("/api/prompt-easymanager/presets", { method: "POST", headers: { "content-type": "application/json" }, body: { action: "apply", id: excludedId } });
    const excludedSections = await pageApi("/api/prompt-easymanager/sections");
    if (!excludedSections.excludedSections?.includes(nativeName) || excludedSections.applied?.some((x) => x.name === nativeName)) {
      throw new Error("取消原生段落后服务端状态不正确");
    }
    await cdp.eval("location.reload()");
    await sleep(1200);
    await openEditor();
    const excludedUi = await cdp.eval(`(() => {
      const tags = [...document.querySelectorAll('input[data-section-tag]')].filter((x) => x.dataset.sectionTag === ${json(nativeName)});
      const editedHeader = [...document.querySelectorAll('div')].find((x) => x.innerText?.trim() === '改动提示词（还没改过）');
      return { tags: tags.map((x) => x.checked), editedHeader: !!editedHeader };
    })()`);
    if (!excludedUi.editedHeader || excludedUi.tags.some(Boolean)) {
      throw new Error("取消原生段落后不应出现勾选的改动 tag，原生 tag 应为未勾选");
    }
  } finally {
    await pageApi("/api/prompt-easymanager/presets", { method: "POST", headers: { "content-type": "application/json" }, body: { action: "delete", id: pendingId } }).catch(() => {});
    await pageApi("/api/prompt-easymanager/presets", { method: "POST", headers: { "content-type": "application/json" }, body: { action: "delete", id: excludedId } }).catch(() => {});
    await pageApi("/api/prompt-easymanager/global", { method: "POST", headers: { "content-type": "application/json" }, body: originalGlobal }).catch(() => {});
  }

  snapshot.browserRegression = { nativeName, marker, pending: true, savedInjection: true, nativeExclusionIsolated: true };
  writeFileSync(process.env.BROWSER_SNAPSHOT || "browser-regression-snapshot.json", JSON.stringify(snapshot, null, 2));

  console.log(JSON.stringify({ ok: true, url: snapshot.url, title: snapshot.title, presetCount: presets.length, snapshot: process.env.BROWSER_SNAPSHOT || "browser-regression-snapshot.json" }));
} finally {
  cdp.close();
}
