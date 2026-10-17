/**
 * BrowserRelayFeed — sole `browser_relay_status` subscriber: seed on mount when
 * connected, refresh on reconnect, live push wins over an in-flight seed, failed
 * refresh clears, unmount clears (test-plan #F7 feed half, #F9–#F12, #X1).
 * See change: fix-empty-status-subcard.
 */
import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", navigate] }));

import { BrowserPaneTab } from "../BrowserPaneTab.js";
import { BrowserRelayBadge } from "../BrowserRelayBadge.js";
import { BrowserTabLabel } from "../BrowserTabLabel.js";
import { __resetRelayStoreForTests, getRelayStatus, relayTabsOf, subscribeRelayStore } from "../relay-store.js";
import { renderWithPlugin, SESSION } from "./test-utils.js";

const profiles = (tabCount: number) => ({
	profiles:
		tabCount > 0
			? {
					OSS: {
						instances: [
							{
								instanceId: "i1",
								state: "connected",
								tabs: Array.from({ length: tabCount }, (_, i) => ({ tabId: i + 1, title: `T${i + 1}`, url: "https://x.test", state: "live" })),
							},
						],
					},
				}
			: {},
});

const ws1 = (n: number): BrowserRelayStatusMessage => ({
	type: "browser_relay_status",
	auditSeq: 1,
	instances: n
		? [{ instanceId: "i1", profileDirectory: "OSS", host: "dashboard", state: "connected", tabs: Array.from({ length: n }, (_, i) => ({ tabId: i + 1, title: "t", url: "https://x.test", state: "live" as const })) }]
		: [],
});

let fetchMock: ReturnType<typeof vi.fn>;
const respond = (tabCount: number) => fetchMock.mockImplementation(async () => ({ ok: true, json: async () => profiles(tabCount) }));
const tabCountNow = () => relayTabsOf(getRelayStatus()).length;

beforeEach(() => {
	__resetRelayStoreForTests();
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	__resetRelayStoreForTests();
	vi.unstubAllGlobals();
});

describe("BrowserRelayFeed", () => {
	it("seeds exactly once on mount when already connected (#F9)", async () => {
		respond(1);
		renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(tabCountNow()).toBe(1));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("the REST seed stamps `host` on every instance: dashboard rows \"dashboard\", operator rows their hostId", async () => {
		const tab = { tabId: 1, title: "T", url: "https://x.test", state: "live" };
		fetchMock.mockImplementation(async () => ({
			ok: true,
			json: async () => ({
				profiles: { OSS: { instances: [{ instanceId: "i1", state: "connected", tabs: [tab] }] } },
				operatorHosts: [
					{ hostId: "host-aa", profiles: [{ profileDirectory: "Default", instances: [{ instanceId: "i2", state: "connected", tabs: [tab] }] }] },
				],
			}),
		}));
		renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(tabCountNow()).toBe(2));
		const byId = Object.fromEntries((getRelayStatus()?.instances ?? []).map((i) => [i.instanceId, i]));
		expect(byId.i1).toMatchObject({ host: "dashboard", profileDirectory: "OSS" });
		expect(byId.i2).toMatchObject({ host: "host-aa", profileDirectory: "Default" });
	});

	it("does not seed while disconnected", async () => {
		respond(1);
		renderWithPlugin(<span />, { connectionStatus: "disconnected" });
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refreshes the snapshot after reconnect (#F10)", async () => {
		respond(1);
		const r = renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(tabCountNow()).toBe(1));
		respond(0);
		r.setConnectionStatus("disconnected");
		r.setConnectionStatus("connected");
		await waitFor(() => expect(tabCountNow()).toBe(0));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("a live push during an in-flight seed wins (#F11)", async () => {
		let resolve!: (v: unknown) => void;
		fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
		const r = renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		act(() => r.ws.emit(ws1(0)));
		await act(async () => {
			resolve({ ok: true, json: async () => profiles(1) });
		});
		expect(tabCountNow()).toBe(0);
		expect(getRelayStatus()).not.toBeNull();
	});

	it("is the sole subscriber: one seed, one notification per frame (#F12)", async () => {
		respond(1);
		const r = renderWithPlugin(
			<>
				<BrowserPaneTab path="browser:i1:1" session={SESSION} isActive onClose={() => {}} />
				<BrowserTabLabel path="browser:i1:1" />
				<BrowserRelayBadge session={SESSION} />
			</>,
			{ connectionStatus: "connected" },
		);
		await waitFor(() => expect(tabCountNow()).toBe(1));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const listener = vi.fn();
		const off = subscribeRelayStore(listener);
		act(() => r.ws.emit(ws1(2)));
		off();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("a failed refresh clears the snapshot (#X1)", async () => {
		respond(1);
		const r = renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(tabCountNow()).toBe(1));
		fetchMock.mockImplementation(async () => {
			throw new Error("offline");
		});
		r.setConnectionStatus("disconnected");
		r.setConnectionStatus("connected");
		await waitFor(() => expect(getRelayStatus()).toBeNull());
	});

	it("unmounting the feed clears the store (#F7)", async () => {
		respond(1);
		const r = renderWithPlugin(<span />, { connectionStatus: "connected" });
		await waitFor(() => expect(tabCountNow()).toBe(1));
		r.unmount();
		expect(getRelayStatus()).toBeNull();
	});
});
