import { expect, type Page } from "@playwright/test";

/**
 * Rejection-observability glue for the promise-handling cleanup
 * (change: cleanup-client-plugin-promises).
 *
 * The change's regression guard is that an unobserved rejection stops being
 * silent. These helpers make that assertable from a browser test:
 *
 * - `unhandledrejection` events are captured by an init script installed
 *   BEFORE any application script runs, so a rejection fired during startup
 *   cannot slip past a listener attached too late (test-plan #F6).
 * - `pageerror` catches thrown exceptions the same way `navigation.spec.ts`
 *   does.
 *
 * Caveat carried from design.md R-GUARD: zero unhandled rejections proves
 * rejections do not ESCAPE. It does not prove they are HANDLED — a swallowing
 * `.catch(() => {})` would also pass. Pair it with the unit-level assertions on
 * `reportError` and with review.
 */

const SINK = "__piUnhandledRejections";

export interface RejectionWatcher {
  /** Reasons captured by the page-level `unhandledrejection` listener. */
  rejections(): Promise<string[]>;
  /** Uncaught exceptions seen by Playwright. */
  pageErrors: string[];
  /** Assert both channels are empty, naming what was seen. */
  assertClean(label: string): Promise<void>;
}

/** Install before `page.goto` — the init script runs ahead of app scripts. */
export async function watchRejections(page: Page): Promise<RejectionWatcher> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.addInitScript((sink) => {
    const w = window as unknown as Record<string, unknown>;
    w[sink] = [];
    window.addEventListener("unhandledrejection", (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      (w[sink] as string[]).push(
        reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
      );
    });
  }, SINK);

  const rejections = async () =>
    (await page.evaluate((sink) => {
      const w = window as unknown as Record<string, unknown>;
      return (w[sink] as string[] | undefined) ?? [];
    }, SINK)) as string[];

  return {
    rejections,
    pageErrors,
    async assertClean(label: string) {
      const seen = await rejections();
      expect(seen, `${label}: unhandled rejections\n${seen.join("\n")}`).toHaveLength(0);
      expect(
        pageErrors,
        `${label}: uncaught page errors\n${pageErrors.join("\n")}`,
      ).toHaveLength(0);
    },
  };
}
