import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — resize drags never outlive the button press, even over an
// iframe-backed preview (change: fix-split-divider-drag; test-plan F1–F4).
//
// The HTML preview is a sandboxed iframe: before the fix, a drag released over
// it never reached the parent document, so the divider kept following the
// pointer. Exemplars: changed-on-disk-content-gate.spec.ts (docker-exec fixture
// write + session + editor deep link), editor-pane.spec.ts (split-divider ids).

const TOKEN = randomBytes(4).toString("hex");
const REL = `sdd-${TOKEN}.html`;
let container = "";

const sh = (script: string): string =>
  execFileSync("docker", ["exec", container, "sh", "-c", script], { encoding: "utf8" }).trim();

test.beforeEach(() => {
  container = resolveContainer();
  sh(`printf '%s' '<!doctype html><html><body style="margin:0;background:#cde"><h1>drag target</h1></body></html>' > '${FIXTURE_GIT}/${REL}'`);
});

test.afterEach(() => {
  try {
    sh(`rm -f '${FIXTURE_GIT}/${REL}'`);
  } catch {
    /* container gone */
  }
});

async function openPreview(page: Page): Promise<{ iframe: Locator }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = await spawnFreshGitSession(page);
  const sessionId = await card.getAttribute("data-session-id");
  await card.click();
  await page.goto(`/session/${sessionId}/editor?file=${encodeURIComponent(REL)}`);
  await expect(page.getByTestId("split-divider")).toBeVisible({ timeout: 30_000 });
  const iframe = page.getByTestId("split-editor-pane").locator("iframe").first();
  await expect(iframe).toBeVisible({ timeout: 30_000 });
  return { iframe };
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const chatWidth = async (page: Page) => (await box(page.getByTestId("split-chat-pane"))).width;

test.describe("divider drag over an iframe preview", () => {
  test("F1: split divider — release over the iframe ends the drag", async ({ page }) => {
    const { iframe } = await openPreview(page);
    const d = centre(await box(page.getByTestId("split-divider")));
    const f = await box(iframe);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 120, f.y + f.height / 2, { steps: 8 });
    await page.mouse.up();
    const atRelease = await chatWidth(page);
    await page.mouse.move(d.x + 320, f.y + f.height / 2, { steps: 6 });
    await page.waitForTimeout(200);
    expect(Math.abs((await chatWidth(page)) - atRelease)).toBeLessThanOrEqual(1);
  });

  test("F2: rail divider — release over the iframe ends the drag", async ({ page }) => {
    const { iframe } = await openPreview(page);
    const toggle = page.getByTestId("tree-toggle");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    const divider = page.getByTestId("rail-divider");
    await expect(divider).toBeVisible();
    const rail = divider.locator("xpath=preceding-sibling::div[1]");
    const d = centre(await box(divider));
    const f = await box(iframe);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 100, f.y + f.height / 2, { steps: 8 });
    await page.mouse.up();
    const atRelease = (await box(rail)).width;
    await page.mouse.move(d.x + 250, f.y + f.height / 2, { steps: 6 });
    await page.waitForTimeout(200);
    expect(Math.abs((await box(rail)).width - atRelease)).toBeLessThanOrEqual(1);
  });

  test("F3: a shield covers the iframe for the length of the drag only", async ({ page }) => {
    const { iframe } = await openPreview(page);
    const d = centre(await box(page.getByTestId("split-divider")));
    const f = await box(iframe);
    const px = d.x + 120;
    const py = f.y + f.height / 2;
    const topmost = () =>
      page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.getAttribute("data-testid") ?? el?.tagName ?? null;
      }, [px, py] as const);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(px, py, { steps: 8 });
    // Mid-drag the topmost element at the pointer is the shield, not the iframe.
    await expect.poll(topmost).toBe("resize-drag-shield");
    await page.mouse.up();
    // Released: the shield is gone, so the embedded content receives pointer input again.
    await expect(page.getByTestId("resize-drag-shield")).toHaveCount(0);
    await expect.poll(topmost).not.toBe("resize-drag-shield");
  });

  test("F4: pressing the divider without moving keeps composer focus", async ({ page }) => {
    await openPreview(page);
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.focus();
    await expect(composer).toBeFocused();
    const d = centre(await box(page.getByTestId("split-divider")));
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(composer).toBeFocused();
  });
});
