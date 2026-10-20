/**
 * Small presentational pieces of the live viewer header + notices (change:
 * improve-canvas-html-and-url-ux; mockup S2). Split out of `LiveFrame` so the
 * frame keeps to its policy/state logic.
 */
import { mdiCheck, mdiEyeOffOutline, mdiInformationOutline, mdiOpenInNew, mdiScriptTextOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ReactNode } from "react";
import { useI18n } from "../../../lib/i18n/i18n.js";

export const BTN =
  "inline-flex min-h-[28px] items-center gap-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
export const GHOST = "inline-flex min-h-[28px] items-center gap-1 rounded px-2 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]";
const NOTE =
  "mx-2 mt-1 flex items-start gap-2 rounded border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] p-2 text-xs text-[var(--severity-info-fg)]";

/** Info notice row: icon, body, optional action. `role="status"`, never moves focus. */
export function InfoNote({ testId, children, action }: { testId: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" data-testid={testId} className={NOTE}>
      <Icon path={mdiInformationOutline} size={0.7} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Scripts ⇄ Static segmented control (static targets only). */
export function ModeToggle({ scriptsOn, onChange }: { scriptsOn: boolean; onChange: (scripts: boolean) => void }) {
  const { t } = useI18n();
  const seg = (on: boolean) => `${GHOST} rounded-none ${on ? "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]" : ""}`;
  return (
    <div
      role="radiogroup"
      aria-label={t("live.mode.label", undefined, "Rendering mode")}
      data-testid="live-scripts-toggle"
      className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)]"
    >
      <button type="button" role="radio" aria-checked={scriptsOn} data-testid="live-mode-scripts" onClick={() => onChange(true)} className={seg(scriptsOn)}>
        <Icon path={scriptsOn ? mdiCheck : mdiScriptTextOutline} size={0.5} />
        {t("live.mode.scripts", undefined, "Scripts")}
      </button>
      <button type="button" role="radio" aria-checked={!scriptsOn} data-testid="live-mode-static" onClick={() => onChange(false)} className={seg(!scriptsOn)}>
        <Icon path={!scriptsOn ? mdiCheck : mdiEyeOffOutline} size={0.5} />
        {t("live.mode.static", undefined, "Static")}
      </button>
    </div>
  );
}

/**
 * Open ↗. A local operator's user-added port target links straight to its own
 * localhost URL (`href`); everything else mints a fresh capability on click.
 */
export function OpenControl({ href, onOpen }: { href: string | null; onOpen: () => void }) {
  const { t } = useI18n();
  const inner = (
    <>
      <Icon path={mdiOpenInNew} size={0.55} />
      <span>{t("editor.openExternal", undefined, "Open")}</span>
    </>
  );
  return href ? (
    <a data-testid="live-open" href={href} target="_blank" rel="noreferrer" className={GHOST}>
      {inner}
    </a>
  ) : (
    <button type="button" data-testid="live-open" onClick={onOpen} className={GHOST}>
      {inner}
    </button>
  );
}

/** "Updated by the agent · Reload" for the ACTIVE tab (content stays undisturbed). */
export function UpdatedNotice({ onReload }: { onReload: () => void }) {
  const { t } = useI18n();
  return (
    <InfoNote
      testId="live-updated-notice"
      action={
        <button type="button" data-testid="live-updated-reload" onClick={onReload} className={BTN}>
          {t("live.updated.reload", undefined, "Reload")}
        </button>
      }
    >
      <strong className="font-semibold">{t("live.updated.title", undefined, "Updated by the agent")}</strong>
      <p className="m-0">{t("live.updated.body", undefined, "You are still viewing the earlier version.")}</p>
    </InfoNote>
  );
}

/** Restricted + exposed + scripts off: the operator's explicit "Run scripts". */
export function ExposedNotice({ onRun }: { onRun: () => void }) {
  const { t } = useI18n();
  return (
    <InfoNote
      testId="live-exposed-notice"
      action={
        <button
          type="button"
          data-testid="live-run-scripts"
          title={t("live.exposed.hint", undefined, "The page runs in an isolated frame. Anyone who obtains its preview link can use it until it expires.")}
          onClick={onRun}
          className={BTN}
        >
          {t("live.exposed.run", undefined, "Run scripts")}
        </button>
      }
    >
      <p className="m-0">{t("live.exposed.body", undefined, "Scripts are off because this dashboard is reachable from other devices.")}</p>
    </InfoNote>
  );
}

export function RootAbsoluteHint() {
  const { t } = useI18n();
  return (
    <InfoNote testId="live-hint-root-absolute">
      <p className="m-0">
        {t(
          "live.rootAbsolute",
          undefined,
          "This page uses root-absolute paths (/app.js) that cannot resolve here. Run a dev server bound to localhost and open its localhost URL in the canvas.",
        )}
      </p>
    </InfoNote>
  );
}

/** Inline confirmation before a different loopback port becomes a target. */
export function AddressConfirm({ target, onAdd, onCancel }: { target: string; onAdd: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      data-testid="live-address-confirm"
      aria-label={t("live.address.confirmAria", undefined, "Confirm adding a target")}
      className="mx-2 mt-1 flex flex-wrap items-center gap-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-2 text-xs"
    >
      <span className="flex-1">{t("live.address.confirm", { target }, "Add {target} as a target?")}</span>
      <button type="button" data-testid="live-address-add" onClick={onAdd} className="inline-flex min-h-[28px] items-center rounded bg-[var(--accent-solid)] px-3 text-white">
        {t("live.address.add", undefined, "Add")}
      </button>
      <button type="button" data-testid="live-address-cancel" onClick={onCancel} className={BTN}>
        {t("common.cancel", undefined, "Cancel")}
      </button>
    </div>
  );
}

/** A refused / invalid state line (`role="alert"`). */
export function InlineError({ testId, id, children }: { testId: string; id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" data-testid={testId} className="m-0 px-2 pt-1 text-xs text-[var(--severity-error-fg)]">
      {children}
    </p>
  );
}
