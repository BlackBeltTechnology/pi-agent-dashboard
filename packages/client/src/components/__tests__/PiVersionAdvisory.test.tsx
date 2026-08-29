/**
 * Render states for PiVersionAdvisory (hidden / soft / hard), plus the
 * additive `Change…` affordance. Drives the component via the
 * `compatibility` prop — the hook poll moved up to the host panel, so the
 * old `vi.mock` of `usePiCompatibility` is gone.
 * See change: restore-pi-version-skew-surface, surface-pi-runtime-on-general.
 * test-plan #E10, #E11.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PiCompatibility } from "../../hooks/usePiCompatibility.js";
import { PiVersionAdvisory } from "../packages/PiVersionAdvisory.js";

const RANGE = { minimum: "0.78.0", recommended: "0.80.0", maximum: null } as const;

afterEach(() => cleanup());

describe("PiVersionAdvisory", () => {
	it("renders nothing when compatibility is null", () => {
		const { container } = render(<PiVersionAdvisory compatibility={null} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when pi matches recommended (no flags)", () => {
		const { container } = render(
			<PiVersionAdvisory compatibility={{ ...RANGE, current: "0.80.0" }} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders an amber soft pill when upgradeRecommended", () => {
		render(
			<PiVersionAdvisory compatibility={{ ...RANGE, current: "0.79.0", upgradeRecommended: true }} />,
		);
		const el = screen.getByRole("status");
		expect(el.textContent).toContain("0.79.0");
		expect(el.textContent).toContain("0.80.0");
	});

	it("renders a red advisory with upgrade command when error is set", () => {
		render(
			<PiVersionAdvisory
				compatibility={{ ...RANGE, current: "0.10.0", upgradeRecommended: true, error: "pi 0.10.0 is below minimum 0.78.0" }}
			/>,
		);
		const el = screen.getByRole("alert");
		expect(el.textContent).toContain("below minimum");
		expect(el.textContent).toContain("npm install -g @earendil-works/pi-coding-agent@0.80.0");
	});

	// #E10 — decision table: the affordance renders in BOTH alert states and
	// activates the injected callback.
	it("offers the Change… affordance in the soft warning state, invoking onChangeRuntime", () => {
		const onChangeRuntime = vi.fn();
		render(
			<PiVersionAdvisory
				compatibility={{ ...RANGE, current: "0.79.0", upgradeRecommended: true }}
				onChangeRuntime={onChangeRuntime}
			/>,
		);
		const btn = screen.getByTestId("pi-advisory-change");
		fireEvent.click(btn);
		expect(onChangeRuntime).toHaveBeenCalledTimes(1);
	});

	it("offers the Change… affordance in the hard advisory state, invoking onChangeRuntime", () => {
		const onChangeRuntime = vi.fn();
		render(
			<PiVersionAdvisory
				compatibility={{ ...RANGE, current: "0.10.0", upgradeRecommended: true, error: "pi 0.10.0 is below minimum 0.78.0" }}
				onChangeRuntime={onChangeRuntime}
			/>,
		);
		const btn = screen.getByTestId("pi-advisory-change");
		fireEvent.click(btn);
		expect(onChangeRuntime).toHaveBeenCalledTimes(1);
	});

	// #E11 — state transition: with the prop absent the advisory renders
	// exactly as before the change (no affordance, no crash) in both alert
	// states.
	it("renders unchanged — no affordance — when onChangeRuntime is absent (soft)", () => {
		render(
			<PiVersionAdvisory compatibility={{ ...RANGE, current: "0.79.0", upgradeRecommended: true }} />,
		);
		expect(screen.getByRole("status").textContent).toContain("0.79.0");
		expect(screen.queryByTestId("pi-advisory-change")).toBeNull();
	});

	it("renders unchanged — no affordance — when onChangeRuntime is absent (hard)", () => {
		render(
			<PiVersionAdvisory
				compatibility={{ ...RANGE, current: "0.10.0", upgradeRecommended: true, error: "pi 0.10.0 is below minimum 0.78.0" }}
			/>,
		);
		expect(screen.getByRole("alert").textContent).toContain("below minimum");
		expect(screen.queryByTestId("pi-advisory-change")).toBeNull();
	});
});
