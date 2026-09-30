// 客户端组件渲染测试
//
// 运行：node scripts/client_render_test.mjs
//
// 为什么需要它：客户端半体此前**一个测试都没有**，而组件渲染期的异常会让
// React 卸载整棵子树 —— 表现就是「点了预览之后控件全没了」。这类问题
// 只有把组件真跑一遍才能提前发现。
//
// 做法：用最小的 react / react-dom 影子层执行 client.js，拿到工厂函数，
// 再用可控的 useState 把组件渲染到各个状态（含预览弹窗打开）。
// 不需要真 react，也不需要浏览器。

import { readFileSync } from "node:fs";
import { createSuite } from "./lib/test-harness.mjs";
import { createClientSandbox, clientSource, strictApi } from "./lib/client-loader.mjs";

// 拆包之后客户端有 6 个文件。静态扫描必须扫**全部**，不能只扫 client.js ——
// 那些常量/函数大多搬进了 chunk，只扫宿主的话这类断言会「全绿但什么都没扫到」。
const CLIENT_SRC = clientSource();

const { ok, eq, done } = createSuite("客户端渲染测试");
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..", "client.js");


// ── 影子层 ──────────────────────────────────────────────────────────────────
function makeShims() {
  let stateIndex = 0;
  let stateOverrides = [];
  // 跨渲染持久的那一份：真 React 的 useState 是「同一个组件、同一个 hook 序号
  // → 同一个格」。组件里 useChunk 把 chunk 的 Promise 存在这个格里，重试时
  // 读到的必须是**同一个对象**；每次渲染都新建的话，Promise 永远停在 pending，
  // 组件就一直抛 —— 测试会误报成「组件没渲染」。
  let persistent = [];
  let persistentOn = false;
  // 是否正处在「组件渲染」里。真 React 在渲染之外调 useState 会直接抛
  // `Invalid hook call` —— 影子层以前是照单全收的，于是「在 factory 里调 hooks」
  // 这种写法在测试里一路绿灯，到真机上才炸成 `import failed: [object Promise]`。
  // 见下面 useState 里的注释。
  let inRender = false;
  // 渲染期收集到的副作用（见 useEffect）
  let effects = [];
  // 跑过 effect 的组件实例 → 它们的 effect 清单。
  // 键是组件函数本身：测试里一个组件就是一个实例。
  const effectStore = new Map();
  // setState 排队的值：hook 序号 → 新值。下一轮渲染读它。
  const pendingState = new Map();

  const react = {
    createElement(type, props, ...children) {
      // ⚠️ 必须真的调用函数组件 —— 否则子组件（如 PreviewPanel）永远不会被
      //    执行，测试会"通过"却什么都没测到。（影子层第一版就犯了这个错。）
      if (typeof type === "function") {
        const wasInRender = inRender;
        inRender = true;
        try {
          return type({ ...(props || {}), children });
        } finally {
          inRender = wasInRender;
        }
      }
      return { __el: true, type, props: props || {}, children: children.flat(Infinity) };
    },
    /**
     * ⚠️ 渲染之外调用必须**抛**，跟真 React 一样。
     *
     * 这个检查是补上的：宿主曾经在 factory 里调 `useChunk(loadHelpers)` ——
     * 那既违反了 hooks 规则，又让 factory 抛出一个 pending Promise，
     * `module.exports` 永远返回不了。影子层当时不检查，所以测试全绿、
     * 真机上直接 `import failed: [object Promise]`。
     */
    useState(initial) {
      if (!inRender) {
        throw new Error("Invalid hook call: useState 只能在组件渲染里调用（宿主是不是在 factory 里用了？）");
      }
      const i = stateIndex++;
      // ⚠️ 要跟真 React 一样支持函数式初值（useState(fn) 会调用 fn）。
      const fresh = typeof initial === "function" ? initial() : initial;

      // 上一次渲染里 setState 过的值，这一轮优先
      let v;
      if (pendingState.has(i)) {
        v = pendingState.get(i);
        pendingState.delete(i);
      } else if (persistentOn && i < persistent.length) {
        v = persistent[i];
      } else {
        v = i < stateOverrides.length ? stateOverrides[i] : fresh;
      }
      if (persistentOn) persistent[i] = v;

      // ⚠️ setter 必须是**真的** —— 以前这里是 `() => {}`。
      //    宿主的 chunk 加载是「effect 里异步拉 → setState(模块) → 重渲染读到模块」，
      //    setter 空实现的话重渲染永远读到 null，组件永远是空。
      const set = (next) => {
        pendingState.set(i, typeof next === "function" ? next(persistent[i]) : next);
      };
      return [v, set];
    },
    useCallback(fn) {
      return fn;
    },
    /**
     * 副作用要**真的收集起来**，由 renderAsync 在渲染后跑一遍。
     *
     * ⚠️ 以前这里是空实现。宿主的 chunk 加载改成「effect 里异步拉 + setState」
     *    之后，空实现就意味着**加载永远不会发生** —— 组件首帧渲染 null 就再没有下文，
     *    测试只会看到「什么都没渲染」，测不出这一步到底通不通。
     */
    useEffect(fn) {
      if (inRender) effects.push(fn);
    },
    useRef(v) {
      return { current: v };
    },
    Fragment: "Fragment",
  };

  const portals = [];
  const reactDom = {
    createPortal(el, target) {
      portals.push({ el, target });
      return el;
    },
  };

  return {
    react,
    reactDom,
    portals,
    reset() {
      stateIndex = 0;
    },
    setStates(values) {
      stateOverrides = values;
      stateIndex = 0;
    },
    /**
     * 按真 React 的语义渲染一个组件：同一个组件实例的 state 跨渲染保留，
     * 抛出的 Promise 会被重试。
     *
     * 为什么需要它：组件里的 useChunk 第一次会抛 Promise（chunk 还没到），
     * 真 React 会重试同一个实例 —— 重试时读到的是**同一个** 快照对象。
     * 每次调用都新建 state 的话，这个格永远是空的，组件永远抛。
     *
     * @param {Function} Component
     * @param {object} props
     * @param {number} [tries] 最多重试几次（对应 Suspense 等 Promise 落地）
     */
    render(Component, props, tries = 3) {
      persistent = [];
      pendingState.clear(); // ⚠️ 见 renderAsync 里的说明 —— 跨组件会串号
      persistentOn = true;
      inRender = true;
      let last;
      for (let i = 0; i < tries; i++) {
        stateIndex = 0;
        try {
          last = Component(props);
          break;
        } catch (e) {
          if (e && typeof e.then === "function") continue; // 等 chunk，重试
          persistentOn = false;
          inRender = false;
          throw e;
        }
      }
      persistentOn = false;
      inRender = false;
      return last;
    },
    /**
     * 同 render，但每次重试之间真的 await 一下 —— chunk 的 Promise 需要一个
     * 微任务才落地，同步循环里 retry 一万次也还是 pending。
     * 预热（把槽位包装组件跑通、把 api 交出来）只能用它。
     */
    async renderAsync(Component, props, tries = 12) {
      // ⚠️ 每次渲染入口都要把「排队等生效的 setState」清掉。
      //
      //    这个 Map 是按 **hook 序号** 存的，而序号对每个组件都从 0 开始 ——
      //    上一个组件跑完留下的排队值会被下一个组件读到（真机上踩到的样子：
      //    渲染 EditorSlot 时 `useState(0)` 拿到了 PickerSlot 的 chunk 模块，
      //    报 `m.box.installStyles is not a function`）。
      //    真 React 里 state 是挂在实例上的，不会串。
      persistent = [];
      pendingState.clear();
      persistentOn = true;
      if (effectStore.get(Component) === undefined) effectStore.set(Component, []);

      let last;
      const pendingCleanups = [];
      for (let i = 0; i < tries; i++) {
        effects = [];
        stateIndex = 0;
        inRender = true;
        try {
          last = Component(props);
        } catch (e) {
          inRender = false;
          persistentOn = false;
          if (e && typeof e.then === "function") {
            await e; // 兼容旧的「抛 Promise」写法
            continue;
          }
          throw e;
        }
        inRender = false;

        // 渲染完跑 effect（真 React 也是渲染后跑）。
        //
        // ⚠️ effect 的返回值是**清理函数**，不是结果 —— 不能拿它当 Promise 等。
        //    加载是 effect 内部发起的，所以只能「跑完 effect → 让异步落地 → 再渲染」。
        const list = effectStore.get(Component);
        for (const fn of effects) if (!list.includes(fn)) list.push(fn);
        for (const fn of list) {
          const cleanup = fn();
          if (typeof cleanup === "function") pendingCleanups.push(cleanup);
        }

        // ⚠️ 别只让出一个微任务。chunk 加载是
        //    `loadPreview().then(loadPicker).then(…)` 好几层，微任务数不固定 ——
        //    让不够就会「第一轮渲染出 null 就以为完事了」，warmup 拿不到组件。
        //    这里每次都多让几个，配合下面的多轮循环。
        for (let k = 0; k < 10; k++) await Promise.resolve();

        if (last !== null) break; // 渲染出东西了
      }

      for (const fn of pendingCleanups) fn();
      persistentOn = false;
      return last;
    },
  };
}

/** 加载 client.js + 它的包内 chunk，取出宿主导出 */
function loadFactory(shims) {
  const sandbox = createClientSandbox(shims);
  const { mod, id } = sandbox.load("client.js");
  return { mod, id, sandbox };
}

/** 递归统计渲染出的元素数量（顺便触发所有 createElement 参数求值） */
function countElements(node) {
  if (node === null || node === undefined || typeof node !== "object") return 0;
  let n = node.__el ? 1 : 0;
  for (const c of node.children || []) n += countElements(c);
  return n;
}

/** 把渲染树压成纯文本，便于断言内容 */
function flattenText(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (typeof node !== "object") return out;
  for (const c of node.children || []) flattenText(c, out);
  return out;
}

/**
 * 收集所有 `title`（还有 aria-label）。
 *
 * 「?」图标的说明挂在 title 上，不是可见文字 —— flattenText 看不到它。
 * 用户明确要求把常驻灰字挪进「悬停/点击出现」的提示里，所以判据也得跟着变：
 * 断言「挂在 title 上、够得着」，而不是「屏幕上看得见」。
 */
function collectTitles(node, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  const p = node.props || {};
  if (typeof p.title === "string") out.push(p.title);
  if (typeof p["aria-label"] === "string") out.push(p["aria-label"]);
  for (const c of node.children || []) collectTitles(c, out);
  return out;
}

/** 深度优先找第一个满足条件的元素（找不到返回 null）。 */
function findEl(node, pred) {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (node.props && pred(node)) return node;
  for (const c of node.children || []) {
    const hit = findEl(c, pred);
    if (hit) return hit;
  }
  return null;
}

/**
 * 收集所有 input / textarea 的 value。
 * 表单里的正文是 `value` 属性，不在 children 里 —— flattenText 看不到它。
 */
function collectValues(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const t = node.type;
  if ((t === "input" || t === "textarea" || t === "select") && node.props && "value" in node.props) {
    out.push(String(node.props.value));
  }
  for (const c of node.children || []) collectValues(c, out);
  return out;
}

/** 收集所有 select 的 option 文本 */
function collectOptionTexts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "option") flattenText(node, out);
  for (const c of node.children || []) collectOptionTexts(c, out);
  return out;
}

const shims = makeShims();
const { mod, id, sandbox } = loadFactory(shims);

// ── 1. 模块契约 ─────────────────────────────────────────────────────────────
{
  ok(id === "dsh-prompt-manager", "模块 id");
  ok(mod.name === "dsh-prompt-manager", "导出 name");
  ok(Array.isArray(mod.inject) && mod.inject.includes("slots"), "导出 inject 含 slots");
  ok(typeof mod.apply === "function", "导出 apply");
}

// ── 2. 槽位注册（现在有三处：会话头部 + 设置页 tab + 预热）───────────────────
const regs = [];
{
  const ctx = {
    slots: {
      inject(name, cb) {
        cb();
      },
      register(opts, Component) {
        regs.push({ opts, Component });
      },
    },
  };
  mod.apply(ctx);
  ok(regs.length === 2, "注册了 2 处槽位占用（会话头部入口 + 设置页 tab）");

  const header = regs.find((r) => r.opts.id === "prompt-picker");
  ok(!!header, "注册了会话头部动作位");
  ok(header.opts.name === "conversation.session.header.actions", "头部占用槽位正确");
  ok(typeof header.Component === "function", "头部注册的是组件");

  const tab = regs.find((r) => r.opts.name === "settings.plugins.tab");
  ok(!!tab, "注册了设置页 tab");
  ok(tab.opts.id === "prompt-manager", "tab 占用 id 正确");
  ok(typeof tab.Component === "function", "tab 注册的是组件");
  ok(typeof tab.opts.label === "function", "tab 带 label 函数");
  eq(tab.opts.label(), "提示词管理", "tab 标题正确");
  ok(typeof tab.opts.order === "number", "tab 带 order");
}

// ── 3. factory 必须**同步**交出 exports ────────────────────────────────────
// 这一条是补的：宿主曾经在 factory 里 `useChunk(loadHelpers)` 等一个 chunk，
// factory 于是抛出一个 pending Promise，`module.exports` 永远返回不了 ——
// 真机上报的是 `dsh-prompt-manager: import failed: [object Promise]`。
// 影子层当时既不管 hooks 规则、也不查返回值，所以测试全绿。
{
  ok(typeof mod.then !== "function", "factory 同步返回了 exports（不是 Promise）");
  ok(typeof mod.apply === "function", "导出里有 apply");
}

const headerReg = regs.find((r) => r.opts.id === "prompt-picker");
const PickerSlot = headerReg.Component;
const EditorSlot = regs.find((r) => r.opts.name === "settings.plugins.tab").Component;

// 走**真实路径**把两个槽位跑通：useChunk → require.async → chunk.create(api)。
//
// ⚠️ 这里必须渲染槽位包装组件本身（PickerSlot / EditorSlot），**不能绕过它**。
//    踩过的坑：测试直接 `modPicker.create(API)` 造组件，而宿主的 HeaderSlot
//    里忘了调 create —— 测试全绿，真机上 React #130（Element type is invalid:
//    got undefined），会话头部空一块。
{
  let pickerEl = null;
  try {
    pickerEl = await shims.renderAsync(PickerSlot, { sessionId: "warmup" });
  } catch (e) {
    ok(false, "会话头部槽位渲染不抛异常 —— 实际抛了: " + e.message);
  }
  ok(pickerEl !== null, "会话头部槽位渲染出了东西（不是 null）");

  // ⚠️ 这里**不能**断言「根元素的 type 是函数」—— PromptPicker 的根元素本来
  //    就是 `<span>`（状态点 + 按钮 + 预览 + ↻ 全在它里面），那是历史设计。
  //
  //    要抓的是 React #130（Element type is invalid: got undefined）：
  //    宿主忘了调 create(api) 时，`ui.PromptPicker` 是 undefined，
  //    createElement 收到 undefined 会**静默**产出一个坏元素 —— 真机上表现为
  //    「会话头部空了一块」+ 错误边界吞掉整个占用。
  //
  //    所以判据是「根元素存在，且是能渲染的东西（字符串标签或组件函数）」，
  //    再往下确认里面真的有可点的按钮。
  if (pickerEl) {
    const t = pickerEl.type;
    ok(
      typeof t === "function" || typeof t === "string",
      `会话头部根元素是可渲染的类型（实际 ${t === undefined ? "undefined ← 就是 #130" : typeof t}）`,
    );
    ok(countElements(pickerEl) > 1, "会话头部渲染出的不只是个光壳（有按钮等子元素）");
    const texts = flattenText(pickerEl);
    ok(
      texts.some((x) => x.includes("▾")),
      "会话头部有那个带 ▾ 的选择按钮（说明 PromptPicker 真的跑起来了，不是空壳）",
    );
  }

  // 设置页那一栏是按需拉的（会话头部不预热它），显式走一遍
  let editorEl = null;
  try {
    editorEl = await shims.renderAsync(EditorSlot, {});
  } catch (e) {
    ok(false, "设置页槽位渲染不抛异常 —— 实际抛了: " + e.message);
  }
  ok(editorEl !== null, "设置页槽位渲染出了东西（不是 null）");
  if (editorEl) {
    const t = editorEl.type;
    ok(
      typeof t === "function" || typeof t === "string",
      `设置页根元素是可渲染的类型（实际 ${t === undefined ? "undefined ← 就是 #130" : typeof t}）`,
    );
    ok(countElements(editorEl) > 3, "设置页渲染出了内容（不是空壳）");
  }
}
ok(!!sandbox.lastApi, "宿主真的把 api 交给了 chunk");
ok(
  sandbox.loadedChunks.includes("dsh-prompt-manager/client.picker.js"),
  "会话头部入口按需拉起了 picker chunk",
);
ok(
  sandbox.loadedChunks.includes("dsh-prompt-manager/client.preview.js"),
  "预览 chunk 跟面板**一起**拉起（点预览那一刻才炸是这条链最容易断的地方）",
);
const modPicker = sandbox.cache.get("dsh-prompt-manager/client.picker.js");
const modEditor = sandbox.cache.get("dsh-prompt-manager/client.editor.js");
ok(!!modPicker, "拿得到 picker chunk 模块");
ok(!!modEditor, "拿得到 editor chunk 模块");

const API = sandbox.lastApi;
ok(!!API, "抓到宿主交给 chunk 的那一份 api");
ok(typeof modPicker.create === "function", "picker chunk 导出了 create");
ok(typeof modEditor.create === "function", "editor chunk 导出了 create");

// ⚠️ 用 strictApi 包一层：`api.style.X` 读不到就直接抛。
//
// 拆包时宿主 CHUNK_API 漏给了 62 个样式常量，而 chunk 里读到的就是 undefined ——
// `style: undefined` 是**合法的**（等于没样式），React 不吭声，测试全绿，
// 真机上表现是「设置页那一栏整片空白」。包成抛错之后这类缺口藏不住了。
const strict = strictApi(API);
// 注意：真正的宿主已经用 **自己那份 api** 调过 create 了（上面两个槽位）。
// 这里再拿 strict 包过的 api 造一份，是为了让「缺常量」在测试里炸出来。
const pickerBox = modPicker.create(strict.api);
const editorBox = modEditor.create(strict.api);
const Picker = pickerBox.PromptPicker;
const Editor = editorBox.PromptEditor;
ok(typeof Picker === "function", "create(api) 造出了 PromptPicker");
ok(typeof Editor === "function", "create(api) 造出了 PromptEditor");
eq(strict.missing, [], "chunk 要的样式常量宿主一个没漏（漏一个界面就空白）");

// 预览面板：宿主是把整块跟面板**一起**拉好、随 props 交给面板的
// （点预览那一刻才炸是这条链最容易断的地方，见 client.js 里那段注释）。
sandbox.preload("client.preview.js");
const modPreview = sandbox.cache.get("dsh-prompt-manager/client.preview.js");
ok(!!modPreview, "拿得到 preview chunk 模块");
const previewBox = modPreview.create(strict.api);
ok(typeof previewBox.PreviewPanel === "function", "create(api) 造出了 PreviewPanel");

// 浮层外壳：面板和预览各自带一份（没有独立 chunk —— 拆包时那个 chunk 是死代码，删了）。
// 这里只确认两边都真的定义了自己的 Overlay，别哪天又变成「引用了别人文件里的名字」。
{
  const each = [
    ["client.picker.js", "多选面板"],
    ["client.preview.js", "预览"],
  ];
  for (const [file, what] of each) {
    const one = readFileSync(join(HERE, "..", file), "utf8");
    ok(/function Overlay\(props\)/.test(one), what + "自带 Overlay 定义");
  }
}

/** 渲染 Picker —— 走影子层「按真 React 语义」那条路（同一实例、可重试）。 */
const renderPicker = (props) =>
  shims.render(Picker, Object.assign({ PreviewPanel: previewBox.PreviewPanel }, props));
/** 渲染 Editor。 */
const renderEditor = (props = {}) => shims.render(Editor, props);

// ── 4. 没有 sessionId 时不渲染 ──────────────────────────────────────────────
{
  shims.setStates([]);
  const el = renderPicker({ sessionId: undefined });
  ok(el === null, "无 sessionId 时返回 null（不渲染无效控件）");
}

// ── 4. 常态渲染（未打开预览）───────────────────────────────────────────────
{
  const data = {
    assignments: {},
    prompts: [
      { id: "none", name: "不注入", mode: "none", tokens: 0 },
      { id: "gen4", name: "格式契约", mode: "append", tokens: 1200 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // useState 顺序：data / busy / err / preview / live / message
  shims.setStates([data, false, null, null, null, null]);
  let el;
  try {
    el = renderPicker({ sessionId: "session-live-0001" });
    ok(true, "常态渲染不抛异常");
  } catch (e) {
    ok(false, "常态渲染不抛异常 —— 实际抛了: " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("预览"), "渲染出预览按钮");
    ok(text.includes("↻"), "渲染出重载按钮");
    ok(countElements(el) > 3, "渲染出多个元素（" + countElements(el) + " 个）");
  }
}

// ── 5. ⚠️ 关键：预览弹窗打开时必须能渲染 ───────────────────────────────────
// 这就是线上那个「点预览后组件全没了」的场景。
{
  const previewData = {
    outcome: "ok",
    sessionId: "session-live-0001",
    promptId: "gen4",
    mode: "append",
    sectionCount: 2,
    sectionTokens: 100,
    contextCount: 1,
    contextTokens: 10,
    toolCount: 2,
    toolTokens: 500,
    totalTokens: 610,
    interpolated: true,
    rendered: { text: "渲染后的提示词 {{已替换}}", tokens: 100, chars: 20 },
    renderedContext: { text: "ctx", tokens: 5, chars: 3 },
    logged: {
      ok: true,
      // 模拟 dsh 已插值完的日志正文：这里的 cwd 是**替换后的结果**（不是模板）。
      // 路径用 X:\test，跟任何人的真实环境脱钩。
      text: "You are powered by the gpt-5 model.\ncwd is X:\\test\\work",
      tokens: 20,
      chars: 50,
      turn: 3,
      step: 1,
      messageCount: 4,
      eventCount: 120,
      atSeq: 99,
    },
    sections: [
      { name: "prompt-manager:gen4", text: "载荷正文", tokens: 50, chars: 4, complete: false },
      { name: "harness:identity", text: "身份", tokens: 12, chars: 2, complete: false },
    ],
    contexts: [{ name: "c1", text: "上下文", tokens: 10, chars: 3 }],
    tools: [
      { name: "bash", tokens: 400, chars: 900 },
      { name: "read", tokens: 100, chars: 200 },
    ],
    variables: { model: "x", cwd: "X:\\test\\y" },
    conflict: null,
  };
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } };
  shims.setStates([data, false, null, previewData, null, null]);
  let el;
  try {
    el = renderPicker({ sessionId: "session-live-0001" });
    ok(true, "预览打开时渲染不抛异常（线上崩溃场景）");
  } catch (e) {
    ok(false, "预览打开时渲染不抛异常 —— 实际抛了: " + e.stack.split("\n")[0]);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("最终系统提示词预览"), "弹窗标题在");
    ok(text.includes("模型实际收到"), "汇总块在");
    ok(text.includes("系统提示词正文（模型上次实际收到的）"), "会话日志块标题在");
    ok(text.includes("不含下面的工具定义"), "明确说明这份不含工具定义");
    ok(text.includes("gpt-5 model"), "会话日志里的提示词正文被渲染出来");
    ok(text.includes("X:\\test\\work"), "日志里的 cwd 已替换（不是模板）");
    ok(text.includes("第 3 轮 / 第 1 步"), "显示日志事件的轮次/步数");
    ok(text.includes("prompt-manager:gen4"), "section 列表在");
    ok(text.includes("bash"), "工具列表在");
    ok(shims.portals.length === 1, "弹窗被 portal 到 document.body（实际 " + shims.portals.length + " 次）");
    ok(shims.portals[0] && shims.portals[0].target && shims.portals[0].target.__isBody === true, "portal 目标是 body");
  }
}

// ── 5b. 会话日志读不到时的渲染 —— 必须说清卡在哪 ────────────────────────────
{
  const previewData = {
    outcome: "ok",
    sectionCount: 1,
    sectionTokens: 10,
    contextCount: 0,
    contextTokens: 0,
    toolCount: 0,
    toolTokens: 0,
    totalTokens: 10,
    interpolated: false,
    rendered: null,
    logged: {
      ok: false,
      reason: "session 上没有 snapshotEvents()，取不到会话日志",
      availableMethods: ["append", "header", "requestHeader"],
    },
    sections: [{ name: "a", text: "x", tokens: 10, chars: 1 }],
    contexts: [],
    tools: [],
    conflict: null,
  };
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } };
  shims.setStates([data, false, null, previewData, null, null]);
  let el;
  try {
    el = renderPicker({ sessionId: "s1" });
    ok(true, "日志读不到时渲染不抛异常");
  } catch (e) {
    ok(false, "日志读不到时渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("读不到"), "标题标明读不到");
    ok(text.includes("snapshotEvents"), "把具体原因写出来（不是含糊的『还没跑过』）");
    ok(text.includes("append"), "列出 session 上真实可用的方法");
  }
}

// ── 5c. 有事件但没有 system/message → 要报出真实的事件类型 ──────────────────
{
  const previewData = {
    outcome: "ok",
    sectionCount: 0,
    sectionTokens: 0,
    contextCount: 0,
    contextTokens: 0,
    toolCount: 0,
    toolTokens: 0,
    totalTokens: 0,
    interpolated: false,
    rendered: null,
    logged: {
      ok: false,
      reason: "日志里有 120 条事件，但一条 system/message 都没有",
      eventCount: 120,
      eventTypes: [["user/message", 60], ["assistant/message", 58], ["request/header", 2]],
    },
    sections: [],
    contexts: [],
    tools: [],
    conflict: null,
  };
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } };
  shims.setStates([data, false, null, previewData, null, null]);
  try {
    const el = renderPicker({ sessionId: "s1" });
    const text = flattenText(el).join(" ");
    ok(text.includes("120 条事件"), "报出事件总数");
    ok(text.includes("user/message×60"), "列出真实的事件类型与条数");
  } catch (e) {
    ok(false, "该场景渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 6. 预览的各种边界数据都不能让渲染炸 ─────────────────────────────────────
{
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } };
  const cases = [
    ["错误响应", { outcome: "awaiting-agent", error: "agent 未加载" }],
    ["错误 + hint", { outcome: "assemble-threw", error: "组装失败", hint: "persona 冲突" }],
    ["渲染失败", { outcome: "ok", interpolated: false, rendered: { error: "未知变量" }, sections: [] }],
    ["无渲染结果", { outcome: "ok", sections: [], contexts: [], tools: [] }],
    ["logged 缺失", { outcome: "ok", sections: [], contexts: [], tools: [] }],
    ["logged 为 null", { outcome: "ok", logged: null, sections: [], contexts: [], tools: [] }],
    ["logged 只有 reason", { outcome: "ok", logged: { ok: false, reason: "x" }, sections: [], contexts: [], tools: [] }],
    ["冲突", { outcome: "ok", mode: "replace", sections: [{ name: "x", text: "", tokens: 0, chars: 0 }], conflict: { kind: "k", message: "冲突了", hint: "h" } }],
    ["缺字段", {}],
    ["null 数组项", { outcome: "ok", sections: [null], contexts: [null], tools: [null] }],
  ];
  for (const [label, previewData] of cases) {
    shims.setStates([data, false, null, previewData, null, null]);
    try {
      renderPicker({ sessionId: "s1" });
      ok(true, "渲染不炸: " + label);
    } catch (e) {
      ok(false, "渲染不炸: " + label + " —— 抛了 " + e.message);
    }
  }
}

// ── 7. 通信失败时的渲染 ────────────────────────────────────────────────────
{
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: false, routeError: "路由没注册", sessions: [] } };
  shims.setStates([data, false, "GET HTTP 401", null, null, null]);
  try {
    const el = renderPicker({ sessionId: "s1" });
    ok(true, "通信失败时渲染不抛异常");
    const text = flattenText(el).join(" ");
    ok(text.includes("401"), "错误信息出现在界面上（不是静默的）");
  } catch (e) {
    ok(false, "通信失败时渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 8. 提示条渲染 ──────────────────────────────────────────────────────────
{
  const data = { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } };
  shims.setStates([data, false, null, null, null, "已重载 5 条提示词"]);
  try {
    const el = renderPicker({ sessionId: "s1" });
    ok(flattenText(el).join(" ").includes("已重载 5 条"), "操作提示条被渲染出来");
  } catch (e) {
    ok(false, "提示条渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5d. 多选面板：打开后要能列出全部提示词 ─────────────────────────────────
// Picker 的 useState 顺序：data / busy / err / preview / picking / message
// 面板自己的 useState 接着排：selected / err
{
  const data = {
    assignments: {},
    defaults: [],
    prompts: [
      { id: "a", name: "甲", mode: "append", order: 100, tokens: 50, description: "甲的说明" },
      { id: "b", name: "乙", mode: "append", order: 200, tokens: 60 },
      { id: "repl", name: "替换", mode: "replace", order: 10, tokens: 20 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // picking = true，面板初始选中 ["a"]
  shims.setStates([data, false, null, null, true, null, ["a"], null]);
  let el;
  try {
    el = renderPicker({ sessionId: "s1" });
    ok(true, "多选面板渲染不抛异常");
  } catch (e) {
    ok(false, "多选面板渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("选择本会话的提示词"), "面板标题在");
    ok(text.includes("甲") && text.includes("乙") && text.includes("替换"), "三条提示词都列出来");
    ok(text.includes("order 100"), "显示 order");
    ok(text.includes("甲的说明"), "显示说明文字");
    ok(text.includes("应用"), "有应用按钮");
    ok(text.includes("跟随默认"), "有跟随默认按钮");
    ok(text.includes("不注入"), "有不注入按钮");
    ok(text.includes("已选 1 条"), "底部汇总已选数量");
  }
}

// ── 5e. 多选面板：不再有"非法组合"这回事（替换模式已删除）──────────────────
{
  const data = {
    assignments: {},
    defaults: [],
    prompts: [
      { id: "a", name: "甲", mode: "append", order: 100, tokens: 50 },
      { id: "b", name: "乙", mode: "append", order: 200, tokens: 60 },
      { id: "c", name: "丙", mode: "append", order: 2900, tokens: 70 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // 全选上 —— 任意多条 append 都是合法的，不该出现任何警告
  shims.setStates([data, false, null, null, true, null, ["a", "b", "c"], null]);
  try {
    const el = renderPicker({ sessionId: "s1" });
    const text = flattenText(el).join(" ");
    ok(!text.includes("组合不合法"), "全选也不再提示组合问题");
    ok(!text.includes("静默丢弃"), "不再有「会被丢弃」的警告");
    ok(text.includes("已选 3 条"), "三条都算数");
    ok(text.includes("应用"), "应用按钮在");
  } catch (e) {
    ok(false, "全选场景渲染不抛异常 —— 抛了 " + e.message);
  }

  // 模式标签里不该再有「替换」
  shims.setStates([data, false, null, null, true, null, ["a"], null]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(!text.includes("替换"), "模式选项里不再出现「替换」");
  } catch (e) {
    ok(false, "单个 append 渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5e2. 多选面板：按分类分组 + 整类全选 ───────────────────────────────────
{
  const CATS = [
    { id: "identity", name: "身份", order: 20, hint: "" },
    { id: "tool", name: "工具", order: 3000, hint: "" },
    { id: "other", name: "其他", order: 100, hint: "" },
  ];
  const data = {
    assignments: {},
    defaults: [],
    categories: CATS,
    customCategories: ["安全审查"],
    prompts: [
      { id: "i1", name: "人设甲", category: "identity", mode: "append", order: 20, tokens: 10 },
      { id: "i2", name: "人设乙", category: "identity", mode: "append", order: 30, tokens: 11 },
      { id: "t1", name: "工具偏好", category: "tool", mode: "append", order: 3000, tokens: 20 },
      { id: "c1", name: "安全规矩", category: "安全审查", mode: "append", order: 100, tokens: 30 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // 一个都没选
  shims.setStates([data, false, null, null, true, null, [], null]);
  let el;
  try {
    el = renderPicker({ sessionId: "s1" });
    ok(true, "分组渲染不抛异常");
  } catch (e) {
    ok(false, "分组渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("身份"), "显示「身份」组标题");
    ok(text.includes("工具"), "显示「工具」组标题");
    ok(text.includes("安全审查"), "显示自定义分类组标题");
    ok(text.includes("自定义分类"), "自定义组有标记");
    ok(text.includes("全选本类"), "每组有「全选本类」按钮");
    ok(!text.includes("清空本类"), "没选时不显示「清空本类」");

    // 三组 → 三个全选按钮
    const btns = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.type === "button" && n.props && n.props["data-cat-toggle"]) btns.push(n.props["data-cat-toggle"]);
      for (const c of n.children || []) walk(c);
    })(el);
    eq(btns.sort(), ["identity", "tool", "安全审查"], "三个分组各有一个整类按钮");
    void text;
  }

  // 整组选满 → 按钮变成「清空本类」
  shims.setStates([data, false, null, null, true, null, ["i1", "i2"], null]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("清空本类"), "身份组选满后按钮变「清空本类」");
    ok(text.includes("全选本类"), "其他组仍是「全选本类」");
  } catch (e) {
    ok(false, "选满一组渲染不抛异常 —— 抛了 " + e.message);
  }

  // 只有一组时，不显示组标题（免得满屏小标题）
  shims.setStates([
    { ...data, prompts: [{ id: "only", name: "唯一", category: "tool", mode: "append", order: 3000, tokens: 5 }] },
    false, null, null, true, null, [], null,
  ]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("唯一"), "单组时条目照常显示");
    ok(!text.includes("全选本类"), "单组时不显示整类按钮");
  } catch (e) {
    ok(false, "单组渲染不抛异常 —— 抛了 " + e.message);
  }

  // 边界：没有 categories 字段（老宿主）
  shims.setStates([
    { ...data, categories: undefined, customCategories: undefined },
    false, null, null, true, null, [], null,
  ]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("安全审查"), "没有内置分类表时，用条目自带分类名");
    ok(text.includes("人设甲"), "条目照常显示");
  } catch (e) {
    ok(false, "缺 categories 字段时不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5f. 入口按钮显示当前选择（含来自默认时的区分）──────────────────────────
{
  const data = {
    assignments: { s2: ["a", "b"] },
    defaults: ["repl"],
    prompts: [
      { id: "a", name: "甲", mode: "append", order: 100, tokens: 50 },
      { id: "b", name: "乙", mode: "append", order: 200, tokens: 60 },
      { id: "repl", name: "替换", mode: "replace", order: 10, tokens: 20 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // s2 显式有两条
  shims.setStates([data, false, null, null, false, null]);
  let el = renderPicker({ sessionId: "s2" });
  let text = flattenText(el).join(" ");
  ok(text.includes("甲 +1"), "显式多条时按钮显示「首条 +N」");
  ok(!text.includes("·默认"), "显式指定时不加「默认」标记");

  // s3 没有显式记录 → 用默认
  shims.setStates([data, false, null, null, false, null]);
  el = renderPicker({ sessionId: "s3" });
  text = flattenText(el).join(" ");
  ok(text.includes("替换"), "未指定时按钮显示默认那条的名字");
  ok(text.includes("·默认"), "来源可见：标出「来自全局默认」");
}

// ── 5g. 空选中时按钮显示「不注入」──────────────────────────────────────────
{
  const data = {
    assignments: { s4: [] },
    defaults: ["a"],
    prompts: [{ id: "a", name: "甲", mode: "append", order: 100, tokens: 50 }],
    diag: { routeRegistered: true, sessions: [] },
  };
  shims.setStates([data, false, null, null, false, null]);
  const text = flattenText(renderPicker({ sessionId: "s4" })).join(" ");
  ok(text.includes("不注入"), "显式空数组时显示「不注入」（即使默认里有东西）");
}

// ── 5i. **改了原生段落时，会话头不能再说「不注入」** ──────────────────────
//
// 真机上踩过：以前这里只有「注入」一个概念 —— 没有自设提示词就显示「不注入」。
// 但你如果**改了 dsh 原本的段落**，它也显示「不注入」，**那是在骗人**：
// 你会以为改动没生效，然后反复折腾。
//
// 现在分成两件事算，再合起来说：
//   注入 = 你加了自己的提示词（按会话）
//   改写 = 你改了 dsh 原本的段落（**目前是全局的**）
{
  const base = {
    assignments: {},
    defaults: [],
    prompts: [{ id: "a", name: "甲", mode: "append", order: 100, tokens: 50 }],
    diag: { routeRegistered: true, sessions: [] },
  };

  // ① 什么都没动 → 默认
  shims.setStates([base, false, null, null, false, null]);
  const t0 = flattenText(renderPicker({ sessionId: "s9" })).join(" ");
  ok(!t0.includes("改原生"), "什么都没动时不提改写");

  // ② 只改了原生段落，没加自设提示词
  shims.setStates([
    Object.assign({}, base, {
      sectionOverrides: { "harness:identity": { action: "replace", text: "我的身份" } },
    }),
    false,
    null,
    null,
    false,
    null,
  ]);
  const t1 = flattenText(renderPicker({ sessionId: "s9" })).join(" ");
  ok(
    !t1.includes("不注入"),
    "**改了原生段落时，绝不能说「不注入」**（以前就是这么骗人的）",
  );
  ok(t1.includes("改原生 1 段"), "如实标出改了 1 段原生段落");

  // ③ 两个都有 → 名字仍然要在（会话头一眼要看出这条提示词叫啥）
  shims.setStates([
    Object.assign({}, base, {
      assignments: { s9: ["a"] },
      sectionOverrides: {
        "harness:identity": { action: "replace", text: "x" },
        "tool:bash": { action: "disable", text: "" },
      },
    }),
    false,
    null,
    null,
    false,
    null,
  ]);
  const t2 = flattenText(renderPicker({ sessionId: "s9" })).join(" ");
  ok(t2.includes("甲"), "**提示词名字仍然显示**（不能被改写信息挤掉）");
  ok(t2.includes("改原生 2 段"), "改写数量也对");
}

// ── 5h. 设置页编辑器：列表渲染 ─────────────────────────────────────────────
// PromptEditor 的 useState 顺序：list / busy / err / edit / message
{
  const listData = {
    prompts: [
      {
        id: "format-contract",
        name: "格式契约",
        description: "正向格式载荷",
        mode: "append",
        order: 100,
        source: "file",
        file: "format-contract.md",
        tokens: 1200,
        chars: 4300,
        text: "正文内容",
      },
      { id: "plain", name: "普通", description: "", mode: "none", order: 100, source: "none", tokens: 0, chars: 0, text: "" },
    ],
    catalogPath: "X:\\test\\catalog.json",
    promptsDir: "X:\\test\\prompts",
    libraryErrors: [],
  };
  shims.setStates([listData, false, null, null, null]);
  let el;
  try {
    el = renderEditor({});
    ok(true, "编辑器渲染不抛异常");
  } catch (e) {
    ok(false, "编辑器渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("提示词管理"), "标题在");
    ok(text.includes("2 条"), "显示条数");
    ok(text.includes("格式契约"), "列出条目名");
    ok(text.includes("format-contract"), "显示 id");
    ok(text.includes("正向格式载荷"), "显示说明");
    ok(text.includes("新建"), "有新建按钮");
    ok(text.includes("刷新"), "有刷新按钮");
    ok(text.includes("X:\\test\\prompts"), "显示正文目录");
    // ⚠️ 页脚现在**只有**这一行。原来堆了四条并列说明（order 怎么算、哪层生效、
    //    保存后会发生什么、正文写在哪），叠在一起就是一片灰字没人看。
    ok(!text.includes("order 决定插入位置"), "**页脚不再堆 order 说明**（挪进每条卡片的详情里了）");
    ok(!text.includes("主动重挂"), "**页脚不再解释重挂机制**（那是实现细节）");
    // 折叠态：模式徽章 + 展开箭头，但**不应**出现详情与操作按钮
    ok(text.includes("追加"), "折叠态显示模式徽章");
    ok(text.includes("不注入"), "另一条的模式徽章也在");
    ok(text.includes("›"), "折叠态有展开箭头");
    ok(!text.includes("4300 字符"), "折叠态不显示字符数（在详情里）");
    ok(!text.includes("format-contract.md"), "折叠态不显示正文文件名");
    // 但「新会话默认」卡片是默认展开的 —— 它管所有新会话，优先级最高
    ok(text.includes("新会话默认"), "默认卡片在");
  }
}

// ── 5h2. 设置页编辑器：展开某张卡片 ────────────────────────────────────────
// 交互对齐原生插件列表：点卡片头展开详情，同一时刻只开一张。
{
  const listData = {
    prompts: [
      {
        id: "format-contract",
        name: "格式契约",
        description: "正向格式载荷",
        mode: "append",
        order: 100,
        source: "file",
        file: "format-contract.md",
        tokens: 1200,
        chars: 4300,
        text: "正文内容",
      },
      { id: "plain", name: "普通", description: "", mode: "none", order: 100, source: "none", tokens: 0, chars: 0, text: "" },
    ],
    promptsDir: "X:\\test\\prompts",
    libraryErrors: [],
  };
  // openId 在索引 5
  shims.setStates([listData, false, null, null, null, "format-contract"]);
  let el;
  try {
    el = renderEditor({});
    ok(true, "展开态渲染不抛异常");
  } catch (e) {
    ok(false, "展开态渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("1200 tokens"), "展开后显示 token");
    ok(text.includes("4300 字符"), "展开后显示字符数");
    ok(text.includes("format-contract.md"), "展开后显示正文文件名");
    ok(text.includes("100 = persona 之后"), "展开后解释 order 含义");
    ok(text.includes("编辑"), "展开后有编辑按钮");
    ok(text.includes("删除"), "展开后有删除按钮");
    ok(text.includes("正文内容"), "展开后显示正文");
  }

  // 展开「不注入」那条：正文一栏要说清是"无"
  shims.setStates([listData, false, null, null, null, "plain"]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("无（不注入模式）"), "none 模式的正文栏说明为无");
  } catch (e) {
    ok(false, "展开 none 条目不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5i. 设置页编辑器：编辑表单 ─────────────────────────────────────────────
{
  const listData = {
    prompts: [
      { id: "a", name: "甲", description: "d", mode: "append", order: 100, source: "file", file: "a.md", tokens: 5, chars: 20, text: "甲的正文" },
    ],
    promptsDir: "X:\\test\\prompts",
    libraryErrors: [],
  };
  // 打开编辑：edit 状态在索引 3
  shims.setStates([
    listData,
    false,
    null,
    { isNew: false, id: "a", name: "甲", description: "d", mode: "append", order: 100, text: "甲的正文" },
    null,
  ]);
  let el;
  try {
    el = renderEditor({});
    const text = flattenText(el).join(" ");
    const values = collectValues(el);
    ok(values.includes("甲的正文"), "表单里带出现有正文（在 textarea 的 value 里）");
    ok(values.includes("甲"), "名称预填");
    ok(values.includes("a"), "id 预填");
    ok(text.includes("保存"), "有保存按钮");
    ok(text.includes("取消"), "有取消按钮");
    ok(text.includes("保存到 prompts/a.md"), "提示保存位置");
    ok(text.includes("约 4 字符"), "显示正文长度");
  } catch (e) {
    ok(false, "编辑表单渲染不抛异常 —— 抛了 " + e.message);
  }

  // 替换模式：要显示警告
  // 模式下拉框里只应有「追加 / 不注入」两个选项（替换已删除）
  {
    const opts = collectOptionTexts(el).join(" ");
    ok(!opts.includes("替换"), "模式下拉框里没有「替换」");
    ok(opts.includes("追加"), "有「追加」");
    ok(opts.includes("不注入"), "有「不注入」");
  }

  // none 模式：不该有 textarea，且要说明会删文件
  shims.setStates([
    listData,
    false,
    null,
    { isNew: false, id: "a", name: "甲", description: "", mode: "none", order: 100, text: "旧正文" },
    null,
  ]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("不需要正文"), "none 模式说明会删文件");
    ok(!text.includes("旧正文"), "none 模式不显示正文编辑框");
  } catch (e) {
    ok(false, "none 模式表单不抛异常 —— 抛了 " + e.message);
  }

  // 新建：id 非法要给提示
  shims.setStates([
    listData,
    false,
    null,
    { isNew: true, id: "坏 id", name: "", description: "", mode: "append", order: 100, text: "" },
    null,
  ]);
  try {
    const el2 = renderEditor({});
    const text2 = flattenText(el2).join(" ");
    ok(text2.includes("id 非法"), "非法 id 当场提示");
    ok(
      text2.includes("保存到 prompts/坏 id.md"),
      "新建时提示保存目标路径（用当前 id）",
    );
  } catch (e) {
    ok(false, "新建表单不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5j. 编辑器边界数据不能让渲染炸 ─────────────────────────────────────────
{
  const cases = [
    ["list 为 null", [null, false, null, null, null]],
    ["prompts 为空", [{ prompts: [] }, false, null, null, null]],
    ["prompts 缺字段", [{ prompts: [{}] }, false, null, null, null]],
    ["prompts 含 null", [{ prompts: [null, { id: "a", name: "甲" }] }, false, null, null, null]],
    ["有错误", [{ prompts: [] }, false, "GET HTTP 401", null, null]],
    ["有提示条", [{ prompts: [] }, false, null, null, "已保存"]],
  ];
  for (const [label, states] of cases) {
    shims.setStates(states);
    try {
      renderEditor({});
      ok(true, "编辑器边界不炸: " + label);
    } catch (e) {
      ok(false, "编辑器边界不炸: " + label + " —— 抛了 " + e.message);
    }
  }
}

// ── 5h3. 设置页编辑器：「新会话默认」卡片 ──────────────────────────────────
// useState 顺序：list / busy / err / edit / message / openId / defaultsDraft / defaultsBusy
{
  const listData = {
    prompts: [
      { id: "gen4", name: "格式契约", description: "载荷", mode: "append", order: 100, source: "file", file: "gen4.md", tokens: 1200, chars: 4300, text: "x" },
      { id: "gen3", name: "格式契约甲", description: "", mode: "append", order: 100, source: "file", file: "gen3.md", tokens: 900, chars: 3000, text: "y" },
      { id: "none", name: "不注入", description: "", mode: "none", order: 100, source: "none", tokens: 0, chars: 0, text: "" },
    ],
    promptsDir: "X:\\test\\prompts",
    defaults: ["gen4"],
    libraryErrors: [],
  };

  // 已保存 1 条，草稿与之一致 → 不是 dirty
  shims.setStates([listData, false, null, null, null, null, ["gen4"], false]);
  let el;
  try {
    el = renderEditor({});
    ok(true, "默认卡片渲染不抛异常");
  } catch (e) {
    ok(false, "默认卡片渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("新会话默认"), "有「新会话默认」卡片");
    ok(text.includes("当前 1 条"), "显示当前默认条数");
    ok(text.includes("新会话将挂 1 条"), "底部说明当前状态");
    ok(!text.includes("有未保存的改动"), "没有未保存改动时不提示");
    ok(text.includes("保存默认"), "有保存按钮");
    ok(text.includes("清空"), "有清空按钮");
    ok(text.includes("格式契约") && text.includes("格式契约甲"), "两条可选");
    // 「不注入」模式的条目不参与默认
    const boxes = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.type === "input" && n.props && n.props.type === "checkbox") boxes.push(n);
      for (const c of n.children || []) walk(c);
    })(el);
    eq(boxes.length, 2, "只有 2 个勾选框（不注入那条被排除）");
    eq(boxes[0].props.checked, true, "gen4 已勾选");
    eq(boxes[1].props.checked, false, "gen3 未勾选");
  }

  // 草稿与已保存不同 → 提示有未保存改动
  shims.setStates([listData, false, null, null, null, null, ["gen4", "gen3"], false]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("有未保存的改动"), "勾选变化后提示未保存");
    ok(text.includes("新会话将挂 2 条"), "按草稿算条数");
  } catch (e) {
    ok(false, "草稿态渲染不抛异常 —— 抛了 " + e.message);
  }

  // 默认清空 → 明确说"不注入"
  shims.setStates([{ ...listData, defaults: [] }, false, null, null, null, null, [], false]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("当前：不注入"), "默认空时显示不注入");
    ok(text.includes("新会话将不注入任何提示词"), "底部说明不注入");
  } catch (e) {
    ok(false, "空默认渲染不抛异常 —— 抛了 " + e.message);
  }

  // 库里没有可用的（只有 none 条目）
  shims.setStates([
    { prompts: [{ id: "none", name: "不注入", mode: "none", order: 100, source: "none", tokens: 0, chars: 0, text: "" }], promptsDir: "X:\\test", defaults: [], libraryErrors: [] },
    false, null, null, null, null, [], false,
  ]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("库里还没有可用的提示词"), "只有 none 条目的说明");
  } catch (e) {
    ok(false, "空库渲染不抛异常 —— 抛了 " + e.message);
  }

  // 边界：defaults 字段缺失 / 不是数组，都不能炸
  for (const [label, states] of [
    ["defaults 缺失", [{ prompts: [], promptsDir: "x", libraryErrors: [] }, false, null, null, null, null, undefined, false]],
    ["defaults 不是数组", [{ prompts: [], promptsDir: "x", defaults: "乱写", libraryErrors: [] }, false, null, null, null, null, "乱写", false]],
  ]) {
    shims.setStates(states);
    try {
      renderEditor({});
      ok(true, "默认卡片边界不炸: " + label);
    } catch (e) {
      ok(false, "默认卡片边界不炸: " + label + " —— 抛了 " + e.message);
    }
  }
}

// ── 5h4. 设置页编辑器：分类下拉 + 按分类分组 ───────────────────────────────
// useState 顺序：list / busy / err / edit / message / openId / defaultsDraft / defaultsBusy
{
  const CATS = [
    { id: "identity", name: "身份", order: 20, hint: "你是谁、语气、风格。" },
    { id: "domain", name: "领域", order: 500, hint: "项目知识、业务规则。" },
    { id: "tool", name: "工具", order: 3000, hint: "怎么用工具、工具偏好。" },
    { id: "output", name: "输出", order: 9500, hint: "输出格式、交付物约定。" },
    { id: "other", name: "其他", order: 100, hint: "不属于以上几类。" },
  ];
  const listData = {
    prompts: [
      { id: "p-id", name: "人设", category: "identity", mode: "append", order: 20, source: "file", file: "p-id.md", tokens: 10, chars: 40, text: "a" },
      { id: "p-tool", name: "工具偏好", category: "tool", mode: "append", order: 3000, source: "file", file: "p-tool.md", tokens: 20, chars: 80, text: "b" },
      { id: "p-custom", name: "安全规矩", category: "安全审查", mode: "append", order: 100, source: "file", file: "p-custom.md", tokens: 30, chars: 90, text: "c" },
      { id: "p-none", name: "不注入", category: "other", mode: "none", order: 100, source: "none", tokens: 0, chars: 0, text: "" },
    ],
    promptsDir: "X:\\test\\prompts",
    categories: CATS,
    customCategories: ["安全审查"],
    defaults: [],
    libraryErrors: [],
  };

  // ── 分组显示 ──
  shims.setStates([listData, false, null, null, null, null, [], false]);
  let el;
  try {
    el = renderEditor({});
    ok(true, "带分类渲染不抛异常");
  } catch (e) {
    ok(false, "带分类渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("身份"), "显示「身份」分组标题");
    ok(text.includes("工具"), "显示「工具」分组标题");
    ok(text.includes("安全审查"), "显示自定义分组的标题");
    ok(text.includes("自定义分类"), "自定义分组有标记");
    ok(text.includes("其他"), "显示「其他」分组");
    // 「领域」「输出」两组是空的，不该出现 hint 文字
    ok(!text.includes("项目知识、业务规则"), "空分类不渲染（领域）");
    ok(!text.includes("输出格式、交付物约定"), "空分类不渲染（输出）");
  }

  // ── 进入编辑态 → 表单里应有分类**下拉框**（不是 datalist）──
  // 注意：卡片展开看到的是**详情**（编辑/删除按钮）；表单要 edit 状态才渲染。
  //
  // v0.4.0：datalist 换成 select。用户反馈 `<input list>` 的下拉弹不出来、
  // 选不了 —— 那是原生控件，我这边看不到也调不动。select 的行为完全可控。
  shims.setStates([
    listData,
    false,
    null,
    { isNew: false, id: "p-tool", name: "工具偏好", description: "", category: "tool", mode: "append", order: 3000, text: "b" },
    null,
    "p-tool",
    [],
    false,
  ]);
  try {
    const el2 = renderEditor({});
    const text2 = flattenText(el2).join(" ");
    const selects = [];
    const texts = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.props && n.props["data-pm-category"] === "select") selects.push(n);
      if (n.props && n.props["data-pm-category"] === "text") texts.push(n);
      for (const c of n.children || []) walk(c);
    })(el2);
    eq(selects.length, 1, "展开后有一个分类下拉框");
    eq(selects[0].props.value, "tool", "下拉框预选当前分类");
    const opts = collectOptionTexts(selects[0]);
    ok(opts.some((o) => o.includes("身份")), "选项含内置分类「身份」");
    ok(opts.some((o) => o.includes("工具")), "选项含内置分类「工具」");
    ok(opts.some((o) => o.includes("安全审查")), "选项含目录里的自定义分类");
    ok(opts.some((o) => o.includes("自定义")), "有「＋ 自定义…」这一项");
    // 内置分类时**不**出现自由输入框
    eq(texts.length, 0, "内置分类时不显示自由输入框");
    ok(text2.includes("怎么用工具、工具偏好"), "显示该分类的 hint");
    ok(text2.includes("order 3000"), "显示 order 与它的落点说明");
  } catch (e) {
    ok(false, "展开带分类的条目不抛异常 —— 抛了 " + e.message);
  }

  // ── 自定义分类（目录里没有的新名字）→ 下拉框停在「＋ 自定义…」并出现输入框 ──
  // ⚠️ 必须用 prompts 里**真实存在**的 id —— renderRow() 只对列表里的条目渲染表单，
  //    随便编个 id 会什么都不出现（这里踩过一次）。
  shims.setStates([
    listData,
    false,
    null,
    { isNew: false, id: "p-id", name: "人设", description: "", category: "临时起的名字", mode: "append", order: 100, text: "x" },
    null,
    "p-id",
    [],
    false,
  ]);
  try {
    const el3 = renderEditor({});
    const selects = [];
    const texts = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.props && n.props["data-pm-category"] === "select") selects.push(n);
      if (n.props && n.props["data-pm-category"] === "text") texts.push(n);
      for (const c of n.children || []) walk(c);
    })(el3);
    eq(selects.length, 1, "自定义分类时仍有下拉框");
    ok(selects[0].props.value !== "tool", "下拉框没有假装选着某个内置类");
    eq(texts.length, 1, "**自定义分类时出现自由输入框**");
    eq(texts[0].props.value, "临时起的名字", "输入框带出当前的自定义名");
  } catch (e) {
    ok(false, "自定义分类表单不抛异常 —— 抛了 " + e.message);
  }

  // ── 已知的自定义分类（在 customCategories 里）→ 直接选中，不出现输入框 ──
  shims.setStates([
    listData,
    false,
    null,
    { isNew: false, id: "p-custom", name: "安全规矩", description: "", category: "安全审查", mode: "append", order: 100, text: "y" },
    null,
    "p-custom",
    [],
    false,
  ]);
  try {
    const el4 = renderEditor({});
    const selects = [];
    const texts = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.props && n.props["data-pm-category"] === "select") selects.push(n);
      if (n.props && n.props["data-pm-category"] === "text") texts.push(n);
      for (const c of n.children || []) walk(c);
    })(el4);
    eq(selects.length, 1, "已知自定义分类也有下拉框");
    eq(selects[0].props.value, "安全审查", "已知自定义分类在下拉框里被选中");
    eq(texts.length, 0, "已知自定义分类不需要额外输入框");
  } catch (e) {
    ok(false, "已知自定义分类表单不抛异常 —— 抛了 " + e.message);
  }

  // ── 新建时默认落在「身份」类，并带出建议 order ──
  shims.setStates([
    listData, false, null,
    { isNew: true, id: "brand-new", name: "新提示词", description: "", category: "identity", mode: "append", order: 20, text: "" },
    null, null, [], false,
  ]);
  try {
    const el3 = renderEditor({});
    const text3 = flattenText(el3).join(" ");
    const vals = collectValues(el3);
    ok(vals.includes("identity"), "新建表单里分类是 identity");
    ok(vals.includes("20") || text3.includes("order 20"), "带出身份类的建议 order 20");
  } catch (e) {
    ok(false, "新建表单不抛异常 —— 抛了 " + e.message);
  }

  // ── 边界：没有 categories 字段（老宿主）也要能渲染 ──
  shims.setStates([
    { prompts: [{ id: "a", name: "甲", category: "身份", mode: "append", order: 20, source: "file", file: "a.md", tokens: 1, chars: 2, text: "x" }], promptsDir: "X:\\test", defaults: [], libraryErrors: [] },
    false, null, null, null, null, [], false,
  ]);
  try {
    const text4 = flattenText(renderEditor({})).join(" ");
    ok(text4.includes("身份"), "没有内置分类表时，用条目自带的分类名当标题");
    ok(text4.includes("自定义分类"), "并标为自定义");
  } catch (e) {
    ok(false, "缺 categories 字段时不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5k. 预览汇总：说清运行时上下文是**另一条消息** ─────────────────────────
// v0.3.4：以前那行写的是「上下文段 2 段 = 0 tokens」—— 既没说是另一条消息，
// 0 又让人以为是坏了。现在分开措辞。
{
  const base = {
    outcome: "ok",
    sessionId: "s1",
    promptIds: [],
    sectionCount: 23,
    sectionTokens: 2672,
    contextCount: 0,
    contextTokens: 0,
    toolCount: 33,
    toolTokens: 5850,
    totalTokens: 8522,
    sections: [],
    contexts: [],
    tools: [],
    logged: { ok: false, reason: "测试" },
  };
  shims.setStates([{ assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } }, false, null, base, null, null]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("系统提示词 23 段"), "汇总里写明「系统提示词」而不是含糊的 sections");
    ok(text.includes("工具 schema 33 个"), "工具 schema 单独报");
    ok(text.includes("运行时上下文 0 段"), "运行时上下文单独报");
    ok(text.includes("单独一条消息"), "**说明运行时上下文不在正文里**");
    ok(text.includes("属正常"), "0 段时说明是正常的，不是坏了");
  } catch (e) {
    ok(false, "汇总渲染不抛异常 —— 抛了 " + e.message);
  }

  // 有上下文时换成另一种说明
  shims.setStates([
    { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } },
    false, null,
    { ...base, contextCount: 2, contextTokens: 140 },
    null, null,
  ]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("运行时上下文 2 段"), "有上下文时报出段数");
    ok(text.includes("比总数少一块"), "并解释正文为什么比总数少");
  } catch (e) {
    ok(false, "有上下文的汇总不抛异常 —— 抛了 " + e.message);
  }
}

// ── 5l. 预览：说清「系统提示词只在变化时才写日志」 ─────────────────────────
{
  const data = {
    outcome: "ok",
    sessionId: "s1",
    promptIds: [],
    sectionCount: 23,
    sectionTokens: 2672,
    contextCount: 2,
    contextTokens: 95,
    toolCount: 33,
    toolTokens: 5850,
    totalTokens: 8617,
    sections: [],
    contexts: [],
    tools: [],
    logged: {
      ok: true,
      text: "正文",
      chars: 10215,
      tokens: 2679,
      turn: 66,
      step: 1,
      messageCount: 12,
      eventCount: 10247,
    },
  };
  shims.setStates([
    { assignments: {}, prompts: [], diag: { routeRegistered: true, sessions: [] } },
    false, null, data, null, null,
  ]);
  try {
    const text = flattenText(renderPicker({ sessionId: "s1" })).join(" ");
    ok(text.includes("第 66 轮"), "报出记录所在的轮次");
    ok(text.includes("只在提示词「发生变化时」才写"), "**解释轮次看着旧是正常的**");
    ok(text.includes("当前生效的就是这一份"), "并说明它仍然是当前生效的那份");
    ok(text.includes("不含下面的工具定义"), "仍然说明不含工具定义");
    // 纯文本 UI 里不能出现 markdown 的星号 —— 会原样显示出来
    ok(!text.includes("**"), "没有会原样显示的 markdown 星号");
  } catch (e) {
    ok(false, "logged 块渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 9. 样式常量全部有定义（防「用了没定义」）────────────────────────────────
// 之前 ADVISE 就是被引用却漏了定义 —— 虽然 style:undefined 不致命，
// 但说明这类漏定义没有被任何机制挡住。现在静态扫一遍。
{
  const src = CLIENT_SRC;
  const defined = new Set();
  // 缩进跟着文件走：宿主 factory 里是 8 空格，chunk 的 create() 里是 6 空格。
  // 钉死 8 会让拆包之后这条断言「扫不到任何定义」，然后报一堆假缺失。
  for (const m of src.matchAll(/^ {4,10}var ([A-Z][A-Z0-9_]*) =/gm)) defined.add(m[1]);
  const used = new Set();
  for (const m of src.matchAll(/style: ([A-Z][A-Z0-9_]*)\b/g)) used.add(m[1]);
  const missing = [...used].filter((u) => !defined.has(u));
  ok(
    missing.length === 0,
    "所有 style 常量都有定义（缺失: " + (missing.join(", ") || "无") + "）",
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 「系统提示词」区块（v0.4.0 新增）
// ══════════════════════════════════════════════════════════════════════════
//
// PromptEditor 的 useState 顺序（新钩子一律加在**末尾**，免得打乱已有断言）：
//   0 list / 1 busy / 2 err / 3 edit / 4 message / 5 openId
//   6 defaultsDraft / 7 defaultsBusy
//   8 sections / 9 sectionsBusy / 10 openSection / 11 sectionDrafts
const EDITOR_BASE = [
  { prompts: [], defaults: [], categories: [], customCategories: [] }, // list
  false, // busy
  null, // err
  null, // edit
  null, // message
  null, // openId
  [], // defaultsDraft
  false, // defaultsBusy
];

/** 造一份 /sections 的返回。 */
function makeSectionsData(over = {}) {
  return Object.assign(
    {
      outcome: "ok",
      error: null,
      summary: "生效 1 · 官方已更新 1 · 未改动 1",
      applied: [
        {
          name: "plan:policy",
          index: 1,
          status: "apply",
          drifted: false,
          driftAcknowledged: false,
          original: "官方的策略原文",
          originalHash: "aaaa",
          basedOn: "官方的策略原文",
          basedOnHash: "aaaa",
          action: "replace",
          text: "我改的策略",
          savedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          name: "harness:identity",
          index: 0,
          status: "apply",
          drifted: true,
          driftAcknowledged: false,
          original: "官方的新版身份说明",
          originalHash: "bbbb",
          basedOn: "官方当初的旧版",
          basedOnHash: "cccc",
          action: "replace",
          text: "我的身份说明",
          savedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      drifted: [],
      stale: [],
      untouched: [
        {
          name: "tool:bash",
          index: 2,
          status: "untouched",
          drifted: false,
          driftAcknowledged: false,
          original: "bash 的官方说明",
          originalHash: "dddd",
          basedOn: "",
          basedOnHash: "",
          action: null,
          text: "",
          savedAt: "",
        },
      ],
      counts: { applied: 2, drifted: 1, stale: 0, untouched: 1, total: 3 },
      actions: ["replace", "disable"],
    },
    over,
  );
}

// ── 区块在，且列出段落 ────────────────────────────────────────────────────
{
  const data = makeSectionsData();
  data.drifted = [data.applied[1]];
  shims.setStates([...EDITOR_BASE, data, false, null, {}]);
  let el;
  try {
    el = renderEditor({});
    ok(true, "带 sections 数据渲染不抛异常");
  } catch (e) {
    ok(false, "带 sections 数据渲染不抛异常 —— 抛了 " + e.message);
    el = null;
  }
  if (el) {
    const text = flattenText(el).join(" ");
    ok(text.includes("系统提示词"), "有「系统提示词」区块标题");
    ok(text.includes("plan:policy"), "列出了段落名 plan:policy");
    ok(text.includes("harness:identity"), "列出了 harness:identity");
    ok(text.includes("tool:bash"), "列出了未改动的 tool:bash");
    ok(text.includes("已改写"), "改写的段落有「已改写」徽章");
    ok(text.includes("官方原文"), "未改动的段落标为「官方原文」");
    ok(text.includes("官方已更新"), "漂移的段落标为「官方已更新」");
    ok(text.includes("知道了"), "漂移段落有「知道了」按钮");
    ok(text.includes("官方更新过这一段"), "给出了漂移说明");
    ok(text.includes("照旧生效"), "**说明覆盖照旧生效**（不是「已停用」）");
    ok(text.includes("重新读取"), "有「重新读取」按钮");

    // ── 标题中文化 ────────────────────────────────────────────────────────
    // ⚠️ 中文名**只用于显示**。存储/匹配/跟服务端对照用的始终是原始 name，
    //    所以两者必须**同时出现**在卡片上。
    ok(text.includes("计划策略"), "plan:policy 显示为「计划策略」");
    ok(text.includes("harness 身份"), "harness:identity 显示为「harness 身份」（**不是「环境自述」** —— 正文讲的是身份，没提环境）");
    ok(
      text.includes("工具用法 · bash"),
      "tool:bash 显示为「工具用法 · bash」（tool: 前缀走模式兜底）",
    );
    ok(text.includes("plan:policy"), "**原始 name 仍然显示**（排查要用，也是服务端的键）");
    ok(text.includes("tool:bash"), "未改动段的原始 name 也在");
    // 实测存在的名字，我一开始漏了 —— 漏了会显示成兜底的「工具用法 · subagent_fork」
    ok(!/工具用法 · subagent_fork/.test(text), "subagent_fork 有中文名，不走兜底");
  }
}

// ── 关掉 / 失效 两种状态的徽章与提示 ──────────────────────────────────────
{
  const data = makeSectionsData({
    summary: "生效 1 · 已失效 1 · 未改动 0",
    applied: [
      {
        name: "tool:grep",
        index: 0,
        status: "apply",
        drifted: false,
        driftAcknowledged: false,
        original: "grep 官方说明",
        originalHash: "x",
        basedOn: "grep 官方说明",
        basedOnHash: "x",
        action: "disable",
        text: "",
        savedAt: "",
      },
    ],
    drifted: [],
    stale: [
      {
        name: "tool:旧名字",
        index: null,
        status: "stale",
        drifted: false,
        driftAcknowledged: false,
        original: "",
        originalHash: "",
        basedOn: "当年那段的原文",
        basedOnHash: "yyyy",
        action: "replace",
        text: "我当年的改写",
        savedAt: "",
      },
    ],
    untouched: [],
  });
  shims.setStates([...EDITOR_BASE, data, false, null, {}]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("已关掉"), "关掉的段落有「已关掉」徽章");
    ok(text.includes("tool:旧名字"), "列出了失效的段落");
    ok(text.includes("已失效"), "失效的段落有「已失效」徽章");
    ok(text.includes("不会再生效"), "失效段落说明了「不会再生效」");
    ok(text.includes("数据还留着"), "并且说明数据保留（不是被删了）");
  } catch (e) {
    ok(false, "关掉/失效状态渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 没有存活会话时不许炸（界面一打开就会请求，那时可能还没会话）──────────
{
  const data = makeSectionsData({
    outcome: "awaiting-agent",
    error: "还没有存活的会话，稍后再试",
    applied: [],
    drifted: [],
    stale: [],
    untouched: [],
    counts: { applied: 0, drifted: 0, stale: 0, untouched: 0, total: 0 },
    summary: "未改动 0",
  });
  shims.setStates([...EDITOR_BASE, data, false, null, {}]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("还没有存活的会话"), "如实说明为什么读不到");
    ok(text.includes("系统提示词"), "区块标题仍在（不是整块消失）");
  } catch (e) {
    ok(false, "awaiting-agent 状态渲染不抛异常 —— 抛了 " + e.message);
  }

  // sections 还是 null（首次加载中）
  shims.setStates([...EDITOR_BASE, null, false, null, {}]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("系统提示词") && text.includes("读取中"), "加载中也有标题和占位");
  } catch (e) {
    ok(false, "sections 为 null 时渲染不抛异常 —— 抛了 " + e.message);
  }
}

// ── 静态：段落卡片的头和提示框必须带内边距 ────────────────────────────────
//
// 真机上踩过：卡片头用了 `CARD_MAIN_ROW`（它**没有 padding**，只是个两端对齐的布局行），
// 结果标题和徽章紧贴卡片边框。渲染测试看不出来（节点都在、文案也对），
// 只有肉眼看截图才发现 —— 所以这里钉一条静态断言。
{
  const src = CLIENT_SRC;

  ok(
    /style:\s*Object\.assign\(\{\},\s*CARD_HEAD,/.test(src),
    "段落卡片的头合并了 CARD_HEAD（它才带内边距）",
  );
  // ⚠️ **必须显式写 flexDirection: "row"**。
  //    CARD_HEAD 是 column（原生卡片头竖排：标题 + 副标题），而 CARD_MAIN_ROW
  //    **没设 flexDirection** —— Object.assign 之后 column 会赢，
  //    于是名字/徽章/字数变成竖着三行居中，卡片又粗又居中。
  //    真机上就是这么错的（截图里一眼就看出来了，但渲染测试测不到）。
  ok(
    /flexDirection:\s*"row"/.test(src),
    '卡片头**显式**设了 flexDirection: "row"（否则继承 CARD_HEAD 的 column，会变三行）',
  );
  ok(
    /var CARD_NOTICE = \{ padding:/.test(src),
    "有 CARD_NOTICE 给「卡片里但不在正文区」的提示框补内边距",
  );
  const bare = [
    ...src.matchAll(
      /cardChildren\.push\(\s*react\.createElement\(\s*"div",\s*\{\s*key:\s*"(\w+)",\s*style:\s*(\w+)/g,
    ),
  ]
    .filter((m) => m[2] !== "CARD_NOTICE" && m[2] !== "CARD_DETAILS")
    .map((m) => m[1] + "→" + m[2]);
  eq(bare, [], "卡片里直接塞的元素都带内边距容器（CARD_NOTICE / CARD_DETAILS）");

  // ── `SECTION_LABELS` 里不许有「编出来的键」 ──────────────────────────────
  //
  // ⚠️ 这个坑很隐蔽：我写过一个 `"ptc:only": "PTC 模式"`，而**真实的 name 是
  //    `tools:ptc-only`** —— 那个键一次都没命中过，界面上一路走兜底显示成
  //    「tools · ptc · only」，而代码看起来却像是做过映射。
  //    同一批还编了 `mcp:servers` / `web:surface` / `structured-output` 三个。
  //
  // 下面这份清单是**从 dsh 源码里逐个 grep 出来的**，不是从 order 键名猜的：
  //   grep -r 'name: *"' <dsh>/node_modules/@deepseek-ai/  →  取 .section({...}) 的 name
  // 动态名（`tool:${x}`、`mcp:${server}`、`tool:${STRUCTURED_OUTPUT_TOOL}`）
  // 不在清单里 —— 它们走 sectionLabel() 的模式兜底，不需要也不该进这张表。
  const VERIFIED_SECTION_NAMES = new Set([
    "harness:identity",
    "harness:source",
    "deployment:persona-prefix",
    "deployment:persona-suffix",
    "plan:policy",
    "team:policy",
    "tools:ptc-only",
    "tools:sdk",
    "context:file-reference",
    "mcp-resource-servers",
    "ui:deliverable-file-references",
    "app:web-surface",
  ]);
  // 段落中文名表：模块级（`const`，4 空格缩进）。
  const labelBlock = src.match(/(?:var|const) SECTION_LABELS = \{([\s\S]*?)\n\s*\};/);
  // ── 主题变量：不许用不存在的名字 ──────────────────────────────────────
  //
  // 真机上踩过：浮窗背景写的是 `var(--dsh-surface, #1e1e1e)` ——
  //   · `--dsh-surface` **在 dsh 里根本不存在**（全树 grep 0 次命中），
  //     正确的命名空间是 `--dsw-alias-*`
  //   · 兜底 `#1e1e1e` 又是写死的深色
  // 于是变量永远取不到 → 浮窗永远深色。**用户是在远程访问时才发现的**
  // （本机主题本来就是深色，所以看不出来）。
  //
  // 这类错在渲染测试里完全测不到（节点都在、文案都对，只是颜色不对），
  // 只能静态钉住。
  {
    // ⚠️ **扫描前必须先剥掉注释** —— 上面那段解释性的注释里就写着
    //    `--dsh-surface`（说明这个错），不剥掉的话断言会抓到注释、永远红。
    const codeOnly = src
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

    const used = new Set();
    for (const m of codeOnly.matchAll(/--dsh-[\w-]+/g)) used.add(m[0]);
    eq([...used], [], "**不许用 `--dsh-*` 这种不存在的变量**（正确命名空间是 `--dsw-alias-*`）");

    // 浮窗/面板的背景必须走主题变量，不能写死颜色。
    // PANEL 那一族现在住在宿主（面板和预览两个 chunk 各自从 api.style 取），
    // 所以扫描必然能从拼起来的源码里找到它 —— 找不到就说明它被搬丢了。
    const panels = [...src.matchAll(/var PANEL = \{[\s\S]*?\n {4,10}\};/g)].map((m) => m[0]);
    ok(panels.length > 0, "能定位到 PANEL 样式");
    for (const [i, one] of panels.entries()) {
      ok(
        /background:\s*"var\(--dsw-alias-/.test(one),
        `**浮窗背景用主题变量**（第 ${i + 1} 份；写死颜色会导致明暗主题下有一边是错的）`,
      );
      ok(
        !/background:\s*"#[0-9a-fA-F]{3,6}"/.test(one),
        `浮窗背景没有写死的十六进制颜色（第 ${i + 1} 份）`,
      );
    }
  }

  ok(labelBlock !== null, "能定位到 SECTION_LABELS 表");
  if (labelBlock) {
    const keys = [...labelBlock[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]);
    eq(
      keys.filter((k) => !VERIFIED_SECTION_NAMES.has(k)),
      [],
      "**SECTION_LABELS 里没有编出来的键**（每个键都必须在 dsh 源码里真的存在）",
    );
    eq(new Set(keys).size, keys.length, "SECTION_LABELS 没有重复键");
  }
}

// ── 没被注册的槽位：灰卡片（不可操作，只说明原因）──────────────────────────
{
  const data = makeSectionsData({
    emptySlots: [
      {
        key: "TEAM_POLICY",
        order: 600,
        name: "team:policy",
        kind: "static",
        reason: "这个功能这次没有被加载，所以 dsh 没有往这个位置放内容",
      },
      {
        key: "TOOL_PTY",
        order: 1700,
        name: null,
        kind: "orphan",
        reason: "dsh 预留了这个位置，但没有任何插件会注册它",
      },
    ],
  });
  shims.setStates([...EDITOR_BASE, data, false, null, {}]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("没有被注册的位置"), "有「没有被注册的位置」分区标题");
    ok(text.includes("团队策略"), "有确定段名的槽位显示中文名");
    ok(text.includes("team:policy"), "也显示段名（排查用）");
    ok(text.includes("未加载"), "这类槽位标「未加载」");
    ok(text.includes("TOOL_PTY"), "**没有名字的槽位只能显示 order 键**");
    ok(text.includes("无对应包"), "这类槽位标「无对应包」—— 跟「功能没加载」不是一回事");
    ok(text.includes("order 600") || text.includes("600"), "显示 order 值");
    ok(text.includes("dsh 没有往这个位置放内容"), "给出「为什么不在」的原因");
  } catch (e) {
    ok(false, "灰卡片渲染不抛异常 —— 抛了 " + e.message);
  }

  // 没有空槽位时不该出现这个分区
  shims.setStates([...EDITOR_BASE, makeSectionsData({ emptySlots: [] }), false, null, {}]);
  try {
    const text = flattenText(renderEditor({})).join(" ");
    ok(!text.includes("没有被注册的位置"), "**没有空槽位时不显示这个分区**（不占地方）");
  } catch (e) {
    ok(false, "emptySlots 为空时渲染不抛异常 —— 抛了 " + e.message);
  }
}
// ── 作用范围开关**已经不在设置页了** ────────────────────────────────────
//
// 用户提的：设置页天然是「全局配置」的地方，把「只改这个会话」的开关混在
// 那儿，分不清自己改的是哪一层。会话级的选择挪到了**会话头**那个按钮里
// （跟「标准模式」同一行，槽位 conversation.session.header.actions）。
{
  const data = makeSectionsData();
  shims.setStates([...EDITOR_BASE, data, false, null, {}, "global", ""]);
  const el = renderEditor({});
  const text = flattenText(el).join(" ");
  ok(!text.includes("只改某个会话"), "**设置页里没有作用范围开关了**");

  // ⚠️ 「改的是哪一层」这段话**从屏幕上挪进了「?」图标的 title 里**。
  //    以前是两行常驻灰字压在标题下面，每一眼都要读一遍 —— 用户嫌乱。
  //    所以判据也变了：不是「屏幕上看得见」，而是「挂在 title 上、够得着」。
  const tip = collectTitles(el).find((t) => t.includes("全局默认")) || "";
  ok(tip !== "", "**作用范围说明挂在「?」的 title 上**（不是丢了）");
  ok(tip.includes("会话头"), "**并指出会话级的东西去哪找**（否则用户找不到）");
  ok(tip.includes("dsh 自己往系统提示词里放"), "title 里说清了这些段落是什么");
  ok(tip.includes("不会被官方更新顶掉"), "title 里说清了官方更新不会顶掉改动");
  ok(!text.includes("官方以后新增段落会自动出现在这里"), "**屏幕上不再常驻这段长说明**");
}
// ── 提示词组合（生效列表）+ 快速预设 ──────────────────────────────────────
//
// 编辑器状态顺序（新钩子仍加在末尾）：
//   ... 12 sectionScope / 13 sectionSessionId
//   14 presetsData / 15 presetsBusy / 16 presetName / 17 dragOver
{
  const lib = [
    { id: "none", name: "不注入", mode: "none", category: "other" },
    { id: "P1", name: "格式契约", mode: "append", category: "output", order: 9500, tokens: 1200 },
    { id: "P2", name: "编码规范", mode: "append", category: "domain", order: 950, tokens: 300 },
    { id: "P3", name: "文风要求", mode: "append", category: "domain", order: 950, tokens: 100 },
  ];
  const presetData = {
    presets: [
      { id: "写代码", name: "写代码", scope: "global", prompts: ["P1", "P2"], sections: {}, summary: "自设 2 条 · 全局层", note: "" },
      { id: "写作", name: "写作", scope: "global", prompts: ["P1", "P3"], sections: {}, summary: "自设 2 条 · 全局层", note: "" },
    ],
    layers: {
      global: { prompts: ["P1", "P2"], sections: {} },
      session: { prompts: ["P3"], sections: {} },
    },
    matched: { global: { id: "写代码", name: "写代码" }, session: null },
    sessionId: "s1",
  };
  const base = [
    { prompts: lib, defaults: [], categories: [], customCategories: [], assignments: { "session-s1": ["P3"] } },
    false, null, null, null, null, [], false,
    makeSectionsData(), false, null, {}, "global", "",
  ];

  shims.setStates([...base, presetData, false, "", null]);
  let text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("提示词组合"), "有「提示词组合」区块");
  ok(text.includes("格式契约"), "选词清单里有格式契约");
  ok(text.includes("编码规范"), "选词清单里有编码规范");
  // ⚠️ 两栏板（生效 / 可用）已删：那是同一批条目的两个视图，占两倍宽不加信息。
  ok(!text.includes("可用（"), "**没有「可用」栏了**（两栏板已砍）");
  ok(!text.includes("拖动"), "**文案里没有「拖动」**（拖动已删；顺序由 order 决定）");
  ok(text.includes("order "), "每条显示 order（那才是决定插入位置的字段）");
  ok(text.includes("已选"), "有「已选 N 条」的汇总");
  ok(text.includes("快速预设"), "有「快速预设」");
  ok(text.includes("写代码"), "列出了预设「写代码」");
  ok(text.includes("写作"), "列出了预设「写作」");
  ok(text.includes("✓"), "**当前匹配的预设打了勾**（否则用户不知道自己在哪）");
  ok(text.includes("当前：预设「写代码」"), "标题上写明了当前在哪个预设");
  ok(text.includes("覆盖"), "**说明了应用预设是覆盖不是合并**");
  ok(text.includes("把当前状态存为预设"), "有存为预设的入口");
  // ⚠️ 这一条**不能**挪进 title：它是「我现在改的是哪一层」，
  //    全局默认 / 只改这个会话的区别很要紧，藏起来用户会改错地方。
  //    但也不该占一整行灰字 —— 放进标题里就行。
  ok(text.includes("全局默认"), "标题上写明了当前改的是哪一层（全局默认）");

  // 「不注入」这种占位条目不该出现在组合列表里
  ok(!/生效（\d）[\s\S]{0,300}不注入/.test(text), "**mode:none 的占位条目不参与组合**");

  // 手改过 → 匹配不上 → 显示「已改动」
  shims.setStates([
    ...base,
    Object.assign({}, presetData, { matched: { global: null, session: null } }),
    false, "", null,
  ]);
  text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("相对预设已改动"), "**手改过之后显示「已改动」**");

  // 没有任何预设
  shims.setStates([
    ...base,
    { presets: [], layers: { global: { prompts: [], sections: {} }, session: null }, matched: { global: null, session: null }, sessionId: null },
    false, "", null,
  ]);
  text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("还没有预设"), "零预设时给了引导");

  // 会话层：选了会话层但没选会话 → 提示
  shims.setStates([...base, presetData, false, "", null]);
  const baseSess = [...base];
  baseSess[12] = "session";
  baseSess[13] = "";
  shims.setStates([...baseSess, presetData, false, "", null]);
  text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("还没挑会话"), "**选了会话层但没选会话时明确提示**（现在在标题上，不是常驻警告条）");

  // presetsData 为 null（还没读完）不许炸
  shims.setStates([...base, null, false, "", null]);
  try {
    text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("提示词组合") && text.includes("读取中"), "加载中不炸，有标题和占位");
  } catch (e) {
    ok(false, "presetsData 为 null 时不许炸 —— 抛了 " + e.message);
  }
}
// ── 总开关（胶囊）────────────────────────────────────────────────────────
//
// ⚠️ 状态顺序见文件上方那张表，**enabledDraft 在末尾**。
//    别用 `[...base, v]` 覆盖它 —— base 已经是「到 enabledDraft 之前的全部」，
//    再 append 一个就跑到 enabledDraft **后面**去了，等于没覆盖。
//    （删掉 dragSt 那个槽时就踩了这个：下标整体前移一位，而 append 的还在原位。）
{
  const base = [
    { prompts: [], defaults: [], categories: [], customCategories: [], assignments: {}, enabled: true },
    false, null, null, null, null, [], false,
    makeSectionsData(), false, null, {}, "global", "",
    { presets: [], layers: { global: { prompts: [], sections: {} }, session: null }, matched: { global: null, session: null }, sessionId: null },
    false, // presetsBusy
    "", // presetName
    null, // enabledDraft ← 就是它
  ];
  /** 把 enabledDraft（最后一位）换成 v，返回完整状态表。 */
  const withEnabled = (v) => base.slice(0, -1).concat([v]);

  shims.setStates(withEnabled(true));
  let el = renderEditor({});
  let text = flattenText(el).join(" ");
  ok(text.includes("使用我的提示词配置"), "开启时显示「使用我的提示词配置」");

  // ── 开关本身：借用 dsh 原生开关的类名和结构 ──────────────────────────
  //
  // 用户给的参考就是 dsh 自己的开关：
  //   <button type="button" role="switch" aria-checked="true" class="_switch_…">
  //     <span class="_thumb_…"></span>
  //   </button>
  // 那段 CSS 在**全局样式表**里（web-frontend/dist/assets/index-*.css），
  // 所以插件能直接借，外观自动跟着主题令牌走。
  //
  // ⚠️ 那个哈希是内容派生的，dsh 升级可能变。所以这里断言的是：
  //    结构对（role/aria-checked）+ 有类名 + **有内联兜底几何**。
  //    类名一旦失效，至少还是个圆角胶囊，不会退回方按钮。
  const sw = findEl(el, (n) => n.props && n.props.role === "switch");
  ok(!!sw, "**有 role=switch 的开关**（原生语义，键盘和读屏能用）");
  if (sw) {
    eq(sw.props["aria-checked"], true, "**aria-checked 跟状态一致**（原生开关靠它驱动视觉）");
    ok(
      typeof sw.props.className === "string" && sw.props.className.startsWith("_switch_"),
      `用了 dsh 原生开关类名（实际 ${JSON.stringify(sw.props.className)}）`,
    );
    eq(sw.props.style.borderRadius, "999px", "**内联兜底仍在**：类名失效也是个胶囊，不是方按钮");
    eq(sw.props.style.width, "36px", "兜底尺寸跟原生一致（36×20）");
    const th = findEl(sw, (n) => n.props && typeof n.props.className === "string" && n.props.className.startsWith("_thumb_"));
    ok(!!th, "滑块用了原生 thumb 类名");
    if (th) ok(!!th.props.style.transform, "thumb 内联兜底带 transform 位移");
  }
  ok(text.includes("关掉就完全回到原生 dsh"), "说明了关掉会怎样");
  ok(text.includes("配置都留着"), "**说明了配置不会被清掉**（否则用户不敢关）");

  shims.setStates(withEnabled(false));
  text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("正在使用 dsh 原始提示词"), "关闭时显示「正在使用 dsh 原始提示词」");
  ok(text.includes("配置都还在") && text.includes("开回来"), "**说明了配置还在、能开回来**");

  // enabledDraft 为 null（还没读完）不该炸，也不该误显示成"关"
  shims.setStates(withEnabled(null));
  try {
    text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("使用我的提示词配置"), "还没读完时按「开」显示（默认开），不误报成关");
  } catch (e) {
    ok(false, "enabledDraft 为 null 时不许炸 —— 抛了 " + e.message);
  }
}
done();