import React, { useState } from "react";
import type { ChatImage } from "../../lib/event-reducer.js";
import { ImageLightbox } from "../ImageLightbox.js";

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
            <img
              key={i}
              src={src}
              alt={label}
              className="max-w-[512px] max-h-[512px] rounded border border-white/20 object-contain cursor-pointer"
              onClick={() => setLightboxSrc({ src, alt: label })}
            />
          );
        })}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc.src} alt={lightboxSrc.alt} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  );
}
