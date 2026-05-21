/**
 * Regression: `nodeScriptToArgv` MUST always prepend a Node interpreter
 * on Windows + `.js` paths.
 *
 * Live repro on Windows 11: when the registry's `node` strategy chain
 * failed (no managed runtime, no PATH hit), `nodeScriptToArgv`
 * previously returned `[cli.js]` and `spawn(cli.js)` crashed with
 * `EFTYPE`. The fix falls back to `process.execPath` — the dashboard
 * server's own Node — which is by definition spawn-able.
 *
 * See change: fix-windows-standalone-spawn.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  registerDefaultTools,
  OverridesStore,
} from "../index.js";

function freshRegistry(opts: {
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
  which?: (name: string) => string | null;
  npmRootGlobal?: () => string;
  overrides?: Record<string, string>;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `node-script-toargv-${Math.random()}.json`),
    warn: () => {},
  });
  for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);

  const r = new ToolRegistry({
    overrides: store,
    platform: opts.platform,
  });
  registerDefaultTools(r, {
    exists: opts.exists ?? (() => false),
    which: opts.which ?? (() => null),
    npmRootGlobal: opts.npmRootGlobal ?? (() => ""),
  });
  return r;
}

describe("nodeScriptToArgv — Windows fallback (Bug 3)", () => {
  it("falls back to process.execPath when registry.resolve('node') returns ok:false", () => {
    // Locate pi via an explicit override pointing at a fake cli.js, so
    // the pi executor resolves successfully. The `node` chain has no
    // sources (no managed runtime, no PATH hit) so it must fail —
    // forcing nodeScriptToArgv into the process.execPath fallback.
    const fakePiCli = "C:\\Users\\u\\.pi-dashboard\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js";
    const r = freshRegistry({
      platform: "win32",
      // Only the pi override path exists; node has no candidates.
      exists: (p) => p === fakePiCli,
      overrides: { pi: fakePiCli },
    });

    const nodeRes = r.resolve("node");
    expect(nodeRes.ok).toBe(false);

    const piExec = r.resolveExecutor("pi");
    expect(piExec.ok).toBe(true);
    expect(piExec.path).toBe(fakePiCli);
    expect(piExec.argv).toEqual([process.execPath, fakePiCli]);
  });

  it("uses the registry node.path when registry.resolve('node') succeeds", () => {
    const fakePiCli = "C:\\Users\\u\\.pi-dashboard\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js";
    const fakeNode = "C:\\Program Files\\nodejs\\node.exe";
    const r = freshRegistry({
      platform: "win32",
      exists: (p) => p === fakePiCli || p === fakeNode,
      overrides: { pi: fakePiCli, node: fakeNode },
    });

    const piExec = r.resolveExecutor("pi");
    expect(piExec.ok).toBe(true);
    expect(piExec.argv[0]).toBe(fakeNode);
    expect(piExec.argv[1]).toBe(fakePiCli);
  });
});
