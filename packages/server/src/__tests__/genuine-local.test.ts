import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateWsUpgrade } from "../auth/auth-plugin.js";
import { ensureLocalToken, LOCAL_TOKEN_HEADER, verifyLocalToken } from "../auth/local-token.js";
import {
  hasProxyForwardingHeaders,
  isGenuinelyLocal,
  isLoopback,
} from "../auth/localhost-guard.js";

const SECRET = "test-secret";

describe("proxy-forwarding detection (D10 narrowed)", () => {
  it("flags any known forwarding header", () => {
    expect(hasProxyForwardingHeaders({ "x-forwarded-for": "1.2.3.4" })).toBe(true);
    expect(hasProxyForwardingHeaders({ "x-real-ip": "1.2.3.4" })).toBe(true);
    expect(hasProxyForwardingHeaders({ forwarded: "for=1.2.3.4" })).toBe(true);
    expect(hasProxyForwardingHeaders({ accept: "text/html" })).toBe(false);
    expect(hasProxyForwardingHeaders(undefined)).toBe(false);
  });

  it("genuine-local = loopback AND no forwarding header", () => {
    expect(isGenuinelyLocal("127.0.0.1", {})).toBe(true);
    expect(isGenuinelyLocal("::1", undefined)).toBe(true);
    // Tunnel presenting as loopback but carrying a forwarding header → NOT local.
    expect(isGenuinelyLocal("127.0.0.1", { "x-forwarded-for": "9.9.9.9" })).toBe(false);
    // Real remote IP → never local.
    expect(isGenuinelyLocal("9.9.9.9", {})).toBe(false);
    // sanity: isLoopback unchanged
    expect(isLoopback("127.0.0.1")).toBe(true);
  });
});

describe("WS upgrade closes the tunnel-as-loopback bypass", () => {
  it("rejects a loopback WS upgrade that carries a forwarding header, with no other credential", () => {
    // No-auth-analog via validateWsUpgrade with authConfig secret present:
    const ok = validateWsUpgrade(undefined, "127.0.0.1", SECRET, [], {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(ok).toBe(false);
  });

  it("still trusts a genuine loopback WS upgrade (no forwarding header)", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET, [], { headers: {} })).toBe(true);
  });
});

describe("local-IPC token allowlist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-localtoken-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a 0600 token in a 0700 dir and reuses it", () => {
    const dir = path.join(tmpDir, "local");
    const t1 = ensureLocalToken(dir);
    const t2 = ensureLocalToken(dir);
    expect(t1).toBe(t2);
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dir, "token")).mode & 0o777).toBe(0o600);
    }
  });

  it("verifies a presented token constant-time; rejects wrong/absent", () => {
    const token = ensureLocalToken(path.join(tmpDir, "local"));
    expect(verifyLocalToken({ [LOCAL_TOKEN_HEADER]: token }, token)).toBe(true);
    expect(verifyLocalToken({ [LOCAL_TOKEN_HEADER]: "wrong" }, token)).toBe(false);
    expect(verifyLocalToken({}, token)).toBe(false);
    expect(verifyLocalToken(undefined, token)).toBe(false);
  });

  it("grants a tunnel-presenting WS upgrade only with a valid local token", () => {
    const token = ensureLocalToken(path.join(tmpDir, "local"));
    // A tunnel (forwarding header) + valid local token → trusted (genuine local process).
    expect(
      validateWsUpgrade(undefined, "127.0.0.1", SECRET, [], {
        headers: { "x-forwarded-for": "9.9.9.9", [LOCAL_TOKEN_HEADER]: token },
        localToken: token,
      }),
    ).toBe(true);
    // Same, wrong token → rejected.
    expect(
      validateWsUpgrade(undefined, "127.0.0.1", SECRET, [], {
        headers: { "x-forwarded-for": "9.9.9.9", [LOCAL_TOKEN_HEADER]: "nope" },
        localToken: token,
      }),
    ).toBe(false);
  });
});
