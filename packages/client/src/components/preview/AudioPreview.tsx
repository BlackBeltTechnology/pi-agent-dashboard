/**
 * Audio preview. `<audio controls>` against `/api/file/raw` — the server
 * supports HTTP Range so the browser's scrubber works. Shared by the editor
 * pane (audio tab) and any inline preview.
 * See change: improve-content-editor (tasks §4.1).
 */
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function AudioPreview({ target }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <audio src={rawUrl(target)} controls preload="metadata" className="w-full max-w-xl">
        <track kind="captions" />
      </audio>
    </div>
  );
}

export default AudioPreview;
