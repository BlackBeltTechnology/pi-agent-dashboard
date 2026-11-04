/**
 * resolvePidTarget — which pid namespace a session's recorded pid belongs to.
 * Test-plan rows E1–E22, E100, E106, E109, P100.
 * See change: scope-pids-to-namespace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  type PidTargetSession,
  resolvePidTarget,
  type ServerPidContext,
  sanitizePidNamespace,
} from "../pid-target.js";

const SL: ServerPidContext = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const SM: ServerPidContext = { platform: "darwin", hostId: "mac.local" };

const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_CTR: PidNamespace = { ...RL, nsId: "pid:[4026532999]" };
const RL_VM: PidNamespace = { ...RL, hostId: "boot-B" };
const RL_WSL: PidNamespace = {
  platform: "linux",
  kind: "wsl",
  distro: "Ubuntu-24.04",
  hostId: "boot-W",
  nsId: "pid:[4026531840]",
};
const RW: PidNamespace = { platform: "win32", kind: "host", hostId: "WINBOX" };
const RM: PidNamespace = { platform: "darwin", kind: "host", hostId: "mac.local" };

function s(over: Partial<PidTargetSession> = {}): PidTargetSession {
  return { pid: 4242, cwd: "/home/u/p", ...over };
}
const kind = (t: ReturnType<typeof resolvePidTarget>) => t.kind;

describe("resolvePidTarget — resolution rules", () => {
  it("E1: remote origin is foreign even with an identical report", () => {
    expect(kind(resolvePidTarget(s({ originDeviceId: "dev-remote-1", pidNamespace: RL }), SL))).toBe("foreign");
  });
  it("E2: remote origin beats the own-entry rule", () => {
    expect(kind(resolvePidTarget(s({ originDeviceId: "dev-remote-1" }), SL, 4242))).toBe("foreign");
  });
  it("E3: same namespace is host", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL }), SL))).toBe("host");
  });
  it("E4: container nsId is foreign", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL_CTR }), SL))).toBe("foreign");
  });
  it("E5: another machine is foreign", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL_VM }), SL))).toBe("foreign");
  });
  it("E6: a missing field beats a mismatch", () => {
    const r: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-B" };
    expect(kind(resolvePidTarget(s({ pidNamespace: r }), SL))).toBe("unknown");
  });
  it("E7: server side without nsId is unknown", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL }), { platform: "linux", hostId: "boot-A" }))).toBe("unknown");
  });
  it("E8: server side without hostId is unknown", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL }), { platform: "linux", nsId: "pid:[4026531836]" }))).toBe(
      "unknown",
    );
  });
  it("E9: darwin report to a Linux server is foreign", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RM }), SL))).toBe("foreign");
  });
  it("E10: win32 report to a Linux server is foreign", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RW }), SL))).toBe("foreign");
  });
  it("E11: WSL report to a win32 server is wsl with its distro", () => {
    expect(resolvePidTarget(s({ pidNamespace: RL_WSL }), SW)).toEqual({ kind: "wsl", distro: "Ubuntu-24.04" });
  });
  it("E12: a Linux non-WSL report to a win32 server is foreign", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL }), SW))).toBe("foreign");
  });
  it("E13: win32/win32 by hostId", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RW }), SW))).toBe("host");
    expect(kind(resolvePidTarget(s({ pidNamespace: { ...RW, hostId: "OTHERBOX" } }), SW))).toBe("foreign");
  });
  it("E14: darwin/darwin by hostId", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RM }), SM))).toBe("host");
    expect(kind(resolvePidTarget(s({ pidNamespace: { ...RM, hostId: "other.local" } }), SM))).toBe("foreign");
  });
  it("E15: same hostname on another Mac resolves host (accepted risk)", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: { ...RM } }), SM))).toBe("host");
  });
  it("E16: a dashboard in the same WSL distro treats its sessions as host", () => {
    const ctx: ServerPidContext = { platform: "linux", hostId: "boot-W", nsId: "pid:[4026531840]" };
    expect(kind(resolvePidTarget(s({ pidNamespace: RL_WSL }), ctx))).toBe("host");
  });
  it("E17: another distro in the same WSL2 VM is foreign", () => {
    const ctx: ServerPidContext = { platform: "linux", hostId: "boot-W", nsId: "pid:[4026531840]" };
    const r: PidNamespace = { ...RL_WSL, distro: "Debian", nsId: "pid:[4026532111]" };
    expect(kind(resolvePidTarget(s({ pidNamespace: r }), ctx))).toBe("foreign");
  });
  it("E18: legacy bridge on a POSIX server is host", () => {
    expect(kind(resolvePidTarget(s(), SL))).toBe("host");
    expect(kind(resolvePidTarget(s(), SM))).toBe("host");
  });
  it("E19: legacy bridge on win32 — cwd first character", () => {
    const cases: Array<[string, string]> = [
      ["/home/u/p", "legacy-wsl"],
      ["//wsl.localhost/Ubuntu/home/u", "legacy-wsl"],
      ["C:\\Users\\u\\p", "unknown"],
      ["\\\\wsl$\\Ubuntu\\home\\u", "unknown"],
      ["", "unknown"],
    ];
    for (const [cwd, want] of cases) expect(kind(resolvePidTarget(s({ cwd }), SW))).toBe(want);
  });
  it("E20: own registry entry pid on win32", () => {
    expect(kind(resolvePidTarget(s(), SW, 4242))).toBe("host");
    expect(kind(resolvePidTarget(s(), SW, 4243))).toBe("legacy-wsl");
    expect(kind(resolvePidTarget(s(), SW, undefined))).toBe("legacy-wsl");
  });
  it("E21: own entry pid is ignored when a report exists", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: RL_CTR }), SL, 4242))).toBe("foreign");
  });
  it("E22: own entry pid mismatch on POSIX keeps host", () => {
    expect(kind(resolvePidTarget(s(), SL, 9999))).toBe("host");
  });
  it("E100: macOS/Windows missing hostId on either side is unknown", () => {
    expect(kind(resolvePidTarget(s({ pidNamespace: { platform: "win32", kind: "host" } }), SW))).toBe("unknown");
    expect(kind(resolvePidTarget(s({ pidNamespace: RM }), { platform: "darwin" }))).toBe("unknown");
    expect(kind(resolvePidTarget(s({ pidNamespace: RW }), { platform: "win32" }))).toBe("unknown");
  });
});

describe("sanitizePidNamespace — malformed reports (S7)", () => {
  it("E106: malformed values are an unusable report that resolves unknown", () => {
    const bad: unknown[] = [
      { platform: "linux", kind: "wsl" },
      { platform: 42, kind: "host" },
      { ...RL, nsId: null },
      [RL],
      "linux",
    ];
    for (const raw of bad) {
      const stored = sanitizePidNamespace(raw);
      expect(stored).toBeNull();
      expect(kind(resolvePidTarget(s({ pidNamespace: stored }), SL))).toBe("unknown");
    }
  });
  it("E106: an absent report stays absent (legacy rules)", () => {
    expect(sanitizePidNamespace(undefined)).toBeUndefined();
  });
  it("E109: length caps — distro 64, hostId/nsId 128", () => {
    const at = (n: number) => "x".repeat(n);
    expect(sanitizePidNamespace({ ...RL_WSL, distro: at(64) })).toEqual({ ...RL_WSL, distro: at(64) });
    expect(sanitizePidNamespace({ ...RL_WSL, distro: at(65) })).toBeNull();
    expect(sanitizePidNamespace({ ...RL_WSL, hostId: at(128) })).not.toBeNull();
    expect(sanitizePidNamespace({ ...RL_WSL, hostId: at(129) })).toBeNull();
    expect(sanitizePidNamespace({ ...RL_WSL, nsId: at(128) })).not.toBeNull();
    expect(sanitizePidNamespace({ ...RL_WSL, nsId: at(129) })).toBeNull();
    const huge = sanitizePidNamespace({ ...RL, hostId: at(1_000_000) });
    expect(huge).toBeNull(); // nothing of the 1 MB value is stored
  });
  it("E109: a 128-char id resolves on its merits", () => {
    const id = "h".repeat(128);
    const stored = sanitizePidNamespace({ ...RL, hostId: id });
    expect(kind(resolvePidTarget(s({ pidNamespace: stored }), { ...SL, hostId: id }))).toBe("host");
  });
  it("a valid report is copied without unknown keys", () => {
    expect(sanitizePidNamespace({ ...RL, extra: "x".repeat(10_000) })).toEqual(RL);
  });
});

/**
 * @structural-pin S10 is asserted structurally — pid-target.ts must import no fs / child_process module
 */
describe("P100: the resolver does no I/O per call (S10)", () => {
  it("pid-target.ts imports no fs / child_process and has no dynamic import", () => {
    const src = readFileSync(join(__dirname, "..", "pid-target.ts"), "utf8");
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const spec of runtimeImports) expect(spec).not.toMatch(/(^|:)(fs|child_process)(\/|$)/);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
  });
  it("is pure over 500 mixed sessions", () => {
    const pool: PidTargetSession[] = [
      s({ pidNamespace: RL }),
      s({ originDeviceId: "d" }),
      s({ pidNamespace: RL_WSL }),
      s({ cwd: "/x" }),
      s({ pidNamespace: null }),
    ];
    const first = Array.from({ length: 500 }, (_, i) => kind(resolvePidTarget(pool[i % 5], SW)));
    const second = Array.from({ length: 500 }, (_, i) => kind(resolvePidTarget(pool[i % 5], SW)));
    expect(second).toEqual(first);
  });
});
