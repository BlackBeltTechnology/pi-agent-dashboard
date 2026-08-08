/**
 * The screenshot bug, as a test.
 *
 * A pi-core update started from the Core sub-group must keep rendering
 * its busy state after `UnifiedPackagesSection` unmounts (sidebar
 * navigation) and remounts — because the in-flight state lives in the
 * singleton `packageQueue`, not in component `useState`.
 *
 * Also asserts the R4 ordering rule: a `pi_core_update_complete` WS
 * frame arriving BEFORE the POST resolves must NOT clear the spinner.
 *
 * See change: unify-pi-core-into-package-queue.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	InstalledPackage,
	PiCoreStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { packageQueue } from "../../lib/package/package-queue.js";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";

const PI = "@mariozechner/pi-coding-agent";

const mockUsePiCoreVersions = vi.fn<() => {
	status: PiCoreStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: (force?: boolean) => Promise<void>;
}>();

const mockUseInstalledPackages = vi.fn<() => {
	packages: InstalledPackage[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}>();

vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => mockUsePiCoreVersions(),
}));
vi.mock("../../hooks/useInstalledPackages.js", () => ({
	useInstalledPackages: () => mockUseInstalledPackages(),
}));
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../packages/PackageReadmeDialog.js", () => ({ PackageReadmeDialog: () => null }));

async function flush() {
	for (let i = 0; i < 50; i++) await Promise.resolve();
}

function jsonResponse(payload: any, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function Toggle({ mounted }: { mounted: boolean }) {
	return mounted ? <UnifiedPackagesSection /> : <div>unmounted</div>;
}

beforeEach(() => {
	packageQueue.__resetForTests();
	mockUsePiCoreVersions.mockReturnValue({
		status: {
			packages: [
				{
					name: PI,
					displayName: "pi (core agent)",
					currentVersion: "0.70.2",
					latestVersion: "0.70.3",
					updateAvailable: true,
					installSource: "global",
				},
			],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		},
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});
	mockUseInstalledPackages.mockReturnValue({
		packages: [],
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("UnifiedPackagesSection — pi-core update survives unmount", () => {
	it("keeps the Core row busy across unmount/remount and until the POST resolves", async () => {
		let resolveBody!: (r: Response) => void;
		const bodyPromise = new Promise<Response>((res) => {
			resolveBody = res;
		});
		vi.stubGlobal("fetch", vi.fn(async () => bodyPromise));

		const { rerender } = render(<Toggle mounted={true} />);

		const updateBtn = screen.getByTestId(`pi-core-row-${PI}-update`);
		await act(async () => {
			fireEvent.click(updateBtn);
			await flush();
		});

		// Row is busy — its Update button is disabled while the op runs.
		expect(
			(screen.getByTestId(`pi-core-row-${PI}-update`) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(packageQueue.getRunning()?.source).toBe(`pi-core:${PI}`);

		// Navigate away…
		await act(async () => {
			rerender(<Toggle mounted={false} />);
			await flush();
		});
		expect(screen.getByText("unmounted")).toBeTruthy();

		// …and back. No new events dispatched — the queue must still hold the op.
		await act(async () => {
			rerender(<Toggle mounted={true} />);
			await flush();
		});
		expect(
			(screen.getByTestId(`pi-core-row-${PI}-update`) as HTMLButtonElement).disabled,
		).toBe(true);

		// R4: the WS complete frame lands BEFORE the POST resolves — must be ignored.
		await act(async () => {
			window.dispatchEvent(
				new CustomEvent("pi-core-event", {
					detail: { type: "pi_core_update_complete", results: [{ name: PI, success: true }] },
				}),
			);
			await flush();
		});
		expect(
			(screen.getByTestId(`pi-core-row-${PI}-update`) as HTMLButtonElement).disabled,
		).toBe(true);

		// Now the POST resolves — the row clears.
		await act(async () => {
			resolveBody(jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }));
			await flush();
		});
		expect(packageQueue.getRunning()).toBeNull();
		expect(
			(screen.getByTestId(`pi-core-row-${PI}-update`) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("shows a progress message that arrived while the component was unmounted", async () => {
		const bodyPromise = new Promise<Response>(() => {});
		vi.stubGlobal("fetch", vi.fn(async () => bodyPromise));

		const { rerender } = render(<Toggle mounted={true} />);

		await act(async () => {
			fireEvent.click(screen.getByTestId(`pi-core-row-${PI}-update`));
			await flush();
		});

		await act(async () => {
			rerender(<Toggle mounted={false} />);
			await flush();
		});

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent("pi-core-event", {
					detail: {
						type: "pi_core_update_progress",
						name: PI,
						phase: "output",
						message: "added 12 packages",
					},
				}),
			);
			await flush();
		});

		await act(async () => {
			rerender(<Toggle mounted={true} />);
			await flush();
		});

		expect(screen.getByText("added 12 packages")).toBeTruthy();
	});
});
