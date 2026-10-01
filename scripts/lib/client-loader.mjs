// 客户端侧加载器：把 client.js 和它的包内 chunk 按 DSH 的真实语义跑起来。
//
// 为什么不能只读 client.js：
//   组件已经拆进 client.*.js（React 那半边），只加载宿主的话拿到的是
//   `{ create }` 包装器，一个组件都渲染不到 —— 测试会「全绿但什么都没测」。
//
// 为什么不能自己发明一套加载规则：
//   chunk 的注册键是运行时算出来的（register() 里 ownerId + "/" + 文件名），
//   宿主写的名字对不对，只有在**照搬那条规则**的加载器下才测得出来。
//   所以这里刻意复刻 DSH 的算法，而不是简单地 require 一下文件。

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = "dsh-prompt-easymanager";
/** 包根目录：这个文件在 scripts/lib/ 下，往上两级。 */
const PKG_DIR = join(HERE, "..", "..");

/** DSH: stripClientSuffix —— 只削掉结尾的 /client。 */
export const stripClientSuffix = (spec) => (spec.endsWith("/client") ? spec.slice(0, -7) : spec);

/**
 * 同步 thenable —— 测试专用。
 *
 * 真机上 require.async 返回真 Promise，宿主「拉 chunk」那一句会抛 Promise
 * 让 React 重试。测试里没有 React 的重试机制，所以这里给一个**立即兑现**的
 * thenable：宿主 .then 回调在同一个 tick 里就跑完，helpersBox 落地，
 * 后面同步渲染拿到的就是真模块。
 *
 * 这不是「把测试糊过去」：被验的东西（注册键、create(api) 解构、渲染期有没有
 * 读到 undefined）一个没少，只是把「要等多少个 tick」这件事交给渲染循环。
 *
 * ⚠️ **必须像真 Promise 那样异步兑现**，不能在 .then 里同步调 onOk。
 *    同步兑现会让**回调嵌套**塌掉：
 *
 *        loadPreview().then(cb)        // 同步跑 cb
 *        cb 里 return loadPicker().then(cb2)   // 同一 tick 内嵌套跑完
 *
 *    而同步 thenable 的 `.then` 返回的是 `settled(value)` —— 那个临时链被丢弃，
 *    外层拿到的就是**链上第一个**的结果，而不是 cb 的返回值。
 *    踩到的样子：`loadPromptUi()` 本该返回 `{previewMod, pickerMod}`，
 *    实际变成了 preview 模块本身，于是 `ui.PromptPicker` 是 undefined，
 *    真机上报 React #130（Element type is invalid: got undefined）。
 *
 *    真机上 `require.async` 返回的是原生 Promise，行为是对的 ——
 *    所以这个 bug **只在测试里现身**，说明测试的 thenable 得跟原生对齐。
 */
function settled(value) {
  return {
    __settled: true,
    value,
    then(onOk, onErr) {
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          try {
            resolve(onOk ? onOk(value) : value);
          } catch (e) {
            if (onErr) resolve(onErr(e));
            else reject(e);
          }
        });
      });
    },
    catch(onErr) {
      return settled(value).then(undefined, onErr);
    },
  };
}

/**
 * 起一个客户端沙箱。
 *
 * @param {object} shims  react / reactDom 影子层
 * @param {object} [opts]
 * @param {(name: string) => string} [opts.mapChunk]  把 chunk 文件名映射成别的文件（测异常路径用）
 * @returns 沙箱句柄：load() 拿到宿主导出，loadedChunks 记录真被拉过哪些 chunk
 */
export function createClientSandbox(shims, opts = {}) {
  const factories = new Map();
  const cache = new Map();
  const loadedChunks = [];
  let registration = null;
  // 宿主每次调 chunk.create(api) 都会把那一份 api 记到这里。
  // 测试拿它去造组件 —— 用真 api，而不是自己照着复刻一份。
  const seen = { api: null };

  // 默认是一个**残缺**的 document：只有 body/head/getElementById。
  //
  // ⚠️ 这个残缺是**故意的**（`installStyles` 走 getElementById 判断有没有装过），
  //    但它意味着任何 `querySelectorAll` 之类的真实 DOM 操作都会抛错 ——
  //    而宿主里的 DOM 补丁函数会把错误吞掉，于是**测试照样绿、什么也没验到**。
  //    要验那类代码，用 `opts.document` 注入一个能用的假 DOM（见 client_render_test
  //    里的「侧边栏图标」用例）。
  const documentShim = opts.document || {
    body: { __isBody: true },
    head: null,
    getElementById: () => null,
  };

  const sandboxWindow = {
    __ModuleLoader__: {
      load(reg) {
        // 复刻 register()：ownerId → (chunk ? ownerId + "/" + chunk : ownerId)
        const ownerId = stripClientSuffix(reg.id);
        const id = reg.chunk === undefined ? ownerId : `${ownerId}/${reg.chunk}`;
        if (factories.has(id)) {
          throw new Error(`duplicate factory registration for "${id}"`);
        }
        factories.set(id, reg.factory);
        if (reg.chunk === undefined) registration = reg;
      },
    },
  };

  const requireFn = (id) => {
    if (id === "react") return shims.react;
    if (id === "react-dom") return shims.reactDom;
    throw new Error("未知依赖: " + id);
  };

  /** 真的把 chunk 文件读出来执行一遍 —— 走的是和真机一样的注册路径。 */
  function fetchChunk(fileName) {
    const key = `${PKG}/${fileName}`;
    if (cache.has(key)) return cache.get(key);
    const file = opts.mapChunk ? opts.mapChunk(fileName) : fileName;
    let src;
    try {
      src = readFileSync(join(PKG_DIR, file), "utf8");
    } catch {
      throw new Error(`client-modules: could not load "${key}": bundle script failed to load`);
    }
    // eslint-disable-next-line no-new-func
    new Function("window", "document", "console", src)(sandboxWindow, documentShim, console);
    const factory = factories.get(key);
    if (!factory) {
      throw new Error(
        `client-modules: bundle loaded without registering "${key}" via __ModuleLoader__.load`,
      );
    }
    const mod = factory(requireFn);
    if (typeof mod.create === "function") {
      const create = mod.create;
      mod.create = (api) => {
        seen.api = api;
        return create(api);
      };
    }
    cache.set(key, mod);
    return mod;
  }

  requireFn.async = (spec) => {
    if (!spec.startsWith("./")) throw new Error("只支持包内相对 chunk: " + spec);
    const fileName = spec.slice(2);
    const key = `${PKG}/${fileName}`;
    if (!loadedChunks.includes(key)) loadedChunks.push(key);
    return settled(fetchChunk(fileName));
  };

  return {
    requireFn,
    loadedChunks,
    /** chunk 键 → 模块本体，测试可以自己拿 create(api) 造组件。 */
    cache,
    /** 宿主传给 create() 的那一份 api —— 由第一次调用抓下来。 */
    get lastApi() {
      return seen.api;
    },
    /** 先把某些 chunk 拉好（真机上由 Preload / Suspense 触发）。 */
    preload(...fileNames) {
      for (const f of fileNames) requireFn.async("./" + f);
    },
    /** 执行宿主 client.js，返回它的模块导出。 */
    load(file = "client.js") {
      const src = readFileSync(join(PKG_DIR, file), "utf8");
      // eslint-disable-next-line no-new-func
      new Function("window", "document", "console", src)(sandboxWindow, documentShim, console);
      if (!registration) throw new Error(`${file} 没有调用 window.__ModuleLoader__.load()`);
      const mod = registration.factory(requireFn);
      // ⚠️ factory 是**同步**的：它必须直接交出 exports。
      //    在里面「等 chunk」（也就是 throw 一个 pending Promise）的话，
      //    真机上 DSH 拿到的是「没有导出」，宿主界面报
      //      dsh-prompt-easymanager: import failed: [object Promise]
      //    这一条以前没查，结果这个 bug 一路发到了真机。
      if (mod !== null && typeof mod === "object" && typeof mod.then === "function") {
        throw new Error(
          `${file} 的 factory 返回了 Promise —— factory 必须同步 return module.exports。` +
            "（在 factory 里等 chunk / 调 useState 都会走到这一步）",
        );
      }
      if (mod === undefined || mod === null || typeof mod !== "object") {
        throw new Error(`${file} 的 factory 没有返回 exports（拿到 ${String(mod)}）`);
      }
      return { mod, id: registration.id };
    },
  };
}

/** chunk 导出的是 `{ create }` —— 拿宿主那一份 api 造出组件。 */
export function createChunk(mod, api) {
  return mod.create ? mod.create(api) : mod;
}

/**
 * 把宿主交出来的那一份 api 包成「读不到就炸」的。
 *
 * ⚠️ 为什么需要：拆包时宿主 CHUNK_API 漏给了 62 个样式常量，而 chunk 里那些
 *    `var X = api.style.X` 读到的就是 undefined —— **不报错**。
 *    渲染期 `style: undefined` 是合法的（等于没样式），React 不吭声，
 *    测试全绿，真机上就是「编辑器那一栏整片空白」。
 *
 *    所以在测试里把它变成抛错：`api.style.DOT` 拿不到就抛，
 *    报错信息直接点名是谁要的、宿主有没有。
 *
 * 注意只包一层 style 的 proxy —— `create(api)` 里还会读 api.mode / api.route 等，
 * 那些用普通对象就够了（缺了会立刻 ReferenceError，本来就藏不住）。
 */
export function strictApi(api) {
  const missing = [];
  const style = new Proxy(api.style ?? {}, {
    get(target, key) {
      if (typeof key === "string" && !(key in target)) {
        // 记下来再抛 —— 报错信息里能看到缺了几个、都缺什么
        missing.push(key);
        throw new Error(
          `CHUNK_API.style 里没有 "${key}" —— chunk 会读到 undefined，渲染期不报错、界面直接空白`,
        );
      }
      return target[key];
    },
  });
  return { api: { ...api, style }, missing };
}

/**
 * 客户端那一半的**全部源码**拼起来。
 *
 * 静态扫描（样式常量有没有定义、有没有编出来的段落键、主题变量写法……）必须
 * 扫全部文件，不能只扫 client.js —— 拆包之后那些东西大多搬进了 chunk，
 * 只扫宿主的话这类断言会「全绿但什么都没扫到」，比没有还糟。
 */
export function clientSource() {
  // ⚠️ **自动发现**，不要手写列表。
  //
  //    原来是写死的四个文件名 —— 加一个 chunk（比如 client.editor.switch.js）
  //    就会漏扫，而那些断言的表现是「全绿但什么都没扫到」，正是这段注释
  //    自己警告过的那种失败。列表和文件事实写两遍，迟早漏一处。
  //
  //    规则跟 dsh 的一致：包根下匹配 `client.*.js` 的本地 chunk。
  const files = readdirSync(PKG_DIR)
    // ⚠️ 是 `client.*\.js`，**不是** `client\..*\.js`。
    //    后者要求 client 后面还有一个字面点，于是连 client.js 都匹配不到
    //    （`client` 后面直接就是 `.js`）—— 试了两次才对。
    .filter((f) => /^client.*\.js$/.test(f))
    .sort();
  if (!files.includes("client.js")) {
    throw new Error("clientSource: 包根下找不到 client.js —— PKG_DIR 指错了吗？");
  }
  return files.map((f) => readFileSync(join(PKG_DIR, f), "utf8")).join("\n");
}
