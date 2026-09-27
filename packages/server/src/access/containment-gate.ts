/**
 * The single containment gate every file-read site routes through.
 *
 * Before this module each site inlined `isAllowed(...)` and hand-rolled its own
 * 403 body, which is why the remedy fields (design D7) could not be added
 * consistently: there were ten sites, five distinct denial shapes, and two sites
 * with no body at all. The gate keeps the *decision* exactly as it was and adds
 * the remedy additively.
 *
 * Order is load-bearing (design D1, D9):
 *   1. `isAllowed` — the pre-existing layers ①/②, untouched, still authoritative.
 *   2. the grant layer — a dedicated subtree predicate, only reached on a miss.
 *   3. on a miss at a body-emitting site, record the denial so the remedy can be
 *      bound to it (design D15/D20) and return the additive fields.
 *
 * A site with no response body (`grep-routes`, `resolve-file-mention`) composes
 * `isAllowed` + `isGrantAdmitted` itself and discards the answer: it CONSUMES
 * grants but can never originate one, since a grant must trace to a denial the
 * operator saw (design D12). (This comment previously named an
 * `isContainedWithGrant` helper that does not exist — task 4.5 fresh cycle.)
 *
 * See change: add-access-grants-and-review.
 */

import { lstat } from "node:fs/promises";
import { isAllowed, isGrantAdmitted } from "../lib/path-containment.js";
import { recordPathDenial } from "./access-denials.js";
import { grantedSubjects } from "./access-grants.js";
import { offeredAncestorLadder } from "./ancestor-ladder.js";
import { type HoldTarget, holdDenial } from "./denial-hold.js";
import { isUngrantableSubject, realpathNearestAncestor } from "./forbidden-subjects.js";
import type { Resolution } from "./grant-coordinator.js";
import type { FloodReason, PreconditionReason, RefusalReason } from "./pending-grant-registry.js";

/** The grantable subject of a refused path: its containing directory. */
function grantableSubjectOf(resolved: string): string {
  return resolved.replace(/[/\\][^/\\]*$/, "") || resolved;
}

/**
 * What the remedy should NAME (design D20, task 4.5 round 2).
 *
 * - `"file"` — the containing directory is what unblocks a refused file read.
 * - `"directory"` — the resource IS the directory, so name it. Naming the parent
 *   would offer every SIBLING tree in one click.
 * - `"auto"` — a POLYMORPHIC site (`/api/file`, `/api/file/exists`) admits both,
 *   so the target's own kind decides. Passed by sites that cannot know statically.
 */
type SubjectKind = "file" | "directory" | "auto";

async function remedySubject(resolved: string, kind: SubjectKind): Promise<string> {
  if (kind === "directory") return resolved;
  if (kind === "file") return grantableSubjectOf(resolved);
  // "auto". On an INDETERMINATE lstat, answer with the resource itself rather
  // than its parent: `recordGrant` normalizes a non-directory onto its
  // containing directory, so a file subject still resolves correctly, whereas
  // naming the PARENT of a directory is the widening bug this exists to avoid.
  // The invariant is "never wider than the refused resource".
  try {
    return (await lstat(resolved)).isDirectory() ? resolved : grantableSubjectOf(resolved);
  } catch {
    return resolved;
  }
}

export interface ContainmentDecision {
  allowed: boolean;
  /** True when the grant layer (not layers ①/②) admitted the path. */
  viaGrant: boolean;
}

/** The additive remedy fields carried beside an unchanged `error` string. */
export interface DenialRemedy {
  reason: string;
  hint: string;
  /** The directory that would unblock this read. */
  subject: string;
  /** Binds a later grant request to this refusal (design D15). */
  denialId: string;
  /**
   * Ancestors the remedy may also offer, nearest-first (task 7b.1a). ALWAYS
   * present (possibly empty) so the denial body has a deterministic key set —
   * an occasionally-absent field makes every strict assertion on the body
   * conditional, which is how body assertions rot.
   */
  ancestors: string[];
  /**
   * Why the operator was or was not asked (design D5). Present only when the
   * site passed `disclosure: true` (an authenticated or genuinely local caller):
   * it reveals the same prompting posture `/api/health` withholds from others.
   */
  promptOutcome?: PromptOutcome;
}

/**
 * The closed set a denial body names (see change: surface-denial-remedy-in-previews,
 * design D5). The client mirrors it; `unavailable` is the catch-all.
 */
export type PromptOutcome =
  | "cannot-ask"
  | "off"
  | "not-enforced"
  | "ineligible"
  | "busy"
  | "throttled"
  | "recently-answered"
  | "allowed-elsewhere"
  | "declined"
  | "unanswered"
  | "ungrantable"
  | "grant-failed"
  | "allowed-but-refused"
  | "unavailable";

/**
 * The registry's typed reasons. A `Record` keyed by the union is exhaustive at
 * compile time: a reason added to any of the three unions without a row here
 * fails the build instead of falling to `unavailable`.
 */
const TYPED_REASON_OUTCOMES: Record<PreconditionReason | RefusalReason | FloodReason, PromptOutcome> = {
  disabled: "off",
  "report-mode": "not-enforced",
  ineligible: "ineligible",
  "no-audience": "unavailable",
  "channel-concurrent": "busy",
  "concurrent-cap": "busy",
  "plane-rate": "throttled",
  "channel-rate": "throttled",
  capacity: "throttled",
  "channel-share": "throttled",
  "deferred-share": "throttled",
  backoff: "recently-answered",
};

/** The coordinator's untyped `Resolution.reason` literals, each with an explicit row. */
const COORDINATOR_REASON_OUTCOMES: Readonly<Record<string, PromptOutcome>> = {
  "no-coordinator": "off",
  "unknown-plane": "unavailable",
  "not-held": "unavailable",
  "waiters-full": "throttled",
  "broadcast-failed": "throttled",
  "allow-once-not-shared": "allowed-elsewhere",
  denied: "declined",
  "refused-by-prior-refusal": "declined",
  expired: "unanswered",
  aborted: "unanswered",
  "not-promptable": "ungrantable",
  "settle-failed": "grant-failed",
};

/**
 * The explicit row for a deny reason, or `undefined` when none exists. Split
 * from `promptOutcomeOf` so a test can assert every emitted literal has a row
 * of its own rather than silently reaching the default.
 */
export function promptOutcomeRow(reason: string): PromptOutcome | undefined {
  if (Object.hasOwn(TYPED_REASON_OUTCOMES, reason)) {
    return TYPED_REASON_OUTCOMES[reason as keyof typeof TYPED_REASON_OUTCOMES];
  }
  if (Object.hasOwn(COORDINATOR_REASON_OUTCOMES, reason)) return COORDINATOR_REASON_OUTCOMES[reason];
  if (reason === "persist-failed:forbidden") return "ungrantable";
  if (reason.startsWith("persist-failed:")) return "grant-failed";
  return undefined;
}

/** A deny reason's outcome; a literal not emitted today is `unavailable`. */
export function promptOutcomeOf(reason: string): PromptOutcome {
  return promptOutcomeRow(reason) ?? "unavailable";
}

/**
 * The outcome for one denial, first match (design D5): an ungrantable subject,
 * then a site that can never suspend, then the reason, then an allow verdict the
 * re-evaluation refused.
 */
function outcomeFor(resolution: Resolution, held: boolean): PromptOutcome {
  if (resolution.kind === "deny" && resolution.reason === "not-promptable") return "ungrantable";
  if (!held) return "cannot-ask";
  // Only reached for an allow when the re-evaluation refused it.
  return resolution.kind === "deny" ? promptOutcomeOf(resolution.reason) : "allowed-but-refused";
}

/**
 * Evaluate containment at a site that emits a denial body. On a miss, records
 * the denial and returns the remedy fields; on a hit, `remedy` is absent.
 *
 * `site` is a stable identifier (`file-routes:661`) so the Access surface and
 * the tests can attribute a refusal to the site that produced it.
 *
 * `allowGrant` (default `true`) lets a site declare that a grant must NOT admit
 * it. A grant is a READ remedy; `open-in-system` / `reveal-in-file-manager`
 * spawn a local application instead, so they pass `false` and keep exactly the
 * pre-change `isAllowed`-only decision. Without this the grant layer silently
 * widened a read grant into an app-launch capability (task 4.5 review gate).
 */
export async function evaluateContainment(
  resolved: string,
  anchors: string[],
  opts: {
    site: string;
    session?: string;
    allowGrant?: boolean;
    subjectKind?: SubjectKind;
    /**
     * The live request/reply, when this site can SUSPEND the read while the
     * operator is asked (design D7). Absent: the denial is recorded and answered
     * at once, exactly as before. See change: add-access-grant-dialog.
     */
    hold?: HoldTarget;
    /**
     * Include `promptOutcome` in the remedy. Computed by the route from the
     * shared disclosure predicate (`canDiscloseAccessPosture`); a separate option
     * because holdless sites disclose too. See change:
     * surface-denial-remedy-in-previews.
     */
    disclosure?: boolean;
  },
): Promise<ContainmentDecision & { remedy?: DenialRemedy }> {
  // Layers ①/② first — untouched and still authoritative (design D1) — then the
  // grant layer, and only on a miss does the denial get recorded.
  let decision: ContainmentDecision;
  if (await isAllowed(resolved, { anchors })) {
    decision = { allowed: true, viaGrant: false };
  } else if ((opts.allowGrant ?? true) && (await isGrantAdmitted(resolved, grantedSubjects()))) {
    decision = { allowed: true, viaGrant: true };
  } else {
    decision = { allowed: false, viaGrant: false };
  }
  if (decision.allowed) return decision;

  // A site that cannot be ADMITTED by a grant must not ORIGINATE one. Recording a
  // denial here would return a `denialId` the operator could accept, minting a
  // read grant that cannot remedy the refused operation — a remedy loop with no
  // reachable fix, which is the one thing the denial registry (D15/D20) exists to
  // prevent. So a grant-ineligible site refuses with exactly the plain error it
  // returned before this change and records nothing: no remedy fields, therefore
  // no `denialId`, therefore no grant. Callers tolerate the absent remedy —
  // `denialBody` emits only the fields that are present. (Task 4.5, fresh cycle
  // round 1: `allowGrant: false` previously blocked admission but still minted a
  // remedy at `/api/open-in-system` and `/api/reveal-in-file-manager`.)
  if (opts.allowGrant === false) return decision;

  // `subjectKind` decides what the remedy names — see `remedySubject`. The
  // default ("file") is right for the majority of sites (a refused file read);
  // directory-only and polymorphic sites must say so explicitly.
  //
  // Symlinks are resolved in the chosen subject FIRST, so the ladder, the
  // recorded denial, the body and the dialog all derive from the one string a
  // grant would store (`/tmp` → `/private/tmp`). Resolving a symlink never
  // widens: it names the same resource (design D6).
  const subject = realpathNearestAncestor(await remedySubject(resolved, opts.subjectKind ?? "file"));
  let ancestors: string[] = [];
  try {
    ancestors = await offeredAncestorLadder(subject);
  } catch {
    // A ladder failure must never turn a denial into a 500 — the read still
    // refuses, just without an offer to widen.
    ancestors = [];
  }

  const entry = recordPathDenial({
    subject,
    site: opts.site,
    session: opts.session,
    ancestors,
  });

  const remedy: DenialRemedy = {
    reason: "Path is outside every containment anchor for this session.",
    hint: "Grant access to this directory from the denial's remedy, or open the file from a session rooted in it.",
    subject: entry.subject,
    denialId: entry.denialId,
    ancestors,
  };

  // Ask the operator, if this denial may be asked about (add-access-grant-dialog).
  // Any outcome other than an allow verdict leaves the denial exactly as above.
  const resolution = await holdDenial(
    { plane: "filesystem", rawSubject: entry.subject, ancestors, origin: opts.session ?? "unknown" },
    opts.hold,
  );
  const reEvaluated = resolution.kind === "allow" && (await reEvaluate(resolved, anchors, resolution));
  if (reEvaluated) return { allowed: true, viaGrant: true };
  if (opts.disclosure) remedy.promptOutcome = outcomeFor(resolution, opts.hold !== undefined);
  return { ...decision, remedy };
}

/**
 * A verdict authorises a RE-EVALUATION, never a resumption that skips the check
 * (spec: "A resumed request re-runs the guard it was denied by"; tasks 6.4, 2b.5).
 * Every layer runs again against the filesystem as it is NOW, so a subject
 * swapped for a symlink after the verdict, a grant revoked in the meantime, or a
 * sibling outside the answered subject is still denied.
 *
 *   - `allow-always`: the grant was persisted, so the ordinary layers admit it.
 *   - `allow-once`: nothing was persisted; the answered subject is applied as a
 *     transient, real-path grant for THIS request only, and never for a subject
 *     the forbidden rule refuses.
 */
async function reEvaluate(
  resolved: string,
  anchors: string[],
  resolution: Extract<Resolution, { kind: "allow" }>,
): Promise<boolean> {
  if (await isAllowed(resolved, { anchors })) return true;
  if (await isGrantAdmitted(resolved, grantedSubjects())) return true;
  if (resolution.verdict !== "allow-once") return false;
  if (isUngrantableSubject(resolution.subject)) return false;
  return isGrantAdmitted(resolved, [resolution.subject]);
}
