import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

let tmpDir: string;
let regPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-paired-"));
  regPath = path.join(tmpDir, "paired-devices.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PairedDeviceRegistry", () => {
  it("adds a device and returns a plaintext token once (0600 on disk)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("My iPhone");
    expect(token.length).toBeGreaterThan(20);
    expect(device.label).toBe("My iPhone");
    expect(fs.existsSync(regPath)).toBe(true);
    // Plaintext token never persisted.
    expect(fs.readFileSync(regPath, "utf-8")).not.toContain(token);
    if (process.platform !== "win32") {
      expect(fs.statSync(regPath).mode & 0o777).toBe(0o600);
    }
  });

  it("verifies a valid token and rejects unknown/revoked tokens", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    expect(reg.verify(token)).toBe(device.id);
    expect(reg.verify("bogus-token")).toBe(null);
    expect(reg.verify(undefined)).toBe(null);

    expect(reg.revoke(device.id)).toBe(true);
    expect(reg.verify(token)).toBe(null); // revoked → rejected
    expect(reg.revoke(device.id)).toBe(false); // already gone
  });

  it("updates last-seen on successful verify", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    expect(reg.list().find((d) => d.id === device.id)?.lastSeen).toBe(null);
    reg.verify(token);
    expect(reg.list().find((d) => d.id === device.id)?.lastSeen).not.toBe(null);
  });

  it("persists across reconstruction (reload)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    const reg2 = new PairedDeviceRegistry(regPath);
    expect(reg2.verify(token)).toBe(device.id);
  });
});
