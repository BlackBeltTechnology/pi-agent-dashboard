/**
 * The shim's `ws` server is BUNDLED into main.js by Vite. Vite replaces ws's
 * optional peer deps (`bufferutil`, `utf-8-validate`) with an empty stub object,
 * and ws then calls `bufferUtil.unmask(...)` on it → "unmask is not a function"
 * on the first masked frame from the extension. `vite.main.config.ts` must
 * statically switch the optional addons off so ws uses its pure-JS fallbacks.
 * See change: add-operator-browser-relay (found in the live check).
 */
import { describe, expect, it } from "vitest";
import mainConfig from "../../../../vite.main.config.js";

describe("vite.main.config — bundled ws optional addons", () => {
  it("defines WS_NO_BUFFER_UTIL and WS_NO_UTF_8_VALIDATE so the empty peer-dep stubs are never called", () => {
    const define = (mainConfig as { define?: Record<string, string> }).define ?? {};
    expect(define["process.env.WS_NO_BUFFER_UTIL"]).toBe('"1"');
    expect(define["process.env.WS_NO_UTF_8_VALIDATE"]).toBe('"1"');
  });
});
