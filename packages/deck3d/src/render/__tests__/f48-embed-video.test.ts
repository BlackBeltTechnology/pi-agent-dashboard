/**
 * F48 — `--embed-video` inlines clips as `data:` URLs.
 *
 * A single-file deck has no server, and a `file://` sibling clip is
 * cross-origin: it taints the canvas and cannot become a texture. A `data:`
 * URL is same-origin by definition, which is the whole reason this path
 * exists. The IR on disk must keep its readable relative path — only the
 * rendered html carries the bytes.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeckIR } from "../../ir/types.js";
import { embedVideo } from "../embed-video.js";

function fixture(src: string): { ir: DeckIR; jsonPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-embed-"));
  mkdirSync(join(dir, "video"), { recursive: true });
  writeFileSync(join(dir, "video", "clip.mp4"), Buffer.from("fake-mp4-bytes"));
  writeFileSync(join(dir, "..", "outside.mp4"), Buffer.from("secret"));
  const ir = {
    meta: { source: "deck.md" },
    defaults: {},
    overrides: { slides: {} },
    slides: [{ id: "s1", title: "One", kind: "content", effects: [{ id: "video-screen", params: { src } }] }],
  } as unknown as DeckIR;
  return { ir, jsonPath: join(dir, "deck.json"), dir };
}

describe("F48 embed-video", () => {
  it("rewrites a local clip into a data: URL", () => {
    const { ir, jsonPath } = fixture("video/clip.mp4");
    const out = embedVideo(ir, jsonPath);
    const src = out.ir.slides[0].effects?.[0].params?.src as string;
    expect(src.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(Buffer.from(src.split(",")[1], "base64").toString()).toBe("fake-mp4-bytes");
    expect(out.warnings).toEqual([]);
  });

  it("leaves the source IR untouched so the deck stays readable", () => {
    const { ir, jsonPath } = fixture("video/clip.mp4");
    embedVideo(ir, jsonPath);
    expect(ir.slides[0].effects?.[0].params?.src).toBe("video/clip.mp4");
  });

  it("passes through clips that are already inline or remote", () => {
    for (const src of ["data:video/mp4;base64,AAAA", "https://example.com/a.mp4"]) {
      const { ir, jsonPath } = fixture(src);
      const out = embedVideo(ir, jsonPath);
      expect(out.ir.slides[0].effects?.[0].params?.src).toBe(src);
      expect(out.embedded).toEqual({});
    }
  });

  it("refuses a clip outside the deck directory", () => {
    const { ir, jsonPath } = fixture("../outside.mp4");
    const out = embedVideo(ir, jsonPath);
    expect(out.ir.slides[0].effects?.[0].params?.src).toBe("../outside.mp4");
    expect(out.warnings.join(" ")).toMatch(/outside the deck directory/);
  });

  it("warns rather than throwing on a missing clip", () => {
    const { ir, jsonPath } = fixture("video/gone.mp4");
    const out = embedVideo(ir, jsonPath);
    expect(out.warnings.join(" ")).toMatch(/not found/);
  });
});
