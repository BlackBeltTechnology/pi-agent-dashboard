import { expect, type Locator, type Page, test } from "./fixtures.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — AsciiDoc preview styling (change: asciidoc-support, test-plan
// #F1–#F6). The server renders `.adoc` via asciidoctor; the client wraps that
// HTML in `.asciidoc-body`, whose dedicated stylesheet is what these specs
// measure. Assertions are COMPUTED STYLES, not class names: the contract is
// "the rendered document is legible and theme-tracked", which a class-name
// assert cannot prove.
//
// Fixture: docker/fixtures/sample-git/styling.adoc (copied to the session cwd
// at container start), carrying three section levels, a NOTE admonition, a
// frame=none/grid=none table, a stripes=even table and `:toc:`.
// Exemplar: tests/e2e/eml-preview.spec.ts (/view → editor-pane preview).

/** Dismiss the harness's recurring spawn toasts (they intercept the send button). */
async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** `/view @styling.adoc` → the mounted `.asciidoc-body` scope. */
async function openAdoc(page: Page): Promise<Locator> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill("/view @styling.adoc");
  await page.keyboard.press("Escape"); // close the slash-command dropdown
  await composer.fill("/view @styling.adoc");
  await expect(async () => {
    await dismissToasts(page);
    await byTestId(page, "sendButton").click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=styling\.adoc/, { timeout: 20_000 });
  const body = page.locator(".asciidoc-body");
  await expect(body.first()).toBeVisible({ timeout: 30_000 });
  return body.first();
}

const px = (v: string): number => Number.parseFloat(v) || 0;

/** Computed value of one CSS property for the first match under `scope`. */
async function styleOf(scope: Locator, selector: string, prop: string): Promise<string> {
  const el = scope.locator(selector).first();
  await expect(el).toBeAttached({ timeout: 20_000 });
  return el.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), prop);
}

test.describe("AsciiDoc preview styling", () => {
  test("F1/F2/F3/F4/F5: headings, admonition, tables and TOC are styled", async ({ page }) => {
    const body = await openAdoc(page);

    // F1 — heading sizes strictly decrease h1 → h2 → h3, all above body text.
    const bodySize = px(await body.evaluate((n) => getComputedStyle(n).fontSize));
    const h1 = px(await styleOf(body, "h1", "font-size"));
    const h2 = px(await styleOf(body, "h2", "font-size"));
    const h3 = px(await styleOf(body, "h3", "font-size"));
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThan(bodySize);

    // F2 — the admonition is a card: real left accent + its own background.
    const adm = body.locator(".admonitionblock").first();
    await expect(adm).toBeAttached({ timeout: 20_000 });
    const accent = px(await adm.evaluate((n) => getComputedStyle(n).borderLeftWidth));
    expect(accent).toBeGreaterThanOrEqual(2);
    const admBg = await adm.evaluate((n) => getComputedStyle(n).backgroundColor);
    const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(admBg).not.toBe(pageBg);
    expect(admBg).not.toBe("rgba(0, 0, 0, 0)"); // not transparent ⇒ a real surface

    // F3 — frame=none/grid=none: no cell borders, but padding survives.
    const kvCell = body.locator("table.frame-none.grid-none td").first();
    await expect(kvCell).toBeAttached({ timeout: 20_000 });
    const kv = await kvCell.evaluate((n) => {
      const s = getComputedStyle(n);
      return { top: s.borderTopWidth, right: s.borderRightWidth, bottom: s.borderBottomWidth, left: s.borderLeftWidth, pad: s.paddingLeft };
    });
    expect(px(kv.top) + px(kv.right) + px(kv.bottom) + px(kv.left)).toBe(0);
    expect(px(kv.pad)).toBeGreaterThan(0);

    // F4 — stripes=even: even rows differ from odd rows; header differs from both.
    const striped = body.locator("table.stripes-even").first();
    await expect(striped).toBeAttached({ timeout: 20_000 });
    const bg = (loc: Locator) => loc.evaluate((n) => getComputedStyle(n).backgroundColor);
    const odd = await bg(striped.locator("tbody tr").nth(0));
    const even = await bg(striped.locator("tbody tr").nth(1));
    expect(even).not.toBe(odd);
    const headerCell = await bg(striped.locator("thead th").first());
    expect(headerCell).not.toBe(odd);

    // F5 — the TOC renders as a distinct panel with deeper nesting indented.
    const toc = body.locator("#toc").first();
    await expect(toc).toBeAttached({ timeout: 20_000 });
    const tocBg = await toc.evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(tocBg).not.toBe(pageBg);
    const indents = await toc.evaluate((n) => {
      const outer = n.querySelector("ul");
      const inner = outer?.querySelector("ul");
      if (!outer || !inner) return null;
      return { outer: getComputedStyle(outer).paddingLeft, inner: getComputedStyle(inner).paddingLeft };
    });
    expect(indents, "the TOC must have a nested list").not.toBeNull();
    expect(px(indents!.inner)).toBeGreaterThan(px(indents!.outer));
  });

  test("F6: switching the theme retargets the preview colors without a reload", async ({ page }) => {
    const body = await openAdoc(page);
    const headingColor = () => styleOf(body, "h1", "color");
    const before = await headingColor();

    // The ThemePicker lives in the sidebar header, which stays mounted next to
    // the editor pane — so no navigation or reload happens between samples.
    await dismissToasts(page);
    await byTestId(page, "theme-picker-trigger").click();
    const dropdown = page.getByTestId("theme-picker-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });
    const options = dropdown.locator('[data-testid^="theme-option-"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);

    // Pick the first option whose heading colour actually differs (themes may
    // share a heading token; a same-colour pick would prove nothing).
    let after = before;
    for (let i = 0; i < count; i++) {
      await options.nth(i).click();
      await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
      after = await headingColor();
      if (after !== before) break;
      await byTestId(page, "theme-picker-trigger").click();
      await expect(dropdown).toBeVisible({ timeout: 10_000 });
    }
    expect(after, "no registered theme changed the .asciidoc-body heading colour").not.toBe(before);
    // Still the same document, never re-fetched: the preview is still mounted.
    await expect(body).toBeVisible();
  });
});
