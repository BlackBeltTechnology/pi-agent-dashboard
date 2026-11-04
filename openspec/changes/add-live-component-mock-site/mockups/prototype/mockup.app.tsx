// PROJECT ADAPTER (pi-agent-dashboard) — the only app-specific runtime file.
// setup(): load the app's real CSS. Providers: wrap panes in whatever context the app needs.
import type { ReactNode } from "react";

export async function setup(): Promise<void> {
  await import("@app/index.css");
  // Bridge the generic --mk-* chrome tokens onto the app's own tokens.
  const s = document.createElement("style");
  s.textContent = `:root{--mk-page:var(--bg-secondary);--mk-panel:var(--bg-primary);--mk-fg:var(--text-primary);
    --mk-muted:var(--text-secondary);--mk-faint:var(--text-tertiary);--mk-line:var(--border-primary);--mk-line-2:var(--border-secondary);
    --mk-hover:var(--bg-hover);--mk-accent:var(--accent-blue);--mk-bad:var(--accent-red);--mk-ok:var(--accent-green);
    --mk-bad-text:var(--accent-red-text);--mk-ok-text:var(--accent-green-text);}`;
  document.head.appendChild(s);
}

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>; // prop-only components need no store for this demo
}
