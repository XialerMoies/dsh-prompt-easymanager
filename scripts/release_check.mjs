// Verify the artifact that would be published, rather than only the working tree.
// The check is intentionally self-contained so CI does not need the dsh runtime.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NODE = process.execPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32" && command === NPM,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${output ? `\n${output}` : ""}`);
  }
  return result;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function clientFiles(root) {
  return readdirSync(root)
    .filter((name) => /^client(?:\.[A-Za-z0-9][A-Za-z0-9._-]*)?\.js$/.test(name))
    .sort();
}

function assertClientRevision(root, label) {
  const host = join(root, "client.js");
  if (!existsSync(host)) throw new Error(`${label} 缺少 client.js`);
  const hostMtime = statSync(host).mtimeMs;
  const stale = clientFiles(root)
    .filter((name) => name !== "client.js")
    .filter((name) => statSync(join(root, name)).mtimeMs > hostMtime + 2000);
  if (stale.length > 0) {
    throw new Error(`${label} 的 chunk 比 client.js 更新，版本指纹可能不会变化：${stale.join(", ")}`);
  }
}

function assertInstalledPackage(packageDir, label) {
  const installedPackagePath = join(packageDir, "package.json");
  if (!existsSync(installedPackagePath)) throw new Error(`${label} 缺少 package.json`);
  const installed = JSON.parse(readFileSync(installedPackagePath, "utf8"));
  if (installed.name !== PKG.name || installed.version !== PKG.version) {
    throw new Error(`${label} 版本不一致：${installed.name}@${installed.version}，期望 ${PKG.name}@${PKG.version}`);
  }
  for (const name of ["index.js", ...clientFiles(ROOT)]) {
    const source = join(ROOT, name);
    const target = join(packageDir, name);
    if (!existsSync(target)) throw new Error(`${label} 缺少 ${name}`);
    if (sha256(source) !== sha256(target)) throw new Error(`${label} 的 ${name} 与当前源码不一致`);
  }
  assertClientRevision(packageDir, label);
  return installed;
}

const work = mkdtempSync(join(tmpdir(), "dsh-prompt-easymanager-release-"));
try {
  assertClientRevision(ROOT, "源码");

  const packed = run(NPM, ["pack", "--pack-destination", work]);
  const archiveName = packed.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const archive = archiveName && join(work, archiveName);
  if (!archive || !existsSync(archive) || !archive.endsWith(`-${PKG.version}.tgz`)) {
    throw new Error(`npm pack 没有生成期望版本的 tgz：${archiveName || "无输出"}`);
  }

  const installRoot = join(work, "install");
  run(NPM, [
    "install",
    "--prefix", installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    archive,
  ]);
  const installedDir = join(installRoot, "node_modules", PKG.name);
  assertInstalledPackage(installedDir, "tgz 安装目录");

  // Loading the installed entry catches an incomplete package even when all copied
  // files happen to be present. DSH_HOME is isolated so module startup cannot touch
  // the developer's real profile.
  const probe = join(work, "load-installed.mjs");
  writeFileSync(
    probe,
    `await import(${JSON.stringify(pathToFileURL(join(installedDir, "index.js")).href)});\n`,
    "utf8",
  );
  run(NODE, [probe], {
    env: { ...process.env, DSH_HOME: join(work, "dsh-home") },
  });

  const configuredDir = process.env.DSH_PROMPT_EASYMANAGER_INSTALL_DIR;
  if (configuredDir) {
    assertInstalledPackage(configuredDir, "指定安装目录");
    console.log(`指定安装目录通过：${configuredDir}`);
  }

  console.log(`发布检查通过：${PKG.name}@${PKG.version}`);
  console.log(`tgz 可安装并加载：${archive}`);
  console.log(`客户端文件已同步：${clientFiles(ROOT).join(", ")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
