/**
 * Bridge-side vault delivery: tracked hashes, local-override (incl. win32 case),
 * rotation/revocation/reconciliation, nested-pi marker, offline grace, downgrade
 * withdrawal, corrupt-vault handling, reload persistence, disable switch.
 * See change: add-credential-vault (test-plan E20-E22, X3-X11).
 */

import { createHash } from "node:crypto";
import type { VaultSnapshotMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { VAULT_DELIVERED_MARKER_ENV, VAULT_DELIVERY_FEATURE } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultDelivery, createVaultRegistry, type VaultDeliveryDeps, type VaultRegistry } from "../vault-delivery.js";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const HOUR = 3_600_000;

let env: NodeJS.ProcessEnv;
let sent: Array<Record<string, unknown>>;
let registry: VaultRegistry;
let mono: number;
let wall: number;
let platform: NodeJS.Platform;

const snap = (entries: Array<[string, string]>, over: Partial<VaultSnapshotMessage> = {}): VaultSnapshotMessage => ({
  type: "vault_snapshot", status: "ok", outcome: "delivered", graceHours: 24,
  entries: entries.map(([name, value]) => ({ name, value })), ...over,
});

function mk(over: Partial<VaultDeliveryDeps> = {}) {
  return createVaultDelivery({
    env, platform, registry,
    send: (m) => { sent.push(m as unknown as Record<string, unknown>); return true; },
    sessionId: () => "s1",
    clock: { mono: () => mono, wall: () => wall },
    resolveProject: async (cwd) => ({ dir: cwd, origin: undefined }),
    identityTimeoutMs: 10_000,
    ...over,
  });
}
const identity = (d: ReturnType<typeof mk>, features: string[] = [VAULT_DELIVERY_FEATURE]) =>
  d.onServerMessage({ type: "dashboard_identity", features });

beforeEach(() => {
  env = {}; sent = []; registry = createVaultRegistry(); mono = 1_000; wall = 1_700_000_000_000; platform = "linux";
});

describe("delivery and precedence (E20)", () => {
  it("delivers a name that is unset, and records only its hash for tracking", () => {
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    expect(env.GEMINI_API_KEY).toBe("abcdefgh12");
    expect(registry.tracked.get("GEMINI_API_KEY")).toEqual({ hash: sha("abcdefgh12") });
    expect(JSON.stringify(sent)).not.toContain("abcdefgh12");
    expect(sent.at(-1)).toMatchObject({ type: "vault_report", applied: [{ name: "GEMINI_API_KEY", outcome: "delivered" }] });
  });

  it("a value present before delivery (user or spawn contributor) is local-override", () => {
    env.GEMINI_API_KEY = "user-value-123";
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    expect(env.GEMINI_API_KEY).toBe("user-value-123");
    expect(registry.tracked.has("GEMINI_API_KEY")).toBe(false);
    expect(sent.at(-1)).toMatchObject({ applied: [{ name: "GEMINI_API_KEY", outcome: "local-override" }] });
  });

  it("on win32 a case-variant is a local-override", () => {
    platform = "win32";
    env.Gemini_Api_Key = "user-value-123";
    mk().onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(sent.at(-1)).toMatchObject({ applied: [{ name: "GEMINI_API_KEY", outcome: "local-override" }] });
  });

  it("sets the marker with names only", () => {
    mk().onServerMessage(snap([["A_KEY", "abcdefgh12"], ["B_KEY", "abcdefgh34"]]));
    expect(env[VAULT_DELIVERED_MARKER_ENV]).toBe("A_KEY,B_KEY");
  });
});

describe("rotation, revocation, reconciliation (E21, X3)", () => {
  it("rotation updates a tracked name whose value still matches", () => {
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "old-value-123"]]));
    d.onServerMessage(snap([["GEMINI_API_KEY", "new-value-123"]]));
    expect(env.GEMINI_API_KEY).toBe("new-value-123");
    expect(registry.tracked.get("GEMINI_API_KEY")?.hash).toBe(sha("new-value-123"));
  });

  it("E21: the user's overwritten value survives revocation, via push and via reconnect reconciliation", () => {
    for (const via of ["push", "reconnect"] as const) {
      env = {}; registry = createVaultRegistry();
      const d = mk();
      d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
      env.GEMINI_API_KEY = "my-own-value-1";
      if (via === "reconnect") { d.onClose(); d.onOpen(); identity(d); }
      d.onServerMessage(snap([]));
      expect(env.GEMINI_API_KEY).toBe("my-own-value-1");
      expect(registry.tracked.has("GEMINI_API_KEY")).toBe(false);
    }
  });

  it("revocation unsets an untouched delivered value", () => {
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    d.onServerMessage(snap([]));
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env[VAULT_DELIVERED_MARKER_ENV]).toBeUndefined();
  });

  it("X3: a binding revoked while disconnected is unset by the reconcile snapshot", () => {
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    d.onClose();
    d.onOpen();
    identity(d);
    expect(sent.at(-1)).toMatchObject({ type: "vault_sync_request", tracked: ["GEMINI_API_KEY"] });
    d.onServerMessage(snap([]));
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("the sync request carries names only, never values or hashes", async () => {
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/work/p" });
    const req = sent.filter((m) => m.type === "vault_sync_request").at(-1);
    expect(req).toMatchObject({ sessionId: "s1", cwd: "/work/p", tracked: ["GEMINI_API_KEY"], reason: "startup" });
    expect(JSON.stringify(req)).not.toContain("abcdefgh12");
    expect(JSON.stringify(req)).not.toContain(sha("abcdefgh12"));
  });
});

describe("nested pi sessions (E22)", () => {
  it("masks inherited values, never reports local-override, never unsets, marker holds names only", () => {
    env.GEMINI_API_KEY = "parent-gemini-1"; env.SONIOX_API_KEY = "parent-soniox-1";
    env[VAULT_DELIVERED_MARKER_ENV] = "GEMINI_API_KEY,SONIOX_API_KEY";
    const child = mk();
    expect([...child.redactionValues()].sort()).toEqual(["parent-gemini-1", "parent-soniox-1"]);
    child.onServerMessage(snap([["GEMINI_API_KEY", "child-view-123"]]));
    expect(sent.at(-1)).toMatchObject({ applied: [{ name: "GEMINI_API_KEY", outcome: "inherited" }] });
    expect(env.GEMINI_API_KEY).toBe("parent-gemini-1");
    child.onServerMessage(snap([])); // a revoke push
    expect(env.GEMINI_API_KEY).toBe("parent-gemini-1");
    expect(env.SONIOX_API_KEY).toBe("parent-soniox-1");
    expect(env[VAULT_DELIVERED_MARKER_ENV]).toBe("GEMINI_API_KEY,SONIOX_API_KEY");
    expect(env[VAULT_DELIVERED_MARKER_ENV]).not.toContain("=");
    expect(registry.tracked.size).toBe(0);
  });
});

describe("session replacement and cwd (X5, X6, X11)", () => {
  it("X5: an unreadable cwd withdraws everything and delivers nothing new", async () => {
    const d = mk();
    identity(d);
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    await d.onSessionStart({ reason: "resume", getCwd: () => { throw new Error("no cwd"); } });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(sent.filter((m) => m.type === "vault_sync_request").at(-1)).toMatchObject({ reason: "resume" });
    expect((sent.filter((m) => m.type === "vault_sync_request").at(-1) as { cwd?: string }).cwd).toBeUndefined();
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]], { status: "denied", outcome: "no-project", entries: [] }));
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("X6: resuming into another project scrubs the previous project's values immediately", async () => {
    const d = mk();
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/proj/A" });
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    await d.onSessionStart({ reason: "resume", getCwd: () => "/proj/B" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("B1: a re-pointed origin in the SAME directory scrubs the previous repository's values before any snapshot", async () => {
    let origin: string | undefined = "git@github.com:acme/app.git";
    const d = mk({ resolveProject: async (cwd) => ({ dir: cwd, origin }) });
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/src/app" });
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    expect(env.GEMINI_API_KEY).toBe("abcdefgh12");
    origin = "git@github.com:acme/other.git";
    await d.onSessionStart({ reason: "reload", getCwd: () => "/src/app" });
    expect(env.GEMINI_API_KEY).toBeUndefined(); // gone before the hub answers
    // and an unchanged identity keeps them
    d.onServerMessage(snap([["GEMINI_API_KEY", "abcdefgh12"]]));
    await d.onSessionStart({ reason: "reload", getCwd: () => "/src/app" });
    expect(env.GEMINI_API_KEY).toBe("abcdefgh12");
  });

  it("X11: a reload in the same project keeps values; disabling then unsets them", async () => {
    const d = mk();
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/proj/A" });
    d.onServerMessage(snap([["SONIOX_API_KEY", "abcdefgh12"]]));
    const again = mk(); // the reloaded extension re-creates the module over the same process registry
    identity(again);
    await again.onSessionStart({ reason: "reload", getCwd: () => "/proj/A" });
    expect(env.SONIOX_API_KEY).toBe("abcdefgh12");
    again.onServerMessage(snap([], { status: "denied", outcome: "disabled" }));
    expect(env.SONIOX_API_KEY).toBeUndefined();
  });
});

describe("downgrade and corruption (X4, X9)", () => {
  it("X4: a hub whose identity lacks vault-delivery gets every value withdrawn", () => {
    const d = mk();
    d.onServerMessage(snap([["A_KEY", "abcdefgh12"], ["B_KEY", "abcdefgh34"]]));
    identity(d, ["path-yolo"]);
    expect(env.A_KEY).toBeUndefined();
    expect(env.B_KEY).toBeUndefined();
  });

  it("a hub that never announces an identity is treated as a downgrade after the timeout", () => {
    vi.useFakeTimers();
    const d = mk();
    d.onServerMessage(snap([["A_KEY", "abcdefgh12"]]));
    d.onClose(); d.onOpen();
    vi.advanceTimersByTime(9_000);
    expect(env.A_KEY).toBe("abcdefgh12");
    vi.advanceTimersByTime(2_000);
    expect(env.A_KEY).toBeUndefined();
    vi.useRealTimers();
  });

  it("X9: an unavailable (corrupt) vault keeps values; disabling then unsets them", () => {
    const d = mk();
    d.onServerMessage(snap([["A_KEY", "abcdefgh12"]]));
    d.onClose(); d.onOpen(); identity(d);
    d.onServerMessage(snap([], { status: "unavailable", outcome: "vault-unavailable" }));
    expect(env.A_KEY).toBe("abcdefgh12");
    d.onServerMessage(snap([], { status: "denied", outcome: "disabled" }));
    expect(env.A_KEY).toBeUndefined();
  });
});

describe("bounded retention (X7, X8)", () => {
  const holding = () => {
    const d = mk();
    d.onServerMessage(snap([["A_KEY", "abcdefgh12"]], { graceHours: 24 }));
    d.onClose(); // hub unreachable from here
    return d;
  };

  it("X7: kept at 23h59m, withdrawn at 24h0m1s", () => {
    const d = holding();
    mono += 23 * HOUR + 59 * 60_000; wall += 23 * HOUR + 59 * 60_000;
    d.tick();
    expect(env.A_KEY).toBe("abcdefgh12");
    mono += 61_000; wall += 61_000;
    d.tick();
    expect(env.A_KEY).toBeUndefined();
  });

  it("X7: a sleep (wall +25h, monotonic +1h) still withdraws: the larger elapsed wins", () => {
    const d = holding();
    mono += 1 * HOUR; wall += 25 * HOUR;
    d.tick();
    expect(env.A_KEY).toBeUndefined();
  });

  it("a connected session never ages out", () => {
    const d = mk();
    d.onServerMessage(snap([["A_KEY", "abcdefgh12"]]));
    d.onOpen();
    for (let i = 0; i < 100; i++) { mono += 6 * HOUR; wall += 6 * HOUR; d.tick(); }
    expect(env.A_KEY).toBe("abcdefgh12");
  });

  it("X8: the advertised grace is clamped to [1 h, 168 h]", () => {
    for (const [hub, kept] of [[0, 1], [1, 1], [168, 168], [500, 168]] as const) {
      env = {}; registry = createVaultRegistry();
      const d = mk();
      d.onServerMessage(snap([["A_KEY", "abcdefgh12"]], { graceHours: hub }));
      expect(registry.graceHours).toBe(kept);
      d.onClose();
      mono += kept * HOUR - 1000; wall += kept * HOUR - 1000;
      d.tick();
      expect(env.A_KEY).toBe("abcdefgh12");
      mono += 2000; wall += 2000;
      d.tick();
      expect(env.A_KEY).toBeUndefined();
    }
  });
});

describe("live rotation (X10)", () => {
  it("a pushed rotation is in the environment immediately, and the old value stays masked", () => {
    vi.useFakeTimers();
    const d = mk();
    d.onServerMessage(snap([["GEMINI_API_KEY", "old12345678"]]));
    d.onServerMessage(snap([["GEMINI_API_KEY", "new12345678"]]));
    vi.advanceTimersByTime(5_000);
    expect(env.GEMINI_API_KEY).toBe("new12345678");
    expect([...d.redactionValues()].sort()).toEqual(["new12345678", "old12345678"]);
    vi.useRealTimers();
  });
});

// See change: harden-bridge-inbound-and-discovery (test-plan BE18, BX6).
describe("BE18: vault_sync_request origin is raw, userinfo-stripped, never normalized", () => {
  const cases: Array<[string, string]> = [
    ["https://user@github.com/o/r", "https://github.com/o/r"],
    ["https://user:pass@github.com/o/r", "https://github.com/o/r"],
    ["https://user:p%40ss@github.com/o/r", "https://github.com/o/r"],
    ["https://user:p@ss@github.com/o/r", "https://github.com/o/r"],
    ["https://tok@github.com:8443/o/r", "https://github.com:8443/o/r"],
    ["https://user:pass@[::1]:8443/o/r", "https://[::1]:8443/o/r"],
    ["ssh://git:secret@github.com/o/r", "ssh://git@github.com/o/r"],
    ["ssh://git@github.com/o/r", "ssh://git@github.com/o/r"],
    ["git@github.com:o/r.git", "git@github.com:o/r.git"],
    ["https://github.com/o/r", "https://github.com/o/r"],
  ];
  const syncOrigin = async (origin: string | undefined) => {
    const d = mk({ resolveProject: async (cwd) => ({ dir: cwd, origin }) });
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/work/p" });
    return sent.filter((m) => m.type === "vault_sync_request").at(-1) as { origin?: string } | undefined;
  };

  for (const [raw, wire] of cases) {
    it(`${raw} → ${wire}`, async () => {
      const req = await syncOrigin(raw);
      expect(req?.origin).toBe(wire);
      expect(req?.origin).toMatch(/^[a-z]+:\/\/|^git@/); // never the `host/path` normalized shape
      for (const s of ["pass", "p%40ss", "tok", "secret"]) expect(JSON.stringify(req)).not.toContain(s);
      if (raw.startsWith("https://user")) expect(JSON.stringify(req)).not.toContain("user");
    });
  }

  it("BX6: userinfo-bearing unparseable remotes send no origin at all", async () => {
    for (const raw of ["https://user:pass@", "https://user:pass@/o/r", "ssh://:secret@"]) {
      sent = [];
      const req = await syncOrigin(raw);
      expect(req, raw).toBeDefined();
      expect(req).not.toHaveProperty("origin");
      expect(JSON.stringify(sent)).not.toContain("secret");
      expect(JSON.stringify(sent)).not.toContain("pass");
    }
  });
});

describe("BE18: a query token never rides the origin", () => {
  it("strips ?query and #fragment from the wire origin", async () => {
    const d = mk({ resolveProject: async (cwd) => ({ dir: cwd, origin: "https://github.com/o/r?access_token=SECRET" }) });
    identity(d);
    await d.onSessionStart({ reason: "startup", getCwd: () => "/work/p" });
    const req = sent.filter((m) => m.type === "vault_sync_request").at(-1) as { origin?: string };
    expect(req.origin).toBe("https://github.com/o/r");
    expect(JSON.stringify(sent)).not.toContain("SECRET");
  });
});
