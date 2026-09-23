// @vitest-environment node
/**
 * Vendored relay tree integrity — provenance-aware (test-plan E3, E4, E5, E7,
 * X5; scenario X14 of add-browser-relay, extended here).
 *
 * The tree is NOT uniformly upstream: two files are upstream copies this
 * package modifies, and two replace upstream modules entirely. Recording one
 * flat hash per file would label an authored shim as upstream — a lie about
 * provenance. So every entry declares a `kind` and the keys that kind requires.
 *
 * What this test can establish: `patched` matches disk, the file set is exact,
 * each entry carries the keys its `kind` requires, and the §4(b)/§4(d)
 * attribution is internally consistent. What it CANNOT establish is that a
 * refresh faithfully reproduced `upstreamCommit` — regenerating both hashes
 * from one tree is circular. That proof lives in `scripts/refresh-vendor.mjs`,
 * at refresh time, against a fetch.
 *
 * Also pins the authored-shim contracts (see vendor/NOTICE): the vendored
 * CDPRelayServer must LOAD (relative specifiers resolve) and its transport must
 * throw loudly, never silently no-op.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D2, D3).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { registry } from "../relay/vendor/playwright-core/src/server/registry/index.js";
// Vendored upstream code — the patched files import ../../../../shims/*.js as
// plain relative paths, so no alias layer is involved.
import { CDPRelayServer } from "../relay/vendor/playwright-core/src/tools/mcp/cdpRelay.js";
import { ManualPromise } from "../relay/vendor/shims/manualPromise.js";
import { WSServer } from "../relay/vendor/shims/wsServer.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const vendorRoot = path.join(serverDir, "relay", "vendor");

const PATCH_MARKER = "scripts/patch-vendor-specifiers.mjs";
const KINDS = ["upstream-verbatim", "authored"];
/** A recorded hash must be a lowercase 64-char sha256 — an empty string must not satisfy a key. */
const SHA256 = /^[0-9a-f]{64}$/;

interface ManifestEntry {
  kind: string;
  upstream?: string;
  patched?: string;
}
interface Manifest {
  upstreamCommit: string;
  files: Record<string, ManifestEntry>;
}

const manifest = JSON.parse(readFileSync(path.join(here, "vendor-hashes.json"), "utf-8")) as Manifest;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

/** Every source file the manifest must cover: all `.ts` under relay/vendor/. */
function vendoredTsFiles(): string[] {
  return walk(vendorRoot)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.relative(serverDir, f).split(path.sep).join("/"))
    .sort();
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Problems with a single manifest entry. `actual` is null when off-disk. */
function entryProblems(rel: string, entry: ManifestEntry, actual: string | null): string[] {
  if (!KINDS.includes(entry.kind)) return [`${rel}: unknown kind ${JSON.stringify(entry.kind)}`];
  if (typeof entry.patched !== "string") return [`${rel}: missing patched hash`];

  const problems: string[] = [];
  if (!SHA256.test(entry.patched)) problems.push(`${rel}: patched hash is not a 64-char lowercase sha256`);
  if (entry.kind === "upstream-verbatim") {
    if (typeof entry.upstream !== "string") problems.push(`${rel}: kind upstream-verbatim requires an upstream hash`);
    else if (!SHA256.test(entry.upstream)) problems.push(`${rel}: upstream hash is not a 64-char lowercase sha256`);
  }
  if (entry.kind === "authored" && entry.upstream !== undefined) {
    problems.push(`${rel}: kind authored must not carry an upstream hash`);
  }
  if (actual !== null && actual !== entry.patched) {
    problems.push(`${rel}: patched hash ${actual} != recorded ${entry.patched}`);
  }
  return problems;
}

/**
 * Validate a manifest against the files on disk. Pure and injectable so the
 * decision table (E3) can drive known-bad fixtures through the same code path
 * the real manifest takes. Returns one message per problem, empty when valid.
 */
function validateManifest(
  files: Record<string, ManifestEntry>,
  { diskPaths, hashOf }: { diskPaths: string[]; hashOf: (rel: string) => string },
): string[] {
  const disk = new Set(diskPaths);
  const problems = [
    ...diskPaths.filter((rel) => !(rel in files)).map((rel) => `${rel}: on disk but absent from the manifest`),
    ...Object.keys(files).filter((rel) => !disk.has(rel)).map((rel) => `${rel}: in the manifest but absent from disk`),
  ];
  for (const [rel, entry] of Object.entries(files)) {
    problems.push(...entryProblems(rel, entry, disk.has(rel) ? hashOf(rel) : null));
  }
  return problems;
}

/** Paths listed as the first column of a table row or the head of a bullet. */
function noticePaths(heading: string): string[] {
  const notice = readFileSync(path.join(vendorRoot, "NOTICE"), "utf-8");
  const sections = notice.split(/^## /m);
  const section = sections.find((s) => s.startsWith(heading));
  if (!section) throw new Error(`NOTICE has no "## ${heading}" section`);
  return [...section.matchAll(/^\s*[-|]\s*`([^`]+\.ts)`/gm)].map((m) => m[1]);
}

const prefix = (paths: string[]) => paths.map((p) => `relay/vendor/${p}`).sort();

describe("vendored relay integrity (X14)", () => {
  it("NOTICE exists and carries the upstream commit SHA", () => {
    const notice = readFileSync(path.join(vendorRoot, "NOTICE"), "utf-8");
    expect(notice).toContain(manifest.upstreamCommit);
    expect(notice).toContain("Apache License, Version 2.0");
  });

  it("the file set is exact and every patched hash matches disk (X5)", () => {
    expect(validateManifest(manifest.files, { diskPaths: vendoredTsFiles(), hashOf: (rel) => sha256(path.join(serverDir, rel)) })).toEqual([]);
  });

  it("a hand-edited file fails on its patched hash (X5, fault-injected)", () => {
    const target = "relay/vendor/playwright-core/src/tools/mcp/log.ts";
    const problems = validateManifest(manifest.files, {
      diskPaths: vendoredTsFiles(),
      hashOf: (rel) => (rel === target ? "0".repeat(64) : sha256(path.join(serverDir, rel))),
    });
    expect(problems).toEqual([expect.stringContaining(target)]);
  });

  it("an unlisted vendored source fails (file-set drift is fail-closed)", () => {
    const problems = validateManifest(manifest.files, {
      diskPaths: [...vendoredTsFiles(), "relay/vendor/shims/newly-added.ts"],
      hashOf: (rel) => sha256(path.join(serverDir, rel)),
    });
    expect(problems.join("\n")).toContain("shims/newly-added.ts");
  });

  it("provenance decision table (E3): valid kinds pass, dishonest ones fail naming the key", () => {
    const hashOf = () => "a".repeat(64);
    const good = {
      "x-verbatim.ts": { kind: "upstream-verbatim", upstream: "b".repeat(64), patched: "a".repeat(64) },
      "x-authored.ts": { kind: "authored", patched: "a".repeat(64) },
    };
    const diskPaths = Object.keys(good);
    expect(validateManifest(good, { diskPaths, hashOf })).toEqual([]);

    const authoredClaimingUpstream = {
      ...good,
      "x-authored.ts": { kind: "authored", upstream: "b".repeat(64), patched: "a".repeat(64) },
    };
    expect(validateManifest(authoredClaimingUpstream, { diskPaths, hashOf })).toEqual([
      expect.stringContaining("authored must not carry an upstream hash"),
    ]);

    const verbatimMissingUpstream = {
      ...good,
      "x-verbatim.ts": { kind: "upstream-verbatim", patched: "a".repeat(64) },
    };
    expect(validateManifest(verbatimMissingUpstream, { diskPaths, hashOf })).toEqual([
      expect.stringContaining("requires an upstream hash"),
    ]);

    const unknownKind = { ...good, "x-authored.ts": { kind: "vendored", patched: "a".repeat(64) } };
    expect(validateManifest(unknownKind, { diskPaths, hashOf })).toEqual([expect.stringContaining("unknown kind")]);

    const emptyHash = { ...good, "x-verbatim.ts": { kind: "upstream-verbatim", upstream: "", patched: "a".repeat(64) } };
    expect(validateManifest(emptyHash, { diskPaths, hashOf })).toEqual([
      expect.stringContaining("upstream hash is not a 64-char lowercase sha256"),
    ]);

    const shortHash = { ...good, "x-authored.ts": { kind: "authored", patched: "abc" } };
    expect(validateManifest(shortHash, { diskPaths, hashOf }).join("\n")).toContain(
      "patched hash is not a 64-char lowercase sha256",
    );
  });

  it("the authored registry shim is not claimed as upstream (E4)", () => {
    const entry = manifest.files["relay/vendor/playwright-core/src/server/registry/index.ts"];
    expect(entry.kind).toBe("authored");
    expect(entry.upstream).toBeUndefined();
    expect(entry.patched).toMatch(/^[0-9a-f]{64}$/);
  });

  it("all four shims are covered by the manifest (E5)", () => {
    for (const shim of ["manualPromise.ts", "time.ts", "timeoutRunner.ts", "wsServer.ts"]) {
      expect(manifest.files[`relay/vendor/shims/${shim}`], `${shim} is in the manifest`).toBeDefined();
    }
  });

  it("kind sets agree with NOTICE: authored list, and verbatim plus modifications (D3 §4(d))", () => {
    const authored = prefix(noticePaths("Authored shims"));
    const verbatim = prefix([
      ...noticePaths("Verbatim upstream files"),
      ...noticePaths("Verbatim upstream isomorphic helpers"),
      ...noticePaths("Modifications"),
    ]);

    const byKind = (kind: string) =>
      Object.entries(manifest.files)
        .filter(([, e]) => e.kind === kind)
        .map(([rel]) => rel)
        .sort();

    expect(byKind("authored")).toEqual(authored);
    expect(byKind("upstream-verbatim")).toEqual(verbatim);
  });

  it("modified files carry the §4(b) notice; unmodified ones do not (E7)", () => {
    const marker = (rel: string) => readFileSync(path.join(serverDir, rel), "utf-8").includes(PATCH_MARKER);

    for (const rel of [
      "relay/vendor/playwright-core/src/tools/mcp/cdpRelay.ts",
      "relay/vendor/playwright-core/src/tools/mcp/cdpRelayV2.ts",
    ]) {
      expect(marker(rel), `${rel} carries the notice`).toBe(true);
      // `upstream !== patched` iff modified — the two facts must agree.
      const entry = manifest.files[rel];
      expect(entry.upstream).not.toBe(entry.patched);
    }

    for (const [rel, entry] of Object.entries(manifest.files)) {
      if (entry.kind !== "upstream-verbatim") continue;
      if (entry.upstream === entry.patched) {
        expect(marker(rel), `${rel} is unmodified and must not claim modification`).toBe(false);
      }
    }
  });

  it("NOTICE lists the modified files under Modifications, not as verbatim (E7)", () => {
    const verbatim = new Set([
      ...noticePaths("Verbatim upstream files"),
      ...noticePaths("Verbatim upstream isomorphic helpers"),
    ]);
    expect(verbatim.has("playwright-core/src/tools/mcp/cdpRelay.ts")).toBe(false);
    expect(verbatim.has("playwright-core/src/tools/mcp/cdpRelayV2.ts")).toBe(false);
    expect(noticePaths("Modifications")).toEqual(
      expect.arrayContaining(["playwright-core/src/tools/mcp/cdpRelay.ts", "playwright-core/src/tools/mcp/cdpRelayV2.ts"]),
    );
  });
});

describe("vendored relay runtime contracts", () => {
  it("importing the vendored cdpRelay resolves every shim (relative specifiers)", () => {
    expect(typeof CDPRelayServer).toBe("function");
    // Constructing is side-effect-free: the WSServer shim's constructor is
    // inert, only listen() would transport.
    const server = new CDPRelayServer("chrome");
    expect(typeof server.cdpEndpoint).toBe("function");
  });

  it("shims throw loudly where the plugin supplies the real behaviour", async () => {
    const server = new CDPRelayServer("chrome");
    // Transport comes from ctx.registerWsRoute in relay-instance (D2) — the
    // vendored listener must never bind a port.
    await expect(server.start()).rejects.toThrow(/not supported — transport is supplied by relay-instance\.ts/);
    // Browser launch comes from the host systemOpen capability — the registry
    // shim (isChromiumAlias / findExecutable) must not pretend to know.
    expect(() => registry.isChromiumAlias("chromium")).toThrow(
      /not supported — browser launch is supplied by relay-instance\.ts/,
    );
    await expect(new WSServer({} as never).close()).rejects.toThrow(
      /not supported — transport is supplied by relay-instance\.ts/,
    );
  });

  it("ManualPromise is a real implementation (used by ExtensionProtocolV2)", async () => {
    const p = new ManualPromise<string>();
    const value = p.then((v) => `resolved:${v}`);
    expect(p.isDone()).toBe(false);
    p.resolve("ok");
    expect(p.isDone()).toBe(true);
    await expect(value).resolves.toBe("resolved:ok");

    const r = new ManualPromise<void>();
    r.reject(new Error("boom"));
    await expect(r).rejects.toThrow("boom");
  });
});
