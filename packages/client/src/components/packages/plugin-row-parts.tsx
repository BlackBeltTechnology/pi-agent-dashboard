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
import { copyText } from "../../lib/util/clipboard.js";

// Severity-token fragments (`ui-contract.md`: `--severity-*` is text-safe on its
// own `-bg`; a raw `--accent-<hue>` FILL is not a text colour). `WARN_*`/`LINK_*`
// stay exported for existing consumers; `ERR_*`/`OK_*`/`NEUTRAL_*` are private.
// See change: retro-ux-plugin-settings-wave-2 (design D5).
export const WARN_FG = "text-[var(--severity-warning-fg)]";
export const WARN_BG = "bg-[var(--severity-warning-bg)]";
export const WARN_BORDER = "border-[var(--severity-warning-border)]";
const ERR_FG = "text-[var(--severity-error-fg)]";
const ERR_BG = "bg-[var(--severity-error-bg)]";
const ERR_BORDER = "border-[var(--severity-error-border)]";
const OK_FG = "text-[var(--severity-success-fg)]";
const OK_BG = "bg-[var(--severity-success-bg)]";
const OK_BORDER = "border-[var(--severity-success-border)]";
const NEUTRAL_FG = "text-[var(--severity-neutral-fg)]";
const NEUTRAL_BG = "bg-[var(--severity-neutral-bg)]";
const NEUTRAL_BORDER = "border-[var(--severity-neutral-border)]";
export const LINK_FG = "text-[var(--severity-info-fg)]";
export const LINK_BG = "bg-[var(--severity-info-bg)]";
export const LINK_BG_HOVER = "hover:opacity-80";
export const LINK_BORDER = "border-[var(--severity-info-border)]";

export function StatusPill({ row }: { row: PluginRow }) {
  const status = row.status;
  if (!status) {
    return (
      <span className={`px-1.5 py-0.5 text-[11px] rounded ${NEUTRAL_BG} ${NEUTRAL_FG} border ${NEUTRAL_BORDER}`}>
        unknown
      </span>
    );
  }
  if (status.error) {
    return (
      <span
        className={`px-1.5 py-0.5 text-[11px] rounded ${ERR_BG} ${ERR_FG} border ${ERR_BORDER}`}
        title={status.error}
      >
        error
      </span>
    );
  }
  if (!status.enabled) {
    return (
      <span className={`px-1.5 py-0.5 text-[11px] rounded ${NEUTRAL_BG} ${NEUTRAL_FG} border ${NEUTRAL_BORDER}`}>
        disabled
      </span>
    );
  }
  if (!status.loaded) {
    return (
      <span className={`px-1.5 py-0.5 text-[11px] rounded ${WARN_BG} ${WARN_FG} border ${WARN_BORDER}`}>
        {i18nT("common.notLoaded", undefined, "not loaded")}
      </span>
    );
  }
  return (
    <span className={`px-1.5 py-0.5 text-[11px] rounded ${OK_BG} ${OK_FG} border ${OK_BORDER}`}>
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
          // Clipboard denied/unavailable — keep button visible.
          if (await copyText(text)) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }
        }}
        title={i18nT("status.copyErrorToClipboard", undefined, "Copy error to clipboard")}
        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border ${ERR_BORDER} hover:opacity-80`}
        data-testid={`${testId}-copy`}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.45} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function MissingRequirementsBlock({ row, inNotice = false }: { row: PluginRow; /** Rendered inside a `SettingsNotice` that already carries the warning icon + tone. */ inNotice?: boolean }) {
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
  // `paths` category (see change: add-apple-tools-imcp-plugin). A path has no
  // package source, so it renders a non-actionable warning pill (no [Install]).
  const pathsMissing = row.status?.requirements?.paths
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];

  function recommendedFor(name: string): { source: string } | null {
    const found = RECOMMENDED_EXTENSIONS.find((e) => e.id === name);
    return found ? { source: found.source } : null;
  }

  return (
    <div className={inNotice ? "space-y-1.5" : "mt-2 space-y-1.5"}>
      {piExtMissing.map((name) => {
        const rec = recommendedFor(name);
        return (
          <div
            key={`pi:${name}`}
            className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
            data-testid={`missing-piExtension-${name}`}
          >
            {inNotice ? null : <Icon path={mdiAlert} size={0.5} />}
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
                className={`px-2 py-0.5 rounded text-[11px] ${LINK_BG} ${LINK_BG_HOVER} ${LINK_FG} border ${LINK_BORDER}`}
                data-testid={`install-piExtension-${name}`}
              >
                {i18nT("common.install2", undefined, "Install")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/settings/add-ons")}
                className="px-2 py-0.5 rounded text-[11px] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
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
          {inNotice ? null : <Icon path={mdiAlert} size={0.5} />}
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
          {inNotice ? null : <Icon path={mdiAlert} size={0.5} />}
          <span>
            {i18nT("common.requiresService", undefined, "requires service:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
      {pathsMissing.map((name) => (
        <div
          key={`path:${name}`}
          className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
          data-testid={`missing-path-${name}`}
        >
          {inNotice ? null : <Icon path={mdiAlert} size={0.5} />}
          <span>
            {i18nT("common.requiresPath", undefined, "requires file:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
    </div>
  );
}
