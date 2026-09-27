/**
 * Regression: under the server's `node --import jiti-register` loader, a
 * dynamic `import("isomorphic-dompurify")` routes jsdom's CJS through jiti and
 * breaks its interfaces.js <-> create-element.js cycle
 * (`interfaces.getInterfaceWrapper is not a function`). `loadPurify()` must
 * sanitize correctly under that same loader.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..");
const jitiRegister = pathToFileURL(path.join(repoRoot, "node_modules", "jiti", "lib", "jiti-register.mjs")).href;
const fixture = path.join(here, "fixtures", "purify-under-jiti.ts");

describe("loadPurify under jiti-register", () => {
  it("sanitizes SVG (jsdom usable) when loaded via the server loader", () => {
    const res = spawnSync(process.execPath, ["--no-warnings", "--import", jitiRegister, fixture], {
      encoding: "utf8",
      env: { ...process.env, JITI_TSCONFIG_PATHS: "true" },
      timeout: 60_000,
    });
    expect(res.stdout.trim()).toBe("<svg><g></g></svg>");
  }, 90_000);
});
