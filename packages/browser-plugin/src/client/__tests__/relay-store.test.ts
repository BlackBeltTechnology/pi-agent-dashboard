/**
 * Relay store (change: add-browser-relay; simplified by add-browser-editor-pane-tab D10):
 * a plain snapshot store — no content-view gate, no dismiss/reopen.
 */

import {
	__resetSlotClaimsVersionForTests,
	getSlotClaimsVersion,
	subscribeSlotClaimsVersion,
} from "@blackbelt-technology/dashboard-plugin-runtime";
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
				host: "dashboard",
				state: "connected",
				tabs: tabIds.map((tabId) => ({ tabId, title: `tab ${tabId}`, url: "https://fake.test/", state: "live" as const })),
			},
		],
		auditSeq: 0,
	};
}

afterEach(() => {
	store.__resetRelayStoreForTests();
	__resetSlotClaimsVersionForTests();
});

const tab = (tabId: number) => ({ tabId, title: `t${tabId}`, url: "https://x.test/", state: "live" as const });
const raw = (instances: unknown) => ({ type: "browser_relay_status", instances, auditSeq: 0 }) as unknown as BrowserRelayStatusMessage;

describe("relayTabsOf / hasRelayTabs (#E1)", () => {
	const cases: Array<[string, BrowserRelayStatusMessage | null, number]> = [
		["null", null, 0],
		["no instances", raw([]), 0],
		["instance without tabs", raw([{ tabs: [] }]), 0],
		["one tab", raw([{ tabs: [tab(1)] }]), 1],
		["multi instance", raw([{ tabs: [] }, { tabs: [tab(1), tab(2)] }]), 2],
		["missing instances", { type: "browser_relay_status", auditSeq: 0 } as unknown as BrowserRelayStatusMessage, 0],
		["non-array instances", raw({}), 0],
		["instance missing tabs", raw([{}]), 0],
		["non-array tabs skipped", raw([{ tabs: "x" }, { tabs: [tab(1)] }]), 1],
	];
	it.each(cases)("%s", (_name, s, n) => {
		expect(store.relayTabsOf(s)).toHaveLength(n);
		expect(store.hasRelayTabs(s)).toBe(n > 0);
	});
});

describe("tab-count flip invalidation (#F3, #F4)", () => {
	it("bumps the claims version on flips only; notifies every set", () => {
		const listener = vi.fn();
		store.subscribeRelayStore(listener);
		const v0 = getSlotClaimsVersion();
		for (const s of [status([]), status([1]), status([1, 2]), status([1, 2]), status([]), null]) store.setRelayStatus(s);
		expect(getSlotClaimsVersion() - v0).toBe(2);
		expect(listener).toHaveBeenCalledTimes(6);
	});

	it("the claims-version listener already sees the new snapshot", () => {
		store.setRelayStatus(status([]));
		let seen: number | undefined;
		const off = subscribeSlotClaimsVersion(() => {
			seen = store.relayTabsOf(store.getRelayStatus()).length;
		});
		store.setRelayStatus(status([1]));
		off();
		expect(seen).toBe(1);
	});
});

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
