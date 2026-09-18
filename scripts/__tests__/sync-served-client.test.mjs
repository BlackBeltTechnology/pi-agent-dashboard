/**
 * `sync-served-client.mjs` outcome table and fault injection — folds test-plan
 * scenarios E15, E16, X3, X4.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILD_DECLARATION_SCHEMA_VERSION,
  isUsableDeclaration,
  readBuildDeclaration,
  writeBuildDeclaration,
} from "../../packages/dashboard-plugin-runtime/src/server/build-metadata.ts";
import { SYNC_STATUS, syncServedClient } from "../sync-served-client.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const dirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-client-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      /* best effort for a chmod'd fixture */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A client build directory; `declaration` null leaves it undescribed (legacy). */
function makeBuild(root, name, { hash = HASH_A, declaration = true, asset } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>", "utf-8");
  if (asset) fs.writeFileSync(path.join(dir, "assets", asset), asset, "utf-8");
  if (declaration) {
    writeBuildDeclaration(dir, {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: hash,
      fixturePolicy: "excluded",
    });
  }
  return dir;
}

/** Test-local invariant wrapper: inject the real readers but skip jiti. */
function run(sourceDir, destDir, extra = {}) {
  return syncServedClient({
    sourceDir,
    destDir,
    readDeclaration: readBuildDeclaration,
    isUsable: isUsableDeclaration,
    ...extra,
  });
}

describe("syncServedClient outcome table (E15)", () => {
  it("no-op when the destination is the source", async () => {
    const root = tmpDir();
    const build = makeBuild(root, "client/dist");
    const result = await run(build, build);
    expect(result.status).toBe(SYNC_STATUS.NO_OP);
  });

  it("refuses an undescribed workspace build even when destination == source", async () => {
    // "Destination == source" is a supported no-op ONLY when the build
    // described itself; an undeclared workspace build is unverifiable.
    const root = tmpDir();
    const build = makeBuild(root, "client/dist", { declaration: false });
    const result = await run(build, build);
    expect(result.status).toBe(SYNC_STATUS.REFUSED);
    expect(result.message).toMatch(/no usable declaration/);
  });

  it("mirrors into a valid destination that has a declaration", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source", { hash: HASH_A, asset: "new.js" });
    const dest = makeBuild(root, "dest", { hash: HASH_B, asset: "old.js" });

    const result = await run(source, dest);

    expect(result.status).toBe(SYNC_STATUS.MIRRORED);
    expect(readBuildDeclaration(dest)).toMatchObject({
      kind: "valid",
      declaration: { pluginRegistryHash: HASH_A },
    });
    expect(fs.existsSync(path.join(dest, "assets", "new.js"))).toBe(true);
    // Superseded hashed assets are removed, not accumulated.
    expect(fs.existsSync(path.join(dest, "assets", "old.js"))).toBe(false);
  });

  it("adopts a legacy destination that has no declaration", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source", { hash: HASH_A });
    const legacy = makeBuild(root, "legacy", { declaration: false });

    const result = await run(source, legacy);

    expect(result.status).toBe(SYNC_STATUS.MIRRORED);
    expect(readBuildDeclaration(legacy)).toMatchObject({
      kind: "valid",
      declaration: { pluginRegistryHash: HASH_A },
    });
  });

  it("reports the API-only host as an explicit success", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source");
    const result = await run(source, null);
    expect(result.status).toBe(SYNC_STATUS.API_ONLY);
  });

  it("refuses a destination that is not a client build, leaving it unmodified", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source");
    const notABuild = path.join(root, "not-a-build");
    fs.mkdirSync(path.join(notABuild, "assets"), { recursive: true });
    fs.writeFileSync(path.join(notABuild, "keep.txt"), "keep", "utf-8");

    const result = await run(source, notABuild);

    expect(result.status).toBe(SYNC_STATUS.REFUSED);
    expect(fs.readFileSync(path.join(notABuild, "keep.txt"), "utf-8")).toBe("keep");
  });
});

describe("syncServedClient refusals (E16, X3, X4)", () => {
  it("E16 refuses an absent source declaration, destination byte-identical", async () => {
    const root = tmpDir();
    const dest = makeBuild(root, "dest", { hash: HASH_B });
    const source = makeBuild(root, "source", { declaration: false });

    const before = fs.readFileSync(path.join(dest, "pi-dashboard-build.json"), "utf-8");
    const result = await run(source, dest);
    expect(result.status).toBe(SYNC_STATUS.REFUSED);
    expect(fs.readFileSync(path.join(dest, "pi-dashboard-build.json"), "utf-8")).toBe(before);
  });

  it("E16 refuses a malformed source declaration", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source", { declaration: false });
    fs.writeFileSync(path.join(source, "pi-dashboard-build.json"), "{ not json", "utf-8");
    const dest = makeBuild(root, "dest", { hash: HASH_B });

    const result = await run(source, dest);
    expect(result.status).toBe(SYNC_STATUS.REFUSED);
    expect(result.message).toContain("malformed");
  });

  it("X3 refuses a non-writable destination with a remediation hint and no partial write", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source", { hash: HASH_A, asset: "new.js" });
    const dest = makeBuild(root, "dest", { hash: HASH_B, asset: "old.js" });
    const before = fs.readFileSync(path.join(dest, "pi-dashboard-build.json"), "utf-8");

    const nested = path.join(dest, "assets");
    fs.chmodSync(nested, 0o555);
    fs.chmodSync(dest, 0o555);
    try {
      const result = await run(source, dest);
      expect(result.status).toBe(SYNC_STATUS.REFUSED);
      expect(result.message).toMatch(/not writable|EACCES|EPERM/i);
    } finally {
      fs.chmodSync(dest, 0o755);
      fs.chmodSync(nested, 0o755);
    }
    // Contents unchanged — the old asset is still there, the new one is not.
    expect(fs.readFileSync(path.join(dest, "pi-dashboard-build.json"), "utf-8")).toBe(before);
    expect(fs.existsSync(path.join(dest, "assets", "old.js"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "assets", "new.js"))).toBe(false);
  });

  it("X4 reports a post-copy mismatch as a refusal, never as success", async () => {
    const root = tmpDir();
    const source = makeBuild(root, "source", { hash: HASH_A });
    const dest = makeBuild(root, "dest", { hash: HASH_B });

    // A write hook that copies everything EXCEPT the declaration, so the
    // destination's stale declaration survives the copy.
    const copyTree = (src, dst) => {
      for (const entry of fs.readdirSync(src)) {
        if (entry === "pi-dashboard-build.json") continue;
        const to = path.join(dst, entry);
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(path.join(src, entry), to, { recursive: true });
      }
    };

    const result = await run(source, dest, { copyTree });
    expect(result.status).toBe(SYNC_STATUS.REFUSED);
    expect(result.message).toMatch(/differ/);
  });
});
