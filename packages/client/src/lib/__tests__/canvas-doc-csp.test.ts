/**
 * Unit coverage for the auto-opened-document CSP transform (change:
 * auto-canvas, Section 8 / S34). Pins that the injected policy blocks external
 * subresources and is placed so an `iframe srcDoc` render enforces it.
 */
import { describe, expect, it } from "vitest";
import { AUTO_OPEN_DOC_CSP, withRestrictiveCsp } from "../canvas/canvas-doc-csp.js";

describe("AUTO_OPEN_DOC_CSP policy", () => {
  it("blocks external network subresources (S34 beacon defense)", () => {
    expect(AUTO_OPEN_DOC_CSP).toContain("default-src 'none'");
    expect(AUTO_OPEN_DOC_CSP).toContain("img-src 'self' data:"); // no external img beacon
    expect(AUTO_OPEN_DOC_CSP).toContain("connect-src 'none'");
    expect(AUTO_OPEN_DOC_CSP).toContain("script-src 'none'");
  });
});

describe("withRestrictiveCsp", () => {
  it("inserts the CSP meta right after <head>", () => {
    const html = "<html><head><title>t</title></head><body>x</body></html>";
    const out = withRestrictiveCsp(html);
    expect(out).toContain("Content-Security-Policy");
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });

  it("prepends the meta when there is no <head>", () => {
    const out = withRestrictiveCsp("<img src=http://attacker/beacon>");
    expect(out.startsWith("<meta")).toBe(true);
    expect(out).toContain(AUTO_OPEN_DOC_CSP);
  });

  it("inserts AFTER a leading <!DOCTYPE> when there is no <head> (no quirks mode)", () => {
    const out = withRestrictiveCsp("<!DOCTYPE html><body>x</body>");
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(out.indexOf("<!DOCTYPE html>"));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<body>"));
  });

  it("is idempotent (already-tagged HTML unchanged)", () => {
    const once = withRestrictiveCsp("<head></head>");
    expect(withRestrictiveCsp(once)).toBe(once);
  });

  it("is NOT bypassed by the policy string embedded in attacker content", () => {
    // The exact policy text sits in a comment (and a permissive CSP meta lurks
    // later) — the position-specific guard must still inject OUR meta first.
    const html = `<head><!-- ${AUTO_OPEN_DOC_CSP} --><meta http-equiv="Content-Security-Policy" content="default-src *"><img src="http://attacker/beacon"></head>`;
    const out = withRestrictiveCsp(html);
    // Our restrictive meta is injected right after <head>, before the attacker's.
    const ourIdx = out.indexOf(CSP_META_MARKER);
    expect(ourIdx).toBeGreaterThan(-1);
    expect(ourIdx).toBeLessThan(out.indexOf("default-src *"));
    expect(out.indexOf(CSP_META_MARKER)).toBe(out.indexOf("<head>") + "<head>".length);
  });
});

// The exact injected meta tag (marker for the regression test above).
const CSP_META_MARKER = `<meta http-equiv="Content-Security-Policy" content="${AUTO_OPEN_DOC_CSP}">`;
