/**
 * Pure unit tests for `contentDispositionAttachment` (test-plan #E1–#E4).
 * See change: add-file-download.
 */
import { describe, expect, it } from "vitest";
import { contentDispositionAttachment } from "../lib/content-disposition.js";

describe("contentDispositionAttachment", () => {
  it("E1: plain name → ASCII fallback + identical filename*", () => {
    expect(contentDispositionAttachment("summary.md")).toBe(
      `attachment; filename="summary.md"; filename*=UTF-8''summary.md`,
    );
  });

  it("E2: non-ASCII name → `_` fallback, UTF-8 percent-encoded filename*", () => {
    expect(contentDispositionAttachment("jelentés é.pdf")).toBe(
      `attachment; filename="jelent_s _.pdf"; filename*=UTF-8''jelent%C3%A9s%20%C3%A9.pdf`,
    );
  });

  it("E3: CR/LF/quote cannot inject a header or break the quoted value", () => {
    const header = contentDispositionAttachment('a"b\r\nX-Evil: 1.txt');
    expect(header).not.toMatch(/[\r\n]/);
    const ascii = /filename="([^]*?)"; filename\*/.exec(header)?.[1] ?? "";
    expect(ascii).toBe("a_b__X-Evil: 1.txt");
    expect(ascii).not.toContain('"');
    expect(header).toContain("filename*=UTF-8''a%22b%0D%0AX-Evil%3A%201.txt");
  });

  it("E4: backslash → `_`; attr-char boundary encoded exactly (' ( ) * encoded, ! ~ literal)", () => {
    const header = contentDispositionAttachment("a\\b'(x)*!~.txt");
    expect(header).toContain(`filename="a_b'(x)*!~.txt"`);
    expect(header).toContain("filename*=UTF-8''a%5Cb%27%28x%29%2A!~.txt");
  });
});
