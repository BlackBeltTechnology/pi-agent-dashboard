import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { PackageRow } from "../packages/PackageRow.js";

afterEach(() => cleanup());

describe("PackageRow", () => {
	it("renders display name and source caption", () => {
		render(
			<PackageRow
				displayName="pi-flows"
				source="https://github.com/x/pi-flows.git"
				sourceType="git"
			/>,
		);
		expect(screen.getByText("pi-flows")).toBeTruthy();
		expect(screen.getByText("https://github.com/x/pi-flows.git")).toBeTruthy();
	});

	it("renders the source-type badge", () => {
		render(
			<PackageRow displayName="x" source="npm:x" sourceType="npm" />,
		);
		expect(screen.getByText("npm")).toBeTruthy();
	});

	it("renders the bundled badge when isBundled=true", () => {
		render(
			<PackageRow
				displayName="x"
				source="https://github.com/x/x.git"
				sourceType="git"
				isBundled
			/>,
		);
		expect(screen.getByText("bundled")).toBeTruthy();
	});

	it("shows current → latest when updateAvailable", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				currentVersion="0.4.0"
				latestVersion="0.4.1"
				updateAvailable
				onUpdate={() => {}}
			/>,
		);
		expect(screen.getByText("0.4.0")).toBeTruthy();
		expect(screen.getByText("0.4.1")).toBeTruthy();
		expect(screen.getByText("Update")).toBeTruthy();
	});

	it("shows version-only when up to date", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				currentVersion="1.0.0"
				updateAvailable={false}
			/>,
		);
		expect(screen.getByText("1.0.0")).toBeTruthy();
		expect(screen.queryByText("Update")).toBeNull();
	});

	it("hides Update button when canUpdate=false even if updateAvailable", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				currentVersion="0.4.0"
				latestVersion="0.4.1"
				updateAvailable
				canUpdate={false}
				onUpdate={() => {}}
			/>,
		);
		expect(screen.queryByText("Update")).toBeNull();
	});

	it("shows kebab menu only when at least one menu action is wired", () => {
		const { container } = render(
			<PackageRow displayName="x" source="npm:x" sourceType="npm" />,
		);
		expect(container.querySelector("[title='More actions']")).toBeNull();
	});

	it("shows kebab menu and Uninstall when canUninstall=true", () => {
		const onUninstall = vi.fn();
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				canUninstall
				onUninstall={onUninstall}
				testId="row"
			/>,
		);
		const menuBtn = screen.getByTestId("row-menu");
		fireEvent.click(menuBtn);
		const uninstall = screen.getByText("Uninstall");
		fireEvent.click(uninstall);
		expect(onUninstall).toHaveBeenCalledOnce();
	});

	it("hides Uninstall in menu when canUninstall=false (Core)", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				canUninstall={false}
				onViewReadme={() => {}}
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		expect(screen.queryByText("Uninstall")).toBeNull();
		expect(screen.getByText("View README")).toBeTruthy();
	});

	it("renders busy state with disabled Update button and inline progress text", () => {
		render(
			<PackageRow
				displayName="pi (core agent)"
				source="@mariozechner/pi-coding-agent"
				sourceType="global"
				currentVersion="0.70.5"
				latestVersion="0.70.6"
				updateAvailable
				canUpdate
				busy
				progress="npm http GET https://registry.npmjs.org/..."
				onUpdate={() => {}}
				testId="pi-core-row"
			/>,
		);
		const updateBtn = screen.getByTestId("pi-core-row-update") as HTMLButtonElement;
		expect(updateBtn.disabled).toBe(true);
		expect(screen.getByText("npm http GET https://registry.npmjs.org/...")).toBeTruthy();
	});

	it("renders error message when error prop set", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				error="something blew up"
			/>,
		);
		expect(screen.getByText("something blew up")).toBeTruthy();
	});

	// ── Move affordance (change: unify-package-management-ui) ───────────────────

	it("renders Move → Local in the menu when currentScope=global", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				onMove={() => {}}
				currentScope="global"
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		expect(screen.getByText("Move → Local")).toBeTruthy();
	});

	it("renders Move → Global in the menu when currentScope=local", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				onMove={() => {}}
				currentScope="local"
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		expect(screen.getByText("Move → Global")).toBeTruthy();
	});

	it("hides Move when onMove not provided", () => {
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				canUninstall
				onUninstall={() => {}}
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		expect(screen.queryByText(/Move →/)).toBeNull();
	});

	it("fires onMove when the Move menu item is clicked", () => {
		const onMove = vi.fn();
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				onMove={onMove}
				currentScope="global"
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		fireEvent.click(screen.getByText("Move → Local"));
		expect(onMove).toHaveBeenCalledOnce();
	});

	it("disables Move when moveDisabledReason is set; tooltip carries the reason", () => {
		const onMove = vi.fn();
		render(
			<PackageRow
				displayName="x"
				source="npm:x"
				sourceType="npm"
				onMove={onMove}
				currentScope="global"
				moveDisabledReason="Already installed in local scope"
				testId="row"
			/>,
		);
		fireEvent.click(screen.getByTestId("row-menu"));
		const moveBtn = screen.getByTestId("row-move") as HTMLButtonElement;
		expect(moveBtn.disabled).toBe(true);
		expect(moveBtn.getAttribute("title")).toBe("Already installed in local scope");
		fireEvent.click(moveBtn);
		expect(onMove).not.toHaveBeenCalled();
	});
});
