import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { mdiDownload, mdiPackageVariantClosed } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface PackageInstallConfirmDialogProps {
  source: string;
  packageName?: string;
  scope: "global" | "local";
  /** When set, the scope radio is hidden and the locked scope is used unconditionally.
   *  See change: unify-package-management-ui. */
  lockScope?: "global" | "local";
  /** Called when the user changes the scope via the radio. Required when `lockScope` is undefined. */
  onScopeChange?: (scope: "global" | "local") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PackageInstallConfirmDialog({
  source,
  packageName,
  scope,
  lockScope,
  onScopeChange,
  onConfirm,
  onCancel,
}: PackageInstallConfirmDialogProps) {
  const showScopePicker = lockScope === undefined && onScopeChange !== undefined;

  return (
    <Dialog
      open
      onClose={onCancel}
      title={i18nT("packages.installPackage", undefined, "Install Package")}
      icon={mdiPackageVariantClosed}
      size="sm"
      testId="package-install-confirm-dialog"
    >
          <p className="text-[11px] text-[var(--text-muted)] -mt-2">
            {i18nT("packages.thisWillInstallThePackageAnd", undefined, "This will install the package and reload all active sessions.")}
          </p>

          <div className="bg-[var(--bg-surface)] rounded p-3 space-y-1.5">
            {packageName && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">{i18nT("common.name", undefined, "Name")}</span>
                <span className="text-[var(--text-primary)] font-medium">{packageName}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">{i18nT("common.source", undefined, "Source")}</span>
              <span className="text-[var(--text-primary)] font-mono text-[11px]">{source}</span>
            </div>
            {!showScopePicker && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">{i18nT("settings.scope", undefined, "Scope")}</span>
                <span className="text-[var(--text-primary)]">{scope === "global" ? "Global" : "Local (project)"}</span>
              </div>
            )}
          </div>

          {showScopePicker && (
            <div
              className="p-3 rounded border border-[var(--border-secondary)] bg-[var(--bg-surface)]"
              data-testid="package-install-scope-picker"
              role="radiogroup"
              aria-label={i18nT("packages.installScope", undefined, "Install scope")}
            >
              <div className="text-[11px] text-[var(--text-muted)] mb-2">{i18nT("packages.installTo", undefined, "Install to")}</div>
              <div className="flex flex-col gap-1.5">
                {(["local", "global"] as const).map((opt) => (
                  <label
                    key={opt}
                    className="flex items-start gap-2 cursor-pointer"
                    data-testid={`package-install-scope-${opt}`}
                  >
                    <input
                      type="radio"
                      name="package-install-scope"
                      value={opt}
                      checked={scope === opt}
                      onChange={() => onScopeChange?.(opt)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-xs text-[var(--text-primary)] font-medium">
                        {opt === "global" ? "Global" : "Local (this folder only)"}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {opt === "global"
                          ? "~/.pi/agent/settings.json — available to every pi session."
                          : "<cwd>/.pi/settings.json — available only when running in this folder."}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Dialog.Footer>
            <Dialog.Cancel onClick={onCancel} />
            <Dialog.Action onClick={onConfirm}>
              <Icon path={mdiDownload} size={0.4} className="inline mr-1" />
              {i18nT("common.install2", undefined, "Install")}
            </Dialog.Action>
          </Dialog.Footer>
    </Dialog>
  );
}
