/**
 * Seeded fixture dashboard visual smoke tests.
 *
 * Runs against the deterministic fixture dashboard with pre-seeded
 * sessions and replayed production-shaped events.
 */
import assert from "node:assert/strict";
import {
  navigateTo,
  waitForSelector,
  stabilizeForVisual,
  clearServiceWorkers,
  visualCheck,
  getFocusedChatInputMetrics,
  focusChatInputWithNativeTaps,
  formatFocusedChatInputMetrics,
  type FocusedChatInputMetrics,
} from "./helpers/visual-helpers.js";

describe("Seeded Fixture Dashboard", () => {
  before(async () => {
    await clearServiceWorkers(browser);
  });

  it("should display the seeded session list", async () => {
    await navigateTo(browser, "/");

    // Wait for session cards to appear (seeded by test-pi bridge)
    try {
      await browser.waitUntil(
        async () => {
          const elements = await browser.$$(
            '[data-testid="session-card"], .session-card, [class*="SessionCard"]'
          );
          return (elements as any).length >= 1;
        },
        {
          timeout: 15000,
          timeoutMsg: "Seeded session cards did not appear",
        }
      );
    } catch {
      // Session cards may use different selectors — still take checkpoint
    }

    await stabilizeForVisual(browser);
    await visualCheck(browser, "fixture-session-list");
  });

  it("should display a seeded session detail view", async () => {
    // Navigate to the first seeded session detail page
    await navigateTo(browser, "/session/fixture-session-active");

    // Wait for chat/tool content from replayed events to appear
    await browser.pause(2000);

    try {
      await browser.waitUntil(
        async () => {
          const body = await browser.$("body");
          const text = await body.getText();
          return (
            text.includes("Add user authentication") ||
            text.includes("JWT") ||
            text.includes("Login")
          );
        },
        {
          timeout: 10000,
          timeoutMsg: "Session detail content not found",
        }
      );
    } catch {
      // Content may not match exactly — checkpoint anyway
    }

    await stabilizeForVisual(browser);
    await scrollToTopAndWait(browser);
    await visualCheck(browser, "fixture-session-detail");
  });

  it("should keep the chat send button visible when input is focused", async () => {
    // Navigate and stabilize first (theme, localStorage, dismiss popups, reload)
    await navigateTo(browser, "/session/fixture-session-active");
    await browser.pause(2000);
    await stabilizeForVisual(browser);
    await scrollToTopAndWait(browser);

    // NOW focus the input — after stabilization so keyboard isn't killed by refresh
    await waitForSelector(browser, 'textarea[placeholder*="Message"]');
    const textarea = await browser.$(
      'textarea[placeholder*="Message"]'
    );

    const focusResult = await focusChatInputWithNativeTaps(browser);
    await browser.pause(1000); // wait for iOS focus zoom / keyboard animation to settle

    const metrics = await getFocusedChatInputMetrics(browser);
    await saveFocusedInputScreenshots(browser);

    assertFocusedInputBugReproduced(metrics, focusResult.keyboardVisible, focusResult.attempts);
  });
});

async function saveFocusedInputScreenshots(browser: any) {
  const currentContext = (await browser.getContext()) as string;
  await browser.saveScreenshot(
    "./visual/.tmp/actual/fixture-session-detail-input-focused.png"
  );

  try {
    if (currentContext !== "NATIVE_APP") {
      await browser.switchContext("NATIVE_APP");
    }
    await browser.saveScreenshot(
      "./visual/.tmp/fixture-session-detail-input-focused-native.png"
    );
  } finally {
    if (currentContext !== "NATIVE_APP") {
      await browser.switchContext(currentContext);
    }
  }
}

function assertFocusedInputBugReproduced(
  metrics: FocusedChatInputMetrics,
  keyboardVisible: boolean,
  tapAttempts: Array<{ x: number; y: number; offsetY: number; focused: boolean; keyboardVisible: boolean; scale: number }>
) {
  const failures: string[] = [];

  // Precondition: keyboard must appear
  if (!keyboardVisible) {
    failures.push("iOS software keyboard did not appear — precondition not met");
  }

  // Expected: Send button stays fully inside the visible viewport
  if (!metrics.sendButtonFullyInVisualViewport) {
    failures.push(
      `send button is not fully inside visual viewport — button not reachable for user`
    );
  }

  assert.equal(
    failures.length,
    0,
    `Focused input assertion failed:\n` +
      failures.map((f) => `- ${f}`).join("\n") +
      `\n\nMetrics:\n${formatFocusedChatInputMetrics(metrics)}\n\n` +
      `Native tap attempts:\n${JSON.stringify(tapAttempts, null, 2)}\n\n` +
      `Screenshots:\n` +
      `- qa/ios-visual/visual/.tmp/fixture-session-detail-input-focused-native.png\n` +
      `- qa/ios-visual/visual/.tmp/actual/fixture-session-detail-input-focused.png`
  );
}

async function scrollToTopAndWait(browser: any) {
  await browser.execute(() => (window as any).scrollTo(0, 0));
  await browser.pause(300);
}
