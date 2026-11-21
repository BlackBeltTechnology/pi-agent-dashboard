/**
 * Status colour on the SHAPE, never on the word (test-plan E4, design D2b).
 *
 * `--status-working` is `--accent-yellow`: 1.84:1 as text on the light card
 * surface. So the activity slot renders every status WORD in
 * `--text-secondary` and paints the `--status-*` token only on an
 * `aria-hidden` dot/glyph beside it. This suite renders the real
 * `SessionCard` in each activity state (incl. resuming) and asserts no text
 * node inherits a `--status-*` colour class.
 *
 * Harness glue copied from SessionCard.host-pressure.test.tsx.
 * See change: align-ui-with-theme-tokens (task 5.4).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { useMobile } from "../../../hooks/useMobile.js";
import { ActivityIndicator, SessionCard, TokenStats } from "../SessionCard.js";

vi.mock("../../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(useMobile).mockReturnValue(false);
});

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "shape-1",
    cwd: "/home/user/project",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const defaultProps = {
  selectedId: undefined,
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: false,
  isHidden: false,
  onArchive: () => {},
};

function renderMeta(session: DashboardSession): HTMLElement {
  render(
    <ThemeProvider>
      <SessionCard session={session} {...defaultProps} />
    </ThemeProvider>,
  );
  return screen.getByTestId("session-card-meta");
}

/** Class list of the nearest element ancestor (inclusive) carrying a text colour. */
function textColourClass(node: Node, stop: HTMLElement): string {
  let el: HTMLElement | null = node.parentElement;
  while (el && el !== stop.parentElement) {
    const hit = [...el.classList].find((c) => /^text-\[var\(--/.test(c));
    if (hit) return hit;
    el = el.parentElement;
  }
  return "";
}

const CASES: Array<{ name: string; session: Partial<DashboardSession>; word: string; shape: string }> = [
  { name: "resuming", session: { resuming: true }, word: "Resuming…", shape: "working" },
  { name: "streaming", session: { status: "streaming" }, word: "Thinking…", shape: "working" },
  { name: "running a tool", session: { status: "streaming", currentTool: "bash" }, word: "bash", shape: "working" },
  { name: "needs you", session: { status: "streaming", currentTool: "ask_user" }, word: "Needs you", shape: "needs-you" },
];

describe("SessionCard activity slot — status colour on shape, not text (E4)", () => {
  for (const c of CASES) {
    it(`${c.name}: word is --text-secondary, --status-* only on the aria-hidden shape`, () => {
      const meta = renderMeta(makeSession(c.session));

      // The word renders, in --text-secondary.
      const word = screen.getByText((_, el) => el?.textContent?.trim() === c.word && el.children.length <= 1 && el.tagName === "SPAN");
      expect(word.className).toContain("text-[var(--text-secondary)]");

      // A shape carries the status colour and is hidden from AT.
      const shape = meta.querySelector(`[data-status-dot="${c.shape}"]`) as HTMLElement | null;
      expect(shape).not.toBeNull();
      expect(shape!.getAttribute("aria-hidden")).toBe("true");
      expect(shape!.className).toMatch(/--status-(working|needs-you)\)/);

      // No text node in the slot inherits a --status-* colour class.
      const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
      const offenders: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const cls = textColourClass(n, meta);
        if (/--status-/.test(cls)) offenders.push(`${JSON.stringify(n.textContent)} ← ${cls}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("idle: the word is --text-secondary and no status colour touches text", () => {
    const meta = renderMeta(makeSession({ status: "idle" }));
    expect(screen.getByText("Idle").className).toContain("text-[var(--text-secondary)]");
    expect(meta.innerHTML).not.toMatch(/text-\[var\(--status-/);
  });
});

/**
 * Failed label on both render paths. See change: fix-ui-status-indicators (test-plan S3, S4).
 */
describe("SessionCard activity slot — Failed label (hasError)", () => {
  it("desktop status row shows Failed (not Idle) for an errored idle session", () => {
    render(
      <ThemeProvider>
        <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} hasError />
      </ThemeProvider>,
    );
    const meta = screen.getByTestId("session-card-meta");
    expect(meta.textContent).toContain("Failed");
    expect(meta.textContent).not.toContain("Idle");
  });

  it("mobile line 2 shows Failed + glyph (not Idle) for an errored idle session", () => {
    vi.mocked(useMobile).mockReturnValue(true);
    const { container } = render(
      <ThemeProvider>
        <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} hasError />
      </ThemeProvider>,
    );
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).not.toContain("Idle");
    expect(container.querySelector('[data-status-dot="error"]')).not.toBeNull();
  });

  it("exported ActivityIndicator renders Failed with hasError", () => {
    const { container } = render(<ActivityIndicator session={makeSession({ status: "idle" })} hasWidgetBarPrompt={false} hasError />);
    expect(container.textContent).toContain("Failed");
  });
});

/**
 * Token arrows: `↓ in` / `↑ out` (matches TokenStatsBar).
 * See change: fix-ui-status-indicators (D1; test-plan S14-S16).
 */
describe("TokenStats arrows", () => {
  const stats = (over: Partial<DashboardSession>) => render(<TokenStats session={makeSession(over)} />).container;

  it("renders input with ↓ and output with ↑", () => {
    const c = stats({ tokensIn: 12000, tokensOut: 3000 });
    expect(c.textContent).toContain("12k↓ 3k↑");
    expect(c.textContent).not.toContain("↑ 3k");
  });

  it("keeps zero formatting when only one side is nonzero; renders nothing when both are 0", () => {
    expect(stats({ tokensIn: 0, tokensOut: 500 }).textContent).toContain("0↓ 500↑");
    cleanup();
    expect(stats({ tokensIn: 0, tokensOut: 0 }).textContent).toBe("");
  });

  it("cache-read stays a separate R chip; no cache arrow", () => {
    const c = stats({ tokensIn: 1000, cacheRead: 5000 });
    expect(c.textContent).toContain("R5k");
    expect(c.textContent).toContain("1k↓");
    expect(c.textContent?.match(/[↑↓]/g)).toEqual(["↓", "↑"]);
  });
});
