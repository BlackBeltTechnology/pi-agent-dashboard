/**
 * Client barrel. `GmailSettings` is a thin wrapper owning its own `Suspense`
 * around a `lazy()` import, so the wizard + panel code stays OFF the cold
 * landing entry chunk (mdi-chunk-size cap) and loads only when the Gmail
 * settings page renders. The i18n catalog stays eager (tiny, merged at boot).
 * See change: add-gmail-plugin.
 */
import { lazy, Suspense } from "react";

export { catalog } from "../i18n.js";

const GmailSettingsImpl = lazy(() => import("./GmailSettings.js").then((m) => ({ default: m.GmailSettings })));

export function GmailSettings() {
  return (
    <Suspense fallback={null}>
      <GmailSettingsImpl />
    </Suspense>
  );
}
