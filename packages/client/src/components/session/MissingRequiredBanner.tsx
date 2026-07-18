/**
 * Top-of-page banner rendered when any `required` recommended extension
 * is not active in pi (not present in ~/.pi/agent/settings.json packages[]).
 *
 * - Consumes useRecommendedExtensions and filters to required + !activeInPi.
 * - If the missing required entries are already on disk (just not active),
 *   offers a cheap "Activate" action that re-runs installAndPersist under
 *   the on-disk scope — pi skips the download and just registers in
 *   settings.json.
 * - Otherwise offers the full "Install" action (clones / downloads).
 * - Dismissible per-session via sessionStorage key
 *   `pi-dashboard:missing-required-dismissed`. Dismissal is per-session
 *   (resets on page reload) but re-appears on the next load while the
 *   condition persists.
 */

import { mdiAlertCircle, mdiClose, mdiFlashAuto, mdiLoading, mdiPlusCircle } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { useRecommendedExtensions } from "../../hooks/useRecommendedExtensions.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const DISMISSED_KEY = "pi-dashboard:missing-required-dismissed";

export function MissingRequiredBanner() {
  const { recommended, refresh } = useRecommendedExtensions();
  const ops = usePackageOperations("global", undefined, refresh);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const missing = useMemo(
    () => recommended.filter((e) => e.status === "required" && !e.activeInPi),
    [recommended],
  );

  // If every missing entry is on disk (`installed.scope !== null`) we can
  // offer the cheaper "Activate" path. If at least one is genuinely absent,
  // fall back to the full "Install" label.
  const allOnDisk = useMemo(
    () => missing.length > 0 && missing.every((e) => e.installed.scope !== null),
    [missing],
  );
  const actionLabel = allOnDisk ? "Activate" : "Install";
  const actionIcon = allOnDisk ? mdiFlashAuto : mdiPlusCircle;

  // Reset the dismissed flag when the missing set becomes empty, so the
  // banner can reappear cleanly if an entry is later removed.
  useEffect(() => {
    if (missing.length === 0 && dismissed) {
      try {
        sessionStorage.removeItem(DISMISSED_KEY);
      } catch {
        /* ignore */
      }
      setDismissed(false);
    }
  }, [missing.length, dismissed]);

  const onDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  const onAction = useCallback(() => {
    for (const entry of missing) {
      // If on disk, use the on-disk scope so we persist into the matching
      // settings.json (global vs project). Otherwise fall back to global.
      const target =
        entry.installed.scope === "global" || entry.installed.scope === "local"
          ? entry.installed.scope
          : undefined;
      ops.install(entry.source, target);
    }
  }, [missing, ops]);

  if (dismissed || missing.length === 0) return null;

  const anyBusy = ops.operation.status === "running";

  return (
    <div
      role="alert"
      className="mx-2 my-2 p-3 bg-danger/10 border border-danger/40 rounded-lg flex items-start gap-3"
      data-testid="missing-required-banner"
    >
      <Icon path={mdiAlertCircle} size={0.9} className="text-danger flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-danger">
          {missing.length === 1
            ? allOnDisk
              ? `${missing[0].displayName} is installed but not active in pi`
              : `${missing[0].displayName} is not installed`
            : allOnDisk
              ? `${missing.length} required extensions are installed but not active in pi`
              : `${missing.length} required extensions are not installed`}
        </div>
        <ul className="text-xs text-muted mt-1 space-y-0.5">
          {missing.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.displayName}</strong>
              {entry.installed.scope && (
                <> <span className="text-success">{i18nT("common.onDisk", undefined, "(on disk:")} {entry.installed.scope})</span></>
              )}
              {entry.unlocks.length > 0 && (
                <> {i18nT("common.unlocks", undefined, "— unlocks:")} {entry.unlocks.join(", ")}</>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onAction}
          disabled={anyBusy}
          className="text-xs px-2 py-1 rounded bg-danger text-white hover:bg-danger/80 flex items-center gap-1 disabled:opacity-50"
          data-testid="missing-required-install"
        >
          {anyBusy ? <Icon path={mdiLoading} size={0.6} spin /> : <Icon path={actionIcon} size={0.6} />}
          {actionLabel}
        </button>
        <button
          onClick={onDismiss}
          className="text-xs p-1 rounded hover:bg-surface text-muted"
          data-testid="missing-required-dismiss"
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
        >
          <Icon path={mdiClose} size={0.7} />
        </button>
      </div>
    </div>
  );
}
