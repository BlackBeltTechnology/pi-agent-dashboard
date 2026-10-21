/**
 * Non-modal egress banner for a RESTRICTED live preview (change:
 * improve-canvas-html-and-url-ux, D6/D7; mockup S3). One row per blocked origin:
 * its source ("in markup" / "reported by this page"), a shared-hosting warning,
 * and the allow controls it is entitled to:
 *
 *   - ungrantable (private / loopback / own origin) → no controls;
 *   - page-reported (runtime) origin                → "Allow once" only (a page can
 *     forge its own reports, so it can never become a project grant);
 *   - markup origin                                 → "Allow once" + "Allow for this
 *     project" (only when access prompting is enabled).
 *
 * `role="status"`, never moves focus, never raises a dialog by itself: the project
 * button is the operator's click that asks the server to raise the standard
 * access-grant dialog. An allow reloads the frame.
 */
import { mdiAlertOutline, mdiCheckCircleOutline, mdiClose, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { allowOnceEgress, type EgressOrigin, type EgressReport, requestEgressGrant } from "../../../lib/api/live-server-api.js";
import { useI18n } from "../../../lib/i18n/i18n.js";

interface Props {
  report: EgressReport | null;
  targetId: string;
  tokenId: string | undefined;
  viewerId: string;
  /** Re-frame after an allow (the CSP is rebuilt per response). */
  onReload: () => void;
  /** An allow changed server state: resume polling. */
  onChanged: () => void;
}

type RowNote = "requested" | "prompting-disabled" | "refused" | "rate-limited" | "error";

const BTN =
  "inline-flex min-h-[28px] items-center rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
const SRC_PILL =
  "shrink-0 rounded-full border border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] px-2 py-0.5 text-xs text-[var(--severity-neutral-fg)]";

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

export function EgressBanner({ report, targetId, tokenId, viewerId, onReload, onChanged }: Props) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState<string>("");
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const blocked = report?.origins.filter((o) => o.state === "blocked") ?? [];
  const allowedOnce = report?.origins.filter((o) => o.state === "allowed-once") ?? [];
  const sig = blocked.map((o) => o.origin).join("|");

  // A project grant the operator requested was answered: re-frame once so the new CSP applies.
  useEffect(() => {
    if (!report) return;
    for (const origin of [...requested.current]) {
      const row = report.origins.find((o) => o.origin === origin);
      if (!row || row.state === "allowed-project") {
        requested.current.delete(origin);
        onReload();
      }
    }
  }, [report, onReload]);

  if (!report) return null;

  const allowOnce = async (o: EgressOrigin) => {
    if (!tokenId) return;
    setBusy(o.origin);
    const r = await allowOnceEgress(targetId, { tokenId, viewerId, origin: o.origin });
    setBusy(null);
    if (!r.ok) {
      setNotes((n) => ({ ...n, [o.origin]: "refused" }));
      return;
    }
    onChanged();
    onReload();
  };

  const allowProject = async (o: EgressOrigin) => {
    if (!tokenId) return;
    setBusy(o.origin);
    const r = await requestEgressGrant(targetId, { tokenId, origin: o.origin });
    setBusy(null);
    if (r.ok) {
      requested.current.add(o.origin);
      setNotes((n) => ({ ...n, [o.origin]: "requested" }));
      onChanged();
    } else {
      setNotes((n) => ({ ...n, [o.origin]: r.reason }));
    }
  };

  const noteText = (n: RowNote): string =>
    n === "requested"
      ? t("live.egress.noteRequested", undefined, "Waiting for your answer in the access dialog.")
      : n === "prompting-disabled"
        ? t("live.egress.notePromptingOff", undefined, "Project grants need access prompts (Settings → Access).")
        : n === "rate-limited"
          ? t("live.egress.noteRateLimited", undefined, "Too many requests. Try again in a moment.")
          : t("live.egress.noteRefused", undefined, "That origin cannot be allowed.");

  const incomplete = report.scanIncomplete || !report.runtimeChannel;
  const showBanner = blocked.length > 0 && dismissed !== sig;

  const pills = allowedOnce.map((o) => (
    <span
      key={o.origin}
      role="status"
      data-testid="egress-allowed-pill"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] px-2 py-0.5 text-xs text-[var(--severity-success-fg)]"
    >
      <Icon path={mdiCheckCircleOutline} size={0.55} />
      {t("live.egress.allowedPill", { host: hostOf(o.origin) }, "{host} allowed for this preview")}
    </span>
  ));

  return (
    <div className="flex shrink-0 flex-col gap-1 px-2 pt-1">
      {showBanner ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="egress-banner"
          data-prompts={report.promptingEnabled}
          className="flex gap-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] p-2 text-xs text-[var(--severity-warning-fg)]"
        >
          <Icon path={mdiAlertOutline} size={0.7} className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <strong className="font-semibold">
                  {blocked.length === 1
                    ? t("live.egress.titleOne", undefined, "1 external source blocked")
                    : t("live.egress.titleMany", { count: blocked.length }, "{count} external sources blocked")}
                </strong>
                <p className="m-0 text-[var(--text-secondary)]">
                  {t("live.egress.body", undefined, "The page may look unstyled until you allow them. Nothing was requested from them.")}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("live.egress.dismiss", undefined, "Dismiss blocked sources notice")}
                onClick={() => setDismissed(sig)}
                className="inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Icon path={mdiClose} size={0.6} />
              </button>
            </div>
            <ul aria-label={t("live.egress.listLabel", undefined, "Blocked sources")} className="m-0 flex list-none flex-col gap-1 p-0">
              {blocked.map((o) => {
                const projectOk = o.source === "markup" && report.promptingEnabled && !o.ungrantable;
                const note = notes[o.origin];
                return (
                  <li key={o.origin} data-testid="egress-row" className="flex flex-wrap items-center gap-2 text-[var(--text-primary)]">
                    <span className="min-w-0 break-all font-mono">{o.origin}</span>
                    <span className={SRC_PILL} data-testid="egress-source">
                      {o.source === "markup"
                        ? t("live.egress.sourceMarkup", undefined, "in markup")
                        : t("live.egress.sourceRuntime", undefined, "reported by this page")}
                    </span>
                    {o.ungrantable ? (
                      <span className="text-[var(--text-secondary)]" data-testid="egress-ungrantable">
                        {t("live.egress.notGrantable", undefined, "not grantable (private address)")}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-testid="egress-allow-once"
                          disabled={busy === o.origin}
                          aria-label={t("live.egress.allowOnceAria", { origin: o.origin }, "Allow {origin} once")}
                          onClick={() => void allowOnce(o)}
                          className={BTN}
                        >
                          {t("live.egress.allowOnce", undefined, "Allow once")}
                        </button>
                        {projectOk && (
                          <button
                            type="button"
                            data-testid="egress-allow-project"
                            disabled={busy === o.origin || note === "requested"}
                            aria-label={t("live.egress.allowProjectAria", { origin: o.origin }, "Allow {origin} for this project")}
                            onClick={() => void allowProject(o)}
                            className={BTN}
                          >
                            {t("live.egress.allowProject", undefined, "Allow for this project")}
                          </button>
                        )}
                      </>
                    )}
                    {o.shared && (
                      <p data-testid="egress-shared-warning" className="m-0 flex basis-full items-center gap-1 text-[var(--severity-warning-fg)]">
                        <Icon path={mdiAlertOutline} size={0.55} />
                        {t("live.egress.shared", undefined, "Shared hosting: anyone can publish here")}
                      </p>
                    )}
                    {note && (
                      <p data-testid="egress-row-note" className="m-0 basis-full text-[var(--text-secondary)]">
                        {noteText(note)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {!report.promptingEnabled && (
              <p data-testid="egress-prompts-note" className="m-0 text-[var(--text-secondary)]">
                {t("live.egress.promptsNote", undefined, "Project grants need access prompts (Settings → Access).")}
              </p>
            )}
            {incomplete && (
              <p data-testid="egress-incomplete" className="m-0 text-[var(--text-secondary)]">
                {t("live.egress.incomplete", undefined, "Some resources may be blocked.")}
              </p>
            )}
            {pills.length > 0 && <div className="flex flex-wrap gap-1">{pills}</div>}
          </div>
        </div>
      ) : (
        <>
          {pills.length > 0 && (
            <div data-testid="egress-banner" data-state="allowed-once" className="flex flex-wrap items-center gap-1">
              {pills}
            </div>
          )}
          {incomplete && (
            <p data-testid="egress-incomplete" className="m-0 flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
              <Icon path={mdiInformationOutline} size={0.55} />
              {t("live.egress.incomplete", undefined, "Some resources may be blocked.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
