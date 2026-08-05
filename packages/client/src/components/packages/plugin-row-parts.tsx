/**
 * Shared presentational internals for plugin activation rows and the
 * per-plugin settings page.
 *
 * Extracted verbatim from `PluginsSection.tsx` so `PluginSettingsPage` can
 * reuse the status pill, copyable error block, and missing-requirement banner
 * instead of duplicating them (design D9).
 *
 * See change: plugin-settings-pages.
 */

import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import { mdiAlert, mdiCheck, mdiContentCopy } from "@mdi/js";
import Icon from "@mdi/react";
import { useState } from "react";
import { useLocation } from "wouter";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";

// Theme-aware fragments built on the dashboard's `--accent-*` CSS vars
// (defined in packages/client/src/index.css for both dark and light :root).
// Uses the same `color-mix(in_srgb, var(--accent-X) NN%, transparent)` pattern
// the rest of the codebase uses (EditToolRenderer, DiffView, etc).
export const WARN_FG = "text-[var(--accent-yellow)]";
export const WARN_BG = "bg-[color-mix(in_srgb,var(--accent-yellow)_12%,transparent)]";
export const WARN_BORDER = "border-[color-mix(in_srgb,var(--accent-yellow)_40%,transparent)]";
export const ERR_FG = "text-[var(--accent-red)]";
export const ERR_BG = "bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)]";
export const ERR_BORDER = "border-[color-mix(in_srgb,var(--accent-red)_40%,transparent)]";
export const OK_FG = "text-[var(--accent-green)]";
export const OK_BG = "bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
export const OK_BORDER = "border-[color-mix(in_srgb,var(--accent-green)_40%,transparent)]";
export const LINK_FG = "text-[var(--accent-blue)]";
export const LINK_BG = "bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)]";
export const LINK_BG_HOVER = "hover:bg-[color-mix(in_srgb,var(--accent-blue)_22%,transparent)]";
export const LINK_BORDER = "border-[color-mix(in_srgb,var(--accent-blue)_40%,transparent)]";

export function StatusPill({ row }: { row: PluginRow }) {
  const status = row.status;
  if (!status) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border-secondary)]">
        unknown
      </span>
    );
  }
  if (status.error) {
    return (
      <span
        className={`px-1.5 py-0.5 text-[10px] rounded ${ERR_BG} ${ERR_FG} border ${ERR_BORDER}`}
        title={status.error}
      >
        error
      </span>
    );
  }
  if (!status.enabled) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-secondary)]">
        disabled
      </span>
    );
  }
  if (!status.loaded) {
    return (
      <span className={`px-1.5 py-0.5 text-[10px] rounded ${WARN_BG} ${WARN_FG} border ${WARN_BORDER}`}>
        {i18nT("common.notLoaded", undefined, "not loaded")}
      </span>
    );
  }
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded ${OK_BG} ${OK_FG} border ${OK_BORDER}`}>
      enabled
    </span>
  );
}

export function CopyableErrorBlock({ text, testId }: { text: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded ${ERR_BG} ${ERR_FG} border ${ERR_BORDER} text-xs`}
      data-testid={testId}
    >
      <Icon path={mdiAlert} size={0.6} className="shrink-0 mt-0.5" />
      <pre className="flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard denied — keep button visible */
          }
        }}
        title={i18nT("status.copyErrorToClipboard", undefined, "Copy error to clipboard")}
        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${ERR_BORDER} hover:opacity-80`}
        data-testid={`${testId}-copy`}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.45} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function MissingRequirementsBlock({ row }: { row: PluginRow }) {
  const missing = row.status?.missingRequirements ?? [];
  const operations = usePackageOperations("global");
  const [, navigate] = useLocation();
  if (!missing.length) return null;

  const piExtMissing = row.status?.requirements?.piExtensions
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];
  const binMissing = row.status?.requirements?.binaries
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];
  const svcMissing = row.status?.requirements?.services
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];

  function recommendedFor(name: string): { source: string } | null {
    const found = RECOMMENDED_EXTENSIONS.find((e) => e.id === name);
    return found ? { source: found.source } : null;
  }

  return (
    <div className="mt-2 space-y-1.5">
      {piExtMissing.map((name) => {
        const rec = recommendedFor(name);
        return (
          <div
            key={`pi:${name}`}
            className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
            data-testid={`missing-piExtension-${name}`}
          >
            <Icon path={mdiAlert} size={0.5} />
            <span>
              {i18nT("packages.requiresPiExtension", undefined, "requires pi extension")}{" "}
              <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                {name}
              </code>
            </span>
            {rec ? (
              <button
                type="button"
                onClick={() => operations.install(rec.source)}
                className={`px-2 py-0.5 rounded text-[10px] ${LINK_BG} ${LINK_BG_HOVER} ${LINK_FG} border ${LINK_BORDER}`}
                data-testid={`install-piExtension-${name}`}
              >
                {i18nT("common.install2", undefined, "Install")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/settings/packages")}
                className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                data-testid={`install-piExtension-link-${name}`}
              >
                {i18nT("packages.installViaPackagesTab", undefined, "Install via Packages tab")}
              </button>
            )}
          </div>
        );
      })}
      {binMissing.map((name) => (
        <div
          key={`bin:${name}`}
          className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
          data-testid={`missing-binary-${name}`}
        >
          <Icon path={mdiAlert} size={0.5} />
          <span>
            {i18nT("common.requiresBinaryOnPath", undefined, "requires binary on PATH:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
      {svcMissing.map((name) => (
        <div
          key={`svc:${name}`}
          className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
          data-testid={`missing-service-${name}`}
        >
          <Icon path={mdiAlert} size={0.5} />
          <span>
            {i18nT("common.requiresService", undefined, "requires service:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
    </div>
  );
}
