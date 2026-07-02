/**
 * Unix Node-script executor node-wrap (openspec / pi).
 *
 * Root cause of the bundled-Electron "OpenSpec profile not found" bug:
 * on unix the managed `openspec` bin is a `#!/usr/bin/env node` shebang
 * script that only runs when a binary literally named `node` is on the
 * spawning process's PATH. A GUI-launched Electron server has a stripped
 * PATH, so the spawn dies with exit 127 / `env: node: No such file`.
 *
 * The fix generalizes `nodeScriptToArgv` to supply the interpreter
 * explicitly on unix (parity with the existing Windows node-wrap):
 * resolving `openspec` MUST yield `[<node>, .../bin/openspec.js]`, NOT
 * the bare shebang path.
 *
 * See change: fix-openspec-config-read-bundled-node.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OverridesStore, registerDefaultTools, ToolRegistry } from "../index.js";

function freshRegistry(opts: {
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
  resolveModule?: (id: string, from: string) => string | null;
  overrides?: Record<string, string>;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `openspec-unix-wrap-${Math.random()}.json`),
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

describe("nodeScriptToArgv — unix openspec node-wrap", () => {
  it("resolves openspec to [node, bin/openspec.js], not the shebang path", () => {
    const node = "/opt/node/bin/node";
    const pkgJson = "/app/node_modules/@fission-ai/openspec/package.json";
    const openspecJs = path.join("/app/node_modules/@fission-ai/openspec", "bin", "openspec.js");

    const r = freshRegistry({
      platform: "linux",
      exists: (p) => p === node || p === openspecJs,
      resolveModule: (id) =>
        id === "@fission-ai/openspec/package.json" ? pkgJson : null,
      overrides: { node },
    });

    const exec = r.resolveExecutor("openspec");
    expect(exec.ok).toBe(true);
    expect(exec.argv).toEqual([node, openspecJs]);
  });
});
