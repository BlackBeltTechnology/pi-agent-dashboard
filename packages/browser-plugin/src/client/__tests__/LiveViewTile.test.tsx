/**
 * LiveViewTile RTL (change: add-browser-relay, task 4.3; test-plan F5–F9).
 * Covers tile lifecycle from the status tab list, frame rendering (≥5 src
 * changes), the no-frames + DevTools overlays, and coordinate normalization.
 */

import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveViewTile } from "../LiveViewTile.js";
import { __resetRelayStoreForTests } from "../relay-store.js";
import { renderWithPlugin, SESSION } from "./test-utils.js";

interface TabSpec {
	tabId: number;
	state?: "live" | "no-frames" | "detached" | "client-screencast-active";
	reason?: "devtools";
}

function status(
	instances: Array<{ instanceId: string; tabs: TabSpec[] }>,
	auditSeq = 0,
): BrowserRelayStatusMessage {
	return {
		type: "browser_relay_status",
		auditSeq,
		instances: instances.map((instance) => ({
			instanceId: instance.instanceId,
			profileDirectory: "OSS",
			state: "connected" as const,
			tabs: instance.tabs.map((tab) => ({
				tabId: tab.tabId,
				title: `Tab ${tab.tabId}`,
				url: "https://example.test",
				state: tab.state ?? ("live" as const),
				...(tab.reason ? { reason: tab.reason } : {}),
			})),
		})),
	};
}

function frame(n: number) {
	return {
		type: "browser_relay_frame" as const,
		instanceId: "i1",
		tabId: 1,
		jpegBase64: `frame${n}`,
		metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: n },
	};
}

function rect(width: number, height: number): DOMRect {
	return {
		left: 0,
		top: 0,
		width,
		height,
		right: width,
		bottom: height,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect;
}

function renderTile() {
	return renderWithPlugin(
		<LiveViewTile session={SESSION} routeParams={{}} onClose={vi.fn()} />,
	);
}

beforeEach(() => {
	__resetRelayStoreForTests();
});

afterEach(() => {
	cleanup();
	__resetRelayStoreForTests();
	vi.restoreAllMocks();
});

describe("LiveViewTile", () => {
	it("F9: the status tab list drives tiles and unsubscribes the removed tab", async () => {
		const { getByTestId, queryByTestId, ws, send } = renderTile();

		act(() => ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1 }] }])));
		await waitFor(() => expect(getByTestId("browser-tile-i1-1")).toBeTruthy());
		expect(queryByTestId("browser-tile-i1-2")).toBeNull();
		expect(send).toHaveBeenCalledWith({
			type: "browser_relay_subscribe",
			instanceId: "i1",
			tabId: 1,
		});

		act(() =>
			ws.emit(
				status([
					{
						instanceId: "i1",
						tabs: [{ tabId: 1 }, { tabId: 2 }],
					},
				]),
			),
		);
		await waitFor(() => expect(getByTestId("browser-tile-i1-2")).toBeTruthy());
		expect(getByTestId("browser-tile-i1-1")).toBeTruthy();

		send.mockClear();
		act(() =>
			ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 2 }] }])),
		);
		await waitFor(() => expect(queryByTestId("browser-tile-i1-1")).toBeNull());
		expect(send).toHaveBeenCalledWith({
			type: "browser_relay_unsubscribe",
			instanceId: "i1",
			tabId: 1,
		});
	});

	it("unmount sends unsubscribe for every open tile", async () => {
		const { getByTestId, ws, send, unmount } = renderTile();
		act(() => ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1 }] }])));
		await waitFor(() => expect(getByTestId("browser-tile-i1-1")).toBeTruthy());

		send.mockClear();
		unmount();
		expect(send).toHaveBeenCalledWith({
			type: "browser_relay_unsubscribe",
			instanceId: "i1",
			tabId: 1,
		});
	});

	it("F5: renders ≥5 JPEG frame src changes from browser_relay_frame", async () => {
		const { getByTestId, ws } = renderTile();
		act(() => ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1 }] }])));
		await waitFor(() => expect(getByTestId("browser-frame-waiting-i1-1")).toBeTruthy());

		const seen = new Set<string>();
		for (let n = 1; n <= 6; n++) {
			act(() => ws.emit(frame(n)));
			await waitFor(() =>
				expect((getByTestId("browser-frame-i1-1") as HTMLImageElement).src).toContain(`frame${n}`),
			);
			seen.add((getByTestId("browser-frame-i1-1") as HTMLImageElement).src);
		}
		expect(seen.size).toBe(6);
	});

	it("F6: no-frames overlay offers Bring to front, and live hides it", async () => {
		const { getByTestId, queryByTestId, ws, send } = renderTile();
		act(() =>
			ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1, state: "no-frames" }] }])),
		);
		await waitFor(() => expect(getByTestId("browser-overlay-noframes-i1-1")).toBeTruthy());
		expect(getByTestId("browser-overlay-noframes-i1-1").textContent).toContain("No repaints");

		fireEvent.click(getByTestId("browser-bring-to-front-i1-1"));
		expect(send).toHaveBeenCalledWith({
			type: "browser_relay_input",
			instanceId: "i1",
			tabId: 1,
			kind: "bringToFront",
		});

		act(() => ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1, state: "live" }] }])));
		await waitFor(() => expect(queryByTestId("browser-overlay-noframes-i1-1")).toBeNull());
	});

	it("F7: DevTools overlay blocks pointer and key input", async () => {
		const { getByTestId, ws, send } = renderTile();
		act(() =>
			ws.emit(
				status([
					{ instanceId: "i1", tabs: [{ tabId: 1, state: "detached", reason: "devtools" }] },
				]),
			),
		);
		await waitFor(() => expect(getByTestId("browser-overlay-devtools-i1-1")).toBeTruthy());
		expect(getByTestId("browser-overlay-devtools-i1-1").textContent).toContain("DevTools");

		send.mockClear();
		const tile = getByTestId("browser-tile-i1-1");
		tile.getBoundingClientRect = () => rect(320, 200);
		fireEvent.click(tile, { clientX: 10, clientY: 10 });
		fireEvent.mouseMove(tile, { clientX: 20, clientY: 20 });
		fireEvent.keyDown(tile, { key: "a" });
		fireEvent.wheel(tile, { deltaY: 10 });
		expect(send).not.toHaveBeenCalled();
	});

	it("F8 (BVA): coordinates normalize to [0,1] of the rendered 320×200 box", async () => {
		const { getByTestId, ws, send } = renderTile();
		act(() => ws.emit(status([{ instanceId: "i1", tabs: [{ tabId: 1 }] }])));
		await waitFor(() => expect(getByTestId("browser-tile-i1-1")).toBeTruthy());

		const tile = getByTestId("browser-tile-i1-1");
		tile.getBoundingClientRect = () => rect(320, 200);

		send.mockClear();
		fireEvent.click(tile, { clientX: 160, clientY: 100 });
		expect(send).toHaveBeenCalledWith({
			type: "browser_relay_input",
			instanceId: "i1",
			tabId: 1,
			kind: "mouse",
			x: 0.5,
			y: 0.5,
			action: "click",
			button: "left",
			clickCount: 1,
		});

		send.mockClear();
		fireEvent.click(tile, { clientX: 319, clientY: 199 });
		const sent = send.mock.calls[0][0] as { x: number; y: number };
		expect(sent.x).toBeCloseTo(0.996875, 5);
		expect(sent.y).toBeCloseTo(0.995, 5);
	});
});
