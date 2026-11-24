/**
 * #E14 — `maskSecrets` replaces every `GOCSPX-…` secret, leaves other text alone.
 * See change: add-gmail-auto-setup.
 */
import { describe, expect, it } from "vitest";
import { maskSecrets } from "../setup/mask.js";

describe("E14 maskSecrets", () => {
  it("masks one secret and keeps the surrounding text", () => {
    expect(maskSecrets("secret=GOCSPX-abc_DEF-123 end")).toBe("secret=GOCSPX-*** end");
  });

  it("masks every secret in a text", () => {
    expect(maskSecrets("a GOCSPX-one_1 b GOCSPX-two-2")).toBe("a GOCSPX-*** b GOCSPX-***");
  });

  it("leaves text without a secret untouched, including a bare prefix", () => {
    expect(maskSecrets("nothing here")).toBe("nothing here");
    expect(maskSecrets("GOCSPX is a prefix")).toBe("GOCSPX is a prefix");
  });

  it("is idempotent on an already masked value", () => {
    expect(maskSecrets("GOCSPX-***")).toBe("GOCSPX-***");
  });
});
