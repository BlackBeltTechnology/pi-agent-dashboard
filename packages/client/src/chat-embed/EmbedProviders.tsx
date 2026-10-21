/**
 * `EmbedProviders` — the context stack the dashboard `ChatView` needs outside
 * `<App>` (docs/embedding-chat-view.md): api base, wouter `Router`, theme,
 * mobile, session assets, display prefs.
 *
 * Deliberately provides NO `UiPrimitiveProvider` (the caller supplies it with
 * `createHostPrimitiveRegistry()`) and NO `ModelConfigContext`: the shell-bound
 * `ui:model-selector` then runs in its documented no-context form — no
 * favorites, no refresh, no provider-settings link, caller's list still renders.
 *
 * See change: decouple-plugins-from-core (D8).
 */

import type { ReactNode } from "react";
import { Router } from "wouter";
import { ThemeProvider } from "../components/settings/ThemeProvider.js";
import { MobileProvider } from "../hooks/useMobile.js";
import { ApiContext } from "../lib/api/api-context.js";
import { SessionAssetsProvider } from "../lib/session/SessionAssetsContext.js";
import type { DisplayPrefsContextValue } from "../lib/state/DisplayPrefsContext.js";
import { DisplayPrefsProvider } from "../lib/state/DisplayPrefsContext.js";

const DISPLAY_PREFS: DisplayPrefsContextValue = { global: undefined, getSessionOverride: () => undefined };

export function EmbedProviders({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  return (
    <ApiContext.Provider value={apiBase}>
      <Router>
        <ThemeProvider>
          <MobileProvider>
            <SessionAssetsProvider assets={undefined}>
              <DisplayPrefsProvider value={DISPLAY_PREFS}>{children}</DisplayPrefsProvider>
            </SessionAssetsProvider>
          </MobileProvider>
        </ThemeProvider>
      </Router>
    </ApiContext.Provider>
  );
}
