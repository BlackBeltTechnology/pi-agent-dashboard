/**
 * Render + interaction states for PiRuntimeStatusRow (the Settings → General
 * read-only runtime summary). Prop-driven like the advisory suite — the row
 * fetches nothing (the host panel owns the single /api/health poll).
 * See change: surface-pi-runtime-on-general. test-plan #E2, #E3, #E4, #E5.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiRuntimeStatusRow } from "../PiRuntimeStatusRow.js";
import type { PiRuntimeHealth } from "../../../hooks/usePiCompatibility.js";

const runtime = (over: Partial<PiRuntimeHealth> = {}): PiRuntimeHealth => ({
	spawnVersion: "0.84.1",
	moduleVersion: "0.84.1",
	consumerDiverged: false,
	consumerMessage: null,
	...over,
});

afterEach(() => cleanup());

describe("PiRuntimeStatusRow", () => {
	// #E2 — divergence is defined on the resolved install, not version
	// equality: both versions here are EQUAL, yet the server's consumerMessage
	// must surface verbatim as a warning beside them.
	it("surfaces consumerMessage verbatim as a warning when consumers diverge", () => {
		render(
			<PiRuntimeStatusRow
				piRuntime={runtime({
					consumerDiverged: true,
					consumerMessage: "spawn and module resolve to different installs",
				})}
				onChangeRuntime={() => {}}
			/>,
		);
		const warning = screen.getByTestId("pi-runtime-status-warning");
		expect(warning.textContent).toBe("spawn and module resolve to different installs");
		// Both consumer versions still render — equal strings, both present.
		expect(screen.getByTestId("pi-runtime-status-spawn").textContent).toBe("0.84.1");
		expect(screen.getByTestId("pi-runtime-status-import").textContent).toBe("0.84.1");
	});

	// #E3 — BVA on the null boundary: each consumer's version can be
	// unresolved independently. Unknown fallback renders; nothing fabricated.
	it("renders the unknown-version fallback for a null spawnVersion", () => {
		render(<PiRuntimeStatusRow piRuntime={runtime({ spawnVersion: null })} onChangeRuntime={() => {}} />);
		expect(screen.getByTestId("pi-runtime-status-spawn").textContent).toBe("version unknown");
		expect(screen.getByTestId("pi-runtime-status-import").textContent).toBe("0.84.1");
	});

	it("renders the unknown-version fallback for a null moduleVersion", () => {
		render(<PiRuntimeStatusRow piRuntime={runtime({ moduleVersion: null })} onChangeRuntime={() => {}} />);
		expect(screen.getByTestId("pi-runtime-status-spawn").textContent).toBe("0.84.1");
		expect(screen.getByTestId("pi-runtime-status-import").textContent).toBe("version unknown");
	});

	// #E4 — fault injection: older server (field absent) or discovery failure
	// (null). Either way: no DOM, no error.
	it("renders nothing when piRuntime is null", () => {
		const { container } = render(<PiRuntimeStatusRow piRuntime={null} onChangeRuntime={() => {}} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when piRuntime is undefined", () => {
		const { container } = render(
			<PiRuntimeStatusRow piRuntime={undefined as unknown as PiRuntimeHealth | null} onChangeRuntime={() => {}} />,
		);
		expect(container.firstChild).toBeNull();
	});

	// #E5 — fault injection: the row is strictly read-only. Activate every
	// interactive element (there is exactly one: the Change… affordance) and
	// assert zero write requests left the row.
	it("issues no write requests from any interactive element", () => {
		const fetchSpy = vi.fn();
		global.fetch = fetchSpy as unknown as typeof fetch;
		const onChangeRuntime = vi.fn();
		render(
			<PiRuntimeStatusRow
				piRuntime={runtime({ consumerDiverged: true, consumerMessage: "diverged" })}
				onChangeRuntime={onChangeRuntime}
			/>,
		);

		const row = screen.getByTestId("pi-runtime-status-row");
		const interactives = row.querySelectorAll("button, a, input, select, textarea");
		expect(interactives.length).toBe(1); // only the Change… affordance
		for (const el of interactives) fireEvent.click(el);

		// No request of any kind — the row renders purely from props.
		expect(fetchSpy).not.toHaveBeenCalled();
		// …and the affordance navigates through the injected callback.
		expect(onChangeRuntime).toHaveBeenCalledTimes(1);
	});
});
