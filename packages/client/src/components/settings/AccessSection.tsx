/**
 * Settings → Access section (change: add-access-grants-and-review).
 *
 * Read-and-revoke view over the eight in-scope grant stores (design D6),
 * aggregated client-side by `aggregateAccessEntries` from one snapshot fetch.
 *
 * Reviews and revokes; it NEVER creates a grant (design D12): a filesystem
 * grant originates only from the remedy surface attached to an actual denial,
 * so this section has no add control by construction — the composition test
 * pins that no control here can create a grant for an arbitrary subject.
 *
 * Rendering performs zero store writes: the only request issued is the
 * aggregate GET on mount (task 7.7).
 *
 * Styling: theme tokens only — no raw hex, no raw px, no z-index (7.11).
 */
import { useCallback, useEffect, useState } from "react";
import { fetchAccessSnapshot, revokeAccessEntry } from "../../lib/access-grants/access-grants-api.js";
import type {
  AccessEntry,
  AccessGrantSnapshot,
  AccessStoreId,
} from "../../lib/access-grants/access-grants-types.js";
import { aggregateAccessEntries, groupAccessEntriesByStore } from "../../lib/access-grants/aggregate-access-entries.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** English labels — the en catalog is intentionally empty (call-site English). */
const STORE_LABEL_EN: Record<AccessStoreId, string> = {
  pathGrants: "Path grants — access-grants.json",
  worktreeTrust: "Worktree-init trust — worktree-init-trust.json",
  kbTrust: "KB source trust — kb-source-trust.json",
  projectTrust: "Project trust — managed by pi",
  trustedNetworks: "Trusted networks — config.trustedNetworks",
  bypassHosts: "Auth bypass hosts — auth.bypassHosts",
  corsOrigins: "CORS allowed origins — cors.allowedOrigins",
  pinnedDirectories: "Pinned directories — preferences",
};

function storeLabel(store: AccessStoreId): string {
  return i18nT(`access.store.${store}`, undefined, STORE_LABEL_EN[store]);
}

function scopeLabel(scope: "session" | "project"): string {
  return scope === "session"
    ? i18nT("access.scopeSession", undefined, "Session (server process)")
    : i18nT("access.scopeProject", undefined, "Project");
}

export function AccessSection() {
  const [snapshot, setSnapshot] = useState<AccessGrantSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const result = await fetchAccessSnapshot();
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? `HTTP ${result.status}`);
    }
  }, []);

  // Mount-only read. No store write happens anywhere in this section's render
  // path (task 7.7).
  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = useCallback(
    async (entry: AccessEntry) => {
      setRevokeError(null);
      setRevoking((prev) => new Set(prev).add(entry.id));
      try {
        // No snapshot argument: each store revokes per entry, so concurrent
        // revokes cannot resurrect each other (task 4.5 #5).
        const result = await revokeAccessEntry(entry);
        if (!result.ok) {
          setRevokeError(result.error ?? `HTTP ${result.status}`);
          return;
        }
        // Revocation takes effect on the next request without a restart: the
        // refetch reads the store the gate consults, and the entry is gone.
        await load();
      } finally {
        setRevoking((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [load],
  );

  const entries = snapshot ? aggregateAccessEntries(snapshot) : [];
  const groups = groupAccessEntriesByStore(entries);

  return (
    <div data-testid="access-section" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {i18nT("access.title", undefined, "Access grants")}
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {i18nT(
            "access.description",
            undefined,
            "Every access grant across all grant stores, labelled with the store it lives in.",
          )}
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1" data-testid="access-review-only">
          {i18nT(
            "access.reviewOnly",
            undefined,
            "Review and revoke only — a grant is created only from the remedy attached to an actual denial, never here.",
          )}
        </p>
      </div>

      {loadError && (
        <div data-testid="access-error" className="text-sm text-[var(--accent-red)]" role="alert">
          {i18nT("access.loadFailed", { error: loadError }, "Couldn't load access grants: {error}")}
        </div>
      )}

      {revokeError && (
        <div data-testid="access-revoke-error" className="text-sm text-[var(--accent-red)]" role="alert">
          {i18nT("access.revokeFailed", { error: revokeError }, "Revoke failed: {error}")}
        </div>
      )}

      {snapshot && entries.length === 0 && (
        <div
          data-testid="access-empty-state"
          className="border border-[var(--border-primary)] rounded p-4 bg-[var(--bg-secondary)]"
        >
          <p className="text-sm text-[var(--text-secondary)]">
            {i18nT("access.emptyTitle", undefined, "No access grants")}
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {i18nT("access.emptyBody", undefined, "No store currently holds a grant.")}
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.store} data-testid={`access-store-${group.store}`}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
            {storeLabel(group.store)}
          </h3>
          <div className="border border-[var(--border-primary)] rounded divide-y divide-[var(--border-primary)] bg-[var(--bg-secondary)]">
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                data-testid="access-entry"
                data-store={entry.store}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm text-[var(--text-primary)] break-all">
                      {entry.subject}
                    </span>
                    {entry.legacyHashOnly && (
                      <span
                        data-testid="access-legacy-hash"
                        title={i18nT(
                          "access.legacyHashHint",
                          undefined,
                          "Legacy entry: only a hash was recorded, so the source cannot be displayed. Revoking removes the hash.",
                        )}
                        className="shrink-0 text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1.5 text-xs bg-[var(--bg-surface)]"
                      >
                        {i18nT("access.legacyHashBadge", undefined, "hash only")}
                      </span>
                    )}
                  </div>
                  {entry.scope && (
                    <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-[var(--text-tertiary)]">
                      <span data-testid="access-entry-scope">
                        {i18nT("access.columnScope", undefined, "Scope")}: {scopeLabel(entry.scope)}
                      </span>
                      {entry.grantedAt && (
                        <span data-testid="access-entry-granted">
                          {i18nT("access.columnGranted", undefined, "Granted")}: {entry.grantedAt}
                        </span>
                      )}
                      {entry.origin && (
                        <span data-testid="access-entry-origin">
                          {i18nT("access.columnOrigin", undefined, "Origin")}: {entry.origin}
                        </span>
                      )}
                      {entry.via === "prompt" && (
                        <span data-testid="access-entry-via-prompt">
                          {i18nT("access.viaPrompt", undefined, "via prompt")}
                        </span>
                      )}
                      {entry.widenedFrom && (
                        <span data-testid="access-entry-widened">
                          {i18nT("access.widenedFrom", { subject: entry.widenedFrom }, "widened from {subject}")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="access-revoke"
                  aria-label={`${i18nT("access.revoke", undefined, "Revoke")} ${entry.subject}`}
                  disabled={revoking.has(entry.id)}
                  onClick={() => void handleRevoke(entry)}
                  className="shrink-0 px-2 py-1 rounded text-sm border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 cursor-pointer"
                >
                  {i18nT("access.revoke", undefined, "Revoke")}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
