/**
 * Client barrel. `GoogleSettings` is a thin wrapper owning its own `Suspense` around a `lazy()` import,
 * so the accounts UI stays off the cold landing entry chunk; the i18n catalog stays eager (tiny).
 * See change: add-google-connect.
 */
import { lazy, Suspense } from "react";

export { catalog } from "../i18n.js";

const GoogleSettingsImpl = lazy(() => import("./GoogleSettings.js").then((m) => ({ default: m.GoogleSettings })));

export function GoogleSettings() {
  return (
    <Suspense fallback={null}>
      <GoogleSettingsImpl />
    </Suspense>
  );
}
