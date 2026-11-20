/**
 * Inject axe-core into the page under the dashboard's ENFORCING strict CSP.
 *
 * `page.addScriptTag({ path })` inserts an inline `<script>` without the response nonce, which the strict
 * `script-src 'self' 'nonce-<n>'` refuses (the default since change: enforce-strict-csp-default). `page.evaluate`
 * of the source runs through the DevTools protocol, which page CSP does not govern — the route
 * `@axe-core/playwright` takes. Sets `window.axe`; idempotent per document.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { REPO_ROOT } from "../lifecycle.js";

export const AXE_SOURCE_PATH = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");

let source: string | undefined;

export async function injectAxe(page: Page): Promise<void> {
  if (!fs.existsSync(AXE_SOURCE_PATH)) throw new Error(`axe-core not installed at ${AXE_SOURCE_PATH} — run pnpm install`);
  source ??= fs.readFileSync(AXE_SOURCE_PATH, "utf8");
  if (await page.evaluate(() => "axe" in window)) return;
  await page.evaluate(source);
}
