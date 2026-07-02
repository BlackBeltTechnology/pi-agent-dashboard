/**
 * `nodeScriptToArgv` argv matrix + stripped-PATH spawn proof.
 *
 * Covers the generalized node-wrap (unix parity with Windows):
 *   - `.js` resolved path → `[<node>, script.js]` on unix AND win32.
 *   - unix `.bin` shebang SYMLINK → dereferenced to its `.js` target,
 *     then node-wrapped.
 *   - non-`.js`, non-symlink path → passthrough `[path]`.
 *
 * The spawn proof executes the resolved argv with an EMPTY PATH to
 * simulate the bundled-Electron GUI launch: the raw `#!/usr/bin/env node`
 * shebang would exit 127 (`env: node: No such file`), but the
 * node-wrapped argv runs cleanly.
 *
 * See change: fix-openspec-config-read-bundled-node.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OverridesStore, registerDefaultTools, ToolRegistry } from "../index.js";

function freshRegistry(opts: {
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
  resolveModule?: (id: string, from: string) => string | null;
  overrides?: Record<string, string>;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `argv-matrix-${Math.random()}.json`),
    warn: () => {},
  });
  for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);
  const r = new ToolRegistry({ overrides: store, platform: opts.platform });
  registerDefaultTools(r, {
    exists: opts.exists ?? (() => false),
    which: () => null,
    npmRootGlobal: () => "",
    resolveModule: opts.resolveModule,
  });
  return r;
}

describe("nodeScriptToArgv — argv matrix", () => {
  it("unix: node-wraps a resolved .js entry", () => {
    const node = "/opt/node/bin/node";
    const js = "/app/node_modules/@fission-ai/openspec/bin/openspec.js";
    const r = freshRegistry({
      platform: "linux",
      exists: (p) => p === node || p === js,
      resolveModule: (id) =>
        id === "@fission-ai/openspec/package.json"
          ? "/app/node_modules/@fission-ai/openspec/package.json"
          : null,
      overrides: { node },
    });
    expect(r.resolveExecutor("openspec").argv).toEqual([node, js]);
  });

  it("win32: node-wraps a resolved .js entry (unchanged behavior)", () => {
    // Host-neutral paths (POSIX join runs on the Linux CI host); the point is
    // the win32 branch still prepends node to a `.js` entry.
    const node = "/nodejs/node.exe";
    const pkgDir = "/app/node_modules/@fission-ai/openspec";
    const r = freshRegistry({
      platform: "win32",
      exists: (p) => p === node || p.endsWith("openspec.js"),
      resolveModule: (id) =>
        id === "@fission-ai/openspec/package.json" ? `${pkgDir}/package.json` : null,
      overrides: { node },
    });
    const argv = r.resolveExecutor("openspec").argv;
    expect(argv[0]).toBe(node);
    expect(argv[1]).toBe(path.join(pkgDir, "bin", "openspec.js"));
  });

  it("unix: dereferences a .bin shebang symlink to its .js target, then wraps", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-deref-"));
    dirs.push(tmp);
    const pkgBin = path.join(tmp, "pkg", "bin");
    fs.mkdirSync(pkgBin, { recursive: true });
    const jsTarget = path.join(pkgBin, "openspec.js");
    fs.writeFileSync(jsTarget, "#!/usr/bin/env node\nconsole.log('ok');\n");
    const dotBin = path.join(tmp, ".bin");
    fs.mkdirSync(dotBin, { recursive: true });
    const symlink = path.join(dotBin, "openspec");
    fs.symlinkSync(jsTarget, symlink);

    const node = "/opt/node/bin/node";
    // openspec resolves to the .bin symlink via the `override` strategy;
    // real fs is used so realpathSync can dereference it.
    const r = freshRegistry({
      platform: "linux",
      exists: (p) => p === node || fs.existsSync(p),
      // No module resolution → bare-import fails → override wins.
      overrides: { node, openspec: symlink },
    });
    const argv = r.resolveExecutor("openspec").argv;
    expect(argv).toEqual([node, fs.realpathSync(jsTarget)]);
  });

  it("passthrough: non-.js, non-symlink resolved path is returned bare", () => {
    const bareBin = path.join(os.tmpdir(), `openspec-bare-${Math.random()}`);
    fs.writeFileSync(bareBin, "#!/usr/bin/env node\n");
    files.push(bareBin);
    const r = freshRegistry({
      platform: "linux",
      exists: (p) => fs.existsSync(p),
      overrides: { openspec: bareBin },
    });
    // No node resolved and the path is not .js → passthrough.
    expect(r.resolveExecutor("openspec").argv).toEqual([bareBin]);
  });
});

describe("nodeScriptToArgv — stripped-PATH spawn proof", () => {
  it("runs the node-wrapped openspec argv with an empty PATH (no exit 127)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-spawn-"));
    dirs.push(tmp);
    const pkgBin = path.join(tmp, "pkg", "bin");
    fs.mkdirSync(pkgBin, { recursive: true });
    const jsTarget = path.join(pkgBin, "openspec.js");
    fs.writeFileSync(
      jsTarget,
      "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ profile: 'core', workflows: [] }));\n",
    );
    const dotBin = path.join(tmp, ".bin");
    fs.mkdirSync(dotBin, { recursive: true });
    const symlink = path.join(dotBin, "openspec");
    fs.symlinkSync(jsTarget, symlink);

    // Real node (this test runner's own interpreter) via the node override.
    const r = freshRegistry({
      platform: process.platform,
      exists: (p) => p === process.execPath || fs.existsSync(p),
      overrides: { node: process.execPath, openspec: symlink },
    });
    const argv = r.resolveExecutor("openspec").argv;
    expect(argv[0]).toBe(process.execPath);

    // Stripped PATH: a raw shebang spawn of `symlink` here would exit 127.
    const res = spawnSync(argv[0], [...argv.slice(1), "config", "list", "--json"], {
      env: { PATH: "", HOME: os.tmpdir() },
      encoding: "utf-8",
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ profile: "core", workflows: [] });
  });
});

const dirs: string[] = [];
const files: string[] = [];
afterAll(() => {
  for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const f of files) try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
});
