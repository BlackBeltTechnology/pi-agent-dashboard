/**
 * web-access catalog — zh-CN ⇄ hu keep identical key sets (test-plan R2).
 * See change: render-unclaimed-custom-entries.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "../i18n.js";

describe("web-access catalog", () => {
  it("R2: zh-CN and hu keep key parity", () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });
  it("every string is non-empty", () => {
    for (const locale of ["zh-CN", "hu"] as const) {
      for (const [k, v] of Object.entries(catalog[locale])) expect(v, `${locale}.${k}`).toBeTruthy();
    }
  });
});
