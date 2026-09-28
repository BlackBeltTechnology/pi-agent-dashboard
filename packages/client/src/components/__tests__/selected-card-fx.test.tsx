/**
 * Selected desktop SessionCard renders its iridescent FX with each glow layer
 * wrapped in a static `.card-glow-mask` (outside-only halo).
 * See change: fix-selected-card-light-wash.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

afterEach(() => cleanup());

const session: DashboardSession = {
  id: "s1",
  cwd: "/home/user/project",
  source: "tui",
  status: "active",
  startedAt: Date.now() - 60000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
};

const props = {
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: false,
  isHidden: false,
  onArchive: () => {},
};

describe("selected SessionCard FX layers", () => {
  it("wraps each glow layer in a .card-glow-mask and renders the rim", () => {
    render(<SessionCard session={session} selectedId="s1" {...props} />);
    const card = screen.getByTestId("session-card-desktop");
    expect(card.className).toContain("card-selected-ring");
    // The rim carries the selection signal; the interior keeps the neutral card
    // surface (no blue fill) on desktop.
    expect(card.className).toContain("bg-[var(--bg-primary)]");
    expect(card.className).not.toContain("bg-[var(--tint-blue-bg)]");

    const glows = card.querySelectorAll(".card-glow-fx");
    expect(glows).toHaveLength(2);
    for (const glow of glows) {
      const wrapper = glow.parentElement as HTMLElement;
      expect(wrapper.classList.contains("card-glow-mask")).toBe(true);
      expect(wrapper.parentElement).toBe(card);
      expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    }
    const outer = card.querySelector(".card-glow-fx-outer")?.parentElement;
    expect(outer?.classList.contains("card-glow-mask-outer")).toBe(true);

    const rim = card.querySelector(":scope > .card-ring-fx");
    expect(rim?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders no FX layers on an unselected card", () => {
    render(<SessionCard session={session} selectedId="other" {...props} />);
    const card = screen.getByTestId("session-card-desktop");
    expect(card.querySelector(".card-glow-mask, .card-glow-fx, .card-ring-fx")).toBeNull();
  });
});
