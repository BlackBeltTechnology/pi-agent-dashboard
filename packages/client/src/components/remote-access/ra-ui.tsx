/** Small presentational pieces shared by the dialog's landing and step bodies. */
import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { BTN_PRIMARY, BTN_SMALL, callout } from "../connectivity/connectivity-ui.js";

export function Callout({ severity, children, testId }: { severity: "info" | "warning" | "error"; children: ReactNode; testId?: string }) {
  return (
    <p role={severity === "error" ? "alert" : "note"} data-testid={testId} className={callout(severity)}>
      <span>{children}</span>
    </p>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button type="button" className={BTN_PRIMARY} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

export function SmallButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button type="button" className={BTN_SMALL} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

/** "Checking…" / "unknown" for a source that is not known — never a default. */
export function UnknownNote({ pending, onRetry }: { pending: "loading" | "error" | undefined; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <span data-testid="remote-access-unknown" className="text-xs text-[var(--text-secondary)]">
      {pending === "error" ? t("remoteAccess.unknown", undefined, "unknown") : t("remoteAccess.checking", undefined, "Checking…")}
      {pending === "error" && onRetry && (
        <>
          {" "}
          <button type="button" data-testid="remote-access-retry" className="underline" onClick={onRetry}>
            {t("remoteAccess.retry", undefined, "Retry")}
          </button>
        </>
      )}
    </span>
  );
}

export const REFUSED_FALLBACK = "This browser is not allowed to make the change.";
