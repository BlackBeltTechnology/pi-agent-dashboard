// PROJECT ADAPTER (pi-agent-dashboard) — the only app-specific runtime file of the mock site.
// setup(): load the app's real CSS + bridge the generic --mk-* chrome tokens onto the app's tokens.
// Providers: wrap panes in whatever context the app needs (mocks stay prop-driven).
// See change: add-live-component-mock-site (design D2).
import type { ReactNode } from "react";

export async function setup(): Promise<void> {
  await import("./mock-site.css");
  const s = document.createElement("style");
  s.textContent = `:root{--mk-page:var(--bg-secondary);--mk-panel:var(--bg-primary);--mk-fg:var(--text-primary);
    --mk-muted:var(--text-secondary);--mk-faint:var(--text-tertiary);--mk-line:var(--border-primary);--mk-line-2:var(--border-secondary);
    --mk-hover:var(--bg-hover);--mk-accent:var(--accent-blue);--mk-bad:var(--accent-red);--mk-ok:var(--accent-green);
    --mk-bad-text:var(--accent-red-text);--mk-ok-text:var(--accent-green-text);}`;
  document.head.appendChild(s);
}

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
