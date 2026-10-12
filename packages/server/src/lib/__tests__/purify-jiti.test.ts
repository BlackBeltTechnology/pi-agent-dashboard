/**
 * Regression: `loadPurify()` must sanitize correctly under the server's real
 * loader — `node --import native-ts-register.mjs`. Unlike the old async
 * `module.register` hooks, `module.registerHooks` also sees CommonJS
 * `require()`, so this pins that jsdom's interfaces.js <-> create-element.js
 * require cycle (`createRequire` of `isomorphic-dompurify`) still works.
 * The file keeps its historical name; the loader is native now.
 *
 * See change: strip-only-native-ts-loader (test-plan #E7).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNativeTsLoader } from "@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeRegister = resolveNativeTsLoader();
const fixture = path.join(here, "fixtures", "purify-under-jiti.ts");

describe("loadPurify under the native TypeScript loader", () => {
  it("sanitizes SVG (jsdom usable) when loaded via the server loader", () => {
    const res = spawnSync(process.execPath, ["--no-warnings", "--import", nativeRegister, fixture], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(res.stdout.trim()).toBe("<svg><g></g></svg>");
  }, 90_000);
});
