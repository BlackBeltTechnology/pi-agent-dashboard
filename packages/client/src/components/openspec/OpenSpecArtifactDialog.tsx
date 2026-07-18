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

  const body = isWaitingForReplay ? (
    <MarkdownPreviewView title={changeName} isLoading onBack={onClose} />
  ) : !change ? (
    <MarkdownPreviewView
      title={changeName}
      error={i18nT("openspec.changeNotFoundInFolder", { changeName }, 'No OpenSpec change named "{changeName}" in this folder.')}
      onBack={onClose}
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
    />
  );

  return (
    <Dialog open size="full" flush onClose={onClose} ariaLabel={changeName} testId="openspec-artifact-dialog">
      {/* Height-constrained flex box is load-bearing: MarkdownPreviewView's
          root uses `flex-1`, which needs a flex parent to grow. The flush
          Dialog container is not flex, so without this wrapper the header/tabs
          collapse and the content area is invisible. */}
      <div className="h-[85vh] flex flex-col">{body}</div>
    </Dialog>
  );
}
