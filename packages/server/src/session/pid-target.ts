/**
 * Resolve WHICH pid namespace a session's recorded `pid` belongs to, before any
 * probe, signal or pid-based link (design D2). The first matching rule wins:
 *
 * 1. `originDeviceId` ⇒ `foreign`.
 * 2. A report is present (`null` = malformed ⇒ `unknown`, S7):
 *    - platform differs ⇒ `foreign`, except a Linux `kind:"wsl"` report to a
 *      win32 server ⇒ `{ wsl, distro }`;
 *    - Linux server: either side lacks `hostId`/`nsId` ⇒ `unknown`; `hostId` or
 *      `nsId` differs ⇒ `foreign`; else `host`;
 *    - macOS/Windows server: either side lacks `hostId` ⇒ `unknown` (S1);
 *      differs ⇒ `foreign`; else `host`.
 * 3. No report (legacy bridge): `ownEntryPid === pid` ⇒ `host`; win32 with a
 *    POSIX-style cwd ⇒ `legacy-wsl`; other win32 ⇒ `unknown`; POSIX ⇒ `host`.
 *
 * Pure: no I/O per call (S10). `ServerPidContext` is computed once at startup.
 * Link-time callers omit `ownEntryPid`, so linking is never circular.
 * See change: scope-pids-to-namespace.
 */
import type { ServerPidContext } from "@blackbelt-technology/pi-dashboard-shared/pid-namespace.js";
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type { ServerPidContext } from "@blackbelt-technology/pi-dashboard-shared/pid-namespace.js";

export type PidTarget =
  | { kind: "host" }
  | { kind: "wsl"; distro: string }
  | { kind: "legacy-wsl" }
  | { kind: "foreign" }
  | { kind: "unknown" };

/** The session fields resolution reads (a stored session or a register message). */
export interface PidTargetSession {
  pid?: number;
  cwd?: string;
  originDeviceId?: string;
  pidNamespace?: PidNamespace | null;
}

const HOST: PidTarget = { kind: "host" };
const FOREIGN: PidTarget = { kind: "foreign" };
const UNKNOWN: PidTarget = { kind: "unknown" };
const LEGACY_WSL: PidTarget = { kind: "legacy-wsl" };

const CAP_PLATFORM = 32;
const CAP_DISTRO = 64;
const CAP_ID = 128;

function capped(v: unknown, cap: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= cap;
}

function optionalCapped(o: Record<string, unknown>, key: string, cap: number): boolean {
  return !(key in o) || o[key] === undefined || capped(o[key], cap);
}

/**
 * Normalise a bridge-supplied `pidNamespace` (untrusted) for storage (S7):
 * `undefined` ⇒ no report (legacy); a valid report ⇒ a fresh copy holding only
 * the known fields; anything malformed or over the caps ⇒ `null` (an unusable
 * report that resolves `unknown`). Never copies an oversized value.
 */
export function sanitizePidNamespace(raw: unknown): PidNamespace | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!capped(o.platform, CAP_PLATFORM)) return null;
  if (o.kind !== "host" && o.kind !== "wsl") return null;
  if (o.kind === "wsl" && !capped(o.distro, CAP_DISTRO)) return null;
  if (!optionalCapped(o, "distro", CAP_DISTRO)) return null;
  if (!optionalCapped(o, "hostId", CAP_ID) || !optionalCapped(o, "nsId", CAP_ID)) return null;
  const ns: PidNamespace = { platform: o.platform as string, kind: o.kind };
  if (typeof o.distro === "string") ns.distro = o.distro;
  if (typeof o.nsId === "string") ns.nsId = o.nsId;
  if (typeof o.hostId === "string") ns.hostId = o.hostId;
  return ns;
}

export function resolvePidTarget(
  session: PidTargetSession,
  ctx: ServerPidContext,
  ownEntryPid?: number,
): PidTarget {
  // 1. Remote origin: another host's namespace, whatever the bridge reported.
  if (session.originDeviceId) return FOREIGN;

  const reported = session.pidNamespace;
  if (reported !== undefined) {
    // A stored report is re-validated (persisted JSON is not trusted either).
    const ns = reported === null ? null : sanitizePidNamespace(reported);
    if (!ns) return UNKNOWN;
    // 2.1 Platform differs.
    if (ns.platform !== ctx.platform) {
      if (ctx.platform === "win32" && ns.platform === "linux" && ns.kind === "wsl" && ns.distro) {
        return { kind: "wsl", distro: ns.distro };
      }
      return FOREIGN;
    }
    // 2.2 Linux server: boot id AND pid namespace.
    if (ctx.platform === "linux") {
      if (!ns.hostId || !ns.nsId || !ctx.hostId || !ctx.nsId) return UNKNOWN;
      if (ns.hostId !== ctx.hostId || ns.nsId !== ctx.nsId) return FOREIGN;
      return HOST;
    }
    // 2.3 macOS / Windows server: hostname only (weak, documented).
    if (!ns.hostId || !ctx.hostId) return UNKNOWN;
    return ns.hostId === ctx.hostId ? HOST : FOREIGN;
  }

  // 3. No report (legacy bridge).
  if (ownEntryPid !== undefined && session.pid !== undefined && ownEntryPid === session.pid) return HOST;
  if (ctx.platform === "win32") return session.cwd?.startsWith("/") ? LEGACY_WSL : UNKNOWN;
  return HOST;
}

/** `wsl`, `legacy-wsl` or `foreign`: never probed, signalled or pid-linked. */
export function isNonLocalTarget(t: PidTarget): boolean {
  return t.kind === "wsl" || t.kind === "legacy-wsl" || t.kind === "foreign";
}

/**
 * May an OPERATOR path (shutdown, force-kill) signal this pid? `host` always;
 * `unknown` only on a Windows server (Q8 — a legacy native Windows pi).
 */
export function operatorMaySignal(t: PidTarget, ctx: ServerPidContext): boolean {
  return t.kind === "host" || (t.kind === "unknown" && ctx.platform === "win32");
}
