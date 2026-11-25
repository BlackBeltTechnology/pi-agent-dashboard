/**
 * Accessible fold-out: a `<button aria-expanded aria-controls>` header over a body that is NOT in the DOM
 * while collapsed (so its controls are unreachable). Same shell classes as `SettingsGroup` / `SettingsItem`.
 * See change: add-google-connect.
 */
import type React from "react";
import { useId, useState } from "react";

export interface DisclosureProps {
  /** Header content (title, summary, status). */
  header: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state (the parent can open it, e.g. from a "Set up organisation sign-in" action). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  testId?: string;
  toggleTestId?: string;
  bodyTestId?: string;
  /** Accessible name of the toggle when the header text alone is not enough. */
  toggleLabel?: string;
  /** `card` = bordered item shell (accounts, advanced); `bare` = text-only fold-out. */
  variant?: "card" | "bare";
}

export function Disclosure({ header, children, defaultOpen = false, open, onToggle, testId, toggleTestId, bodyTestId, toggleLabel, variant = "card" }: DisclosureProps) {
  const [inner, setInner] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = open ?? inner;
  const toggle = () => {
    setInner(!isOpen);
    onToggle?.(!isOpen);
  };
  const shell = variant === "card" ? "rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]" : "";
  return (
    <div data-testid={testId} className={shell}>
      <button
        type="button"
        data-testid={toggleTestId}
        aria-expanded={isOpen}
        aria-controls={isOpen ? bodyId : undefined}
        aria-label={toggleLabel}
        onClick={toggle}
        className={`focus-ring flex w-full items-center gap-2 text-left text-[var(--text-primary)] ${variant === "card" ? "min-h-[44px] rounded-lg px-3 py-1.5" : "min-h-[32px] text-xs"}`}
      >
        <span aria-hidden="true" className={`shrink-0 text-[var(--text-secondary)] transition-transform ${isOpen ? "rotate-90" : ""}`}>
          ›
        </span>
        {header}
      </button>
      {isOpen ? (
        <div id={bodyId} data-testid={bodyTestId} className={variant === "card" ? "flex flex-col gap-3 px-3 pb-3 pt-1" : "mt-2 flex flex-col gap-2"}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
