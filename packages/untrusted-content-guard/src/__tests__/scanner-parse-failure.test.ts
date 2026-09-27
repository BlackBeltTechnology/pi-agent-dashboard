/**
 * L1 test-plan #X3 — the HTML parser throws. The scan must fall back to the
 * Unicode/ANSI layers, report a high `html_parse_failed`, and the guard must
 * still spotlight the result.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("htmlparser2", () => ({
  Parser: class {
    constructor() {
      throw new Error("boom");
    }
  },
}));

const { scan } = await import("../scanner/scan.js");
const { UntrustedContentGuard } = await import("../guard.js");
const { resolveSettings } = await import("../settings.js");

describe("#X3 parser throws", () => {
  const doc = '<html><div style="display:none">x</div>pay\u200Bpal</html>';

  it("falls back to plain-text layers with a high html_parse_failed finding", () => {
    const r = scan(doc, { mode: "strip" });
    expect(r.html).toBe(false);
    expect(r.findings.map((f) => [f.layer, f.severity])).toEqual([
      ["html_parse_failed", "high"],
      ["unicode-zero-width", "high"],
    ]);
    expect(r.cleaned).toBe('<html><div style="display:none">x</div>paypal</html>');
  });

  it("still spotlights the result", () => {
    const guard = new UntrustedContentGuard({
      settings: () => resolveSettings(),
      registry: { declarations: [] },
      marker: () => "M1",
    });
    const out = guard.onToolResult({ toolName: "fetch_content", content: [{ type: "text", text: doc }] });
    const text = out?.content[0]?.type === "text" ? out.content[0].text : "";
    expect(text.startsWith('<<untrusted source="fetch_content" id="M1">>')).toBe(true);
    expect(text).toContain('<</untrusted id="M1">>');
    expect(text).toContain("HTML parse failed");
  });
});
