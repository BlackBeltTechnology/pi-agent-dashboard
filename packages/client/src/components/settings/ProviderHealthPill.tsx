/**
 * Health pill for custom-endpoint surfaces (dialog pane + connected row).
 *
 * Five registers per provider-connection-test: connected (green, model count),
 * error (yellow, HTTP status), unreachable (red, no status), not tested
 * (neutral), plus the pending register a single-provider write shows while its
 * detached probe is in flight (F10). Credential rows (subscription / API key /
 * environment) render NO pill at all — the pill is scoped to custom endpoints
 * by design D8.
 *
 * Moved from SettingsPanel.tsx's LlmProviderCard (the Save-bar draft card this
 * change deletes). See change: redesign-providers-settings-page.
 */
import { mdiAlert, mdiCheckCircle, mdiCloseCircle, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
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

export function ProviderHealthPill({ view }: { view: PillView }) {
  if (view.kind === "testing") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]" data-testid="health-pill" data-state="testing">
        <Icon path={mdiLoading} size={0.45} className="animate-spin" />
        {i18nT("common.testing", undefined, "Testing...")}
      </div>
    );
  }
  if (view.kind === "pending") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]" data-testid="health-pill" data-state="pending">
        <Icon path={mdiLoading} size={0.45} className="animate-spin" />
        {i18nT("providers.pendingProbe", undefined, "Checking connection…")}
      </div>
    );
  }
  if (view.kind === "ok") {
    const label = view.modelCount > 0
      ? i18nT("settings.connectedModels", { count: view.modelCount }, `Connected · ${view.modelCount} models`)
      : i18nT("settings.connectedOnly", undefined, "Connected");
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-400" data-testid="health-pill" data-state="ok">
        <Icon path={mdiCheckCircle} size={0.5} />
        {label}
      </div>
    );
  }
  if (view.kind === "not-tested") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]" data-testid="health-pill" data-state="not-tested">
        {i18nT("settings.providerNotTested", undefined, "Not tested")}
      </div>
    );
  }
  const isError = view.kind === "error";
  return (
    <>
      <div
        className={`flex items-center gap-1.5 text-xs ${isError ? "text-yellow-400" : "text-red-400"}`}
        data-testid="health-pill"
        data-state={view.kind}
      >
        <Icon path={isError ? mdiAlert : mdiCloseCircle} size={0.5} />
        {isError ? String(view.status) : i18nT("settings.providerUnreachable", undefined, "Unreachable")}
      </div>
      {view.error && (
        <div className="font-mono text-[11px] text-[var(--text-tertiary)] break-all whitespace-pre-wrap" data-testid="provider-error-line">
          {view.error}
        </div>
      )}
    </>
  );
}
