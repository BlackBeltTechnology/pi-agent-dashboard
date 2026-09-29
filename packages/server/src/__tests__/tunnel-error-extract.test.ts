import { describe, expect, it } from "vitest";
import { extractTunnelError } from "../tunnel/tunnel-core.js";

describe("extractTunnelError — the real CLI error instead of 'Failed to create tunnel'", () => {
  it("compacts a zrok API error to status + code + message", () => {
    expect(
      extractTunnelError('[ERROR]: unable to create share (unable to create share: [POST /share][500] shareInternalServerError "")'),
    ).toBe("POST /share 500 shareInternalServerError");
    expect(
      extractTunnelError(`[ERROR]: unable to create share (unable to create share: [POST /share][409] shareConflict "name 'x' in namespace 'public' is already in use by another share")`),
    ).toBe("POST /share 409 shareConflict: name 'x' in namespace 'public' is already in use by another share");
  });

  it("falls back to the last [ERROR] line, trimmed", () => {
    expect(extractTunnelError("noise\n[ERROR]: environment not enabled\n")).toBe("environment not enabled");
  });

  it("returns null when the output carries no error", () => {
    expect(extractTunnelError("starting...\n")).toBeNull();
  });

  it("caps runaway output", () => {
    expect(extractTunnelError(`[ERROR]: ${"x".repeat(500)}`)!.length).toBeLessThanOrEqual(200);
  });
});
