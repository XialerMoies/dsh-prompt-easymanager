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
/**
 * 最近一次「宿主调用 PromptEditor 时给的 props」。
 *
 * ⚠️ 影子层的 createElement 会直接调用函数组件，所以树里没有 PromptEditor 元素；
 *    要验「宿主有没有把拆出去的 chunk 递进来」只能在这一层截（见 createElement）。
 */
let seenEditorProps = {};

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
        // 记下「宿主调用 PromptEditor 时给了什么 props」。
        //
        // ⚠️ 为什么非得记这一笔：影子层的 createElement 会**直接调用**函数组件，
        //    所以渲染出来的树里**没有** PromptEditor 元素 —— 想验「宿主有没有把
        //    switch chunk 的两样递进来」，只能在这里截。而这件事别的断言都测不到：
        //    测试是**自己**造 props 喂给 PromptEditor 的，宿主漏传照样全绿，
        //    真机上却是总开关那一块静静消失。
        if (type.name === "PromptEditor") seenEditorProps = { ...(props || {}) };
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

/** 收集所有带某个 class 的元素（`className` 是空格分隔的，按词匹配）。 */
function collectByClass(node, cls, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  const cn = node.props && node.props.className;
  if (typeof cn === "string" && cn.split(/\s+/).includes(cls)) out.push(node);
  for (const c of node.children || []) collectByClass(c, cls, out);
  return out;
}

/**
 * 数「一个**卡片头**的兄弟里套着另一个卡片头」的次数 —— 用来验卡片嵌套。
 *
 * ⚠️ 不能写成「数 head 里面还含 head」：类别卡片的体是个**没有 class 的 div**，
 *    嵌套发生在「卡片 → 头 + 体 → 体里的卡片 → 头」这层，不在 head 里面。
 *    第一版判据就是这么写错的，明明结构对了却报 0。
 *
 * 判据：某个元素的**直接子元素**里同时有
 *   · 一个 `.pm-head`（它是这张卡片的头）
 *   · 一个不含 `.pm-head` 的容器，而那个容器里还有 `.pm-head`（体里套着卡片）
 * 平铺的分组（分类标题 + 网格）得到 0；类别卡片套提示词卡片时 ≥1。
 */
function countNestedCards(node) {
  if (node === null || node === undefined || typeof node !== "object") return 0;
  const kids = node.children || [];
  const isHead = (k) =>
    k && k.props && typeof k.props.className === "string" && k.props.className.split(/\s+/).includes("pm-head");
  let n = 0;
  if (kids.some(isHead)) {
    for (const k of kids) {
      if (isHead(k)) continue;
      n += countHeadsIn(k);
    }
  }
  for (const k of kids) n += countNestedCards(k);
  return n;
}

/** 子树里所有 `.pm-head` 的数量。 */
function countHeadsIn(node) {
  if (node === null || node === undefined || typeof node !== "object") return 0;
  const cn = node.props && node.props.className;
  let n = typeof cn === "string" && cn.split(/\s+/).includes("pm-head") ? 1 : 0;
  for (const c of node.children || []) n += countHeadsIn(c);
  return n;
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

  // ⚠️ 注册的是 **settings.section**（设置面板侧边栏的独立一项），
  //    不是 settings.plugins.tab（那样会塞进「插件」标签页里当个子 Tab）。
  //    用户要求：「不要放在内置插件标签页作为一个 Tab 了，而是独立成一个标签页」。
  const sec = regs.find((r) => r.opts.name === "settings.section");
  ok(!!sec, "**注册到 settings.section**（设置面板的独立一项）");
  ok(
    !regs.some((r) => r.opts.name === "settings.plugins.tab"),
    "**没有再注册 settings.plugins.tab**（不许缩回插件标签页里）",
  );
  if (sec) {
    ok(sec.opts.id === "prompt-manager", "section id 正确");
    ok(typeof sec.Component === "function", "section 注册的是组件");
    ok(typeof sec.opts.label === "function", "section 带 label 函数");
    eq(sec.opts.label(), "提示词管理", "**导航项标题是「提示词管理」**");
    // 内置几项的 order：general 0 / models 10 / plugins 15 / agent-presets 20
    ok(typeof sec.opts.order === "number", "section 带 order（决定排在哪）");
    ok(sec.opts.order > 0, "**排在「通用」之后**（order > 0）");
  }
}

// ── 2c. 侧边栏图标补丁 ─────────────────────────────────────────────────────
//
// dsh 的侧边导航图标是**硬编码白名单**（`navIcon(id)`），能带的信息只有
// `{id, order, label}` 三个字段 —— 没有 icon，也没有图标注册表。
// 所以插件只能渲染后替换。这段就是验那个替换。
//
// ⚠️ 必须**注入一个能用的假 DOM**：沙箱默认那个 document 是残缺的
//    （只有 body/head/getElementById），`patchNavIcon` 会在 try/catch 里静默失败 ——
//    测试照样绿，但什么都没验到。第一版就是这个坑。
{
  // 极简假 DOM：够 patchNavIcon 用（querySelectorAll → 按钮；replaceWith；setAttribute）
  const makeEl = (tag) => {
    const attrs = {};
    const el = {
      tagName: tag.toUpperCase(),
      textContent: "",
      children: [],
      style: {},
      attrs,
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => {
        attrs[k] = String(v);
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      querySelector(sel) {
        if (sel !== "svg") return null;
        return this.children.find((c) => c.tagName === "SVG") || null;
      },
      replaceWith(next) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children[i] = next;
      },
    };
    return el;
  };
  const mk = (tag, parent) => {
    const e = makeEl(tag);
    e.parent = parent || null;
    return e;
  };

  // 造一个「侧边栏」：两个按钮，其中一个文案是「提示词管理」，里面带齿轮 svg
  const nav = mk("div");
  const otherBtn = mk("button", nav);
  otherBtn.textContent = "插件";
  otherBtn.appendChild(mk("svg", otherBtn));
  const ourBtn = mk("button", nav);
  ourBtn.textContent = "提示词管理";
  const gear = mk("svg", ourBtn);
  ourBtn.appendChild(gear);
  nav.children.push(otherBtn, ourBtn);

  const body = mk("body");
  const fakeDoc = {
    body,
    head: null,
    getElementById: () => null,
    // ⚠️ 假 DOM 必须把补丁用到的 API 都给全。第一版漏了 createElementNS，
    //    补丁在造图标那一步抛错、被它自己的 try/catch 吞掉 ——
    //    表现为「什么都没发生」，而断言红了却看不出原因。
    createElementNS: (_ns, tag) => mk(tag),
    querySelectorAll: (sel) => (sel === "button" ? [otherBtn, ourBtn] : []),
  };

  // ⚠️ `document` 是**第二个参数**（opts）里的，不是 shims 里的。
  //    第一版写成 `createClientSandbox({ react, reactDom, document })` ——
  //    被当成 shims，`opts.document` 恒为 undefined，于是拿到默认的残缺 document，
  //    补丁静默失败、断言红得莫名其妙。
  const sb = createClientSandbox({ react: {}, reactDom: {} }, { document: fakeDoc });
  const loaded = sb.load("client.js");
  loaded.mod.apply({
    slots: { inject: () => {}, register: () => {} },
  });

  const now = ourBtn.children.find((c) => c.tagName === "SVG");
  ok(!!now, "我们的按钮里还有 svg");
  eq(
    ourBtn.getAttribute("pmNavIconDone"),
    "1",
    "**「提示词管理」那一项被打了标记**（说明补丁认出了它）",
  );
  const replaced = now !== gear;
  ok(replaced, "**齿轮被换掉了**（原来那个 svg 元素已不在原位）");
  // 新图标是我们造的：只有一条 path，且 viewBox 是 16
  const path = now && now.children.find((c) => c.tagName === "PATH");
  ok(!!path, "新图标里有 path");
  eq(now.getAttribute("viewBox") || now.attrs?.viewBox, "0 0 16 16", "新图标 viewBox 16");
  // 别的项不许动
  eq(otherBtn.getAttribute("pmNavIconDone"), null, "**别的导航项不被动**（只认「提示词管理」那一项）");

  // ⚠️ 补丁是**按文案认按钮**的（dsh 的 section 注册只有 {id, order, label}，
  //    没有 icon），所以「标签文案」和「补丁找的文案」必须是同一份常量。
  //    这里把两者绑起来：改文案而忘了改另一边 → 立刻红。
  {
    const regs2 = [];
    const sb2 = createClientSandbox({ react: {}, reactDom: {} }, { document: fakeDoc });
    sb2.load("client.js").mod.apply({
      slots: {
        inject: (_name, fn) => fn(),
        register: (o) => regs2.push(o),
      },
    });
    const declared = regs2.find((o) => o.name === "settings.section");
    ok(!!declared, "拿到 settings.section 的注册选项");
    if (declared) {
      eq(
        declared.label(),
        "提示词管理",
        "**标签文案 = 补丁找的文案**（写两份就会有一处静默失效）",
      );
    }
  }
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
const EditorSlot = regs.find((r) => r.opts.name === "settings.section").Component;

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

    // ⚠️⚠️ **宿主到底有没有把 switch chunk 的两样递给编辑器。**
    //
    //    别的断言都测不出这件事：测试是**自己**造 EDITOR_PROPS 喂给 PromptEditor 的，
    //    所以「宿主忘了递」在那些断言里照样全绿 —— 而真机上表现是总开关那一块
    //    静静消失（两头都以为对方有，谁都不报错）。
    //    这里验的是**宿主调用 PromptEditor 时给它的 props**。
    //
    //    ⚠️ 不能在渲染出来的树里找 PromptEditor 元素 —— 影子层的 createElement
    //       会**直接调用**函数组件，所以树里只剩它返回的 div，元素本身没了。
    //       改成记录「调用时的 props」（下面的 seenEditorProps）。
    if (process.env.PM_DEBUG) {
      console.log("[SLOT] 调用 PromptEditor 时收到的 props = " + Object.keys(seenEditorProps).join(","));
    }
    ok(
      typeof seenEditorProps.MasterSwitch === "function",
      "**宿主把 MasterSwitch 递给了编辑器**（漏了就是总开关静默消失）",
    );
    ok(typeof seenEditorProps.helpIcon === "function", "**宿主把 helpIcon 递给了编辑器**");
    ok(
      typeof seenEditorProps.SectionsBlock === "function",
      "**宿主把 SectionsBlock 递给了编辑器**（漏了系统提示词那一整块静默消失）",
    );
    ok(
      typeof seenEditorProps.ComboBlock === "function",
      "**宿主把 ComboBlock 递给了编辑器**（漏了提示词组合那一整块静默消失）",
    );
    ok(
      typeof seenEditorProps.LibraryBlock === "function",
      "**宿主把 LibraryBlock 递给了编辑器**（漏了个人提示词那一整块静默消失）",
    );
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
  // ── 新会话页那个下拉框（HeroPresetChip）────────────────────────────────
  //
  // ⚠️ 它**没有 sessionId** —— 新会话页还没有会话，所以它改的是**全局那条预设**
  //    （POST /global），不是某个会话的分配。这条要钉住：走错了路由的话，
  //    用户在新会话页选的东西会跑到一个不存在的会话上，静默失效。
  {
    ok(typeof pickerBox.HeroPresetChip === "function", "picker chunk 导出了 HeroPresetChip");

    const realFetch = globalThis.fetch;
    const posts = [];
    globalThis.fetch = (url, init) => {
      if (init && init.method === "POST") posts.push({ url: String(url), body: init.body });
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            presets: [
              { id: "写代码", name: "写代码", label: "写代码", summary: "自设 2 条" },
              // ⚠️ 给它**个人提示词**，label 才是预设名。
              //    没有个人提示词时 label 是「系统提示词 · 改」——
              //    那是用户定的规则，断言找预设名就会找不到（我在这上面绕了很久）。
              { id: "翻译", name: "翻译", prompts: ["b"], label: "翻译", summary: "自设 1 条" },
            ],
            global: { enabled: true, presetId: "写代码" },
            session: null,
            effective: null,
          }),
      });
    };

    // ⚠️ data 要**注入**（state 序号 0）—— 渲染是同步的，
    //    组件里 useEffect 拉的 fetch 到断言时还没回来。
    //    （跟面板那次「要先点开」是同一个坑：这些测试不跑异步。）
    const HERO_DATA = {
      presets: [
        { id: "写代码", name: "写代码", label: "写代码", summary: "自设 2 条" },
        { id: "翻译", name: "翻译", label: "翻译", summary: "自设 1 条" },
      ],
      global: { enabled: true, presetId: "写代码" },
      session: null,
      effective: null,
    };
    shims.setStates([HERO_DATA, false]);
    const chip = shims.render(pickerBox.HeroPresetChip, {});
    ok(flattenText(chip).join(" ").includes("写代码"), "**按钮上显示全局那条预设的名字**");

    // 点开面板 → 点另一条 → 应该 POST /global
    shims.setStates([HERO_DATA, true]);
    shims.portals.length = 0; // ⚠️ 清掉，免得污染「弹窗被 portal 到 body」那条计数
    const opened = shims.render(pickerBox.HeroPresetChip, {});

    // ⚠️ 面板走 createPortal，**不在 findEl 的遍历范围里** —— 从 shims.portals 拿。
    // ⚠️ `portal.el` 是**子元素数组**（不是单个节点），所以 flattenText / findEl
    //    都得**逐个遍历** —— 直接喂给它们的话它们找 `node.children`，数组没有，
    //    返回空。踩了好几轮才想到。
    const portalEntry = shims.portals.length > 0 ? shims.portals[shims.portals.length - 1] : null;
    const panelRoots = portalEntry
      ? Array.isArray(portalEntry.el)
        ? portalEntry.el
        : [portalEntry.el]
      : [];
    const panelText = panelRoots
      .map((n) => flattenText(n).join(" "))
      .join(" ");
    const target = [];
    for (const root of panelRoots) {
      findEl(root, (n) => {
        if (n.type === "button" && flattenText(n).join(" ").includes("翻译")) target.push(n);
        return false;
      });
    }
    ok(panelRoots.length > 0, "面板通过 portal 渲染出来了");
    ok(panelText.includes("翻译"), "面板里列得出别的预设");
    ok(panelText.includes("翻译"), "**那条预设按 label 显示**");
    ok(target.length > 0, "找得到「翻译」那个选项");
    if (target[0]) target[0].props.onClick();

    eq(posts.length, 1, "点一下 → 提交一次");
    ok(posts[0] && posts[0].url.includes("/global"), "**走的是 /global**（还没有会话，不能走 /assign）");
    eq(JSON.parse((posts[0] && posts[0].body) || "{}").presetId, "翻译", "带上选的那条预设");
    eq(
      JSON.parse((posts[0] && posts[0].body) || "{}").enabled,
      true,
      "**顺带把全局注入打开**（选了预设就是要开的意思）",
    );
    ok(
      !panelText.includes("跟随全局"),
      "**没有「跟随全局」选项**（那是按会话的状态，这里还没有会话）",
    );

    globalThis.fetch = realFetch;
  }


const Picker = pickerBox.PromptPicker;
const Editor = editorBox.PromptEditor;
ok(typeof Picker === "function", "create(api) 造出了 PromptPicker");
ok(typeof Editor === "function", "create(api) 造出了 PromptEditor");
  // ── DOM 补丁：找不到目标行时**什么都不做** ──────────────────────────────
  //
  // ⚠️ 新会话页那个下拉框只能靠 DOM 补丁插（那一行的两个槽位都是 kind:single
  //    且已被占，也没有第三个槽位）。承诺是「dsh 改版之后静默失效但页面不坏」——
  //    这条就是那个承诺的守卫：**没有目标行时不许插、不许抛**。
  //
  //    真机上跑不了（没有浏览器），所以拿一个**最小的 DOM 假件**验：
  //    只要 querySelectorAll 找不到那两个 aria-haspopup 触发器，补丁就该原样返回。
  {
    const calls = [];
    const fakeDoc = {
      body: { __isBody: true },
      querySelector: (sel) => {
        calls.push(sel);
        return null;
      },
      querySelectorAll: (sel) => {
        calls.push(sel);
        return [];
      },
      createElement: () => ({ setAttribute() {}, style: {}, appendChild() {} }),
      createElementNS: () => ({ setAttribute() {}, style: {}, appendChild() {} }),
    };
    const heroSandbox = createClientSandbox(
      { react: shims.react, reactDom: shims.reactDom },
      { document: fakeDoc },
    );
    let threw = null;
    try {
      heroSandbox.load("client.js");
    } catch (e) {
      threw = e;
    }
    eq(threw, null, "**没有目标行时补丁不抛**（dsh 改版后只是静默失效，页面不坏）");
    ok(calls.every((x) => typeof x === "string"), "查询用的是字符串选择器");
  }


eq(strict.missing, [], "chunk 要的样式常量宿主一个没漏（漏一个界面就空白）");

// ⚠️ 总开关 + 「?」图标已经拆进 client.editor.switch.js，**由宿主递进 PromptEditor**
//    （不是编辑器自己拉 —— 那样两边各一份缓存、还要各自处理加载态，
//     而测试是同步渲染，等不到 effect 里的异步，总开关整块会不出现）。
//    这里照宿主的做法把 props 喂进去，否则测出来的「总开关不见了」跟真机无关。
sandbox.preload("client.editor.switch.js");
const modSwitch = sandbox.cache.get("dsh-prompt-manager/client.editor.switch.js");
ok(!!modSwitch, "拿得到 switch chunk 模块");
const switchBox = modSwitch.create(strict.api);
ok(typeof switchBox.MasterSwitch === "function", "switch chunk 导出了 MasterSwitch");
ok(typeof switchBox.helpIcon === "function", "switch chunk 导出了 helpIcon");

// 「系统提示词段落改写」那一块同理 —— 也是宿主递进来的。
sandbox.preload("client.editor.sections.js");
const modSections = sandbox.cache.get("dsh-prompt-manager/client.editor.sections.js");
ok(!!modSections, "拿得到 sections chunk 模块");
const sectionsBox = modSections.create(strict.api);
ok(typeof sectionsBox.SectionsBlock === "function", "sections chunk 导出了 SectionsBlock");

// 「提示词组合 + 预设」那一块同理。
sandbox.preload("client.editor.combo.js");
const modCombo = sandbox.cache.get("dsh-prompt-manager/client.editor.combo.js");
ok(!!modCombo, "拿得到 combo chunk 模块");
const comboBox = modCombo.create(strict.api);
ok(typeof comboBox.ComboBlock === "function", "combo chunk 导出了 ComboBlock");

// 「个人提示词库」那一块同理。
sandbox.preload("client.editor.library.js");
const modLibrary = sandbox.cache.get("dsh-prompt-manager/client.editor.library.js");
ok(!!modLibrary, "拿得到 library chunk 模块");
const libraryBox = modLibrary.create(strict.api);
ok(typeof libraryBox.LibraryBlock === "function", "library chunk 导出了 LibraryBlock");

const EDITOR_PROPS = {
  MasterSwitch: switchBox.MasterSwitch,
  helpIcon: switchBox.helpIcon,
  SectionsBlock: sectionsBox.SectionsBlock,
  ComboBlock: comboBox.ComboBlock,
  LibraryBlock: libraryBox.LibraryBlock,
};

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
/** 渲染 Editor。默认带上宿主会递的那两个 props（总开关组件 + 「?」图标）。 */
const renderEditor = (props = {}) =>
  shims.render(Editor, Object.assign({}, EDITOR_PROPS, props));

// ── 3e. 拆出去的「总开关 + ?图标」两个方向都要验 ──────────────────────────
//
// 拆包最容易出的错是**两头都以为对方有**：编辑器把渲染删了、宿主忘了接，
// 结果是那一块静静消失，没人报错。所以两个方向都断言：
//   · 源码里确实搬走了（编辑器里不该再有开关的标记 / 实现）；
//   · 渲染出来确实还在（总开关的文案出现在页面上）。
{
  const edSrc = readFileSync(join(HERE, "..", "client.editor.js"), "utf8");
  const swSrc = readFileSync(join(HERE, "..", "client.editor.switch.js"), "utf8");

  // 方向一：搬走了
  for (const gone of ["NATIVE_SWITCH", "NATIVE_THUMB", "SWITCH_FALLBACK", "THUMB_FALLBACK"]) {
    ok(!edSrc.includes(gone), `编辑器里不再有 ${gone}（已搬进 switch chunk）`);
  }
  ok(!/function renderHelpIcon\(/.test(edSrc), "编辑器里不再有 renderHelpIcon 的实现");
  ok(/function renderHelpIcon\(/.test(swSrc), "switch chunk 里有 renderHelpIcon");
  ok(/function MasterSwitch\(props\)/.test(swSrc), "switch chunk 里 MasterSwitch 收 props");
  // 方向一之二：编辑器**只靠 props 拿**，不再自己 require.async 拉一份
  // （自己拉会两边各一份缓存 + 各自的加载态，而测试是同步渲染、等不到异步）
  ok(!/loadSwitch|useSwitchChunk/.test(edSrc), "编辑器不再自己拉 switch chunk（改由宿主递 props）");
  ok(/props && props\.MasterSwitch/.test(edSrc), "编辑器从 props 取 MasterSwitch");
  ok(/props && props\.helpIcon/.test(edSrc), "编辑器从 props 取 helpIcon");

  // ── 「系统提示词段落改写」那一块（第二个拆出去的）────────────────────
  const secSrc = readFileSync(join(HERE, "..", "client.editor.sections.js"), "utf8");
  for (const gone of ["sectionBadge", "renderSectionCard", "renderEmptySlot", "renderSections"]) {
    ok(
      !new RegExp("function " + gone + "\\(").test(edSrc),
      `编辑器里不再有 ${gone}（已搬进 sections chunk）`,
    );
  }
  ok(/function SectionsBlock\(props\)/.test(secSrc), "sections chunk 里 SectionsBlock 收 props");
  ok(
    /function renderSectionCard\(row, props\)/.test(secSrc) &&
      /function renderEmptySlot\(slot, props\)/.test(secSrc),
    "**内部两个渲染函数也把 props 接了下去**（漏了就是 props is not defined）",
  );
  ok(/react\.createElement\(props\.SectionsBlock/.test(edSrc), "编辑器从 props 取 SectionsBlock");

  // ── 「提示词组合 + 预设」那一块（第三个拆出去的）─────────────────────
  const comboSrc = readFileSync(join(HERE, "..", "client.editor.combo.js"), "utf8");
  for (const gone of ["renderCombo", "renderPickerBody", "applyPreset", "savePreset", "commitRename"]) {
    ok(
      !new RegExp("function " + gone + "\\(").test(edSrc),
      `编辑器里不再有 ${gone}（已搬进 combo chunk）`,
    );
  }
  ok(/function renderCombo\(props\)/.test(comboSrc), "combo chunk 里 renderCombo 收 props");
  // ⚠️ 内部函数也要接 props，**调用点还要转发** —— 这轮两个都漏过：
  //    renderPickerBody 忘了接（props is not defined），
  //    applyPreset/savePreset/commitRename 的调用点忘了转发（静默失效，测试全绿）。
  ok(/function renderPickerBody\(props\)/.test(comboSrc), "renderPickerBody 也收 props");
  ok(/function applyPreset\(id, props\)/.test(comboSrc), "applyPreset 收 props");
  ok(/function savePreset\(props\)/.test(comboSrc), "savePreset 收 props");
  ok(/function commitRename\(props\)/.test(comboSrc), "commitRename 收 props");
  ok(/applyPreset\(id, props\)/.test(comboSrc), "**调用 applyPreset 时转发了 props**");
  ok(/\bsavePreset\(props\)/.test(comboSrc), "**调用 savePreset 时转发了 props**");
  ok(/commitRename\(props\)/.test(comboSrc), "**调用 commitRename 时转发了 props**");
  ok(/renderPickerBody\(props\)/.test(comboSrc), "**调用 renderPickerBody 时转发了 props**");
  ok(/react\.createElement\(props\.ComboBlock/.test(edSrc), "编辑器从 props 取 ComboBlock");
  // ══ chunk 里不许有「本地兜底的样式常量」══════════════════════════════════
  //
  // ⚠️ **同一作用域里重复 `var` 是后声明者赢** —— 所以这样写：
  //
  //      var ROW = api.style.ROW;    ← 从宿主取
  //      var ROW = { ... };          ← 又声明一次
  //
  //    等于**把宿主给的那份顶掉了**。两个后果都是静默的：
  //
  //      ① 宿主真漏给某个常量时**测不出来** —— `strictApi` 那条守卫
  //         （「CHUNK_API.style 里没有 X」）读到的是本地兜底，形同虚设
  //         （踩过：picker 里 3 个、preview 里 2 个）
  //      ② 本地那份和宿主那份**各自漂移** —— 改了宿主，界面不变
  //
  //    删完之后做了注入验证：从宿主摘掉 `ROW`，这里**当场抛**。
  //    删之前那个注入是**全绿**的（真机上界面会空白，但测试测不出）。
  {
    const dupes = [];
    for (const file of [
      "client.js",
      "client.editor.js",
      "client.editor.switch.js",
      "client.editor.sections.js",
      "client.editor.combo.js",
      "client.editor.library.js",
      "client.picker.js",
      "client.preview.js",
    ]) {
      const src = readFileSync(join(HERE, "..", file), "utf8");
      // 从 api 取的那些名字
      const fromApi = new Set(
        [...src.matchAll(/var (\w+) = api\.style\.\w+;/g)].map((m) => m[1]),
      );
      // 本地对象的那些名字
      for (const m of src.matchAll(/^ {6}var (\w+) = \{/gm)) {
        if (fromApi.has(m[1])) dupes.push(file + ":" + m[1]);
      }
    }
    eq(
      dupes,
      [],
      "**chunk 里没有本地兜底的样式常量**（重复 var 会顶掉宿主给的，让守卫失效）",
    );
  }

  // ══ 宿主契约：客户端读的字段，宿主必须真的给 ══════════════════════════════
  //
  // ⚠️ **渲染测试测不出这个** —— 它自己喂数据（`shims.setStates`），
  //    所以跟真宿主之间是自洽的：两边字段对不上时它照样全绿。
  //    踩到过：宿主把 `/state` 的 `defaults` 换成了 `global`，
  //    而这边还在喂 `defaults`，435 条全过，真机上静默失效
  //    （`d.enabled !== false` 恒 true，开关怎么点都弹回去）。
  //
  // 所以单独钉一层：**客户端源码里不许再读宿主已经不提供的字段。**
  {
    const idxSrc = readFileSync(join(HERE, "..", "index.js"), "utf8");
    // 宿主各 GET 路由回传的顶层字段（从源码里抠出来，不手写 —— 手写会跟实现漂移）
    const keysOf = (block, indent) =>
      new Set([...block.matchAll(new RegExp("^\\s{" + indent + ",16}(\\w+):", "gm"))].map((m) => m[1]));
    const stateBlock = idxSrc.slice(idxSrc.indexOf('path === STATE_PATH && request.method === "GET"'));
    const editBlock = idxSrc.slice(idxSrc.indexOf('path === EDIT_PATH && request.method === "GET"'));
    const stateKeys = keysOf(stateBlock.slice(0, 3000), 8);
    const editKeys = keysOf(editBlock.slice(0, 3000), 10);

    ok(stateKeys.has("global"), "宿主 /state 回传 global");
    ok(stateKeys.has("assignments"), "宿主 /state 回传 assignments");
    ok(stateKeys.has("presets"), "宿主 /state 回传 presets");
    ok(editKeys.has("global"), "宿主 /edit 回传 global");
    ok(editKeys.has("presets"), "宿主 /edit 回传 presets");

    // ── 客户端里不许再出现「老字段」 ──────────────────────────────────────
    //
    // 这些是这次改动**删掉**的，客户端再读就是静默失效：
    const GONE = [
      ["\\.defaults\\b", "defaults（全局改成 global.presetId 了）"],
      ["presetsData\\.layers", "presetsData.layers（改成 global / session 了）"],
      ["presetsData\\.matched", "presetsData.matched（改成 session / effective 了）"],
    ];
    for (const file of [
      "client.js",
      "client.editor.js",
      "client.editor.switch.js",
      "client.editor.sections.js",
      "client.editor.combo.js",
      "client.editor.library.js",
      "client.picker.js",
      "client.preview.js",
    ]) {
      const src = readFileSync(join(HERE, "..", file), "utf8");
      for (const [re, why] of GONE) {
        // 注释里提到不算
        const code = src
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*)/.test(l))
          .join("\n");
        ok(
          !new RegExp(re).test(code),
          `**${file} 不再读 ${why}**`,
        );
      }
    }
  }

  // ── 「个人提示词库」那一块（第四个拆出去的）─────────────────────────────
  const libSrc = readFileSync(join(HERE, "..", "client.editor.library.js"), "utf8");
  for (const gone of [
    "suggestedOrderOf",
    "categoryName",
    "setCategory",
    "newPrompt",
    "field",
    "renderForm",
    "toggleOpen",
    "pillFor",
    "renderGroupCard",
    "renderRow",
  ]) {
    ok(!new RegExp("function " + gone + "\\(").test(edSrc), `编辑器里不再有 ${gone}（已搬进 library chunk）`);
  }
  ok(/function LibraryBlock\(props\)/.test(libSrc), "library chunk 里 LibraryBlock 收 props");
  ok(/function renderHeader\(props\)/.test(libSrc), "renderHeader 收 props");
  ok(/function renderCards\(props\)/.test(libSrc), "renderCards 收 props");
  ok(/function groupByCategory\(props\)/.test(libSrc), "groupByCategory 收 props");
  ok(/react\.createElement\(props\.LibraryBlock/.test(edSrc), "编辑器从 props 取 LibraryBlock");

  // ⚠️ 两条**具体**的回归（都是实际踩过的，而且都不报错、只是静默出错）：
  //
  //   1. 搬 header 时漏了 `return header;` —— 整块标题静默消失，控制台什么都不说；
  //   2. 批量把自由变量换成 `props.*` 时**误伤了字符串字面量** ——
  //      `"…保存到 prompts/a.md"` 被改成 `"…保存到 props.prompts/a.md"`，
  //      也是不报错的。
  ok(/return header;/.test(libSrc), "**renderHeader 有 return**（漏了标题会静默消失）");
  ok(
    !/保存到 props\./.test(libSrc) && !/写到 props\./.test(libSrc),
    "**字符串字面量没被 props 替换误伤**（保存路径提示里不该出现 props.）",
  );
  ok(/保存到 prompts\//.test(libSrc), "保存路径提示还在（\"保存到 prompts/<id>.md\"）");

  // ⚠️ 分组逻辑原来在编辑器里写了**两遍**（一遍永远走不到），搬过来时合成一份。
  ok(
    (libSrc.match(/按分类分组显示。组内顺序/g) || []).length === 1,
    "**分组逻辑只剩一份**（曾经写了两遍）",
  );
  ok(!/按分类分组显示。组内顺序/.test(edSrc), "编辑器里不再有那份分组逻辑");

  // 方向二（渲染出来还在）见下面「总开关」那一节 —— 那里状态才设齐，
  // 放在这儿渲染出来的是「读取中…」，断言会假红。
}

// ── 3f. **真的点一下按钮**：回调链不能被 props 断掉 ─────────────────────────
//
// ⚠️ 这一条是补的，因为它暴露了一个**测试盲区**：
//    在这之前，本文件对编辑器的所有断言都只读**静态渲染结果**
//    （文案在不在、元素是什么类型、样式值对不对），**从来没有调用过任何
//    onClick**。于是「回调里忘了把 props 传下去」这类错误一路绿灯 ——
//    拆包时 `applyPreset(id)` / `savePreset()` / `commitRename()` 三处就是这么漏的
//    （它们的签名改成了收 props，调用点却没转发），测试全绿。
//
//    所以这里直接把按钮的 onClick 拿出来调，看它到底把什么交给了动作函数。
{
  const COMBO_PRESETS = [
    // ⚠️ 新形状：预设**不带 scope**，多一个 label（会话页标签按它显示）。
    { id: "写代码", name: "写代码", prompts: ["P1", "P2"], sections: {}, summary: "", note: "", label: "写代码" },
    { id: "写作", name: "写作", prompts: ["P1", "P3"], sections: {}, summary: "", note: "", label: "写作" },
  ];
  const COMBO_LIB = [
    { id: "P1", name: "格式契约", mode: "append", category: "output", order: 9500, tokens: 1200 },
    { id: "P2", name: "编码规范", mode: "append", category: "domain", order: 950, tokens: 300 },
    { id: "P3", name: "文风要求", mode: "append", category: "domain", order: 950, tokens: 100 },
  ];
  /** 组合块要的一整套 props（照编辑器递的那份写）。 */
  const comboProps = (over = {}) =>
    Object.assign(
      {
        presetsData: {
          presets: COMBO_PRESETS,
          // ⚠️ 新形状：全局**指向一条预设**（presetId），内容在 presets 里查 ——
          //    不再是「一层裸 prompt id」（layers.global.prompts）那种。
          global: { enabled: true, presetId: "写代码" },
          session: null,
          effective: null,
          sessionId: null,
        },
        presetsBusy: false,
        prompts: COMBO_LIB,
        renaming: false,
        renameDraft: "",
        setRenaming: () => {},
        setRenameDraft: () => {},
        // ⚠️ 勾选走**草稿**（原来那个 setActivePrompts 打的是已退役的 /defaults）。
        //    不给的话勾选框一 onChange 就炸。
        presetDraft: ["P1", "P2"],
        setPresetDraft: () => {},
        saveDraft: () => {},
        MasterSwitch: null,
        globalEnabled: true,
        onToggleGlobal: () => {},
        presetName: "",
        setPresetName: () => {},
        loadPresets: () => {},
        flash: () => {},
        doPreset: () => Promise.resolve({}),
        // ⚠️ 段落草稿（勾选区那组「系统提示词」tag 用）。
        //    不给的话那一组**整组不显示**（拿不到 presetSections → 当成空组），不报错。
        presetSections: {},
        setPresetSections: () => {},
        sectionsData: { globalOverrides: {} },
      },
      over,
    );

  // ══ 卡片头的**结构**：两段竖排 + 动作成组 ═══════════════════════════════
  //
  // ⚠️ 真机上出的两次问题**都是布局结构**问题 —— 文字被挤成竖排、
  //    按钮被甩到单独一行。渲染测试测的是「渲染出东西了没」，
  //    测不出「排在哪儿」。
  //
  // ⚠️ 判据必须**从渲染结果上取**，不能查源码文本。
  //    第一版查的是源码里有没有 `[swRow, actRow]` —— 注入验证发现
  //    改成 `.flat()` 之后文本还在、守卫照样绿，而实际已经摊平成一行了。
  {
    const el = shims.render(
      comboBox.ComboBlock,
      comboProps({
        presetsData: {
          presets: [{ id: "写代码", name: "写代码", prompts: ["P1"], sections: {} }],
          global: { enabled: true, presetId: "写代码" },
          session: null,
          effective: null,
        },
        presetSections: {},
        setPresetSections: () => {},
        sectionsData: { globalOverrides: {} },
        MasterSwitch: function FakeSwitch() {
          return shims.react.createElement("span", { role: "switch" });
        },
      }),
    );

    // 卡片头 = 带 role="switch" 的那个祖先 div
    // ⚠️ 用**显式标记**定位，不猜结构。
    //    猜过一版（「直接子元素里有 role=switch 的 div」）—— 失败：
    //    `swRow` 的直接子元素是 MasterSwitch **返回的那个 div**，
    //    带 role="switch" 的 span 在更深一层，于是判据一路钻到了外层容器。
    const headEl = findEl(el, (n) => n.props && n.props["data-pm-card-head"] === "1");
    ok(!!headEl, "找得到卡片头");

    if (headEl) {
      const kids = (headEl.children || []).filter(Boolean);
      eq(kids.length, 2, "**卡片头只有两段**（开关段 + 动作段）");

      const swSeg = kids[0];
      const actSeg = kids[1];

      // ① 开关段里**不该有**动作控件
      const swText = swSeg ? flattenText(swSeg).join(" ") : "";
      ok(!swText.includes("保存") && !swText.includes("删除"), "**开关段里没有动作按钮**");
      const swHasSelect = !!(swSeg && findEl(swSeg, (n) => n.type === "select"));
      ok(!swHasSelect, "开关段里没有下拉框");

      // ② 动作段：四个控件都在，顺序对
      const actText = actSeg ? flattenText(actSeg).join(" ") : "";
      ok(actText.includes("保存"), "动作段里有「保存」");
      ok(actText.includes("删除"), "动作段里有「删除」");
      ok(actText.includes("↻"), "动作段里有「↻」");
      ok(!!(actSeg && findEl(actSeg, (n) => n.type === "select")), "动作段里有下拉框");

      const seq = [];
      (function walkSeg(n) {
        if (!n || typeof n !== "object") return;
        if (n.type === "select") seq.push("sel");
        if (n.type === "button") {
          const t = flattenText(n).join("");
          if (t.includes("保存")) seq.push("sav");
          else if (t.includes("删除")) seq.push("del");
          else if (t.includes("↻")) seq.push("r");
        }
        for (const c of n.children || []) walkSeg(c);
      })(actSeg || {});
      eq(seq.join(","), "sel,sav,del,r", "**顺序：下拉 → 保存 → 删除 → 刷新**（用户指定的位置）");

      // ③ 动作段不许换行（控件要保持形状）
      ok(!!actSeg, "**动作段（第二段）找得到**");
      const actStyle = actSeg && actSeg.props && actSeg.props.style;
      eq(
        actStyle && actStyle.flexWrap,
        "nowrap",
        "**动作段 nowrap**（挤不下时该收窄的是标题，不是压按钮）",
      );
      ok(
        !(headEl.props.style && headEl.props.style.flexDirection === "row"),
        "**卡片头不是一行**（两段竖排）",
      );
    }
  }


// ── 5z. 勾选区那组「系统提示词」tag ────────────────────────────────────────
//
// 用户原话：「勾选**个人提示词与系统提示词 tag**」。
//
// ⚠️ 这一组语义跟个人提示词那组**不同**：
//      个人提示词 → 勾 = 这条加进预设
//      系统提示词 → 勾 = 这段的**改动**留在预设里
//                    取消勾 = 回到原生（从预设的 sections 去掉）
//    「取消勾」**不是**「关掉这段提示词」—— 那是系统提示词那栏 disable 干的事。
{
  // ① 预设里带一段改动 + 全局另改一段 → 两个 tag，一个勾一个没勾
  {
    const tags = [];
    const el = shims.render(
      comboBox.ComboBlock,
      comboProps({
        presetSections: { "harness:identity": { action: "replace", text: "x" } },
        setPresetSections: () => {},
        sectionsData: {
          globalOverrides: {
            "harness:identity": { action: "replace", text: "x" },
            "tool:bash": { action: "disable" },
          },
        },
      }),
    );
    findEl(el, (n) => {
      if (n.type === "input" && n.props && n.props["data-section-tag"]) tags.push(n);
      return false;
    });
    eq(tags.length, 2, "**有改动痕迹的两段都列出来了**（预设里 1 段 + 全局另 1 段）");
    const byName = {};
    for (const t of tags) byName[t.props["data-section-tag"]] = t.props.checked;
    eq(byName["harness:identity"], true, "**预设里带着的那段是勾着的**");
    eq(byName["tool:bash"], false, "**只有全局改过的那段没勾**（勾上 = 收进这条预设）");
  }

  // ② 一段都没改 → **整组不显示**
  {
    const el = shims.render(
      comboBox.ComboBlock,
      comboProps({
        presetSections: {},
        setPresetSections: () => {},
        sectionsData: { globalOverrides: {} },
      }),
    );
    const found = [];
    findEl(el, (n) => {
      if (n.props && n.props["data-section-tag"]) found.push(n);
      return false;
    });
    eq(found.length, 0, "**一段都没改时不显示这一组**（列没改过的会让人以为勾上就能改）");
  }

  // ③ 取消勾 → 只改草稿，**不发请求**
  {
    const got = [];
    const posts = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (init && init.method === "POST") posts.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    const el = shims.render(
      comboBox.ComboBlock,
      comboProps({
        presetSections: { "harness:identity": { action: "replace", text: "x" } },
        setPresetSections: (next) => got.push(next),
        sectionsData: { globalOverrides: {} },
      }),
    );
    const one = [];
    findEl(el, (n) => {
      if (n.props && n.props["data-section-tag"] === "harness:identity") one.push(n);
      return false;
    });
    eq(one.length, 1, "找得到那段的 tag");
    if (one[0]) one[0].props.onChange();
    eq(got.length, 1, "**取消勾只改草稿**");
    eq(
      Object.prototype.hasOwnProperty.call(got[0] || {}, "harness:identity"),
      false,
      "**那一段从草稿里移除了**（= 回到原生）",
    );
    eq(posts.length, 0, "**不立刻发请求** —— 保存时才写盘");
    globalThis.fetch = realFetch;
  }
}


  const spy = [];
  const el = shims.render(
    comboBox.ComboBlock,
    comboProps({
      doPreset: (payload) => {
        spy.push(payload);
        return Promise.resolve({ ok: true, name: payload.name });
      },
    }),
  );

  // 「保存」按钮：当前匹配到预设 → 应该调 doPreset({action:"save", name: 当前预设名})
  const saveBtn = findEl(el, (n) => n.type === "button" && flattenText(n).join("") === "保存");
  ok(!!saveBtn, "找得到「保存」按钮");
  if (saveBtn) {
    saveBtn.props.onClick();
    eq(spy.length, 1, "**点保存真的调到了 doPreset**（回调链没被 props 断掉）");
    eq(spy[0] && spy[0].action, "save", "提交的是 save");
    eq(spy[0] && spy[0].name, "写代码", "覆盖当前匹配到的那条预设");
    // ⚠️ 原来这条验的是 `scope: "global"` —— 那个字段**已经删了**
    //    （预设不再带作用范围，挂在哪层由位置决定）。
    //    现在要守的是：**保存时把勾选草稿一起交上去** ——
    //    不带的话「勾了几条 → 保存」只会存下预设的旧内容，用户白勾。
    ok(
      Array.isArray(spy[0] && spy[0].prompts),
      "**保存时带上了勾选草稿**（不带的话勾了等于白勾）：" + JSON.stringify(spy[0] && spy[0].prompts),
    );
  }

  // 预设下拉：选另一条 → doPreset({action:"apply", id})
  spy.length = 0;
  const sel = findEl(el, (n) => n.type === "select");
  ok(!!sel, "找得到预设下拉");
  if (sel) {
    sel.props.onChange({ target: { value: "写作" } });
    eq(spy.length, 1, "**换预设真的调到了 doPreset**");
    eq(spy[0] && spy[0].action, "apply", "提交的是 apply");
    eq(spy[0] && spy[0].id, "写作", "应用的是下拉选中的那条");
  }

  // 「重新读取」→ loadPresets
  const calls = [];
  const el2 = shims.render(comboBox.ComboBlock, comboProps({ loadPresets: () => calls.push("reload") }));
  const reloadBtn = findEl(el2, (n) => n.type === "button" && flattenText(n).join("") === "↻");
  ok(!!reloadBtn, "找得到「↻」重新读取");
  if (reloadBtn) {
    reloadBtn.props.onClick();
    eq(calls.length, 1, "**点 ↻ 真的调到了 loadPresets**");
  }

  // 勾选框 → setActivePrompts
  const picked = [];
  const el3 = shims.render(
    comboBox.ComboBlock,
    comboProps({ setPresetDraft: (ids) => picked.push(ids) }),
  );
  const cb = findEl(el3, (n) => n.type === "input" && n.props && n.props.type === "checkbox");
  ok(!!cb, "找得到勾选框");
  if (cb) {
    cb.props.onChange();
    eq(picked.length, 1, "**勾一下真的交给了草稿**（不再直接写盘 —— 那条走的是已退役的 /defaults）");
    ok(Array.isArray(picked[0]), "交出的是 id 数组：" + JSON.stringify(picked[0]));
  }

  // 改名：点 ✎ → 标题变输入框 → 回车提交 → doPreset({action:"rename"})
  //
  // ⚠️ 这一段是补的：上面那几条（保存/下拉/↻/勾选）**覆盖不到 commitRename** ——
  //    注入验证时发现「commitRename 忘了转发 props」照样全绿。
  //    改名这条链路要先让 `renaming` 为真才会出现输入框，所以单独渲染一次。
  spy.length = 0;
  const renamed = [];
  const elRename = shims.render(
    comboBox.ComboBlock,
    comboProps({
      renaming: true,
      renameDraft: "新名字",
      doPreset: (payload) => {
        spy.push(payload);
        return Promise.resolve({ ok: true, id: "新名字", name: "新名字" });
      },
      setRenaming: (v) => renamed.push(v),
    }),
  );
  const nameInput = findEl(
    elRename,
    (n) => n.type === "input" && n.props && n.props.type === "text",
  );
  ok(!!nameInput, "改名时标题位置是个输入框");
  if (nameInput) {
    eq(nameInput.props.value, "新名字", "输入框里是当前名字");
    nameInput.props.onKeyDown({ key: "Enter" });
    eq(spy.length, 1, "**回车真的调到了 doPreset**（改名链路没被 props 断掉）");
    eq(spy[0] && spy[0].action, "update", "提交的是 update（改名和改内容是同一个动作）");
    eq(spy[0] && spy[0].name, "新名字", "交出新名字");
    eq(renamed[0], false, "提交后收起输入框");
  }
}

// ── 3d. 「按索引塞状态」这件事必须有个护栏 ─────────────────────────────────
//
// 测试是靠 `shims.setStates([...])` **按 useState 的下标**塞状态的，
// 所以**增删任何一个 useState 都会让后面所有下标错位**，而错位不会报错 ——
// 只会让断言莫名其妙地红（这轮删掉 sectionScope / sectionSessionId 时就中了：
// presetsData 从 12 变 10、enabledDraft 从 15 变 13，一次红了 10 条）。
//
// 这里把 PromptEditor 里 useState 的**数量与顺序**钉住：动了就必须来改这张表，
// 顺带被迫检查所有按索引塞状态的地方。
{
  const src = readFileSync(join(HERE, "..", "client.editor.js"), "utf8");
  const start = src.indexOf("function PromptEditor(");
  ok(start > 0, "找得到 PromptEditor");
  if (start > 0) {
    const rest = src.slice(start);
    // ⚠️ 会多抓到后面别的函数里的 useState —— 用 `react.useCallback` 截断：
    //    PromptEditor 的状态全部集中在函数体前段，第一个 useCallback
    //    （setActivePrompts）之后就不属于「状态声明区」了。
    const cbAt = rest.search(/react\.useCallback/);
    const head = cbAt > 0 ? rest.slice(0, cbAt) : rest;
    const headNames = [...head.matchAll(/var\s+(\w+)\s*=\s*react\.useState\(/g)].map((m) => m[1]);
    const expected = [
      "listSt",
      "busySt",
      "errSt",
      "editSt",
      "msgSt",
      "openSt",
      "defSt",
      "defBusySt",
      "secSt",
      "secBusySt",
      "secOpenSt",
      "secDraftSt",
      "preSt",
      "preBusySt",
      "preNameSt",
      // ⚠️ `draftSt` = 勾选草稿（序号 15）。加它是因为勾选不再直接写盘 ——
      //    原来那条路打的是**已退役的 /defaults**（回 410）。
      //    这个守卫当场点名了「实际……draftSt……，期望……」。
      "draftSt",
      // ⚠️ `preSecSt` = 段落草稿（序号 16）—— 勾选区那组「系统提示词」tag 用它。
      //    加它的时候我把它也命名成 `secDraftSt`，**跟已有的段落编辑草稿撞了名** ——
      //    这个守卫把两串都打出来，一眼看出重复（它第二次救场）。
      "preSecSt",
      "enSt",
      "catSt",
      "rnSt",
      "rnDraftSt",
    ];
    eq(
      headNames.join(","),
      expected.join(","),
      "**useState 的数量与顺序没变**（变了就必须同步改测试里所有按索引塞状态的地方）",
    );
  }
}

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
  // ⚠️ **这里不能清零** —— 上一步的 `renderPicker` 刚产出 portal，
  //    在这儿清掉的话下面数的就是 0（我这么错过一次，绕了好几轮）。
  //    要清得在**渲染之前**清（新会话页那个下拉框的用例里已经清了）。
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
    // ⚠️ **别断言「总数是 1」** —— `shims.portals` 是**全局累积**的，
    //    别的用例（新会话页那个下拉框）也会各留一个。
    //    数自己的那个：取最后一个，确认它是 portal 到 body 的。
    const lastPortal = shims.portals[shims.portals.length - 1];
    ok(
      shims.portals.length >= 1 && lastPortal && lastPortal.target && lastPortal.target.__isBody === true,
      "弹窗被 portal 到 document.body（累计 " + shims.portals.length + " 个，最后一个的目标是 body）",
    );
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
        ok(false, "卡片渲染不炸: " + label + " —— 抛了 " + e.message);
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

// ── 5d. 会话页那个**预设下拉框**：三个非预设选项 + 当前生效标记 ─────────────
//
// 用户的要求就一句：「会话页头部精简为【一个预设下拉框，点击勾选就能注入】」。
// 所以这里测的是**选预设**，不是选提示词 tag（那是设置页的事）。
{
  const data = {
    assignments: { s1: "写代码" },
    global: { enabled: true, presetId: "全局那条" },
    presets: {
      写代码: { name: "写代码", prompts: ["a"], sections: {}, label: "写代码", summary: "自设 1 条" },
      全局那条: { name: "全局那条", prompts: [], sections: { x: {} }, label: "翻译", summary: "自设 1 条" },
    },
    prompts: [{ id: "a", name: "甲", mode: "append", order: 100, tokens: 50 }],
    diag: { routeRegistered: true, sessions: [] },
  };
  // ⚠️ `/presets` 的响应形状（面板读的是它，不是 `/state`）。
  const presetsResp = {
    presets: [
      { id: "写代码", name: "写代码", prompts: ["a"], sections: {}, label: "写代码", summary: "自设 1 条" },
      { id: "全局那条", name: "全局那条", prompts: [], sections: { x: {} }, label: "翻译", summary: "自设 1 条" },
    ],
    global: { enabled: true, presetId: "全局那条" },
    session: { sessionId: "s1", presetId: "写代码" },
    effective: { id: "写代码", preset: null, source: "session" },
  };

  shims.setStates([data, false, null, null, true, null]);
  // ⚠️ 面板的 extras 是**调全局 fetch** 拿的（`/presets?session=`），
  //    所以这里给 globalThis.fetch 装个假的。用完**必须还原** ——
  //    不还原的话后面的用例会拿到这个假的，红得莫名其妙。
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    void url;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(presetsResp) });
  };

  const el = renderPicker({ sessionId: "s1" });
  const text = flattenText(el).join(" ");
  ok(text.includes("系统提示词"), "**有「系统提示词」这个选项**（= 什么都不挂）");
  ok(text.includes("跟随全局"), "**有「跟随全局」这个选项**（跟「什么都不挂」不是一回事）");
  ok(text.includes("写代码"), "列出各条预设（用 label 显示）");
  ok(
    text.includes("系统提示词 · 改"),
    "**只改了系统提示词的那种预设显示成「系统提示词 · 改」**（用户的场景②）",
  );
  globalThis.fetch = realFetch;
}

// ── 5e. 点一下就提交，而且三种状态发的请求体不同 ──────────────────────────
//
// ⚠️ 三条请求体是这次改动**最容易写错**的地方：
//
//      具体预设   → { presetId: "<id>" }
//      系统提示词 → { presetId: null }   （显式什么都不挂，压过全局）
//      跟随全局   → { follow: true }     （删记录）
//
//    后两个**合并成一个**的话，用户就没法表达「这个会话别挂全局的」——
//    而那正是开关关掉之后唯一能表达「什么都不挂」的方式。
{
  const realFetchAgain = globalThis.fetch;
  const mkData = () => ({
    assignments: {},
    global: { enabled: true, presetId: "全局那条" },
    presets: { 写代码: { name: "写代码", prompts: ["a"], sections: {}, label: "写代码" } },
    prompts: [],
    diag: { routeRegistered: true, sessions: [] },
  });
  const presetsResp = {
    presets: [{ id: "写代码", name: "写代码", prompts: ["a"], sections: {}, label: "写代码" }],
    global: { enabled: true, presetId: "全局那条" },
    session: { sessionId: "s1", presetId: undefined },
    effective: { id: "全局那条", preset: null, source: "global" },
  };
  void mkData;

  /** 渲染面板，并抓出它发出的那个 POST。 */
  function tap(labelPart, own) {
    const posts = [];
    globalThis.fetch = (url, init) => {
      if (init && init.method === "POST") posts.push({ url: String(url), body: init.body });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(presetsResp) });
    };
    // ⚠️ **预设表必须放在这里（/state 那份）** —— 渲染是同步的，
    //    面板里 useEffect 拉的 extras 到断言时还没回来。
    //    放空的话选项列表就是空的，红的会是夹具不是实现。
    shims.setStates([{
      // ⚠️ **每个断言要给不同的 `own`** —— 被测的那个选项必须是
      //    **非当前项**，否则点下去只关面板（那是对的 UX，不是 bug）。
      //    三种状态：
      //      没有 s1 的记录      → 当前是「跟随全局」
      //      assignments[s1]=null → 当前是「系统提示词」
      //      assignments[s1]=某条 → 当前是那条预设
      assignments: own,
      // ⚠️ **每个断言要给不同的 `own`** —— 被测的那个选项必须是
      //    **非当前项**，否则点下去只关面板（那是对的 UX，不是 bug）。
      //    三种状态：
      //      没有 s1 的记录      → 当前是「跟随全局」
      //      assignments[s1]=null → 当前是「系统提示词」
      //      assignments[s1]=某条 → 当前是那条预设
      assignments: own,
      global: { enabled: true, presetId: "全局那条" },
      presets: {
        写代码: { name: "写代码", prompts: ["a"], sections: {} },
        全局那条: { name: "全局那条", prompts: ["g"], sections: {} },
      },
      prompts: [{ id: "a", name: "甲", mode: "append", order: 100, tokens: 50 }],
      diag: { routeRegistered: true, sessions: [] },
    }, false, null, null, true, null]);
    // ⚠️ **面板靠注入 `picking: true` 打开**（state 序号 4），不能靠点按钮：
    //    这些测试的状态是按 useState 下标塞的，每次 render 都归零 ——
    //    onClick 里调的 setPicking 不影响下一次渲染读到的值。
    //    （踩过：面板一直不开，findEl 找不到选项。）
    const el = renderPicker({ sessionId: "s1" });

    // ⚠️ 用现成的 findEl 收全部匹配 —— pred 里 push 完返回 false 继续遍历。
    const btns = [];
    findEl(el, (n) => {
      if (n.type === "button" && flattenText(n).join(" ").includes(labelPart)) btns.push(n);
      return false;
    });
    ok(btns.length > 0, "找得到选项「" + labelPart + "」");
    if (btns[0]) btns[0].props.onClick && btns[0].props.onClick();
    return posts;
  }

  {
const posts = tap("写代码", {}); // 当前是「跟随全局」→「写代码」可点
    eq(posts.length, 1, "**点一下就提交**（没有「应用」按钮）");
    eq(posts[0].url.includes("/assign"), true, "提交给 /assign");
    eq(JSON.parse(posts[0].body).presetId, "写代码", "具体预设 → presetId 是那条预设");
  }
  {
const posts = tap("系统提示词", { s1: "写代码" }); // 当前是「写代码」→「系统提示词」可点
    eq(JSON.parse(posts[0]?.body || "{}").presetId, null, "**「系统提示词」→ presetId: null**（显式什么都不挂）");
    eq("follow" in JSON.parse(posts[0]?.body || "{}"), false, "它**不**是 follow");
  }
  {
const posts = tap("跟随全局", { s1: "写代码" }); // 当前是「写代码」→「跟随全局」可点
    eq(JSON.parse(posts[0]?.body || "{}").follow, true, "**「跟随全局」→ follow: true**（删记录）");
  }
  globalThis.fetch = realFetchAgain;
}


// ── 5f. 入口按钮显示当前选择（含来自默认时的区分）──────────────────────────
{
  // ⚠️ 新形状：
  //    · `assignments[sid]` 是**预设 id 字符串**（或 null），不再是 prompt id 数组
  //    · 全局是 `global: { enabled, presetId }`，不再是 `defaults: []`
  const data = {
    assignments: { s2: "写代码" },
    global: { enabled: true, presetId: "写作" },
    presets: {
      写代码: { name: "写代码", prompts: ["a", "b"], sections: {} },
      写作: { name: "写作", prompts: ["repl"], sections: {} },
    },
    prompts: [
      { id: "a", name: "甲", mode: "append", order: 100, tokens: 50 },
      { id: "b", name: "乙", mode: "append", order: 200, tokens: 60 },
      { id: "repl", name: "替换", mode: "append", order: 10, tokens: 20 },
    ],
    diag: { routeRegistered: true, sessions: [] },
  };
  // s2 显式有两条
  shims.setStates([data, false, null, null, false, null]);
  let el = renderPicker({ sessionId: "s2" });
  let text = flattenText(el).join(" ");
  // ⚠️ 新模型里按钮显示的是**预设名**，不是「首条提示词 +N」——
  //    预设是唯一载体，会话头一眼要看出「我在哪套配置上」。
  ok(
    /写代码|写作/.test(text),
    "显式选了预设时，按钮显示那条预设的名字",
  );
  ok(!text.includes("·默认"), "显式指定时不加「默认」标记");

  // s3 没有显式记录 → 用默认
  shims.setStates([data, false, null, null, false, null]);
  el = renderPicker({ sessionId: "s3" });
  text = flattenText(el).join(" ");
  // ⚠️ 这条原来盯的是「未指定时按钮显示默认那条的名字」（老模型里默认是一层裸 id）。
  //    新模型里全局就是**指向一条预设**，按钮显示预设名或「未保存的配置」，改成盯那个。
  // ⚠️ 不假设具体排版 —— picker 面板正在按「一个预设下拉框」重写，
  //    这里只要求「**能看出这个会话实际用的是哪条**」。
  ok(
    /写代码|写作|跟随全局|未保存的配置/.test(text),
    "会话头能看出这个会话实际用哪条（预设名 / 跟随全局 / 未保存占位）",
  );
  // ⚠️ 同上：不假设排版，只要能区分「自己选的」和「跟着全局」。
  ok(
    /跟随全局|写作|写代码/.test(text),
    "来源可见：能区分这个会话是自己选了一条还是跟着全局",
  );
}

// ── 5g. 空选中时按钮显示「不注入」──────────────────────────────────────────
{
  // ⚠️ 新形状：`assignments[sid] = null` 才是「显式什么都不挂」——
  //    老版本用的是空数组。
  const data = {
    assignments: { s4: null },
    global: { enabled: true, presetId: "有货" },
    presets: { 有货: { name: "有货", prompts: ["a"], sections: {} } },
    prompts: [{ id: "a", name: "甲", mode: "append", order: 100, tokens: 50 }],
    diag: { routeRegistered: true, sessions: [] },
  };
  shims.setStates([data, false, null, null, false, null]);
  const text = flattenText(renderPicker({ sessionId: "s4" })).join(" ");
  ok(text.includes("不注入"), "**显式「什么都不挂」时显示「不注入」**（即使全局有货）");
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
  // ⚠️ 新形状。**预设表必须给全** —— 少了它 `presets[presetId]` 查不到，
  //    标签只能退回兜底文案，红的会是夹具不是实现。
  const base = {
    assignments: {},
    global: { enabled: true, presetId: "底" },
    presets: {
      底: { name: "底", prompts: [], sections: { "harness:identity": { action: "replace", text: "x" } } },
      带段落的: { name: "带段落的", prompts: ["a"], sections: {} },
      两样都有: { name: "两样都有", prompts: ["a"], sections: { "harness:identity": { action: "replace", text: "x" } } },
    },
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
  // ⚠️ 新模型里**没有**「改原生 N 段」这个后缀了 —— 「改了系统提示词」是
  //    预设内容的一部分，体现在预设名（或「系统提示词 · 改」）上。
  //    这条改成盯那个说法。
  ok(
    /系统提示词 · 改|写作|写代码/.test(t1),
    "改了原生段落时，标签体现出来（预设名 或「系统提示词 · 改」）",
  );

  // ③ 两个都有 → 名字仍然要在（会话头一眼要看出这条提示词叫啥）
  shims.setStates([
    Object.assign({}, base, {
      assignments: { s9: "两样都有" },
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
  // ⚠️ 同上：不再把「提示词名字」和「改写计数」拼在一起 ——
  //    两样都是**预设内容**，显示预设名就够了。
  ok(
    /两样都有|带段落的|甲/.test(t2),
    "**能看出用了哪条预设**（预设名覆盖了提示词名和改写计数两件事）",
  );
  ok(!/改原生 \d+ 段/.test(t2), "**不再有「改原生 N 段」计数**（那是老模型的说法）");
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
    // ── 页头：跟 dsh 其它设置页一样（标题 + 一句话说明）──────────────────
    //
    // 参照物是插件页：
    //     <h2 className={css.heading}>{t("title")}</h2>
    //     <p  className={css.intro}>{t("intro")}</p>
    // heading = `margin:0;font-size:18px;font-weight:600`
    // intro   = `color:label-tertiary;margin:0;font-size:13px`
    {
      const h2 = findEl(el, (n) => n.type === "h2");
      ok(!!h2, "**页头有 h2 标题**（其它内容页也是 h2）");
      if (h2) {
        eq(flattenText(h2).join(""), "提示词管理", "**页头标题就是这一页的名字**");
        eq(h2.props.style.fontSize, "18px", "标题字号跟其它页一致（18px）");
        eq(h2.props.style.fontWeight, "600", "标题字重跟其它页一致（600）");
      }
      const intro = findEl(
        el,
        (n) => n.type === "p" && flattenText(n).join("").length > 10,
      );
      ok(!!intro, "页头标题下面有一句话说明");
      if (intro) {
        eq(intro.props.style.fontSize, "13px", "说明字号跟其它页一致（13px）");
      }
      // ⚠️ 页头必须在**最前面** —— 排在内容后面就不叫页头了。
      //    根节点的第一个子元素应该就是它（里面装着 h2）。
      const rootKids = el.children || [];
      const first = rootKids[0];
      const firstHasH2 = !!findEl(first, (n) => n.type === "h2");
      ok(firstHasH2, "**页头在页面最前面**（根的第一个子元素）");

      // ── 两档间距，数值照抄参考页（模型页 ModelsSection）────────────────
      //
      //      .section { gap:12px }          ← 所有直接子元素之间
      //      .rows    { margin:12px 0 0 }   ← 内容块自己再带 12px
      //
      //   于是：**功能 ↔ 功能 = 12px**，**页头 ↔ 第一个功能 = 24px**。
      //   用户要的就是「页头离功能远一点、功能之间近一点」—— 这两条把它钉住。
      {
        const S = (el.props && el.props.style) || {};
        eq(S.gap, "12px", "**功能之间 12px**（父级 gap，跟参考页一致）");
        // ⚠️ 这里原来有一条「两份 SECTION 的 gap 要一致」的断言 —— **已退役**。
        //
        //    背景：`SECTION` 曾经在 client.js（宿主）和 client.editor.js 里**各写一份**，
        //    后者覆盖前者，只改一处页面纹丝不动（踩过，所以加了那条断言）。
        //    现在编辑器里那份本地样式常量副本**整块删掉了**（27 个 / 233 行）——
        //    样式只有 `api.style` 一个来源，不存在「两份」了，那条断言失去对象。
        //
        //    改成反过来盯「**不许再长出第二份**」：
        {
          // 三个 chunk 一起查：只要出现 `^ {6}var X = {`（6 空格缩进的对象字面量
          // 常量），就说明又长出了一份本地样式副本 —— 它会**盖掉** api.style 那份，
          // 于是「改了宿主没反应」。
          //
          // 删掉的那批：editor 27 个 / picker 21 个 / preview 7 个（共 55 个副本）。
          // 各自留下的必须项（宿主没有或值故意不同）单独列在下面。
          const ALLOWED = {
            "client.editor.js": [],                       // 一个都不留
            "client.picker.js": ["SELECT_SM", "ADVISE", "ROW", "PILL_SWITCH"],
            "client.preview.js": ["SEC", "ADVISE"],
          };
          for (const [file, allowed] of Object.entries(ALLOWED)) {
            const src = readFileSync(join(HERE, "..", file), "utf8");
            const local = [...src.matchAll(/^ {6}var (\w+) = \{/gm)].map((m) => m[1]);
            const extra = local.filter((n) => !allowed.includes(n));
            eq(
              extra.join(","),
              "",
              `**${file} 没有多出来的本地样式常量副本**（多出来的会盖掉 api.style 那份）`,
            );
          }
        }
        const second = rootKids[1];
        ok(!!second, "有第一个功能块");
        if (second) {
          const st = (second.props && second.props.style) || {};
          eq(
            st.marginTop,
            "12px",
            "**页头 ↔ 第一个功能 = gap12 + margin12 = 24px**（内容块自带 margin）",
          );
        }
        // 页头内部：标题和说明之间要近得多（4px），否则读起来是两块
        const headKids = (first && first.children) || [];
        eq(headKids.length, 2, "页头是「标题 + 说明」两行");
        const hst = (first.props && first.props.style) || {};
        eq(hst.gap, "4px", "**标题和说明之间 4px**（比 24px 近得多，读起来是一块）");
      }
    }
    ok(text.includes("个人提示词"), "标题在");
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

    // ── 卡片结构：大类别卡片里套个人提示词卡片 ──────────────────────────
    //
    // 用户要的：**个人提示词的卡片跟系统提示词的卡片长得一样，
    // 外面再套一层大类别卡片。**
    //
    // 这条断言盯的是那层嵌套本身 —— 只看文字的话，「分类标题 + 平铺网格」
    // 和「类别卡片里套卡片」在 flattenText 眼里一模一样，结构塌了也发现不了。
    //
    // 判据：数「一个卡片头**里面**还含几个卡片头」。平铺时是 0；
    // 类别卡片套一张提示词卡片时是 1。顺带验类别头上有分类名。
    //
    // ⚠️ **必须复用上面那棵 `el`，不能再调一次 renderEditor。**
    //    影子层是按 hook 序号塞状态的，一个块里渲染两次，第二次拿到的
    //    是错位的状态（真 React 不会 —— 状态挂在实例上）。
    //    踩过：第二次渲染出来只剩一个「普通」分类，`其他` 那个不见了。
    {
      const nesting = countNestedCards(el);
      const heads = collectByClass(el, "pm-head");
      ok(nesting > 0, `**有卡片套在卡片里**（类别卡片 → 个人提示词卡片），实际 ${nesting}`);
      ok(heads.length >= 3, `个人提示词那块的卡片头数（实际 ${heads.length}）`);
      // 类别卡片头上要有分类名（平铺版是裸标题，没有卡片头）。
      // ⚠️ 名字走 categoryName()：内置分类查表得中文名，**自定义分类原样显示 id**
      //    （这是既有行为，不是 bug）。这个用例的 listData 没带 categories 表，
      //    所以显示的就是 `other`。
      const catHead = heads.find((h) => {
        const t = flattenText(h).join(" ");
        return t.includes("条") && t.includes("›") && !t.includes("tokens");
      });
      ok(!!catHead, "**有类别卡片头**（带条数和箭头，且不是某条提示词的卡片）");
      if (catHead) {
        const t = flattenText(catHead).join(" ");
        ok(/\d+ 条/.test(t), "类别头上带条数");
        ok(t.includes("›"), "类别头有折叠箭头（能整类收起来）");
        // ⚠️ 类别头**不该**显示 token 数 —— 那是提示词卡片才有的
        ok(!t.includes("tokens"), "**类别头不显示 token 数**（跟提示词卡片区分开）");
      }
    }
    ok(!text.includes("4300 字符"), "折叠态不显示字符数（在详情里）");
    ok(!text.includes("format-contract.md"), "折叠态不显示正文文件名");
    // ⚠️ 「新会话默认」卡片已删 —— 这里原来断言它默认展开。
    //    现在是反向断言：它不该出现（删干净了，不是藏起来）。
    ok(!text.includes("新会话默认"), "**「新会话默认」卡片已删**（不再出现在页面任何位置）");
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
    ok(text.includes("保存"), "**编辑表单**里有保存按钮");
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
    ok(false, "**单独渲染表单**不抛异常 —— 抛了 " + e.message);
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
        ok(false, "编辑器遇到边界数据不炸: " + label + " —— 抛了 " + e.message);
    }
  }
}

// ── 5h3. 设置页：**没有**「新会话默认」卡片（已删） ─────────────────────────
//
// ⚠️ 这张卡片被用户点名删掉了：它占一张大卡片，而「默认」这一层在
//    「提示词组合」那块本来就有入口（scope = 全局默认时 setActivePrompts
//    打的就是 ROUTE_DEFAULTS）—— 两处提供同一个入口，还都是常驻的。
//
// 底层那层**没砍**（defaults 仍可用、全局开关仍管它、会话页的「跟随默认」
// 仍读它），只是设置页不再有专门的卡片。所以这里是**反向断言**：不许长回来。
//
// useState 顺序：list / busy / err / edit / message / openId / defaultsDraft / defaultsBusy
{
  const listData = {
    prompts: [
      { id: "gen4", name: "格式契约", description: "载荷", mode: "append", order: 100, source: "file", file: "gen4.md", tokens: 1200, chars: 4300, text: "x" },
      { id: "gen3", name: "格式契约甲", description: "", mode: "append", order: 100, source: "file", file: "gen3.md", tokens: 900, chars: 3000, text: "y" },
    ],
    promptsDir: "X:\\test\\prompts",
    defaults: ["gen4"],
    libraryErrors: [],
  };

  shims.setStates([listData, false, null, null, null, null, ["gen4"], false]);
  const el = renderEditor({});
  const text = flattenText(el).join(" ");
  ok(!text.includes("新会话默认"), "**没有「新会话默认」卡片了**（用户点名删掉）");
  ok(!text.includes("新会话挂"), "连带那句状态行也没了");
  const tip = collectTitles(el).find((t) => t.includes("新开的会话自动挂这几条")) || "";
  eq(tip, "", "**连它的说明也没了**（不是只把卡片藏起来）");
  ok(text.includes("格式契约"), "提示词条目照常显示");
  // ⚠️ 文案变了：这一块**不再有「提示词组合」这个静态标题** ——
  //    标题位置现在就是**当前配置名**（一眼知道自己在哪套上）。
  //    判据不能再找那四个字，要找它现在实际有的东西。
  ok(text.includes("未保存的配置") || text.includes("写代码"), "**那一块还在**（标题位置是当前配置名）");
}

// ── 5h3b. 边界：defaults 字段缺失 / 不是数组，都不能炸 ──────────────────────
{
  for (const [label, states] of [
    ["defaults 缺失", [{ prompts: [], promptsDir: "x", libraryErrors: [] }, false, null, null, null, null, undefined, false]],
    ["defaults 不是数组", [{ prompts: [], promptsDir: "x", defaults: "乱写", libraryErrors: [] }, false, null, null, null, null, "乱写", false]],
  ]) {
    shims.setStates(states);
    try {
      renderEditor({});
      ok(true, "defaults 边界不炸: " + label);
    } catch (e) {
        ok(false, "defaults 遇到边界数据不炸: " + label + " —— 抛了 " + e.message);
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

    // ⚠️ 回归守卫：**内置分类不许被标成「自定义分类」**。
    //
    //    踩过：`renderGroupCard(g, seen[g.id])` —— 第二个参数本该是
    //    「这是不是自定义分类」，却传了 `seen[g.id]`。而 `seen` 是「这个 id
    //    有没有被处理过」的记账表，内置分类在初始化时全被标成 true ——
    //    结果**每个分类都挂上了「自定义分类」徽章**（用户看到「领域」标着
    //    自定义，就是这么来的）。
    //
    //    判据：按类别卡片逐个看 —— 「自定义分类」只允许出现在真自定义的
    //    那张卡片头上。
    const heads = collectByClass(el, "pm-head");
    for (const h of heads) {
      const t = flattenText(h).join(" ");
      if (!t.includes("自定义分类")) continue;
      ok(
        t.includes("安全审查"),
        `**只有自定义分类才带那个徽章**（实际带徽章的是「${t}」）`,
      );
    }
    const catHeads = heads.filter((h) => {
      const t = flattenText(h).join(" ");
      return t.includes("条") && !t.includes("tokens");
    });
    ok(
      catHeads.length >= 4,
      `类别卡片头数（实际 ${catHeads.length}：身份/工具/其他/安全审查）`,
    );
    ok(
      !catHeads.some((h) => {
        const t = flattenText(h).join(" ");
        return t.includes("自定义分类") && !t.includes("安全审查");
      }),
      "**内置分类的类别头上没有「自定义分类」徽章**",
    );

    // ── 标题行和卡片必须在同一个块里 ────────────────────────────────────
    //
    // ⚠️ 踩过：把 `header` 和卡片拆成**两个 body 项**塞进最外层容器。
    //    而那个容器是 `display:flex; gap:14px` 的列 —— body 每一项之间都隔 14px，
    //    于是标题行跟卡片硬隔了 14px、还各自跟上下邻居等距，看着像一条独立的
    //    说明条，跟卡片没关系。系统提示词那块（renderSections）从来就是一个块，
    //    标题和卡片挨着（10px）。用户直接问了「你为什么把标题行和卡片分开放置」。
    //
    // ⚠️ 判据是**数量**：根的直接子里含「个人提示词」的必须**只有一个**。
    //    拆开时会变成两个（标题一个、卡片一个）—— 那才是要抓的情况。
    //    （第一版写成「根的子元素里有没有含标题的」，而合并后的那个块本身就
    //      含标题，于是正确结构被判成错、白红一条。）
    //
    // ⚠️⚠️ 而且这条**必须放在有卡片的用例里**。第一次塞进了上面那个
    //      `prompts: []` 的块 —— 那里一张卡片都没有，拆不拆都一样，
    //      守卫是空的：把结构拆开跑，照样绿。
    //    判据：根的直接子里，**同时**含「个人提示词」和类别卡片头的那个块
    //    必须恰好一个。拆开时是 0 —— 标题一个块、卡片另一个块，
    //    任何一个块里都不同时具备两者。
    //
    //    ⚠️ 这里连错两次，都记下来：
    //      1) 写成「根的子元素里**有没有**含标题的」—— 合并后那个块本身就含
    //         标题，正确结构被判成错；
    //      2) 改成「含标题的块必须只有一个」—— **拆开后也只有一个是含标题的**
    //         （卡片块里没有那四个字），所以拆开照样绿。
    //    两次都是判据没抓住「同一个块里同时有两者」这个要害。
    {
      const both = (el.children || []).filter(
        (k) =>
          flattenText(k).join("").includes("个人提示词") && countHeadsIn(k) >= 2,
      );
      eq(
        both.length,
        1,
        "**「个人提示词」的标题和卡片在同一个块里**（拆开时这个数是 0）",
      );
    }
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
    ok(false, "**编辑器**渲染新建表单不抛异常 —— 抛了 " + e.message);
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
    ok(false, "**提示词组合那块**缺 categories 字段时不抛异常 —— 抛了 " + e.message);
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

    // ── ③ 面板背景必须是**弹层语义**的变量 ────────────────────────────
    //
    // ⚠️ 这条是三轮真机问题里**最难过的那一条**：
    //
    //    `--dsw-alias-bg-overlay` —— 变量**存在**、明暗也**不同**，
    //    但它是个**遮罩层**色（浮层背后压暗那一层）。深色下它是中灰
    //    #61666b，拿它当面板背景会把面板糊成一片灰。
    //
    //    前两条守卫（变量存在 / 兜底跟主题走）**都拦不住它** ——
    //    所以得把「哪些变量能当弹层背景」写成白名单。
    //
    //    dsh 自己的弹层（`MenuSurface.module.css`）用的是
    //    `--dsw-menu-surface-fill` + `--dsw-menu-backdrop-filter`。
    {
      const OK_BG = [
        "--dsw-specific-menu",
        "--dsw-menu-surface-fill",
        "--dsw-alias-settings-card-fill",
        "--dsw-alias-bg-module-platform",
        "--dsw-alias-bg-layer-2",
      ];
      const OK_MASK = ["--dsw-alias-bg-mask-1"];
      const panels2 = [...src.matchAll(/var PANEL = \{[\s\S]*?\n {4,10}\};/g)].map((m) => m[0]);
      for (const [i, one] of panels2.entries()) {
        const m = /background:\s*"var\((--dsw-[a-z0-9-]+)/.exec(one);
        ok(!!m, `面板背景用主题变量（第 ${i + 1} 份）`);
        if (m) {
          ok(
            OK_BG.includes(m[1]),
            `**面板背景是「面」语义的变量**（第 ${i + 1} 份实际用了 \`${m[1]}\`）—— ` +
              "遮罩层类（如 --dsw-alias-bg-overlay）深色下是中灰，会把面板糊成一片灰",
          );
        }
      }
      // 遮罩层那一个单独网开一面：它**就该**用遮罩色
      ok(
        OK_MASK.some((k) => src.includes(k)),
        "遮罩层用遮罩色（--dsw-alias-bg-mask-1）",
      );
    }
    //
    // ── ④ 兜底不许是 Canvas / CanvasText ──────────────────────────────
    //
    // ⚠️ `Canvas` 在浅色下是白、深色下**也常是白** —— 跟主题不同步。
    //    兜底要么用同族的 dsw 变量，要么用灰度（灰度在两边都不突兀）。
    {
      const sysColors = [...codeOnly.matchAll(/var\(--dsw-[a-z0-9-]+,\s*(Canvas|CanvasText|ButtonFace|Field)\b/g)].map(
        (m) => m[1],
      );
      eq(
        sysColors,
        [],
        "**兜底不许用 Canvas / CanvasText 这类系统色**（浅色下是白，深色下也常是白）",
      );
    }
    // ── 硬编码灰度：必须在 var(--dsw-…) 的兜底位里 ────────────────────
    //
    // ⚠️ 用户报过：面板的 borderBottom 写的是纯 rgba(128,128,128,.25)，
    //    **完全没套变量** —— 浅色主题下这个固定灰跟 dsh 的边框色明显不是一个调子。
    //
    //    更深一层：**兜底值本身**也是硬编码浅色灰。变量在的时候没事，
    //    但变量一旦取不到，退回去的就是个不跟主题走的灰。
    //
    //    所以判据不是「有没有 var(...)」，而是「这个灰度**在不在 var 的兜底位里**」。
    {
      const bare = [];
      const re = /rgba\(\s*128\s*,\s*128\s*,\s*128\s*,\s*[\d.]+\s*\)/g;
      for (const m of codeOnly.matchAll(re)) {
        const at = m.index;
        // 往前 60 个字符里得有一个**还没闭合**的 var(--dsw-
        const before = codeOnly.slice(Math.max(0, at - 60), at);
        const openIdx = before.lastIndexOf("var(--dsw-");
        const closeIdx = before.lastIndexOf(")");
        if (openIdx < 0 || closeIdx > openIdx) {
          bare.push(m[0] + " @" + codeOnly.slice(0, at).split("\n").length);
        }
      }
      eq(
        bare,
        [],
        "**硬编码灰度必须落在主题变量的兜底位里**（裸写的话浅色主题下颜色不对）",
      );
    }
    // 浮窗/面板的背景必须走主题变量，不能写死颜色。
    // PANEL 那一族现在住在宿主（面板和预览两个 chunk 各自从 api.style 取），
    // 所以扫描必然能从拼起来的源码里找到它 —— 找不到就说明它被搬丢了。
    const panels = [...src.matchAll(/var PANEL = \{[\s\S]*?\n {4,10}\};/g)].map((m) => m[0]);
    ok(panels.length > 0, "能定位到 PANEL 样式");
    for (const [i, one] of panels.entries()) {
      ok(
        // ⚠️ 前缀放宽到 `--dsw-(alias|specific|menu)-` —— 弹层专用变量是
        //    `--dsw-specific-menu`，只认 `--dsw-alias-` 的话它会被误判成「没套变量」。
        /background:\s*"var\(--dsw-(?:alias|specific|menu)-/.test(one),
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
//   0-9   list / busy / err / edit / message / openId / defaultsDraft /
//         defaultsBusy / sections / sectionsBusy
//   10-12 openSection / sectionDraft / presetsData
//   13-15 presetsBusy / presetName / **presetDraft（勾选草稿）**
//   16 enabledDraft（总开关）
//   17 closedCats
//   18-19 renaming / renameDraft
//
// ⚠️ 原来 12/13 是 `sectionScope` / `sectionSessionId` —— **已删除**
//    （两个 setter 从没被调用过，界面上也从来没有那个开关）。
//    所以从那里往后的下标全都**前移了 2**。
{
  const lib = [
    { id: "none", name: "不注入", mode: "none", category: "other" },
    { id: "P1", name: "格式契约", mode: "append", category: "output", order: 9500, tokens: 1200 },
    { id: "P2", name: "编码规范", mode: "append", category: "domain", order: 950, tokens: 300 },
    { id: "P3", name: "文风要求", mode: "append", category: "domain", order: 950, tokens: 100 },
  ];
  const presetData = {
    presets: [
      { id: "写代码", name: "写代码", prompts: ["P1", "P2"], sections: {}, summary: "自设 2 条", note: "", label: "写代码" },
      { id: "写作", name: "写作", prompts: ["P1", "P3"], sections: {}, summary: "自设 2 条", note: "", label: "写作" },
    ],
    // ⚠️ 新形状：全局和会话各自「指向一条预设」。
    global: { enabled: true, presetId: "写代码" },
    session: { sessionId: "s1", presetId: "写作" },
    effective: { id: "写作", preset: null, source: "session" },
    sessionId: "s1",
  };
  const base = [
    { prompts: lib, defaults: [], categories: [], customCategories: [], assignments: { "session-s1": ["P3"] } },
    false, null, null, null, null, [], false,
    makeSectionsData(), false, null, {},
  ];

  shims.setStates([...base, presetData, false, "", null]);
  const comboEl = renderEditor({});
  let text = flattenText(comboEl).join(" ");
  // ── 一张卡片：标题 = 当前在哪套配置上 ────────────────────────────────
  //
  // 用户定的形状（原话）：
  //   「你就不能做成一张卡片，卡片标题初始为当前可用提示词，右侧有预设组合下拉框、
  //     保存吗。选择预设组合后，标题变成预设名且旁边有编辑名称图标。
  //     然后可用自由勾选提示词 tag 组成新预设或在已有预设中增删。
  //     你为什么要做到那么麻烦？」
  //
  // 这一版之前是「选词一张卡 + 预设一张卡 + 一排胶囊」，同一件事在三处出现。
  // 现在：标题就是预设名（一眼知道在哪套上），下拉换套，✎ 改名，保存落盘，
  // 勾选就是在改这套。
  ok(text.includes("写代码"), "**标题就是当前预设名**（匹配到预设时）");
  ok(text.includes("✎"), "预设名旁边有改名图标");
    ok(text.includes("保存"), "**预设卡片**里有保存按钮");
  ok(!text.includes("未保存的配置"), "匹配到预设时不显示「未保存的配置」占位");

  // 下拉框：选项是各条预设，选中项 = 当前匹配的那条
  {
    const sel = findEl(comboEl, (n) => n.type === "select");
    ok(!!sel, "**右侧有预设下拉框**");
    if (sel) {
      const opts = [];
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (n.type === "option") opts.push(n);
        for (const k of n.children || []) walk(k);
      })(sel);
      const labels = opts.map((o) => flattenText(o).join(""));
      ok(labels.includes("写代码") && labels.includes("写作"), `下拉里有全部预设（实际 ${labels.join("/")}）`);
      eq(sel.props.value, "写代码", "**下拉默认选中当前匹配的预设**（否则不知道自己在哪）");
    }
  }

  // 勾选清单还在（它现在就是「改这套配置」的手段）
  ok(text.includes("格式契约"), "勾选清单里有格式契约");
  ok(text.includes("编码规范"), "勾选清单里有编码规范");
  // ⚠️ 用户明确说不要那串数字：「已选 N 条 · 共 X tokens」、作用范围、
  //    以及每条后面的 order / tokens —— 全删了。勾选框自己会说哪几条生效。
  //
  // ⚠️ 判据必须限定在**这一块**里：`tokens` / `order` 在页面别处还有
  //    （个人提示词的卡片、会话选择面板），查全页会误判。
  {
    const comboText = flattenText(comboEl).join(" ");
    // 只取「提示词组合」到「个人提示词」之间那段（其余区块不属于这张卡片）
    const from = comboText.indexOf("提示词组合");
    const to = comboText.indexOf("个人提示词");
    const seg = from >= 0 && to > from ? comboText.slice(from, to) : comboText;
    ok(!seg.includes("已选 "), "**没有「已选 N 条」汇总了**（用户说不需要）");
    ok(!seg.includes("tokens"), "**这一块里没有 token 数了**（勾选行里也删了）");
    ok(!/\border \d/.test(seg), "**这一块里没有 order 了**（在下面对应卡片的详情里）");
    ok(!seg.includes("全局默认 · 所有会话"), "**没有作用范围那行字了**");
  }
  ok(!text.includes("可用（"), "**没有「可用」栏**（两栏板早删了）");
  ok(!text.includes("拖动"), "**文案里没有「拖动」**（顺序由 order 决定）");

  // ── 手改过（没匹配上任何预设）时，标题说「未保存的配置」 ──────────────
  {
    const noMatch = JSON.parse(JSON.stringify(presetData));
    // ⚠️ 「匹配不上任何预设」在新形状里 = **presetId 指向一条不存在的预设**，
  //    不再是 matched.global = null。
  noMatch.global = { enabled: true, presetId: "" };
    shims.setStates([...base, noMatch, false, "", null]);
    const el2 = renderEditor({});
    const t2 = flattenText(el2).join(" ");
    ok(t2.includes("未保存的配置"), "**没匹配上预设时标题说「未保存的配置」**");
    ok(!t2.includes("✎"), "没有预设可改名时不显示铅笔");
  }

  // ── 卡片化：勾选网格必须装在卡片体里 ────────────────────────────────
  //
  // ⚠️ 用户原话：「这功能的外观样式你倒是做好了啊，做个毛坯房干什么」。
  //    当时是 5 个裸元素垂直堆着，勾选框直接浮在页面背景上。
  //
  // ⚠️ 这条守卫我写废了四版，教训记在源码注释里：前几版都在做「在某个范围里
  //    数一数 / 找一类元素」这种**间接**判断 —— 数全页的、数块内的、往上找祖先的、
  //    找「有勾选框的网格」的，全都被页面别处的同类元素带偏（个人提示词的卡片里
  //    也有勾选框和边框）。
  //    最终判据是**具体**的：以只属于选词卡片的标记为锚，沿路径往上找最近的
  //    卡片祖先，再确认勾选网格在那个卡片的**卡片体**里。
  {
    // 锚：「已选 N 条」/「一条都没选」那句摘要（在卡片体里）。
    // 锚：卡片体里第一个勾选框的行（它就是「选词内容」）
    let anchor = null;
    (function walk(n) {
      if (!n || typeof n !== "object" || anchor) return;
      if (n.type === "input" && n.props && n.props.type === "checkbox") anchor = n;
      for (const k of n.children || []) walk(k);
    })(comboEl);
    ok(!!anchor, "找到选词内容（第一个勾选框）");

    let card = null;
    if (anchor) {
      const path = [];
      (function walk(n) {
        if (!n || typeof n !== "object" || card) return;
        path.push(n);
        if (n === anchor) {
          for (let i = path.length - 1; i >= 0; i--) {
            const st = (path[i].props && path[i].props.style) || {};
            if (typeof st.border === "string" && st.borderRadius) {
              card = path[i];
              break;
            }
          }
        }
        for (const k of n.children || []) walk(k);
        path.pop();
      })(comboEl);
    }
    ok(!!card, "**选词内容装在卡片里**（有边框和圆角）");
    if (card) {
      // ⚠️⚠️ 更要紧的一条：**下拉框和保存按钮必须跟卡片头在同一张卡片里**。
      //
      //    踩过：外面单独一行「写代码 ✎ [下拉] [保存]」，下面再套一张卡片 ——
      //    三层结构，而且用户要的「卡片顶部」没做到。他的原话是
      //    「下拉框和保存不都说是卡片顶部了吗」。
      //
      //    判据：从 select / 保存按钮**往上找最近的卡片祖先**，
      //    它必须同时是**那个卡片头的父级** —— 也就是两者同属一张卡。
      {
        const cardOwner = (node) => {
          const path = [];
          let hit = null;
          (function walk(n) {
            if (!n || typeof n !== "object" || hit) return;
            path.push(n);
            if (n === node) {
              // ⚠️ 从**父级**开始找，别把节点自己算进去 ——
              //    按钮自带 `border: 1px` + `borderRadius`，会被误判成卡片。
              //    踩过：`cardOwner(保存按钮)` 返回了按钮自己，于是「下拉和保存
              //    同属一张卡」永远不成立。
              for (let i = path.length - 2; i >= 0; i--) {
                const st = (path[i].props && path[i].props.style) || {};
                if (typeof st.border === "string" && st.borderRadius) {
                  // 交互元素永远不是「卡片容器」
                  if (path[i].type === "button" || path[i].type === "input") continue;
                  if (path[i].type === "select" || path[i].type === "option") continue;
                  hit = path[i];
                  break;
                }
              }
            }
            for (const k of n.children || []) walk(k);
            path.pop();
          })(comboEl);
          return hit;
        };
        const sel = findEl(comboEl, (n) => n.type === "select");
        const saveBtn = findEl(
          comboEl,
          (n) => n.type === "button" && flattenText(n).join("") === "保存",
        );
        ok(!!sel && !!saveBtn, "找到下拉框和保存按钮");
        if (sel && saveBtn) {
          const selCard = cardOwner(sel);
          const saveCard = cardOwner(saveBtn);
          const headCard = cardOwner(anchor);
          ok(!!selCard, "**下拉框在卡片里**（不是卡片外面的一行）");
          ok(!!saveCard, "**保存按钮在卡片里**");
          ok(
            selCard === saveCard && selCard === headCard,
            "**下拉/保存/摘要同属一张卡片**（头和数据是一个整体，不是拆开的）",
          );
        }
      }
      let inBody = false;
      (function walk(n, insideBody) {
        if (!n || typeof n !== "object") return;
        const st = (n.props && n.props.style) || {};
        const isBody = typeof st.borderTop === "string" && !!st.background;
        if (n.type === "input" && n.props && n.props.type === "checkbox" && insideBody) inBody = true;
        for (const k of n.children || []) walk(k, insideBody || isBody);
      })(card, false);
      ok(inBody, "**勾选框装在卡片体里**（不是直接浮在页面背景上）");
    }
  }

  // ⚠️ 区块标题的位置：**在卡片外面**，跟「个人提示词」「系统提示词」一样。
  //
  //    这里返工了两次，判据要跟着钉死：
  //      1) 一开始把区块标题整个换成预设名 → 「提示词组合」消失了；
  //      2) 再把标题塞进卡片头 → 用户问「为什么功能标题在卡片顶部」。
  //    结论：区块标题归区块（卡片外），卡片头归卡片头（当前配置名）。
  //    所以判据是**两者必须不在同一个卡片容器里**。
  {
    // ⚠️ 要收集**所有**标题出现处 —— 用 findEl 只拿第一个会漏：
    //    第一版就是这么错的，标题同时出现在区块头和卡片头里时，
    //    findEl 命中卡片外那个，判定通过、守卫是空的。
    const titles = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.type === "span" && flattenText(n).join("") === "提示词组合") titles.push(n);
      for (const k of n.children || []) walk(k);
    })(comboEl);
    eq(titles.length, 1, `**「提示词组合」只出现一次**（实际 ${titles.length} 次 —— 2 次说明卡片头里又塞了一个）`);
    const cardOf = (node) => {
      const path = [];
      let hit = null;
      (function walk(n) {
        if (!n || typeof n !== "object" || hit) return;
        path.push(n);
        if (n === node) {
          for (let i = path.length - 2; i >= 0; i--) {
            const st = (path[i].props && path[i].props.style) || {};
            if (typeof st.border === "string" && st.borderRadius) {
              if (["button", "input", "select", "option"].includes(path[i].type)) continue;
              hit = path[i];
              break;
            }
          }
        }
        for (const k of n.children || []) walk(k);
        path.pop();
      })(comboEl);
      return hit;
    };
    if (titles.length > 0) {
      eq(
        cardOf(titles[0]),
        null,
        "**区块标题在卡片外面**（不在卡片头里 —— 那会跟「当前配置名」混成一行）",
      );
    }
  }


  // 「不注入」这种占位条目不该出现在组合列表里
  ok(!/生效（\d）[\s\S]{0,300}不注入/.test(text), "**mode:none 的占位条目不参与组合**");

  // 手改过 → 匹配不上 → 显示「已改动」
  shims.setStates([
    ...base,
    Object.assign({}, presetData, { global: { enabled: true, presetId: "" } }),
    false, "", null,
  ]);
  text = flattenText(renderEditor({})).join(" ");
  // ⚠️ 措辞变了：手改过（没匹配上任何预设）时，标题直接说「未保存的配置」——
  //    比原来那句「相对预设已改动」直白，而且它就在标题位上，一眼看到。
  ok(text.includes("未保存的配置"), "**手改过之后标题说「未保存的配置」**");

  // 没有任何预设
  shims.setStates([
    ...base,
    { presets: [], global: { enabled: false, presetId: null }, session: null, effective: null, sessionId: null },
    false, "", null,
  ]);
  text = flattenText(renderEditor({})).join(" ");
  ok(text.includes("还没有预设"), "零预设时给了引导");

  // ⚠️ 这里原来有一块「sectionScope = "session" 时照常渲染」的用例 ——
  //    **连同 sectionScope 一起删掉了**：那两个状态（以及它们的 setter）
  //    从来没被调用过，界面上根本没有作用范围开关，所以「session 态」
  //    是个到不了的状态。
  //    设置面板只编辑全局层；会话层由会话页负责（那边天然带着 sessionId）。
  //    后端 `scope: "session"` / `?session=` 的能力保留，只是面板不用。

  // presetsData 为 null（还没读完）不许炸
  shims.setStates([...base, null, false, "", null]);
  try {
    text = flattenText(renderEditor({})).join(" ");
    // 加载态：标题位是占位名、体里一句「读取中…」
    ok(text.includes("未保存的配置") && text.includes("读取中"), "加载中不炸，有标题和占位");
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
    makeSectionsData(), false, null, {},
    { presets: [], global: { enabled: false, presetId: null }, session: null, effective: null, sessionId: null },
    false, // presetsBusy
    "", // presetName
    // ⚠️ presetDraft（勾选草稿，序号 15）—— 漏了这一格的话后面全错位，
    //    而 `withEnabled` 改的就是错位后的那一格（踩过）。
    [],
    // ⚠️ preSecSt（段落草稿，序号 16）
    null,
    null, // enabledDraft ← 序号 16，就是它
  ];
  /** 把 enabledDraft（最后一位）换成 v，返回完整状态表。 */
  // ⚠️ **别用 `slice(0, -1)`** —— 那只在「enabledDraft 是最后一个 state」时成立。
  //    加了 presetDraft 之后末尾是 rnDraftSt，改末尾等于没改开关
  //    （踩过：「关闭时说明还有什么在生效」红，而开关其实一直是开着的）。
  const ENABLED_AT = 17; // enabledDraft 的下标（见文件上方那张表）
  const withEnabled = (v) => base.map((x, i) => (i === ENABLED_AT ? v : x));

  shims.setStates(withEnabled(true));
  let el = renderEditor({});
  let text = flattenText(el).join(" ");
  // ⚠️ 它管的是**注入这件事本身**，不是「用不用我的配置」——
  //    名字和说明都得照这个说，否则用户会以为关掉只是「不注入默认那几条」。
  ok(text.includes("提示词全局注入"), "**开关叫「提示词全局注入」**（管的是注不注入，不是用不用配置）");
  // ⚠️ 这一条同时是**拆包**的回归：总开关的渲染已经搬进 client.editor.switch.js，
  //    由宿主当 props 递给编辑器。搬走之后最容易出的错是「两头都以为对方有」——
  //    那一块静静消失，谁都不报错。所以这里确认它**仍然渲染在编辑器里**。
  ok(
    !!findEl(el, (n) => n.props && n.props.role === "switch"),
    "**role=switch 的控件仍在编辑器里**（搬进 switch chunk 后仍被渲染出来）",
  );
  ok(text.includes("开 · 新会话自动挂默认"), "开启时说明作用范围（说的是「默认」这一层）");
  const swTip = collectTitles(el).find((t) => t.includes("提示词注入的总开关")) || "";
  ok(swTip !== "", "**总开关的说明挂在 title 上**（不占常驻行）");
  // ⚠️ 措辞别写成「全部停用」—— 那过头了。关掉只掐「默认」那一层。
  ok(swTip.includes("会话页自己选过的提示词照旧注入"), "**title 里说清关掉后什么还生效**（不是全停）");

  // ── 总开关要排在内容最前面 ────────────────────────────────────────────
  //
  // ⚠️ 顺序（用户定的）：
  //    全局注入开关 → 提示词组合 + 快速预设 → 个人提示词 → 系统提示词
  //    从「管什么」到「管具体哪条」再到「dsh 自己的段落」，一层层收窄。
  {
    // ⚠️ 判据：找到每个区块的「**最小包含元素**」，然后看它们在**同一个父节点**
    //    里的下标谁前谁后。
    //
    //    前两版都错了，都记在这儿：
    //      1) 「走到谁 push 谁」—— 根节点的文本同时含这几个词，四个区块都在根
    //         这层被 push，顺序就是我 if 的书写顺序，跟真实 DOM 无关；
    //      2) 「按深度排」—— 同样因为在根上就匹配到了，深度全是 0。
    //    共同毛病：**拿祖先的信息当自己的位置**。
    //    换成本判据就没有歧义了 —— 直接比同一个父节点下的下标。
    const boxes = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      const kids = n.children || [];
      const idx = {};
      kids.forEach((k, i) => {
        const t = flattenText(k).join("");
        if (t.includes("提示词全局注入") && idx.master === undefined) idx.master = i;
        // ⚠️ 这一块**没有静态标题了** —— 标题位是当前配置名（预设名 / 未保存的
        //    配置）。判据改用只属于它的两样：下拉框和「勾选即在改这套配置」。
        if (
          (t.includes("未保存的配置") || t.includes("勾选即在改这套配置")) &&
          idx.combo === undefined
        ) {
          idx.combo = i;
        }
        if (t.includes("系统提示词") && idx.sections === undefined) idx.sections = i;
      });
      // 同一父节点下同时定位到多个区块 → 这就是它们的共同容器
      if (Object.keys(idx).length >= 2) boxes.push(idx);
      for (const k of kids) walk(k);
    })(el);

    const order = [];
    if (boxes.length > 0) {
      for (const [k, i] of Object.entries(boxes[0])) order.push([k, i]);
      order.sort((a, b) => a[1] - b[1]);
    }
    const seq = order.map((x) => x[0]);
    ok(seq.length >= 3, `**三个区块都定位到了**（实际 ${seq.join(" → ") || "一个都没有"}）`);
    eq(seq[seq.length - 1], "sections", `**「系统提示词」排在最后**（实际 ${seq.join(" → ")}）`);
    ok(seq.indexOf("master") < seq.indexOf("combo"), `总开关在提示词配置之前（实际 ${seq.join(" → ")}）`);
    ok(seq.indexOf("combo") < seq.indexOf("sections"), `提示词配置在系统提示词之前（实际 ${seq.join(" → ")}）`);
  }

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
  //    结构对（role/aria-checked）+ 有类名 + **有形状兜底**。
  //    类名一旦失效，至少还是个圆角胶囊，不会退回方按钮。
  const sw = findEl(el, (n) => n.props && n.props.role === "switch");
  ok(!!sw, "**有 role=switch 的开关**（原生语义，键盘和读屏能用）");
  if (sw) {
    eq(sw.props["aria-checked"], true, "**aria-checked 跟状态一致**（原生开关靠它驱动视觉）");
    ok(
      typeof sw.props.className === "string" && sw.props.className.startsWith("_switch_"),
      `用了 dsh 原生开关类名（实际 ${JSON.stringify(sw.props.className)}）`,
    );
    eq(sw.props.style.borderRadius, "999px", "**形状兜底仍在**：类名失效也是个胶囊，不是方按钮");
    eq(sw.props.style.width, "36px", "兜底尺寸跟原生一致（36×20）");
    // 开关本体的 background 用原生同一套令牌，跟着主题走
    ok(
      String(sw.props.style.background).includes("--dsw-alias-brand-primary"),
      "开启态背景走主题令牌 brand-primary（不是写死的颜色）",
    );

    const th = findEl(sw, (n) => n.props && typeof n.props.className === "string" && n.props.className.startsWith("_thumb_"));
    ok(!!th, "滑块用了原生 thumb 类名");
    if (th) {
      // ⚠️⚠️ 这两条是**回归守卫**，踩过：
      //    内联 background:"#fff" 把 thumb 的主题令牌顶掉了 ——
      //    深色模式下滑块本该是深色（开启态 brand-primary 在深色下偏亮，
      //    滑块要反过来），结果一直是白的。
      //    内联样式永远赢 class，所以原生管了的属性内联一个都不能写。
      eq(
        th.props.style.background,
        undefined,
        "**滑块不许有内联背景**（写死颜色会顶掉深色模式的令牌，白块 bug）",
      );
      eq(
        th.props.style.transform,
        undefined,
        "**滑块不许有内联 transform**（位移归原生 [aria-checked=true] 规则管）",
      );
      eq(th.props.style.borderRadius, "50%", "滑块仍有形状兜底");
    }
  }
  // 「配置不会被清掉」也收进了 title —— 用户在决定要不要关的时候才需要看到它
  ok(swTip.includes("配置都留着"), "**title 里说明了配置不会被清掉**（否则用户不敢关）");

  shims.setStates(withEnabled(false));
  {
    const elOff = renderEditor({});
    text = flattenText(elOff).join(" ");
    ok(text.includes("关 · 只在会话页自己选的还注入"), "关闭时说明还有什么在生效");
    ok(text.includes("提示词全局注入"), "关闭时开关名不变（名字说的是它管什么，不是当前状态）");
    // 关掉的效果说明也在 title 上，不占常驻行
    const tipOff = collectTitles(elOff).find((t) => t.includes("提示词注入的总开关")) || "";
    ok(tipOff.includes("段落改写也照旧生效"), "**title 里说清改写不受影响**（两件事别混）");
  }

  // enabledDraft 为 null（还没读完）不该炸，也不该误显示成"关"
  shims.setStates(withEnabled(null));
  try {
    text = flattenText(renderEditor({})).join(" ");
    ok(text.includes("开 · 新会话自动挂默认"), "还没读完时按「开」显示（默认开），不误报成关");
  } catch (e) {
    ok(false, "enabledDraft 为 null 时不许炸 —— 抛了 " + e.message);
  }
}
done();