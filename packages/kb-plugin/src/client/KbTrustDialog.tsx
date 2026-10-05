/**
 * KbTrustDialog — consent before a remote KB source may be fetched. Opened when
 * a remote source is added, and from a saved row that is not trusted yet.
 *
 * States the facts that matter: what is fetched, that agents will be able to
 * read it, and that trust applies in every folder on this machine. It shows no
 * cache path and no SSRF line (the guard runs at connect time).
 *
 * See change: improve-kb-settings-sources-and-search (design D4).
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import type { SourceConfig } from "../shared/kb-plugin-types.js";

export interface KbTrustDialogProps {
  spec: SourceConfig;
  /** `existing` = the row is already saved; only trusting is offered, not "add without". */
  mode: "add" | "existing";
  busy?: boolean;
  error?: string | null;
  onTrust: () => void;
  /** Only called in `add` mode. */
  onAddWithoutTrust: () => void;
  onCancel: () => void;
}

const btn = "text-[12px] px-3 py-1.5 rounded border disabled:opacity-40";

export function KbTrustDialog({ spec, mode, busy, error, onTrust, onAddWithoutTrust, onCancel }: KbTrustDialogProps): React.ReactElement {
  const t = useT();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const row = (label: string, value: string | undefined): React.ReactNode =>
    value ? (
      <div className="flex gap-2 text-[12px]">
        <span className="w-16 text-[var(--text-tertiary)]">{label}</span>
        <code className="font-mono text-[var(--text-secondary)] break-all">{value}</code>
      </div>
    ) : null;

  return (
    <Dialog open onClose={onCancel} title={t("trustTitle", undefined, "Trust this remote source?")} size="md" testId="kb-trust-dialog">
      <div className="flex flex-col gap-2 text-[12px] text-[var(--text-secondary)]">
        {row(t("trustKind", undefined, "Kind"), spec.kind)}
        {row(t("trustRef", undefined, "Ref"), spec.ref)}
        {row(t("trustPin", undefined, "Pin"), spec.pin)}
        {row(t("trustSubdir", undefined, "Subdir"), spec.subdir)}
        <p data-testid="kb-trust-agent-warning">
          {t("trustAgentWarning", undefined, "Its markdown is indexed and becomes searchable by your agents. Only trust sources you control or have reviewed.")}
        </p>
        <p data-testid="kb-trust-global-note" className="text-[var(--text-muted)]">
          {t("trustGlobalNote", undefined, "Trust applies in every folder on this machine; revoke it under Access.")}
        </p>
        {error && <p role="alert" className="text-red-400" data-testid="kb-trust-error">{error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" className={`${btn} text-[var(--text-secondary)] border-[var(--border-subtle)]`} onClick={onCancel} data-testid="kb-trust-cancel">
            {t("cancel", undefined, "Cancel")}
          </button>
          {mode === "add" && (
            <button type="button" className={`${btn} text-[var(--text-secondary)] border-[var(--border-subtle)]`} onClick={onAddWithoutTrust} disabled={busy} data-testid="kb-trust-add-untrusted">
              {t("addWithoutTrusting", undefined, "Add without trusting")}
            </button>
          )}
          <button type="button" className={`${btn} font-semibold text-indigo-200 border-indigo-500/60 bg-indigo-500/10`} onClick={onTrust} disabled={busy} data-testid="kb-trust-confirm">
            {mode === "add" ? t("trustAndAdd", undefined, "Trust & add") : t("trustConfirm", undefined, "Trust")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
