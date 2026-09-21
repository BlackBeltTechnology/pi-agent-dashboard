/**
 * Shared opt-in gate for browser-driving suites.
 *
 * Mirrors the `describe.skipIf(!chromiumAvailable())` pattern used by
 * `packages/document-converter/src/__tests__/integration.test.ts`: a browser is
 * a heavy prerequisite, so suites self-skip when it is absent.
 */
import { chromium } from "playwright";

let cached: boolean | undefined;

/** True when a usable chromium is installed. Probes once per process. */
export async function chromiumAvailable(): Promise<boolean> {
  if (cached !== undefined) return cached;
  try {
    const browser = await chromium.launch({ channel: "chromium" });
    await browser.close();
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** Install hint for a skipped/failed browser test. */
export const CHROMIUM_INSTALL_HINT = "npx playwright install chromium";
