import type {
	PackageHealthListResponseData,
	PackageHealthReport,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageHealthPanel } from "../packages/PackageHealthPanel.js";

const ok: PackageHealthReport = { source: "npm:fine", status: "ok", packageName: "fine", version: "1.0.0" };
const stale: PackageHealthReport = { source: "npm:gone", status: "stale-npm", reason: "not installed" };
const missing: PackageHealthReport = { source: "/dead/path", status: "missing-path", reason: "no dir" };
const dupA: PackageHealthReport = {
	source: "/a/ext",
	status: "duplicate",
	duplicateGroupId: "dup:ext",
	packageName: "ext",
	version: "1.0.0",
	resolvedPath: "/a/ext",
	mtime: "2026-01-01T00:00:00.000Z",
};
const dupB: PackageHealthReport = { ...dupA, source: "/b/ext", resolvedPath: "/b/ext" };
const dupMissing: PackageHealthReport = {
	source: "/c/ext",
	status: "missing-path",
	duplicateGroupId: "dup:ext",
	packageName: "ext",
};

const report = (entries: PackageHealthReport[]): PackageHealthListResponseData => ({
	entries,
	summary: { ok: 0, staleNpm: 0, missingPath: 0, duplicateGroups: [] },
});

describe("PackageHealthPanel", () => {
	beforeEach(() => sessionStorage.clear());
	afterEach(cleanup);

	it("renders nothing for a healthy report", () => {
		const { container } = render(<PackageHealthPanel report={report([ok])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		expect(container.innerHTML).toBe("");
	});

	it("renders stale, missing and duplicate groups with their members", () => {
		render(
			<PackageHealthPanel report={report([ok, stale, missing, dupA, dupB])} onApply={vi.fn()} onRefresh={vi.fn()} />,
		);
		expect(screen.getByTestId("pkg-health-stale").textContent).toContain("npm:gone");
		expect(screen.getByTestId("pkg-health-missing").textContent).toContain("/dead/path");
		const group = screen.getByTestId("pkg-health-group-dup:ext");
		expect(group.textContent).toContain("/a/ext");
		expect(group.textContent).toContain("/b/ext");
		expect(group.textContent).toContain("v1.0.0");
		expect(screen.queryByTestId("pkg-health-row-npm-fine")).toBeNull();
	});

	it("omits sub-sections with no members", () => {
		render(<PackageHealthPanel report={report([stale])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		expect(screen.queryByTestId("pkg-health-missing")).toBeNull();
		expect(screen.queryByTestId("pkg-health-duplicates")).toBeNull();
	});

	it("pre-checks missing-path members of a duplicate group, leaves live ones unchecked", () => {
		render(<PackageHealthPanel report={report([dupA, dupB, dupMissing])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		expect((screen.getByRole("checkbox", { name: /Remove \/c\/ext/ }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole("checkbox", { name: /Remove \/a\/ext/ }) as HTMLInputElement).checked).toBe(false);
		expect((screen.getByRole("checkbox", { name: /Remove \/b\/ext/ }) as HTMLInputElement).checked).toBe(false);
	});

	it("disables Apply with no selection", () => {
		render(<PackageHealthPanel report={report([stale])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		expect((screen.getByTestId("pkg-health-apply") as HTMLButtonElement).disabled).toBe(true);
	});

	it("Select all checks every row in the section", () => {
		render(<PackageHealthPanel report={report([stale, { ...stale, source: "npm:gone2" }])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		fireEvent.click(screen.getByLabelText(/Select all/));
		expect((screen.getByRole("checkbox", { name: /Remove npm:gone$/ }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole("checkbox", { name: /Remove npm:gone2/ }) as HTMLInputElement).checked).toBe(true);
	});

	it("Apply sends the union of checked sources once and is disabled while in flight", async () => {
		let resolve!: () => void;
		const onApply = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
		render(<PackageHealthPanel report={report([stale, missing])} onApply={onApply} onRefresh={vi.fn()} />);
		fireEvent.click(screen.getByRole("checkbox", { name: /Remove npm:gone/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Remove \/dead\/path/ }));
		fireEvent.click(screen.getByTestId("pkg-health-apply"));
		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply).toHaveBeenCalledWith(["npm:gone", "/dead/path"]);
		expect((screen.getByTestId("pkg-health-apply") as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByTestId("pkg-health-apply"));
		expect(onApply).toHaveBeenCalledTimes(1);
		resolve();
		await waitFor(() => expect((screen.getByTestId("pkg-health-apply") as HTMLButtonElement).disabled).toBe(false));
	});

	it("surfaces an apply error inline", async () => {
		const onApply = vi.fn().mockRejectedValue(new Error("Unknown package sources: x"));
		render(<PackageHealthPanel report={report([stale])} onApply={onApply} onRefresh={vi.fn()} />);
		fireEvent.click(screen.getByRole("checkbox", { name: /Remove npm:gone/ }));
		fireEvent.click(screen.getByTestId("pkg-health-apply"));
		expect((await screen.findByTestId("pkg-health-error")).textContent).toContain("Unknown package sources: x");
	});

	it("collapse is sticky for the browser session", () => {
		const { unmount } = render(<PackageHealthPanel report={report([stale])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /Package issues/ }));
		expect(screen.queryByTestId("pkg-health-stale")).toBeNull();
		unmount();
		render(<PackageHealthPanel report={report([stale])} onApply={vi.fn()} onRefresh={vi.fn()} />);
		expect(screen.queryByTestId("pkg-health-stale")).toBeNull();
	});

	it("Rescan calls onRefresh", () => {
		const onRefresh = vi.fn();
		render(<PackageHealthPanel report={report([stale])} onApply={vi.fn()} onRefresh={onRefresh} />);
		fireEvent.click(screen.getByRole("button", { name: /Rescan/ }));
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});
});
