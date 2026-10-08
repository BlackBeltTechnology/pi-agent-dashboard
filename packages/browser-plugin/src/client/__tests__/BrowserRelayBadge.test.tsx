/**
 * BrowserRelayBadge RTL (change: add-browser-relay task 4.3; menu semantics from
 * add-browser-editor-pane-tab, test-plan #F13). The badge is the always-mounted
 * status feeder and the "open in pane" menu.
 */

import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", navigate] }));

import { BrowserRelayBadge } from "../BrowserRelayBadge.js";
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
	navigate.mockClear();
	vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ profiles: {} }) })));
});
afterEach(() => {
	cleanup();
	__resetRelayStoreForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function mount(tabCount: number, wrapper?: (ui: React.ReactElement) => React.ReactElement) {
	const ui = <BrowserRelayBadge session={SESSION} />;
	const r = renderWithPlugin(wrapper ? wrapper(ui) : ui);
	act(() => r.ws.emit(status(tabCount)));
	await waitFor(() => expect(r.getByTestId("browser-relay-badge")).toBeTruthy());
	return r;
}

describe("BrowserRelayBadge", () => {
	it("hides with no live instance and appears once one has a tab", async () => {
		const { queryByTestId, getByTestId, ws } = renderWithPlugin(<BrowserRelayBadge session={SESSION} />);
		expect(queryByTestId("browser-relay-badge")).toBeNull();
		act(() => ws.emit(status(2)));
		await waitFor(() => expect(getByTestId("browser-relay-badge").textContent).toBe("2 browser tabs"));
		expect(getRelayStatus()?.instances).toHaveLength(1);
		act(() => ws.emit(status(0)));
		await waitFor(() => expect(queryByTestId("browser-relay-badge")).toBeNull());
	});

	it("is a menu button whose aria-label names the action and keeps the visible label", async () => {
		const { getByTestId } = await mount(1);
		const badge = getByTestId("browser-relay-badge");
		expect(badge.tagName).toBe("BUTTON");
		expect(badge.getAttribute("aria-haspopup")).toBe("menu");
		expect(badge.getAttribute("aria-expanded")).toBe("false");
		expect(badge.getAttribute("aria-label")).toBe("1 browser tabs — Open browser tabs in the pane");
	});

	it("#F1/#F13 opening the menu never navigates or selects the card; 'Open in pane' is ONE navigation to that session's editor tab", async () => {
		const onCardClick = vi.fn();
		// biome-ignore lint/a11y/useKeyWithClickEvents: test stand-in for the session card
		const { getByTestId, queryByTestId } = await mount(2, (ui) => <div onClick={onCardClick}>{ui}</div>);
		fireEvent.click(getByTestId("browser-relay-badge"));
		expect(getByTestId("browser-relay-badge").getAttribute("aria-expanded")).toBe("true");
		expect(navigate).not.toHaveBeenCalled();
		expect(onCardClick).not.toHaveBeenCalled();

		fireEvent.click(getByTestId("browser-relay-open-i1-2"));
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate.mock.calls[0][0]).toBe("/session/s1/editor?tab=browser%3Ai1%3A2");
		expect(navigate.mock.calls[0][1].state.openNonce).toBeTruthy();
		expect(onCardClick).not.toHaveBeenCalled();
		expect(queryByTestId("browser-relay-menu")).toBeNull(); // closes after acting
	});

	it("#F13 'Open all in pane' is one navigation with every tab in list order (last = active)", async () => {
		const { getByTestId } = await mount(2);
		fireEvent.click(getByTestId("browser-relay-badge"));
		fireEvent.click(getByTestId("browser-relay-open-all"));
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate.mock.calls[0][0]).toBe("/session/s1/editor?tab=browser%3Ai1%3A1&tab=browser%3Ai1%3A2");
	});

	it("#F13 keyboard: ArrowDown opens, focus lands on the first item, arrows traverse (wrapping), Escape closes and refocuses", async () => {
		const { getByTestId, getAllByRole, queryByTestId } = await mount(2);
		const badge = getByTestId("browser-relay-badge");
		badge.focus();
		fireEvent.keyDown(badge, { key: "ArrowDown" });
		const items = () => getAllByRole("menuitem");
		await waitFor(() => expect(document.activeElement).toBe(items()[0]));
		const menu = getByTestId("browser-relay-menu");
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement).toBe(items()[1]);
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement).toBe(items()[2]); // "Open all"
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement).toBe(items()[0]); // wraps
		fireEvent.keyDown(menu, { key: "ArrowUp" });
		expect(document.activeElement).toBe(items()[2]);
		fireEvent.keyDown(menu, { key: "Escape" });
		expect(queryByTestId("browser-relay-menu")).toBeNull();
		expect(document.activeElement).toBe(badge);
	});

	it("an outside press closes the menu", async () => {
		const { getByTestId, queryByTestId } = await mount(1);
		fireEvent.click(getByTestId("browser-relay-badge"));
		expect(getByTestId("browser-relay-menu")).toBeTruthy();
		fireEvent.mouseDown(document.body);
		expect(queryByTestId("browser-relay-menu")).toBeNull();
	});
});
