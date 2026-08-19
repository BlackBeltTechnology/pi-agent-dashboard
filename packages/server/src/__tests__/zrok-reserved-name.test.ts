/**
 * zrok reserved-name outcomes and lifecycle — folded from test-plan.md
 * (add-zrok-custom-reserved-name): E1–E9, X1–X3, plus the degraded
 * reconciliation that backs F9.
 *
 * The defect being pinned is not "reservation can fail" — it is that all four
 * failure causes collapsed into a bare `null`, the reason died in a
 * `console.warn`, and the user saw a green tunnel at a URL they never chose.
 * So these tests assert the REASON, not merely the rejection.
 *
 * Modeled on `tunnel-zrok-v2.test.ts` (fake exec mocks + fs stub).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();
const whichMock = vi.fn((_name: string) => "/usr/local/bin/zrok2");

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, execFileSync: (...a: any[]) => execFileSyncMock(...a) };
});

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ToolResolver: class {
      which(name: string) {
        return whichMock(name);
      }
    },
  };
});

let writeShouldFail = false;
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const def = {
    ...(actual.default ?? actual),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(() => {
      if (writeShouldFail) throw new Error("EACCES: permission denied");
    }),
  };
  return { ...actual, default: def, ...def };
});

import {
  classifyCreateNameError,
  isDnsSafeReservedName,
  mintReservedName,
  reserveName,
} from "../tunnel-providers/zrok.js";
import { effectiveReservedName, reconcileDegraded } from "../tunnel/tunnel.js";

/** Make `zrok create name` fail with the given stderr. */
function failWith(stderr: string) {
  execFileSyncMock.mockImplementation(() => {
    const e: any = new Error("Command failed");
    e.stderr = stderr;
    throw e;
  });
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue("");
  writeShouldFail = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ── Name validation (E1–E6) ──────────────────────────────────────────
// Boundaries come from the real regex /^[a-z0-9][a-z0-9-]{0,62}$/i → max 63.
describe("reserved-name validation", () => {
  it("E1: accepts the 1-char minimum and reserves it", () => {
    const r = reserveName("a");
    expect(r).toEqual({ status: "ok", name: "a" });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      expect.any(String),
      ["create", "name", "-n", "public", "a"],
      expect.anything(),
    );
  });

  it("E2: accepts exactly 63 chars, verbatim", () => {
    const name = `a${"b".repeat(62)}`;
    expect(name).toHaveLength(63);
    expect(reserveName(name)).toEqual({ status: "ok", name });
  });

  it("E3: rejects 64 chars as invalid, WITHOUT invoking zrok", () => {
    const r = reserveName(`a${"b".repeat(63)}`);
    expect(r.status).toBe("invalid");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("E4: an empty name is invalid, and is NOT the clear path", () => {
    // `reserveName("")` must not silently become "generate one for me" — that
    // is `reserveName(undefined)`, a different intent entirely.
    const r = reserveName("");
    expect(r.status).toBe("ok");
    expect(r.name).toMatch(/^pi-dash-[0-9a-f]{8}$/);
    // The endpoint distinguishes them: `null` clears, a string sets.
    expect(isDnsSafeReservedName("")).toBe(false);
  });

  it("E5: rejects a leading hyphen so an option-like value never reaches argv", () => {
    const r = reserveName("-lead");
    expect(r.status).toBe("invalid");
    expect(execFileSyncMock).not.toHaveBeenCalled();
    // The guard exists precisely so `-lead` cannot be parsed as a zrok flag.
    expect(isDnsSafeReservedName("--force")).toBe(false);
  });

  it("E6: rejects an underscore, naming the charset rule", () => {
    const r = reserveName("has_underscore");
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.message).toMatch(/hyphen|underscore|letters/i);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

// ── stderr classification (E7–E9) ────────────────────────────────────
// This branch is load-bearing the moment a reason is shown to a user: a CLI
// wording change silently reclassifying "someone else's" as "reuse mine" would
// hand the operator a name they do not own.
describe("stderr classification is pinned", () => {
  it("E7: `already exists` with no other-account marker → reuse mine, NOT taken", () => {
    expect(classifyCreateNameError("Error: name already exists")).toBe("exists-mine");
    failWith("Error: name already exists");
    expect(reserveName("mine").status).toBe("ok");
  });

  it("E8: an owned-by-another form → taken", () => {
    expect(classifyCreateNameError("already exists (owned by another account)")).toBe("taken");
    failWith("already exists (owned by another account)");
    const r = reserveName("popular");
    expect(r.status).toBe("taken");
    expect(r.status === "taken" && r.cause).toBe("another-account");
    expect(r.status === "taken" && r.message).toMatch(/another zrok account/i);
  });

  it("E8b: every captured taken-by-another wording classifies the same way", () => {
    for (const s of [
      "name already exists on a different account",
      "already exists: owned by another identity",
      "zrok: this name is owned by someone else's account",
    ]) {
      expect(classifyCreateNameError(s), s).toBe("taken");
    }
  });

  it("E9: an unrecognised stderr is honest-but-vague, never reuse-mine", () => {
    expect(classifyCreateNameError("dial tcp: connection refused")).toBe("unknown");
    failWith("dial tcp: connection refused");
    const r = reserveName("whatever");
    // The critical assertion: it did NOT fall through to `ok`.
    expect(r.status).toBe("taken");
    expect(r.status === "taken" && r.cause).toBe("unknown");
    // And it does not CLAIM the other-account cause it cannot prove.
    expect(r.status === "taken" && r.message).not.toMatch(/another zrok account/i);
    expect(r.status === "taken" && r.message).toContain("connection refused");
  });

  it("E9b: empty stderr still fails closed rather than reusing the name", () => {
    failWith("");
    expect(reserveName("x").status).toBe("taken");
  });
});

// ── Persistence failure (X3) ─────────────────────────────────────────
describe("reservation succeeds but the config write fails", () => {
  it("X3: reports write-failed, never a misleading ok", () => {
    writeShouldFail = true;
    const r = reserveName("robson-home-mac");
    expect(r.status).toBe("write-failed");
    expect(r.status === "write-failed" && r.message).toMatch(/config/i);
  });

  it("X3b: the legacy mintReservedName adapter still degrades to null", () => {
    writeShouldFail = true;
    expect(mintReservedName("robson-home-mac")).toBeNull();
  });
});

// ── The adapter keeps its old contract ───────────────────────────────
describe("mintReservedName remains the connect-time adapter", () => {
  it("returns the name on success and null on every failure", () => {
    expect(mintReservedName("ok-name")).toBe("ok-name");
    failWith("already exists (owned by another account)");
    expect(mintReservedName("taken-name")).toBeNull();
  });

  it("still generates pi-dash-<8 hex> when given no name", () => {
    expect(mintReservedName()).toMatch(/^pi-dash-[0-9a-f]{8}$/);
  });

  it("never releases anything — release is the caller's ordered decision", () => {
    reserveName("new-name");
    const verbs = execFileSyncMock.mock.calls.map((c) => (c[1] as string[]).join(" "));
    expect(verbs.some((v) => v.startsWith("delete name"))).toBe(false);
  });
});

// ── Degraded reconciliation (D2, backs F9) ───────────────────────────
describe("degraded reconciliation", () => {
  it("parses the reserved name out of a v2 and a v1 URL", () => {
    expect(effectiveReservedName("https://robson-home-mac.shares.zrok.io")).toBe("robson-home-mac");
    expect(effectiveReservedName("https://abc123.share.zrok.io/x")).toBe("abc123");
  });

  it("reports degraded when the served name is not the configured one", () => {
    expect(
      reconcileDegraded("https://xk3n2p9q.shares.zrok.io", {
        reservedName: "robson-home-mac",
        persistent: true,
      }),
    ).toEqual({ configuredName: "robson-home-mac", effectiveName: "xk3n2p9q" });
  });

  it("reports NO degradation when the configured name is being served", () => {
    expect(
      reconcileDegraded("https://robson-home-mac.shares.zrok.io", {
        reservedName: "robson-home-mac",
        persistent: true,
      }),
    ).toBeUndefined();
  });

  it("ephemeral BY CONFIGURATION is not degraded", () => {
    expect(reconcileDegraded("https://xk3n2p9q.shares.zrok.io", { persistent: false })).toBeUndefined();
    expect(
      reconcileDegraded("https://xk3n2p9q.shares.zrok.io", { reservedName: "n", persistent: false }),
    ).toBeUndefined();
  });

  it("is a pure comparison, so a watchdog recycle yields the SAME signal, not a new event", () => {
    const cfg = { reservedName: "robson-home-mac", persistent: true };
    const a = reconcileDegraded("https://xk3n2p9q.shares.zrok.io", cfg);
    const b = reconcileDegraded("https://xk3n2p9q.shares.zrok.io", cfg);
    expect(a).toEqual(b);
  });

  it("an unparseable URL does not manufacture a mismatch it cannot prove", () => {
    const r = reconcileDegraded("https://example.invalid/", { reservedName: "n", persistent: true });
    expect(r).toEqual({ configuredName: "n" });
    expect(r?.effectiveName).toBeUndefined();
  });
});
