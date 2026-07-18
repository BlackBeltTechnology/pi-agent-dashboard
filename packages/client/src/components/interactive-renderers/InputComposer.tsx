import React, { useRef } from "react";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useImagePaste } from "../../hooks/useImagePaste.js";
import { ImagePreviewStrip } from "../preview/ImagePreviewStrip.js";

/**
 * InputComposer — shared multiline textarea + clipboard-image-paste body used
 * by both `InputRenderer` (standalone ask_user{method:"input"}) and
 * `BatchRenderer`'s `input` step. Keeps the paste UX identical and DRY.
 *
 * Controlled: the caller owns `value` + `images` and gets `onChange`. `Enter`
 * inserts a newline; `Cmd/Ctrl+Enter` (or the Submit button) calls `onSubmit`;
 * `Esc` calls `onCancel`. No "paste supported" hint — silent affordance,
 * matching the main composer.
 *
 * See change: add-ask-user-input-multiline-paste.
 */
export function InputComposer({
  value,
  images,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
}: {
  value: string;
  images: ImageContent[];
  onChange: (next: { value: string; images: ImageContent[] }) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { pendingImages, imageError, handlePaste, removeImage } = useImagePaste({
    images,
    onImagesChange: (next) => onChange({ value, images: next }),
  });

  return (
    <div>
      <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />
      <textarea
        ref={taRef}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange({ value: e.target.value, images })}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={1}
        className="w-full px-2.5 py-1.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-blue-500 resize-none"
        style={{ minHeight: "32px", maxHeight: "160px" }}
        onInput={(e) => {
          const t = e.target as HTMLTextAreaElement;
          t.style.height = "32px";
          t.style.height = Math.min(t.scrollHeight, 160) + "px";
        }}
      />
    </div>
  );
}
