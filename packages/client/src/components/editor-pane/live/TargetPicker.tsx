/**
 * Live-server target picker (change: improve-canvas-html-and-url-ux, D9; mockup S5).
 * Leads with the session's active canvas target, then the targets the operator
 * added, then a collapsed "Older targets (N)" disclosure (targets persisted before
 * this change plus agent presets) with a confirmed "Clear all". ✕ removes one
 * target: the server revokes its capabilities and drops its allowlist entry when
 * it has one.
 */
import type { LiveServerTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { mdiChevronDown, mdiClose, mdiDeleteOutline, mdiPlay } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { useI18n } from "../../../lib/i18n/i18n.js";

interface Props {
  servers: LiveServerTarget[];
  /** Loopback port of the session's active canvas target, if any. */
  activePort: number | null;
  url: string;
  label: string;
  error: string | null;
  busy: boolean;
  onUrlChange: (v: string) => void;
  onLabelChange: (v: string) => void;
  onConfirm: () => void;
  onLaunch: (s: LiveServerTarget) => void;
  onRemove: (ids: string[]) => void;
}

const hp = (s: LiveServerTarget) => `${s.host}:${s.port}`;
const INPUT =
  "rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)]";
const BTN =
  "inline-flex min-h-[28px] items-center gap-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
const DANGER =
  "inline-flex min-h-[28px] items-center gap-1 rounded border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] px-2 text-xs text-[var(--tint-red-fg)]";

export function TargetPicker(p: Props) {
  const { t } = useI18n();
  const [confirmClear, setConfirmClear] = useState(false);

  const active = p.servers.filter((s) => p.activePort != null && s.port === p.activePort);
  const rest = p.servers.filter((s) => !active.includes(s));
  const mine = rest.filter((s) => s.addedBy === "user");
  const older = rest.filter((s) => s.addedBy !== "user");

  const row = (s: LiveServerTarget, live = false) => (
    <li key={s.id} className="flex items-center gap-1" data-testid="live-target-row">
      <button
        type="button"
        onClick={() => p.onLaunch(s)}
        className="flex min-h-[28px] min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
      >
        {live ? (
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[var(--severity-success-fg)]" />
        ) : (
          <Icon path={mdiPlay} size={0.55} className="shrink-0 text-[var(--text-tertiary)]" />
        )}
        {s.label && s.label !== hp(s) && <span className="truncate font-medium">{s.label}</span>}
        <span className="truncate font-mono text-xs text-[var(--text-tertiary)]">{hp(s)}</span>
        {live && (
          <span className="shrink-0 rounded-full border border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] px-2 text-xs text-[var(--severity-success-fg)]">
            {t("live.picker.live", undefined, "Live")}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid="live-target-remove"
        aria-label={t("live.picker.removeAria", { target: hp(s) }, "Remove target {target}")}
        onClick={() => p.onRemove([s.id])}
        className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
      >
        <Icon path={mdiClose} size={0.6} />
      </button>
    </li>
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 text-sm">
      <div>
        <h3 className="mb-1 font-medium text-[var(--text-primary)]">
          {t("editor.previewLocalDevServer", undefined, "Preview a local dev server")}
        </h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          {t("editor.loopbackOnlyHint", undefined, "Loopback only (localhost / 127.0.0.1). Runs sandboxed — the app can't reach the dashboard.")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="live-url"
          aria-label={t("live.picker.urlLabel", undefined, "URL")}
          value={p.url}
          onChange={(e) => p.onUrlChange(e.target.value)}
          aria-invalid={p.error ? true : undefined}
          placeholder="http://localhost:5173"
          className={`${INPUT} min-w-0 flex-1 font-mono`}
        />
        <input
          data-testid="live-label"
          aria-label={t("live.picker.labelLabel", undefined, "Label")}
          value={p.label}
          onChange={(e) => p.onLabelChange(e.target.value)}
          placeholder={t("editor.labelOptional", undefined, "label (optional)")}
          className={`${INPUT} w-32`}
        />
        <button
          type="button"
          data-testid="live-confirm"
          onClick={p.onConfirm}
          disabled={p.busy}
          className="flex min-h-[28px] items-center gap-1 rounded bg-[var(--accent-solid)] px-3 py-1 text-white disabled:opacity-40"
        >
          <Icon path={mdiPlay} size={0.6} />
          <span>{t("editor.preview", undefined, "Preview")}</span>
        </button>
      </div>

      {p.error && (
        <div data-testid="live-error" role="alert" className="text-xs text-[var(--severity-error-fg)]">
          {p.error}
        </div>
      )}

      {active.length > 0 && (
        <section aria-label={t("live.picker.activeHeading", undefined, "Active canvas")}>
          <h4 className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{t("live.picker.activeHeading", undefined, "Active canvas")}</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{active.map((s) => row(s, true))}</ul>
        </section>
      )}

      {mine.length > 0 && (
        <section aria-label={t("live.picker.mineHeading", undefined, "Added by you")}>
          <h4 className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{t("live.picker.mineHeading", undefined, "Added by you")}</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{mine.map((s) => row(s))}</ul>
        </section>
      )}

      {older.length > 0 && (
        <details data-testid="live-older">
          <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <Icon path={mdiChevronDown} size={0.6} />
            {t("live.picker.olderHeading", { count: older.length }, "Older targets ({count})")}
          </summary>
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
              <span>{t("live.picker.olderHint", undefined, "Added by earlier automatic launches or before this update")}</span>
              {!confirmClear && (
                <button type="button" data-testid="live-clear-older" onClick={() => setConfirmClear(true)} className={DANGER}>
                  <Icon path={mdiDeleteOutline} size={0.55} />
                  {t("live.picker.clearAll", undefined, "Clear all")}
                </button>
              )}
            </div>
            {confirmClear && (
              <div
                role="group"
                aria-label={t("live.picker.clearConfirmAria", undefined, "Confirm removing older targets")}
                data-testid="live-clear-confirm-row"
                className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-2 text-xs"
              >
                <span className="flex-1">{t("live.picker.clearConfirm", { count: older.length }, "Remove {count} older targets?")}</span>
                <button
                  type="button"
                  data-testid="live-clear-confirm"
                  onClick={() => {
                    setConfirmClear(false);
                    p.onRemove(older.map((s) => s.id));
                  }}
                  className={DANGER}
                >
                  {t("live.picker.remove", undefined, "Remove")}
                </button>
                <button type="button" data-testid="live-clear-cancel" onClick={() => setConfirmClear(false)} className={BTN}>
                  {t("common.cancel", undefined, "Cancel")}
                </button>
              </div>
            )}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">{older.map((s) => row(s))}</ul>
          </div>
        </details>
      )}
    </div>
  );
}
