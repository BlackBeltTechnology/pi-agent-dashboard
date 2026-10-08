/**
 * ContextModeSettings — settings-section slot component. Thin wrapper that owns
 * its own Suspense around the lazily imported form, so the form stays out of the
 * cold index chunk (only the i18n catalog is eager).
 *
 * See change: add-context-mode-settings-plugin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { lazy, Suspense } from "react";

const Form = lazy(() => import("./ContextModeSettingsForm.js").then((m) => ({ default: m.ContextModeSettingsForm })));

export function ContextModeSettings(): React.ReactElement {
  const t = useT();
  return (
    <Suspense fallback={<div className="text-[13px] text-[var(--text-muted)]">{t("loading", undefined, "Loading…")}</div>}>
      <Form />
    </Suspense>
  );
}
