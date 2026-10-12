/**
 * PackageRow — reset-to-published affordances.
 *
 * A local/git row with `publishedVariantSource` renders ONE source line and a
 * source badge whose accessible description names the published target and
 * (when known) version. Reset lives only in the ⋮ menu ("Reset to published
 * version (<version>)", no brackets when the version is unknown); there is no
 * inline "Reset to npm" link. Clicking reset opens a confirm dialog naming the
 * discarded link + exact published target; the action fires only after
 * confirm, and the item is disabled while `locked`.
 *
 * See change: reset-override-to-npm, addons-hub-declutter (test-plan E14, E15).
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

const sourceLines = (el: HTMLElement) => el.querySelectorAll("code").length;

describe("PackageRow reset-to-published", () => {
	it("E14: renders one source line and a badge describing target + version", () => {
		const { getByTestId, container } = render(<PackageRow {...OVERRIDE} onResetToNpm={vi.fn()} />);
		expect(sourceLines(container)).toBe(1);
		expect(container.querySelector("[data-testid='row-published-variant']")).toBeNull();
		const badge = getByTestId("row-source-badge");
		expect(badge.textContent).toBe("local");
		const described = document.getElementById(badge.getAttribute("aria-describedby") as string);
		expect(described?.textContent).toContain("npm:pi-web-access");
		expect(described?.textContent).toContain("0.5.0");
	});

	it("E14: omits the version from the description and menu label when unknown", () => {
		const { getByTestId } = render(
			<PackageRow {...OVERRIDE} publishedVariantVersion={undefined} onResetToNpm={vi.fn()} />,
		);
		const badge = getByTestId("row-source-badge");
		const desc = document.getElementById(badge.getAttribute("aria-describedby") as string)?.textContent ?? "";
		expect(desc).toContain("npm:pi-web-access");
		expect(desc).not.toMatch(/undefined|\(\)|\[\]/);
		fireEvent.click(getByTestId("row-menu"));
		expect(getByTestId("row-reset-to-published").textContent).toBe("Reset to published version");
	});

	it("E14: the ⋮ menu label carries the version and there is no inline reset link", () => {
		const { getByTestId, queryByTestId } = render(<PackageRow {...OVERRIDE} onResetToNpm={vi.fn()} />);
		expect(queryByTestId("row-reset-inline")).toBeNull();
		fireEvent.click(getByTestId("row-menu"));
		expect(getByTestId("row-reset-to-published").textContent).toBe("Reset to published version (0.5.0)");
	});

	it("selecting reset opens a confirm dialog; the action fires only after confirm", () => {
		const onResetToNpm = vi.fn();
		const onReset = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<PackageRow {...OVERRIDE} onResetToNpm={onResetToNpm} onReset={onReset} canUninstall onUninstall={vi.fn()} />,
		);
		fireEvent.click(getByTestId("row-menu"));
		fireEvent.click(getByTestId("row-reset-to-published"));
		expect(onResetToNpm).not.toHaveBeenCalled();
		const dialog = getByTestId("row-reset-confirm");
		expect(dialog.textContent).toContain("/home/dev/pi-web-access");
		expect(dialog.textContent).toContain("npm:pi-web-access");
		fireEvent.click(getByTestId("row-reset-confirm-accept"));
		expect(onResetToNpm).toHaveBeenCalledTimes(1);
		expect(onReset).not.toHaveBeenCalled();
		expect(queryByTestId("row-reset-confirm")).toBeNull();
	});

	it("cancelling the confirm dialog does not fire the action", () => {
		const onResetToNpm = vi.fn();
		const { getByTestId, queryByTestId } = render(<PackageRow {...OVERRIDE} onResetToNpm={onResetToNpm} />);
		fireEvent.click(getByTestId("row-menu"));
		fireEvent.click(getByTestId("row-reset-to-published"));
		fireEvent.click(getByTestId("row-reset-confirm-cancel"));
		expect(onResetToNpm).not.toHaveBeenCalled();
		expect(queryByTestId("row-reset-confirm")).toBeNull();
	});

	it("E15: the menu item is disabled with the locked reason while another operation runs", () => {
		const onResetToNpm = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<PackageRow {...OVERRIDE} locked lockedReason="Unavailable while busy" onResetToNpm={onResetToNpm} />,
		);
		fireEvent.click(getByTestId("row-menu"));
		const item = getByTestId("row-reset-to-published") as HTMLButtonElement;
		expect(item.disabled).toBe(true);
		expect(item.getAttribute("title")).toBe("Unavailable while busy");
		fireEvent.click(item);
		expect(queryByTestId("row-reset-confirm")).toBeNull();
		expect(onResetToNpm).not.toHaveBeenCalled();
	});

	it("a row without publishedVariantSource renders one source line, no description and no reset", () => {
		const { queryByTestId, getByTestId, container } = render(
			<PackageRow displayName="pi-web-access" source="/home/dev/pi-web-access" sourceType="local" isOverride testId="row" />,
		);
		expect(sourceLines(container)).toBe(1);
		expect(getByTestId("row-source-badge").getAttribute("aria-describedby")).toBeNull();
		expect(queryByTestId("row-menu")).toBeNull();
	});

	it("E14: plain npm rows have neither the badge description nor a reset action", () => {
		const { queryByTestId, getByTestId } = render(
			<PackageRow displayName="pi-doom" source="npm:pi-doom" sourceType="npm" testId="row" />,
		);
		expect(getByTestId("row-source-badge").getAttribute("aria-describedby")).toBeNull();
		expect(queryByTestId("row-reset-to-published")).toBeNull();
		expect(queryByTestId("row-reset-inline")).toBeNull();
	});
});
