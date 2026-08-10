/**
 * test-plan #E9 — `isExternalHref` semantics are preserved by the D4a
 * extraction out of `MarkdownContent.tsx` into the `is-external-href.ts` leaf.
 *
 * The predicate is a trust-adjacent UX decision (it drives
 * `target="_blank" rel="noopener noreferrer"`), so the extraction must be
 * behaviour-identical rather than merely compiling.
 *
 * See change: cleanup-import-cycles (D4a).
 */
import { describe, it, expect } from "vitest";
import { isExternalHref } from "../is-external-href.js";

describe("isExternalHref — extracted leaf module", () => {
  it("treats a cross-origin absolute URL as external", () => {
    expect(isExternalHref("https://example.com/x")).toBe(true);
  });

  it("treats a same-origin absolute URL as internal", () => {
    expect(isExternalHref(`${window.location.origin}/settings`)).toBe(false);
  });

  it("treats a fragment-only ref as internal", () => {
    expect(isExternalHref("#anchor")).toBe(false);
  });

  it("treats a relative path as internal", () => {
    expect(isExternalHref("./docs/readme.md")).toBe(false);
  });

  it("leaves a bare anchor without href alone", () => {
    expect(isExternalHref(undefined)).toBe(false);
    expect(isExternalHref("")).toBe(false);
  });

  it("fails safe: an unparseable href is treated as external", () => {
    expect(isExternalHref("http://[::1")).toBe(true);
  });
});
