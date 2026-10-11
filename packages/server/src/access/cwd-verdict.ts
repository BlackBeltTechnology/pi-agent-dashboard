/**
 * The `cwd` plane's verdict re-run and the host seam plugins raise it through.
 *
 * `resolveCwdVerdict` is the ONE post-verdict rule for every `cwd`-plane hold, core
 * (`file-routes:exists`) or plugin (`holdCwdDenial`): a verdict authorises a
 * RE-EVALUATION, never a skip. The subject's real path is re-resolved NOW,
 * existence and the `.git` / ungrantable rules re-applied, then membership of the
 * live known-folder set (sessions ∪ pins) is compared canonically. An `allow-always`
 * additionally re-runs the full guard when the caller supplies one; an `allow-once`
 * admits the single held request when the real path still equals the verdict subject.
 *
 * `createCwdHold` builds the per-plugin `ServerPluginContext.holdCwdDenial`:
 * trusted-gated, closed origin set, never prompts for a missing / `.git` /
 * ungrantable subject, and returns a DECISION (never a token).
 *
 * See change: harden-plugin-cwd-admission (D6).
 */
import path from "node:path";
import {
  CWD_HOLD_ORIGINS,
  type CwdHoldDecision,
  type CwdHoldOrigin,
  type HoldCwdDenialFn,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  type AdmitCwdOptions,
  admitCwd,
  canonPathAsync,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { hasGitPathSegment, realpathAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { type HoldTarget, holdDenial } from "./denial-hold.js";
import { isUngrantableSubject } from "./forbidden-subjects.js";
import type { Resolution } from "./grant-coordinator.js";

export interface VerdictDeps {
  /** LIVE known-folder set: session cwds ∪ pinned directories. */
  known(): string[];
  /**
   * Full guard re-run for an `allow-always` that membership did not already
   * confirm (plugins: `admitCwd`, which may be indeterminate). Absent for the
   * core site, whose guard IS the membership check.
   */
  rerunAlways?(canonCwd: string): Promise<"admit" | "refuse" | "indeterminate">;
}

/** Re-run the guard that denied `cwd` after the operator answered. See module doc. */
export async function resolveCwdVerdict(
  cwd: string,
  resolution: Resolution,
  deps: VerdictDeps,
): Promise<CwdHoldDecision> {
  if (resolution.kind !== "allow") return { kind: "refuse" };
  const real = await realpathAsync(path.resolve(cwd));
  if (real.kind !== "ok") return { kind: "refuse" };
  const canon = real.path;
  if (hasGitPathSegment(canon) || isUngrantableSubject(canon)) return { kind: "refuse" };

  // Canonical membership against sessions ∪ pins, both sides: a session that
  // registered for this cwd while the dialog was open admits too.
  const knownCanon = await Promise.all(deps.known().map(canonPathAsync));
  if (knownCanon.includes(canon)) return { kind: "admit", canonCwd: canon };

  if (resolution.verdict === "allow-always") {
    if (!deps.rerunAlways) return { kind: "refuse" };
    const outcome = await deps.rerunAlways(canon);
    return outcome === "admit" ? { kind: "admit", canonCwd: canon } : { kind: outcome };
  }
  // allow-once: admits only the single held request, and only when the path
  // still means what the operator answered for (a swapped symlink does not).
  return resolution.subject === canon ? { kind: "admit", canonCwd: canon } : { kind: "refuse" };
}

export interface CwdHoldDeps {
  pluginId: string;
  /** `plugin.manifest.priority <= 100` — the `registerCwdPolicy` trust gate. */
  trusted: boolean;
  known(): string[];
  logger: { warn(message: string): void };
  /** Forwarded to the allow-always `admitCwd` re-run (logging, test seams). */
  admitOptions?: AdmitCwdOptions;
  /** Test seam: the hold call. Defaults to the real `holdDenial`. */
  hold?: (facts: Parameters<typeof holdDenial>[0], target?: HoldTarget) => Promise<Resolution>;
}

/** Build one plugin's `holdCwdDenial`. */
export function createCwdHold(deps: CwdHoldDeps): HoldCwdDenialFn {
  const hold = deps.hold ?? holdDenial;
  return async (request, reply, { cwd, origin }): Promise<CwdHoldDecision> => {
    if (!deps.trusted) return { kind: "refuse" };
    if (!(CWD_HOLD_ORIGINS as readonly string[]).includes(origin as CwdHoldOrigin)) {
      deps.logger.warn(`[cwd-admission] plugin "${deps.pluginId}" used unknown hold origin ${JSON.stringify(origin)}`);
      return { kind: "refuse" };
    }
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return { kind: "refuse" };
    // Never prompt for something that cannot be granted or does not exist: the
    // pin would be meaningless (missing), or unsafe (`.git`, `/`, `$HOME`).
    const real = await realpathAsync(path.resolve(cwd));
    if (real.kind !== "ok") return { kind: "refuse" };
    const canon = real.path;
    if (hasGitPathSegment(canon) || isUngrantableSubject(canon)) return { kind: "refuse" };

    const resolution = await hold(
      { plane: "cwd", rawSubject: canon, origin: `plugin:${deps.pluginId}:${origin}` },
      { request, reply },
    );
    return resolveCwdVerdict(cwd, resolution, {
      known: deps.known,
      rerunAlways: async (c) => (await admitCwd(c, deps.known, deps.admitOptions)).kind,
    });
  };
}
