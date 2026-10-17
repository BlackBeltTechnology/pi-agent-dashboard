/**
 * Logs panel: a tail snapshot (200 / 500 / 2000 lines) loaded on demand and
 * refreshed only on demand. Lines render as TEXT (never HTML); redaction marks
 * `«secret:<name>»` are visually distinguished; output from a stopped service is
 * labelled as the last run. When the caller cannot operate no request is sent.
 * See change: add-services-settings-ui (D5).
 */
import type { LogsResponse } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { type ReactNode, useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { getLogs, type ServicesResult } from "../../../lib/services/services-api.js";
import { logsReasonSentence } from "../../../lib/services/services-model.js";
import { BUTTON_CLASS, HELP_CLASS, LABEL_CLASS } from "../vault/vault-ui.js";
import { secretInputId } from "./ServiceSecretsSection.js";
import { ActionFailure, SectionTitle } from "./services-ui.js";

const TAILS = [200, 500, 2000] as const;
const MARK = /(«secret:[^»]*»)/g;

/** One line as text, with each redaction mark in its own highlighted span. */
function LogLine({ line }: { line: string }): ReactNode {
  return line.split(MARK).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={`${part}-${i}`} data-testid="service-log-mark" className="rounded bg-[var(--tint-purple-bg)] px-0.5 text-[var(--tint-purple-fg)]">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function ServiceLogsPanel({ serviceId, canOperate }: { serviceId: string; canOperate: boolean }) {
  const [tail, setTail] = useState<number>(200);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const tailId = useId();

  const load = async () => {
    if (!canOperate) return;
    setBusy(true);
    setFailure(null);
    const res = await getLogs(serviceId, tail);
    setBusy(false);
    if (res.ok && res.data) setLogs(res.data);
    else {
      setLogs(null);
      setFailure(res);
    }
  };

  const focusSecret = (name: string) => document.getElementById(secretInputId(serviceId, name))?.focus();

  return (
    <section aria-labelledby="service-logs-title" data-testid="service-logs">
      <SectionTitle id="service-logs-title">{i18nT("services.logs.title", undefined, "Output")}</SectionTitle>
      {!canOperate ? (
        <p className={HELP_CLASS} data-testid="service-logs-readonly">
          {i18nT("services.logs.needsOperate", undefined, "Output can contain sensitive data, so reading it needs operate authority.")}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={tailId} className={LABEL_CLASS}>
                {i18nT("services.logs.lines", undefined, "Last lines")}
              </label>
              <select
                id={tailId}
                value={tail}
                onChange={(e) => setTail(Number(e.target.value))}
                data-testid="service-logs-tail"
                className="focus-ring min-h-[36px] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-sm text-[var(--text-primary)]"
              >
                {TAILS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={load} data-testid="service-logs-load">
              {logs ? i18nT("services.logs.refresh", undefined, "Refresh output") : i18nT("services.logs.load", undefined, "Load output")}
            </button>
          </div>
          <ActionFailure failure={failure} testId="service-logs-error" />
          {logs && !logs.available && (
            <p className={HELP_CLASS} role="status" data-testid="service-logs-unavailable" data-reason={logs.reason}>
              {logsReasonSentence(logs.reason)}
              {logs.secret && (
                <>
                  {" "}
                  <button type="button" className="underline" onClick={() => focusSecret(logs.secret as string)} data-testid="service-logs-secret-link">
                    {i18nT("services.logs.goToSecret", { name: logs.secret }, "Go to secret {name}")}
                  </button>
                </>
              )}
            </p>
          )}
          {logs?.available && (
            <>
              {logs.stale && (
                <p className={`${HELP_CLASS} mb-1`} data-testid="service-logs-stale">
                  {i18nT("services.logs.stale", undefined, "Output of the last run — the service is not running now.")}
                </p>
              )}
              {logs.lines.length === 0 ? (
                <p className={HELP_CLASS}>{i18nT("services.logs.empty", undefined, "No output yet.")}</p>
              ) : (
                <pre
                  data-testid="service-logs-lines"
                  className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 font-mono text-xs text-[var(--text-primary)]"
                  // Output is untrusted text: focusable so keyboard users can scroll it.
                  tabIndex={0}
                >
                  {logs.lines.map((l, i) => (
                    <div key={i}>
                      <LogLine line={l} />
                    </div>
                  ))}
                </pre>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
