/**
 * Runtime-client registry: admission, one-reason precedence, content-hash pin lifecycle —
 * test-plan #E69 (b–e), #E70, #E71 (status half), #E76, #E77, #E78.
 *
 * See change: decouple-plugins-from-core (tasks 6.1, 6.2, 6.7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentHasher } from "../client-content-hash.js";
import { isBundledPlugin, serverRegistryHash } from "../client-registry-set.js";
import { clearDiscoveryCache, type DiscoveredPlugin, discoverPlugins, pluginRegistryHash } from "../loader.js";
import {
  createRuntimeClientRegistry,
  REFUSAL_PRECEDENCE,
  type RuntimeClientRegistry,
  type RuntimeTrustEntry,
} from "../runtime-client-registry.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rt-client-reg-")));
  clearDiscoveryCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  clearDiscoveryCache();
  vi.restoreAllMocks();
});

/** A runtime-eligible plugin on disk under `<tmp>/packages/<id>` with a dedicated `dist/client/` asset root. */
function mk(id: string, extra: Record<string, unknown> = {}, files: Record<string, string> = { "index.js": "export default 1;\n" }) {
  const dir = path.join(tmp, "packages", id);
  fs.mkdirSync(path.join(dir, "dist", "client"), { recursive: true });
  const manifest = {
    id,
    displayName: id,
    claims: [{ slot: "settings-section", component: "X" }],
    client: "./src/client.tsx",
    clientBundle: "./dist/client/index.js",
    hostApi: "^1.0.0",
    ...extra,
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: id, version: "1.0.0", "pi-dashboard-plugin": manifest }));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, "dist", "client", name)), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "client", name), body);
  }
  return dir;
}

interface World {
  declared?: string[];
  trust?: RuntimeTrustEntry[];
  disabled?: Set<string>;
  /** Stored status `loaded` per id; default true. */
  notLoaded?: Set<string>;
}
function registry(w: World = {}, hasher = createContentHasher()): RuntimeClientRegistry {
  return createRuntimeClientRegistry({
    discover: () => discoverPlugins(tmp),
    declaredIds: () => w.declared,
    isEnabled: (id) => !w.disabled?.has(id),
    readTrust: () => w.trust ?? [],
    getStoredStatus: (id) => ({ id, displayName: id, enabled: true, loaded: !w.notLoaded?.has(id), claims: 1 }) as PluginStatus,
    hasher,
  });
}
const row = (id: string): PluginStatus => ({ id, displayName: id, enabled: true, loaded: true, claims: 1 });
const pin = (reg: RuntimeClientRegistry, id: string): RuntimeTrustEntry => ({ id, clientSha256: reg.currentContentHash(id) });

describe("E76 admission and one refusal reason per condition", () => {
  it("all conditions pass → runtime + sha256, listed", () => {
    mk("ext");
    const base = registry({ declared: ["flows"] });
    const trust = [pin(base, "ext")];
    const reg = registry({ declared: ["flows"], trust });
    const client = reg.resolveClient(row("ext"));
    expect(client).toEqual({ delivery: "runtime", sha256: trust[0].clientSha256 });
    const [a] = reg.getAdmittedRuntimePlugins();
    expect(a).toMatchObject({ id: "ext", entry: "index.js", sha256: trust[0].clientSha256 });
    expect(reg.getAdmittedAssetRoot("ext", trust[0].clientSha256 as string)).toBe(a.assetRoot);
    expect(reg.getAdmittedAssetRoot("ext", "0".repeat(64))).toBeUndefined();
  });

  it.each([
    ["untrusted", () => { mk("ext"); return registry({ declared: ["flows"] }); }],
    ["pin-mismatch", () => { mk("ext"); return registry({ declared: ["flows"], trust: [{ id: "ext", clientSha256: "f".repeat(64) }] }); }],
    ["host-api", () => { mk("ext", { hostApi: "^2.0.0" }); return registry({ declared: ["flows"] }); }],
    ["no-bundle", () => { mk("ext", { clientBundle: undefined }); return registry({ declared: ["flows"] }); }],
    ["build-undeclared", () => { mk("ext"); return registry({}); }],
    ["disabled", () => { mk("ext"); return registry({ declared: ["flows"], disabled: new Set(["ext"]) }); }],
    ["missing-dep", () => { mk("ext", { dependsOn: ["quota"] }); mk("quota"); return registry({ declared: ["flows"], disabled: new Set(["quota"]) }); }],
  ] as const)("%s", (reason, build) => {
    const reg = build();
    expect(reg.resolveClient(row("ext"))).toMatchObject({ delivery: "refused", refusedReason: reason });
    expect(reg.getAdmittedRuntimePlugins().map((p) => p.id)).not.toContain("ext");
  });

  it("untrusted / pin-mismatch carry the current hash for the Trust action; other reasons do not", () => {
    mk("ext");
    const reg = registry({ declared: ["flows"] });
    expect(reg.resolveClient(row("ext"))?.sha256).toBe(reg.currentContentHash("ext"));
    expect(registry({}).resolveClient(row("ext"))?.sha256).toBeUndefined();
  });

  it("an enabled plugin whose server entry did not load is refused `disabled`", () => {
    mk("ext", { server: "./server.mjs" });
    const reg = registry({ declared: ["flows"], notLoaded: new Set(["ext"]) });
    expect(reg.resolveClient(row("ext"))).toMatchObject({ refusedReason: "disabled" });
  });

  it("a client-less plugin keeps no runtime client status", () => {
    mk("headless", { client: undefined, clientBundle: undefined });
    expect(registry({ declared: ["flows"] }).resolveClient(row("headless"))).toBeUndefined();
  });
});

describe("E77 precedence and sha-less entries", () => {
  it("lists the documented order", () => {
    expect(REFUSAL_PRECEDENCE).toEqual(["build-undeclared", "no-bundle", "host-api", "disabled", "missing-dep", "untrusted", "pin-mismatch"]);
  });

  it("(a) untrusted + disabled + missing-dep → disabled", () => {
    mk("ext", { dependsOn: ["quota"] });
    const reg = registry({ declared: ["flows"], disabled: new Set(["ext", "quota"]) });
    expect(reg.resolveClient(row("ext"))?.refusedReason).toBe("disabled");
  });

  it("(b) build-undeclared + no-bundle + untrusted → build-undeclared", () => {
    mk("ext", { clientBundle: undefined });
    expect(registry({}).resolveClient(row("ext"))?.refusedReason).toBe("build-undeclared");
  });

  it("(b') no-bundle + host-api + untrusted → no-bundle", () => {
    mk("ext", { clientBundle: undefined, hostApi: "^9.0.0" });
    expect(registry({ declared: ["flows"] }).resolveClient(row("ext"))?.refusedReason).toBe("no-bundle");
  });

  it("(c) host-api + disabled → host-api", () => {
    mk("ext", { hostApi: "^2.0.0" });
    expect(registry({ declared: ["flows"], disabled: new Set(["ext"]) }).resolveClient(row("ext"))?.refusedReason).toBe("host-api");
  });

  it("(d) missing-dep + pin-mismatch → missing-dep", () => {
    mk("ext", { dependsOn: ["quota"] });
    const reg = registry({ declared: ["flows"], trust: [{ id: "ext", clientSha256: "e".repeat(64) }] });
    expect(reg.resolveClient(row("ext"))?.refusedReason).toBe("missing-dep");
  });

  it("(e) {id, server:true} without clientSha256 → untrusted, absent from the listing", () => {
    mk("ext");
    const reg = registry({ declared: ["flows"], trust: [{ id: "ext", server: true }] });
    expect(reg.resolveClient(row("ext"))).toMatchObject({ delivery: "refused", refusedReason: "untrusted" });
    expect(reg.getAdmittedRuntimePlugins()).toEqual([]);
  });

  it("a dependency that is not discovered is missing-dep too", () => {
    mk("ext", { dependsOn: ["ghost"] });
    expect(registry({ declared: ["flows"] }).resolveClient(row("ext"))?.refusedReason).toBe("missing-dep");
  });
});

describe("E69 client layout refusal reaches the status", () => {
  it("(b) runtime-eligible with `client` only → no-bundle", () => {
    mk("ext", { clientBundle: undefined });
    expect(registry({ declared: ["flows"] }).resolveClient(row("ext"))).toMatchObject({ refusedReason: "no-bundle" });
  });

  it.each([
    ["(c) bundle beside the server entry", { clientBundle: "./dist/client.js", server: "./dist/server.js" }],
    ["(d) bundle at the package root", { clientBundle: "./client.js" }],
    ["(e) bridge inside the bundle dir", { clientBundle: "./dist/client/index.js", bridge: "./dist/client/bridge.js" }],
  ])("%s → no-bundle, nothing served", (_n, extra) => {
    const dir = mk("ext", extra);
    fs.writeFileSync(path.join(dir, "dist", "server.js"), "export default () => {};");
    fs.writeFileSync(path.join(dir, "client.js"), "export default 1;");
    const reg = registry({ declared: ["flows"], trust: [{ id: "ext", clientSha256: "a".repeat(64) }] });
    expect(reg.resolveClient(row("ext"))).toMatchObject({ refusedReason: "no-bundle" });
    expect(reg.currentContentHash("ext")).toBeUndefined();
    expect(reg.getAdmittedAssetRoot("ext", "a".repeat(64))).toBeUndefined();
  });

  it("a missing entry module is no-bundle", () => {
    mk("ext", {}, { "other.js": "x" });
    expect(registry({ declared: ["flows"] }).resolveClient(row("ext"))?.refusedReason).toBe("no-bundle");
  });

  it("a symlinked asset root escaping the package is no-bundle", () => {
    const dir = mk("ext");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "index.js"), "export default 1;");
    fs.rmSync(path.join(dir, "dist", "client"), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, "dist", "client"));
    expect(registry({ declared: ["flows"] }).resolveClient(row("ext"))?.refusedReason).toBe("no-bundle");
  });

  it("(a) entry listing comes from clientBundle; styles inside the root are carried", () => {
    mk("ext", { clientStyles: "./dist/client/client.css" }, { "index.js": "1", "client.css": ".a{}" });
    const base = registry({ declared: ["flows"] });
    const reg = registry({ declared: ["flows"], trust: [pin(base, "ext")] });
    expect(reg.getAdmittedRuntimePlugins()[0]).toMatchObject({ entry: "index.js", styles: "client.css" });
  });
});

describe("E70 bundled rule", () => {
  it("npm-global, declared [flows, goal], third `ext` runtime-eligible", () => {
    mk("flows");
    mk("goal");
    mk("ext");
    const reg = registry({ declared: ["flows", "goal"] });
    expect(reg.resolveClient(row("flows"))).toEqual({ delivery: "bundled" });
    expect(reg.resolveClient(row("goal"))).toEqual({ delivery: "bundled" });
    expect(reg.resolveClient(row("ext"))?.delivery).toBe("refused");
  });

  it("#E63 the real bundled `demo` (source workspace) reports `client.delivery:\"bundled\"` when the build declares it", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const discover = () => discoverPlugins(repoRoot);
    const demo = discover().find((p) => p.manifest.id === "demo");
    expect(demo?.source).toBe("workspace");
    const reg = createRuntimeClientRegistry({
      discover,
      declaredIds: () => ["demo"],
      isEnabled: () => true,
      readTrust: () => [],
      getStoredStatus: (id) => ({ id, displayName: id, enabled: true, loaded: true, claims: 1 }) as PluginStatus,
    });
    expect(reg.resolveClient(row("demo"))).toEqual({ delivery: "bundled" });
  });

  it("an undeclared build: a bundled-shaped plugin is runtime-eligible, never `bundled`", () => {
    mk("flows");
    expect(registry({}).resolveClient(row("flows"))?.refusedReason).toBe("build-undeclared");
  });

  it("property: delivery==bundled ⇔ id ∈ declared ⇔ id counted in the server hash (50 random sets)", () => {
    const universe = ["a", "b", "c", "d", "e", "f"];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const cand = (id: string, source: "workspace" | "installed"): DiscoveredPlugin => ({
      manifest: { id, displayName: id, claims: [{ slot: "settings-section", component: id }] },
      source,
      packageDir: source === "workspace" ? `/repo/packages/${id}` : `/home/u/.pi/dashboard/plugins/${id}`,
      packageName: id,
      clientEntryPath: `/x/${id}/c.tsx`,
    });
    for (let i = 0; i < 50; i++) {
      const declared = universe.filter(() => rnd() < 0.5).sort();
      const discovered = universe.map((id) => cand(id, declared.includes(id) ? "workspace" : "installed"));
      const declaration = { bundledPluginIds: declared, pluginRegistryHash: pluginRegistryHash(discovered.filter((p) => declared.includes(p.manifest.id))) };
      const reg = createRuntimeClientRegistry({
        discover: () => discovered,
        declaredIds: () => declared,
        isEnabled: () => true,
        readTrust: () => [],
        getStoredStatus: () => undefined,
      });
      const serverHash = serverRegistryHash(discovered, { isProd: true, declaration, monorepoRoot: "/repo" });
      for (const id of universe) {
        const bundled = reg.resolveClient(row(id))?.delivery === "bundled";
        expect(bundled).toBe(declared.includes(id));
        expect(bundled).toBe(isBundledPlugin(id, declaration));
      }
      // The server hash covers exactly the declared ids (runtime-only installed copies are excluded).
      expect(serverHash).toBe(pluginRegistryHash(discovered.filter((p) => declared.includes(p.manifest.id))));
    }
  });
});

describe("E71 older declaration (no bundledPluginIds)", () => {
  it("every runtime-eligible plugin is build-undeclared; plain-priority winners stay", () => {
    mk("ext");
    const reg = registry({});
    expect(reg.resolveClient(row("ext"))).toMatchObject({ delivery: "refused", refusedReason: "build-undeclared" });
    expect(reg.getAdmittedRuntimePlugins()).toEqual([]);
  });
});

describe("E78 content hash is recomputed, never wildcarded", () => {
  const SIZE_SAME_A = "export const v = 1111;\n";
  const SIZE_SAME_B = "export const v = 2222;\n";

  function trusted(files: Record<string, string> = { "index.js": SIZE_SAME_A }) {
    const dir = mk("ext", {}, files);
    const hasher = createContentHasher();
    const base = registry({ declared: ["flows"] }, hasher);
    const sha = base.currentContentHash("ext") as string;
    const reg = registry({ declared: ["flows"], trust: [{ id: "ext", clientSha256: sha }] }, hasher);
    return { dir, hasher, reg, sha, file: path.join(dir, "dist", "client", "index.js") };
  }

  it("(a) a rebuild changes bytes: the next read is pin-mismatch with the new hash, no refresh needed", () => {
    const { reg, sha, file } = trusted();
    expect(reg.resolveClient(row("ext"))?.delivery).toBe("runtime");
    fs.writeFileSync(file, "export const v = 'a longer rebuilt bundle';\n");
    const after = reg.resolveClient(row("ext"));
    expect(after).toMatchObject({ refusedReason: "pin-mismatch" });
    expect(after?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after?.sha256).not.toBe(sha);
    expect(reg.getAdmittedAssetRoot("ext", sha)).toBeUndefined();
  });

  it("(b) same size, original mtime restored: caught after the cache is dropped (package completion)", () => {
    const { reg, hasher, file } = trusted();
    const before = fs.statSync(file);
    expect(reg.resolveClient(row("ext"))?.delivery).toBe("runtime");
    // Replace by rename: new inode + ctime, same size, mtime put back (what npm does).
    const replacement = `${file}.new`;
    fs.writeFileSync(replacement, SIZE_SAME_B);
    fs.renameSync(replacement, file);
    fs.utimesSync(file, before.atime, before.mtime);
    expect(fs.statSync(file).size).toBe(before.size);
    hasher.clear(); // package-operation completion drops every digest
    expect(reg.resolveClient(row("ext"))?.refusedReason).toBe("pin-mismatch");
  });

  it("(b') ino/ctime in the key catch the same-size rewrite even WITHOUT a cache drop", () => {
    const { reg, file } = trusted();
    const before = fs.statSync(file);
    expect(reg.resolveClient(row("ext"))?.delivery).toBe("runtime");
    const replacement = `${file}.new`;
    fs.writeFileSync(replacement, SIZE_SAME_B);
    fs.renameSync(replacement, file);
    fs.utimesSync(file, before.atime, before.mtime);
    expect(reg.resolveClient(row("ext"))?.refusedReason).toBe("pin-mismatch");
  });

  it("(c) unchanged files are not re-digested", () => {
    const { reg, hasher } = trusted({ "index.js": SIZE_SAME_A, "chunk.js": "export {};\n" });
    reg.resolveClient(row("ext"));
    const calls = hasher.digestCalls;
    for (let i = 0; i < 5; i++) {
      reg.resolveClient(row("ext"));
      reg.getAdmittedRuntimePlugins();
    }
    expect(hasher.digestCalls).toBe(calls);
    hasher.clear();
    reg.resolveClient(row("ext"));
    expect(hasher.digestCalls).toBe(calls + 2);
  });

  it("(d) a symlink in the asset root pointing outside is not hashed", () => {
    const { dir, reg, sha } = trusted();
    const outside = path.join(tmp, "secret.js");
    fs.writeFileSync(outside, "export const secret = 1;\n");
    fs.symlinkSync(outside, path.join(dir, "dist", "client", "link.js"));
    expect(reg.resolveClient(row("ext"))).toEqual({ delivery: "runtime", sha256: sha });
  });

  it("only allowlisted files count: a .map / .json / dotfile change keeps the pin; a .js.gz change breaks it", () => {
    const { dir, reg } = trusted();
    const root = path.join(dir, "dist", "client");
    fs.writeFileSync(path.join(root, "index.js.map"), "{}");
    fs.writeFileSync(path.join(root, "notes.json"), "{}");
    fs.writeFileSync(path.join(root, ".hidden.js"), "x");
    expect(reg.resolveClient(row("ext"))?.delivery).toBe("runtime");
    fs.writeFileSync(path.join(root, "index.js.gz"), "gz bytes");
    expect(reg.resolveClient(row("ext"))?.refusedReason).toBe("pin-mismatch");
  });

  it("the hash covers nested files and path names (a renamed file changes it)", () => {
    const hasher = createContentHasher();
    const dir = path.join(tmp, "h");
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "sub", "a.js"), "1");
    const h1 = hasher.hashDir(dir);
    fs.renameSync(path.join(dir, "sub", "a.js"), path.join(dir, "sub", "b.js"));
    expect(hasher.hashDir(dir)).not.toBe(h1);
    expect(hasher.hashDir(path.join(tmp, "nope"))).toBeUndefined();
  });

  it("drops cached digests for files that vanished (cache does not grow without bound)", () => {
    const hasher = createContentHasher();
    const dir = path.join(tmp, "h2");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.js"), "1");
    fs.writeFileSync(path.join(dir, "b.js"), "2");
    const both = hasher.hashDir(dir);
    fs.rmSync(path.join(dir, "b.js"));
    expect(hasher.hashDir(dir)).not.toBe(both);
    fs.writeFileSync(path.join(dir, "b.js"), "2");
    const calls = hasher.digestCalls;
    expect(hasher.hashDir(dir)).toBe(both);
    expect(hasher.digestCalls).toBe(calls + 1); // b.js re-digested: its cache entry was pruned
  });
});
