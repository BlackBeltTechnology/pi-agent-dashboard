/**
 * StatusPill primitive (`ui:status-pill`): state-tinted pill with a default icon.
 *
 * Registered as `ui:status-pill` in the primitive registry. Plugins emit
 * `{primitive: "ui:status-pill", props: {state, text, icon?, tooltip?}}`.
 *
 * Renders the runtime kit's `SettingsStatusPill`, so colours come from the
 * `--severity-*` tokens in every theme palette (no raw colours, no theme
 * observer). The public props and `data-status-pill` are unchanged.
 *
 * See change: adopt-server-driven-intent-rendering,
 * align-ui-contract-recipes (design D2).
 */

import { SettingsStatusPill, type SettingsStatusTone } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  UiStatusPillProps,
  UiStatusPillState,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiLoading, mdiMinusCircleOutline } from "@mdi/js";
import { useMdiIconByKey } from "./mdi-by-key.js";

const STATE_TONE: Record<UiStatusPillState, SettingsStatusTone> = {
  running: "info",
  success: "success",
  info: "info",
  warn: "warning",
  error: "error",
  muted: "neutral",
};

export function StatusPill({ state, text, icon, tooltip }: UiStatusPillProps) {
  const running = state === "running";
  // A progress state always shows the progress glyph, so it never needs the lazy set.
  const resolved = useMdiIconByKey(running ? undefined : icon);
  // The kit's neutral tone has no default glyph; `muted` still reads without colour.
  const glyph = running ? mdiLoading : (resolved ?? (state === "muted" ? mdiMinusCircleOutline : undefined));
  return (
    <span title={tooltip} data-status-pill={state} className="inline-flex">
      <SettingsStatusPill tone={STATE_TONE[state]} icon={glyph} spinning={running}>
        {text}
      </SettingsStatusPill>
    </span>
  );
}
