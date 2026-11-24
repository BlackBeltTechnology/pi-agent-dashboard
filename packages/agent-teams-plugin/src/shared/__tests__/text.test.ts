/**
 * Sanitiser primitives (task 2.7 / 2.12, test-plan S3 code-point counting and
 * S98 hostile input). The op-level wiring is exercised in server/__tests__.
 * See change: add-agent-teams-core.
 */
import { describe, expect, it } from "vitest";
import { codePointLength, MAX_FINAL_TEXT_CHARS, sanitizeText, TRUNCATION_MARKER, truncateCodePoints, truncateWithMarker } from "../index.js";

describe("sanitizeText", () => {
  it("strips C0, C1, ANSI and bidi controls silently", () => {
    expect(sanitizeText("a\u0000b\u0007c\u0085d\u009fe", { keepNewlines: false })).toBe("abcde");
    expect(sanitizeText("x\u001b[31mred\u001b[0my", { keepNewlines: false })).toBe("xredy");
    expect(sanitizeText("x\u001b]0;title\u0007y", { keepNewlines: false })).toBe("xy");
    expect(sanitizeText("a\u202eb\u2066c\u200fd", { keepNewlines: false })).toBe("abcd");
  });

  it("keeps \\n and \\t in mail bodies and normalises CR/CRLF to \\n; single-line mode drops them", () => {
    expect(sanitizeText("a\tb\r\nc\rd\ne", { keepNewlines: true })).toBe("a\tb\nc\nd\ne");
    expect(sanitizeText("a\tb\nc", { keepNewlines: false })).toBe("abc");
  });

  it("keeps emoji ZWJ sequences intact", () => {
    const family = "👨\u200d👩\u200d👧";
    expect(sanitizeText(family, { keepNewlines: false })).toBe(family);
  });
});

describe("code-point counting and cutting", () => {
  it("counts code points, not UTF-16 units", () => {
    const s = "😀".repeat(4000);
    expect(s.length).toBe(8000);
    expect(codePointLength(s)).toBe(4000);
  });

  it("cuts on a code-point boundary (never splits a surrogate pair)", () => {
    expect(truncateCodePoints("a😀b😀c", 3)).toBe("a😀b");
    expect(truncateCodePoints("abc", 10)).toBe("abc");
    expect(truncateCodePoints("😀😀", 1)).toBe("😀");
  });
});

describe("truncateWithMarker (result / finalText only)", () => {
  it("leaves text at or under the cap alone and marks a longer one", () => {
    expect(truncateWithMarker("abc", 3, TRUNCATION_MARKER)).toBe("abc");
    expect(truncateWithMarker("abcd", 3, TRUNCATION_MARKER)).toBe(`abc${TRUNCATION_MARKER}`);
    const long = "😀".repeat(MAX_FINAL_TEXT_CHARS + 1);
    const out = truncateWithMarker(long, MAX_FINAL_TEXT_CHARS, TRUNCATION_MARKER);
    expect(codePointLength(out)).toBe(MAX_FINAL_TEXT_CHARS + [...TRUNCATION_MARKER].length);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
  });
});
