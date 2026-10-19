/**
 * Data-driven worked example. See change: addons-hub-feature-catalog (test-plan #E27).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AddonsExplainer } from "../packages/AddonsExplainer.js";
import { feature, goalFeature } from "./addons-feature-fixtures.js";

afterEach(() => cleanup());

const example = () => screen.getByTestId("addons-explainer-body").textContent ?? "";
const mount = (features: Parameters<typeof AddonsExplainer>[0]["features"]) =>
	render(<AddonsExplainer features={features} expanded onToggle={() => {}} toggleRef={createRef()} />);

describe("AddonsExplainer example", () => {
	it("E27: names the first installed feature with both parts and its extension", () => {
		mount([feature("pkg:npm:x"), goalFeature()]);
		const text = example();
		expect(text).toContain("Example: Goal");
		expect(text).toContain("@ricoyudog/pi-goal-hermes");
		expect(screen.getByTestId("addons-example-body").textContent).toContain("goal");
	});

	it("E27: falls back to a recommended entry and its linked dashboard plugin when none is installed", () => {
		mount([feature("pkg:npm:x")]);
		const text = example();
		expect(text).toMatch(/Example: .+/);
		expect(screen.getByTestId("addons-example-body").textContent).toMatch(/the extension .+ and the dashboard plugin .+/);
	});

	it("legend lists the six part labels and no tools", () => {
		mount([]);
		const legend = screen.getByTestId("addons-legend").textContent ?? "";
		for (const label of ["dashboard UI", "extension", "bridge", "skills", "prompts", "themes"]) expect(legend).toContain(label);
		expect(legend).not.toContain("tools");
	});
});
