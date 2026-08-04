import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCompassOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { useImagePaste } from "../../hooks/useImagePaste.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ImagePreviewStrip } from "../preview/ImagePreviewStrip.js";
import { useOpenSpecRunConfigRow } from "./useOpenSpecRunConfigRow.js";

interface Props {
  changeName: string;
  /**
   * Fired with the trimmed text plus any pasted images. `images` is
   * undefined when the user didn't paste anything so existing callers
   * that only care about text can keep ignoring the second argument.
   */
  onSend: (text: string, images?: ImageContent[]) => void;
  onClose: () => void;
}

export function ExploreDialog({ changeName, onSend, onClose }: Props) {
  const [text, setText] = useState("");
  const { pendingImages, imageError, handlePaste, removeImage, clearImages } = useImagePaste();
  const { rowElement, submit, sending } = useOpenSpecRunConfigRow();

  const handleSend = () => {
    if (!text.trim()) return;
    const images = pendingImages.length > 0 ? pendingImages : undefined;
    submit(() => {
      onSend(text.trim(), images);
      clearImages();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("common.explore", undefined, "Explore")} icon={mdiCompassOutline} size="lg" testId="explore-dialog">
        {changeName && (
          <span
            data-testid="explore-name-chip"
            className="inline-block max-w-full truncate rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs font-mono text-[var(--text-secondary)] align-middle"
            title={changeName}
          >
            {changeName}
          </span>
        )}
        <p data-testid="explore-hint" className="text-xs text-[var(--text-tertiary)]">
          {i18nT("openspec.exploreHint", undefined, "Explore the change freely — this does not create or modify a proposal.")}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={i18nT("common.whatDoYouWantToExplore", undefined, "What do you want to explore?")}
          className="w-full h-48 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded p-2 text-sm text-[var(--text-secondary)] resize-none focus:outline-none focus:border-blue-500"
          autoFocus
          data-testid="explore-textarea"
        />
        <p data-testid="explore-field-note" className="text-[11px] text-[var(--text-tertiary)] -mt-2">
          {i18nT("openspec.explorePasteNote", undefined, "Paste a screenshot to include it. Press Cmd/Ctrl+Enter to send.")}
        </p>
        {/* Pasted-image error banner + thumbnail strip (shared component). */}
        <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />
        {rowElement}
        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose} testId="explore-cancel" />
          <Dialog.Action onClick={handleSend} disabled={!text.trim() || sending} testId="explore-send">
            <Icon path={mdiCompassOutline} size={0.5} className="inline mr-0.5" />{i18nT("common.explore", undefined, "Explore")}
          </Dialog.Action>
        </Dialog.Footer>
    </Dialog>
  );
}
