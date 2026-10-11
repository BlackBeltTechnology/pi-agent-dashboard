/**
 * Repo-lint: `packages/shared/src/pi-package-resolver.ts` MUST only
 * import from Node built-ins, relative paths inside `packages/shared/`,
 * or the package's own self-reference (`@blackbelt-technology/pi-dashboard-shared`).
 *
 * Plugin bridges consume this resolver and can only depend on the
 * shared package; any leak to `packages/server/`, `packages/client/`,
 * `packages/electron/`, or another workspace package would silently
 * break every non-server consumer.
 *
 * See change: add-shared-pi-package-resolver.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const resolverPath = path.resolve(__dirname, "..", "pi-package-resolver.ts");

const IMPORT_RE = /^\s*import[^"']+["']([^"']+)["']/gm;

function isAllowed(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  if (spec.startsWith("./") || spec.startsWith("../")) return true;
  if (spec === "@blackbelt-technology/pi-dashboard-shared") return true;
  if (spec.startsWith("@blackbelt-technology/pi-dashboard-shared/")) return true;
  return false;
}

/**
 * @structural-pin import-graph lint: pi-package-resolver.ts may import only node built-ins and shared-relative paths so the wizard bootstrap can load it
 */
describe("pi-package-resolver — shared-only imports", () => {
  it("only imports Node built-ins or shared-local paths", () => {
    const src = fs.readFileSync(resolverPath, "utf-8");
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      const spec = m[1];
      if (!isAllowed(spec)) {
        offenders.push(spec);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rejects an injected disallowed import in a synthetic source", () => {
    // Sanity: verify the matcher actually catches violations. Build a
    // synthetic source line and run the same check inline.
    const synthetic = `import { foo } from "@blackbelt-technology/pi-dashboard-server/bar";\n`;
    const matches = Array.from(synthetic.matchAll(IMPORT_RE)).map((m) => m[1]);
    expect(matches).toEqual(["@blackbelt-technology/pi-dashboard-server/bar"]);
    expect(matches.every(isAllowed)).toBe(false);
  });
});
