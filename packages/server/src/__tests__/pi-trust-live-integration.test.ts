/**
 * Live pi-trust path end to end, in one process: a REAL dashboard server and the
 * bridge's real decision + HTTP transport, over a temp HOME.
 *
 * Covers test-plan #X8 (local live path, restart) and #X9 (remote path over
 * loopback-as-remote: device bearer, content digest). Harness after
 * `pi-trust-mirror-service.test.ts` (temp-HOME setup) and `test-server.ts`.
 * See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { readPiTrustMirrorSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import { trustResourceManifest } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-resource-digest.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideBridgeProjectTrust, type ProjectTrustDeps } from "../../../extension/src/project-trust.js";
import { createHttpLiveQuery } from "../../../extension/src/project-trust-live.js";
import { __resetSessionTrust, recordTrust } from "../git-worktree/worktree-init-trust.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const hook = { gate: "true", run: { type: "script" as const, command: "echo" } };
let workdir: string;
let handle: TestServerHandle | undefined;

/**
 * A directory the default deny rules accept: the OS temp dir and the (fake) HOME
 * are both forbidden mirror locations, so the project lives under the repo's
 * (untracked, hoisted) `node_modules/.cache`.
 */
function allowedRoot(): string {
  const base = path.join(process.cwd(), "node_modules", ".cache");
  fs.mkdirSync(base, { recursive: true });
  return fs.realpathSync(fs.mkdtempSync(path.join(base, "pi-trust-live-int-")));
}

function repo(name: string, over: Record<string, string> = {}): string {
  const dir = path.join(workdir, name);
  fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
  fs.writeFileSync(path.join(dir, ".pi", "mcp.json"), over.mcp ?? '{"servers":{}}');
  return dir;
}

function bridgeDeps(over: Partial<ProjectTrustDeps> = {}): Partial<ProjectTrustDeps> {
  return {
    home: process.env.HOME as string,
    log: () => {},
    ...over,
  };
}

const spawnedHeadless = (eventCwd: string) => ({
  dashboardSpawned: true,
  isHeadless: true,
  eventCwd,
  activationCwd: "/nowhere/else",
});

beforeEach(() => {
  workdir = allowedRoot();
  __resetSessionTrust();
});
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  __resetSessionTrust();
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("#X8 local live path", () => {
  it("session trust reaches a bridge decision; a restart drops it with no query", async () => {
    const r = repo("r");
    const wt = path.join(r, "wt");
    fs.mkdirSync(wt);
    handle = await createTestServer();
    const live = createHttpLiveQuery({ endpoint: () => `ws://127.0.0.1:${handle!.piPort}`, httpPort: () => handle!.httpPort });
    const query = vi.fn(live);

    recordTrust(r, hookDefHash(hook), "session");
    const snapshotFile = path.join(getDashboardConfigDir(), "pi-trust-mirror.json");
    expect(readPiTrustMirrorSnapshot(snapshotFile)?.liveCount).toBe(1);
    expect(fs.readFileSync(snapshotFile, "utf8")).not.toContain(r);

    const first = await decideBridgeProjectTrust(spawnedHeadless(wt), bridgeDeps({ liveQuery: query }));
    expect(first).toMatchObject({ trusted: "yes", via: "live" });
    expect(query).toHaveBeenCalledTimes(1);

    // simulated restart: process memory is gone, the new server boots with liveCount 0
    await handle.stop();
    __resetSessionTrust();
    handle = await createTestServer();
    expect(readPiTrustMirrorSnapshot(snapshotFile)?.liveCount).toBe(0);
    query.mockClear();
    const second = await decideBridgeProjectTrust(spawnedHeadless(wt), bridgeDeps({ liveQuery: query }));
    expect(second.trusted).toBe("undecided");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("#X9 remote path over loopback-as-remote", () => {
  it("a paired-device bridge is trusted by content digest, and an edited .pi/mcp.json on its copy breaks it", async () => {
    const r = repo("r");
    const copy = repo("copy-of-r"); // the bridge machine's copy: same bytes, other path
    // Pair a device BEFORE the server boots (the registry reads its file at start).
    const registry = new PairedDeviceRegistry(path.join(getDashboardConfigDir(), "paired-devices.json"));
    const { token } = registry.add("remote-bridge", "manual", "operate");
    handle = await createTestServer();
    recordTrust(r, hookDefHash(hook), "session");

    const deps = (): Partial<ProjectTrustDeps> =>
      bridgeDeps({
        isRemoteBridge: () => true,
        liveQuery: createHttpLiveQuery({
          endpoint: () => `ws://127.0.0.1:${handle!.httpPort}`,
          env: { PI_DASHBOARD_TOKEN: token, PI_DASHBOARD_PORT: String(handle!.httpPort) },
        }),
        // the bridge hashes ITS copy; the digest still binds the cwd key it was asked about
        manifest: (_cwd, o) => trustResourceManifest(copy, o),
        // liveCount is irrelevant for a remote bridge: it always asks
        readSnapshot: () => ({ version: 1, generation: 1, entries: [], liveCount: 0 }),
      });

    expect(await decideBridgeProjectTrust(spawnedHeadless(r), deps())).toMatchObject({ trusted: "yes", via: "live" });

    fs.writeFileSync(path.join(copy, ".pi", "mcp.json"), '{"servers":{"evil":{"command":"sh"}}}');
    expect(await decideBridgeProjectTrust(spawnedHeadless(r), deps())).toMatchObject({
      trusted: "undecided",
      reason: "identity-mismatch",
    });
  });

  it("without a device token the server refuses (live-refused)", async () => {
    const r = repo("r");
    handle = await createTestServer();
    recordTrust(r, hookDefHash(hook), "session");
    const out = await decideBridgeProjectTrust(
      spawnedHeadless(r),
      bridgeDeps({
        isRemoteBridge: () => true,
        liveQuery: createHttpLiveQuery({ endpoint: () => `ws://127.0.0.1:${handle!.httpPort}`, env: { PI_DASHBOARD_TOKEN: "not-a-paired-token", PI_DASHBOARD_PORT: String(handle!.httpPort) } }),
        readSnapshot: () => ({ version: 1, generation: 1, entries: [], liveCount: 0 }),
      }),
    );
    expect(out).toMatchObject({ trusted: "undecided", reason: "live-refused" });
  });
});
