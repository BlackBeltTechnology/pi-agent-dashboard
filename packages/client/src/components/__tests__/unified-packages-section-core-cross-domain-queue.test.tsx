/**
 * Cross-domain serialization: an extension op fired while a pi-core
 * update is running must QUEUE, not 409.
 *
 * Deviation from tasks.md 5.2: the Recommended-Extensions sub-group only
 * renders ALREADY-INSTALLED packages, so it offers Update rather than
 * Install. Update takes the identical `kind: "extension"` dispatch arm
 * (POST `/api/packages/<action>`), so the queueing behaviour under test
 * is the same.
 *
 * See change: unify-pi-core-into-package-queue.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	InstalledPackage,
	PiCoreStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { packageQueue } from "../../lib/package/package-queue.js";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";

const PI = "@mariozechner/pi-coding-agent";
const EXT_SRC = "npm:@blackbelt-technology/pi-dashboard-subagents";

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
vi.mock("../../hooks/usePiChangelog.js", () => ({
	usePiChangelog: () => ({ data: null, isLoading: false, error: null }),
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
		packages: [
			{
				source: EXT_SRC,
				scope: "user",
				filtered: false,
				version: "0.1.1",
				displayName: "pi-dashboard-subagents",
				isRecommended: true,
				isBundled: false,
			} as InstalledPackage,
		],
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("UnifiedPackagesSection — cross-domain queueing", () => {
	it("queues an extension op behind a running pi-core update instead of 409ing", async () => {
		let resolveCore!: (r: Response) => void;
		const corePromise = new Promise<Response>((res) => {
			resolveCore = res;
		});
		const calls: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			calls.push(url);
			if (url === "/api/pi-core/update") return corePromise;
			if (url === "/api/packages/check-updates") {
				return jsonResponse({ success: true, data: [{ source: EXT_SRC }] });
			}
			return jsonResponse({ success: true, data: { operationId: "op-ext" } });
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<UnifiedPackagesSection />);

		// The auto check-updates pass makes the extension row offer Update.
		const extTestId = `pkg-row-${EXT_SRC.replace(/[^a-z0-9]/gi, "-")}-update`;
		await waitFor(() => expect(screen.getByTestId(extTestId)).toBeTruthy());

		// 1. Start the pi-core update — its POST stays pending.
		await act(async () => {
			fireEvent.click(screen.getByTestId(`pi-core-row-${PI}-update`));
			await flush();
		});
		expect(packageQueue.getRunning()?.source).toBe(`pi-core:${PI}`);

		// 2. Fire the extension op while pi-core holds the slot.
		await act(async () => {
			fireEvent.click(screen.getByTestId(extTestId));
			await flush();
		});

		// 3. It queues — no POST, no error.
		expect(packageQueue.getStateForSource(EXT_SRC)).toBe("queued");
		expect(calls.filter((u) => u.startsWith("/api/packages/update"))).toHaveLength(0);

		// 4. Pi-core finishes → the extension op drains automatically.
		await act(async () => {
			resolveCore(jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }));
			await flush();
		});

		expect(packageQueue.getStateForSource(EXT_SRC)).toBe("running");
		expect(calls).toContain("/api/packages/update");
	});
});
