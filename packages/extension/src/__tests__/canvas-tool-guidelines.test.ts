/**
 * E31 — the `canvas` tool guidance steers local servers to loopback URLs and
 * local HTML to `kind:'file'`. See change: improve-canvas-html-and-url-ux.
 */
import { describe, expect, it } from "vitest";
import { registerCanvasTool } from "../canvas-tool.js";

describe("canvas tool guidelines (E31)", () => {
  it("tells the model to use localhost URLs, never LAN, and kind:'file' for HTML", () => {
    let registered: { name: string; promptGuidelines: string[] } | undefined;
    registerCanvasTool({
      registerTool(t: { name: string; promptGuidelines: string[] }) {
        registered = t;
      },
    } as never);
    expect(registered?.name).toBe("canvas");
    const text = registered?.promptGuidelines.join("\n") ?? "";
    expect(text).toContain("localhost URL");
    expect(text).toContain("never a LAN");
    expect(text).toContain("kind:'file'");
  });
});
