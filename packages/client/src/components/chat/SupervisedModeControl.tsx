/**
 * Composer "Tool approval" mode control for Supervised mode (full access ↔ supervised).
 *
 * Three small views over one pair of props, rendered by `CommandInput`:
 * - `SupervisedModeChip` — settings-row chip + portaled two-option menu with the scope caveat.
 * - `SupervisedModeOverflow` — the same two options as a radio group inside the ⋯ menu
 *   (the chip folds there below `@[44rem]`).
 * - `SupervisedGatewayNote` — static "Gateway policy" note shown instead of both when the
 *   chat gateway's guard owns the session's tool gate (design D12).
 *
 * Copy is honest by construction: approval, not a sandbox; operator `!` commands and
 * extension-initiated execution are not covered; YOLO never answers an approval; real
 * isolation is a container. See change: add-supervised-tool-approval (D1, D12, 7.1; mockup a-*).
 */
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { mdiAccountEyeOutline, mdiCheck, mdiChevronDown, mdiLockOpenVariantOutline, mdiMessageTextOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { usePopoverBoundary } from "../../lib/state/PopoverBoundaryContext.js";

export interface SupervisedModeProps {
  /** Current mode (`session.supervised`); absent = Full access. */
  supervised: boolean;
  onChange: (on: boolean) => void;
}

const GAP = 4;

const label = (on: boolean) =>
  on
    ? i18nT("supervised.mode.supervised", undefined, "Supervised")
    : i18nT("supervised.mode.full", undefined, "Full access");

const OPTIONS: ReadonlyArray<{ on: boolean; icon: string; desc: () => string }> = [
  {
    on: false,
    icon: mdiLockOpenVariantOutline,
    desc: () => i18nT("supervised.mode.fullDesc", undefined, "The agent runs every tool without asking."),
  },
  {
    on: true,
    icon: mdiAccountEyeOutline,
    desc: () =>
      i18nT(
        "supervised.mode.supervisedDesc",
        undefined,
        "You approve each shell command, file edit or write, and subagent the agent starts.",
      ),
  },
];

export function SupervisedModeChip({ supervised, onChange }: SupervisedModeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const boundaryRef = usePopoverBoundary();
  const { flipUp, maxHeight, anchorRight, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 320,
    preferredAnchor: "left",
    boundaryRef,
  });

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" data-testid="supervised-mode-control">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="session-mode-chip"
        data-mode={supervised ? "supervised" : "full"}
        title={`${i18nT("supervised.mode.title", undefined, "Tool approval")}: ${label(supervised)}`}
        className={`focus-ring inline-flex items-center gap-1 px-2 h-[30px] rounded-lg border text-[11px] transition-colors ${
          supervised
            ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
            : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        }`}
      >
        <Icon path={supervised ? mdiAccountEyeOutline : mdiLockOpenVariantOutline} size={0.5} />
        <span>{label(supervised)}</span>
        <Icon path={mdiChevronDown} size={0.5} />
      </button>
      {open && (
        <LayerPortal>
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={i18nT("supervised.mode.title", undefined, "Tool approval")}
            data-testid="session-mode-menu"
            className="fixed w-[320px] max-w-[calc(100vw-16px)] overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-lg z-popover p-1"
            style={{
              maxHeight,
              visibility: triggerRect ? "visible" : "hidden",
              ...(triggerRect
                ? flipUp
                  ? { bottom: Math.round(window.innerHeight - triggerRect.top + GAP) }
                  : { top: Math.round(triggerRect.bottom + GAP) }
                : {}),
              ...(triggerRect
                ? anchorRight
                  ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
                  : { left: Math.round(triggerRect.left) }
                : {}),
            }}
          >
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              {i18nT("supervised.mode.heading", undefined, "Tool approval for this session")}
            </div>
            {OPTIONS.map((o) => (
              <button
                key={String(o.on)}
                type="button"
                role="menuitemradio"
                aria-checked={supervised === o.on}
                data-testid={o.on ? "session-mode-option-supervised" : "session-mode-option-full"}
                onClick={() => {
                  onChange(o.on);
                  setOpen(false);
                }}
                className="focus-ring w-full text-left flex items-start gap-2 px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-lg hover:bg-[var(--bg-hover)]"
              >
                <Icon path={o.icon} size={0.65} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--text-primary)]">{label(o.on)}</span>
                  <span className="block text-[12px] text-[var(--text-secondary)] mt-0.5">{o.desc()}</span>
                </span>
                {supervised === o.on && <Icon path={mdiCheck} size={0.6} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />}
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--border-subtle)] px-3 py-2 text-[12px] leading-snug text-[var(--text-secondary)] space-y-1.5" data-testid="session-mode-caveat">
              <p className="m-0">
                {i18nT(
                  "supervised.mode.caveatApplies",
                  undefined,
                  "Applies from the agent's next tool call. Approvals are answered here or in the terminal, never in chat.",
                )}
              </p>
              <p className="m-0">
                {i18nT(
                  "supervised.mode.caveatSandbox",
                  undefined,
                  "Supervised is not a sandbox: an approved command can do anything your user account can. For real isolation, run the session in a container (Docker).",
                )}
              </p>
              <p className="m-0">
                {i18nT(
                  "supervised.mode.caveatScope",
                  undefined,
                  "Your own ! commands never ask, and neither does anything an extension starts on its own. YOLO never answers these approvals.",
                )}
              </p>
              <p className="m-0">
                {i18nT(
                  "supervised.mode.caveatLater",
                  undefined,
                  "An extension loaded later can still change an approved tool's input.",
                )}
              </p>
              <p className="m-0">
                {i18nT("supervised.mode.caveatDefault", undefined, "The default for new sessions is set in Settings, Security.")}
              </p>
            </div>
          </div>
        </LayerPortal>
      )}
    </div>
  );
}

/** The two options as a radio group for the ⋯ overflow menu (44 px rows). */
export function SupervisedModeOverflow({ supervised, onChange }: SupervisedModeProps) {
  return (
    <div role="group" aria-label={i18nT("supervised.mode.title", undefined, "Tool approval")} data-testid="session-mode-overflow">
      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {i18nT("supervised.mode.title", undefined, "Tool approval")}
      </div>
      {OPTIONS.map((o) => (
        <button
          key={String(o.on)}
          type="button"
          role="menuitemradio"
          aria-checked={supervised === o.on}
          data-testid={o.on ? "overflow-mode-supervised" : "overflow-mode-full"}
          onClick={() => onChange(o.on)}
          className="focus-ring w-full flex items-center gap-2 px-2 min-h-[44px] rounded-lg text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          <Icon path={o.icon} size={0.6} className="shrink-0 text-[var(--text-secondary)]" />
          <span className="flex-1 text-left">{label(o.on)}</span>
          {supervised === o.on && <Icon path={mdiCheck} size={0.55} className="text-[var(--accent-primary)]" />}
        </button>
      ))}
      <p className="m-0 px-1 pt-1 text-[11px] leading-snug text-[var(--text-secondary)]">
        {i18nT(
          "supervised.mode.overflowNote",
          undefined,
          "Not a sandbox. Your own ! commands never ask; YOLO never answers approvals.",
        )}
      </p>
    </div>
  );
}

/** Static, non-interactive note when the chat gateway's guard owns the session's tool gate. */
export function SupervisedGatewayNote() {
  return (
    <span
      role="note"
      data-testid="session-mode-gateway"
      title={i18nT(
        "supervised.mode.gatewayTitle",
        undefined,
        "Tool approval for this session is set by the chat gateway's tool policy.",
      )}
      className="inline-flex items-center gap-1 px-2 h-[30px] text-[11px] text-[var(--text-secondary)]"
    >
      <Icon path={mdiMessageTextOutline} size={0.5} />
      {i18nT("supervised.mode.gateway", undefined, "Gateway policy")}
    </span>
  );
}
