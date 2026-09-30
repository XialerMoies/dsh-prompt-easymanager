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

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = "dsh-prompt-manager";
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
 * 读到 undefined）一个没少，只是把异步那一层按下去。
 */
function settled(value) {
  return {
    __settled: true,
    value,
    then(onOk) {
      onOk(value);
      return settled(value);
    },
    catch() {
      return settled(value);
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

  const documentShim = { body: { __isBody: true }, head: null, getElementById: () => null };

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
      //      dsh-prompt-manager: import failed: [object Promise]
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
 * 客户端那一半的**全部源码**拼起来。
 *
 * 静态扫描（样式常量有没有定义、有没有编出来的段落键、主题变量写法……）必须
 * 扫全部文件，不能只扫 client.js —— 拆包之后那些东西大多搬进了 chunk，
 * 只扫宿主的话这类断言会「全绿但什么都没扫到」，比没有还糟。
 */
export function clientSource() {
  const files = [
    "client.js",
    "client.picker.js",
    "client.preview.js",
    "client.editor.js",
  ];
  return files.map((f) => readFileSync(join(PKG_DIR, f), "utf8")).join("\n");
}
