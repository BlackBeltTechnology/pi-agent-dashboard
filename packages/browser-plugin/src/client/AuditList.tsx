/**
 * Per-profile relay audit list (change: add-browser-relay, task 4.2 / spec
 * `browser-plugin-settings` "Audit viewer").
 *
 * Fed by `GET /api/browser/audit?profile=<dir>` (already newest-first). The
 * refetch signal is `browser_relay_status.auditSeq`: a monotonic counter that
 * only moves when an entry is appended, so a repeated status carrying the SAME
 * seq must NOT cause a fetch. The first observed seq establishes a baseline
 * (the mount fetch already returned the current entries).
 *
 * See change: add-browser-relay (task 4.2).
 */
import { usePluginMessage, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayStatusMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AuditEntry, getBrowserAudit } from "./browser-api.js";

export interface AuditListProps {
  profileDirectory: string;
}

/** Locale-formatted wall-clock time for an audit row. */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

export function AuditList({ profileDirectory }: AuditListProps): React.ReactElement {
  const t = useT();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const lastSeq = useRef<number | null>(null);

  const fetchAudit = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await getBrowserAudit(profileDirectory, signal);
        if (signal?.aborted) return;
        setEntries(res.entries);
      } catch {
        /* keep the previous list on a transport hiccup */
      }
    },
    [profileDirectory],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchAudit(controller.signal);
    return () => controller.abort();
  }, [fetchAudit]);

  usePluginMessage<BrowserRelayStatusMessage>("browser_relay_status", (msg) => {
    if (lastSeq.current === null) {
      // Baseline: the mount fetch already served this seq's entries.
      lastSeq.current = msg.auditSeq;
      return;
    }
    if (lastSeq.current === msg.auditSeq) return;
    lastSeq.current = msg.auditSeq;
    void fetchAudit();
  });

  if (entries === null) {
    return (
      <p data-testid={`browser-audit-loading-${profileDirectory}`} className="text-[11px] text-[var(--text-tertiary)]">
        {t("loading", undefined, "Loading…")}
      </p>
    );
  }

  return (
    <div data-testid={`browser-audit-${profileDirectory}`} className="mt-1">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {t("auditTitle", undefined, "Audit")}
      </div>
      {entries.length === 0 ? (
        <p data-testid={`browser-audit-empty-${profileDirectory}`} className="text-[11px] text-[var(--text-tertiary)]">
          {t("auditEmpty", undefined, "No audit entries.")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry, i) => (
            <li
              key={`${entry.ts}-${entry.kind}-${i}`}
              data-testid={`browser-audit-row-${profileDirectory}-${i}`}
              className="text-[11px] text-[var(--text-secondary)]"
            >
              <span className="text-[var(--text-tertiary)]">{formatTime(entry.ts)}</span>{" "}
              <span className="font-medium">{entry.kind}</span>{" "}
              <span>{entry.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
