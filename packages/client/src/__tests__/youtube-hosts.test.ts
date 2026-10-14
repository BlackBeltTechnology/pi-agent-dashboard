/**
 * extractYouTubeId accepts exactly the hosts dispatchPreview routes to the
 * YouTube renderer. Lives under src/__tests__ (jsdom): YouTubePreview.tsx pulls
 * i18n, which needs `window`. See change: fix-codeql-small-findings (test-plan #E15).
 */
import { describe, expect, it } from "vitest";
import { extractYouTubeId } from "../components/preview/YouTubePreview.js";
import { dispatchPreview, YOUTUBE_HOSTS } from "../lib/preview/preview-dispatch.js";

const u = (url: string) => ({ kind: "url" as const, url });

describe("YouTube host set (fix-codeql-small-findings #E15)", () => {
  const ID = "dQw4w9WgXcQ";
  const canonical = [
    `https://youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://youtu.be/${ID}`,
  ];
  const rejected = [
    `https://music.youtube.com/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
  ];

  it("canonical hosts yield the id and route to the youtube renderer", () => {
    expect([...YOUTUBE_HOSTS].sort()).toEqual(["m.youtube.com", "www.youtube.com", "youtu.be", "youtube.com"]);
    for (const url of canonical) {
      expect(extractYouTubeId(url), url).toBe(ID);
      expect(dispatchPreview(u(url)), url).toBe("youtube");
    }
  });

  it("other hosts yield null and are not routed to the youtube renderer", () => {
    for (const url of rejected) {
      expect(extractYouTubeId(url), url).toBeNull();
      expect(dispatchPreview(u(url)), url).not.toBe("youtube");
    }
  });
});
