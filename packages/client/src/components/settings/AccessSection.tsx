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
 * Rendering performs zero store writes: the only requests issued are the
 * aggregate GET and the `/api/health` posture read on mount (task 7.7).
 *
 * Network trust (change: retire-trusted-networks-bypass): in `pair` mode the two
 * network stores are headed "may request access", and a banner links to Security ▸
 * Network access while devices still depend on a network match (legacy only). The
 * banner link is an anchor, not a button — it creates nothing.
 *
 * Styling: theme tokens only — no raw hex, no raw px, no z-index (7.11).
 */
import { mdiAlertOutline, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { fetchAccessSnapshot, revokeAccessEntry } from "../../lib/access-grants/access-grants-api.js";
import type {
  AccessEntry,
  AccessGrantSnapshot,
  AccessStoreId,
} from "../../lib/access-grants/access-grants-types.js";
import { aggregateAccessEntries, groupAccessEntriesByStore } from "../../lib/access-grants/aggregate-access-entries.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type TrustPosture, useTrustPosture } from "../../lib/network-trust/trust-posture.js";
import { callout } from "../connectivity/connectivity-ui.js";

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
  previewEgress: "Preview egress origins — preview-egress.json",
};

/** In `pair` mode a list entry admits nothing — the stores say what they now mean. */
const PAIR_STORE_LABEL_EN: Partial<Record<AccessStoreId, string>> = {
  trustedNetworks: "May request access — config.trustedNetworks",
  bypassHosts: "May request access — auth.bypassHosts",
};

function storeLabel(store: AccessStoreId, mode: "pair" | "legacy"): string {
  const pairLabel = mode === "pair" ? PAIR_STORE_LABEL_EN[store] : undefined;
  if (pairLabel) return i18nT(`access.storePair.${store}`, undefined, pairLabel);
  return i18nT(`access.store.${store}`, undefined, STORE_LABEL_EN[store]);
}

/**
 * Migration banner: legacy mode + devices that still got in on a network match alone.
 * Warning when the mode was decided at upgrade, info when the operator chose it.
 * Never shown in pair mode or when the server does not disclose the posture.
 */
function NetworkTrustBanner({ posture }: { posture: TrustPosture | null }) {
  const [, navigate] = useLocation();
  if (!posture || posture.trustMode !== "legacy" || posture.networkOnly.distinctPeers < 1) return null;
  const n = posture.networkOnly.distinctPeers;
  const count = n === 1
    ? i18nT("access.networkTrust.oneAddress", undefined, "1 device address")
    : i18nT("access.networkTrust.nAddresses", { n }, "{n} device addresses");
  const upgrade = posture.trustModeOrigin === "upgrade";
  const severity = upgrade ? "warning" : "info";
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate("/settings/security");
    // The section renders after the route swap — scroll once it exists.
    requestAnimationFrame(() => document.getElementById("network-access")?.scrollIntoView?.({ block: "start" }));
  };
  return (
    <div role="status" data-testid="access-network-trust-banner" data-severity={severity} className={callout(severity)}>
      <Icon path={upgrade ? mdiAlertOutline : mdiInformationOutline} size={0.7} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p>
          {upgrade ? (
            <>
              <strong>{i18nT("access.networkTrust.upgradeLead", { count }, "{count} reach this dashboard by network trust only.")}</strong>{" "}
              {i18nT(
                "access.networkTrust.upgradeBody",
                undefined,
                "Anyone on those networks can drive sessions and read files without signing in. Pair each device, then switch to pairing.",
              )}
            </>
          ) : (
            <>
              <strong>{i18nT("access.networkTrust.operatorLead", undefined, "Network trust is on by your choice")}</strong>{" "}
              {i18nT(
                "access.networkTrust.operatorBody",
                { count },
                "(set on the Security page). {count} used it in the last 7 days or since the last restart.",
              )}
            </>
          )}
        </p>
        <a
          href="/settings/security#network-access"
          data-testid="access-network-trust-link"
          onClick={open}
          className="inline-block font-semibold underline"
        >
          {upgrade
            ? i18nT("access.networkTrust.openUpgrade", undefined, "Open network access settings")
            : i18nT("access.networkTrust.openOperator", undefined, "Review network access")}
        </a>
      </div>
    </div>
  );
}

function scopeLabel(scope: "session" | "project"): string {
  return scope === "session"
    ? i18nT("access.scopeSession", undefined, "Session (server process)")
    : i18nT("access.scopeProject", undefined, "Project");
}

export function AccessSection({ configTrustMode }: { configTrustMode?: "pair" | "legacy" | null } = {}) {
  const { posture } = useTrustPosture();
  // The server's own report wins; the saved config is the fallback when it is not disclosed.
  const trustMode = posture?.trustMode ?? configTrustMode ?? "legacy";
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

      <NetworkTrustBanner posture={posture} />

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
            {storeLabel(group.store, trustMode)}
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
                  {entry.project && (
                    <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                      <span data-testid="access-entry-project">
                        {i18nT("access.columnProject", undefined, "Project")}: {entry.project}
                      </span>
                    </div>
                  )}
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
                      {entry.via === "agent-prompt" ? (
                        <span data-testid="access-entry-via-agent-prompt">
                          {i18nT("access.viaAgentPrompt", undefined, "Agent prompt")}
                        </span>
                      ) : (
                        // `prompt` and any unknown future `via` render as a generic prompt origin.
                        entry.via && (
                          <span data-testid="access-entry-via-prompt">
                            {i18nT("access.viaPrompt", undefined, "via prompt")}
                          </span>
                        )
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
