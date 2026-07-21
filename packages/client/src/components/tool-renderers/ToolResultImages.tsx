import React, { useState } from "react";
import type { ChatImage } from "../../lib/chat/event-reducer.js";
import { ImageLightbox } from "../preview/ImageLightbox.js";

/**
 * Renders inlined `type:"image"` tool-result blocks as clickable thumbnails
 * with a lightbox. Shared across tool renderers (Read, Bash, Generic) so any
 * tool that surfaces an inlined image (e.g. the `browser` skill's `screenshot`
 * via bash) displays it the same way.
 *
 * See change: inline-agent-screenshot-artifacts.
 */
export function ToolResultImages({ images, alt }: { images: ChatImage[]; alt?: string }) {
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);
  if (!images || images.length === 0) return null;
  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {images.map((img, i) => {
          const src = `data:${img.mimeType};base64,${img.data}`;
          const label = alt ?? `Image ${i + 1}`;
          return (
            <button
              key={i}
              type="button"
              aria-label={`Open ${label} full size`}
              className="p-0 border-0 bg-transparent cursor-pointer"
              onClick={() => setLightboxSrc({ src, alt: label })}
            >
              <img
                src={src}
                alt={label}
                className="max-w-[512px] max-h-[512px] rounded border border-white/20 object-contain"
              />
            </button>
          );
        })}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc.src} alt={lightboxSrc.alt} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  );
}
