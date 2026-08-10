/**
 * Cross-helper parity: `packages/shared/src/pi-package-resolver.ts`
 * duplicates source-kind parsing + install-path computation from
 * `packages/server/src/pi-resource-scanner.ts` (the older server-only
 * helper). If a future maintainer updates one without the other,
 * package resolution diverges silently between the dashboard plugin
 * bridges (shared) and the server-side resources scanner.
 *
 * This test is a structural pin: it asserts the scanner source still
 * contains the same source-kind prefixes the shared resolver handles
 * AND the same install-path layout strings (`.pi/git`, `.pi/agent/git`,
 * `node_modules`). The cross-package file is read via fs only — no
 * import statement so the shared package's tsconfig rootDir is
 * respected.
 *
 * If this fails, sync the two helpers by hand (the resolver here in
 * shared, the scanner in server). A follow-up cleanup that has the
 * scanner consume the shared helper would retire this test.
 *
 * See change: add-shared-pi-package-resolver (Decision D3).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const scannerPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "server",
  "src",
  "pi",
  "pi-resource-scanner.ts",
);
const resolverPath = path.resolve(__dirname, "..", "pi-package-resolver.ts");

describe("pi-package-resolver / pi-resource-scanner parity (structural)", () => {
  it("scanner source recognizes all source-kind prefixes the resolver handles", () => {
    const scannerSrc = fs.readFileSync(scannerPath, "utf-8");
    // The shared resolver parses these prefixes; the scanner must too.
    for (const prefix of ['"npm:"', '"git:"', '"https://"', '"http://"', '"ssh://"']) {
      expect(scannerSrc.includes(`.startsWith(${prefix})`)).toBe(true);
    }
  });

  it("both helpers reference identical install-path layout markers", () => {
    const scannerSrc = fs.readFileSync(scannerPath, "utf-8");
    const resolverSrc = fs.readFileSync(resolverPath, "utf-8");
    // Both helpers must layer git installs under a "git" subdir of either
    // the agentDir (user scope) or `<cwd>/.pi/` (project scope). If one
    // ever switches to e.g. `"repos"` while the other stays on `"git"`,
    // resolutions diverge silently. Marker assertion accepts both spellings.
    for (const [label, src] of [["scanner", scannerSrc], ["resolver", resolverSrc]] as const) {
      const hasGitMarker =
        src.includes('"agent", "git"') ||
        src.includes('".pi", "agent", "git"') ||
        src.includes('"git"');
      expect(hasGitMarker, `${label} must reference a "git" subdir marker`).toBe(true);
    }
    // project-scope <cwd>/.pi/<arm> marker is identical in both.
    for (const [label, src] of [["scanner", scannerSrc], ["resolver", resolverSrc]] as const) {
      expect(src.includes('".pi"'), `${label} must reference the ".pi" config dir`).toBe(true);
    }
  });

  it("resolver and scanner both consume npm.rootGlobalOr for npm: arm", () => {
    const scannerSrc = fs.readFileSync(scannerPath, "utf-8");
    const resolverSrc = fs.readFileSync(resolverPath, "utf-8");
    // Both must obtain the npm global root the same way; if one stops
    // using this helper the other will go stale.
    expect(scannerSrc.includes("rootGlobalOr")).toBe(true);
    expect(resolverSrc.includes("rootGlobalOr")).toBe(true);
  });
});
