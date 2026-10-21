/**
 * Viewer header: `[← Targets] [root · address] [Restricted] [↻] [Scripts | Static] [Open ↗]`
 * (change: improve-canvas-html-and-url-ux, D9; mockup S2).
 */
import { mdiArrowLeft, mdiFileDocumentOutline, mdiRefresh, mdiShieldLockOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { GHOST, ModeToggle, OpenControl } from "./LiveFrameParts.js";

interface Props {
  onBack?: () => void;
  /** Static targets: the document root's last segments (display only) and its full path (tooltip). */
  root: { chip: string; full: string } | null;
  addr: string;
  addrInvalid: boolean;
  onAddrChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  restricted: boolean;
  onReload: () => void;
  /** Scripts ⇄ Static: `null` for a port target (no toggle). */
  scriptsOn: boolean | null;
  onScriptsChange: (v: boolean) => void;
  openHref: string | null;
  onOpen: () => void;
}

export function LiveHeader(p: Props) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1 text-xs">
      {p.onBack && (
        <button type="button" data-testid="live-back" onClick={p.onBack} className={GHOST}>
          <Icon path={mdiArrowLeft} size={0.55} />
          {t("editor.backToTargets", undefined, "← Targets")}
        </button>
      )}
      <form onSubmit={p.onSubmit} className="flex min-w-0 flex-1 items-center gap-1" data-invalid={p.addrInvalid ? true : undefined}>
        {p.root && (
          <span title={p.root.full} className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[var(--text-tertiary)]">
            <Icon path={mdiFileDocumentOutline} size={0.5} />
            {p.root.chip}
          </span>
        )}
        <input
          data-testid="live-address"
          aria-label={t("live.address.label", undefined, "Address")}
          aria-invalid={p.addrInvalid ? true : undefined}
          aria-describedby={p.addrInvalid ? "live-address-error" : undefined}
          value={p.addr}
          onChange={(e) => p.onAddrChange(e.target.value)}
          spellCheck={false}
          className="min-h-[28px] min-w-0 flex-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 font-mono text-xs text-[var(--text-primary)]"
        />
      </form>
      {p.restricted && (
        <span
          data-testid="live-restricted-pill"
          title={t("live.restrictedHint", undefined, "Opened by the agent. External sources are blocked unless you allow them.")}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] px-2 py-0.5 text-[var(--severity-neutral-fg)]"
        >
          <Icon path={mdiShieldLockOutline} size={0.55} />
          {t("live.restricted", undefined, "Restricted")}
        </span>
      )}
      <button
        type="button"
        data-testid="live-reload"
        aria-label={t("live.reload", undefined, "Reload preview")}
        onClick={p.onReload}
        className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      >
        <Icon path={mdiRefresh} size={0.65} />
      </button>
      {p.scriptsOn !== null && <ModeToggle scriptsOn={p.scriptsOn} onChange={p.onScriptsChange} />}
      <OpenControl href={p.openHref} onOpen={p.onOpen} />
    </div>
  );
}
