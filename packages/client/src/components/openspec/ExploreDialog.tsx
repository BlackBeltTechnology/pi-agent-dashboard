import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCompassOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { useImagePaste } from "../../hooks/useImagePaste.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ImagePreviewStrip } from "../preview/ImagePreviewStrip.js";

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

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim(), pendingImages.length > 0 ? pendingImages : undefined);
      clearImages();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Explore: ${changeName}`} size="lg" testId="explore-dialog">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={i18nT("common.whatDoYouWantToExplore", undefined, "What do you want to explore? Paste a screenshot to include it.")}
          className="w-full h-48 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded p-2 text-sm text-[var(--text-secondary)] resize-none focus:outline-none focus:border-blue-500"
          autoFocus
          data-testid="explore-textarea"
        />
        {/* Pasted-image error banner + thumbnail strip (shared component). */}
        <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />
        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose} testId="explore-cancel" />
          <Dialog.Action onClick={handleSend} disabled={!text.trim()} testId="explore-send">
            <Icon path={mdiCompassOutline} size={0.5} className="inline mr-0.5" />{i18nT("common.explore", undefined, "Explore")}
          </Dialog.Action>
        </Dialog.Footer>
    </Dialog>
  );
}
