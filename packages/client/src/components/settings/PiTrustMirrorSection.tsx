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
 * Styling: theme tokens only.
 */

import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { MIRROR_REASON_LABELS } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  fetchPiTrustAccess,
  type PiTrustAccessEntry,
  type PiTrustAccessView,
  setPiTrustChoice,
  setPiTrustMirrorConfig,
} from "../../lib/pi-trust-mirror/pi-trust-mirror-api.js";

const SOURCE_LABEL: Record<MirrorSourceKind, string> = {
  worktreeInit: "Worktree-init trust (current hook)",
  workflow: "Workflow trust",
  pinned: "Pinned folders",
  folderWorkspaces: "Folder workspaces",
  accessGrants: "Access grants (project roots)",
};

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
      setView(r.data);
      setError(null);
    } else {
      setError(r.error ?? "request failed");
    }
  }, []);

  useEffect(() => {
    void load();
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
            : i18nT("piTrust.scopeHeadless", undefined, "It applies to dashboard-spawned headless sessions only (turn on \"cover interactive\" to include terminal pi).")}
        </p>
        <p data-testid="pi-trust-exclusions">
          {i18nT(
            "piTrust.exclusions",
            undefined,
            "Sessions started with --no-approve or --no-extensions, and pi's own CLI commands (for example pi mcp list), do not use it. A dashboard-spawned headless session is also trusted in exactly its own start folder for that run, unless pi has a recorded decision there or the folder is a system or temporary folder.",
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
              {i18nT("piTrust.noEntries", undefined, "No durable dashboard trust entries.")}
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
    </section>
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
  return (
    <li className={ROW} data-testid="pi-trust-entry" data-confers={entry.confers ? "true" : "false"}>
      <div className="min-w-0 flex-1">
        <div className={FOLDER}>{entry.folder}</div>
        <div className={META}>
          {entry.sourceLabel}
          {entry.byDefault ? ` · ${i18nT("piTrust.byDefault", undefined, "by default")}` : ""}
        </div>
        {!entry.confers && entry.reason && (
          <div className={META} data-testid="pi-trust-ignored" data-reason={entry.reason}>
            {i18nT("piTrust.notConferring", undefined, "Does not confer pi trust")}: <code>{entry.reason}</code> —{" "}
            {entry.reasonLabel ?? MIRROR_REASON_LABELS[entry.reason]}
          </div>
        )}
      </div>
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
      {entry.choice !== null && (
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
