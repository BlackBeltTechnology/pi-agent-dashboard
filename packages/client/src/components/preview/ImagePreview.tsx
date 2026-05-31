/**
 * Image preview. Plain `<img>` against `/api/file/raw`. Capped via
 * `max-h-[40vh] max-w-full`. See change: render-file-previews.
 */
import React from "react";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function ImagePreview({ target }: Props) {
  return (
    <img
      src={rawUrl(target)}
      alt={target.path}
      className="max-h-[40vh] max-w-full object-contain"
    />
  );
}
