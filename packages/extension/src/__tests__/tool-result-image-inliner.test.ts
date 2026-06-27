/**
 * Tests for the bridge's tool-result image inliner (Fix B).
 * See change: inline-agent-screenshot-artifacts.
 */
import { describe, it, expect } from "vitest";
import { inlineToolResultImages, type ImageContentBlock } from "../tool-result-image-inliner.js";
import { hashBytes, type ReadFileOutcome } from "../markdown-image-inliner.js";

const PNG = Buffer.from("png-bytes");
const PNG_2 = Buffer.from("other-png-bytes");

/** In-memory readFile: missing keys → ENOENT. */
function fakeReader(files: Record<string, Buffer>) {
  return (absolutePath: string): ReadFileOutcome => {
    const v = files[absolutePath];
    if (v === undefined) return { ok: false, kind: "ENOENT" };
    return { ok: true, bytes: v };
  };
}

function imageBlocks(result: unknown): ImageContentBlock[] {
  const content = (result as any)?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((c: any) => c?.type === "image");
}

function textOf(result: unknown): string {
  const content = (result as any)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

describe("inlineToolResultImages", () => {
  it("single screenshot path → one image block, path stripped (no link)", () => {
    const out = inlineToolResultImages("Screenshot saved: /tmp/shots/a.png", {
      readFile: fakeReader({ "/tmp/shots/a.png": PNG }),
    });
    expect(out.inlinedCount).toBe(1);
    const blocks = imageBlocks(out.result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "image",
      data: PNG.toString("base64"),
      mimeType: "image/png",
    });
    // The consumed path no longer appears in the text → not linkified.
    expect(textOf(out.result)).not.toContain("/tmp/shots/a.png");
    expect(textOf(out.result)).toContain("Screenshot saved:");
  });

  it("two paths, one over per-image cap → one inlined, one left as link", () => {
    const big = Buffer.alloc(100);
    const out = inlineToolResultImages(
      "small /tmp/small.png and big /tmp/big.png",
      {
        readFile: fakeReader({ "/tmp/small.png": PNG, "/tmp/big.png": big }),
        maxPerImageBytes: 50,
      },
    );
    expect(out.inlinedCount).toBe(1);
    expect(imageBlocks(out.result)).toHaveLength(1);
    // small path stripped, big path remains as text → falls back to Fix A.
    const text = textOf(out.result);
    expect(text).not.toContain("/tmp/small.png");
    expect(text).toContain("/tmp/big.png");
  });

  it("isAllowedPath gate: out-of-root path left as text, in-root path inlined", () => {
    const reader = fakeReader({ "/allowed/shot.png": PNG, "/etc/secret.png": PNG_2 });
    // Out-of-root → not inlined, result unchanged.
    const blocked = inlineToolResultImages("leaked /etc/secret.png", {
      readFile: reader,
      isAllowedPath: (p) => p.startsWith("/allowed/"),
    });
    expect(blocked.inlinedCount).toBe(0);
    expect(blocked.result).toBe("leaked /etc/secret.png");

    // In-root → inlined.
    const allowed = inlineToolResultImages("saved /allowed/shot.png", {
      readFile: reader,
      isAllowedPath: (p) => p.startsWith("/allowed/"),
    });
    expect(allowed.inlinedCount).toBe(1);
    expect(imageBlocks(allowed.result)).toHaveLength(1);
  });

  it("non-image path → untouched (result unchanged, no image block)", () => {
    const original = "Wrote /tmp/notes.txt";
    const out = inlineToolResultImages(original, {
      readFile: fakeReader({ "/tmp/notes.txt": Buffer.from("hi") }),
    });
    expect(out.inlinedCount).toBe(0);
    expect(out.result).toBe(original);
  });

  it("non-existent image path → untouched", () => {
    const original = "Screenshot saved: /tmp/missing.png";
    const out = inlineToolResultImages(original, { readFile: fakeReader({}) });
    expect(out.inlinedCount).toBe(0);
    expect(out.result).toBe(original);
  });

  it("caps the number of images inlined per result", () => {
    const files: Record<string, Buffer> = {};
    let text = "";
    for (let i = 0; i < 6; i++) {
      const p = `/tmp/s${i}.png`;
      files[p] = Buffer.from(`png-${i}`);
      text += ` ${p}`;
    }
    const out = inlineToolResultImages(text, {
      readFile: fakeReader(files),
      maxImagesPerResult: 4,
    });
    expect(out.inlinedCount).toBe(4);
    expect(imageBlocks(out.result)).toHaveLength(4);
  });

  it("respects the per-result cumulative byte budget", () => {
    const out = inlineToolResultImages("/tmp/a.png /tmp/b.png", {
      readFile: fakeReader({ "/tmp/a.png": PNG, "/tmp/b.png": PNG_2 }),
      // Budget room for one image only.
      maxPerMessageBytes: PNG.length + 1,
    });
    expect(out.inlinedCount).toBe(1);
  });

  it("extracts image paths from a content-array result", () => {
    const out = inlineToolResultImages(
      { content: [{ type: "text", text: "saved /tmp/c.png ok" }] },
      { readFile: fakeReader({ "/tmp/c.png": PNG }) },
    );
    expect(out.inlinedCount).toBe(1);
    expect(imageBlocks(out.result)[0].mimeType).toBe("image/png");
  });

  it("preserves pre-existing non-text content blocks when inlining", () => {
    const existingImg = { type: "image", data: "cHJlZXhpc3Rpbmc=", mimeType: "image/jpeg" };
    const out = inlineToolResultImages(
      {
        content: [
          { type: "text", text: "saw /tmp/e.png here" },
          existingImg,
          { type: "resource", uri: "file:///x" },
        ],
      },
      { readFile: fakeReader({ "/tmp/e.png": PNG }) },
    );
    expect(out.inlinedCount).toBe(1);
    const content = (out.result as any).content;
    // Pre-existing image + resource blocks survive; new image appended.
    expect(content).toContainEqual(existingImg);
    expect(content).toContainEqual({ type: "resource", uri: "file:///x" });
    expect(content.filter((c: any) => c.type === "image")).toHaveLength(2);
    // Consumed path stripped from the original text block.
    const textBlock = content.find((c: any) => c.type === "text");
    expect(textBlock.text).not.toContain("/tmp/e.png");
  });

  it("dedups a repeated path into a single image block", () => {
    const out = inlineToolResultImages("/tmp/d.png twice /tmp/d.png", {
      readFile: fakeReader({ "/tmp/d.png": PNG }),
    });
    expect(out.inlinedCount).toBe(1);
    expect(imageBlocks(out.result)).toHaveLength(1);
    expect(hashBytes(PNG)).toBeTruthy(); // sanity: helper imported
  });
});
