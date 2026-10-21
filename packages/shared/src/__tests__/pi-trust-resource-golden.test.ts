/**
 * Golden check: our trust-requiring resource set vs the installed pi's own
 * (test-plan #E17). pi does not export its resource list, so drift would silently
 * make the remote digest bind the wrong bytes. See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES, trustResourceManifest } from "../pi-trust-resource-digest.js";

const require = createRequire(import.meta.url);
let root: string;
let home: string;
let originalHome: string | undefined;

/** The installed pi's `dist/` (its package `exports` hides package.json, so walk the lookup paths). */
function piDist(): string {
  for (const dir of require.resolve.paths("@earendil-works/pi-coding-agent") ?? []) {
    const dist = path.join(dir, "@earendil-works", "pi-coding-agent", "dist");
    if (fs.existsSync(path.join(dist, "core", "trust-manager.js"))) return dist;
  }
  throw new Error("installed pi-coding-agent not found");
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-golden-")));
  home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = home; // pi reads process.env.HOME for the user skills dir
});
afterAll(() => {
  process.env.HOME = originalHome;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("#E17 golden vs the installed pi", () => {
  it("our resource-name list equals pi's array literal", () => {
    const src = fs.readFileSync(path.join(piDist(), "core", "trust-manager.js"), "utf8");
    const m = /TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(m, "pi's TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES literal not found").toBeTruthy();
    const theirs = [...(m as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(new Set(TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES)).toEqual(new Set(theirs));
    expect(theirs.length).toBeGreaterThan(0);
  });

  /** Create `paths` (dirs when the path ends with "/", else files) under `base`; `~/` goes under the fake HOME. */
  function materialize(base: string, paths: string[]): void {
    for (const rel of paths) {
      const abs = rel.startsWith("~/") ? path.join(home, rel.slice(2)) : path.join(base, rel);
      if (rel.endsWith("/")) {
        fs.mkdirSync(abs, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, abs.endsWith("settings.json") ? "{}" : "x");
    }
  }

  // [name, paths to create, label the manifest must hold]
  function treeMatrix(): Array<[string, string[], string | null]> {
    const perResource = TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.map((n): [string, string[], string | null] => [
      `only-${n}`,
      [`top/proj/.pi/${n}${n.includes(".") ? "" : "/"}`],
      `c/${n}`,
    ]);
    return [
      ["nothing", [], null],
      ...perResource,
      ["cwd-agents-skills", ["top/proj/.agents/skills/"], "a0"],
      ["ancestor-agents-skills", ["top/.agents/skills/"], "a1"],
      ["user-skills-only", ["~/.agents/skills/"], null],
      ["unrelated-pi-file", ["top/proj/.pi/unrelated.txt"], null],
    ];
  }

  it("non-empty verdict equals hasTrustRequiringProjectResources, and every consulted path is in the manifest", async () => {
    const pi = (await import("@earendil-works/pi-coding-agent")) as unknown as {
      hasTrustRequiringProjectResources: (cwd: string) => boolean;
    };
    for (const [name, paths, mustHold] of treeMatrix()) {
      const base = path.join(root, `tree-${name}`);
      fs.mkdirSync(path.join(base, "top", "proj"), { recursive: true });
      materialize(base, paths);
      const cwd = path.join(base, "top", "proj");
      const manifest = await trustResourceManifest(cwd, { home });
      expect(manifest !== null, `tree ${name}`).toBe(pi.hasTrustRequiringProjectResources(cwd));
      if (mustHold) expect(manifest, `tree ${name}`).toContain(mustHold);
    }
  });
});
