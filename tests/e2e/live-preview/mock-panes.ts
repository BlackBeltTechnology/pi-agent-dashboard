import type { Frame } from "@playwright/test";
import { expect } from "@playwright/test";
import type { LiveViewer } from "./fixture.js";
import { LP_MOCK } from "./mock-site.js";

/**
 * Drive the live-component mock site shown in a viewer pane to a frame with nested `?pane=` iframes
 * (`Current` / `Proposed`) and assert every nested pane RENDERED its content (not merely that an iframe element exists).
 * The mock (`lpMockSource`) frame 1 shows `current ring` / `proposed ring <marker>` in its two panes.
 */
export async function expectNestedPanesRender(viewer: LiveViewer, marker = "v1"): Promise<{ top: Frame; panes: Frame[] }> {
  const top = await viewer.ready("#root");
  await top.evaluate((id) => {
    location.hash = `#${id}/1`;
  }, LP_MOCK);
  await expect.poll(() => top.childFrames().length, { message: "the mock's two nested pane iframes mounted", timeout: 30_000 }).toBe(2);
  const panes = top.childFrames();
  const want = [/current ring/, new RegExp(`proposed ring ${marker}`)];
  for (const [i, pane] of panes.entries()) {
    await expect(pane.locator("body"), `nested pane ${i + 1} renders its content`).toContainText(want[i] as RegExp, { timeout: 30_000 });
    expect(pane.url(), "nested pane is a real document, not the browser's error page").not.toMatch(/^chrome-error:|^about:neterror/);
    expect(pane.url()).toContain("?pane=");
  }
  return { top, panes };
}
