/**
 * Settings → Access → "Pi trust from the dashboard" (change:
 * mirror-dashboard-trust-to-pi). Discloses which folders the dashboard's durable
 * trust confers on pi, per entry and effective, next to pi's own `trust.json`
 * entries, plus the switches and per-entry choice.
 *
 * A sibling of `AccessSection` (not inside it): that section's contract pins
 * "revoke controls only". Here the only writes are the mirror switches and one
 * entry's "also trust in pi" choice — never a grant, never pi's `trust.json`.
 *
 * Live (server-lifetime) entries are listed read-only with their lifetime; the
 * bridge reason-code legend lets a code from a bridge log be looked up.
 *
 * Styling: theme tokens only.
 * See change: mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote.
 */

import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { MIRROR_REASON_LABELS, MIRROR_WITHHELD_LABELS } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  fetchPiTrustAccess,
  type PiTrustAccessEntry,
  type PiTrustAccessView,
  type PiTrustLiveLifetime,
  setPiTrustChoice,
  setPiTrustMirrorConfig,
} from "../../lib/pi-trust-mirror/pi-trust-mirror-api.js";

const SOURCE_LABEL: Record<MirrorSourceKind, string> = {
  worktreeInit: "Worktree-init trust (current hook)",
  workflow: "Workflow trust",
  pinned: "Pinned folders",
  folderWorkspaces: "Folder workspaces",
  accessGrants: "Access grants (project roots)",
  yolo: "YOLO sessions (live only)",
};

const LIVE_TIMEOUT_MIN_MS = 50;
const LIVE_TIMEOUT_MAX_MS = 1000;

/** Lifetime of a live entry, in words ("YOLO until 14:30" uses the viewer's locale). */
function liveLifetimeLabel(l: PiTrustLiveLifetime): string {
  if (l.kind === "restart") return i18nT("piTrust.lifetimeRestart", undefined, "until dashboard restarts");
  if (l.kind === "yolo-process") return i18nT("piTrust.lifetimeYoloProcess", undefined, "YOLO while the server runs");
  const time = new Date(l.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return i18nT("piTrust.lifetimeYoloUntil", { time }, `YOLO until ${time}`);
}

/** How often the Access page re-reads live entries (matches the shared YOLO status poll order of magnitude). */
const LIVE_REFRESH_MS = 5000;

const CARD = "border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)]";
const ROW = "flex flex-wrap items-start gap-3 px-3 py-2";
const FOLDER = "font-mono text-sm break-all text-[var(--text-primary)]";
const META = "text-xs text-[var(--text-tertiary)] mt-0.5";

export function PiTrustMirrorSection() {
  const [view, setView] = useState<PiTrustAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchPiTrustAccess();
    if (r.ok && r.data) {
      const next = r.data;
      // Keep the same object when nothing changed so the periodic refresh never re-renders.
      setView((prev) => (prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setError(null);
    } else {
      setError(r.error ?? "request failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live entries (YOLO roots, "until dashboard restarts" trust) start and end without any
  // action on this page, so the list converges on its own — no reload needed.
  // See change: mirror-dashboard-trust-live-remote (test-plan #F5).
  useEffect(() => {
    const id = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      const r = await action();
      setBusy(false);
      if (!r.ok) setError(r.error ?? "request failed");
      await load();
    },
    [load],
  );

  if (error && !view) {
    return (
      <section data-testid="pi-trust-mirror" aria-labelledby="pi-trust-mirror-title" className="mt-6">
        <h3 id="pi-trust-mirror-title" className="text-sm font-semibold text-[var(--text-primary)]">
          {i18nT("piTrust.title", undefined, "Pi trust from the dashboard")}
        </h3>
        <p role="alert" className="text-xs text-[var(--status-error)] mt-1" data-testid="pi-trust-mirror-error">
          {error}
        </p>
      </section>
    );
  }
  if (!view) return null;

  const cfg = view.config;
  return (
    <section data-testid="pi-trust-mirror" aria-labelledby="pi-trust-mirror-title" className="mt-6 space-y-3">
      <h3 id="pi-trust-mirror-title" className="text-sm font-semibold text-[var(--text-primary)]">
        {i18nT("piTrust.title", undefined, "Pi trust from the dashboard")}
      </h3>

      <div className="text-xs text-[var(--text-secondary)] space-y-1" data-testid="pi-trust-disclosures">
        <p data-testid="pi-trust-precedence">
          {i18nT(
            "piTrust.precedence",
            undefined,
            "Dashboard trust takes precedence over pi's defaultProjectTrust, including \"never\". A folder pi itself has a recorded decision for (trust or refusal) always keeps that decision.",
          )}
        </p>
        <p data-testid="pi-trust-scope">
          {cfg.coverInteractive
            ? i18nT("piTrust.scopeAll", undefined, "It applies to every pi session on this machine, including terminal and interactive sessions.")
            : i18nT("piTrust.scopeHeadless", undefined, "It applies to headless sessions the dashboard starts only (turn on \"cover interactive\" to include terminal pi).")}
        </p>
        <p data-testid="pi-trust-exclusions">
          {i18nT(
            "piTrust.exclusions",
            undefined,
            "Sessions started with --no-approve or --no-extensions, and pi's own CLI commands (for example pi mcp list), do not use it. A headless session the dashboard starts is also trusted in exactly its own start folder for that run, unless pi has a recorded decision there or the folder is a system or temporary folder.",
          )}
        </p>
        <p data-testid="pi-trust-live">
          {i18nT(
            "piTrust.live",
            undefined,
            "Live entries (session worktree-init trust, session access grants, YOLO roots) end with their source and are never written to disk. Server-side views, such as the folder MCP page, count live entries whatever the session kind; each pi session still applies \"cover interactive\".",
          )}
        </p>
        <p data-testid="pi-trust-remote">
          {i18nT(
            "piTrust.remote",
            undefined,
            "A bridge on another machine is trusted only when the content of pi's trust-requiring resources there matches the server's. The server counters describe the server only: a remote bridge with a shorter timeout can log live-timeout for an answer the server counts as covered.",
          )}
        </p>
        <p data-testid="pi-trust-npm-residual">
          {i18nT(
            "piTrust.npmResidual",
            undefined,
            "Residual: npm packages referenced from .pi/settings.json are bound by reference, not by the bytes pi fetches for them.",
          )}
        </p>
        <p data-testid="pi-trust-agent-dir">
          {i18nT("piTrust.agentDir", { dir: view.agentDir }, `pi agent directory: ${view.agentDir}`)}
        </p>
      </div>

      <fieldset className={`${CARD} px-3 py-2 space-y-1`} data-testid="pi-trust-switches" disabled={busy}>
        <legend className="text-xs text-[var(--text-tertiary)] px-1">
          {i18nT("piTrust.switches", undefined, "Mirror switches")}
        </legend>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            data-testid="pi-trust-enabled"
            checked={cfg.enabled}
            onChange={(e) => void run(() => setPiTrustMirrorConfig({ enabled: e.target.checked }))}
          />
          {i18nT("piTrust.enabled", undefined, "Mirror durable dashboard trust into pi")}
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            data-testid="pi-trust-cover-interactive"
            checked={cfg.coverInteractive}
            onChange={(e) => void run(() => setPiTrustMirrorConfig({ coverInteractive: e.target.checked }))}
          />
          {i18nT("piTrust.coverInteractive", undefined, "Also cover terminal and interactive pi sessions")}
        </label>
        <LiveQueryControls
          liveQuery={cfg.liveQuery}
          timeoutMs={cfg.liveQueryTimeoutMs}
          onLiveQuery={(v) => void run(() => setPiTrustMirrorConfig({ liveQuery: v }))}
          onTimeout={(v) => void run(() => setPiTrustMirrorConfig({ liveQueryTimeoutMs: v }))}
        />
        {(Object.keys(SOURCE_LABEL) as MirrorSourceKind[]).map((id) => (
          <label key={id} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              data-testid={`pi-trust-source-${id}`}
              checked={cfg.sources[id]}
              onChange={(e) => void run(() => setPiTrustMirrorConfig({ sources: { [id]: e.target.checked } }))}
            />
            {SOURCE_LABEL[id]}
            {view.sourcesNotInstalled.includes(id) && (
              <span className="text-xs text-[var(--text-tertiary)]">
                {" — "}
                {MIRROR_REASON_LABELS["source-not-installed"]}
              </span>
            )}
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-[var(--status-error)]" data-testid="pi-trust-mirror-error">
          {error}
        </p>
      )}

      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
          {i18nT("piTrust.effective", undefined, "Effective dashboard trust")}
        </h4>
        <ul className={CARD} data-testid="pi-trust-effective">
          {view.effective.length === 0 && (
            <li className={`${ROW} text-xs text-[var(--text-tertiary)]`}>
              {i18nT("piTrust.none", undefined, "No folder is trusted in pi through the dashboard.")}
            </li>
          )}
          {view.effective.map((e) => (
            <li key={`${e.sourceKind}:${e.folder}`} className={ROW} data-testid="pi-trust-effective-row">
              <div>
                <div className={FOLDER}>{e.folder}</div>
                <div className={META}>
                  {e.sourceLabel}
                  {e.coversSubfolders ? ` · ${i18nT("piTrust.coversSubfolders", undefined, "covers subfolders")}` : ""}
                </div>
                {e.live && e.lifetime && (
                  <div className={META} data-testid="pi-trust-lifetime">
                    {liveLifetimeLabel(e.lifetime)}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
          {i18nT("piTrust.entries", undefined, "Entries")}
        </h4>
        <ul className={CARD} data-testid="pi-trust-entries">
          {view.entries.map((e) => (
            <EntryRow key={`${e.sourceKind}:${e.folder}`} entry={e} busy={busy} onChoice={(c) => void run(() => setPiTrustChoice(e.sourceKind, e.folder, c))} />
          ))}
          {view.entries.length === 0 && (
            <li className={`${ROW} text-xs text-[var(--text-tertiary)]`}>
              {i18nT("piTrust.noEntries", undefined, "No dashboard trust entries.")}
            </li>
          )}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
          {i18nT("piTrust.piEntries", undefined, "Recorded in pi's own trust store")}
        </h4>
        <ul className={CARD} data-testid="pi-trust-pi-entries">
          {view.piEntries.map((p) => (
            <li key={p.folder} className={ROW}>
              <span className={FOLDER}>{p.folder}</span>
              <span className={META}>{p.decision ? "trusted" : "not trusted"}</span>
            </li>
          ))}
          {view.piEntries.length === 0 && (
            <li className={`${ROW} text-xs text-[var(--text-tertiary)]`}>
              {i18nT("piTrust.noPiEntries", undefined, "Nothing recorded.")}
            </li>
          )}
        </ul>
      </div>

      <ReasonLegend />
    </section>
  );
}

/** Switch + deadline for the bridge's live trust query. */
function LiveQueryControls({
  liveQuery,
  timeoutMs,
  onLiveQuery,
  onTimeout,
}: {
  liveQuery: boolean;
  timeoutMs: number | undefined;
  onLiveQuery: (v: boolean) => void;
  onTimeout: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(timeoutMs === undefined ? "" : String(timeoutMs));
  useEffect(() => setDraft(timeoutMs === undefined ? "" : String(timeoutMs)), [timeoutMs]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (timeoutMs !== undefined) onTimeout(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setDraft(timeoutMs === undefined ? "" : String(timeoutMs));
      return;
    }
    const clamped = Math.min(LIVE_TIMEOUT_MAX_MS, Math.max(LIVE_TIMEOUT_MIN_MS, Math.round(n)));
    setDraft(String(clamped));
    if (clamped !== timeoutMs) onTimeout(clamped);
  };
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="pi-trust-live-query"
          checked={liveQuery}
          onChange={(e) => onLiveQuery(e.target.checked)}
        />
        {i18nT("piTrust.liveQuery", undefined, "Ask the running dashboard about live trust (session and YOLO entries)")}
      </label>
      <div className="text-sm text-[var(--text-primary)]">
        <label className="flex items-center gap-2">
          {i18nT("piTrust.liveQueryTimeout", undefined, "Live query timeout (ms)")}
          <input
            type="number"
            inputMode="numeric"
            min={LIVE_TIMEOUT_MIN_MS}
            max={LIVE_TIMEOUT_MAX_MS}
            step={1}
            placeholder={i18nT("piTrust.liveQueryTimeoutDefault", undefined, "default")}
            data-testid="pi-trust-live-query-timeout"
            aria-describedby="pi-trust-live-query-timeout-help"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            className="w-24 px-1 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
          />
        </label>
        <p id="pi-trust-live-query-timeout-help" className="text-xs text-[var(--text-tertiary)]" data-testid="pi-trust-live-query-timeout-help">
          {i18nT(
            "piTrust.liveQueryTimeoutHelp",
            undefined,
            "Empty = default: 300 ms local / 1000 ms remote. Values are clamped to 50–1000 ms.",
          )}
        </p>
      </div>
    </>
  );
}

/** Every bridge reason code with its label, so a code from a bridge log can be looked up. */
function ReasonLegend() {
  return (
    <div>
      <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
        {i18nT("piTrust.legend", undefined, "Bridge reason codes")}
      </h4>
      <ul className={CARD} data-testid="pi-trust-legend">
        {(Object.entries(MIRROR_WITHHELD_LABELS) as Array<[string, string]>).map(([code, label]) => (
          <li key={code} className={ROW} data-testid="pi-trust-legend-item" data-code={code}>
            <code className={FOLDER}>{code}</code>
            <span className={META}>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryRow({
  entry,
  busy,
  onChoice,
}: {
  entry: PiTrustAccessEntry;
  busy: boolean;
  onChoice: (choice: boolean | null) => void;
}) {
  // The control states the effective wish: an explicit choice, else the source default.
  const checked = entry.choice ?? entry.confers;
  // Live entries are memory-only and end with their source: read-only, no choice to persist.
  const live = entry.live === true;
  return (
    <li className={ROW} data-testid="pi-trust-entry" data-confers={entry.confers ? "true" : "false"} data-live={live ? "true" : "false"}>
      <div className="min-w-0 flex-1">
        <div className={FOLDER}>{entry.folder}</div>
        <div className={META}>
          {entry.sourceLabel}
          {entry.byDefault && !live ? ` · ${i18nT("piTrust.byDefault", undefined, "by default")}` : ""}
        </div>
        {live && entry.lifetime && (
          <div className={META} data-testid="pi-trust-lifetime">
            {liveLifetimeLabel(entry.lifetime)}
          </div>
        )}
        {!entry.confers && entry.reason && (
          <div className={META} data-testid="pi-trust-ignored" data-reason={entry.reason}>
            {i18nT("piTrust.notConferring", undefined, "Does not confer pi trust")}: <code>{entry.reason}</code> —{" "}
            {entry.reasonLabel ?? MIRROR_REASON_LABELS[entry.reason]}
          </div>
        )}
      </div>
      {!live && (
        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            disabled={busy}
            checked={checked}
            data-testid="pi-trust-entry-choice"
            onChange={(e) => onChoice(e.target.checked)}
          />
          {i18nT("piTrust.checkbox", undefined, "Also trust this folder in pi")}
        </label>
      )}
      {!live && entry.choice !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoice(null)}
          className="text-xs underline text-[var(--accent-text)]"
          data-testid="pi-trust-entry-reset"
        >
          {i18nT("piTrust.resetChoice", undefined, "Use source default")}
        </button>
      )}
    </li>
  );
}
