import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { OpenSpecArtifact, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useState } from "react";
import { useOpenSpecReader } from "../../hooks/useOpenSpecReader.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";

interface Props {
  cwd: string;
  changeName: string;
  initialArtifact: string;
  openspecMap: Map<string, OpenSpecData>;
  onClose: () => void;
}

/**
 * Non-mobile artifact reader rendered as a local-state Dialog over the current
 * view (URL unchanged). Mirrors `ArchiveArtifactReader` (local `activeTab` →
 * `useOpenSpecReader` with `archive=false` → `onTabChange={setActiveTab}`) but
 * lives in a full-size flush `Dialog`. See change:
 * openspec-artifact-dialog-desktop.
 */
export function OpenSpecArtifactDialog({ cwd, changeName, initialArtifact, openspecMap, onClose }: Props) {
  const [activeTab, setActiveTab] = useState(initialArtifact);

  // Re-derive from the live map every render, same source `OpenSpecPreview`
  // uses — so a change removed mid-dialog flips to not-found rather than
  // crashing, and a cold-load converges once WS replay populates the entry.
  const openspecData = openspecMap.get(cwd);
  const change = openspecData?.changes.find((c) => c.name === changeName);
  const artifacts: OpenSpecArtifact[] = change?.artifacts ?? [];

  // Cold-load: WS replay hasn't populated this cwd yet.
  const isWaitingForReplay = !openspecData;

  // Rules-of-hooks: always invoke the reader. During waiting / not-found the
  // dedicated branches below mask its output (an explicit not-found state,
  // NOT the reader's generic "Failed to fetch" on a missing file).
  const reader = useOpenSpecReader(cwd, changeName, activeTab, artifacts);

  // The child owns dismissal. A flush Dialog renders no ✕ of its own (it would
  // paint over this header's search box — what the deleted `closeInset` existed
  // to dodge), so without an `onBack` on EVERY branch this dialog would have no
  // visible way out. See change: fix-flush-dialog-scroll-and-close-collision.
  const backLabel = i18nT("common.close", undefined, "Close");
  const body = isWaitingForReplay ? (
    <MarkdownPreviewView title={changeName} isLoading onBack={onClose} backLabel={backLabel} />
  ) : !change ? (
    <MarkdownPreviewView
      title={changeName}
      error={i18nT("openspec.changeNotFoundInFolder", { changeName }, 'No OpenSpec change named "{changeName}" in this folder.')}
      onBack={onClose}
      backLabel={backLabel}
    />
  ) : (
    <MarkdownPreviewView
      title={reader.title}
      content={reader.content}
      isLoading={reader.isLoading}
      error={reader.error}
      tabs={reader.tabs}
      activeTab={reader.activeTab}
      onTabChange={setActiveTab}
      onBack={onClose}
      backLabel={backLabel}
    />
  );

  return (
    <Dialog open size="full" flush onClose={onClose} ariaLabel={changeName} testId="openspec-artifact-dialog">
      {/* No wrapper: the flush Dialog panel is itself a capped flex column now,
          so `MarkdownPreviewView`'s `flex-1 min-h-0` root is bounded by it. The
          old `h-[85vh] flex flex-col` box was a local re-creation of exactly
          that context. See change:
          fix-flush-dialog-scroll-and-close-collision. */}
      {body}
    </Dialog>
  );
}
