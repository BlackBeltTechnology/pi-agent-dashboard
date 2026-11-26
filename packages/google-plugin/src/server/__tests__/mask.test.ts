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

describe("B157 maskSecrets over the shapes a secret travels in", () => {
  const cases: Array<[string, string]> = [
    ["GOCSPX-abc", "GOCSPX-***"],
    ["first GOCSPX-one_1 then GOCSPX-two-2 end", "first GOCSPX-*** then GOCSPX-*** end"],
    ['{"client_secret":"GOCSPX-abc_DEF-1","n":1}', '{"client_secret":"GOCSPX-***","n":1}'],
    ["Error: failed to store GOCSPX-abc_DEF-1: disk full", "Error: failed to store GOCSPX-***: disk full"],
    ["https://x.example/cb?secret=GOCSPX-abc_DEF-1&state=s", "https://x.example/cb?secret=GOCSPX-***&state=s"],
    ["lower gocspx-abc_DEF-1 case", "lower GOCSPX-*** case"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}, and masking again changes nothing`, () => {
      expect(maskSecrets(input)).toBe(expected);
      expect(maskSecrets(maskSecrets(input))).toBe(expected);
    });
  }
});
