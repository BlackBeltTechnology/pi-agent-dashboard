/**
 * Video preview. `<video controls>` against `/api/file/raw` — the server
 * supports HTTP Range so the browser's seek bar works. 16:9 aspect.
 * See change: render-file-previews.
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

export function VideoPreview({ target }: Props) {
  const url = rawUrl(target);
  const media = useMediaDenial(url);
  if (media.phase.kind !== "media") return <MediaDenialNotice media={media} url={url} path={target.path} />;
  return (
    <div className="w-full aspect-video bg-black">
      <video
        key={media.attempt}
        src={url}
        controls
        preload="metadata"
        onError={() => media.onLoadError()}
        className="w-full h-full"
      />
    </div>
  );
}
