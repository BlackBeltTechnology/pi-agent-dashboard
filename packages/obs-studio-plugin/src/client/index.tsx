/**
 * OBS Studio plugin · CLIENT barrel: the slot components named in the manifest
 * claims + the i18n catalog. Both components are thin wrappers owning their own
 * `<Suspense>` around `lazy()` imports, so the card, the panel and app-kit stay
 * OFF the dashboard's cold index chunk (mdi-chunk-size cap). See change:
 * add-obs-studio-plugin.
 */
import { lazy, Suspense } from "react";

export { catalog } from "../i18n.js";

const CardImpl = lazy(() => import("./ObsSettingsCard.js").then((m) => ({ default: m.ObsSettingsCard })));
const RouteImpl = lazy(() => import("./ObsAppRoute.js"));

/** `settings-section` claim. */
export function ObsSettings() {
  return (
    <Suspense fallback={null}>
      <CardImpl />
    </Suspense>
  );
}

/** `shell-overlay-route` claim (`/obs/*?`). */
export function ObsAppClaim({ onBack }: { onBack: () => void }) {
  return (
    <Suspense fallback={null}>
      <RouteImpl onBack={onBack} />
    </Suspense>
  );
}
