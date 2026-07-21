import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readConfigRedacted, writeConfigPartial } from "../config-api.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { collectEndpoints, toReachableUrlStrings } from "../tunnel/tunnel-endpoints.js";

function configFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

beforeEach(() => {
  try { fs.unlinkSync(configFile()); } catch { /* fresh */ }
});

describe("tunnel provider-secret redaction (doubt-review fix, supports 6.5)", () => {
  it("GET /api/config never serves provider secrets in clear", () => {
    writeConfigPartial({
      tunnel: { enabled: true, provider: "ngrok", mode: "public", ngrok: { authtoken: "2secretTOKEN0123456789" } },
    });
    const redacted = readConfigRedacted();
    expect(redacted.tunnel.ngrok?.authtoken).toBe("***");
  });

  it("a PUT echoing the redacted secret preserves the real value on disk", () => {
    writeConfigPartial({ tunnel: { enabled: true, provider: "tailscale", mode: "private", tailscale: { authKey: "tskey-auth-REAL123" } } });
    // Client reads redacted config and PUTs it back unchanged.
    writeConfigPartial({ tunnel: { enabled: true, provider: "tailscale", mode: "private", tailscale: { authKey: "***" } } });
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf-8"));
    expect(raw.tunnel.tailscale.authKey).toBe("tskey-auth-REAL123");
  });

  // support-zrok-v2 (X7): reservedName + persistent are not secrets but MUST
  // survive a partial write that does not touch the zrok sub-config.
  it("X7: zrok.reservedName + persistent survive a partial write toggling tunnel.enabled", () => {
    writeConfigPartial({
      tunnel: { enabled: true, provider: "zrok", mode: "public", zrok: { reservedName: "pi-dash-abcd1234", persistent: true } },
    });
    writeConfigPartial({ tunnel: { enabled: false } });
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf-8"));
    expect(raw.tunnel.enabled).toBe(false);
    expect(raw.tunnel.zrok.reservedName).toBe("pi-dash-abcd1234");
    expect(raw.tunnel.zrok.persistent).toBe(true);
  });
});

describe("manual http endpoint never enters the pairing payload (6.5)", () => {
  it("a hand-added http:// publicBaseUrl is dropped by the read-time gate", () => {
    const endpoints = collectEndpoints({
      publicBaseUrls: ["http://myserver.lan:8000", "https://secure.example"],
      port: 8000,
      includeLocal: false,
    });
    const urls = toReachableUrlStrings(endpoints);
    expect(urls).toContain("http://myserver.lan:8000"); // present in the flat source
    const mgr = new PairingManager({
      registry: new PairedDeviceRegistry(path.join(os.tmpdir(), `pair-${Date.now()}.json`)),
      getFingerprint: () => "sha256:fp",
      getReachableUrls: () => urls,
    });
    const payload = mgr.createPayload();
    // ...but the gate drops it — only the https endpoint survives into urls[].
    expect(payload!.urls).toEqual(["https://secure.example"]);
    expect(payload!.urls.some((u) => u.startsWith("http://"))).toBe(false);
  });
});
