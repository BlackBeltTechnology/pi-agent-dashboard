/**
 * Writes the stub asset bundle to `assets/preview/` and
 * `fixtures/business-2031/assets/` (see `src/fx/stub-assets.ts`).
 * `--check` fails when a committed copy drifted. Run by `npm run gen:stub-assets`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubFiles } from "../src/fx/stub-assets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [join(root, "assets", "preview"), join(root, "fixtures", "business-2031", "assets")];
const check = process.argv.includes("--check");
let stale = 0;
for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(stubFiles())) {
    const path = join(dir, name);
    const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) {
        console.error(`stale: ${path}`);
        stale++;
      }
    } else writeFileSync(path, bytes);
  }
}
if (check) {
  if (stale) process.exit(1);
  console.log("stub assets up to date");
} else console.log(`wrote stub assets to ${dirs.join(", ")}`);
