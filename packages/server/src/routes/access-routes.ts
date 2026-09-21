/**
 * REST surface for the Settings → Access review tab, plus the **grant endpoint**
 * that is the one place a filesystem grant can be created.
 *
 * Three groups:
 *
 *   READ     `GET /api/access/grants` — aggregate every in-scope store. This is
 *            a pure read; loading the tab performs zero writes (design D6).
 *   REVOKE   `DELETE /api/access/{grants,worktree-trust,kb-trust,bypass-hosts}` —
 *            each store revoked against ITS OWN write path, because the tab
 *            reads the stores where they live and never migrates them.
 *   CREATE   `POST /api/access/grants` — the grant endpoint (design D12/D15).
 *
 * **Why the grant endpoint is bounded.** D12 removes the settings-page "add a
 * directory" field: a grant must trace to a refusal the operator actually saw,
 * or trust would widen with no triggering event. So the request must carry a
 * `denialId`, the subject must be one the recorded denial named (or one of its
 * offered ancestors), and the forbidden-subject filter applies to both.
 *
 * **Stated limit, not overclaimed (design D15).** This is enforced against
 * remote and cross-origin callers. It does NOT establish operator presence:
 * `auth-plugin.ts` returns early for a genuinely local request, so any local
 * process — including an agent's own `bash` tool — can read a 403, learn the
 * subject it names, and satisfy the binding itself. Distinguishing the operator
 * from a local process is the eligibility problem carved into
 * `add-access-grant-dialog`, which this change does not solve and must not claim
 * to. The binding constrains parties that cannot see the denial body.
 *
 * See change: add-access-grants-and-review.
 */
import * as fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { getPathDenial } from "../access/access-denials.js";
import {
  __accessGrantsLoadCount,
  type GrantScope,
  listGrants,
  normalizeGrantSubject,
  recordGrant,
  revokeGrant,
} from "../access/access-grants.js";
import { isUngrantableSubject } from "../access/forbidden-subjects.js";
import { readRawConfig } from "../config-api.js";
import { revokeTrust as revokeWorktreeTrust } from "../git-worktree/worktree-init-trust.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { AGENT_DIR } from "../pi/pi-resource-activation.js";
import { persistTrustDecision } from "../pi/resource-toggle-trust.js";
import type { NetworkGuard } from "./route-deps.js";

/** pi's own project-trust store file. Read in place; never rewritten here. */
function projectTrustPath(): string {
  return path.join(AGENT_DIR, "trust.json");
}

/**
 * Every folder pi's trust store holds a decision for, as stored.
 *
 * `ProjectTrustStore` exposes no enumeration (`get`/`getEntry` only), so the
 * file is read directly. That is a READ of a store this change does not own —
 * the tab presents it in place and revokes through pi's own API (design D13).
 * A malformed file degrades to an empty list rather than failing the tab.
 */
function readProjectTrustSubjects(): string[] {
  try {
    const raw = fs.readFileSync(projectTrustPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

/**
 * KB source-trust entries, read IN PLACE from `kb-source-trust.json`.
 *
 * Read-only on purpose: the dashboard server has no dependency on the kb
 * package, so the WRITE (revoke) is owned by the kb-plugin, which already
 * imports kb's own module — the store is revoked through its owner rather than
 * rewritten behind its back (design D6).
 */
function readKbTrustEntries(): Array<{ hash: string; subject: string | null }> {
  try {
    const p = path.join(path.dirname(projectTrustPath()), "..", "dashboard", "kb-source-trust.json");
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v === true || (typeof v === "object" && v !== null))
      .map(([hash, v]) => ({
        hash,
        // A legacy entry is the bare literal `true` and has no displayable
        // subject — the tab renders its opaque hash (task 7.6).
        subject:
          v === true
            ? null
            : typeof (v as { subject?: unknown }).subject === "string"
              ? ((v as { subject: string }).subject)
              : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Subjects of the persisted worktree-init trust store. Keys are
 * `repoRoot\0hash`, so only the repo root is displayable — the hash is an
 * opaque hook fingerprint, not a subject.
 */
function readWorktreeTrustSubjects(): string[] {
  try {
    const p = path.join(
      path.dirname(projectTrustPath()),
      "..",
      "dashboard",
      "worktree-init-trust.json",
    );
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object") return [];
    return [...new Set(Object.keys(parsed as Record<string, unknown>).map((k) => k.split("\u0000")[0]))];
  } catch {
    return [];
  }
}

export function registerAccessRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    preferencesStore: PreferencesStore;
    /** Config write path (the tab revokes trusted networks / CORS origins here). */
    writeConfigPartial: (partial: Record<string, unknown>) => { success: boolean; error?: string };
  },
): void {
  const { networkGuard, preferencesStore, writeConfigPartial } = deps;

  // ── READ: aggregate every in-scope store ────────────────────────────
  // Pure read. `bypassHosts` is listed SEPARATELY from `trustedNetworks` (they
  // are distinct stores with distinct revoke paths, even though auth merges them
  // at runtime). Two grant-bearing stores are deliberately excluded: device
  // pairing has its own surface, and `auth.bypassUrls` grants route access, not
  // resource access (design D6).
  fastify.get("/api/access/grants", { preHandler: networkGuard }, async () => {
    const config = loadConfig();
    return {
      success: true,
      data: {
        pathGrants: listGrants().map((g) => ({
          subject: g.subject,
          scope: g.scope,
          grantedAt: new Date(g.grantedAt).toISOString(),
          origin: g.origin,
        })),
        worktreeTrust: readWorktreeTrustSubjects(),
        kbTrust: readKbTrustEntries(),
        projectTrust: readProjectTrustSubjects(),
        trustedNetworks: config.trustedNetworks ?? [],
        bypassHosts: config.auth?.bypassHosts ?? [],
        corsOrigins: config.cors?.allowedOrigins ?? [],
        pinnedDirectories: preferencesStore.getPinnedDirectories(),
      },
    } satisfies ApiResponse;
  });

  // ── REVOKE: path grants ─────────────────────────────────────────────
  fastify.delete<{ Body: { subject?: string; scope?: GrantScope } }>(
    "/api/access/grants",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { subject, scope } = request.body ?? {};
      if (!subject || typeof subject !== "string") {
        reply.code(400);
        return { success: false, error: "subject is required" } satisfies ApiResponse;
      }
      const removed = revokeGrant(subject, scope);
      if (!removed) {
        reply.code(404);
        return { success: false, error: "no such grant" } satisfies ApiResponse;
      }
      // Revocation invalidates the in-memory set, so it takes effect on the
      // NEXT request with no restart (design D16).
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── REVOKE: worktree-init hook trust (also clears in-memory session trust) ──
  fastify.delete<{ Body: { subject?: string; hash?: string } }>(
    "/api/access/worktree-trust",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { subject, hash } = request.body ?? {};
      if (!subject || typeof subject !== "string") {
        reply.code(400);
        return { success: false, error: "subject is required" } satisfies ApiResponse;
      }
      // The store is keyed `repoRoot\0hash`; an absent hash means "every hook
      // fingerprint recorded for this repo", which is what the tab displays.
      revokeWorktreeTrust(subject, hash ?? "");
      return { success: true } satisfies ApiResponse;
    },
  );

  // KB source trust is revoked at `DELETE /api/kb/source-trust`, registered by
  // the kb-plugin — the package that owns kb's trust module and can call its
  // own `revokeTrust`. The dashboard server reads that store in place for
  // display only and never rewrites it (design D6).

  // ── REVOKE: auth bypass hosts (NEVER trustedNetworks) ───────────────
  fastify.delete<{ Body: { host?: string } }>(
    "/api/access/bypass-hosts",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { host } = request.body ?? {};
      if (!host || typeof host !== "string") {
        reply.code(400);
        return { success: false, error: "host is required" } satisfies ApiResponse;
      }
      const config = loadConfig();
      const remaining = (config.auth?.bypassHosts ?? []).filter((h) => h !== host);
      const result = writeConfigPartial({ auth: { ...config.auth, bypassHosts: remaining } });
      if (!result.success) {
        reply.code(500);
        return { success: false, error: result.error ?? "config write failed" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── REVOKE: trusted networks and CORS origins, per entry (task 4.5 #5) ──
  // Both are ARRAY-valued config fields. The client used to send the WHOLE array
  // computed from a snapshot it had already rendered, so two revokes issued
  // before the first refetch landed both derived from that same stale array and
  // the second write resurrected the entry the first had just revoked. These
  // read-modify-write server-side instead — the same shape as `bypass-hosts`
  // above — so the removal is atomic per entry and independent of any client
  // snapshot, including one held by a second browser tab.
  fastify.delete<{ Body: { network?: string } }>(
    "/api/access/trusted-network",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { network } = request.body ?? {};
      if (!network || typeof network !== "string") {
        reply.code(400);
        return { success: false, error: "network is required" } satisfies ApiResponse;
      }
      const config = loadConfig();
      const remaining = (config.trustedNetworks ?? []).filter((n) => n !== network);
      const result = writeConfigPartial({ trustedNetworks: remaining });
      if (!result.success) {
        reply.code(500);
        return { success: false, error: result.error ?? "config write failed" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  fastify.delete<{ Body: { origin?: string } }>(
    "/api/access/cors-origin",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { origin } = request.body ?? {};
      if (!origin || typeof origin !== "string") {
        reply.code(400);
        return { success: false, error: "origin is required" } satisfies ApiResponse;
      }
      // Read the RAW `cors` object, NOT `loadConfig().cors`. `writeConfigPartial`
      // replaces whole top-level keys, so rebuilding `cors` from the TYPED view
      // would silently DROP any key the `CorsConfig` type does not model — a
      // data-loss bug a seeded-config test caught here (task 4.5 fresh round 1).
      const rawCors = (readRawConfig().cors ?? {}) as Record<string, unknown>;
      const rawOrigins = Array.isArray(rawCors.allowedOrigins) ? rawCors.allowedOrigins : [];
      const remaining = rawOrigins.filter((o) => o !== origin);
      const result = writeConfigPartial({ cors: { ...rawCors, allowedOrigins: remaining } });
      if (!result.success) {
        reply.code(500);
        return { success: false, error: result.error ?? "config write failed" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── REVOKE: project trust, routed through pi's own API (design D13) ──
  // `decision: null` DELETES the entry in pi's store (`setMany` does
  // `delete data[key]`); it never records a standing refusal. The dashboard
  // therefore does not write pi's store directly.
  fastify.delete<{ Body: { subject?: string } }>(
    "/api/access/project-trust",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { subject } = request.body ?? {};
      if (!subject || typeof subject !== "string") {
        reply.code(400);
        return { success: false, error: "subject is required" } satisfies ApiResponse;
      }
      try {
        // Through `persistTrustDecision`, NOT a direct
        // `new ProjectTrustStore(AGENT_DIR).setMany(...)`: the spec
        // (`access-settings-tab/spec.md`) mandates the repository wrapper, and it
        // is the single place that knows `decision: null` DELETES the key rather
        // than recording a standing refusal (design D13). Writing the store
        // directly duplicated that knowledge and diverged from the wrapper.
        await persistTrustDecision(AGENT_DIR, [{ path: subject, decision: null }]);
      } catch (err) {
        reply.code(500);
        return {
          success: false,
          error: `failed to revoke project trust: ${(err as Error)?.message ?? String(err)}`,
        } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── REVOKE: pinned directories (the preferences-store write path) ────
  fastify.delete<{ Body: { subject?: string } }>(
    "/api/access/pinned-directory",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { subject } = request.body ?? {};
      if (!subject || typeof subject !== "string") {
        reply.code(400);
        return { success: false, error: "subject is required" } satisfies ApiResponse;
      }
      preferencesStore.unpinDirectory(subject);
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── CREATE: the grant endpoint (design D12/D15/D20) ──────────────────
  fastify.post<{
    Body: { denialId?: string; subject?: string; scope?: GrantScope; widenedFrom?: string };
  }>("/api/access/grants", { preHandler: networkGuard }, async (request, reply) => {
    const { denialId, subject, scope, widenedFrom } = request.body ?? {};

    // (a) Cross-origin invocation is refused by the dashboard's global
    // `createMutationOriginGate` (`onRequest`, registered over every `/api/*`
    // non-GET), NOT by a check here — so the refusal cannot drift from the
    // admission rules the rest of the API uses. `access-routes.test.ts` asserts
    // a cross-origin POST to THIS route is refused, exercising the real gate.
    //
    // (b) Authentication. `networkGuard` admits loopback unauthenticated by
    // design, so this is the explicit auth requirement the spec names — it does
    // NOT establish operator presence (see this file's header).
    if (!(request as { isAuthenticated?: boolean }).isAuthenticated && !isLocalRequest(request)) {
      reply.code(401);
      return { success: false, error: "authentication required" } satisfies ApiResponse;
    }

    // (c) The request must name a LIVE recorded denial (design D15).
    if (!denialId || typeof denialId !== "string") {
      reply.code(400);
      return { success: false, error: "denialId is required" } satisfies ApiResponse;
    }
    const denial = getPathDenial(denialId);
    if (!denial) {
      reply.code(409);
      return {
        success: false,
        error: "unknown or expired denial; re-trigger the refused request to grant it",
      } satisfies ApiResponse;
    }

    if (!subject || typeof subject !== "string") {
      reply.code(400);
      return { success: false, error: "subject is required" } satisfies ApiResponse;
    }

    // (d) The subject must be the one the denial named, or one of its offered
    // ancestors. A sibling, an unrelated directory, or an arbitrary path cannot
    // be grafted onto the grant path. Compared in CANONICAL form, because that
    // is what the store persists — `recordGrant` normalizes a non-directory
    // subject onto its containing directory, so a raw-string comparison would
    // let that normalization move an approved grant off the named subject.
    const named = new Set(
      [denial.subject, ...(denial.ancestors ?? [])].map(normalizeGrantSubject),
    );
    const normalized = normalizeGrantSubject(subject);
    if (!named.has(normalized)) {
      reply.code(403);
      return {
        success: false,
        error: "subject was not named by that denial",
      } satisfies ApiResponse;
    }

    // (e) Forbidden subjects, applied identically to a named subject and to a
    // rung, and applied to the NORMALIZED subject — the value that gets
    // persisted. `subsumes` also rejects a rung that would admit a forbidden
    // subject (`/private` admitting `/private/etc` on macOS).
    //
    // Checking only the RAW subject left a one-click escalation: a denial
    // subject is the LEXICAL dirname of the refused path (`grantableSubjectOf`),
    // so it is a regular FILE whenever the refused path has one extra component.
    // Refusing `$HOME/.CFUserTextEncoding/x` named the file
    // `$HOME/.CFUserTextEncoding`, which is not itself forbidden and passed the
    // filter, and it then normalized into a grant for the whole of `$HOME`;
    // `/.file` normalized into a grant for `/`.
    if (isUngrantableSubject(normalized)) {
      reply.code(403);
      return { success: false, error: "subject may not be granted" } satisfies ApiResponse;
    }

    const widened = normalized !== normalizeGrantSubject(denial.subject);
    const result = recordGrant({
      subject: normalized,
      scope: scope === "session" ? "session" : "project",
      origin: denial.session,
      widenedFrom: widened ? (widenedFrom ?? denial.subject) : undefined,
    });

    // A write failure is reported IN THIS RESPONSE so the surface that asked can
    // say the grant did not stick (design D11). The refused read still 403s
    // exactly as it would have; the admitted set never widens on a failure.
    if (!result.ok) {
      reply.code(500);
      return { success: false, error: `grant not recorded: ${result.error}` } satisfies ApiResponse;
    }

    // Audited (STRIDE: Repudiation), mirroring the network-trust accept path
    // (`[network-trust] accepted pending request ip=…`). A grant is a PERSISTENT
    // filesystem widening, so it must leave an operational trail and not only a
    // store entry. See change: add-access-grants-and-review (task 7b.4).
    console.log(
      `[access-grant] granted subject=${result.grant.subject} scope=${result.grant.scope} site=${
        denial.site
      } denialId=${denialId}${widened ? ` widenedFrom=${denial.subject}` : ""}`,
    );
    return { success: true, data: result.grant } satisfies ApiResponse;
  });

  // Diagnostics: confirms the containment hot path never re-reads the store.
  fastify.get("/api/access/store-stats", { preHandler: networkGuard }, async () => {
    return { success: true, data: { loads: __accessGrantsLoadCount() } } satisfies ApiResponse;
  });
}

/**
 * A genuinely-local request. Mirrors `auth-plugin`'s own early return, which is
 * exactly why the grant endpoint's auth requirement cannot establish operator
 * presence (design D15).
 */
function isLocalRequest(request: { ip?: string }): boolean {
  const ip = request.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
