/**
 * Hub side of the project picker: `listOpenProjects()` outcomes, recording of
 * resolved projects (throttled, failure-isolated) and the fan-out budget.
 * See change: retro-ux-credential-vault (test-plan E7, P1, X8).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { normalizeOrigin } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { createVaultDeliveryHub, type VaultDeliveryHubDeps } from "../vault/vault-delivery-hub.js";
import { createVaultProjects } from "../vault/vault-projects.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

let dir: string;
let store: VaultStore;
let sent: Array<{ sessionId: string; msg: VaultSnapshotMessage }>;
let enabled: boolean;
let tls: boolean;
let origins: Record<string, { local: boolean; deviceId?: string }>;
const disconnected = new Set<string>();

const mkHub = (extra: Partial<VaultDeliveryHubDeps> = {}) =>
  createVaultDeliveryHub({
    store,
    getOrigin: (id) => origins[id],
    send: (sessionId, msg) => { sent.push({ sessionId, msg: msg as VaultSnapshotMessage }); return true; },
    isDeliveryEnabled: () => enabled,
    getGraceHours: () => 24,
    // `tls` stands for "this remote device's bridge is on a proven TLS channel" (prove-vault-bridge-tls).
    getChannel: (id) =>
      origins[id]?.local
        ? { admission: "unix", provenTls: false, ticketTls: false }
        : origins[id]?.deviceId && origins[id]?.deviceId !== UNATTRIBUTED_REMOTE
          ? { admission: "device-ticket", provenTls: tls, ticketTls: tls, ticketDeviceId: origins[id]?.deviceId }
          : { admission: "local-ticket", provenTls: tls, ticketTls: tls },
    getDeviceTrust: () => "eligible",
    isTlsBridgesLive: () => true,
    isSessionConnected: (id) => !disconnected.has(id),
    pushDelayMs: 10,
    ...extra,
  });

const req = (sessionId: string, over: Partial<VaultSyncRequestMessage> = {}): VaultSyncRequestMessage => ({
  type: "vault_sync_request", sessionId, cwd: "/work/p", tracked: [], reason: "connect", certValidation: "enforced", ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-hub-projects-"));
  store = createVaultStore({ codec: testVaultCodec(), path: path.join(dir, "vault.json") });
  sent = []; enabled = true; tls = false; disconnected.clear();
  origins = {};
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("E7 listOpenProjects", () => {
  it("groups delivered sessions, lists refused ones by cwd, leaves out the rest", async () => {
    const hub = mkHub();
    const origin = "git@github.com:robson/deck3d.git";
    // Two delivered sessions in one project.
    for (const id of ["a1", "a2"]) origins[id] = { local: true };
    await hub.handleSyncRequest("a1", req("a1", { cwd: "/work/a", origin }));
    await hub.handleSyncRequest("a2", req("a2", { cwd: "/work/a", origin }));
    // untrusted: a remote connection with no attributable device (reports an origin that must not surface).
    origins.u = { local: false, deviceId: UNATTRIBUTED_REMOTE };
    tls = true;
    expect(await hub.handleSyncRequest("u", req("u", { cwd: "/work/u", origin }))).toBe("untrusted");
    // transport-insecure: paired device over plain ws.
    origins.t = { local: false, deviceId: "dev-1" };
    tls = false;
    expect(await hub.handleSyncRequest("t", req("t", { cwd: "/work/t", origin }))).toBe("transport-insecure");
    // no-project: no directory.
    origins.n = { local: true };
    expect(await hub.handleSyncRequest("n", req("n", { cwd: "" }))).toBe("no-project");
    // disabled.
    origins.d = { local: true };
    enabled = false;
    expect(await hub.handleSyncRequest("d", req("d", { cwd: "/work/d" }))).toBe("disabled");
    // vault-unavailable (corrupt file).
    enabled = true;
    fs.writeFileSync(store.filePath, "{oops");
    origins.v = { local: true };
    expect(await hub.handleSyncRequest("v", req("v", { cwd: "/work/v" }))).toBe("vault-unavailable");
    // delivered, then disconnected.
    fs.rmSync(store.filePath);
    origins.x = { local: true };
    expect(await hub.handleSyncRequest("x", req("x", { cwd: "/work/x" }))).toBe("delivered");
    disconnected.add("x");

    const open = hub.listOpenProjects();
    const byDir = (a: { dir: string }, b: { dir: string }) => a.dir.localeCompare(b.dir);
    expect([...open].sort(byDir)).toEqual([
      { kind: "repo", deviceId: "hub", dir: "/work/a", repoKey: normalizeOrigin(origin), sessions: 2 },
      { kind: "dir", dir: "/work/t", sessions: 1, blocked: "transport-insecure" },
      { kind: "dir", dir: "/work/u", sessions: 1, blocked: "untrusted" },
    ]);
    for (const p of open.filter((x) => x.blocked)) {
      expect(p).not.toHaveProperty("repoKey");
      expect(p).not.toHaveProperty("deviceId");
    }
  });

  it("a folder-only session is offered as kind dir with its device", async () => {
    const hub = mkHub();
    origins.s = { local: true };
    await hub.handleSyncRequest("s", req("s", { cwd: "/work/solo" }));
    expect(hub.listOpenProjects()).toEqual([{ kind: "dir", deviceId: "hub", dir: "/work/solo", sessions: 1 }]);
  });

  it("truncates a refused session's cwd to 4096 characters", async () => {
    const hub = mkHub();
    origins.u = { local: false, deviceId: UNATTRIBUTED_REMOTE };
    tls = true;
    await hub.handleSyncRequest("u", req("u", { cwd: "/".padEnd(5000, "x") }));
    expect(hub.listOpenProjects()[0].dir).toHaveLength(4096);
  });
});

describe("recording", () => {
  it("X8: a failing project record never affects delivery and never logs the path", async () => {
    const err = new Error("open /secret/path failed");
    err.name = "FsError";
    const record = vi.fn().mockRejectedValue(err);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hub = mkHub({ projects: { record } });
    origins.s = { local: true };
    expect(await hub.handleSyncRequest("s", req("s", { cwd: "/work/p" }))).toBe("delivered");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "ok", outcome: "delivered" });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(record).toHaveBeenCalledWith({ deviceId: "hub", dir: "/work/p", repoKey: undefined });
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines).toContain("[vault] project record failed: FsError");
    expect(lines.join("\n")).not.toContain("/secret/path");
  });

  it("only a trusted, resolved project is recorded", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const hub = mkHub({ projects: { record } });
    origins.u = { local: false, deviceId: UNATTRIBUTED_REMOTE };
    origins.n = { local: true };
    tls = true;
    await hub.handleSyncRequest("u", req("u"));
    await hub.handleSyncRequest("n", req("n", { cwd: "" }));
    expect(record).not.toHaveBeenCalled();
  });
});

describe("P1 fan-out budget", () => {
  it("200 sessions across 200 projects: no repeat writes, every push sends 200 snapshots in < 5 s", async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0, 0);
    const file = path.join(dir, "vault-projects.json");
    const projects = createVaultProjects({ file, now: () => clock });
    const rename = vi.spyOn(fs, "renameSync");
    tls = true;
    const hub = mkHub({ projects, now: () => clock });
    // Four devices x 50 projects: the per-device cap (100) never bites.
    const ids = Array.from({ length: 200 }, (_, i) => `s${i}`);
    for (const [i, id] of ids.entries()) origins[id] = { local: false, deviceId: `dev-${i % 4}` };
    for (const [i, id] of ids.entries()) await hub.handleSyncRequest(id, req(id, { cwd: `/work/p${i}` }));

    await vi.waitFor(() => expect(projects.list()).toHaveLength(200), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    const afterFirst = rename.mock.calls.length;
    expect(afterFirst).toBeLessThanOrEqual(200);

    const push = async () => {
      const before = sent.length;
      const t = performance.now();
      await hub.pushNow();
      expect(performance.now() - t).toBeLessThan(5_000);
      expect(sent.length - before).toBe(200);
    };
    await push();
    clock += 10 * 60 * 1000;
    await push();
    await new Promise((r) => setTimeout(r, 50));
    expect(rename.mock.calls.length).toBe(afterFirst);
    hub.dispose();
  });
});
