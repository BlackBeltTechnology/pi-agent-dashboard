/**
 * Health pill for custom-endpoint surfaces (dialog pane + connected row).
 *
 * Five registers per provider-connection-test: connected (success, model count),
 * error (warning, HTTP status), unreachable (error, no status), not tested
 * (neutral), plus the pending register a single-provider write shows while its
 * detached probe is in flight (F10). Rendered by the shared status pill; the raw
 * error text sits behind "Copy details" (align-ui-contract-recipes). Credential rows (subscription / API key /
 * environment) render NO pill at all — the pill is scoped to custom endpoints
 * by design D8.
 *
 * Moved from SettingsPanel.tsx's LlmProviderCard (the Save-bar draft card this
 * change deletes). See change: redesign-providers-settings-page.
 */
import { SettingsActionError, SettingsStatusPill, type SettingsStatusTone } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiLoading } from "@mdi/js";
import { type ReactNode, useId } from "react";
import type { ProviderHealth } from "../../lib/api/providers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** A live Test response (POST /api/providers/test), already normalized. */
export type LiveTestResult =
  | { ok: true; modelCount: number }
  | { ok: false; status?: number; error: string };

export type PillView =
  | { kind: "testing" }
  | { kind: "ok"; modelCount: number }
  | { kind: "error"; status: number; error: string }
  | { kind: "unreachable"; error: string }
  | { kind: "pending" }
  | { kind: "not-tested" };

export function derivePillView(args: {
  testing?: boolean;
  live?: LiveTestResult | null;
  /** A write just landed and its detached probe has not been reconciled yet. */
  pending?: boolean;
  health?: ProviderHealth;
}): PillView {
  if (args.testing) return { kind: "testing" };
  if (args.live) {
    return args.live.ok
      ? { kind: "ok", modelCount: args.live.modelCount }
      : args.live.status !== undefined
        ? { kind: "error", status: args.live.status, error: args.live.error }
        : { kind: "unreachable", error: args.live.error };
  }
  if (args.pending) return { kind: "pending" };
  const health = args.health;
  if (!health) return { kind: "not-tested" };
  if (health.ok) return { kind: "ok", modelCount: health.modelCount ?? 0 };
  return health.status !== undefined
    ? { kind: "error", status: health.status, error: health.error ?? "" }
    : { kind: "unreachable", error: health.error ?? "" };
}

/** The pill itself: the shared status pill in a wrapper that keeps the stable test id and state. */
function HealthPill({ state, tone, icon, spinning, children }: { state: string; tone: SettingsStatusTone; icon?: string; spinning?: boolean; children: ReactNode }) {
  return (
    <span data-testid="health-pill" data-state={state} className="inline-flex">
      <SettingsStatusPill tone={tone} icon={icon} spinning={spinning}>
        {children}
      </SettingsStatusPill>
    </span>
  );
}

export function ProviderHealthPill({ view }: { view: PillView }) {
  const errorId = useId();
  if (view.kind === "testing") {
    return (
      <HealthPill state="testing" tone="info" icon={mdiLoading} spinning>
        {i18nT("common.testing", undefined, "Testing...")}
      </HealthPill>
    );
  }
  if (view.kind === "pending") {
    return (
      <HealthPill state="pending" tone="info" icon={mdiLoading} spinning>
        {i18nT("providers.pendingProbe", undefined, "Checking connection…")}
      </HealthPill>
    );
  }
  if (view.kind === "ok") {
    const label = view.modelCount > 0
      ? i18nT("settings.connectedModels", { count: view.modelCount }, `Connected · ${view.modelCount} models`)
      : i18nT("settings.connectedOnly", undefined, "Connected");
    return (
      <HealthPill state="ok" tone="success">
        {label}
      </HealthPill>
    );
  }
  if (view.kind === "not-tested") {
    return (
      <HealthPill state="not-tested" tone="neutral">
        {i18nT("settings.providerNotTested", undefined, "Not tested")}
      </HealthPill>
    );
  }
  const isError = view.kind === "error";
  return (
    <>
      <HealthPill state={view.kind} tone={isError ? "warning" : "error"}>
        {isError ? String(view.status) : i18nT("settings.providerUnreachable", undefined, "Unreachable")}
      </HealthPill>
      {view.error && (
        <SettingsActionError id={errorId} testId="provider-error-line" details={view.error}>
          {i18nT("providers.healthErrorLine", undefined, "The connection test didn't pass. Copy the details to see why.")}
        </SettingsActionError>
      )}
    </>
  );
}
