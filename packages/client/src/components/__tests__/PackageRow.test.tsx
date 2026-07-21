import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { PackageRow } from "../packages/PackageRow.js";
import { PopoverBoundaryProvider } from "../../lib/state/PopoverBoundaryContext.js";

afterEach(() => cleanup());

// F10 (fix-popover-container-clip). PackageRow's `right-0` row menu is a
// `usePopoverFlip` consumer wired to `PopoverBoundaryContext`. In the running
// dashboard it renders in the wide settings Packages list (no narrow offset
// pane → viewport fallback, no clip), so the boundary-aware flip is proven here
// at the component level with mocked rects rather than in the L3 harness.
function rect(over: Partial<DOMRect>): DOMRect {
	return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...over } as DOMRect;
}

function BoundaryRow({ boundaryRect }: { boundaryRect: DOMRect }) {
	const ref = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		if (ref.current) ref.current.getBoundingClientRect = () => boundaryRect;
	});
	return (
		<div ref={ref}>
			<PopoverBoundaryProvider value={ref}>
				<PackageRow displayName="x" source="npm:x" sourceType="npm" onViewReadme={() => {}} testId="pkg" />
			</PopoverBoundaryProvider>
		</div>
	);
}

describe("PackageRow — F10 boundary-aware menu (fix-popover-container-clip)", () => {
	it("flips the row menu to left-0 when the pane's right anchor cannot fit", () => {
		render(<BoundaryRow boundaryRect={rect({ left: 500, right: 900, bottom: 1000, width: 400, height: 1000, x: 500 })} />);
		const trigger = screen.getByTestId("pkg-menu");
		// Trigger hugs the pane's LEFT edge → right-anchor (extend left) has no
		// room, left-anchor (extend right) does → the hook flips `right-0`→`left-0`.
		(trigger as HTMLElement).getBoundingClientRect = () =>
			rect({ left: 510, right: 540, top: 100, bottom: 130, width: 30, height: 30, x: 510, y: 100 });
		fireEvent.click(trigger);
		// The dropdown is the direct-child <div> of the trigger's `.relative` wrapper.
		const dropdown = trigger.parentElement!.querySelector(":scope > div");
		expect(dropdown?.className).toContain("left-0");
		expect(dropdown?.className).not.toContain("right-0");
	});

	it("keeps the row menu right-0 (default) when the pane has ample room to the left", () => {
		render(<BoundaryRow boundaryRect={rect({ left: 0, right: 900, bottom: 1000, width: 900, height: 1000 })} />);
		const trigger = screen.getByTestId("pkg-menu");
		(trigger as HTMLElement).getBoundingClientRect = () =>
			rect({ left: 840, right: 870, top: 100, bottom: 130, width: 30, height: 30, x: 840, y: 100 });
		fireEvent.click(trigger);
		const dropdown = trigger.parentElement!.querySelector(":scope > div");
		expect(dropdown?.className).toContain("right-0");
		expect(dropdown?.className).not.toContain("left-0");
	});
});

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
