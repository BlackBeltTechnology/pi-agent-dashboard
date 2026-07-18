/**
 * PackageRow — reset-to-npm affordances.
 *
 * A row with `publishedVariantSource` renders TWO source lines (installed
 * path + published link with available version) and an inline "Reset to npm";
 * the ⋮ menu shows "Reset to published version". A row without it renders one
 * source line and no reset. Plain npm rows are unchanged. Clicking reset opens
 * a confirm dialog naming the discarded link + exact published target; the
 * action fires only after confirm.
 *
 * See change: reset-override-to-npm.
 */

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackageRow } from "../components/packages/PackageRow.js";

afterEach(() => cleanup());

const OVERRIDE = {
	displayName: "pi-web-access",
	source: "/home/dev/pi-web-access",
	sourceType: "local" as const,
	isOverride: true,
	publishedVariantSource: "npm:pi-web-access",
	publishedVariantVersion: "0.5.0",
	testId: "row",
};

describe("PackageRow reset-to-npm", () => {
	it("renders a second source line with the published link + available version", () => {
		const { getByTestId } = render(<PackageRow {...OVERRIDE} onResetToNpm={vi.fn()} />);
		const published = getByTestId("row-published-variant");
		expect(published.textContent).toContain("npm:pi-web-access");
		expect(published.textContent).toContain("0.5.0");
	});

	it("inline Reset to npm opens a confirm dialog; action fires only after confirm", () => {
		const onResetToNpm = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<PackageRow {...OVERRIDE} onResetToNpm={onResetToNpm} />,
		);
		fireEvent.click(getByTestId("row-reset-inline"));
		// Not yet fired — confirm dialog is open.
		expect(onResetToNpm).not.toHaveBeenCalled();
		const dialog = getByTestId("row-reset-confirm");
		expect(dialog.textContent).toContain("/home/dev/pi-web-access");
		expect(dialog.textContent).toContain("npm:pi-web-access");
		fireEvent.click(getByTestId("row-reset-confirm-accept"));
		expect(onResetToNpm).toHaveBeenCalledTimes(1);
		expect(queryByTestId("row-reset-confirm")).toBeNull();
	});

	it("cancelling the confirm dialog does not fire the action", () => {
		const onResetToNpm = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<PackageRow {...OVERRIDE} onResetToNpm={onResetToNpm} />,
		);
		fireEvent.click(getByTestId("row-reset-inline"));
		fireEvent.click(getByTestId("row-reset-confirm-cancel"));
		expect(onResetToNpm).not.toHaveBeenCalled();
		expect(queryByTestId("row-reset-confirm")).toBeNull();
	});

	it("the ⋮ menu exposes 'Reset to published version' distinct from generic Reset", () => {
		const onResetToNpm = vi.fn();
		const onReset = vi.fn();
		const { getByTestId } = render(
			<PackageRow {...OVERRIDE} onResetToNpm={onResetToNpm} onReset={onReset} canUninstall onUninstall={vi.fn()} />,
		);
		fireEvent.click(getByTestId("row-menu"));
		const resetToPublished = getByTestId("row-reset-to-published");
		expect(resetToPublished).toBeTruthy();
		fireEvent.click(resetToPublished);
		// Opens confirm; underlying action not yet run.
		expect(onResetToNpm).not.toHaveBeenCalled();
		fireEvent.click(getByTestId("row-reset-confirm-accept"));
		expect(onResetToNpm).toHaveBeenCalledTimes(1);
		expect(onReset).not.toHaveBeenCalled();
	});

	it("a row without publishedVariantSource renders one source line and no reset", () => {
		const { queryByTestId } = render(
			<PackageRow
				displayName="pi-web-access"
				source="/home/dev/pi-web-access"
				sourceType="local"
				isOverride
				testId="row"
			/>,
		);
		expect(queryByTestId("row-published-variant")).toBeNull();
		expect(queryByTestId("row-reset-inline")).toBeNull();
	});

	it("plain npm rows render no published-variant line and no reset", () => {
		const { queryByTestId } = render(
			<PackageRow displayName="pi-doom" source="npm:pi-doom" sourceType="npm" testId="row" />,
		);
		expect(queryByTestId("row-published-variant")).toBeNull();
		expect(queryByTestId("row-reset-inline")).toBeNull();
	});
});
