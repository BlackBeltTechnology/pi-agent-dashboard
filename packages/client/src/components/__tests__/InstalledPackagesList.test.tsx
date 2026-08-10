import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Hook mocks must be hoisted before the component import.
const mockInstalled = vi.fn();
const mockOps = vi.fn();
vi.mock("../../hooks/useInstalledPackages.js", () => ({
	useInstalledPackages: (...args: any[]) => mockInstalled(...args),
}));
vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: (...args: any[]) => mockOps(...args),
}));

import { InstalledPackagesList } from "../packages/InstalledPackagesList.js";

const defaultOps = {
	operation: { operationId: null, status: "idle" as const, message: "", source: "" },
	install: vi.fn(),
	remove: vi.fn(),
	update: vi.fn(),
	move: vi.fn(),
	moveStateFor: () => undefined,
	clearMove: vi.fn(),
	statusFor: () => "idle" as const,
	messageFor: () => "",
	clearOperation: vi.fn(),
	queueDepth: 0,
	runningSource: null,
	handleMessage: vi.fn(),
};

beforeEach(() => {
	mockInstalled.mockReturnValue({
		packages: [],
		isLoading: false,
		error: null,
		refresh: vi.fn(),
	});
	mockOps.mockReturnValue(defaultOps);
});

afterEach(() => cleanup());

describe("InstalledPackagesList", () => {
	it("shows empty hint when no packages installed", () => {
		render(<InstalledPackagesList scope="local" cwd="/proj" />);
		expect(screen.getByText(/no packages installed at local scope/i)).toBeTruthy();
	});

	it("shows error and Retry button when load fails", () => {
		const refresh = vi.fn();
		mockInstalled.mockReturnValue({
			packages: [],
			isLoading: false,
			error: "Network error",
			refresh,
		});
		render(<InstalledPackagesList scope="global" />);
		expect(screen.getByText("Network error")).toBeTruthy();
		fireEvent.click(screen.getByText("Retry"));
		expect(refresh).toHaveBeenCalled();
	});

	it("renders one row per installed package", () => {
		mockInstalled.mockReturnValue({
			packages: [
				{ source: "npm:pi-flows", scope: "user", filtered: false, displayName: "pi-flows" },
				{ source: "git:github.com/x/y", scope: "user", filtered: false, displayName: "y" },
			],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});
		render(<InstalledPackagesList scope="global" />);
		expect(screen.getByText("pi-flows")).toBeTruthy();
		expect(screen.getByText("y")).toBeTruthy();
	});

	it("Move menu fires operations.move with the right scope flip (global → local)", async () => {
		const move = vi.fn().mockResolvedValue({ ok: true, moveId: "m1", phases: ["install", "remove"] });
		mockOps.mockReturnValue({ ...defaultOps, move });
		mockInstalled.mockReturnValue({
			packages: [{ source: "npm:pi-flows", scope: "user", filtered: false, displayName: "pi-flows" }],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});

		const onResolveLocalCwd = vi.fn().mockResolvedValue("/picked/cwd");
		render(
			<InstalledPackagesList scope="global" onResolveLocalCwd={onResolveLocalCwd} />,
		);
		// Open kebab menu on the row (note `installed-pkg-row-...-menu`).
		const menuBtn = screen.getByTestId("installed-pkg-row-npm-pi-flows-menu");
		fireEvent.click(menuBtn);
		fireEvent.click(screen.getByText("Move → Local"));

		await waitFor(() => expect(onResolveLocalCwd).toHaveBeenCalled());
		expect(move).toHaveBeenCalledWith("npm:pi-flows", {
			fromScope: "global",
			fromCwd: undefined,
			toScope: "local",
			toCwd: "/picked/cwd",
		});
	});

	it("Move from local to global uses the implicit destination scope (no picker)", async () => {
		const move = vi.fn().mockResolvedValue({ ok: true, moveId: "m2", phases: ["install", "remove"] });
		mockOps.mockReturnValue({ ...defaultOps, move });
		mockInstalled.mockReturnValue({
			packages: [{ source: "npm:pi-flows", scope: "project", filtered: false, displayName: "pi-flows" }],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});

		render(<InstalledPackagesList scope="local" cwd="/proj" />);
		fireEvent.click(screen.getByTestId("installed-pkg-row-npm-pi-flows-menu"));
		fireEvent.click(screen.getByText("Move → Global"));

		await waitFor(() => expect(move).toHaveBeenCalled());
		expect(move).toHaveBeenCalledWith("npm:pi-flows", {
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
			toCwd: undefined,
		});
	});

	it("Move button is disabled when otherScopePackages contains the same identity", () => {
		mockInstalled.mockReturnValue({
			packages: [{ source: "npm:pi-flows", scope: "user", filtered: false, displayName: "pi-flows" }],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});
		// Same identity exists in the other scope.
		const otherScopePackages = [
			{ source: "npm:pi-flows@1.2.3", scope: "project" as const, filtered: false },
		];

		render(
			<InstalledPackagesList scope="global" otherScopePackages={otherScopePackages as any} />,
		);
		fireEvent.click(screen.getByTestId("installed-pkg-row-npm-pi-flows-menu"));
		const moveBtn = screen.getByTestId("installed-pkg-row-npm-pi-flows-move") as HTMLButtonElement;
		expect(moveBtn.disabled).toBe(true);
		expect(moveBtn.getAttribute("title")).toMatch(/Already installed in local/i);
	});

	it("expand chevron toggles inline contained-resources tree", () => {
		mockInstalled.mockReturnValue({
			packages: [{ source: "npm:pi-flows", scope: "user", filtered: false, displayName: "pi-flows" }],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});
		const containedResources = new Map([
			[
				"npm:pi-flows",
				{
					name: "pi-flows",
					source: "npm:pi-flows",
					resources: {
						skills: [{ name: "skill-a", filePath: "/p/a.md", type: "skill" }],
						extensions: [],
						prompts: [],
					},
				},
			],
		]);
		render(
			<InstalledPackagesList scope="global" containedResources={containedResources as any} />,
		);
		// Tree not visible before expand.
		expect(screen.queryByText("skill-a")).toBeNull();
		fireEvent.click(screen.getByTestId("installed-pkg-expand-npm:pi-flows"));
		expect(screen.getByText("skill-a")).toBeTruthy();
	});

	it("renders partial-success banner when moveStateFor returns partial-success", () => {
		mockInstalled.mockReturnValue({
			packages: [{ source: "npm:pi-flows", scope: "user", filtered: false, displayName: "pi-flows" }],
			isLoading: false,
			error: null,
			refresh: vi.fn(),
		});
		mockOps.mockReturnValue({
			...defaultOps,
			moveStateFor: (s: string) =>
				s === "npm:pi-flows"
					? {
							moveId: "m1",
							source: "npm:pi-flows",
							fromScope: "local" as const,
							toScope: "global" as const,
							phase: "partial-success" as const,
							message: "EBUSY",
							partialSuccess: { installed: true, removed: false, removeError: "EBUSY" },
						}
					: undefined,
		});
		render(<InstalledPackagesList scope="global" />);
		expect(screen.getByTestId("installed-pkg-partial-success")).toBeTruthy();
		expect(screen.getByText(/Cleanup origin/i)).toBeTruthy();
	});
});
