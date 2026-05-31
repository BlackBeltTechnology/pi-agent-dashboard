/**
 * YouTube preview. Extracts the video id from any YouTube URL flavor
 * (`youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/embed/…`) and
 * renders the standard embed iframe. 16:9 aspect. See change:
 * render-file-previews.
 */
import React from "react";

interface Props {
  target: { kind: "url"; url: string };
}

/**
 * Extract a YouTube video id from a URL. Returns null if the URL doesn't
 * match any known YouTube shape.
 */
export function extractYouTubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // /embed/<id> or /v/<id> or /shorts/<id>
      const m = /^\/(?:embed|v|shorts)\/([^/?#]+)/.exec(u.pathname);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function YouTubePreview({ target }: Props) {
  const id = extractYouTubeId(target.url);
  if (!id) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-2">
        Couldn't extract a YouTube video id from <code>{target.url}</code>.
      </div>
    );
  }
  return (
    <div className="w-full aspect-video bg-black">
      <iframe
        src={`https://www.youtube.com/embed/${encodeURIComponent(id)}`}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="YouTube preview"
      />
    </div>
  );
}
