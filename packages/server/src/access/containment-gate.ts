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
 * A site with no response body (`grep-routes`, `resolve-file-mention`) calls
 * `isContainedWithGrant` and discards the denial: it CONSUMES grants but can
 * never originate one, since a grant must trace to a denial the operator saw
 * (design D12).
 *
 * See change: add-access-grants-and-review.
 */

import { lstat } from "node:fs/promises";
import { isAllowed, isGrantAdmitted } from "../lib/path-containment.js";
import { recordPathDenial } from "./access-denials.js";
import { grantedSubjects } from "./access-grants.js";
import { offeredAncestorLadder } from "./ancestor-ladder.js";

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
  const subject = await remedySubject(resolved, opts.subjectKind ?? "file");
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
  return { ...decision, remedy };
}
