/**
 * #E10: the no-rip rule. Nothing under the package's `.pi/` or `lib/` names a
 * stream-ripping tool. See change: add-music-production-skills.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, read, walk } from "./files";

const RIP = /spotdl|yt-dlp|youtube-dl|savefrom|spotify-dl|ytmp3/i;

describe("no-rip rule", () => {
  const files = [...walk(join(PKG, ".pi")), ...walk(join(PKG, "lib"))];

  it("scans a non-empty tree", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("no file names a stream-ripping tool", () => {
    const hits = files.filter((f) => RIP.test(read(f)));
    expect(hits).toEqual([]);
  });
});
