/**
 * BrowserRelayBadge RTL (change: add-browser-relay, task 4.3).
 * The badge is the always-mounted subscriber: it renders when an instance
 * exists, hides otherwise, and drives `isLiveViewActive`.
 */

import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRelayBadge } from "../BrowserRelayBadge.js";
import { isLiveViewActive } from "../live-view-gate.js";
import { __resetRelayStoreForTests, getRelayStatus } from "../relay-store.js";
import { renderWithPlugin, SESSION } from "./test-utils.js";

function status(tabCount: number): BrowserRelayStatusMessage {
	return {
		type: "browser_relay_status",
		auditSeq: 0,
		instances:
			tabCount > 0
				? [
						{
							instanceId: "i1",
							profileDirectory: "OSS",
							state: "connected",
							tabs: Array.from({ length: tabCount }, (_, i) => ({
								tabId: i + 1,
								title: `Tab ${i + 1}`,
								url: "https://example.test",
								state: "live" as const,
							})),
						},
					]
				: [],
	};
}

beforeEach(() => {
	__resetRelayStoreForTests();
	// The badge now seeds the store from REST on mount; stub `fetch` so the test
	// exercises the WS path without a real network call.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, json: async () => ({ profiles: {} }) })),
	);
});

afterEach(() => {
	cleanup();
	__resetRelayStoreForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("BrowserRelayBadge", () => {
	it("hides with no live instance and appears once one has a tab", async () => {
		const { queryByTestId, getByTestId, ws } = renderWithPlugin(
			<BrowserRelayBadge session={SESSION} />,
		);
		expect(queryByTestId("browser-relay-badge")).toBeNull();
		expect(isLiveViewActive(SESSION)).toBe(false);

		act(() => ws.emit(status(2)));
		await waitFor(() => expect(getByTestId("browser-relay-badge")).toBeTruthy());
		expect(getByTestId("browser-relay-badge").textContent).toBe("2 browser tabs");
		expect(getRelayStatus()?.instances).toHaveLength(1);
		expect(isLiveViewActive(SESSION)).toBe(true);

		act(() => ws.emit(status(0)));
		await waitFor(() => expect(queryByTestId("browser-relay-badge")).toBeNull());
		expect(isLiveViewActive(SESSION)).toBe(false);
	});
});
