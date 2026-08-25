import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * The GENERIC reachability gate for every route-backed overlay
 * (`shell-overlay-route` · "Route-backed overlay content SHALL be reachable").
 *
 * Why it exists at this level and nowhere else: jsdom has no layout engine and
 * reports a zero box for every element, so the three
 * `components/overlay/__tests__/` suites are STRUCTURALLY incapable of seeing
 * this defect class — and `toBeVisible()` passes happily on an element that is
 * rendered but clipped, failing only at zero height. Five of five non-plugin
 * overlay routes shipped clipping their content (worst case 18 353 px of a
 * README unreachable, zero scrollers) under a fully green suite.
 *
 * Why generic rather than a list of the five known-bad routes: a gate written
 * against today's breakage cannot catch the NEXT converted surface, which is
 * exactly how this shipped. The route table is therefore checked for
 * COMPLETENESS against the router's own descriptor table and the plugin
 * manifests, so a route added there and not here fails.
 *
 * ε = 4 px throughout: the two working plugin routes measured 2 px of rounding
 * noise, the smallest real defect was 56 px.
 *
 * See change: fix-flush-dialog-scroll-and-close-collision.
 */

const EPS = 4;
const CWD = Buffer.from(FIXTURE_GIT).toString("base64url");

interface OverlayRoute {
  /** Router pattern this entry covers — matched against the completeness sources. */
  pattern: string;
  /** Concrete URL to open. */
  url: string;
  /** The Dialog panel's testid (RouteBackedOverlay passes it through). */
  overlay: string;
  /**
   * Proof the surface actually RENDERED before any geometry is read. Without
   * it a mis-seeded harness makes the gate vacuous: an empty box passes every
   * geometry assertion (design R6).
   */
  content: (panel: Locator) => Locator;
}

const ROUTES: OverlayRoute[] = [
  {
    pattern: "/settings/:page",
    url: "/settings/general",
    overlay: "settings-overlay",
    content: (p) => p.getByTestId("settings-nav-rail"),
  },
  {
    pattern: "/settings",
    url: "/settings",
    overlay: "settings-overlay",
    content: (p) => p.getByTestId("settings-nav-rail"),
  },
  {
    pattern: "/folder/:cwd/settings",
    url: `/folder/${CWD}/settings`,
    overlay: "folder-settings-overlay",
    content: (p) => p.getByTestId("directory-settings"),
  },
  {
    pattern: "/folder/:cwd/settings/:page",
    url: `/folder/${CWD}/settings/general`,
    overlay: "folder-settings-overlay",
    content: (p) => p.getByTestId("directory-settings"),
  },
  {
    pattern: "/folder/:cwd/openspec/*",
    url: `/folder/${CWD}/openspec/e2e-artifact-demo/proposal`,
    overlay: "openspec-artifact-route-overlay",
    content: (p) => p.getByTestId("markdown-preview"),
  },
  {
    pattern: "/folder/:cwd/view",
    url: `/folder/${CWD}/view?path=tall.md`,
    overlay: "preview-route-overlay",
    // The LAST section, not the shell: the preview frame mounts immediately and
    // its markdown body arrives async, so probing the frame would measure an
    // empty box and make every geometry assertion on this route vacuous.
    content: (p) => p.getByText("Section 120", { exact: false }),
  },
  {
    pattern: "/pi-view",
    url: "/pi-view?url=https%3A%2F%2Fexample.com",
    overlay: "preview-route-overlay",
    content: (p) => p.getByTestId("preview-overlay"),
  },
  {
    pattern: "/pi-resource",
    url: "/pi-resource?path=%2Ffixtures%2Fsample-git%2Fnotes.md",
    overlay: "preview-route-overlay",
    content: (p) => p.getByTestId("markdown-preview"),
  },
  {
    pattern: "/tunnel-setup",
    url: "/tunnel-setup",
    overlay: "tunnel-setup-overlay",
    content: (p) => p.getByRole("heading").first(),
  },
  {
    pattern: "/folder/:encodedCwd/kb",
    url: `/folder/${CWD}/kb`,
    overlay: "plugin-overlay",
    content: (p) => p.getByTestId("kb-settings-page"),
  },
  {
    pattern: "/folder/:encodedCwd/automations",
    url: `/folder/${CWD}/automations`,
    overlay: "plugin-overlay",
    content: (p) => p.getByTestId("automation-board"),
  },
  {
    pattern: "/folder/:encodedCwd/goals",
    url: `/folder/${CWD}/goals`,
    overlay: "plugin-overlay",
    content: (p) => p.getByTestId("goals-board-page"),
  },
];

/**
 * Overlay patterns the router carries that this table deliberately does NOT
 * open, each because it needs a live id that only another spec can produce.
 * Naming them here is what keeps the completeness check honest: an unlisted,
 * uncovered pattern fails the test rather than silently sliding through.
 */
const COVERED_ELSEWHERE: Record<string, string> = {
  "/session/:sessionId/subagent/:agentId": "subagent-detail-dialog.spec.ts",
  "/folder/:encodedCwd/goals/:goalId": "bus-client-goal-plugin-action.spec.ts",
  "/folder/:encodedCwd/automations/run/:sid": "automation-fanout.spec.ts",
};

// ── geometry probes ──────────────────────────────────────────────────────────

interface Geometry {
  /** How much of the panel's own content is scrolled out of reach. */
  clipped: number;
  /** Descendants that are real scrollers (overflow-y auto|scroll AND overflowing). */
  scrollers: number;
  height: number;
  viewportHeight: number;
}

async function measure(panel: Locator): Promise<Geometry> {
  return panel.evaluate((el) => {
    const scrollers = Array.from(el.querySelectorAll("*")).filter((n) => {
      const overflowY = getComputedStyle(n).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") return false;
      return n.scrollHeight > n.clientHeight + 4;
    }).length;
    return {
      clipped: el.scrollHeight - el.clientHeight,
      scrollers,
      height: el.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    };
  });
}

/** Open an overlay route and wait for its content to actually render. */
async function openRoute(page: Page, route: OverlayRoute): Promise<Locator> {
  await page.goto(route.url);
  const panel = page.getByTestId(route.overlay);
  await expect(panel, `${route.url}: overlay panel did not mount`).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    route.content(panel),
    `${route.url}: surface did not render its content — geometry would be vacuous`,
  ).toBeVisible({ timeout: 25_000 });
  return panel;
}

/**
 * The reachability invariant (E5/E8): nothing of the panel's content is clipped
 * away, and if anything inside overflows it does so in a real scroller.
 * Viewport-independent by construction — no pixel thresholds (design R7).
 */
function expectReachable(geo: Geometry, label: string): void {
  expect(geo.clipped, `${label}: ${geo.clipped}px clipped with ${geo.scrollers} scroller(s)`).
    toBeLessThanOrEqual(EPS);
}

test.describe("overlay layout — reachability gate", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.beforeAll(async ({ browser }) => {
    // The openspec + kb routes need the fixture folder pinned and its openspec
    // map populated; ensureGitSession is the shared path for that.
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureGitSession(page);
    await page.close();
  });

  // 2.11 / E8 — the table is derived from the ROUTER, not from the mount sites,
  // and a route present there but missing here is a failure.
  test("E8: the route table covers every overlay route the router declares", async () => {
    const covered = new Set([...ROUTES.map((r) => r.pattern), ...Object.keys(COVERED_ELSEWHERE)]);

    // Half 1 — core static descriptors. Read from source rather than imported:
    // the descriptor table is a client module with a browser-only dependency
    // chain, and the patterns are the whole of what this check needs.
    const backTarget = readFileSync(
      fileURLToPath(new URL("../../packages/client/src/lib/nav/back-target.ts", import.meta.url)),
      "utf8",
    );
    const staticPatterns = Array.from(backTarget.matchAll(/\{\s*pattern:\s*"([^"]+)"/g)).map(
      (m) => m[1],
    );
    expect(staticPatterns.length, "no descriptors parsed — the table shape changed").
      toBeGreaterThan(10);
    // DRIFT TRIPWIRE for the mirror below. `isOverlayRoute` in
    // overlay-background.ts is a PREDICATE, not an enumeration, so it cannot be
    // iterated — the mirror is unavoidable. What is avoidable is the mirror
    // going stale in silence: pin the route tokens the predicate branches on,
    // so adding a branch there fails HERE and forces the mirror to be revisited.
    const overlayBackground = readFileSync(
      fileURLToPath(
        new URL("../../packages/client/src/lib/nav/overlay-background.ts", import.meta.url),
      ),
      "utf8",
    );
    const predicate = overlayBackground.slice(
      overlayBackground.indexOf("export function isOverlayRoute"),
    );
    const branchTokens = Array.from(
      new Set(Array.from(predicate.matchAll(/"([a-z-]+)"/g)).map((m) => m[1])),
    ).sort();
    expect(
      branchTokens,
      "isOverlayRoute grew or lost a route branch — revisit the mirror below AND the ROUTES table",
    ).toEqual(["folder", "openspec", "pi-resource", "pi-view", "settings", "view"]);

    // Mirrors `isOverlayRoute` in overlay-background.ts: the routes that ARE
    // overlays and therefore cannot serve as a background.
    const isOverlayPattern = (p: string) =>
      p === "/settings" ||
      p.startsWith("/settings/") ||
      p === "/tunnel-setup" ||
      p === "/pi-view" ||
      p === "/pi-resource" ||
      /^\/folder\/:cwd\/(settings|view|openspec)/.test(p);
    const missingStatic = staticPatterns.filter((p) => isOverlayPattern(p) && !covered.has(p));
    expect(missingStatic, "router overlay routes missing from the gate's table").toEqual([]);

    // Half 2 — plugin `shell-overlay-route` claims presented as dialogs.
    const pluginPkgs = ["automation-plugin", "goal-plugin", "kb-plugin", "subagents-plugin"];
    const pluginPatterns: string[] = [];
    for (const pkg of pluginPkgs) {
      const raw = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../../packages/${pkg}/package.json`, import.meta.url)),
          "utf8",
        ),
      ) as { "pi-dashboard-plugin"?: { claims?: { slot: string; path?: string; presentation?: string }[] } };
      for (const claim of raw["pi-dashboard-plugin"]?.claims ?? []) {
        if (claim.slot !== "shell-overlay-route") continue;
        if ((claim.presentation ?? "dialog") !== "dialog") continue;
        if (claim.path) pluginPatterns.push(claim.path);
      }
    }
    expect(pluginPatterns.length, "no plugin overlay claims parsed").toBeGreaterThan(3);
    const missingPlugin = pluginPatterns.filter((p) => !covered.has(p));
    expect(missingPlugin, "plugin overlay routes missing from the gate's table").toEqual([]);
  });

  // 2.8 / 2.11 / E5 / E8 — the core assertion, over EVERY route in the table.
  for (const route of ROUTES) {
    test(`E8: ${route.url} presents its content as reachable`, async ({ page }) => {
      const panel = await openRoute(page, route);
      expectReachable(await measure(panel), route.url);
    });
  }

  // 2.8 / E5 — tall content specifically: clamped AND a working scroller.
  // `tall.md` is ~120 sections, well past `max-h-[92vh] + 500px` at 1440×900.
  test("E5: tall flush content clamps at the cap and becomes scrollable", async ({ page }) => {
    const route = ROUTES.find((r) => r.url.includes("tall.md"))!;
    const panel = await openRoute(page, route);
    const geo = await measure(panel);
    expectReachable(geo, "tall.md");
    expect(geo.scrollers, "tall content must produce a working scroller").toBeGreaterThan(0);
    expect(geo.height).toBeLessThanOrEqual(0.92 * geo.viewportHeight + EPS);

    // "A working scroller exists" is NOT the contract — the contract is that the
    // OVERFLOWING CONTENT is reachable, and a scroller elsewhere in the panel
    // satisfies the weaker form while the document stays clipped. Drive the
    // scroller to its end and prove the LAST rendered content lands inside the
    // panel's own box.
    const reached = await panel.evaluate(async (el) => {
      const scroller = Array.from(el.querySelectorAll<HTMLElement>("*")).find((n) => {
        const o = getComputedStyle(n).overflowY;
        return (o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 4;
      });
      if (!scroller) return { ok: false, why: "no scroller" };
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const last = scroller.lastElementChild?.lastElementChild ?? scroller.lastElementChild;
      if (!last) return { ok: false, why: "scroller has no content" };
      const lastBox = last.getBoundingClientRect();
      const panelBox = el.getBoundingClientRect();
      return {
        ok: lastBox.bottom <= panelBox.bottom + 4 && lastBox.top >= panelBox.top - 4,
        why: `last content bottom=${Math.round(lastBox.bottom)} panel bottom=${Math.round(panelBox.bottom)}`,
        atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4,
      };
    });
    expect(reached.atEnd, `scroller did not reach its end: ${reached.why}`).toBe(true);
    expect(reached.ok, `end of content is NOT reachable: ${reached.why}`).toBe(true);
  });

  // 2.9 / E6 — short content still shrinks to fit; the cap is a cap, not a size.
  test("E6: short flush content does not expand to the cap", async ({ page }) => {
    const panel = await openRoute(page, {
      pattern: "/folder/:cwd/view",
      // `notes.md`, not `hello.txt`: a `.txt` renders the "can't preview this
      // file" state, which is short for the WRONG reason and would make this
      // assertion pass without any content ever being laid out.
      url: `/folder/${CWD}/view?path=notes.md`,
      overlay: "preview-route-overlay",
      // The fixture's own text, so a shell rendered around an unloaded body
      // cannot satisfy the "short content" precondition.
      content: (p) => p.getByText("Second tracked markdown file", { exact: false }),
    });
    const geo = await measure(panel);
    expectReachable(geo, "hello.txt");
    expect(geo.height, "short content expanded to the cap").toBeLessThan(
      0.92 * geo.viewportHeight,
    );
  });

  // 2.10 / E7 — the at-cap boundary. Driven by resizing the VIEWPORT until the
  // cap equals the measured content height, which is the only way to hit "cap
  // ±2px" deterministically: fixture content cannot be authored to a pixel.
  test("E7: at the cap boundary the panel clamps and stays reachable", async ({ page }) => {
    const route = ROUTES.find((r) => r.url.includes("tall.md"))!;
    await page.setViewportSize({ width: 1440, height: 900 });
    const panel = await openRoute(page, route);

    // Content is taller than any cap here, so the panel sits exactly AT the cap
    // at every height — shrink the viewport so the cap lands on a different
    // number and assert it re-clamps rather than clipping.
    for (const height of [900, 700]) {
      await page.setViewportSize({ width: 1440, height });
      await page.waitForTimeout(150);
      const geo = await measure(panel);
      expectReachable(geo, `at-cap @${height}`);
      expect(Math.abs(geo.height - 0.92 * geo.viewportHeight)).toBeLessThanOrEqual(2);
    }
  });

  // 2.14 / X3 — the anti-vacuity guard for the CONTENT precondition: a route
  // seeded to render its error state must fail on content, not pass on the
  // geometry of an empty box.
  test("X3: a surface that renders an error state does not pass on empty geometry", async ({
    page,
  }) => {
    const missing: OverlayRoute = {
      pattern: "/folder/:cwd/view",
      url: `/folder/${CWD}/view?path=definitely/not/here.md`,
      overlay: "preview-route-overlay",
      // The content probe a healthy run uses would resolve here too (the shell
      // renders), so this asserts the ERROR state explicitly: the gate's
      // content precondition is what must reject it, ahead of any geometry.
      // Vocabulary, not exact copy — this pins "the surface explains itself".
      content: (p) => p.getByText(/unknown|not found|no such file|failed|error|unable/i).first(),
    };
    const panel = await openRoute(page, missing);
    await expect(panel).toContainText("definitely/not/here.md");
    // And an error surface is still reachable — a dead-end modal that also
    // clips its own explanation would be the worst outcome.
    expectReachable(await measure(panel), missing.url);
  });
});

// ── occlusion (F5) ───────────────────────────────────────────────────────────

test.describe("overlay layout — no interactive element is occluded", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const route of ROUTES) {
    test(`F5: ${route.url} — nothing overlaps the effective close control`, async ({ page }) => {
      const panel = await openRoute(page, route);
      // `locator.evaluate(fn, arg)` calls fn(element, arg) — the element is
      // ALWAYS the first parameter; the extra argument is the second.
      const overlaps = await panel.evaluate((el: HTMLElement, overlayTestId: string) => {
        // EFFECTIVE close control: the container's own ✕ where one is rendered,
        // otherwise the surface's own dismissal control. After this change the
        // first branch is vacuous on a flush surface — which is the point, and
        // the branch stays so `showClose` cannot reintroduce the collision.
        // EXACT testid, not a `$="-close"` suffix match: a suffix match resolves
        // any descendant ending in `-close` (a banner's dismiss, a hint chip),
        // which would short-circuit the curated list below and measure the
        // wrong box — the very failure the comment beneath warns about.
        const containerClose = el.querySelector<HTMLElement>(
          `[data-testid="${overlayTestId}-close"]`,
        );
        // No bare-`button` fallback on purpose: the first button in the panel
        // is not necessarily a dismissal control (it can be a save or a primary
        // action), and measuring occlusion against the WRONG element is a test
        // that passes while proving nothing. A route whose dismissal control is
        // not in this list must be added to it, loudly.
        const own =
          containerClose ??
          el.querySelector<HTMLElement>(
            [
              '[data-testid="preview-back"]',
              '[data-testid="preview-overlay-back"]',
              '[data-testid="directory-settings-back"]',
              '[data-testid="kb-settings-back"]',
              '[data-testid="automation-board-back"]',
              '[data-testid="tunnel-guide-back"]',
              // Two surfaces (SettingsPanel, the goals board) label their back
              // control with a LOCALISED `title` and carry no testid. Adding an
              // app testid purely for E2E is against this repo's rule, so the
              // English literal stands: it fails LOUD under a translated locale
              // rather than silently measuring the wrong element, and the
              // harness runs in English.
              'button[title="Back"]',
              'button[aria-label="Back"]',
            ].join(", "),
          );
        if (!own) return { control: null as string | null, hits: [] as string[] };
        const box = own.getBoundingClientRect();
        const visible = (n: Element) => {
          const r = n.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const s = getComputedStyle(n);
          return s.visibility !== "hidden" && s.display !== "none";
        };
        const hits: string[] = [];
        for (const n of Array.from(el.querySelectorAll("button, a, input, select"))) {
          if (n === own || own.contains(n) || n.contains(own)) continue;
          if (!visible(n)) continue;
          const r = n.getBoundingClientRect();
          const intersects =
            r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
          if (intersects) hits.push(`${n.tagName.toLowerCase()}@${Math.round(r.x)},${Math.round(r.y)}`);
        }
        return { control: own.getAttribute("data-testid") ?? own.tagName, hits };
      }, route.overlay);
      expect(overlaps.control, `${route.url}: no dismissal control found at all`).not.toBeNull();
      expect(overlaps.hits, `${route.url}: elements overlap ${overlaps.control}`).toEqual([]);
    });
  }
});

// ── regressions the primitive change could cause (task 6 / test-plan F·X) ────

test.describe("overlay layout — regressions", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // F1 — the HIGHEST-severity regression. Plugin claim bodies render
  // `absolute inset-0` and contribute ZERO intrinsic height, so under the
  // deliberately height-INDEFINITE panel they would collapse to 0 without the
  // `h-[92vh]` slot pin (design D5). These two routes are the proposal's own
  // control group: they were the only ones that already worked.
  for (const slug of ["automations", "goals"]) {
    test(`F1: /folder/:cwd/${slug} does not collapse under the flex panel`, async ({ page }) => {
      const route = ROUTES.find((r) => r.url.endsWith(`/${slug}`))!;
      const panel = await openRoute(page, route);
      const geo = await measure(panel);
      expect(geo.height, `${slug} panel collapsed`).toBeGreaterThanOrEqual(
        0.5 * geo.viewportHeight,
      );
      await expect(panel).not.toHaveText(/^\s*$/);
    });
  }

  // F3 + F4 + F11 — the flush-surface contract, asserted once per route so a
  // failure names the route rather than the family: the container ✕ is gone
  // (F3), a visible dismissal remains and Escape still leaves (F4), and initial
  // focus lands on a focusable CHILD rather than the container fallback (F11).
  // Deliberately separate from the geometry and occlusion families above — a
  // composite verdict across all three would hide which half works.
  for (const route of ROUTES) {
    test(`F3/F4/F11: ${route.url} — no ✕, a visible exit, focus inside`, async ({ page }) => {
      const panel = await openRoute(page, route);

      // F3 — suppression asserted as a COUNT of the container's own testid, so
      // it cannot be satisfied by the control merely moving.
      await expect(panel.getByTestId(`${route.overlay}-close`)).toHaveCount(0);

      // F11 — focus landed on the child's first focusable, not the container.
      const focus = await panel.evaluate((el) => ({
        inside: el.contains(document.activeElement),
        isPanel: document.activeElement === el,
      }));
      expect(focus.inside, "focus escaped the panel").toBe(true);
      expect(focus.isPanel, "focus fell back to the container — no focusable child").toBe(false);

      // F4 — a dead-end modal is the specific defect an earlier revision of
      // this change shipped into review: suppression without an affordance.
      const exits = await panel.evaluate(
        (el) =>
          Array.from(el.querySelectorAll("button, a")).filter((n) => {
            const r = n.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !(n as HTMLButtonElement).disabled;
          }).length,
      );
      expect(exits, "no visible enabled control to leave by").toBeGreaterThan(0);

      // ...and Escape, the guaranteed exit, still leaves the surface.
      await page.keyboard.press("Escape");
      const path = route.url.split("?")[0];
      await expect(page).not.toHaveURL(
        new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      );
    });
  }

  // F6 — viewport independence. All prior evidence was 1440×900 only; 1024×640
  // is the boundary case nearest the 600px mobile cutoff, where the cap is
  // smallest and least resembles the recorded measurements.
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 640 },
  ]) {
    test(`F6: reachability holds at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const url of ["/settings/general", `/folder/${CWD}/view?path=tall.md`]) {
        const route = ROUTES.find((r) => r.url === url)!;
        const panel = await openRoute(page, route);
        expectReachable(await measure(panel), `${url} @${size.width}×${size.height}`);
      }
    });
  }

  // F8 — the DEEPEST `h-full` in the affected chain. It is not a direct flush
  // child, so the `flex-1 min-h-0` contract does not bind it: its `h-full`
  // resolves only because 4.1/4.2 bound every ancestor. Never measured before.
  test("F8: the instructions editor inside the flush dialog stays reachable", async ({ page }) => {
    await page.goto("/settings/instructions");
    const panel = page.getByTestId("settings-overlay");
    await expect(panel).toBeVisible({ timeout: 25_000 });
    await expect(panel.getByTestId("instructions-page")).toBeVisible({ timeout: 25_000 });
    expectReachable(await measure(panel), "/settings/instructions");
  });

  // F12 — resize while open. The cap is viewport-relative, so a live resize is
  // the one path that changes the panel's bound without a remount.
  test("F12: resizing while open re-clamps and keeps content reachable", async ({ page }) => {
    const route = ROUTES.find((r) => r.url.includes("tall.md"))!;
    const panel = await openRoute(page, route);
    expectReachable(await measure(panel), "before resize");
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.waitForTimeout(200);
    const geo = await measure(panel);
    expectReachable(geo, "after resize");
    expect(geo.scrollers, "content became unreachable after resize").toBeGreaterThan(0);
  });

  // X5 — the unsaved-edits guard survives losing the ✕. Escape and backdrop
  // still route through the overlay dismiss guard; only a duplicate gesture was
  // removed. Deliberately NOT asserted on the Instructions page: it passes
  // `onBack={isDesktop ? undefined : backToTree}` and renders no back arrow on
  // desktop, and its guard is `leaveOverlay`, not `requestBack`.
  test("X5: a dirty settings surface still prompts on Escape", async ({ page }) => {
    await page.goto("/settings/general");
    const panel = page.getByTestId("settings-overlay");
    await expect(panel.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 25_000 });

    // Dirty the draft through a real control, then try to leave.
    const toggle = panel.locator('button[role="switch"], input[type="checkbox"]').first();
    await toggle.click();
    await expect(panel.getByTestId("settings-save-bar")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("unsaved-changes-dialog")).toBeVisible({ timeout: 10_000 });
  });
});

// ── the two non-route flush consumers (F9 / X1) ──────────────────────────────

test.describe("overlay layout — non-route flush consumers", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // X1 — `OpenSpecArtifactDialog` is URL-less by design, so it does NOT inherit
  // the route path's verification (design R8). Its `onBack` addition touches
  // all three branches; a fix applied to the loaded branch only is the likely
  // error, so all three are opened.
  test("X1: the ephemeral artifact dialog is reachable and dismissible", async ({ page }) => {
    await ensureGitSession(page);
    await page.goto(`/folder/${CWD}/openspec`);
    await expect(page.getByTestId("openspec-board")).toBeVisible({ timeout: 25_000 });
    const badge = page.getByTestId("stepper-node-proposal").first();
    await expect(badge).toBeVisible({ timeout: 45_000 });
    await badge.click();

    const dialog = page.getByTestId("openspec-artifact-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("markdown-preview")).toBeVisible();
    expectReachable(await measure(dialog), "openspec-artifact-dialog");

    // D2 removed its ✕ — the child's own back arrow is now the ONLY visible
    // dismissal, so it must exist and it must work.
    await expect(dialog.getByTestId("openspec-artifact-dialog-close")).toHaveCount(0);
    const back = dialog.getByTestId("preview-back");
    await expect(back).toBeVisible();
    await back.click();
    await expect(dialog).toHaveCount(0);
  });
});

// ── mobile shell + non-overlay mounts (F7 / F10) ─────────────────────────────

/**
 * `SettingsPanel`, `ZrokInstallGuide` and `DirectorySettings` roots are edited
 * GLOBALLY by this change, and each mounts outside the flush overlay too. An
 * overlay-only fix that regresses those mounts is not a fix — the claim "mobile
 * is unaffected" was an inference in the design, so it is measured here.
 */
test.describe("overlay layout — shared roots outside the overlay", () => {
  // F7 — the MobileShell detail panel path, NOT the overlay. `useMobile` fires
  // under 768px wide OR 600px tall, so these render as full pages against the
  // SAME roots the overlay fix edits.
  //
  // Deliberately NOT asserted: "no page-level scroll". Measured on this shell
  // at 390×844 the document scrolls 57px with these edits AND with them
  // reverted — a pre-existing property of the mobile chrome, not something this
  // change governs. Asserting it would fail for a reason unrelated to the
  // contract under test. What IS asserted is the contract: the surface root is
  // not clipped, and its body is a real internal scroller.
  for (const surface of [
    { url: "/settings/general", anchor: "settings-header" },
    { url: "/tunnel-setup", anchor: "tunnel-guide-back" },
  ]) {
    test(`F7: ${surface.url} at 390×844 keeps its body internally scrollable`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(surface.url);
      const anchor = page.getByTestId(surface.anchor);
      await expect(anchor).toBeVisible({ timeout: 25_000 });

      const geo = await anchor.evaluate((el) => {
        // The edited root is the nearest ancestor that is a flex column and
        // carries the header — walk up one level from the header/back control.
        const root = el.closest("div.flex.flex-col") ?? el.parentElement!;
        const scrollers = Array.from(root.querySelectorAll("*")).filter((n) => {
          const o = getComputedStyle(n).overflowY;
          return (o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 4;
        }).length;
        const r = root.getBoundingClientRect();
        return {
          clipped: root.scrollHeight - root.clientHeight,
          scrollers,
          height: r.height,
          // The anchor is a control INSIDE the header row; measure the row.
          headerTop: (el.closest("div.flex.items-center") ?? el).getBoundingClientRect().top,
          rootTop: r.top,
        };
      });
      expect(geo.height, `${surface.url}: the root collapsed`).toBeGreaterThan(200);
      expect(geo.clipped, `${surface.url}: the root clipped its own content`).toBeLessThanOrEqual(EPS);
      // Header pinned at the top of the root rather than scrolled with the body.
      expect(Math.abs(geo.headerTop - geo.rootTop)).toBeLessThanOrEqual(8);
    });
  }

  // F10 — `DirectorySettings` has THREE mount contexts and task 4.2 edits its
  // root globally. The flush overlay is covered by the route table above; this
  // pins the mobile context, which reaches the same component by a different
  // path.
  test("F10: DirectorySettings renders and scrolls in its mobile mount", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/folder/${CWD}/settings`);
    const panel = page.getByTestId("directory-settings");
    await expect(panel).toBeVisible({ timeout: 25_000 });
    await expect(panel.getByTestId("directory-settings-nav")).toBeVisible();
    const geo = await panel.evaluate((el) => ({
      clipped: el.scrollHeight - el.clientHeight,
      height: el.getBoundingClientRect().height,
    }));
    expect(geo.height, "collapsed in the mobile mount").toBeGreaterThan(100);
    expect(geo.clipped, "clipped in the mobile mount").toBeLessThanOrEqual(EPS);
  });
});
