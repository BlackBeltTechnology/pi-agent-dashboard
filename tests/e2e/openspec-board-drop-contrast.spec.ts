import { expect, type Page, test } from "./fixtures.js";
import { byTestId } from "./helpers/index.js";
import {
  beginCardDrag,
  card,
  columnBody,
  headerGrabPoint,
  openBoard,
  rail,
  setBoardLayout,
} from "./helpers/openspec-board.js";

/**
 * Browser E2E — insertion-marker and append-rail contrast across every theme.
 *
 * The marker's `background` and the rail's active border resolve from
 * `--accent-primary`, which is set STATICALLY in `index.css` and is NOT
 * theme-switched; the surfaces they sit on (`--bg-secondary` and friends) ARE.
 * So the ratio has to be measured per theme rather than argued from one, and
 * `color-mix()` only resolves in a real browser.
 *
 * Gate: WCAG 2.1 SC 1.4.11 non-text contrast, 3:1 against the column
 * background (test-plan C4).
 *
 * Covers test-plan #A1, #A2, #A3.
 * See change: fix-openspec-board-drop-targeting.
 */

const THEMES = [
  "base", "dracula", "nord", "github", "catppuccin",
  "tokyo-night", "rose-pine", "solarized", "gruvbox",
];
const MODES = ["dark", "light"] as const;
/** `--accent-primary` is static, so blue-accented themes are the highest risk. */
const STATIC_ACCENT_RISK = new Set(["github", "tokyo-night", "rose-pine", "solarized"]);
const FLOOR = 3.0;

const A = card(1);
const B = card(2);
const C = card(3);
const X = card(5);

async function applyTheme(page: Page, theme: string, mode: string): Promise<void> {
  await page.evaluate(
    ([t, m]) => {
      localStorage.setItem("dashboard:theme-name", t);
      localStorage.setItem("dashboard:theme", m);
    },
    [theme, mode],
  );
  await page.reload();
  await byTestId(page, "headerAppBar").waitFor({ state: "visible", timeout: 30_000 });
  if (mode === "light") {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")), { timeout: 10_000 })
      .toBe("light");
  }
}

/**
 * Measure marker-vs-surface and rail-vs-surface contrast on the LIVE drag
 * affordances — not on synthetic probe elements, so the numbers include the
 * actual cascade (pseudo-element, `color-mix`, inset ring).
 */
function measure(page: Page, colKey: string) {
  return page.evaluate((key) => {
    const parse = (s: string): [number, number, number, number] => {
      let m = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
      if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
      m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
      if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] !== undefined ? +m[4] : 1];
      return [0, 0, 0, 1];
    };
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const L = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    /** Composite a possibly-translucent colour over an opaque backdrop. */
    const over = (fg: number[], bg: number[]) =>
      [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const contrast = (a: number[], b: number[]) => {
      const l1 = L(a), l2 = L(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };

    const body = document.querySelector(`[data-testid="board-column-body-${key}"]`) as HTMLElement;
    // The marker paints into the flex gap, so the surface behind it is the
    // column BODY's background, not a card's.
    const surface = parse(getComputedStyle(body).backgroundColor);
    // The body background may itself be translucent (the drop-target tint), so
    // composite it over the column root before using it as the backdrop.
    const root = parse(getComputedStyle(body.parentElement as HTMLElement).backgroundColor);
    const backdrop = over(surface, root);

    const host = document.querySelector(".board-drop-marker") as HTMLElement | null;
    const markerColor = host
      ? parse(getComputedStyle(host, "::after").backgroundColor)
      : null;

    const railEl = document.querySelector(`[data-testid="board-append-rail-${key}"]`) as HTMLElement | null;
    const railActive = railEl?.dataset.railActive === "true";
    const railStyle = railEl ? getComputedStyle(railEl) : null;

    return {
      backdrop,
      marker: markerColor ? contrast(over(markerColor, backdrop), backdrop) : null,
      railActive,
      railBorder: railStyle ? contrast(over(parse(railStyle.borderTopColor), backdrop), backdrop) : null,
      railBg: railStyle ? contrast(over(parse(railStyle.backgroundColor), backdrop), backdrop) : null,
    };
  }, colKey);
}

/**
 * Drive one theme·mode cell: hover the middle card's top half for the marker,
 * then the rail for its active state, and return both readings.
 */
async function readCell(page: Page, colKey: string) {
  const move = await beginCardDrag(page, X);
  const b = await page.getByTestId(`board-card-${B}`).boundingBox();
  await move({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 - 6 });
  await expect(columnBody(page, colKey)).toHaveAttribute("data-drop-slot", "1");
  const withMarker = await measure(page, colKey);

  await move(await headerGrabPoint(page, colKey));
  const railBox = await rail(page, colKey).boundingBox();
  await move({ x: railBox!.x + railBox!.width / 2, y: railBox!.y + railBox!.height / 2 });
  await expect(rail(page, colKey)).toHaveAttribute("data-rail-active", "true");
  const withRail = await measure(page, colKey);

  await page.mouse.up();
  await page.waitForTimeout(150);
  return { withMarker, withRail };
}

/** A one-entry report when `ratio` misses the floor, else nothing. */
function record(label: string, ratio: number | null): string[] {
  if (ratio === null || ratio + 0.01 >= FLOOR) return [];
  return [`${label}=${ratio.toFixed(2)}`];
}

test.describe("board drop affordance contrast", () => {
  test.setTimeout(300_000);

  // #A1 / #A2 / #A3 — one sweep covers all three rows: the same 18 theme·mode
  // combinations produce both the marker and the rail reading, and the
  // static-accent risk themes are a labelled subset of them.
  test("A1+A2+A3: marker and rail clear 3:1 on all 9 themes × light+dark", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openBoard(page, 10);
    const ids = await setBoardLayout(page, [
      { name: "E2E Contrast", changes: [A, B, C] },
      { name: "E2E ContrastSrc", changes: [X] },
    ]);
    const col = ids.get("E2E Contrast")!;

    const belowFloor: string[] = [];
    let checked = 0;

    for (const theme of THEMES) {
      for (const mode of MODES) {
        await applyTheme(page, theme, mode);
        await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });

        const { withMarker, withRail } = await readCell(page, col);
        const label = `${theme}/${mode}${STATIC_ACCENT_RISK.has(theme) ? " (static-accent risk)" : ""}`;
        checked++;

        // A1 — the marker bar against the column background.
        expect(withMarker.marker, `${label}: no marker rendered`).not.toBeNull();
        // A2 — the rail in its active state. Its solid accent BORDER is the
        // load-bearing cue; the tinted fill is decorative, so the border is
        // what the floor applies to.
        expect(withRail.railActive, `${label}: rail not active`).toBe(true);
        belowFloor.push(
          ...record(`${label} marker`, withMarker.marker),
          ...record(`${label} rail`, withRail.railBorder),
        );
      }
    }

    expect(checked).toBe(THEMES.length * MODES.length);
    expect(belowFloor, `below the 3:1 floor: ${belowFloor.join(", ")}`).toEqual([]);
  });
});
