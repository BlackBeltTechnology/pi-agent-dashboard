/**
 * Per-fire `${{trigger}}` interpolation tests.
 * See change: wire-flow-inputs-in-automation.
 */
import { describe, expect, it } from "vitest";
import { interpolate } from "../server/interpolate.js";

describe("interpolate ${{trigger}}", () => {
  it("resolves a whole-value token to the typed value unchanged", () => {
    expect(interpolate("${{trigger}}", "/spool/inv.pdf")).toBe("/spool/inv.pdf");
    expect(interpolate("${{trigger}}", 5)).toBe(5);
    expect(interpolate("${{trigger}}", true)).toBe(true);
    const obj = { a: 1 };
    expect(interpolate("${{trigger}}", obj)).toBe(obj);
  });

  it("stringifies an embedded token in surrounding text", () => {
    expect(interpolate("Process ${{trigger}} now", "/spool/inv.pdf")).toBe("Process /spool/inv.pdf now");
    expect(interpolate("n=${{trigger}}", 5)).toBe("n=5");
  });

  it("resolves an absent value to empty string", () => {
    expect(interpolate("${{trigger}}", undefined)).toBe("");
    expect(interpolate("x=${{trigger}}", undefined)).toBe("x=");
  });

  it("recurses objects and arrays, leaving non-template values intact", () => {
    const out = interpolate(
      { file: "${{trigger}}", label: "static", nested: { p: "at ${{trigger}}" }, arr: ["${{trigger}}"] },
      "/spool/a.pdf",
    );
    expect(out).toEqual({
      file: "/spool/a.pdf",
      label: "static",
      nested: { p: "at /spool/a.pdf" },
      arr: ["/spool/a.pdf"],
    });
  });

  it("passes through non-string primitives untouched", () => {
    expect(interpolate(42, "/x")).toBe(42);
    expect(interpolate(false, "/x")).toBe(false);
    expect(interpolate(null, "/x")).toBe(null);
  });
});

describe("interpolate named ${name} vars", () => {
  it("resolves a known named token from the variable map", () => {
    expect(interpolate("${invoice_id}", undefined, { invoice_id: "inv-42" })).toBe("inv-42");
    expect(interpolate("id=${invoice_id}", undefined, { invoice_id: "inv-42" })).toBe("id=inv-42");
  });

  it("leaves an unknown named token (or absent map) intact", () => {
    expect(interpolate("${unknown}", undefined, { invoice_id: "inv-1" })).toBe("${unknown}");
    expect(interpolate("${invoice_id}", undefined)).toBe("${invoice_id}");
  });

  it("coexists with ${{trigger}} resolution", () => {
    const out = interpolate(
      { a: "${{trigger}}", b: "${invoice_id}" },
      "/spool/x.pdf",
      { invoice_id: "inv-7" },
    );
    expect(out).toEqual({ a: "/spool/x.pdf", b: "inv-7" });
  });

  it("does not mistake the double-brace trigger token for a named var", () => {
    // No `trigger` var supplied — the double-brace form must still resolve via
    // the trigger value, not be left intact by the single-brace matcher.
    expect(interpolate("${{trigger}}", "val", { other: "x" })).toBe("val");
  });

  it("resolves named tokens inside nested inputs and env", () => {
    const out = interpolate(
      {
        inputs: { invoice_id: "${invoice_id}" },
        env: { IB_INVOICE_ID: "${invoice_id}", IB_TOOLSET: "scoped-invoice" },
      },
      undefined,
      { invoice_id: "inv-9" },
    );
    expect(out).toEqual({
      inputs: { invoice_id: "inv-9" },
      env: { IB_INVOICE_ID: "inv-9", IB_TOOLSET: "scoped-invoice" },
    });
  });
});
