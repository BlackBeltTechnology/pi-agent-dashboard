/**
 * Read-only trace of an attachment that is NOT live-active in the session's
 * own cwd: `Archived <date>` + archive letters, `In main checkout` + preview
 * letters, or a muted `Not found`. Renders nothing for `unresolved` (bare
 * layout) and for a same-cwd active attachment (lifecycle UI owns that).
 * See change: resolve-archived-attached-proposal (D5).
 */
import type { OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildArchiveArtifactUrl, buildOpenSpecPreviewUrl } from "../../lib/nav/route-builders.js";
import { useTrackedNavigate } from "../../lib/nav/useTrackedNavigate.js";
import type { AttachmentResolution } from "../../lib/openspec/resolve-attachment.js";
import { ArtifactLetters } from "./openspec-helpers.js";

/** True when the lifecycle UI (stepper, primary, workflow actions) applies. */
export function isLiveActive(resolution: AttachmentResolution | null, sessionCwd: string): boolean {
  return resolution?.kind === "active" && resolution.cwd === sessionCwd;
}

const BADGE = "text-[10px] px-1 rounded border border-[var(--border-secondary)] text-[var(--text-tertiary)] flex-shrink-0";

export function AttachmentTrace({ resolution, sessionCwd }: { resolution: AttachmentResolution | null; sessionCwd: string }) {
  const navigate = useTrackedNavigate();
  if (!resolution || resolution.kind === "unresolved" || isLiveActive(resolution, sessionCwd)) return null;

  if (resolution.kind === "missing") {
    return (
      <span
        className={BADGE}
        data-testid="attachment-not-found-badge"
        title={i18nT("openspec.attachmentNotFoundHint", undefined, "Not in active changes or archive (pull may be needed)")}
      >
        {i18nT("openspec.attachmentNotFound", undefined, "Not found")}
      </span>
    );
  }

  if (resolution.kind === "archived") {
    const { entry, cwd } = resolution;
    return (
      <>
        <span className={BADGE} data-testid="attachment-archived-badge">
          {i18nT("openspec.archivedOn", { date: entry.date }, "Archived {date}")}
        </span>
        <ArtifactLetters
          artifacts={entry.artifacts as OpenSpecArtifact[]}
          changeName={entry.name}
          onReadArtifact={(_name, artifactId) => navigate(buildArchiveArtifactUrl(cwd, entry.name, artifactId))}
        />
      </>
    );
  }

  // active, but in the main checkout rather than the session's own (removed) cwd
  const { change, cwd } = resolution;
  return (
    <>
      <span className={BADGE} data-testid="attachment-main-checkout-badge">
        {i18nT("openspec.inMainCheckout", undefined, "In main checkout")}
      </span>
      <ArtifactLetters
        artifacts={change.artifacts}
        changeName={change.name}
        onReadArtifact={(name, artifactId) => navigate(buildOpenSpecPreviewUrl(cwd, name, artifactId))}
      />
    </>
  );
}
