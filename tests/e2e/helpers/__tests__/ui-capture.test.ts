/**
 * Unit tests for `captureStates` (the retro-UX state-capture helper).
 *
 * Run under the `tests` vitest project with a FAKE page: the helper's matrix,
 * guard and path logic is pure, and the Playwright specs that use it are L3.
 * The negative cases carry the weight — a capture that quietly writes into an
 * archived change dir or skips an unknown state id reintroduces the silent
 * evidence drift `evidence-path.ts` exists to prevent (#549).
 *
 * See change: retro-ux-identity-connectivity (test-plan #E1–#E4).
 * See change: fix-slot-pill-legend-and-stale-overflow (test-plan #E11–#E13).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contrastFailures, type OverflowItem, overflowOf, type Rect, sizeFailures, type TextMeasure } from "../computed-contrast.js";
import { captureStates, RETRO_UX_THEMES, RETRO_UX_WIDTHS, type UiState } from "../ui-capture.js";

const CHANGE = "retro-ux-identity-connectivity";
const SURFACE = "users";

let root: string;
let prevFlag: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ui-capture-"));
  prevFlag = process.env.RETRO_UX_CAPTURE;
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.RETRO_UX_CAPTURE;
  else process.env.RETRO_UX_CAPTURE = prevFlag;
  rmSync(root, { recursive: true, force: true });
});

function changeDir(rel: string): string {
  const dir = join(root, "openspec", "changes", rel);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A page that records navigation + screenshots; every Playwright call the helper makes is a no-op. */
function fakePage() {
  const log = { goto: 0, screenshots: [] as string[] };
  const emptyLocator = {
    evaluate: async () => [],
    locator: () => ({ all: async () => [] }),
  };
  const page = {
    log,
    goto: async () => {
      log.goto++;
    },
    reload: async () => {},
    evaluate: async () => undefined,
    waitForFunction: async () => undefined,
    setViewportSize: async () => {},
    unrouteAll: async () => {},
    screenshot: async (o: { path: string }) => {
      log.screenshots.push(o.path);
    },
    emptyLocator,
  };
  return page;
}

function fixtureState(id: string, over: Partial<UiState> = {}): UiState {
  return {
    id,
    label: id,
    stubs: ["/api/users"],
    install: async () => {},
    open: async () => {},
    root: (page) => (page as unknown as ReturnType<typeof fakePage>).emptyLocator as never,
    ...over,
  };
}

const run = (page: ReturnType<typeof fakePage>, states: UiState[], extra: Record<string, unknown> = {}) =>
  captureStates(page as never, { change: CHANGE, surface: SURFACE, states, repoRoot: root, ...extra });

describe("matrix and paths (E1)", () => {
  it("writes exactly states × themes × widths PNG paths under the active change dir", async () => {
    const dir = changeDir(CHANGE);
    process.env.RETRO_UX_CAPTURE = "1";
    const page = fakePage();

    const results = await run(page, [fixtureState("list"), fixtureState("empty")]);

    expect(RETRO_UX_THEMES.map((t) => `${t.theme}-${t.mode}`)).toEqual(["base-dark", "base-light", "nord-dark"]);
    expect(RETRO_UX_WIDTHS).toEqual([375, 768, 1440]);
    expect(page.log.screenshots).toHaveLength(18);
    expect(results).toHaveLength(18);
    for (const abs of page.log.screenshots) {
      const rel = relative(dir, abs);
      expect(rel).toMatch(/^mockups\/after\/users\/(list|empty)--(base-dark|base-light|nord-dark)--(375|768|1440)\.png$/);
    }
    expect(new Set(page.log.screenshots).size).toBe(18);
  });

  it("reports one result per cell with empty probe lists on a clean fake", async () => {
    changeDir(CHANGE);
    const [first] = await run(fakePage(), [fixtureState("list")]);
    expect(first).toMatchObject({ state: "list", theme: "base", mode: "dark", width: 375, contrast: [], size: [], focus: [] });
  });
});

describe("only filter (E2)", () => {
  it("captures only the named state", async () => {
    changeDir(CHANGE);
    process.env.RETRO_UX_CAPTURE = "1";
    const page = fakePage();
    await run(page, [fixtureState("list"), fixtureState("empty")], { only: ["empty"] });
    expect(page.log.screenshots).toHaveLength(9);
    expect(page.log.screenshots.every((p) => p.includes("/empty--"))).toBe(true);
  });

  it("throws naming the surface and the unknown id before any goto", async () => {
    changeDir(CHANGE);
    const page = fakePage();
    await expect(run(page, [fixtureState("list"), fixtureState("empty")], { only: ["nope"] })).rejects.toThrow(
      /users.*nope|nope.*users/,
    );
    expect(page.log.goto).toBe(0);
  });
});

describe("archived / missing change dir (E3)", () => {
  it("archived + flag on → throws, nothing written", async () => {
    changeDir(`archive/2026-10-12-${CHANGE}`);
    process.env.RETRO_UX_CAPTURE = "1";
    const page = fakePage();
    await expect(run(page, [fixtureState("list")])).rejects.toThrow(/archive/i);
    expect(page.log.screenshots).toEqual([]);
  });

  it("missing + flag on → throws, nothing written", async () => {
    process.env.RETRO_UX_CAPTURE = "1";
    const page = fakePage();
    await expect(run(page, [fixtureState("list")])).rejects.toThrow();
    expect(page.log.screenshots).toEqual([]);
  });

  it("active + flag on → writes", async () => {
    changeDir(CHANGE);
    process.env.RETRO_UX_CAPTURE = "1";
    const page = fakePage();
    await run(page, [fixtureState("list")]);
    expect(page.log.screenshots).toHaveLength(9);
  });

  it.each(["active", "archived", "missing"])("flag off + %s → zero screenshots and no mockups dir", async (kind) => {
    delete process.env.RETRO_UX_CAPTURE;
    let dir: string | null = null;
    if (kind === "active") dir = changeDir(CHANGE);
    if (kind === "archived") dir = changeDir(`archive/2026-10-12-${CHANGE}`);
    const page = fakePage();
    await run(page, [fixtureState("list")]);
    expect(page.log.screenshots).toEqual([]);
    if (dir) expect(existsSync(join(dir, "mockups"))).toBe(false);
  });
});

describe("stub declaration (E4)", () => {
  it("throws before navigation when a state declares no stubbed endpoint", async () => {
    changeDir(CHANGE);
    const page = fakePage();
    await expect(run(page, [fixtureState("list"), fixtureState("bare", { stubs: [] })])).rejects.toThrow(
      /state bare declares no stubbed endpoint/,
    );
    expect(page.log.goto).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fix-slot-pill-legend-and-stale-overflow — overflow probe + sr-only floors.
// ---------------------------------------------------------------------------

const ROOT: Rect = { left: 0, top: 0, right: 150, bottom: 40 };
const item = (rect: Partial<Rect>, over: Partial<OverflowItem> = {}): OverflowItem => ({
  where: "div",
  rect: { left: 10, top: 10, right: 100, bottom: 30, ...rect },
  clips: [],
  topExempt: false,
  ...over,
});

describe("overflowOf (E11)", () => {
  it("(a) inside → []", () => expect(overflowOf(ROOT, [item({})])).toEqual([]));
  it("(b) right +0.4 px is sub-pixel slack → []", () => expect(overflowOf(ROOT, [item({ right: 150.4 })])).toEqual([]));
  it("(c) right +0.6 px → one entry", () => expect(overflowOf(ROOT, [item({ right: 150.6 })])).toEqual(["div right +0.6px"]));
  it("(d) bottom +2 px → bottom entry", () => expect(overflowOf(ROOT, [item({ bottom: 42 })])).toEqual(["div bottom +2.0px"]));
  it("(e) top −7 px with topExempt → []", () => expect(overflowOf(ROOT, [item({ top: -7 }, { topExempt: true })])).toEqual([]));
  it("(f) top −7 px without topExempt → top entry", () => expect(overflowOf(ROOT, [item({ top: -7 })])).toEqual(["div top +7.0px"]));
  it("(g) right +5 px but clipped to a root-sized rect → []", () =>
    expect(overflowOf(ROOT, [item({ right: 155 }, { clips: [{ ...ROOT }] })])).toEqual([]));
  it("(h) clip disjoint from the rect → fully clipped, skipped", () =>
    expect(overflowOf(ROOT, [item({ right: 400, left: 300 }, { clips: [{ left: 0, top: 0, right: 50, bottom: 40 }] })])).toEqual([]));
  it("(i) topExempt does not hide the right edge → exactly one entry naming right", () => {
    const out = overflowOf(ROOT, [item({ top: -7, right: 153 }, { topExempt: true })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("right");
  });
});

describe("sr-only excluded from visual floors (E12)", () => {
  const ms = (srOnly: boolean): TextMeasure[] => [
    { text: "3 stale", ratio: 1.2, need: 4.5, fontSize: 10, interactive: false, bg: [0, 0, 0], where: "span", srOnly },
    { text: "ok", ratio: 7, need: 4.5, fontSize: 12, interactive: false, bg: [0, 0, 0], where: "span", srOnly: false },
  ];
  it("srOnly measure fails neither floor", () => {
    expect(contrastFailures(ms(true))).toEqual([]);
    expect(sizeFailures(ms(true))).toEqual([]);
  });
  it("the same measure without srOnly fails both", () => {
    expect(contrastFailures(ms(false))).toHaveLength(1);
    expect(sizeFailures(ms(false))).toHaveLength(1);
  });
});

describe("CaptureResult carries overflow (E13)", () => {
  it("rows carry the overflow list when the state declares overflowRoot, [] and zero probes otherwise", async () => {
    changeDir(CHANGE);
    let evaluateCalls = 0;
    const overflowLocator = {
      evaluate: async () => {
        evaluateCalls++;
        // overflowFailures feeds the page-collected box + items to overflowOf.
        return { box: ROOT, items: [item({ right: 152 })] };
      },
    };
    const page = fakePage();
    const withRoot = await run(page, [fixtureState("with", { overflowRoot: () => overflowLocator as never })]);
    expect(withRoot.every((r) => r.overflow.length === 1 && r.overflow[0] === "div right +2.0px")).toBe(true);
    expect(evaluateCalls).toBe(withRoot.length);

    evaluateCalls = 0;
    const without = await run(fakePage(), [fixtureState("without")]);
    expect(without.every((r) => r.overflow.length === 0)).toBe(true);
    expect(evaluateCalls).toBe(0);
  });
});
