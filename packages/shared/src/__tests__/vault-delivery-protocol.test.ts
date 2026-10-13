/**
 * Vault delivery protocol: every frame is a member of the union it travels on
 * (a frame declared but not unioned is dead on arrival), the grace clamp, and
 * the config switches. See change: add-credential-vault (task 4.15, test-plan X8).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_VAULT_CONFIG, parseVaultConfig } from "../config.js";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "../protocol.js";
import { clampVaultGraceHours, VAULT_DELIVERY_FEATURE } from "../vault-delivery.js";

const asUp = (m: ExtensionToServerMessage): ExtensionToServerMessage => m;
const asDown = (m: ServerToExtensionMessage): ServerToExtensionMessage => m;

describe("vault frames are unioned", () => {
  it("bridge → server", () => {
    asUp({ type: "vault_sync_request", sessionId: "s", cwd: "/p", tracked: ["A_KEY"], reason: "connect" });
    asUp({ type: "vault_sync_request", sessionId: "s", tracked: [], reason: "resume" });
    asUp({ type: "vault_report", sessionId: "s", applied: [{ name: "A_KEY", outcome: "local-override" }] });
  });
  it("server → bridge", () => {
    asDown({ type: "vault_snapshot", status: "ok", outcome: "delivered", entries: [{ name: "A_KEY", value: "v" }], graceHours: 24 });
    asDown({ type: "vault_snapshot", status: "denied", outcome: "transport-insecure", entries: [], graceHours: 24 });
    asDown({ type: "dashboard_identity", features: [VAULT_DELIVERY_FEATURE] });
  });
});

describe("grace clamp (X8)", () => {
  it.each([[0, 1], [1, 1], [168, 168], [500, 168], [24, 24], [Number.NaN, 24], ["x", 24]])("%s → %s", (raw, want) => {
    expect(clampVaultGraceHours(raw)).toBe(want);
  });
});

describe("vault config", () => {
  it("defaults to enabled with a 24 h grace", () => {
    expect(parseVaultConfig(undefined)).toEqual(DEFAULT_VAULT_CONFIG);
    expect(DEFAULT_VAULT_CONFIG).toEqual({ deliveryEnabled: true, offlineGraceHours: 24 });
  });
  it("honours the switch and clamps the grace", () => {
    expect(parseVaultConfig({ deliveryEnabled: false, offlineGraceHours: 9999 })).toEqual({ deliveryEnabled: false, offlineGraceHours: 168 });
    expect(parseVaultConfig({ deliveryEnabled: "no" }).deliveryEnabled).toBe(true);
  });
});
