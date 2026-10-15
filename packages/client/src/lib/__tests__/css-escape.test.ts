/**
 * cssEscape: jsdom fallback correctness in quoted attribute selectors, and
 * native delegation. See change: fix-codeql-small-findings (test-plan #F1 #F2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssEscape } from "../css-escape.js";

const IDS = ['a"b', "a\\b", "a]b", "a\nb", "a b", "\u{1F600}x", "1abc"];

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("cssEscape", () => {
  it("F1: fallback (no CSS.escape) matches each id in an attribute selector", () => {
    const original = (window as { CSS?: unknown }).CSS;
    Object.defineProperty(window, "CSS", { configurable: true, value: {} });
    try {
      for (const id of IDS) {
        const el = document.createElement("div");
        el.setAttribute("data-session-id", id);
        document.body.appendChild(el);
      }
      for (const id of IDS) {
        const hits = document.querySelectorAll(`[data-session-id="${cssEscape(id)}"]`);
        expect(hits.length, JSON.stringify(id)).toBe(1);
        expect(hits[0].getAttribute("data-session-id")).toBe(id);
      }
    } finally {
      Object.defineProperty(window, "CSS", { configurable: true, value: original });
    }
  });

  it("F2: delegates to native CSS.escape when present", () => {
    const spy = vi.fn().mockReturnValue("S");
    const original = (window as { CSS?: unknown }).CSS;
    Object.defineProperty(window, "CSS", { configurable: true, value: { escape: spy } });
    try {
      expect(cssEscape("x")).toBe("S");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("x");
    } finally {
      Object.defineProperty(window, "CSS", { configurable: true, value: original });
    }
  });
});
