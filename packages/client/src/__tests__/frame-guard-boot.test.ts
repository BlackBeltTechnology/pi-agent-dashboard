/**
 * D6(b) client navigation guard at boot (change: serve-live-previews-on-capability-origin, test-plan #F35).
 * The SPA mounts only in the top window or in a same-origin frame that is NOT a live frame.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n/i18n.js", () => ({
  detectInitialLanguage: () => "en",
  loadCatalog: () => Promise.resolve(),
  t: (_k: string, _v: unknown, fallback?: string) => fallback ?? _k,
}));

import { bootClient } from "../lib/boot/client-boot.js";
import { isDashboardBootBlocked, LIVE_FRAME_ATTR } from "../lib/live-preview/frame-guard.js";
import { __resetTrustedTypesForTests } from "../lib/security/trusted-types.js";

afterEach(() => {
  __resetTrustedTypesForTests();
  vi.unstubAllGlobals();
});

/** A stand-in `Window`: `top` is itself (top window) or another object (framed). */
function fakeWindow(kind: "top" | "live-frame" | "cross-origin-parent" | "plain-frame"): Window {
  const frameElement = (() => {
    if (kind === "cross-origin-parent") return null;
    const el = document.createElement("iframe");
    if (kind === "live-frame") el.setAttribute(LIVE_FRAME_ATTR, "");
    return el;
  })();
  const w: Record<string, unknown> = { frameElement };
  w.top = kind === "top" ? w : {};
  return w as unknown as Window;
}

describe("T.F35 / #F35 — D6(b) navigation guard", () => {
  it.each([
    ["top", false],
    ["live-frame", true],
    ["cross-origin-parent", true],
    ["plain-frame", false],
  ] as const)("%s → blocked=%s", (kind, blocked) => {
    expect(isDashboardBootBlocked(fakeWindow(kind))).toBe(blocked);
  });

  it("a cross-origin `frameElement` access error counts as framed-by-another-origin", () => {
    const w = { top: {} } as Record<string, unknown>;
    Object.defineProperty(w, "frameElement", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(isDashboardBootBlocked(w as unknown as Window)).toBe(true);
  });

  it.each([
    ["top", true],
    ["live-frame", false],
    ["cross-origin-parent", false],
    ["plain-frame", true],
  ] as const)("bootClient in %s window renders=%s and makes no network call when blocked", async (kind, renders) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mount = vi.fn();
    await bootClient(mount, fakeWindow(kind));
    expect(mount).toHaveBeenCalledTimes(renders ? 1 : 0);
    if (!renders) expect(fetchSpy).not.toHaveBeenCalled();
  });

  /** @structural-pin main.tsx renders on import; its boot-time side effects are gated in its text */
  it("main.tsx gates the boot-time API traffic on the same guard", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../main.tsx"), "utf-8");
    expect(main).toMatch(/const bootBlocked = isDashboardBootBlocked\(window\)/);
    expect(main).toMatch(/if \(!bootBlocked\) \{\s*void migrateLegacyDeviceBearer\(\)/);
    expect(main).toMatch(/if \(!bootBlocked\) void bootLoginSession/);
  });
});
