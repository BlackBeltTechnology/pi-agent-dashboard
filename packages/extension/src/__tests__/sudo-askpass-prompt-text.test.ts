/**
 * sudo's prompt text is agent-controlled (`sudo -p`). The bridge escapes it once
 * (control/bidi/zero-width chars become visible escapes, nothing is dropped) and
 * middle-truncates it to 500 displayed characters. See change:
 * add-sudo-credential-prompt (D4, G1, G11; test-plan #S15, #S16).
 */
import { describe, expect, it } from "vitest";
import { buildPromptDisplay, escapePromptText } from "../sudo-askpass/prompt-text.js";

describe("prompt text cap (#S15)", () => {
  it.each([499, 500])("keeps a %i-char text whole, no marker", (n) => {
    const text = "x".repeat(n);
    const out = buildPromptDisplay(text);
    expect(out.prompt).toBe(text);
    expect(out.promptTruncated).toBeUndefined();
  });

  it.each([
    [501, 1],
    [5000, 4500],
  ])("middle-truncates a %i-char text: first 250 + marker + last 250, N=%i", (n, removed) => {
    const text = `${"H".repeat(250)}${"#".repeat(n - 500)}${"T".repeat(250)}`;
    const out = buildPromptDisplay(text);
    expect(out.promptTruncated).toBe(removed);
    expect(out.prompt.startsWith("H".repeat(250))).toBe(true);
    expect(out.prompt.endsWith("T".repeat(250))).toBe(true);
    expect(out.prompt).toContain(`${removed} more chars`);
    expect(out.prompt).not.toContain("#");
  });

  it("measures the cap on the ESCAPED text, not the raw argv", () => {
    // 250 ESC bytes escape to 4 chars each = 1000 displayed chars.
    const out = buildPromptDisplay("\x1b".repeat(250));
    expect(out.promptTruncated).toBe(500);
  });

  it("does not split an astral character at the cut", () => {
    const out = buildPromptDisplay("😀".repeat(600));
    expect(out.promptTruncated).toBe(100);
    expect(out.prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("prompt text shown as visible escapes (#S16)", () => {
  it("escapes ANSI, CR, BEL, NUL, bidi override, zero-width and newline; keeps <script> inert", () => {
    const raw = "a\x1b[2Jb\rc\x07d\x00e\u202Ef\u200Bg\nh<script>alert(1)</script>";
    const out = escapePromptText(raw);
    expect(out).toBe("a\\x1b[2Jb\\rc\\x07d\\x00e\\u202Ef\\u200Bg\\nh<script>alert(1)</script>");
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\x00-\x1f\x7f-\x9f\u200B-\u200F\u202A-\u202E\u2066-\u2069]/);
  });

  it("drops nothing: ordinary text and unicode letters pass through", () => {
    expect(escapePromptText("[sudo] password for pässwörd✓😀:")).toBe("[sudo] password for pässwörd✓😀:");
  });
});
