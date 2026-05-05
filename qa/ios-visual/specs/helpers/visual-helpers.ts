/**
 * Shared test helpers for iOS visual smoke tests.
 *
 * These helpers normalize browser state before visual checkpoints
 * so screenshots are deterministic across runs.
 */

import type { Browser } from "webdriverio";

export interface FocusedChatInputMetrics {
  focused: boolean;
  activeElementTag: string | null;
  visualViewportScale: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
  visualViewportOffsetLeft: number;
  visualViewportOffsetTop: number;
  layoutViewportWidth: number;
  layoutViewportHeight: number;
  htmlScrollWidth: number;
  htmlClientWidth: number;
  bodyScrollWidth: number;
  bodyClientWidth: number;
  horizontalOverflow: number;
  sendButtonRect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  sendButtonIntersectsVisualViewport: boolean;
  sendButtonFullyInVisualViewport: boolean;
  sendButtonCenterHit: boolean;
}

/** Read runtime viewport/focus geometry for the focused chat input bug. */
export async function getFocusedChatInputMetrics(
  browser: Browser
): Promise<FocusedChatInputMetrics> {
  return browser.execute(() => {
    const textarea = document.querySelector(
      'textarea[placeholder*="Message"]'
    ) as HTMLTextAreaElement | null;
    const sendButton = document.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLElement | null;
    const vv = window.visualViewport;
    const visualLeft = vv?.offsetLeft ?? 0;
    const visualTop = vv?.offsetTop ?? 0;
    const visualWidth = vv?.width ?? window.innerWidth;
    const visualHeight = vv?.height ?? window.innerHeight;
    const visualRight = visualLeft + visualWidth;
    const visualBottom = visualTop + visualHeight;
    const active = document.activeElement;
    const rect = sendButton?.getBoundingClientRect() ?? null;
    const hitX = rect ? rect.left - visualLeft + rect.width / 2 : -1;
    const hitY = rect ? rect.top - visualTop + rect.height / 2 : -1;
    const hit = rect && hitX >= 0 && hitY >= 0 && hitX <= visualWidth && hitY <= visualHeight
      ? document.elementFromPoint(hitX, hitY)
      : null;
    const htmlOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const bodyOverflow = document.body.scrollWidth - document.body.clientWidth;

    return {
      focused: active === textarea,
      activeElementTag: active?.tagName?.toLowerCase() ?? null,
      visualViewportScale: vv?.scale ?? 1,
      visualViewportWidth: visualWidth,
      visualViewportHeight: visualHeight,
      visualViewportOffsetLeft: visualLeft,
      visualViewportOffsetTop: visualTop,
      layoutViewportWidth: window.innerWidth,
      layoutViewportHeight: window.innerHeight,
      htmlScrollWidth: document.documentElement.scrollWidth,
      htmlClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      horizontalOverflow: Math.max(htmlOverflow, bodyOverflow, 0),
      sendButtonRect: rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null,
      sendButtonIntersectsVisualViewport: !!(
        rect &&
        rect.right > visualLeft &&
        rect.left < visualRight &&
        rect.bottom > visualTop &&
        rect.top < visualBottom
      ),
      sendButtonFullyInVisualViewport: !!(
        rect &&
        rect.left >= visualLeft - 1 &&
        rect.top >= visualTop - 1 &&
        rect.right <= visualRight + 1 &&
        rect.bottom <= visualBottom + 1
      ),
      sendButtonCenterHit: !!(hit && sendButton && (hit === sendButton || sendButton.contains(hit))),
    } satisfies FocusedChatInputMetrics;
  });
}

/** Detect the native iOS software keyboard from NATIVE_APP context. */
export async function isNativeKeyboardVisible(browser: Browser): Promise<boolean> {
  const currentContext = await (browser as any).getContext();
  try {
    if (currentContext !== "NATIVE_APP") {
      await (browser as any).switchContext("NATIVE_APP");
    }

    const selectors = [
      '-ios class chain:**/XCUIElementTypeKeyboard',
      '-ios predicate string:type == "XCUIElementTypeKeyboard"',
    ];
    for (const selector of selectors) {
      const elements = await (browser as any).$$(selector);
      for (const element of elements) {
        if (await element.isDisplayed().catch(() => false)) {
          return true;
        }
      }
      if (elements.length > 0) {
        return true;
      }
    }
    return false;
  } finally {
    if (currentContext !== "NATIVE_APP") {
      await (browser as any).switchContext(currentContext);
    }
  }
}

export interface NativeTapAttempt {
  x: number;
  y: number;
  offsetY: number;
  focused: boolean;
  keyboardVisible: boolean;
  scale: number;
}

export async function focusChatInputWithNativeTaps(
  browser: Browser,
  offsetsY = [60, 70, 80, 50, 90, 40, 100, 30, 0]
): Promise<{ focused: boolean; keyboardVisible: boolean; attempts: NativeTapAttempt[] }> {
  const webContext = (await (browser as any).getContext()) as string;
  const center = await browser.execute(() => {
    const textarea = document.querySelector(
      'textarea[placeholder*="Message"]'
    ) as HTMLTextAreaElement | null;
    if (!textarea) return null;
    const rect = textarea.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
  if (!center) {
    return { focused: false, keyboardVisible: false, attempts: [] };
  }

  const attempts: NativeTapAttempt[] = [];
  for (const offsetY of offsetsY) {
    const x = Math.round(center.x);
    const y = Math.round(center.y + offsetY);

    await (browser as any).switchContext("NATIVE_APP");
    await (browser as any).execute("mobile: tap", { x, y });
    await (browser as any).switchContext(webContext);
    await browser.pause(700);

    const metrics = await getFocusedChatInputMetrics(browser);
    const keyboardVisible = await isNativeKeyboardVisible(browser);
    attempts.push({
      x,
      y,
      offsetY,
      focused: metrics.focused,
      keyboardVisible,
      scale: metrics.visualViewportScale,
    });

    if (metrics.focused && keyboardVisible) {
      return { focused: true, keyboardVisible: true, attempts };
    }
  }

  const last = attempts.at(-1);
  return {
    focused: !!last?.focused,
    keyboardVisible: !!last?.keyboardVisible,
    attempts,
  };
}

export async function waitForNativeKeyboard(
  browser: Browser,
  timeout = 5000
): Promise<boolean> {
  try {
    await browser.waitUntil(() => isNativeKeyboardVisible(browser), {
      timeout,
      interval: 250,
      timeoutMsg: "iOS software keyboard did not appear",
    });
    return true;
  } catch {
    return false;
  }
}

export function formatFocusedChatInputMetrics(metrics: FocusedChatInputMetrics): string {
  return JSON.stringify(metrics, null, 2);
}

/** Wait for the dashboard SPA root to fully render. */
export async function waitForDashboardRoot(browser: Browser): Promise<void> {
  // Wait for the root element to be present — dashboard mounts to #root
  await browser.waitUntil(
    async () => {
      const root = await browser.$("#root");
      return root && (await root.isExisting());
    },
    { timeout: 15000, timeoutMsg: "Dashboard root (#root) not found" }
  );

  // Give React a moment to hydrate
  await browser.pause(1000);
}

/** Wait for a selector to be present and visible. */
export async function waitForSelector(
  browser: Browser,
  selector: string,
  timeout = 10000
): Promise<void> {
  const el = await browser.$(selector);
  await el.waitForDisplayed({ timeout });
}

/** Navigate to a dashboard route and wait for render stability. */
export async function navigateTo(
  browser: Browser,
  path: string
): Promise<void> {
  await browser.url(path);
  await waitForDashboardRoot(browser);
  // Extra settle time for route transitions and data loading
  await browser.pause(1500);
}

/** Seed localStorage for deterministic visual state. */
export async function seedLocalStorage(browser: Browser): Promise<void> {
  await browser.execute(() => {
    // Force dark theme with base variant
    localStorage.setItem("dashboard:theme", "dark");
    localStorage.setItem("dashboard:theme-name", "base");

    // Suppress PWA install banner (deterministic for visual diff)
    localStorage.setItem("pwa-install-dismissed", "true");

    // Disable animations/transitions for visual stability
    const style = document.createElement("style");
    style.id = "fixture-disable-animations";
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `;
    document.head.appendChild(style);
  });
}

/** Clear service worker registrations for the current origin. */
export async function clearServiceWorkers(browser: Browser): Promise<void> {
  await browser.execute(async () => {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    // Clear caches
    if ("caches" in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  });
}

/** Scroll to top and wait for any scroll-driven rendering. */
export async function scrollToTop(browser: Browser): Promise<void> {
  await browser.execute(() => {
    window.scrollTo(0, 0);
  });
  await browser.pause(300);
}

/** Take a full-page visual checkpoint with a descriptive tag. */
export async function visualCheck(
  browser: Browser,
  tag: string
): Promise<void> {
  // checkFullPageScreen is added at runtime by @wdio/visual-service
  await (browser as any).checkFullPageScreen(tag);
}

/** Dismiss iOS Safari native popups (coachmark "View Bookmarks, Share Menu",
 *  "Open Tabs", share sheets, etc.) by switching to NATIVE_APP context
 *  and tapping the Close button. Falls back to viewport-center tap. */
export async function dismissNativePopups(browser: Browser): Promise<void> {
  try {
    // Primary: use the native-context dismiss helper attached in wdio.conf.ts before()
    if (typeof (browser as any).dismissNativeCoachmark === "function") {
      await (browser as any).dismissNativeCoachmark();
    }
  } catch {
    // Fallback: tap center of viewport
    try {
      const width = await browser.execute(() => window.innerWidth);
      const height = await browser.execute(() => window.innerHeight);
      await browser.touchAction({
        action: "tap",
        x: Math.floor((width as number) / 2),
        y: Math.floor((height as number) / 2),
      });
    } catch {
      // touchAction may not be available
    }
  }
  await browser.pause(500);
}

/** Full stabilization sequence before a visual checkpoint. */
export async function stabilizeForVisual(browser: Browser): Promise<void> {
  await scrollToTop(browser);
  await seedLocalStorage(browser);
  await dismissNativePopups(browser);

  // Reload so theme/PWA-install localStorage changes take effect before render
  await browser.refresh();
  await waitForDashboardRoot(browser);
  await browser.pause(1000);

  // Re-seed after reload (animations style gets wiped)
  await seedLocalStorage(browser);
  await browser.pause(500);
}
