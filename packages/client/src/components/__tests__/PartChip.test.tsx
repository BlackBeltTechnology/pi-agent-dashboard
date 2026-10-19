/**
 * Part labels expose plain-language accessible descriptions that match the
 * explainer. See change: addons-hub-declutter (test-plan F2).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PART_KINDS, PartChip, partDescription, partLabel } from "../packages/PartChip.js";

afterEach(() => cleanup());

const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") as string)?.textContent;

describe("PartChip", () => {
	it("F2: each part label exposes its plain-language definition", () => {
		render(
			<>
				{PART_KINDS.map((k) => (
					<PartChip key={k} kind={k} />
				))}
			</>,
		);
		for (const kind of PART_KINDS) {
			const chip = screen.getByTestId(`part-chip-${kind}`);
			expect(chip.textContent).toBe(partLabel(kind));
			expect(describedBy(chip)).toBe(partDescription(kind));
			expect(chip.getAttribute("title")).toBe(partDescription(kind));
		}
		expect(describedBy(screen.getByTestId("part-chip-extension"))).toMatch(/runs inside pi in every session/i);
		expect(describedBy(screen.getByTestId("part-chip-dashboard-ui"))).toMatch(/no effect in terminal pi/i);
		expect(describedBy(screen.getByTestId("part-chip-bridge"))).toMatch(/dashboard plugin can talk to the AI agent/i);
	});

	// See change: addons-hub-feature-catalog (test-plan #E28)
	it("E28: legend lists the six labels and no tools", () => {
		expect(PART_KINDS.map((k) => partLabel(k))).toEqual(["dashboard UI", "extension", "bridge", "skills", "prompts", "themes"]);
		expect(PART_KINDS as readonly string[]).not.toContain("tools");
	});

	it("custom text keeps the part's definition", () => {
		render(<PartChip kind="skills" testId="c">skill: review</PartChip>);
		expect(screen.getByTestId("c").textContent).toBe("skill: review");
		expect(describedBy(screen.getByTestId("c"))).toBe(partDescription("skills"));
	});
});
