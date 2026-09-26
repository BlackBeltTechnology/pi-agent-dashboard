/**
 * #E11: no personal or client coupling in the new skill trees — the scripts and
 * guidance were generalized from one client project and must not leak it.
 * See change: add-music-production-skills.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, REPO, read, walk } from "./files";

const COUPLING = /\/Users\/|Projektek|railcargo|becton|blackbelt\.hu/i;
const VIDEO_SKILLS = join(REPO, "packages", "video-production", ".pi", "skills");

describe("no personal/client coupling", () => {
  const files = [
    ...walk(join(PKG, ".pi")),
    ...walk(join(PKG, "lib")),
    ...walk(join(VIDEO_SKILLS, "hyperframes-showreel")),
    ...walk(join(VIDEO_SKILLS, "footage-redaction")),
  ];

  it("scans all four trees", () => {
    expect(files.some((f) => f.includes("hyperframes-showreel"))).toBe(true);
    expect(files.some((f) => f.includes("footage-redaction"))).toBe(true);
    expect(files.some((f) => f.endsWith("musiclib.py"))).toBe(true);
  });

  it("no file carries a personal path or client name", () => {
    const hits = files.filter((f) => COUPLING.test(read(f)));
    expect(hits).toEqual([]);
  });
});
