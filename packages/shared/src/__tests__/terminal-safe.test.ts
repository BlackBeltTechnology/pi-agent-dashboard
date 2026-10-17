import { describe, expect, it } from "vitest";
import { terminalSafe } from "../terminal-safe.js";

/** test-plan #E39, #E40, #E41. See change: fix-pairing-approval-credential. */
describe("terminalSafe", () => {
  it("strips controls, bidi, zero-width and separators", () => {
    expect(terminalSafe("Mozilla\u001b[2J\u009b31m\u202Eevil\u200B\u2028x\uFEFF\u0007", 120)).toBe("Mozilla[2J31mevilx");
  });
  it("caps at 120 code points with the ellipsis inside the cap", () => {
    expect(terminalSafe("a".repeat(119), 120)).toBe("a".repeat(119));
    expect(terminalSafe("a".repeat(120), 120)).toBe("a".repeat(120));
    const over = terminalSafe("a".repeat(121), 120);
    expect(Array.from(over)).toHaveLength(120);
    expect(over).toBe(`${"a".repeat(119)}…`);
  });
  it("never splits a surrogate pair", () => {
    expect(terminalSafe(`${"a".repeat(119)}😀`, 120)).toBe(`${"a".repeat(119)}😀`);
    const cut = terminalSafe(`${"a".repeat(119)}😀x`, 120);
    expect(cut).toBe(`${"a".repeat(119)}…`);
    expect(/[\uD800-\uDFFF]/.test(cut)).toBe(false);
  });
});
