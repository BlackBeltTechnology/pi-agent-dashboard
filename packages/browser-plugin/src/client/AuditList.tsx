/**
 * Per-profile relay audit list (change: add-browser-relay, task 4.2 / spec
 * `browser-plugin-settings` "Audit viewer").
 *
 * Fed by `GET /api/browser/audit?profile=<dir>` (already newest-first). The
 * refetch signal is `browser_relay_status.auditSeq`: a monotonic counter that
 * only moves when an entry is appended, so a repeated status carrying the SAME
 * seq must NOT cause a fetch.
 *
 * The mount fetch carries no seq of its own, so the FIRST status is treated as
 * a change (at worst one redundant fetch on mount). Treating it as a baseline
 * instead swallowed a real change whenever it arrived after the mutation but
 * before any other status — the new row never appeared (e2e F4).
 *
 * The list also serves the dedicated profile (`profileDirectory="@dedicated"`);
 * `detach` rows carry their cause as `detail` (`devtools`, `extension:<reason>`,
 * `closed:<reason>`, `no-cdp-client`, `idle`) and render as a warning pill.
 *
 * See change: add-browser-relay (task 4.2); add-dedicated-agent-browser (task 7.4).
 */
import { usePluginMessage, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayStatusMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AuditEntry, getBrowserAudit } from "./browser-api.js";
import { Pill } from "./settings-ui.js";

export interface AuditListProps {
  profileDirectory: string;
}

/** Pill tone per audit kind: stops and refusals stand out, attaches read as healthy. */
function kindTone(kind: AuditEntry["kind"]): "ok" | "neutral" | "warn" {
  if (kind === "attach") return "ok";
  if (kind === "detach" || kind === "denied" || kind === "viewer-subscribe-refused") return "warn";
  return "neutral";
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
    // Same seq → no new entries → no fetch. A different seq (including the
    // very first one observed) → refetch.
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
              <Pill tone={kindTone(entry.kind)}>{entry.kind}</Pill>{" "}
              <span>{entry.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
