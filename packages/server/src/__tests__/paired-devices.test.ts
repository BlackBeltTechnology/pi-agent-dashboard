import crypto from "node:crypto";
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
    // Pairing source with no explicit tier → operate (D1).
    expect(reg.verify(token)).toEqual({ id: device.id, tier: "operate" });
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
    expect(reg2.verify(token)).toMatchObject({ id: device.id });
  });
});

// E15 (test-plan: mcp-legacy-clients-and-token-issuance) — rows written before
// `source` existed read as `"pairing"` and the field is added on the next write.
describe("E15 — registry rows without a source field", () => {
  it("list as pairing, still verify, and normalise on the next write", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        { id: "row-1", label: "old", tokenHash: legacyHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);

    expect(reg.list()[0]).toMatchObject({ id: "row-1", label: "old", source: "pairing" });
    // The legacy token continues to verify — as `operate` (full access kept).
    expect(reg.verify(legacyToken)).toMatchObject({ id: "row-1", tier: "operate" });

    // The next write back-fills `source` on the OLD row too.
    reg.add("new-device");
    const rows = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    expect(rows[0].source).toBe("pairing");
    expect(rows[1].source).toBe("pairing");
  });

  it("a manual add records source manual (E16 shape)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("cli", "manual");
    expect(device.source).toBe("manual");
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(reg.list()[0].source).toBe("manual");
  });
});

// E1–E5 (test-plan expand-mcp-tiered-surface) — registry tier + legacy-row
// defaults + unknown-field preservation. See change: expand-mcp-tiered-surface.
describe("tier on the registry (E1–E5)", () => {
  it("E1: add(manual) with no tier defaults to observe", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("x", "manual");
    expect(reg.list()[0]).toMatchObject({ tier: "observe" });
  });

  it("E2: add(pairing) with no tier defaults to operate", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("x", "pairing");
    expect(reg.list()[0]).toMatchObject({ tier: "operate" });
  });

  it("E3: an invalid tier throws before minting; the file is byte-identical", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("seed", "manual"); // create the file
    const before = fs.readFileSync(regPath, "utf-8");
    expect(() => reg.add("x", "manual", "root" as never)).toThrow();
    const after = fs.readFileSync(regPath, "utf-8");
    expect(after).toBe(before);
    expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before));
    expect(reg.list()).toHaveLength(1);
  });

  it("E4: a legacy row (no tier, no source) verifies as operate and lists pairing/operate", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        { id: "row-1", label: "old", tokenHash: legacyHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);
    expect(reg.verify(legacyToken)).toEqual({ id: "row-1", tier: "operate" });
    expect(reg.list()[0]).toMatchObject({ source: "pairing", tier: "operate" });
  });

  it("E5: unknown fields on a row survive an add + revoke round-trip", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        {
          id: "row-1",
          label: "old",
          tokenHash: legacyHash,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeen: null,
          tier: "control",
          source: "manual",
          futureField: 1,
        },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);
    const { device } = reg.add("scratch", "manual");
    reg.revoke(device.id);
    const rows = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    const original = rows.find((r: { id: string }) => r.id === "row-1");
    expect(original.futureField).toBe(1);
    expect(original.tier).toBe("control");
  });

  it("an explicit tier is persisted and survives reconstruction", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { token } = reg.add("explicit", "manual", "control");
    const reg2 = new PairedDeviceRegistry(regPath);
    expect(reg2.verify(token)).toEqual(expect.objectContaining({ tier: "control" }));
  });
});
