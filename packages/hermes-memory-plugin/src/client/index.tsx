/**
 * Client entry barrel for the hermes-memory-plugin.
 *
 * Exports the settings-section component referenced by the
 * `pi-dashboard-plugin` manifest claim (name MUST match `component`) + the
 * i18n catalog. The generated plugin-registry imports these by name.
 *
 * `HermesMemorySettings` is a thin wrapper owning its own `Suspense` around a
 * `lazy()` import, so the form (field family, raw-JSON dialog) stays OFF the cold
 * landing entry chunk (mdi-chunk-size cap) and loads only when the settings page
 * renders. The i18n catalog stays eager (tiny, merged at boot).
 *
 * See change: add-hermes-memory-settings-plugin, retro-ux-plugin-settings-forms.
 */
import { lazy, Suspense } from "react";

export { catalog } from "../i18n.js";

const HermesMemorySettingsImpl = lazy(() =>
  import("./HermesMemorySettings.js").then((m) => ({ default: m.HermesMemorySettings })),
);

export function HermesMemorySettings() {
  return (
    <Suspense fallback={null}>
      <HermesMemorySettingsImpl />
    </Suspense>
  );
}
