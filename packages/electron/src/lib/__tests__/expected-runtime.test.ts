/**
 * resolveExpectedRuntime / peekColdLaunch — read-only expected-runtime resolution.
 * test-plan: E12–E18.
 * See change: electron-attach-version-skew (D1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patchRuntimeRequest, patchRuntimeState, selectRuntimeSource } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BundledServerMissingError, PinnedSourceUnavailableError } from "../launch-source.js";
import { peekColdLaunch, planColdLaunch } from "../runtime-overlay.js";
import { resolveExpectedRuntime } from "../runtime-overlay-main.js";

const SHELL = "0.10.0";
let root: string;
let dir: string;
let resources: string;

function writeManifest(rootDir: string, over: Record<string, unknown> = {}): void {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "runtime-manifest.json"),
    JSON.stringify({ version: "0.10.0", minShellVersion: "0.0.1", nodeEngines: ">=0.0.0", origin: "bundled", ...over }),
  );
}

function touch(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
}

/** Bundle with server entry + manifest. */
function makeBundle(version: string | null = "0.10.0"): void {
  touch(path.join(resources, "server", "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts"));
  if (version) writeManifest(path.join(resources, "server"), { version });
}

/** A fully-staged overlay `versions/<v>/`. */
function makeOverlay(v: string, manifest: Record<string, unknown> = {}): void {
  const r = path.join(dir, "versions", v);
  const scope = path.join(r, "node_modules", "@blackbelt-technology");
  touch(path.join(scope, "pi-dashboard-server", "src", "cli.ts"));
  touch(path.join(scope, "pi-dashboard-web", "dist", "index.html"));
  touch(path.join(scope, "pi-dashboard-extension", "src", "bridge.ts"));
  fs.mkdirSync(path.join(r, "resources", "plugins"), { recursive: true });
  writeManifest(r, { version: v, origin: "npm", ...manifest });
}

const bytes = (f: string) => {
  try {
    return fs.readFileSync(path.join(dir, f), "utf8");
  } catch {
    return null;
  }
};

const resolver = (over: Record<string, unknown> = {}) => ({
  resolver: { isPackaged: true, cwd: root, preferOverride: null, resourcesPath: resources, ...over },
  shellVersion: SHELL,
  dir,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "expected-rt-"));
  dir = path.join(root, "runtime");
  resources = path.join(root, "resources");
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolveExpectedRuntime", () => {
  it("E12: bundle is the expected runtime", async () => {
    makeBundle("0.10.0");
    expect(await resolveExpectedRuntime(resolver())).toEqual({ source: "bundled", version: "0.10.0" });
  });

  it("E13: an active compatible overlay is the expected runtime", async () => {
    makeBundle("0.10.0");
    makeOverlay("0.10.1");
    patchRuntimeRequest(dir, { source: "npm", pending: "0.10.1" });
    patchRuntimeState(dir, { current: "0.10.1" });
    expect(await resolveExpectedRuntime(resolver())).toEqual({ source: "overlay", version: "0.10.1" });
  });

  it("E14: an incompatible overlay is skipped and nothing is recorded", async () => {
    makeBundle("0.10.0");
    makeOverlay("0.10.1", { minShellVersion: "9.0.0" });
    patchRuntimeRequest(dir, { source: "npm", pending: "0.10.1" });
    patchRuntimeState(dir, { current: "0.10.1" });
    const before = [bytes("state.json"), bytes("request.json")];
    expect(await resolveExpectedRuntime(resolver())).toEqual({ source: "bundled", version: "0.10.0" });
    expect([bytes("state.json"), bytes("request.json")]).toEqual(before);
  });

  it("E15: an exhausted pending runtime is skipped in the peek but not persisted", async () => {
    makeBundle("0.10.0");
    makeOverlay("0.10.2");
    patchRuntimeRequest(dir, { source: "npm", pending: "0.10.2" });
    patchRuntimeState(dir, { attempts: { "0.10.2": 2 } });
    const before = [bytes("state.json"), bytes("request.json")];
    expect(await resolveExpectedRuntime(resolver())).toEqual({ source: "bundled", version: "0.10.0" });
    expect([bytes("state.json"), bytes("request.json")]).toEqual(before);
    planColdLaunch(dir);
    expect(JSON.parse(bytes("state.json") as string).bad?.["0.10.2"]).toBeDefined();
  });

  it("E17: non-release sources yield an unknown version", async () => {
    // devMonorepo (unpackaged checkout)
    touch(path.join(root, "packages", "server", "src", "cli.ts"));
    touch(path.join(root, "packages", "extension", "src", "bridge.ts"));
    expect((await resolveExpectedRuntime(resolver({ isPackaged: false }))).version).toBeNull();
    // bundle without a manifest
    makeBundle(null);
    expect((await resolveExpectedRuntime(resolver())).version).toBeNull();
  });

  it("E17: localLink yields an unknown version", async () => {
    makeBundle("0.10.0");
    const checkout = path.join(root, "checkout");
    touch(path.join(checkout, "packages", "server", "src", "cli.ts"));
    touch(path.join(checkout, "packages", "client", "dist", "index.html"));
    touch(path.join(checkout, "packages", "extension", "src", "bridge.ts"));
    fs.mkdirSync(path.join(checkout, "node_modules"), { recursive: true });
    const req = selectRuntimeSource(dir, { source: "bundled" });
    patchRuntimeState(dir, {
      localPath: fs.realpathSync(checkout),
      localBinding: { epoch: req.sourceEpoch as string, seq: req.sourceSeq as number },
    });
    patchRuntimeRequest(dir, {});
    const r = await resolveExpectedRuntime(resolver());
    expect(r.version).toBeNull();
  });

  it("E18: resolution errors are silent", async () => {
    // no bundle → BundledServerMissingError inside selectLaunchSource
    const r = await resolveExpectedRuntime(resolver());
    expect(r.version).toBeNull();
    expect(BundledServerMissingError).toBeDefined();
    // pinned source unavailable
    const r2 = await resolveExpectedRuntime(resolver({ preferOverride: "overlay" }));
    expect(r2.version).toBeNull();
    expect(PinnedSourceUnavailableError).toBeDefined();
  });
});

describe("peekColdLaunch", () => {
  it("E16: peek and plan derive identical inputs; only plan writes", () => {
    patchRuntimeRequest(dir, { source: "npm", pending: "0.10.3", pendingNonce: "n1" });
    patchRuntimeState(dir, { bad: { "0.10.3": { reason: "x" } }, attempts: { "0.10.3": 2 } });
    const dirB = path.join(root, "runtime-b");
    fs.cpSync(dir, dirB, { recursive: true });
    const before = [bytes("state.json"), bytes("request.json")];
    const peeked = peekColdLaunch(dir);
    expect([bytes("state.json"), bytes("request.json")]).toEqual(before);
    const planned = planColdLaunch(dirB);
    expect(peeked.inputs.effectiveSource).toBe(planned.inputs.effectiveSource);
    expect(peeked.inputs.overlays?.map((o) => o.runtimeId)).toEqual(planned.inputs.overlays?.map((o) => o.runtimeId));
    expect(peeked.activating).toBe(planned.activating);
    expect(fs.readFileSync(path.join(dirB, "state.json"), "utf8")).not.toBe(before[0]);
  });
});
