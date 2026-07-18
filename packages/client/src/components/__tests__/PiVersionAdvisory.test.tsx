/**
 * Render states for PiVersionAdvisory (hidden / soft / hard).
 * Drives the component by mocking the usePiCompatibility hook.
 * See change: restore-pi-version-skew-surface.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PiCompatibility } from "../../hooks/usePiCompatibility.js";

const { mockHook } = vi.hoisted(() => ({ mockHook: vi.fn<() => PiCompatibility | null>() }));
vi.mock("../../hooks/usePiCompatibility.js", () => ({ usePiCompatibility: mockHook }));

import { PiVersionAdvisory } from "../packages/PiVersionAdvisory.js";

const RANGE = { minimum: "0.78.0", recommended: "0.80.0", maximum: null } as const;

afterEach(() => { cleanup(); mockHook.mockReset(); });

describe("PiVersionAdvisory", () => {
  it("renders nothing when compatibility is null", () => {
    mockHook.mockReturnValue(null);
    const { container } = render(<PiVersionAdvisory />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when pi matches recommended (no flags)", () => {
    mockHook.mockReturnValue({ ...RANGE, current: "0.80.0" });
    const { container } = render(<PiVersionAdvisory />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an amber soft pill when upgradeRecommended", () => {
    mockHook.mockReturnValue({ ...RANGE, current: "0.79.0", upgradeRecommended: true });
    render(<PiVersionAdvisory />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("0.79.0");
    expect(el.textContent).toContain("0.80.0");
  });

  it("renders a red advisory with upgrade command when error is set", () => {
    mockHook.mockReturnValue({ ...RANGE, current: "0.10.0", upgradeRecommended: true, error: "pi 0.10.0 is below minimum 0.78.0" });
    render(<PiVersionAdvisory />);
    const el = screen.getByRole("alert");
    expect(el.textContent).toContain("below minimum");
    expect(el.textContent).toContain("npm install -g @earendil-works/pi-coding-agent@0.80.0");
  });
});
