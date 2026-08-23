import { describe, expect, it } from "vitest";
import {
  imageBlockData,
  imageBlockMime,
  isImageTypeBlock,
  isInlineImageBlock,
  isRenderableImageBlock,
  isTruncatedImageBlock,
} from "../image-block.js";

const flat = { type: "image", data: "AAAA", mimeType: "image/png" };
const nested = { type: "image", source: { type: "base64", media_type: "image/png", data: "BBBB" } };
const placeholder = { type: "image", data: "", attachmentId: "abc", attachmentState: "pending", mimeType: "image/png" };
const blankNoMime = { type: "image", data: "" };
const rescued = { type: "image", data: "", mimeType: "image/png", imageTruncated: true };
const rescuedNested = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "" },
  imageTruncated: true,
};
const text = { type: "text", text: "hi" };

describe("image-block shared detector", () => {
  it("recognizes image-typed blocks", () => {
    expect(isImageTypeBlock(flat)).toBe(true);
    expect(isImageTypeBlock(nested)).toBe(true);
    expect(isImageTypeBlock(text)).toBe(false);
    expect(isImageTypeBlock(null)).toBe(false);
    expect(isImageTypeBlock([flat])).toBe(false);
  });

  it("extracts inline bytes across both shapes", () => {
    expect(imageBlockData(flat)).toBe("AAAA");
    expect(imageBlockData(nested)).toBe("BBBB");
    expect(imageBlockData(placeholder)).toBeUndefined(); // blanked
    expect(imageBlockData(text)).toBeUndefined();
  });

  it("extracts mime across both shapes", () => {
    expect(imageBlockMime(flat)).toBe("image/png");
    expect(imageBlockMime(nested)).toBe("image/png");
    expect(imageBlockMime(blankNoMime)).toBeUndefined();
  });

  it("isInlineImageBlock is true only when inline bytes are present", () => {
    expect(isInlineImageBlock(flat)).toBe(true);
    expect(isInlineImageBlock(nested)).toBe(true);
    expect(isInlineImageBlock(placeholder)).toBe(false); // no bytes to strip
    expect(isInlineImageBlock(blankNoMime)).toBe(false);
    expect(isInlineImageBlock(text)).toBe(false);
  });

  it("isRenderableImageBlock accepts bytes OR attachmentId, but requires a mime", () => {
    expect(isRenderableImageBlock(flat)).toBe(true);
    expect(isRenderableImageBlock(nested)).toBe(true);
    expect(isRenderableImageBlock(placeholder)).toBe(true); // attachmentId + mime
    expect(isRenderableImageBlock(blankNoMime)).toBe(false); // no bytes, no id, no mime
    expect(isRenderableImageBlock({ type: "image", attachmentId: "x" })).toBe(false); // id but no mime
    expect(isRenderableImageBlock(text)).toBe(false);
  });

  it("recognizes rescued (imageTruncated) blocks in both shapes", () => {
    expect(isTruncatedImageBlock(rescued)).toBe(true);
    expect(isTruncatedImageBlock(rescuedNested)).toBe(true);
    expect(isTruncatedImageBlock(flat)).toBe(false);
    expect(isTruncatedImageBlock(placeholder)).toBe(false);
    expect(isTruncatedImageBlock(text)).toBe(false);
    expect(isTruncatedImageBlock(null)).toBe(false);
    // Only the literal `true` marks a rescue — not any truthy value.
    expect(isTruncatedImageBlock({ type: "image", imageTruncated: "yes" })).toBe(false);
  });

  it("a rescued block is renderable (as an unavailable slot) but not inline", () => {
    // Nothing left to strip — the server rescue already removed the bytes.
    expect(isInlineImageBlock(rescued)).toBe(false);
    expect(isInlineImageBlock(rescuedNested)).toBe(false);
    // But it MUST still reach the client, or the attachment vanishes silently.
    expect(isRenderableImageBlock(rescued)).toBe(true);
    expect(isRenderableImageBlock(rescuedNested)).toBe(true);
    // The marker does not excuse a missing mime.
    expect(isRenderableImageBlock({ type: "image", data: "", imageTruncated: true })).toBe(false);
  });

  it("isRenderableImageBlock rejects empty attachmentId and empty mime", () => {
    // Empty attachmentId is not a usable source.
    expect(
      isRenderableImageBlock({ type: "image", data: "", attachmentId: "", mimeType: "image/png" }),
    ).toBe(false);
    // Empty mime is not usable even with real bytes.
    expect(isRenderableImageBlock({ type: "image", data: "AAAA", mimeType: "" })).toBe(false);
    // Empty mime is not usable even with a valid attachmentId.
    expect(
      isRenderableImageBlock({ type: "image", data: "", attachmentId: "abc", mimeType: "" }),
    ).toBe(false);
  });
});
