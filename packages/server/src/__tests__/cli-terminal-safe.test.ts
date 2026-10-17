/**
 * `terminalSafe` and the `pi-dashboard pair list` row renderer (test-plan #E39–#E42).
 * See change: fix-pairing-approval-credential (D8, task 3.3).
 */
import { terminalSafe } from "@blackbelt-technology/pi-dashboard-shared/terminal-safe.js";
import { describe, expect, it } from "vitest";
import { formatPendingRow } from "../cli.js";

const base = { pendingId: "p-1", provenance: "knock", createdAt: 0, expiresAt: 1, attemptsLeft: 5 };
const field = (lines: string[], key: string): string | undefined =>
  lines.find((l) => l.startsWith(`  ${key}: `))?.slice(`  ${key}: `.length);

describe("terminalSafe (#E39 #E40 #E41)", () => {
  it("E39: strips C0/C1 controls, bidi overrides, zero-width, separators and BOM", () => {
    expect(terminalSafe("Mozilla\u001b[2J\u009b31m\u202Eevil\u200B\u2028x\uFEFF\u0007", 120)).toBe("Mozilla[2J31mevilx");
  });

  it("E40: 119 and 120 ASCII chars are unchanged; 121 becomes 119 chars + the ellipsis", () => {
    expect(terminalSafe("a".repeat(119), 120)).toBe("a".repeat(119));
    expect(terminalSafe("a".repeat(120), 120)).toBe("a".repeat(120));
    const cut = terminalSafe("a".repeat(121), 120);
    expect(cut).toBe(`${"a".repeat(119)}…`);
    expect(Array.from(cut)).toHaveLength(120);
  });

  it("E41: a surrogate pair is kept whole at the cap and dropped whole beyond it", () => {
    const kept = terminalSafe(`${"a".repeat(119)}😀`, 120);
    expect(kept).toBe(`${"a".repeat(119)}😀`);
    const dropped = terminalSafe(`${"a".repeat(119)}😀x`, 120);
    expect(dropped).toBe(`${"a".repeat(119)}…`);
    for (const s of [kept, dropped]) expect(s).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("pair list row renderer (#E42)", () => {
  it("caps requesterName / viaHost / remoteAddress at 64 code points ending in the ellipsis", () => {
    const lines = formatPendingRow({
      ...base,
      requesterName: "n".repeat(65),
      viaHost: "h".repeat(65),
      remoteAddress: "r".repeat(65),
    });
    for (const k of ["name", "via", "address"]) {
      const v = field(lines, k)!;
      expect(Array.from(v)).toHaveLength(64);
      expect(v.endsWith("…")).toBe(true);
    }
  });

  it("caps userAgent at 120 and strips escape sequences from it", () => {
    const lines = formatPendingRow({ ...base, userAgent: `Mozilla\u001b[2J\u202Eevil${"a".repeat(200)}` });
    const ua = field(lines, "user-agent")!;
    expect(Array.from(ua)).toHaveLength(120);
    expect(ua).not.toMatch(/[\u001b\u202E]/);
    expect(ua.startsWith("Mozilla[2Jevil")).toBe(true);
  });

  it("prints a 36-char pendingId in full on the header line", () => {
    const pendingId = "123e4567-e89b-12d3-a456-426614174000";
    expect(formatPendingRow({ ...base, pendingId })[0]).toBe(pendingId);
  });

  it("never emits a control character, whatever the payload carries", () => {
    const lines = formatPendingRow({
      ...base,
      requesterName: "a\u001b]0;pwned\u0007b",
      userAgent: "\u009b2Jx",
      viaHost: "v\u2028h",
      remoteAddress: "\u202E1.2.3.4",
    });
    expect(lines.join("\n")).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2028\u2029]/);
  });
});
