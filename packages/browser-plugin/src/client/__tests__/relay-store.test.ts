/**
 * Relay store (change: add-browser-relay; simplified by add-browser-editor-pane-tab D10):
 * a plain snapshot store — no content-view gate, no dismiss/reopen.
 */
import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as store from "../relay-store.js";

function status(tabIds: number[]): BrowserRelayStatusMessage {
	return {
		type: "browser_relay_status",
		instances: [
			{
				instanceId: "inst-1",
				profileDirectory: "Fake",
				state: "connected",
				tabs: tabIds.map((tabId) => ({ tabId, title: `tab ${tabId}`, url: "https://fake.test/", state: "live" as const })),
			},
		],
		auditSeq: 0,
	};
}

afterEach(() => store.__resetRelayStoreForTests());

describe("relay store", () => {
	it("holds the latest snapshot and notifies subscribers", () => {
		expect(store.getRelayStatus()).toBeNull();
		const msg = status([1]);
		store.setRelayStatus(msg);
		expect(store.getRelayStatus()).toBe(msg);
	});

	it("finds a tab by (instanceId, tabId); undefined when gone", () => {
		store.setRelayStatus(status([1, 2]));
		expect(store.findRelayTab(store.getRelayStatus(), "inst-1", 2)?.tab.title).toBe("tab 2");
		expect(store.findRelayTab(store.getRelayStatus(), "inst-1", 9)).toBeUndefined();
		expect(store.findRelayTab(store.getRelayStatus(), "nope", 1)).toBeUndefined();
		expect(store.findRelayTab(null, "inst-1", 1)).toBeUndefined();
	});

	it("no longer exposes the content-view gate (D10)", () => {
		const exported = Object.keys(store);
		for (const gone of ["hasLiveInstance", "dismissLiveView", "reopenLiveView"]) expect(exported).not.toContain(gone);
		vi.fn();
	});
});
