/**
 * Native <dialog> modals: confirm (incl. destructive) and single-text prompt.
 * Escape / Cancel close; focus returns to the opener. See change: add-team-plugin (A8).
 */
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.js";

function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const d = ref.current;
    d?.showModal();
    const handle = () => onClose();
    d?.addEventListener("close", handle);
    d?.addEventListener("cancel", handle);
    return () => {
      d?.removeEventListener("close", handle);
      d?.removeEventListener("cancel", handle);
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  }, []);
  return ref;
}

export function ConfirmDialog({
  title,
  body,
  okLabel,
  destructive,
  onOk,
  onClose,
}: {
  title: string;
  body: ReactNode;
  okLabel: string;
  destructive?: boolean;
  onOk(): void;
  onClose(): void;
}) {
  const t = useT();
  const ref = useModal(onClose);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="dlg-cancel">
          {t("dlg.cancel")}
        </button>
        <button
          type="button"
          className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
          onClick={() => {
            onOk();
            onClose();
          }}
          data-testid="dlg-ok"
        >
          {okLabel}
        </button>
      </div>
    </dialog>
  );
}

export function TextDialog({
  title,
  label,
  hint,
  initial,
  okLabel,
  validate,
  errorText,
  onOk,
  onClose,
}: {
  title: string;
  label: string;
  hint?: string;
  initial: string;
  okLabel: string;
  validate(v: string): boolean;
  errorText: string;
  onOk(v: string): void;
  onClose(): void;
}) {
  const t = useT();
  const ref = useModal(onClose);
  const [value, setValue] = useState(initial);
  const [showError, setShowError] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate(value)) {
      setShowError(true);
      return;
    }
    onOk(value);
    onClose();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title">
      <form onSubmit={submit} noValidate>
        <h2 id="dlg-title">{title}</h2>
        <div className="field">
          <label htmlFor="dlg-text">{label}</label>
          {hint ? <p className="hint" id="dlg-hint">{hint}</p> : null}
          <input
            id="dlg-text"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={hint ? "dlg-hint" : undefined}
            aria-invalid={showError || undefined}
          />
          {showError ? <p className="field-error" role="alert">{errorText}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("dlg.cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {okLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
