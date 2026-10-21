/**
 * The trust-list writer / reader (`auth/plugin-trust-store.ts`) and its isolation from the generic
 * config write — test-plan #E79 (writer parts) and #E80.
 *
 * See change: decouple-plugins-from-core (task 6.5, design D12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isServerTrusted } from "../auth/plugin-server-trust.js";
import {
  grantClientTrust,
  grantServerTrust,
  readTrustedPlugins,
  revokeTrust,
  updateTrustedPlugins,
} from "../auth/plugin-trust-store.js";
import { writeConfigPartial } from "../config-api.js";

let testDir: string;
let configFile: string;
let origHome: string;
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const raw = () => JSON.parse(fs.readFileSync(configFile, "utf-8"));

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plugin-trust-"));
  fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
  configFile = path.join(testDir, ".pi", "dashboard", "config.json");
  origHome = process.env.HOME!;
  process.env.HOME = testDir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("E79 trust write preserves every other auth key", () => {
  it("keeps capabilityRoutePlugins, providers, bypassHosts and unknown keys byte-identical", () => {
    const auth = {
      secret: "s3cret",
      providers: { github: { clientId: "id", clientSecret: "cs" } },
      bypassHosts: ["10.0.0.0/8"],
      capabilityRoutePlugins: ["wall"],
      futureKey: { nested: [1, 2, 3] },
    };
    fs.writeFileSync(configFile, JSON.stringify({ port: 8123, auth, other: { keep: true } }));
    const { before, after } = grantClientTrust("ext", SHA);
    expect(before).toEqual([]);
    expect(after).toEqual([{ id: "ext", clientSha256: SHA }]);
    const stored = raw();
    expect(stored.port).toBe(8123);
    expect(stored.other).toEqual({ keep: true });
    const { trustedPlugins, ...otherAuth } = stored.auth;
    expect(JSON.stringify(otherAuth)).toBe(JSON.stringify(auth));
    expect(trustedPlugins).toEqual([{ id: "ext", clientSha256: SHA }]);
    expect(loadConfig().auth?.capabilityRoutePlugins).toEqual(["wall"]);
  });

  it("re-pinning replaces the pin and keeps a server grant; server grant keeps the pin", () => {
    grantServerTrust("ext");
    grantClientTrust("ext", SHA);
    grantClientTrust("ext", SHA2);
    expect(readTrustedPlugins()).toEqual([{ id: "ext", clientSha256: SHA2, server: true }]);
  });

  it("revoke removes the entry; the last revoke drops an auth block it created", () => {
    grantClientTrust("ext", SHA);
    grantClientTrust("other", SHA2);
    revokeTrust("ext");
    expect(readTrustedPlugins()).toEqual([{ id: "other", clientSha256: SHA2 }]);
    revokeTrust("other");
    expect(raw().auth).toBeUndefined();
  });

  it("revoke keeps the other auth keys when the list empties", () => {
    fs.writeFileSync(configFile, JSON.stringify({ auth: { capabilityRoutePlugins: ["wall"], trustedPlugins: [{ id: "ext", clientSha256: SHA }] } }));
    revokeTrust("ext");
    expect(raw().auth).toEqual({ capabilityRoutePlugins: ["wall"] });
  });

  it("a corrupt config file is replaced by a fresh object holding only the trust list", () => {
    fs.writeFileSync(configFile, "{not json");
    updateTrustedPlugins((c) => [...c, { id: "ext", server: true }]);
    expect(raw()).toEqual({ auth: { trustedPlugins: [{ id: "ext", server: true }] } });
  });

  it("a server:true entry makes isServerTrusted true for that id only", () => {
    grantServerTrust("ext");
    expect(isServerTrusted({ manifest: { id: "ext" } })).toBe(true);
    expect(isServerTrusted({ manifest: { id: "nope" } })).toBe(false);
  });
});

describe("E80 only the trust writer changes trustedPlugins", () => {
  it("writeConfigPartial ignores auth.trustedPlugins in the body and keeps the stored list", () => {
    fs.writeFileSync(configFile, JSON.stringify({ auth: { capabilityRoutePlugins: ["wall"], trustedPlugins: [{ id: "kept", clientSha256: SHA }] } }));
    const res = writeConfigPartial({ auth: { trustedPlugins: [{ id: "ext", clientSha256: SHA2 }], allowedUsers: ["alice"] } });
    expect(res.success).toBe(true);
    const stored = raw();
    expect(stored.auth.trustedPlugins).toEqual([{ id: "kept", clientSha256: SHA }]);
    expect(stored.auth.allowedUsers).toEqual(["alice"]);
    expect(stored.auth.capabilityRoutePlugins).toEqual(["wall"]);
  });

  it("with no stored list, a body list does not create one; capabilityRoutePlugins handling is unchanged", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    writeConfigPartial({ auth: { trustedPlugins: [{ id: "ext", clientSha256: SHA }], capabilityRoutePlugins: ["wall"] } });
    expect(raw().auth.trustedPlugins).toBeUndefined();
    expect(raw().auth.capabilityRoutePlugins).toEqual(["wall"]);
    expect(readTrustedPlugins()).toEqual([]);
  });
});
