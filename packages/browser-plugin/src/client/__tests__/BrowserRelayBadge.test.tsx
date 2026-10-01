/**
 * BrowserRelayBadge RTL (change: add-browser-relay, task 4.3).
 * The badge is the always-mounted subscriber: it renders when an instance
 * exists, hides otherwise, and drives `isLiveViewActive`.
 */

import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRelayBadge } from "../BrowserRelayBadge.js";
import { isLiveViewActive } from "../live-view-gate.js";
import { __resetRelayStoreForTests, dismissLiveView, getRelayStatus } from "../relay-store.js";
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

	it("clicking the badge re-opens a dismissed live view and lets the click bubble", async () => {
		const onCardClick = vi.fn();
		const { getByTestId, ws } = renderWithPlugin(
			// biome-ignore lint/a11y/useKeyWithClickEvents: test stand-in for the session card
			<div onClick={onCardClick}>
				<BrowserRelayBadge session={SESSION} />
			</div>,
		);
		act(() => ws.emit(status(1)));
		await waitFor(() => expect(getByTestId("browser-relay-badge")).toBeTruthy());
		const badge = getByTestId("browser-relay-badge");
		expect(badge.tagName).toBe("BUTTON");
		expect(badge.getAttribute("type")).toBe("button");
		expect(badge.getAttribute("aria-label")).toBe("1 browser tabs — Show live browser view");

		act(() => dismissLiveView());
		expect(isLiveViewActive(SESSION)).toBe(false);
		fireEvent.click(badge);
		expect(isLiveViewActive(SESSION)).toBe(true);
		expect(onCardClick).toHaveBeenCalledTimes(1);
	});

	it("the badge is a focusable native button (Enter / Space activate it natively)", async () => {
		const { getByTestId, ws } = renderWithPlugin(<BrowserRelayBadge session={SESSION} />);
		act(() => ws.emit(status(1)));
		await waitFor(() => expect(getByTestId("browser-relay-badge")).toBeTruthy());
		const badge = getByTestId("browser-relay-badge") as HTMLButtonElement;
		// jsdom does not synthesize click from Enter/Space; a real <button> does.
		expect(badge).toBeInstanceOf(HTMLButtonElement);
		expect(badge.disabled).toBe(false);
		badge.focus();
		expect(document.activeElement).toBe(badge);
	});
});
