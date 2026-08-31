/**
 * StatusBadge states on ToolsSection rows (tasks 3a.10–3a.14, incl. the
 * absorbed X1/X2 edge cases). Exemplar: PiRuntimeStatusRow.test.tsx
 * (testing-library, prop-driven render).
 *
 * The three collapsed-row states MUST be mutually distinguishable:
 *   ok | not-found | override-rejected — plus the existing
 *   ok-with-rejected-override (fallback) state, which is unchanged.
 *
 * See change: add-node-runtime-family-selection (section 3a, absorbed
 * from fix-node-family-resolution-gaps).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToolRow } from "../ToolsSection.js";
import type { ToolListEntry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

afterEach(() => cleanup());

function tool(over: Partial<ToolListEntry> = {}): ToolListEntry {
	return {
		name: "node",
		ok: true,
		path: "/usr/bin/node",
		source: "system",
		tried: [],
		resolvedAt: 0,
		...over,
	};
}

function renderRow(t: ToolListEntry) {
	return render(
		<ToolRow
			tool={t}
			hostOs="linux"
			autoOpenInstall={false}
			onAutoOpenConsumed={() => {}}
			busy={false}
			onRescan={() => {}}
			onSetOverride={() => {}}
			onClearOverride={() => {}}
		/>,
	);
}

function badge() {
	return screen.getByTestId("tool-status-badge");
}

describe("StatusBadge states (collapsed row)", () => {
	it("3a.10 a rejected override on a not-found row renders a THIRD state whose tooltip names the rejected path", () => {
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [
					{
						strategy: "override",
						result: "invalid: path does not exist: /nope/bin/node",
					},
					{ strategy: "managed", result: "missing: /home/u/.pi-dashboard/node/bin/node" },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
		);
		const b = badge();
		// Distinct from BOTH the plain not-found state and the fallback state.
		expect(b.dataset.state).toBe("override-rejected");
		// Tooltip names the rejected path.
		expect(b.getAttribute("title")).toContain("/nope/bin/node");
		// Must NOT claim a fallback occurred.
		expect(b.getAttribute("title")).not.toContain("fallback");
	});

	it("3a.11 a not-found row WITHOUT an override is unchanged (plain not-found state)", () => {
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [
					{ strategy: "override", result: "no override set" },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
		);
		expect(badge().dataset.state).toBe("not-found");
		expect(badge().getAttribute("title") ?? "").not.toContain("verride");
	});

	it("3a.12 a resolved + rejected row keeps the existing fallback indicator", () => {
		renderRow(
			tool({
				ok: true,
				source: "system",
				tried: [
					{
						strategy: "override",
						result: "invalid: path does not exist: /old/node",
					},
				],
			}),
		);
		expect(badge().dataset.state).toBe("fallback");
		expect(badge().getAttribute("title") ?? "").toContain("fallback");
	});

	it("3a.13 wording distinguishes fell-back from did-not-resolve", () => {
		// (a) did-not-resolve: tooltip must NOT assert a fallback occurred.
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [
					{ strategy: "override", result: "invalid: path does not exist: /gone" },
				],
			}),
		);
		const rejected = badge();
		expect(rejected.dataset.state).toBe("override-rejected");
		const rejectedTitle = rejected.getAttribute("title") ?? "";
		expect(rejectedTitle.toLowerCase()).not.toContain("fallback");
		cleanup();
		// (b) resolved via a later strategy: retains the fallback phrasing.
		renderRow(
			tool({
				ok: true,
				source: "system",
				tried: [
					{ strategy: "override", result: "invalid: validator said no" },
				],
			}),
		);
		expect((badge().getAttribute("title") ?? "").toLowerCase()).toContain("fallback");
	});

	it("3a.14 an unparseable rejection reason still indicates; tooltip degrades to the reason text", () => {
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [
					{ strategy: "override", result: "invalid: validator said no" },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
		);
		const b = badge();
		expect(b.dataset.state).toBe("override-rejected");
		const title = b.getAttribute("title") ?? "";
		expect(title).toContain("validator said no");
		// No empty/undefined/null path rendered.
		expect(title).not.toMatch(/undefined|null|\{\}/);
	});

	it("3a.X1 a trail-less payload (older server) degrades to the plain not-found state without throwing", () => {
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [],
			}),
		);
		expect(badge().dataset.state).toBe("not-found");
	});

	it("3a.X2 a rejected path with a space and non-ASCII renders intact in the tooltip", () => {
		const weird = "/home/t/ünïcode dir/bin/node";
		renderRow(
			tool({
				ok: false,
				path: null,
				source: null,
				tried: [
					{
						strategy: "override",
						result: `invalid: path does not exist: ${weird}`,
					},
				],
			}),
		);
		expect((badge().getAttribute("title") ?? "")).toContain(weird);
	});
});
