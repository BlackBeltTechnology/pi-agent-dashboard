/**
 * Video preview. `<video controls>` against `/api/file/raw` — the server
 * supports HTTP Range so the browser's seek bar works. 16:9 aspect.
 * See change: render-file-previews.
 */
import React from "react";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function VideoPreview({ target }: Props) {
  return (
    <div className="w-full aspect-video bg-black">
      <video
        src={rawUrl(target)}
        controls
        preload="metadata"
        className="w-full h-full"
      />
    </div>
  );
}
