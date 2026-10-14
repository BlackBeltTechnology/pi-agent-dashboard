/**
 * Settings panel behind a lazy boundary: `SettingsPanel.tsx` (+ the sections
 * only it reaches) is its own chunk, fetched the first time a settings view
 * opens — never on the cold landing. This module must NOT statically import
 * `SettingsPanel.js` (type-only is fine, it is erased).
 *
 * Loading → in-panel spinner; import failure → error state with a retry that
 * drops React.lazy's memoized rejection by minting a fresh lazy component.
 * Settings page-id / URL helpers live outside the panel module
 * (`lib/route-builders.ts`, `lib/mobile-depth.ts`) so the shell never needs it.
 *
 * See change: shrink-client-entry-lazy-islands.
 */
import { type ComponentProps, lazy, Suspense, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";

type SettingsPanelProps = ComponentProps<typeof import("./SettingsPanel.js").SettingsPanel>;

const makeLazyPanel = () =>
  lazy(() => import("./SettingsPanel.js").then((m) => ({ default: m.SettingsPanel })));

// Module-level: a successful load is shared by every mount (one fetch per page).
let SettingsPanelImpl = makeLazyPanel();

export function LazySettingsPanel(props: SettingsPanelProps) {
  // Bumping `attempt` remounts the boundary; the retry handler swaps in a fresh lazy first.
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    SettingsPanelImpl = makeLazyPanel();
    setAttempt((n) => n + 1);
  };
  return (
    <ErrorBoundary
      key={attempt}
      fallback={
        <div
          role="alert"
          data-testid="settings-load-error"
          className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-secondary)]"
        >
          <span>{i18nT("settings.loadFailed", undefined, "Couldn't load the settings panel.")}</span>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-[var(--border-primary)] px-3 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            {i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      }
    >
      <Suspense
        fallback={
          <div
            role="status"
            data-testid="settings-loading"
            className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]"
          >
            {i18nT("settings.loading", undefined, "Loading settings…")}
          </div>
        }
      >
        <SettingsPanelImpl {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
