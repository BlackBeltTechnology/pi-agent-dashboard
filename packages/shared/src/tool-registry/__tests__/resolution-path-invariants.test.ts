/**
 * Resolution path invariants — the MODIFIED contract.
 *
 * "path SHALL be absolute when ok" now scopes to PATH kinds
 * (binary/module/directory). Non-path probe kinds are exempt:
 * `env` MAY be null; `docker-image` MAY be a non-fs image ref;
 * `pw-browser` carries the browser dir. Binary resolution and the
 * bundled-node source classification must NOT regress.
 *
 * Folded scenarios: test-plan #E18 (8.18), #E21 (8.21), #E24 (8.24).
 * See change: add-skill-tool-provisioning (design D2, relaxed invariants).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../index.js";
import { OverridesStore } from "../overrides.js";
import type { InstallHints, Strategy } from "../types.js";

function freshRegistry(opts: {
  platform?: NodeJS.Platform;
  resourcesPath?: string;
} = {}): ToolRegistry {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `path-invariants-test-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({
    overrides: store,
    platform: opts.platform ?? "linux",
    env: opts.resourcesPath ? { resourcesPath: opts.resourcesPath } : {},
  });
  return r;
}

describe("path invariants (modified contract)", () => {
  it("a binary tool that resolves ok carries an ABSOLUTE path (8.18)", () => {
    const r = freshRegistry();
    r.register({
      name: "ffmpeg",
      kind: "binary",
      strategies: [
        {
          name: "where",
          run: () => ({ ok: true, path: "/usr/local/bin/ffmpeg" }),
        },
      ],
    });
    const res = r.resolve("ffmpeg");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(path.resolve(res.path!));
    expect(path.isAbsolute(res.path!)).toBe(true);
  });

  it("bundled-node still classifies as 'bundled' for the runtime node (8.21 regression)", () => {
    const resourcesPath = "/opt/app/resources";
    const r = freshRegistry({ platform: "linux", resourcesPath });
    registerDefaultTools(r, {
      exists: (p) => p === path.join(resourcesPath, "node", "bin", "node"),
      which: () => null,
      npmRootGlobal: () => "",
      resolveModule: () => null,
    });
    const res = r.resolve("node");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("bundled");
  });
});

describe("installHints opacity (8.24)", () => {
  it("resolve() output is identical with and without installHints; hints absent from Resolution", () => {
    const strategy: Strategy = {
      name: "where",
      run: () => ({ ok: true, path: "/usr/bin/tool" }),
    };
    const hints: InstallHints = {
      linux: { commands: { apt: "apt-get install tool" } },
      docsAnchor: "install-tool",
    };
    const plain = freshRegistry();
    plain.register({ name: "tool", kind: "binary", strategies: [strategy] });
    const hinted = freshRegistry();
    hinted.register({ name: "tool", kind: "binary", strategies: [strategy], installHints: hints });

    const a = plain.resolve("tool");
    const b = hinted.resolve("tool");
    // ok/path/source/tried identical…
    expect({ ok: b.ok, path: b.path, source: b.source, tried: b.tried }).toEqual({
      ok: a.ok,
      path: a.path,
      source: a.source,
      tried: a.tried,
    });
    // …and the Resolution shape carries no installHints key.
    expect(Object.keys(b)).not.toContain("installHints");
    expect(JSON.stringify(b)).not.toContain("apt-get");
    // list() is the surface that carries them.
    expect(hinted.list()[0].installHints).toEqual(hints);
  });
});
