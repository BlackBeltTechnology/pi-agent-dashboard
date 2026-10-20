/**
 * Status / prepare behaviours (E3, E12 status side, X1, X2, 4.5 log lines) on the service with the REAL
 * `provisionWeb` over a `WORDCRAFT_WEB_DIR` override (offline) or a faked one for failure/timing cases.
 * See change: edit-office-in-pane-with-craft-web (tasks 4.3, 4.5).
 */
import fs from "node:fs";
import path from "node:path";
import { ProvisionWebError, type ProvisionWebFn, provisionWeb } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { profileFor } from "../../shared/app-profiles.js";
import type { CraftWebConfig } from "../config.js";
import { createPostInstall, profileHash } from "../post-install.js";
import { type CraftWebService, createCraftWebService } from "../service.js";
import { cleanupTmp, recordingLogger, tmp, writeShim, writeTrunkBuild } from "./helpers.js";

afterEach(cleanupTmp);

interface Rig {
  service: CraftWebService;
  dataDir: string;
  config: CraftWebConfig;
  logger: ReturnType<typeof recordingLogger>;
  setShim: (v: number) => void;
}

function rig(
  o: {
    config?: CraftWebConfig;
    mounted?: boolean;
    provision?: ProvisionWebFn;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    latestWebVersion?: (app: string, opts: { root?: string }) => Promise<string | undefined>;
  } = {},
): Rig {
  const dataDir = tmp("craft-web-data-");
  const shimDir = tmp("craft-web-shim-");
  const shimFile = writeShim(shimDir, 1);
  let shim = 1;
  const config = o.config ?? {};
  const logger = recordingLogger();
  const service = createCraftWebService({
    dataDir,
    logger,
    getConfig: () => config,
    provisionWeb: o.provision ?? provisionWeb,
    isMounted: () => o.mounted !== false,
    provisionDeps: { env: o.env ?? { CRAFT_HOME: dataDir }, ...(o.fetch ? { fetch: o.fetch } : {}) },
    postInstall: createPostInstall(shimFile),
    shimVersion: () => shim,
    ...(o.latestWebVersion ? { latestWebVersion: o.latestWebVersion } : {}),
  });
  return { service, dataDir, config, logger, setShim: (v) => void (shim = v) };
}

const overrideEnv = (dataDir: string): NodeJS.ProcessEnv => ({ CRAFT_HOME: dataDir, WORDCRAFT_WEB_DIR: writeTrunkBuild(path.join(tmp(), "override")) });

describe("status (E3)", () => {
  it("restart-pending → restart-required; prepare is refused", async () => {
    const r = rig({ mounted: false });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "restart-required", reason: "restart-required" });
    const p = await r.service.prepare("wordcraft");
    expect(p).toMatchObject({ ok: false, httpStatus: 409, reason: "restart-required" });
  });

  it("disabled app → disabled; prepare 403; nothing provisioned", async () => {
    const provision = vi.fn();
    const r = rig({ config: { apps: { wordcraft: { enabled: false } } }, provision: provision as never });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "disabled", enabled: false });
    expect(await r.service.prepare("wordcraft")).toMatchObject({ ok: false, httpStatus: 403, reason: "disabled" });
    expect(provision).not.toHaveBeenCalled();
  });

  it("enabled and unprepared → not-prepared with the approximate download size and the pinned version", () => {
    const r = rig();
    const s = r.service.status();
    expect(s.shimVersion).toBe(1);
    expect(s.apps.wordcraft).toMatchObject({ status: "not-prepared", enabled: true, version: "0.8.0", preparing: false, cspViolations: 0 });
    expect(s.apps.wordcraft.sizeGzip).toBeGreaterThan(1_000_000);
  });

  it("unknown app → 404", async () => {
    expect(await rig().service.prepare("nope")).toMatchObject({ ok: false, httpStatus: 404, reason: "unknown-app" });
  });

  it("enabled live: a prepare after re-enabling is accepted", async () => {
    const r = rig({ config: { apps: { wordcraft: { enabled: false } } }, env: overrideEnv(tmp()) });
    expect((await r.service.prepare("wordcraft")).ok).toBe(false);
    r.config.apps = { wordcraft: { enabled: true } };
    expect((await r.service.prepare("wordcraft")).ok).toBe(true);
  });
});

describe("prepare + shim version (E12 status side)", () => {
  it("prepares from an override dir, reports ok, then shim-outdated after a shim bump, and re-prepare swaps current leaving the old tree", async () => {
    const dataDir = tmp("craft-web-data-");
    const r = rig({ env: overrideEnv(dataDir) });
    // the rig's own dataDir differs from the env CRAFT_HOME; provisioning root is the service dataDir
    const first = await r.service.prepare("wordcraft");
    expect(first).toMatchObject({ ok: true, app: "wordcraft", cacheHit: false, shimVersion: 1 });
    const st = r.service.status().apps.wordcraft;
    expect(st).toMatchObject({ status: "ok", shimVersion: 1 });
    expect(st.version).toMatch(/^dir-[0-9a-f]{12}$/);
    expect(st.sizeGzip).toBe((first as { sizeGzip: number }).sizeGzip);

    r.setShim(2);
    // WordCraft's minShimVersion is 1: the v1 tree keeps loading, a re-prepare is offered as an update (D8)
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", shimVersion: 1, shimUpdate: true });
    // prepare installs the new tree
    const root = path.join(r.dataDir, "wordcraft-web");
    const oldTree = fs.readdirSync(root).find((n) => n.endsWith("-s1")) as string;
    const second = await r.service.prepare("wordcraft");
    expect(second).toMatchObject({ ok: true, shimVersion: 2 });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", shimVersion: 2 });
    expect(r.service.status().apps.wordcraft.shimUpdate).toBeUndefined();
    expect(fs.readdirSync(root).sort()).toEqual([oldTree, oldTree.replace(/-s1$/, "-s2"), "current"].sort());
    expect(fs.realpathSync(path.join(root, "current"))).toBe(fs.realpathSync(path.join(root, oldTree.replace(/-s1$/, "-s2"))));
  });

  it("a registry pin bump makes a prepared build not-prepared again", async () => {
    const r = rig({ env: { CRAFT_HOME: "x" } });
    const root = path.join(r.dataDir, "wordcraft-web");
    fs.mkdirSync(path.join(root, "0.7.0-s1"), { recursive: true });
    fs.writeFileSync(path.join(root, "0.7.0-s1", "craft-build.json"), JSON.stringify({ app: "wordcraft", version: "0.7.0", shimVersion: 1, sizeGzip: 5 }));
    fs.symlinkSync("0.7.0-s1", path.join(root, "current"));
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "not-prepared", version: "0.8.0" });
  });
});

describe("E6 shim compatibility (D8)", () => {
  /** A prepared `<version>-s<shim>` WordCraft tree (`current` → it) with an optional profile hash. */
  function preparedTree(dataDir: string, shim: number, profile?: string): void {
    const root = path.join(dataDir, "wordcraft-web");
    const key = `0.8.0-s${shim}`;
    fs.mkdirSync(path.join(root, key), { recursive: true });
    const info = { app: "wordcraft", version: "0.8.0", shimVersion: shim, sizeGzip: 5, ...(profile ? { profileHash: profile } : {}) };
    fs.writeFileSync(path.join(root, key, "craft-build.json"), JSON.stringify(info));
    fs.rmSync(path.join(root, "current"), { force: true });
    fs.symlinkSync(key, path.join(root, "current"));
  }
  const current = profileHash(profileFor("wordcraft") as NonNullable<ReturnType<typeof profileFor>>);

  it("WordCraft v1 build (no profile line) under shim 2 → ok + update offered", () => {
    const r = rig({ env: { CRAFT_HOME: "x" } });
    r.setShim(2);
    preparedTree(r.dataDir, 1);
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", shimVersion: 1, shimUpdate: true });
  });

  it("v2 build with a stale profile hash → shim-outdated; current hash → ok", () => {
    const r = rig({ env: { CRAFT_HOME: "x" } });
    r.setShim(2);
    preparedTree(r.dataDir, 2, "0000000000");
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "shim-outdated", shimVersion: 2 });
    preparedTree(r.dataDir, 2, current);
    const ok = r.service.status().apps.wordcraft;
    expect(ok).toMatchObject({ status: "ok", shimVersion: 2 });
    expect(ok.shimUpdate).toBeUndefined();
  });

  it("a build newer than the plugin's shim → shim-outdated", () => {
    const r = rig({ env: { CRAFT_HOME: "x" } });
    r.setShim(2);
    preparedTree(r.dataDir, 3, current);
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "shim-outdated" });
  });

  it("profile change → shim-outdated → prepare re-runs post-install (no cache reuse) → ok", async () => {
    const dataDir = tmp("craft-web-data-");
    const r = rig({ env: overrideEnv(dataDir) });
    r.setShim(2);
    expect(await r.service.prepare("wordcraft")).toMatchObject({ ok: true, shimVersion: 2 });
    const root = path.join(r.dataDir, "wordcraft-web");
    const key = fs.readdirSync(root).find((n) => n.endsWith("-s2")) as string;
    const buildFile = path.join(root, key, "craft-build.json");
    fs.writeFileSync(buildFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(buildFile, "utf8")), profileHash: "0000000000" }));
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "shim-outdated" });
    expect(await r.service.prepare("wordcraft")).toMatchObject({ ok: true, cacheHit: false });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", shimVersion: 2 });
  });
});

describe("prepare failures (X1, X2) and single-flight", () => {
  it("X2: offline → reason offline, status offline, the failure is logged, a later success clears it", async () => {
    const rejecting = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const r = rig({ fetch: rejecting as never });
    const out = await r.service.prepare("wordcraft");
    expect(out).toMatchObject({ ok: false, httpStatus: 503, reason: "offline" });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "offline", reason: "offline" });
    expect(r.logger.warn.mock.calls.some((c) => /prepare wordcraft failed reason=offline/.test(String(c[0])))).toBe(true);
  });

  it.each([
    ["checksum-mismatch", 502],
    ["extract-failed", 502],
    ["launcher-source", 409],
  ] as const)("X1: %s maps to its reason and HTTP status", async (code, httpStatus) => {
    const provision = vi.fn().mockRejectedValue(new ProvisionWebError(code, `boom ${code}`));
    const r = rig({ provision: provision as never });
    expect(await r.service.prepare("wordcraft")).toMatchObject({ ok: false, httpStatus, reason: code });
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: code });
  });

  it("an unexpected error is prepare-failed (502) and the status stays not-prepared", async () => {
    const r = rig({ provision: vi.fn().mockRejectedValue(new Error("ENOSPC")) as never });
    expect(await r.service.prepare("wordcraft")).toMatchObject({ ok: false, httpStatus: 502, reason: "prepare-failed" });
    expect(r.service.status().apps.wordcraft.status).toBe("not-prepared");
  });

  it("concurrent prepares for one app share a single provisioning run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const provision = vi.fn(async () => {
      await gate;
      return { app: "wordcraft", version: "0.8.0", source: "registry", asset: "x", cacheHit: false, dir: tmp(), current: "c", shimVersion: 1, durationMs: 1 };
    });
    const r = rig({ provision: provision as never });
    const a = r.service.prepare("wordcraft");
    const b = r.service.prepare("wordcraft");
    expect(r.service.status().apps.wordcraft.preparing).toBe(true);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(provision).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(r.service.status().apps.wordcraft.preparing).toBe(false);
  });

  it("logs the prepare outcome with duration and bytes", async () => {
    const dataDir = tmp();
    const r = rig({ env: overrideEnv(dataDir) });
    await r.service.prepare("wordcraft");
    const line = r.logger.info.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith("prepare wordcraft ok"));
    expect(line).toMatch(/version=dir-[0-9a-f]{12} source=env-dir cacheHit=false bytes=\d+ durationMs=\d+/);
  });
});

// See change: track-latest-craft-web-version (D3).
describe("version channel", () => {
  /** A prepared `<version>-s1` tree with `current` pointing at it. */
  function prepared(dataDir: string, version: string): void {
    const root = path.join(dataDir, "wordcraft-web");
    fs.mkdirSync(path.join(root, `${version}-s1`), { recursive: true });
    fs.writeFileSync(path.join(root, `${version}-s1`, "craft-build.json"), JSON.stringify({ app: "wordcraft", version, shimVersion: 1, sizeGzip: 5 }));
    fs.rmSync(path.join(root, "current"), { force: true });
    fs.symlinkSync(`${version}-s1`, path.join(root, "current"));
  }
  const knownLatest = (dataDir: string, tag: string) =>
    fs.writeFileSync(path.join(dataDir, "wordcraft-web", "latest.json"), JSON.stringify({ tag, checkedAt: Date.now() }));
  const latestCfg: CraftWebConfig = { apps: { wordcraft: { version: "latest" } } };

  it("pinned (default): no latest lookup, channel reported, prepare passes channel pinned", async () => {
    const latest = vi.fn(async () => "0.9.0");
    const provision = vi.fn().mockRejectedValue(new Error("stop"));
    const r = rig({ latestWebVersion: latest, provision: provision as never });
    expect(r.service.status().apps.wordcraft).toMatchObject({ channel: "pinned", version: "0.8.0" });
    await r.service.prepare("wordcraft");
    expect(latest).not.toHaveBeenCalled();
    expect(provision.mock.calls[0][1]).toMatchObject({ channel: "pinned" });
  });

  it("latest: status refreshes the metadata in the background and prepare passes channel latest", async () => {
    const latest = vi.fn(async (_app: string, _opts: { root?: string }) => "0.9.0");
    const provision = vi.fn().mockRejectedValue(new Error("stop"));
    const r = rig({ config: latestCfg, latestWebVersion: latest, provision: provision as never });
    expect(r.service.status().apps.wordcraft).toMatchObject({ channel: "latest", status: "not-prepared" });
    r.service.status();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest.mock.calls[0][1]).toMatchObject({ root: r.dataDir });
    await r.service.prepare("wordcraft");
    expect(provision.mock.calls[0][1]).toMatchObject({ channel: "latest" });
  });

  it("WORDCRAFT_WEB_VERSION=latest selects the latest channel", () => {
    const r = rig({ env: { CRAFT_HOME: "x", WORDCRAFT_WEB_VERSION: "latest" }, latestWebVersion: async () => undefined });
    expect(r.service.status().apps.wordcraft.channel).toBe("latest");
  });

  it("latest: a known newer version makes the prepared build not-prepared with that version", () => {
    const r = rig({ config: latestCfg, latestWebVersion: async () => "0.9.0" });
    prepared(r.dataDir, "0.8.0");
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", version: "0.8.0" });
    knownLatest(r.dataDir, "v0.9.0");
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "not-prepared", version: "0.9.0" });
  });

  it("latest: a failed update keeps the prepared build available", async () => {
    const provision = vi.fn().mockRejectedValue(new ProvisionWebError("extract-failed", "bad bootstrap"));
    const r = rig({ config: latestCfg, latestWebVersion: async () => "0.9.0", provision: provision as never });
    prepared(r.dataDir, "0.8.0");
    knownLatest(r.dataDir, "v0.9.0");
    expect((await r.service.prepare("wordcraft")).ok).toBe(false);
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", version: "0.8.0" });
  });

  it("status carries installedVersion (prepared build) and latestVersion (latest channel only)", () => {
    const r = rig({ config: latestCfg, latestWebVersion: async () => "0.9.0" });
    prepared(r.dataDir, "0.8.0");
    knownLatest(r.dataDir, "v0.9.0");
    expect(r.service.status().apps.wordcraft).toMatchObject({ version: "0.9.0", installedVersion: "0.8.0", latestVersion: "0.9.0" });
    r.config.apps = {};
    const pinned = r.service.status().apps.wordcraft;
    expect(pinned).toMatchObject({ installedVersion: "0.8.0" });
    expect(pinned.latestVersion).toBeUndefined();
  });

  it("pinned ignores a cached latest version", () => {
    const r = rig({ latestWebVersion: async () => "0.9.0" });
    prepared(r.dataDir, "0.8.0");
    knownLatest(r.dataDir, "v0.9.0");
    expect(r.service.status().apps.wordcraft).toMatchObject({ status: "ok", version: "0.8.0", channel: "pinned" });
  });
});

describe("csp reports (4.5)", () => {
  it("counts every accepted report, logs it, and rate-limits at 30 per minute per app", () => {
    let t = 1_000;
    const dataDir = tmp();
    const logger = recordingLogger();
    const service = createCraftWebService({
      dataDir,
      logger,
      getConfig: () => ({}),
      provisionWeb,
      isMounted: () => true,
      shimVersion: () => 1,
      postInstall: () => {},
      now: () => t,
    });
    for (let i = 0; i < 30; i++) expect(service.reportCsp("wordcraft", "connect-src")).toBe(true);
    expect(service.reportCsp("wordcraft", "connect-src")).toBe(false);
    expect(service.reportCsp("wordcraft", "connect-src")).toBe(false);
    expect(service.status().apps.wordcraft.cspViolations).toBe(30);
    expect(logger.warn.mock.calls.filter((c) => /rate limit reached/.test(String(c[0])))).toHaveLength(1);
    t += 61_000;
    expect(service.reportCsp("wordcraft", "script-src")).toBe(true);
    expect(service.status().apps.wordcraft.cspViolations).toBe(31);
    expect(logger.warn.mock.calls.some((c) => /csp-report wordcraft directive=script-src/.test(String(c[0])))).toBe(true);
  });
});
