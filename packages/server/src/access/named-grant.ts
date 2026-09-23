/**
 * Create a path grant for a subject a recorded denial NAMED (design D15; tasks
 * 5.2, 10.19, 10.20).
 *
 * The one sequence every path-grant creator must run, extracted so the grant
 * route (`POST /api/access/grants`) and the filesystem access plane (a dialog
 * verdict) cannot drift apart. A drift here is an escalation, not a bug: both
 * rules below were added after one-click widenings were found.
 *
 * See changes: add-access-grants-and-review (origin), add-access-grant-dialog
 * (extraction).
 */
import { type AccessGrant, type GrantScope, normalizeGrantSubject, recordGrant } from "./access-grants.js";
import { isUngrantableSubject } from "./forbidden-subjects.js";

export interface NamedGrantInput {
  /** The subject the denial named. */
  deniedSubject: string;
  /** The denial's offered ancestor rungs, as recorded with it. */
  ancestors?: readonly string[];
  /** The subject the operator chose: the denied one or an offered rung. */
  subject: string;
  scope: GrantScope;
  /** Which session's denial produced the grant. */
  origin: string;
  /** Explicit widened-from value; defaults to the denied subject when widened. */
  widenedFrom?: string;
}

export type NamedGrantResult =
  | { ok: true; grant: AccessGrant; widened: boolean }
  | { ok: false; reason: "unnamed" | "forbidden" }
  | { ok: false; reason: "write-failed"; error: string };

export function grantNamedPathSubject(input: NamedGrantInput): NamedGrantResult {
  // The subject must be the one the denial named, or one of its offered
  // ancestors. A sibling, an unrelated directory, or an arbitrary path cannot
  // be grafted onto the grant path. Compared in CANONICAL form, because that is
  // what the store persists: `recordGrant` normalizes a non-directory subject
  // onto its containing directory, so a raw-string comparison would let that
  // normalization move an approved grant off the named subject.
  const named = new Set([input.deniedSubject, ...(input.ancestors ?? [])].map(normalizeGrantSubject));
  const normalized = normalizeGrantSubject(input.subject);
  if (!named.has(normalized)) return { ok: false, reason: "unnamed" };

  // Forbidden subjects, applied identically to a named subject and to a rung,
  // and applied to the NORMALIZED subject, the value that gets persisted.
  // `subsumes` also rejects a rung that would admit a forbidden subject
  // (`/private` admitting `/private/etc` on macOS).
  //
  // Checking only the RAW subject left a one-click escalation: a denial subject
  // is the LEXICAL dirname of the refused path (`grantableSubjectOf`), so it is
  // a regular FILE whenever the refused path has one extra component. Refusing
  // `$HOME/.CFUserTextEncoding/x` named the file `$HOME/.CFUserTextEncoding`,
  // which is not itself forbidden and passed the filter, and it then normalized
  // into a grant for the whole of `$HOME`; `/.file` normalized into a grant for `/`.
  if (isUngrantableSubject(normalized)) return { ok: false, reason: "forbidden" };

  const widened = normalized !== normalizeGrantSubject(input.deniedSubject);
  const result = recordGrant({
    subject: normalized,
    scope: input.scope,
    origin: input.origin,
    widenedFrom: widened ? (input.widenedFrom ?? input.deniedSubject) : undefined,
  });
  // A write failure is reported to the caller so the surface that asked can say
  // the grant did not stick (design D11); the admitted set never widens.
  if (!result.ok) return { ok: false, reason: "write-failed", error: result.error };
  return { ok: true, grant: result.grant, widened };
}
