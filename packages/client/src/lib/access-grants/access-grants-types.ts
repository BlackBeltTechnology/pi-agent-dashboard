/**
 * Types for the Settings → Access review surface (change:
 * add-access-grants-and-review, design D6/D17).
 *
 * The tab is a READ-AND-REVOKE view over eight existing grant stores. It never
 * migrates them, and two grant-bearing stores are deliberately excluded (see
 * `ACCESS_STORES` below for the rationale citation).
 *
 * The snapshot shapes here mirror what `GET /api/access/grants` aggregates
 * server-side; the server side of this change owns that endpoint. The client
 * keeps the aggregation pure (see `aggregate-access-entries.ts`) so fixture
 * tests exercise it without a live server.
 */

/**
 * The eight in-scope stores (design D6), in display order.
 *
 * Deliberately NOT members (design D6, exclusion rationale):
 * - `paired-devices.json` — device pairing has its own management surface;
 *   duplicating it would create two write paths to the same state.
 * - `auth.bypassUrls` — grants unauthenticated ROUTE access, not access to a
 *   resource; belongs to the auth configuration surface.
 */
export const ACCESS_STORES = [
  "pathGrants",
  "worktreeTrust",
  "kbTrust",
  "projectTrust",
  "trustedNetworks",
  "bypassHosts",
  "corsOrigins",
  "pinnedDirectories",
] as const;

export type AccessStoreId = (typeof ACCESS_STORES)[number];

/** D3 scope vocabulary, reused from the worktree-init-trust precedent. */
type AccessGrantScope = "session" | "project";

/**
 * One snapshot entry of the new path-grant store (`~/.pi/dashboard/
 * access-grants.json`). Persisted AND session-scoped grants share this shape:
 * session grants live in server memory only but carry the same four fields
 * (subject, scope, grantedAt, origin) — design D17 — so the tab can render
 * them like any other entry.
 */
interface PathGrantSnapshotEntry {
  /** Real path recorded at grant time (design D2). Displayed verbatim. */
  subject: string;
  scope: AccessGrantScope;
  grantedAt: string;
  /** Which session's denial produced the grant (design D17). */
  origin: string;
  /** `"prompt"` = written by an allow-always answer (add-access-grant-dialog 8.2). */
  via?: "prompt";
  /** The denied subject when the grant is a wider offered-ancestor rung. */
  widenedFrom?: string;
}

/**
 * One snapshot entry of the KB source-trust store. Entries written before this
 * change carry only `hash`; `subject` is additive and optional, and a
 * hash-only entry must render as its opaque hash rather than error (spec:
 * KB source trust entries are displayable).
 */
interface KbTrustSnapshotEntry {
  hash: string;
  subject?: string;
}

/** Aggregate read shape of `GET /api/access/grants`. */
export interface AccessGrantSnapshot {
  pathGrants: PathGrantSnapshotEntry[];
  /** Worktree-init hook trust subjects (server derives them from the store). */
  worktreeTrust: string[];
  kbTrust: KbTrustSnapshotEntry[];
  /** pi's project-trust store, read through pi's API (never rewritten here). */
  projectTrust: string[];
  trustedNetworks: string[];
  bypassHosts: string[];
  corsOrigins: string[];
  pinnedDirectories: string[];
}

export function emptyAccessGrantSnapshot(): AccessGrantSnapshot {
  return {
    pathGrants: [],
    worktreeTrust: [],
    kbTrust: [],
    projectTrust: [],
    trustedNetworks: [],
    bypassHosts: [],
    corsOrigins: [],
    pinnedDirectories: [],
  };
}

/**
 * One reviewable row. Every row names the store it came from, so a revoke
 * targets the correct store (spec: bypassHosts entries are distinguishable
 * from trustedNetworks).
 */
export interface AccessEntry {
  /**
   * Store-stable identity of the row, unique within the snapshot. For
   * `kbTrust` this is the HASH (the store's own key), even when the displayed
   * subject is the recovered source reference.
   */
  id: string;
  store: AccessStoreId;
  /**
   * What is displayed as the granted subject. For legacy hash-only KB entries
   * this is the opaque hash itself (`legacyHashOnly: true`).
   */
  subject: string;
  /** True when the store cannot display a subject (legacy KB hash-only). */
  legacyHashOnly: boolean;
  /** Path grants only: the D3 scope split. */
  scope?: AccessGrantScope;
  /** Path grants only: grant time (ISO string). */
  grantedAt?: string;
  /** Path grants only: the origin that produced the grant. */
  origin?: string;
  /** Path grants only: `"prompt"` when an access-prompt verdict wrote it. */
  via?: "prompt";
  /** Path grants only: the denied subject a widened grant came from. */
  widenedFrom?: string;
}

/**
 * Why the operator was or was not asked about a refused read — the server's
 * `promptOutcome` (`packages/server/src/access/containment-gate.ts`), mirrored.
 * Disclosed only to an authenticated or genuinely local caller.
 * See change: surface-denial-remedy-in-previews (design D5).
 */
export const PROMPT_OUTCOMES = [
  "cannot-ask",
  "off",
  "not-enforced",
  "ineligible",
  "busy",
  "throttled",
  "recently-answered",
  "allowed-elsewhere",
  "declined",
  "unanswered",
  "ungrantable",
  "grant-failed",
  "allowed-but-refused",
  "unavailable",
] as const;

export type PromptOutcome = (typeof PROMPT_OUTCOMES)[number];

/** The additive remedy fields of a containment 403, mirrored from the server. */
interface DenialRemedy {
  reason: string;
  hint: string;
  subject: string;
  denialId: string;
  ancestors: string[];
  promptOutcome?: PromptOutcome;
}

/** A 403 body as the client reads it: a refusal with or without remedy fields. */
export type ParsedDenialBody =
  | { kind: "denied"; subject: string; denialId: string; promptOutcome?: PromptOutcome }
  | { kind: "refused"; error: string };

/**
 * Parse a 403 body defensively. Only a body with a string `denialId` is a
 * containment denial; anything else is a plain refusal carrying the server's
 * `error` string. An absent or unknown `promptOutcome` yields NO reason — never
 * `unavailable`, which would invent a re-ask the server did not offer.
 */
export function parseDenialBody(body: unknown): ParsedDenialBody {
  // Every field is untrusted until checked below.
  const b: { [K in keyof DenialRemedy]?: unknown } & { error?: unknown } =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof b.denialId === "string" && b.denialId.length > 0) {
    const outcome = (PROMPT_OUTCOMES as readonly unknown[]).includes(b.promptOutcome)
      ? (b.promptOutcome as PromptOutcome)
      : undefined;
    return {
      kind: "denied",
      subject: typeof b.subject === "string" ? b.subject : "",
      denialId: b.denialId,
      ...(outcome ? { promptOutcome: outcome } : {}),
    };
  }
  return { kind: "refused", error: typeof b.error === "string" ? b.error : "" };
}
