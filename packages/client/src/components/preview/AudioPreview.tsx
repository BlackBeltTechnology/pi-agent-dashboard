/**
 * Audio preview. `<audio controls>` against `/api/file/raw` — the server
 * supports HTTP Range so the browser's scrubber works. Shared by the editor
 * pane (audio tab) and any inline preview.
 * See change: improve-content-editor (tasks §4.1).
 *
 * The direct ranged `src` never prompts. A load failure runs the D2 diagnosis
 * (`useMediaDenial`) and shows `DenialNotice`. See change:
 * surface-denial-remedy-in-previews.
 */
import { MediaDenialNotice } from "./MediaDenialNotice.js";
import { rawUrl } from "./raw-url.js";
import { useMediaDenial } from "./use-media-denial.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function AudioPreview({ target }: Props) {
  const url = rawUrl(target);
  const media = useMediaDenial(url);
  if (media.phase.kind !== "media") return <MediaDenialNotice media={media} url={url} path={target.path} />;
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <audio key={media.attempt} src={url} controls preload="metadata" onError={() => media.onLoadError()} className="w-full max-w-xl">
        <track kind="captions" />
      </audio>
    </div>
  );
}
