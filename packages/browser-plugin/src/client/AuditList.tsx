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
 * `closed:<reason>`, `no-cdp-client`, `idle`) and render with a warning pill.
 *
 * Rendered as a collapsed "Activity" group (count in the summary) holding a
 * read-only table; the event column shows a human word, never the raw `kind`.
 *
 * See change: add-browser-relay (task 4.2); add-dedicated-agent-browser (task 7.4);
 * retro-ux-plugin-settings-wave-2 (BR7).
 */
import {
  SettingsGroup,
  SettingsStatusPill,
  SettingsTable,
  usePluginMessage,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayStatusMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AuditEntry, getBrowserAudit } from "./browser-api.js";

export interface AuditListProps {
  profileDirectory: string;
}

/** Pill tone per audit kind: stops and refusals stand out, attaches read as healthy. */
function kindTone(kind: AuditEntry["kind"]): "success" | "neutral" | "warning" {
  if (kind === "attach") return "success";
  if (kind === "detach" || kind === "denied" || kind === "viewer-subscribe-refused") return "warning";
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

  const eventWord = (kind: AuditEntry["kind"]): string => {
    switch (kind) {
      case "attach":
        return t("auditEventAttach", undefined, "Connected");
      case "detach":
        return t("auditEventDetach", undefined, "Disconnected");
      case "navigate":
        return t("auditEventNavigate", undefined, "Navigated");
      case "createTarget":
        return t("auditEventCreateTarget", undefined, "Opened a tab");
      case "denied":
        return t("auditEventDenied", undefined, "Denied");
      case "dropped":
        return t("auditEventDropped", undefined, "Ignored");
      case "open":
        return t("auditEventOpen", undefined, "Opened in pane");
      case "viewer-subscribe":
        return t("auditEventViewerSubscribe", undefined, "Live view started");
      case "viewer-subscribe-refused":
        return t("auditEventViewerSubscribeRefused", undefined, "Live view refused");
      default:
        return t("auditEventViewerInput", undefined, "Live view input");
    }
  };

  const title = t("auditTitle", undefined, "Activity");

  if (entries === null) {
    return (
      <SettingsGroup title={title} defaultOpen={false}>
        <p data-testid={`browser-audit-loading-${profileDirectory}`} className="text-xs text-[var(--text-secondary)]">
          {t("loading", undefined, "Loading…")}
        </p>
      </SettingsGroup>
    );
  }

  const meta =
    entries.length === 0
      ? t("auditNone", undefined, "none yet")
      : entries.length === 1
        ? t("auditCountOne", undefined, "1 entry")
        : t("auditCount", { n: entries.length }, `${entries.length} entries`);

  return (
    <SettingsGroup title={title} meta={meta} defaultOpen={false} testId={`browser-audit-${profileDirectory}`}>
      {entries.length === 0 ? (
        <p data-testid={`browser-audit-empty-${profileDirectory}`} className="text-xs text-[var(--text-secondary)]">
          {t("auditEmpty", undefined, "No activity yet.")}
        </p>
      ) : (
        <SettingsTable
          caption={title}
          columns={[
            t("auditColWhen", undefined, "When"),
            t("auditColEvent", undefined, "Event"),
            t("auditColDetail", undefined, "Detail"),
          ]}
          rows={entries.map((entry, i) => ({
            key: `${entry.ts}-${entry.kind}-${i}`,
            testId: `browser-audit-row-${profileDirectory}-${i}`,
            cells: [
              formatTime(entry.ts),
              <SettingsStatusPill key="event" tone={kindTone(entry.kind)} icon={null} status={entry.kind}>
                {eventWord(entry.kind)}
              </SettingsStatusPill>,
              entry.detail,
            ],
          }))}
        />
      )}
    </SettingsGroup>
  );
}
