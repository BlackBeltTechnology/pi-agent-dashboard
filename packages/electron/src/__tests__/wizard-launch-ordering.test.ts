/**
 * Repo-level invariant: the `wizard-welcome` arm of `packages/electron/src/main.ts`
 * MUST close the splash window BEFORE opening the wizard, and MUST re-open the
 * splash AFTER the wizard returns.
 *
 * Why: the splash window is `alwaysOnTop: true`. If it remains visible while
 * the wizard opens, the wizard is occluded on Windows (the `[Launch dashboard]`
 * CTA is unreachable, the startup machine stalls awaiting the wizard's
 * `'closed'` event, and the user sees a forever-spinning "Preparing first
 * launch…" splash).
 *
 * If this test fails, restore the contract in `main.ts`'s wizard-welcome arm:
 *     if (isFirstRun()) {
 *       try { registerBundledBridgeExtension(); } catch { ... }
 *       closeSplash();          // <-- BEFORE wizard
 *       await showWelcomeStep();
 *       showSplash();           // <-- AFTER wizard, before subsequent status updates
 *     }
 *
 * See change: fix-wizard-occluded-by-splash.
 */
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const MAIN_PATH = path.join(__dirname, "..", "main.ts");

/**
 * Extract the wizard-welcome arm of main.ts: the lines between the
 * `// ── State: wizard-welcome` comment header and the next state header
 * `// ── State: launch-server`. Both header strings are stable invariants of
 * the documented startup machine (see `docs/electron-bootstrap-flow.md`).
 */
function extractWizardWelcomeArm(src: string): string {
  const lines = src.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && /State:\s+wizard-welcome/.test(lines[i])) {
      start = i;
      continue;
    }
    if (start !== -1 && /State:\s+launch-server/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start === -1 || end === -1) {
    throw new Error(
      "Could not locate the wizard-welcome arm in main.ts. " +
        "Expected `// ── State: wizard-welcome` and `// ── State: launch-server` " +
        "headers per docs/electron-bootstrap-flow.md.",
    );
  }
  return lines.slice(start, end).join("\n");
}

describe("main.ts — wizard-welcome arm splash ordering", () => {
  const src = fs.readFileSync(MAIN_PATH, "utf-8");
  const arm = extractWizardWelcomeArm(src);

  it("closes the splash BEFORE opening the wizard", () => {
    const closeIdx = arm.indexOf("closeSplash()");
    const showWelcomeIdx = arm.indexOf("showWelcomeStep()");

    if (closeIdx === -1) {
      throw new Error(
        "wizard-welcome arm is missing `closeSplash()` call. The splash window\n" +
          "is alwaysOnTop and MUST close before the wizard opens. See change:\n" +
          "fix-wizard-occluded-by-splash.\nArm contents:\n" +
          arm,
      );
    }
    if (showWelcomeIdx === -1) {
      throw new Error(
        "wizard-welcome arm is missing `showWelcomeStep()` call. See\n" +
          "docs/electron-bootstrap-flow.md.\nArm contents:\n" +
          arm,
      );
    }
    if (closeIdx >= showWelcomeIdx) {
      throw new Error(
        "wizard-welcome arm has `closeSplash()` at or after `showWelcomeStep()`.\n" +
          "Splash MUST close BEFORE wizard opens or the wizard is occluded on\n" +
          "Windows. See change: fix-wizard-occluded-by-splash.\nArm contents:\n" +
          arm,
      );
    }
  });

  it("re-opens the splash AFTER the wizard returns", () => {
    const showWelcomeIdx = arm.indexOf("showWelcomeStep()");
    const showSplashAfter = arm.indexOf("showSplash()", showWelcomeIdx);

    if (showSplashAfter === -1) {
      throw new Error(
        "wizard-welcome arm does not re-open the splash after `showWelcomeStep()`\n" +
          "returns. Subsequent `updateSplashStatus()` calls would be silent no-ops\n" +
          "and the user would see no progress feedback between wizard close and\n" +
          "main window open. Add `showSplash();` after the await. See change:\n" +
          "fix-wizard-occluded-by-splash.\nArm contents:\n" +
          arm,
      );
    }
  });
});
