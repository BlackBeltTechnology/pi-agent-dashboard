/**
 * Content assembly + image validation for user messages — the half of
 * `sendUserMessageWithImages` the bridge drain reuses WITHOUT its send options.
 *
 * Exercises the REAL exports (`buildUserMessageContent`, `validateImages`), so
 * these cases fail if the drain payload or the allow-list regresses.
 *
 * Covers test-plan rows E3 (content array), E4 (bare string), X8, X9, X10, X11.
 *
 * See change: fix-bridge-followup-image-drop (design D6, D7, D3c).
 */
import { describe, expect, it } from "vitest";
import { buildUserMessageContent, validateImages } from "../command-handler.js";

const png = { type: "image" as const, data: "PNGBYTES", mimeType: "image/png" };
const jpeg = { type: "image" as const, data: "JPEGBYTES", mimeType: "image/jpeg" };
const nestedPng = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "NESTEDBYTES" },
};

describe("buildUserMessageContent", () => {
  it("assembles a text+image content array for an image-bearing entry (E3)", () => {
    expect(buildUserMessageContent("describe", [png])).toEqual([
      { type: "text", text: "describe" },
      { type: "image", data: "PNGBYTES", mimeType: "image/png" },
    ]);
  });

  it("keeps every valid attachment, in order", () => {
    const content = buildUserMessageContent("describe", [png, jpeg]);
    expect(Array.isArray(content) && content).toHaveLength(3);
    expect(Array.isArray(content) && content[2]).toEqual({
      type: "image",
      data: "JPEGBYTES",
      mimeType: "image/jpeg",
    });
  });

  it("returns a BARE STRING for a text-only entry — not a one-element array (E4)", () => {
    expect(buildUserMessageContent("plain")).toBe("plain");
    expect(buildUserMessageContent("plain", [])).toBe("plain");
  });

  it("falls back to a bare string when every attachment is invalid (X9)", () => {
    expect(buildUserMessageContent("plain", [{ type: "image", data: "d", mimeType: "image/svg+xml" }]))
      .toBe("plain");
  });

  it("normalises a NESTED Anthropic block into the flat shape pi consumes (X11)", () => {
    expect(buildUserMessageContent("describe", [nestedPng])).toEqual([
      { type: "text", text: "describe" },
      { type: "image", data: "NESTEDBYTES", mimeType: "image/png" },
    ]);
  });
});

describe("validateImages", () => {
  it("drops a non-object, a data-less block and an unsupported mime, reporting each (X8)", () => {
    const { valid, dropped } = validateImages([
      "not-an-object",
      { type: "image", mimeType: "image/png" },
      { type: "image", data: "d", mimeType: "image/svg+xml" },
      png,
    ]);

    expect(valid).toEqual([png]);
    expect(dropped).toHaveLength(3);
    expect(dropped.join(" ")).toMatch(/image\/svg\+xml/);
  });

  it("reports every drop when the whole set is invalid (X9)", () => {
    const { valid, dropped } = validateImages([
      { type: "image", data: "d", mimeType: "image/svg+xml" },
      null,
    ]);

    expect(valid).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  it("reports NOTHING when every attachment is valid (X10)", () => {
    const { valid, dropped } = validateImages([png, jpeg]);

    expect(valid).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it("does NOT drop a nested-shape block as invalid-mime (X11)", () => {
    const { valid, dropped } = validateImages([nestedPng]);

    expect(valid).toEqual([{ type: "image", data: "NESTEDBYTES", mimeType: "image/png" }]);
    expect(dropped).toEqual([]);
  });

  it("keeps the allow-list unwidened", () => {
    const { valid } = validateImages([
      { type: "image", data: "d", mimeType: "image/gif" },
      { type: "image", data: "d", mimeType: "image/webp" },
      { type: "image", data: "d", mimeType: "image/bmp" },
      { type: "image", data: "d", mimeType: "application/pdf" },
    ]);

    expect(valid.map((i) => i.mimeType)).toEqual(["image/gif", "image/webp"]);
  });

  it("treats an absent images array as an empty, complaint-free set", () => {
    expect(validateImages()).toEqual({ valid: [], dropped: [] });
  });
});
