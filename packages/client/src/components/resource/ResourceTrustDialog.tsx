/**
 * Project-trust dialog for a folder-scope resource toggle.
 *
 * pi only applies a folder's `.pi/settings.json` when the folder is trusted, so
 * a toggle in an untrusted folder must reach a trust decision before anything is
 * written — otherwise the dashboard would report success for a setting no real
 * session honours.
 *
 * The wording deliberately mirrors pi's own trust prompt: the same choices
 * (trust this folder / trust its parent / do not trust), the same security
 * decision. pi's option list is not exported, so it is reproduced here; the
 * decision itself is persisted through pi's own store.
 *
 * Dismissing without choosing writes nothing — neither settings nor trust.
 *
 * See change: project-scope-disable-global-resources.
 */

import { DialogPortal } from "@blackbelt-technology/pi-dashboard-client-utils/DialogPortal";
import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import type React from "react";
import { useCallback } from "react";
import type { ResourceTrustOption } from "../../lib/api/resources-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  message: string;
  options: ResourceTrustOption[];
  /**
   * Durable dashboard trust already covers the folder: this option starts focused
   * and marked, so Enter confirms it. Nothing is recorded until it is chosen.
   * See change: mirror-dashboard-trust-to-pi.
   */
  preselected?: ResourceTrustOption["id"];
  /** Label of the covering dashboard source, shown beside the pre-selection. */
  dashboardSource?: string;
  onChoose: (id: ResourceTrustOption["id"]) => void;
  onDismiss: () => void;
}

export function ResourceTrustDialog({ cwd, message, options, preselected, dashboardSource, onChoose, onDismiss }: Props): React.ReactElement {
  const dismiss = useCallback(() => onDismiss(), [onDismiss]);

  // Join the SHARED escape stack instead of listening on `document` directly.
  // A private listener is invisible to the stack, so Escape dismissed this
  // dialog AND whatever layer was underneath it. That was harmless while the
  // Resources page was a plain route, and became visible the moment folder
  // settings became a route-backed overlay: one keypress closed the trust
  // prompt and navigated the whole surface away. The stack fires only its top
  // layer, which is the behaviour this dialog always intended.
  // See change: add-route-backed-overlay-dialogs.
  useEscapeDismiss(true, dismiss);

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60"
        onClick={dismiss}
        data-testid="resource-trust-backdrop"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resource-trust-title"
          data-testid="resource-trust-dialog"
          className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="resource-trust-title" className="text-base font-semibold text-[var(--text-primary)] mb-2">
            {i18nT("resources.trustThisFolder", undefined, "Do you trust this folder?")}
          </h2>
          <p className="text-[11px] font-mono text-[var(--text-muted)] break-all mb-3">{cwd}</p>
          <p className="text-xs text-[var(--text-tertiary)] mb-4" data-testid="resource-trust-message">
            {message}
          </p>
          <div className="space-y-2">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`resource-trust-option-${opt.id}`}
                data-preselected={preselected === opt.id ? "true" : undefined}
                aria-pressed={preselected ? preselected === opt.id : undefined}
                // biome-ignore lint/a11y/noAutofocus: the pre-selected option is the dialog's primary action
                autoFocus={preselected === opt.id}
                onClick={() => onChoose(opt.id)}
                className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${preselected === opt.id ? "ring-1 ring-[var(--accent-blue)] " : ""}${
                  opt.trusted
                    ? "border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {opt.label}
                {preselected === opt.id && (
                  <span className="ml-2 text-[11px] text-[var(--text-tertiary)]" data-testid="resource-trust-preselected-note">
                    {dashboardSource
                      ? i18nT("resources.trustPreselectedBy", { source: dashboardSource }, `pre-selected: the dashboard trusts this folder (${dashboardSource})`)
                      : i18nT("resources.trustPreselected", undefined, "pre-selected")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
