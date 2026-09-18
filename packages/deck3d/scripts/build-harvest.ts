/**
 * Build the browser harvest bundle into `dist/harvest/harness.js`.
 * Run by `npm run build:harvest` (and by `npm run build`, i.e. at publish time).
 */
import { BUNDLE_PATH, buildHarnessBundle } from "../src/parse/harvest/bundle.js";

await buildHarnessBundle();
console.log(`built ${BUNDLE_PATH}`);
