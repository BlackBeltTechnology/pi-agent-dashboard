/**
 * Folder project resolver — declared identity file, marker detection, bounds.
 * Covers test-plan E1–E15, P1, P3, P5, X6, X7 (L1, temp-dir fs harness).
 * See change: add-project-scoped-apps.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectRuleSources,
  createWalkLimiter,
  type FolderProjectFs,
  type ProjectRuleSource,
  readDeclaredIdentity,
  realFolderProjectFs,
  resolveFolderProject,
} from "../folder-project.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function mk(): string {
  const root = mkdtempSync(join(tmpdir(), "folder-project-"));
  roots.push(root);
  return root;
}

function touch(root: string, rel: string, content = ""): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
}

function declare(root: string, body: unknown): void {
  touch(root, ".pi/dashboard/project.json", typeof body === "string" ? body : JSON.stringify(body));
}

const rule = (pluginId: string, type: string, markers: string[], priority = 100): ProjectRuleSource => ({
  pluginId,
  priority,
  projectTypes: [{ type, markers }],
});

interface Spy {
  fs: FolderProjectFs;
  lstat: string[];
  open: string[];
  opendir: string[];
  entriesRead: number;
}

/** Real fs, with calls recorded and directory entries served in sorted order. */
function spyFs(overrides: Partial<FolderProjectFs> = {}): Spy {
  const spy: Spy = { fs: undefined as never, lstat: [], open: [], opendir: [], entriesRead: 0 };
  spy.fs = {
    lstat: (p) => {
      spy.lstat.push(p);
      return realFolderProjectFs.lstat(p);
    },
    open: (p, flags) => {
      spy.open.push(p);
      return realFolderProjectFs.open(p, flags);
    },
    opendir: async (p) => {
      spy.opendir.push(p);
      const entries = (await fsp.readdir(p, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
      let i = 0;
      return {
        read: async () => {
          if (i >= entries.length) return null;
          spy.entriesRead += 1;
          return entries[i++];
        },
        close: async () => {},
      };
    },
    ...overrides,
  };
  return spy;
}

const JUDO = [rule("judo-app", "judo", ["model/*.judo"])];

describe("declared identity (E1–E6, E8, X6)", () => {
  it("E1: valid declaration", async () => {
    const root = mk();
    declare(root, { schemaVersion: 1, id: "acme-erp", type: "judo" });
    expect(await resolveFolderProject(root, [])).toEqual({ id: "acme-erp", types: ["judo"], source: "declared" });
  });

  it("E2: one invalid field keeps the other", async () => {
    const root = mk();
    declare(root, { schemaVersion: 1, id: "acme-erp", type: "JUDO!" });
    touch(root, "model/core.judo");
    expect(await resolveFolderProject(root, JUDO)).toEqual({ id: "acme-erp", types: ["judo"], source: "detected" });
  });

  it("E3: whole-file ignore for bad schemaVersion / array / invalid JSON / oversized", async () => {
    const bodies: Array<[string, string]> = [
      ["schemaVersion 2", JSON.stringify({ schemaVersion: 2, id: "acme-erp" })],
      ["array", "[]"],
      ["invalid json", "{"],
      ["65537 bytes", JSON.stringify({ schemaVersion: 1, id: "acme-erp", pad: "x".repeat(65537) })],
    ];
    for (const [label, body] of bodies) {
      const root = mk();
      declare(root, body);
      expect(await resolveFolderProject(root, []), label).toEqual({ id: null, types: [], source: "none" });
    }
  });

  it.skipIf(process.platform === "win32")("E3: a FIFO named project.json resolves without hanging", async () => {
    const root = mk();
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    execFileSync("mkfifo", [join(root, ".pi", "dashboard", "project.json")]);
    const spy = spyFs();
    expect(await resolveFolderProject(root, [], { fs: spy.fs })).toEqual({ id: null, types: [], source: "none" });
    expect(spy.open).toEqual([]);
  });

  it("E4: size boundary 65535 / 65536 / 65537", async () => {
    const padded = (total: number): string => {
      const base = JSON.stringify({ schemaVersion: 1, id: "acme-erp", pad: "" });
      return JSON.stringify({ schemaVersion: 1, id: "acme-erp", pad: "x".repeat(total - base.length) });
    };
    for (const [size, ok] of [
      [65535, true],
      [65536, true],
      [65537, false],
    ] as const) {
      const root = mk();
      const body = padded(size);
      expect(Buffer.byteLength(body)).toBe(size);
      declare(root, body);
      const got = await readDeclaredIdentity(root);
      expect(got, `size ${size}`).toEqual(ok ? { id: "acme-erp" } : null);
    }
  });

  it("E4: never reads more than 64 KiB + 1 bytes", async () => {
    const root = mk();
    declare(root, JSON.stringify({ schemaVersion: 1, pad: "x".repeat(200_000) }));
    let requested = 0;
    const spy = spyFs({
      open: async (p, flags) => {
        const h = await realFolderProjectFs.open(p, flags);
        return {
          // fstat lies (size ≤ cap) so the bounded read itself is what is exercised
          stat: async () => ({ ...(await h.stat()), size: 10 }) as never,
          read: async (b, o, l, pos) => {
            requested += l;
            return h.read(b, o, l, pos);
          },
          close: () => h.close(),
        };
      },
    });
    expect(await readDeclaredIdentity(root, spy.fs)).toBeNull();
    expect(requested).toBeLessThanOrEqual(65537);
  });

  it("E5: symlink at .pi / .pi/dashboard / project.json is treated as absent, target never opened", async () => {
    const outside = mk();
    touch(outside, "project.json", JSON.stringify({ schemaVersion: 1, id: "evil" }));
    touch(outside, "dashboard/project.json", JSON.stringify({ schemaVersion: 1, id: "evil" }));
    touch(outside, "pi/dashboard/project.json", JSON.stringify({ schemaVersion: 1, id: "evil" }));

    const fileLink = mk();
    mkdirSync(join(fileLink, ".pi", "dashboard"), { recursive: true });
    symlinkSync(join(outside, "project.json"), join(fileLink, ".pi", "dashboard", "project.json"));

    const dashLink = mk();
    mkdirSync(join(dashLink, ".pi"), { recursive: true });
    symlinkSync(join(outside, "dashboard"), join(dashLink, ".pi", "dashboard"));

    const piLink = mk();
    symlinkSync(join(outside, "pi"), join(piLink, ".pi"));

    for (const root of [fileLink, dashLink, piLink]) {
      const spy = spyFs();
      expect(await resolveFolderProject(root, [], { fs: spy.fs })).toEqual({ id: null, types: [], source: "none" });
      expect(spy.open).toEqual([]);
    }
  });

  it("E6: id regex boundaries", async () => {
    const cases: Array<[string, string | null]> = [
      ["a", "a"],
      ["a".repeat(64), "a".repeat(64)],
      ["a".repeat(65), null],
      ["9abc", null],
      ["Abc", null],
    ];
    for (const [id, want] of cases) {
      const root = mk();
      declare(root, { schemaVersion: 1, id });
      expect((await resolveFolderProject(root, [])).id, id).toBe(want);
    }
  });

  it("E8: a declared type wins and the walker never runs", async () => {
    const root = mk();
    declare(root, { schemaVersion: 1, type: "plain" });
    touch(root, "model/core.judo");
    const spy = spyFs();
    expect(await resolveFolderProject(root, JUDO, { fs: spy.fs })).toEqual({ id: null, types: ["plain"], source: "declared" });
    expect(spy.opendir).toEqual([]);
  });

  it("X6: parent swapped after open → treated as absent", async () => {
    const root = mk();
    declare(root, { schemaVersion: 1, id: "acme-erp" });
    const dashDir = join(root, ".pi", "dashboard");
    let dashLstats = 0;
    const spy = spyFs({
      lstat: async (p) => {
        const st = await realFolderProjectFs.lstat(p);
        if (p === dashDir && ++dashLstats === 2) return { ...st, isFile: st.isFile.bind(st), isDirectory: st.isDirectory.bind(st), isSymbolicLink: st.isSymbolicLink.bind(st), dev: st.dev, ino: st.ino + 1 };
        return st;
      },
    });
    expect(await readDeclaredIdentity(root, spy.fs)).toBeNull();
  });
});

describe("marker detection (E7, E9–E12, E15)", () => {
  it("E7: `*` matches zero chars, is case-sensitive, one level only; a directory matches", async () => {
    const variants: Array<[string, string, boolean]> = [
      ["model/.judo", "f", true],
      ["model/core.JUDO", "f", false],
      ["model/sub/x.judo", "f", false],
      ["model/core.judo/keep", "f", true],
    ];
    for (const [rel, , want] of variants) {
      const root = mk();
      touch(root, rel);
      const got = await resolveFolderProject(root, JUDO);
      expect(got.types, rel).toEqual(want ? ["judo"] : []);
    }
  });

  it("E9: no rules → no filesystem walk", async () => {
    const root = mk();
    touch(root, "model/core.judo");
    const spy = spyFs();
    expect(await resolveFolderProject(root, [], { fs: spy.fs })).toEqual({ id: null, types: [], source: "none" });
    expect(spy.opendir).toEqual([]);
  });

  it("E10: only loaded + enabled + fixture-allowed plugins contribute", async () => {
    const mkManifest = (id: string, type: string): PluginManifest =>
      ({ id, displayName: id, claims: [], projectTypes: [{ type, markers: [`${type}.mark`] }] }) as PluginManifest;
    const plugins = [
      { manifest: mkManifest("a", "judo") },
      { manifest: mkManifest("b", "erp") },
      { manifest: { ...mkManifest("c", "demo-scoped"), fixture: true } },
      { manifest: { id: "d", displayName: "d", claims: [] } as PluginManifest },
    ];
    const sources = collectRuleSources(plugins, {
      fixtureAllowed: (m) => m.fixture !== true,
      isLoaded: () => true,
      isEnabled: (m) => m.id !== "b",
    });
    expect(sources.map((s) => s.pluginId)).toEqual(["a"]);
    const root = mk();
    for (const f of ["judo.mark", "erp.mark", "demo-scoped.mark"]) touch(root, f);
    expect((await resolveFolderProject(root, sources)).types).toEqual(["judo"]);
    // not loaded → excluded too
    expect(collectRuleSources(plugins, { fixtureAllowed: () => true, isLoaded: () => false, isEnabled: () => true })).toEqual([]);
  });

  it("E11: symlinked directories and files never match", async () => {
    const root = mk();
    const outside = mk();
    touch(outside, "core.judo");
    symlinkSync(outside, join(root, "model"));
    mkdirSync(join(root, "model2"));
    symlinkSync(join(outside, "core.judo"), join(root, "model2", "core.judo"));
    const rules = [rule("p", "judo", ["model/*.judo", "model2/*.judo"])];
    expect(await resolveFolderProject(root, rules)).toEqual({ id: null, types: [], source: "none" });
  });

  it("E12: .git and node_modules are never visited", async () => {
    const root = mk();
    touch(root, "node_modules/x.judo");
    touch(root, ".git/x.judo");
    const spy = spyFs();
    const rules = [rule("p", "judo", ["*_modules/x.judo", ".gi*/x.judo"])];
    expect(await resolveFolderProject(root, rules, { fs: spy.fs })).toEqual({ id: null, types: [], source: "none" });
    expect(spy.opendir.filter((d) => /node_modules|\.git/.test(d))).toEqual([]);
  });

  it("E15: types are unique and sorted", async () => {
    const root = mk();
    for (const f of ["z.mark", "a.mark", "a2.mark"]) touch(root, f);
    const rules = [rule("p1", "zeta", ["z.mark"]), rule("p2", "alpha", ["a.mark"]), rule("p3", "alpha", ["a2.mark"], 200)];
    expect((await resolveFolderProject(root, rules)).types).toEqual(["alpha", "zeta"]);
  });
});

describe("bounds (E13, E14, P1, P3, P5, X7)", () => {
  async function flatFolder(n: number): Promise<string> {
    const root = mk();
    await Promise.all(Array.from({ length: n }, (_, i) => fsp.writeFile(join(root, `a${String(i).padStart(5, "0")}`), "")));
    mkdirSync(join(root, "zmarker"));
    return root;
  }
  const MARK = [rule("p", "judo", ["zmarker"])];

  it("E13: entry budget 1999 / 2000 / 2001 entries before the marker", async () => {
    const found = spyFs();
    expect(await resolveFolderProject(await flatFolder(1999), MARK, { fs: found.fs })).toEqual({ id: null, types: ["judo"], source: "detected" });

    const exact = spyFs();
    const r2000 = await resolveFolderProject(await flatFolder(2000), MARK, { fs: exact.fs });
    expect(r2000).toMatchObject({ types: [], truncated: true });
    expect(exact.entriesRead).toBe(2000);

    const over = spyFs();
    const r2001 = await resolveFolderProject(await flatFolder(2001), MARK, { fs: over.fs });
    expect(r2001).toMatchObject({ types: [], truncated: true });
    expect(over.entriesRead).toBeLessThanOrEqual(2000);
  });

  it("E14: pattern budget takes plugins in (priority,id) order and skips the overflow", async () => {
    const many = (id: string, priority: number, prefix: string): ProjectRuleSource => ({
      pluginId: id,
      priority,
      projectTypes: Array.from({ length: 8 }, (_, t) => ({
        type: `${prefix}${t}`,
        markers: Array.from({ length: 16 }, (_, m) => `${prefix}${t}-${m}.x`),
      })),
    });
    const root = mk();
    for (const f of ["a0-0.x", "b0-0.x", "c0-0.x"]) touch(root, f);
    // passed out of order on purpose
    const got = await resolveFolderProject(root, [many("p3", 30, "c"), many("p1", 10, "a"), many("p2", 20, "b")]);
    expect(got.types).toEqual(["a0", "b0"]);
    expect(got.truncated).toBe(true);
  });

  it("P1: at most 4 walks run at once; all 20 complete", async () => {
    let active = 0;
    let peak = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const fs = spyFs({
      opendir: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return { read: async () => null, close: async () => {} };
      },
    }).fs;
    const limiter = createWalkLimiter(4);
    const roots20 = Array.from({ length: 20 }, () => mk());
    const all = Promise.all(roots20.map((r) => resolveFolderProject(r, MARK, { fs, limiter })));
    await new Promise((r) => setTimeout(r, 50));
    expect(peak).toBeLessThanOrEqual(4);
    open();
    const out = await all;
    expect(out).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("P3: a hung opendir ends at the deadline with truncated and frees its slot", async () => {
    const hang = spyFs({ opendir: () => new Promise(() => {}) }).fs;
    const limiter = createWalkLimiter(1);
    const t0 = Date.now();
    const first = await resolveFolderProject(mk(), MARK, { fs: hang, limiter, deadlineMs: 150 });
    expect(Date.now() - t0).toBeLessThan(150 + 250);
    expect(first).toMatchObject({ types: [], truncated: true });
    const root = mk();
    mkdirSync(join(root, "zmarker"));
    const second = await resolveFolderProject(root, MARK, { limiter });
    expect(second.types).toEqual(["judo"]);
  });

  it("P5: 2000-entry tree × 256 patterns resolves in < 500 ms", async () => {
    const root = mk();
    await Promise.all(Array.from({ length: 1990 }, (_, i) => fsp.writeFile(join(root, `f${i}`), "")));
    const patterns = Array.from({ length: 16 }, (_, i) => `*zz${i}*`);
    const rules: ProjectRuleSource[] = Array.from({ length: 16 }, (_, p) => ({
      pluginId: `p${p}`,
      priority: p,
      projectTypes: [{ type: `t${p}`, markers: patterns }],
    }));
    const t0 = performance.now();
    const got = await resolveFolderProject(root, rules);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(got.types).toEqual([]);
  });

  it("X7: a directory swapped across opendir is skipped", async () => {
    const root = mk();
    touch(root, "model/core.judo");
    const modelDir = join(root, "model");
    let modelLstats = 0;
    const spy = spyFs({
      lstat: async (p) => {
        const st = await realFolderProjectFs.lstat(p);
        if (p === modelDir && ++modelLstats === 2) {
          return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev: st.dev, ino: st.ino + 1 };
        }
        return st;
      },
    });
    expect(await resolveFolderProject(root, JUDO, { fs: spy.fs })).toEqual({ id: null, types: [], source: "none" });
  });
});
