/**
 * Hub side of B22: a credentialed origin (an OLD bridge sends the raw remote)
 * is stripped on receipt; the repoKey is derived ONCE and matches the clean form;
 * nothing secret is stored or persisted.
 * See change: harden-bridge-inbound-and-discovery (test-plan BE19, BE20).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const normalizeSpy = vi.hoisted(() => vi.fn());
vi.mock("@blackbelt-technology/pi-dashboard-shared/vault-project-key.js", async (orig) => {
  const real = await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/vault-project-key.js")>();
  return { ...real, normalizeOrigin: (raw: string) => { normalizeSpy(raw); return real.normalizeOrigin(raw); } };
});

import { createVaultDeliveryHub } from "../vault/vault-delivery-hub.js";
import { createVaultProjects } from "../vault/vault-projects.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

let dir: string;
let store: VaultStore;
const sent: VaultSnapshotMessage[] = [];

const req = (sessionId: string, origin: string | undefined): VaultSyncRequestMessage => ({
  type: "vault_sync_request", sessionId, cwd: "/work/p", tracked: [], reason: "connect", ...(origin ? { origin } : {}),
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-hub-cred-"));
  store = createVaultStore({ codec: testVaultCodec(), path: path.join(dir, "vault.json") });
  sent.length = 0;
  normalizeSpy.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const mkHub = (record: (p: unknown) => Promise<void>) =>
  createVaultDeliveryHub({
    store,
    getOrigin: () => ({ local: true }),
    send: (_id, msg) => { sent.push(msg as VaultSnapshotMessage); return true; },
    isDeliveryEnabled: () => true,
    getGraceHours: () => 24,
    getChannel: () => ({ admission: "unix", provenTls: false, ticketTls: false }),
    getDeviceTrust: () => "eligible",
    isTlsBridgesLive: () => true,
    isSessionConnected: () => true,
    pushDelayMs: 10,
    projects: { record } as never,
  });

describe("BE19: one repoKey whatever the userinfo", () => {
  it("credentialed origins derive the same repoKey as the grant's clean form; normalizeOrigin runs once per sync", async () => {
    const keys: Array<string | undefined> = [];
    const hub = mkHub(async (p) => { keys.push((p as { repoKey?: string }).repoKey); });
    const origins = [
      "https://github.com/acme/app.git",
      "https://user:token@github.com/acme/app.git",
      "ssh://git:secret@github.com/acme/app",
      "ssh://git@github.com/acme/app",
      "git@github.com:acme/app.git",
    ];
    for (const [i, o] of origins.entries()) {
      normalizeSpy.mockClear();
      await hub.handleSyncRequest(`s${i}`, req(`s${i}`, o));
      expect(normalizeSpy, o).toHaveBeenCalledTimes(1);
      // the argument handed to normalizeOrigin is already credential-free
      expect(String(normalizeSpy.mock.calls[0][0])).not.toMatch(/token|secret/);
    }
    await vi.waitFor(() => expect(keys).toHaveLength(origins.length));
    expect(new Set(keys)).toEqual(new Set(["github.com/acme/app"]));
  });
});

describe("BE20: an old bridge's credentialed payload is stripped on receipt", () => {
  it("stored origin and persisted project file hold no secret; repoKey equals the clean form", async () => {
    const file = path.join(dir, "projects.json");
    const projects = createVaultProjects({ file });
    const hub = createVaultDeliveryHub({
      store,
      getOrigin: () => ({ local: true }),
      send: (_id, msg) => { sent.push(msg as VaultSnapshotMessage); return true; },
      isDeliveryEnabled: () => true,
      getGraceHours: () => 24,
      getChannel: () => ({ admission: "unix", provenTls: false, ticketTls: false }),
      getDeviceTrust: () => "eligible",
      isTlsBridgesLive: () => true,
      isSessionConnected: () => true,
      pushDelayMs: 10,
      projects,
    });
    const hostile = [
      "https://u:p@github.com/o/r",
      "ssh://git:secret@github.com/o/r",
      "https://u:p@[::1]:8443/o/r",
    ];
    for (const [i, o] of hostile.entries()) await hub.handleSyncRequest(`x${i}`, req(`x${i}`, o));
    await new Promise((r) => setTimeout(r, 50));
    const persisted = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    for (const s of ["u:p", "secret", ":p@"]) expect(persisted).not.toContain(s);
    expect(persisted).toContain("github.com/o/r");
    const open = JSON.stringify(hub.listOpenProjects());
    for (const s of ["secret", "u:p"]) expect(open).not.toContain(s);
  });

  it("an unparseable credentialed origin is treated as no origin", async () => {
    const keys: Array<string | undefined> = [];
    const hub = mkHub(async (p) => { keys.push((p as { repoKey?: string }).repoKey); });
    await hub.handleSyncRequest("z", req("z", "https://user:pass@/o/r"));
    await vi.waitFor(() => expect(keys).toHaveLength(1));
    expect(keys[0]).toBeUndefined();
  });
});
