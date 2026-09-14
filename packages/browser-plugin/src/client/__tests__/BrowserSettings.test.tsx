/**
 * BrowserSettings RTL (change: add-browser-relay, task 4.1; test-plan F1–F3).
 * Covers the spec scenarios: extension not installed, token saved (write-only),
 * kill switch, and capability-missing.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSettings } from "../BrowserSettings.js";
import type {
	BrowserRouteInstance,
	BrowserRouteProfile,
} from "../browser-api.js";
import { renderWithPlugin } from "./test-utils.js";

function jsonOk(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ "content-type": "application/json" }),
		json: async () => body,
	} as unknown as Response;
}

function profile(over: Partial<BrowserRouteProfile> = {}): BrowserRouteProfile {
	return {
		profileDirectory: "OSS",
		label: "OSS",
		installed: true,
		hasToken: false,
		instances: [],
		...over,
	};
}

const liveInstance: BrowserRouteInstance = {
	instanceId: "i1",
	state: "connected",
	tabs: [{ tabId: 1, title: "Tab 1", url: "https://example.test", state: "live" }],
};

type FetchHandler = (url: string, init?: RequestInit) => unknown;

function installFetch(handler: FetchHandler) {
	const mock = vi.fn(async (url: string, init?: RequestInit) => jsonOk(handler(url, init)));
	(globalThis as { fetch?: unknown }).fetch = mock;
	return mock;
}

beforeEach(() => {
	vi.useRealTimers();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("BrowserSettings", () => {
	it("F1: not-installed row disables Connect and shows the Web Store link", async () => {
		installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile({ installed: false }) } };
			return { entries: [] };
		});

		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());

		expect((getByTestId("browser-connect-OSS") as HTMLButtonElement).disabled).toBe(true);
		const link = getByTestId("browser-store-link-OSS") as HTMLAnchorElement;
		expect(link.href).toContain("chromewebstore.google.com");
	});

	it("F2: saving a token clears the input, flips hasToken, and never renders the token", async () => {
		let saved = false;
		const fetchMock = installFetch((url, init) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile({ hasToken: saved }) } };
			if (url.endsWith("/profile")) {
				const body = JSON.parse(String(init?.body)) as { profileDirectory: string; token?: string };
				saved = body.token === "tok123";
				return { profileDirectory: body.profileDirectory, hasToken: saved };
			}
			return { entries: [] };
		});

		const { getByTestId, container, send } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());
		expect((getByTestId("browser-zero-dialog-OSS") as HTMLInputElement).disabled).toBe(true);

		fireEvent.change(getByTestId("browser-token-input-OSS"), {
			target: { value: "tok123" },
		});
		fireEvent.click(getByTestId("browser-token-save-OSS"));

		// Persists via the plugin's own server-side-merged route, NOT the generic
		// plugin_config_write (which would drop other profiles' tokens).
		await waitFor(() => {
			const put = fetchMock.mock.calls.find(
				([u, i]) => String(u).endsWith("/profile") && (i as RequestInit)?.method === "PUT",
			);
			expect(put, "a PUT /api/browser/profile was issued").toBeTruthy();
			expect(JSON.parse(String((put?.[1] as RequestInit)?.body))).toMatchObject({
				profileDirectory: "OSS",
				token: "tok123",
			});
		});
		expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "plugin_config_write" }));

		// Input clears and hasToken flips after the refetch.
		await waitFor(() =>
			expect((getByTestId("browser-token-input-OSS") as HTMLInputElement).value).toBe(""),
		);
		await waitFor(() => expect(getByTestId("browser-has-token-OSS").textContent).toBe("Token set"));
		expect((getByTestId("browser-zero-dialog-OSS") as HTMLInputElement).disabled).toBe(false);

		// The token is never rendered anywhere.
		expect(container.textContent).not.toContain("tok123");
		expect(document.body.innerHTML).not.toContain("tok123");
	});

	it("F3: the kill switch clears instances and disables Connect with the disabled reason", async () => {
		let enabled = true;
		installFetch((url, init) => {
			if (url.endsWith("/status")) return { enabled, canOpenChrome: true };
			if (url.includes("/profiles")) {
				return { profiles: { OSS: profile({ instances: enabled ? [liveInstance] : [] }) } };
			}
			if (url.endsWith("/enabled")) {
				enabled = Boolean((JSON.parse(String(init?.body)) as { enabled?: boolean }).enabled);
				return { enabled };
			}
			return { entries: [] };
		});

		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-instance-i1")).toBeTruthy());

		fireEvent.click(getByTestId("browser-enabled-toggle"));

		await waitFor(() => expect(queryByTestId("browser-instance-i1")).toBeNull());
		expect((getByTestId("browser-connect-OSS") as HTMLButtonElement).disabled).toBe(true);
		expect(getByTestId("browser-disabled-reason-OSS").textContent).toContain("disabled");
	});

	it("F3b: canOpenChrome:false renders a notice and no Connect buttons", async () => {
		installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: false };
			if (url.includes("/profiles")) return { profiles: { OSS: profile() } };
			return { entries: [] };
		});

		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());

		expect(getByTestId("browser-cannot-open-chrome")).toBeTruthy();
		expect(queryByTestId("browser-connect-OSS")).toBeNull();
	});
});
