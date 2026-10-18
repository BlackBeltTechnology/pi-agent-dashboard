/**
 * D9 (rewritten): the queue is VISIBLE, buttons are not disabled.
 *
 * Goal 6 is "no enabled click is silently lost" — not "disable every
 * lock-taking control while busy". A click on a core row or an extension
 * row during a running operation must ENQUEUE and render `queued`, then
 * run in FIFO order. Move / Reset-to-npm are the only controls that stay
 * disabled, because they ride `moveTracker` rather than `packageQueue`.
 *
 * See change: unify-pi-core-into-package-queue.
 */

import type {
	AddonFeature,
	PiCoreStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageQueue } from "../../lib/package/package-queue.js";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";
import { feature, part } from "./addons-feature-fixtures.js";

const PI = "@earendil-works/pi-coding-agent";
const DASH = "@blackbelt-technology/pi-agent-dashboard";
const EXT_SRC = "npm:@blackbelt-technology/pi-dashboard-subagents";
const FEATURE_ID = `pkg:${EXT_SRC}`;

const mockUsePiCoreVersions = vi.fn<() => {
	status: PiCoreStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: (force?: boolean) => Promise<void>;
}>();
const mockUseAddonCatalog = vi.fn<() => {
	features: AddonFeature[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}>();

vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => mockUsePiCoreVersions(),
}));
vi.mock("../../hooks/useAddonCatalog.js", () => ({
	useAddonCatalog: () => mockUseAddonCatalog(),
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
const btn = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

beforeEach(() => {
	packageQueue.__resetForTests();
	mockUsePiCoreVersions.mockReturnValue({
		status: {
			packages: [
				{
					name: PI,
					displayName: "pi (core agent)",
					currentVersion: "0.82.0",
					latestVersion: "0.83.0",
					updateAvailable: true,
					installSource: "global",
				},
				{
					name: DASH,
					displayName: "pi-dashboard",
					currentVersion: "0.4.0",
					latestVersion: "0.4.1",
					updateAvailable: true,
					installSource: "global",
				},
			],
			updatesAvailable: 2,
			lastChecked: new Date().toISOString(),
		},
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});
	mockUseAddonCatalog.mockReturnValue({
		features: [
			feature(FEATURE_ID, {
				displayName: "pi-dashboard-subagents",
				packages: [part(EXT_SRC, { version: "0.1.1", publishedVariantSource: EXT_SRC, publishedVariantVersion: "0.1.2" })],
			}),
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

describe("UnifiedPackagesSection — visible queue (D9)", () => {
	it("mid-flight clicks on another core row AND an extension row both enqueue and render queued", async () => {
		// Each core POST gets its OWN deferred promise — sharing one would make
		// the second core call resolve instantly off the first's payload and
		// mask the FIFO assertion.
		const coreResolvers: Array<(r: Response) => void> = [];
		const coreBodies: string[] = [];
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push(url);
				if (url === "/api/pi-core/update") {
					coreBodies.push(JSON.parse(init?.body as string).packages[0]);
					return new Promise<Response>((res) => coreResolvers.push(res));
				}
				if (url === "/api/packages/check-updates") {
					return jsonResponse({ success: true, data: [{ source: EXT_SRC }] });
				}
				return jsonResponse({ success: true, data: { operationId: "op-ext" } });
			}),
		);

		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId(`addon-update-${FEATURE_ID}`)).toBeTruthy());

		// 1. Start a core update — its POST stays pending.
		await act(async () => {
			fireEvent.click(btn(`pi-core-row-${PI}-update`));
			await flush();
		});
		expect(packageQueue.getRunning()?.source).toBe(`pi-core:${PI}`);

		// 2. The OTHER core row and the extension row are still CLICKABLE.
		expect(btn(`pi-core-row-${DASH}-update`).disabled).toBe(false);
		expect(btn(`addon-update-${FEATURE_ID}`).disabled).toBe(false);

		// 3. Click both mid-flight.
		await act(async () => {
			fireEvent.click(btn(`pi-core-row-${DASH}-update`));
			fireEvent.click(btn(`addon-update-${FEATURE_ID}`));
			await flush();
		});

		// 4. Both are visibly queued — not lost, not errored.
		expect(packageQueue.getStateForSource(`pi-core:${DASH}`)).toBe("queued");
		expect(packageQueue.getStateForSource(EXT_SRC)).toBe("queued");
		expect(screen.getByTestId(`pi-core-row-${DASH}-queued`)).toBeTruthy();
		expect(screen.getByTestId(`addon-queued-${FEATURE_ID}`)).toBeTruthy();
		expect(screen.queryByText(/already in progress/i)).toBeNull();
		// Only the running op has been POSTed.
		expect(calls.filter((u) => u === "/api/pi-core/update")).toHaveLength(1);
		expect(calls.filter((u) => u.startsWith("/api/packages/update"))).toHaveLength(0);

		// 5. Core finishes → next queued entry runs, in FIFO order.
		expect(coreBodies).toEqual([PI]);
		await act(async () => {
			coreResolvers[0](
				jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }),
			);
			await flush();
		});
		// DASH was enqueued first, so it runs next — the extension still waits.
		expect(coreBodies).toEqual([PI, DASH]);
		expect(packageQueue.getRunning()?.source).toBe(`pi-core:${DASH}`);
		expect(packageQueue.getStateForSource(EXT_SRC)).toBe("queued");

		// 6. DASH finishes → the extension finally POSTs.
		await act(async () => {
			coreResolvers[1](
				jsonResponse({ success: true, data: { results: [{ name: DASH, success: true }] } }),
			);
			await flush();
		});
		expect(packageQueue.getStateForSource(EXT_SRC)).toBe("running");
		expect(calls).toContain("/api/packages/update");
	});

	it("a queued row's button is disabled and labelled Queued (the click is already accounted for)", async () => {
		const pending = new Promise<Response>(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === "/api/packages/check-updates"
					? jsonResponse({ success: true, data: [] })
					: pending,
			),
		);

		render(<UnifiedPackagesSection />);

		await act(async () => {
			fireEvent.click(btn(`pi-core-row-${PI}-update`));
			await flush();
		});
		await act(async () => {
			fireEvent.click(btn(`pi-core-row-${DASH}-update`));
			await flush();
		});

		const queuedBtn = btn(`pi-core-row-${DASH}-update`);
		expect(queuedBtn.disabled).toBe(true);
		expect(queuedBtn.textContent).toContain("Queued");
		// Re-clicking a queued row does not stack a duplicate.
		const depth = packageQueue.getQueueDepth();
		await act(async () => {
			fireEvent.click(queuedBtn);
			await flush();
		});
		expect(packageQueue.getQueueDepth()).toBe(depth);
	});

	it("Update All stays clickable mid-flight and is idempotent via dedupe", async () => {
		const pending = new Promise<Response>(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === "/api/packages/check-updates"
					? jsonResponse({ success: true, data: [] })
					: pending,
			),
		);

		render(<UnifiedPackagesSection />);

		await act(async () => {
			fireEvent.click(btn("pi-core-update-all"));
			await flush();
		});
		// 2 updatable core packages → 1 running + 1 queued.
		expect(packageQueue.getRunning()).not.toBeNull();
		expect(packageQueue.getQueueDepth()).toBe(1);

		// Still clickable mid-flight, and a second click adds nothing.
		expect(btn("pi-core-update-all").disabled).toBe(false);
		await act(async () => {
			fireEvent.click(btn("pi-core-update-all"));
			await flush();
		});
		expect(packageQueue.getQueueDepth()).toBe(1);
	});

	// F2 — Update All over the two Core rows (earendil pi + dashboard)
	// serializes: running→queued, then the second runs after the first POST
	// resolves; each POST carries exactly one name.
	// See change: drop-mariozechner-pi-fork (test-plan #F2).
	it("F2: Update All serializes the 2 Core rows FIFO with single-name POSTs", async () => {
		const resolvers: Array<(r: Response) => void> = [];
		// Every URL not answered here parks a resolver in FIFO order, so the
		// section's own mount-time health fetch must be answered or it steals
		// resolvers[0]. See change: add-package-health-cleanup.
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
			url === "/api/packages/check-updates"
				? jsonResponse({ success: true, data: [] })
				: url === "/api/packages/health"
					? jsonResponse({ success: true, data: { entries: [], summary: { ok: 0, staleNpm: 0, missingPath: 0, duplicateGroups: [] } } })
					: new Promise<Response>((resolve) => resolvers.push(resolve)),
		);
		vi.stubGlobal("fetch", fetchMock);
		const coreCalls = () =>
			fetchMock.mock.calls.filter(([u]) => u === "/api/pi-core/update");

		render(<UnifiedPackagesSection />);
		await act(async () => {
			fireEvent.click(btn("pi-core-update-all"));
			await flush();
		});

		expect(packageQueue.getStateForSource(`pi-core:${PI}`)).toBe("running");
		expect(packageQueue.getStateForSource(`pi-core:${DASH}`)).toBe("queued");
		expect(coreCalls()).toHaveLength(1);

		await act(async () => {
			resolvers[0](jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }));
			await flush();
		});
		await waitFor(() => expect(packageQueue.getStateForSource(`pi-core:${DASH}`)).toBe("running"));
		expect(coreCalls()).toHaveLength(2);
		expect(coreCalls().map(([, init]) => JSON.parse(init!.body as string))).toEqual([
			{ packages: [PI] },
			{ packages: [DASH] },
		]);
	});

	it("Move and Reset-to-npm are the only controls disabled while busy", async () => {
		const pending = new Promise<Response>(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === "/api/packages/check-updates"
					? jsonResponse({ success: true, data: [{ source: EXT_SRC }] })
					: pending,
			),
		);

		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId(`addon-update-${FEATURE_ID}`)).toBeTruthy());

		// Idle: the menu's reset item is live (inline link is gone).
		await act(async () => {
			fireEvent.click(btn(`addon-menu-${FEATURE_ID}`));
			await flush();
		});
		expect(btn(`addon-reset-${FEATURE_ID}`).disabled).toBe(false);
		await act(async () => {
			fireEvent.click(btn(`addon-menu-${FEATURE_ID}`));
			await flush();
		});

		await act(async () => {
			fireEvent.click(btn(`pi-core-row-${PI}-update`));
			await flush();
		});
		expect(packageQueue.isAnyRunning()).toBe(true);

		// Reset-to-published is now locked, with the reason surfaced as a tooltip,
		// and Move too (both inside the kebab menu).
		await act(async () => {
			fireEvent.click(btn(`addon-menu-${FEATURE_ID}`));
			await flush();
		});
		const reset = btn(`addon-reset-${FEATURE_ID}`);
		expect(reset.disabled).toBe(true);
		expect(reset.title).toMatch(/can't be queued yet/i);
		expect(btn(`addon-move-${FEATURE_ID}`).disabled).toBe(true);

		// …while the queueable Update button stays enabled.
		expect(btn(`addon-update-${FEATURE_ID}`).disabled).toBe(false);
	});
});
