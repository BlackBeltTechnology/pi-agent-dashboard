import type { Page } from "@playwright/test";

/**
 * Expand every tool-call burst and every tool-call step currently mounted in the transcript, so a finalized
 * tool result's output (and the file links in it) is rendered. Tool results are collapsed by default; a
 * burst is open iff it has a `tool-burst-body`, a step is open iff it has more than its header child.
 * Returns how many elements were toggled (0 = nothing left to expand among the mounted rows).
 */
export async function expandMountedToolOutputs(page: Page): Promise<number> {
  const bursts = await page.evaluate(() => {
    let n = 0;
    for (const g of Array.from(document.querySelectorAll('[data-testid="tool-burst-group"]'))) {
      if (g.querySelector('[data-testid="tool-burst-body"]')) continue;
      (g.querySelector('[data-testid="tool-burst-header"]') as HTMLElement | null)?.click();
      n++;
    }
    return n;
  });
  if (bursts > 0) await page.waitForTimeout(200); // let the bodies mount
  const steps = await page.evaluate(() => {
    let n = 0;
    for (const s of Array.from(document.querySelectorAll('[data-testid="tool-call-step"]'))) {
      if (s.children.length > 1) continue;
      (s.querySelector("button") as HTMLElement | null)?.click();
      n++;
    }
    return n;
  });
  return bursts + steps;
}
