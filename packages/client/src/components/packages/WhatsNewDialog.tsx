/**
 * Modal dialog rendering parsed CHANGELOG entries between two versions
 * of a core package. Opens from the breaking-change icon on Core rows
 * in `UnifiedPackagesSection`.
 *
 * Layout:
 *   - Title: "What's new in <displayName> (from → to)"
 *   - Breaking Changes: pinned at top, always expanded
 *   - New features: collapsed by default
 *   - Other changes (changed + fixed): collapsed by default
 *   - Footer: GitHub changelog link + Cancel + Update CTA
 *
 * See change: pi-update-whats-new-panel.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type {
  ChangelogBullet,
  ChangelogRelease,
  ChangelogResponse,
} from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";
import {
  mdiAlertCircleOutline,
  mdiArrowUpBold,
  mdiChevronDown,
  mdiChevronRight,
  mdiOpenInNew,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

export interface WhatsNewDialogProps {
  /** When false, the component renders nothing. */
  open: boolean;
  /** Parsed changelog response from `GET /api/pi-core/changelog`. */
  response: ChangelogResponse;
  /** User-facing package name for the dialog title. */
  displayName: string;
  /** Latest version string used in the Update CTA label. */
  latestVersion: string;
  /** Closes the dialog without acting. */
  onClose: () => void;
  /** Closes the dialog AND triggers the update flow. */
  onUpdate: () => void;
}

export function WhatsNewDialog({
  open,
  response,
  displayName,
  latestVersion,
  onClose,
  onUpdate,
}: WhatsNewDialogProps): React.ReactElement | null {
  const [featuresExpanded, setFeaturesExpanded] = useState(false);
  const [otherExpanded, setOtherExpanded] = useState(false);

  // Aggregate bullets across releases for the collapsed sections.
  const featureGroups = useMemo(
    () => collectGrouped(response.releases, "features"),
    [response.releases],
  );
  const otherGroups = useMemo(
    () => collectChangedAndFixed(response.releases),
    [response.releases],
  );

  if (!open) return null;

  const hasReleases = response.releases.length > 0;
  const hasFeatures = featureGroups.some((g) => g.bullets.length > 0);
  const hasOther = otherGroups.some((g) => g.bullets.length > 0);

  const handleUpdate = (): void => {
    onClose();
    onUpdate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`What’s new in ${displayName}`}
      size="lg"
      testId="whats-new-dialog"
    >
          <span className="text-[10px] text-[var(--text-muted)] font-mono -mt-2 block">
            {response.from} → {response.to}
          </span>

          {/* Content */}
          <div className="space-y-4">
            {!hasReleases && (
              <p
                className="text-sm text-[var(--text-muted)] italic"
                data-testid="whats-new-empty"
              >
                {i18nT("common.noReleaseNotesAvailableForThis", undefined, "No release notes available for this version range.")}
              </p>
            )}

            {response.hasBreaking && (
              <BreakingSection releases={response.releases} />
            )}

            {hasFeatures && (
              <CollapsibleGroup
                label={`New features${countLabel(featureGroups)}`}
                expanded={featuresExpanded}
                onToggle={() => setFeaturesExpanded((v) => !v)}
                groups={featureGroups}
                testId="whats-new-features"
              />
            )}

            {hasOther && (
              <CollapsibleGroup
                label={`Other changes${countLabel(otherGroups)}`}
                expanded={otherExpanded}
                onToggle={() => setOtherExpanded((v) => !v)}
                groups={otherGroups}
                testId="whats-new-other"
              />
            )}

            {response.changelogUrl && (
              <div className="pt-2 border-t border-[var(--border-secondary)]">
                <a
                  href={response.changelogUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1"
                  data-testid="whats-new-github-link"
                >
                  {i18nT("git.openFullChangelogOnGithub", undefined, "Open full changelog on GitHub")}
                  <Icon path={mdiOpenInNew} size={0.45} />
                </a>
              </div>
            )}
          </div>

          {/* Footer CTAs */}
          <Dialog.Footer>
            <Dialog.Cancel onClick={onClose} testId="whats-new-cancel" />
            <button
              onClick={handleUpdate}
              className="text-xs px-3 py-1.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 flex items-center gap-1 font-medium"
              data-testid="whats-new-update"
            >
              <Icon path={mdiArrowUpBold} size={0.45} />
              {i18nT("common.updateTo", undefined, "Update to")} {latestVersion}
            </button>
          </Dialog.Footer>
    </Dialog>
  );
}

// ── Breaking-changes section (always expanded) ─────────────────────

function BreakingSection({ releases }: { releases: ChangelogRelease[] }): React.ReactElement {
  const groups = collectGrouped(releases, "breaking");
  const total = groups.reduce((s, g) => s + g.bullets.length, 0);
  return (
    <section data-testid="whats-new-breaking">
      <header className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-amber-500/30">
        <Icon
          path={mdiAlertCircleOutline}
          size={0.55}
          className="text-amber-400 flex-shrink-0"
        />
        <h4 className="text-xs font-semibold text-amber-200">
          {total} {i18nT("common.breakingChange", undefined, "breaking change")}{total === 1 ? "" : "s"} {i18nT("common.sinceYourVersion", undefined, "since your version")}
        </h4>
      </header>
      <BulletGroups groups={groups} />
    </section>
  );
}

// ── Collapsible group used for features + other ────────────────────

interface BulletGroup {
  version: string;
  date: string | null;
  bullets: ChangelogBullet[];
}

function CollapsibleGroup({
  label,
  expanded,
  onToggle,
  groups,
  testId,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  groups: BulletGroup[];
  testId: string;
}): React.ReactElement {
  return (
    <section data-testid={testId}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full text-left text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-1"
        data-testid={`${testId}-toggle`}
        aria-expanded={expanded}
      >
        <Icon
          path={expanded ? mdiChevronDown : mdiChevronRight}
          size={0.55}
        />
        {label}
      </button>
      {expanded && <BulletGroups groups={groups} />}
    </section>
  );
}

function BulletGroups({ groups }: { groups: BulletGroup[] }): React.ReactElement {
  return (
    <div className="space-y-3 pl-1">
      {groups.map((g) => (
        <div key={g.version}>
          <div className="text-[10px] font-mono text-[var(--text-muted)] mb-0.5">
            [{g.version}]{g.date ? ` · ${g.date}` : ""}
          </div>
          <ul className="list-disc pl-4 space-y-1.5 text-xs text-[var(--text-primary)]">
            {g.bullets.map((b, i) => (
              <li key={i} className="leading-relaxed">
                <BulletProse text={b.text} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Render a bullet's prose. Goes through `MarkdownContent` so issue
 * links survive as clickable anchors with the existing sanitization.
 * Wrap in a span so list-item semantics aren't broken by block-level
 * content from the renderer.
 */
function BulletProse({ text }: { text: string }): React.ReactElement {
  return (
    <span className="whats-new-bullet">
      <MarkdownContent content={text} />
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function collectGrouped(
  releases: ChangelogRelease[],
  field: "breaking" | "features" | "changed" | "fixed",
): BulletGroup[] {
  const out: BulletGroup[] = [];
  for (const r of releases) {
    const bullets = r[field];
    if (bullets.length > 0) {
      out.push({ version: r.version, date: r.date, bullets });
    }
  }
  return out;
}

function collectChangedAndFixed(releases: ChangelogRelease[]): BulletGroup[] {
  const out: BulletGroup[] = [];
  for (const r of releases) {
    const bullets = [...r.changed, ...r.fixed];
    if (bullets.length > 0) {
      out.push({ version: r.version, date: r.date, bullets });
    }
  }
  return out;
}

function countLabel(groups: BulletGroup[]): string {
  const total = groups.reduce((s, g) => s + g.bullets.length, 0);
  return total > 0 ? ` (${total})` : "";
}
