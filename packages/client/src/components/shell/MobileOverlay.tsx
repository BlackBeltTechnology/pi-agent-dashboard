import { mdiClose, mdiMenu } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface HamburgerProps {
  onClick: () => void;
}

/** Hamburger button — visible only below md (768px) */
export function HamburgerButton({ onClick }: HamburgerProps) {
  return (
    <button
      onClick={onClick}
      className="md:hidden fixed top-2 left-2 z-50 p-1.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      data-testid="hamburger-button"
      aria-label={i18nT("common.openMenu", undefined, "Open menu")}
    >
      <Icon path={mdiMenu} size={0.8} />
    </button>
  );
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Mobile sidebar overlay — fixed position with backdrop */
export function MobileOverlay({ open, onClose, children }: OverlayProps) {
  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-40" data-testid="mobile-overlay">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--bg-overlay)]"
        onClick={onClose}
        data-testid="mobile-backdrop"
      />
      {/* Sidebar panel */}
      <div className="absolute inset-y-0 left-0 w-72 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] overflow-y-auto z-50">
        <div className="flex justify-end p-2">
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            data-testid="mobile-close"
            aria-label={i18nT("common.closeMenu", undefined, "Close menu")}
          >
            <Icon path={mdiClose} size={0.7} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
