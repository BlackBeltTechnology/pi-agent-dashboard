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
import { type FakeBrowserHost, installBrowserHost, makeFakeBrowserHost, renderWithPlugin } from "./test-utils.js";

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
	installBrowserHost(null);
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

// ── "This computer" block (change: add-operator-browser-relay; test-plan #E57 #E58) ──
describe("BrowserSettings — This computer block", () => {
	let host: FakeBrowserHost;
	const consent = (key: string, dir = "Default") => ({ key, serverOrigin: "http://dash.test:8000", profileDirectory: dir, grantedAt: 1_700_000_000_000 });

	beforeEach(() => {
		host = makeFakeBrowserHost({
			profiles: [
				{ profileDirectory: "Default", label: "Person 1", email: "me@example.test", installed: true },
				{ profileDirectory: "Profile 7", label: "Work", installed: false },
			],
		});
	});

	function baseFetch(extra: Record<string, unknown> = {}) {
		return installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: true, operatorHosts: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile() }, ...extra };
			return { entries: [] };
		});
	}

	it("#E57 plain browser (no browserHost): the block is absent", async () => {
		baseFetch();
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());
		expect(queryByTestId("browser-this-computer")).toBeNull();
		expect(host.identity).not.toHaveBeenCalled();
	});

	it("#E57 with browserHost: lists local profiles with installed state", async () => {
		installBrowserHost(host);
		baseFetch();
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-this-computer")).toBeTruthy());
		await waitFor(() => expect(getByTestId("browser-host-profile-Default")).toBeTruthy());
		expect(getByTestId("browser-host-profile-Default").textContent).toContain("Person 1");
		expect(getByTestId("browser-host-profile-Default").textContent).toContain("me@example.test");
		expect(getByTestId("browser-host-installed-Default").textContent).toMatch(/installed/i);
		expect(getByTestId("browser-host-installed-Default").textContent).not.toMatch(/not installed/i);
		expect(getByTestId("browser-host-installed-Profile 7").textContent).toMatch(/not installed/i);
	});

	it("#E57 token saved locally: setToken called, input cleared, no fetch/WS carries the token, never rendered", async () => {
		installBrowserHost(host);
		const fetchMock = baseFetch();
		const { getByTestId, container, send } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-host-token-input-Default")).toBeTruthy());
		const input = getByTestId("browser-host-token-input-Default") as HTMLInputElement;
		expect(input.type).toBe("password");
		expect((getByTestId("browser-host-token-save-Default") as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(input, { target: { value: "secret-tok" } });
		fireEvent.click(getByTestId("browser-host-token-save-Default"));

		await waitFor(() => expect(host.setToken).toHaveBeenCalledWith("Default", "secret-tok"));
		await waitFor(() => expect((getByTestId("browser-host-token-input-Default") as HTMLInputElement).value).toBe(""));
		// No HTTP request (URL, body) and no WS/plugin message carries the token.
		const wire = JSON.stringify([fetchMock.mock.calls, send.mock.calls]);
		expect(wire).not.toContain("secret-tok");
		expect(document.body.innerHTML).not.toContain("secret-tok");
		expect(container.textContent).not.toContain("secret-tok");
		// Not a dashboard-host token write either.
		expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/profile") && (i as RequestInit)?.method === "PUT")).toBe(false);
	});

	it("#E57 a failing setToken keeps the draft (so the user can retry) and shows an error", async () => {
		installBrowserHost(host);
		baseFetch();
		(host.setToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("untrusted"));
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-host-token-input-Default")).toBeTruthy());
		fireEvent.change(getByTestId("browser-host-token-input-Default"), { target: { value: "tok" } });
		fireEvent.click(getByTestId("browser-host-token-save-Default"));
		await waitFor(() => expect(getByTestId("browser-host-token-error-Default")).toBeTruthy());
		expect((getByTestId("browser-host-token-input-Default") as HTMLInputElement).value).toBe("tok");
	});

	it("#E57 stored consents list with Revoke: revokeConsent(key) and the row disappears", async () => {
		installBrowserHost(host);
		host.setConsents([consent("k1"), consent("k2", "Profile 7")]);
		baseFetch();
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-host-consent-k1")).toBeTruthy());
		expect(getByTestId("browser-host-consent-k1").textContent).toContain("http://dash.test:8000");
		expect(getByTestId("browser-host-consent-k1").textContent).toContain("Default");
		expect(getByTestId("browser-host-consent-k2")).toBeTruthy();

		fireEvent.click(getByTestId("browser-host-consent-revoke-k1"));
		await waitFor(() => expect(queryByTestId("browser-host-consent-k1")).toBeNull());
		expect(host.revokeConsent).toHaveBeenCalledWith("k1");
		expect(getByTestId("browser-host-consent-k2")).toBeTruthy();
	});

	it("no stored consents: an empty note, no Revoke buttons", async () => {
		installBrowserHost(host);
		baseFetch();
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-host-consents-empty")).toBeTruthy());
		expect(queryByTestId("browser-host-consent-revoke-k1")).toBeNull();
	});

	it("an unreachable main (identity rejects) hides the block instead of breaking settings", async () => {
		installBrowserHost(host);
		(host.identity as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("untrusted sender"));
		baseFetch();
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());
		await waitFor(() => expect(host.identity).toHaveBeenCalled());
		expect(queryByTestId("browser-this-computer")).toBeNull();
	});

	it("#E58 dashboard-host rows are unchanged and list no operator profiles", async () => {
		installBrowserHost(host);
		baseFetch({
			operatorHosts: [
				{
					hostId: "host-0123456789abcdef0123456789abcdef",
					label: "My Mac",
					platform: "darwin",
					online: true,
					canOpenChrome: true,
					profiles: [{ profileDirectory: "Profile 7", label: "Work", installed: true, instances: [liveInstance] }],
				},
			],
		});
		const { getByTestId, queryByTestId, container } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());
		await waitFor(() => expect(getByTestId("browser-this-computer")).toBeTruthy());

		// The unchanged dashboard row keeps its controls (token, zero-dialog, domains, connect, audit).
		for (const id of ["browser-token-input-OSS", "browser-zero-dialog-OSS", "browser-allowed-domains-OSS", "browser-connect-OSS", "browser-has-token-OSS"]) {
			expect(getByTestId(id), id).toBeTruthy();
		}
		// Operator profiles are never a dashboard row, and own no dashboard-host controls.
		expect(queryByTestId("browser-profile-Profile 7")).toBeNull();
		expect(queryByTestId("browser-token-input-Profile 7")).toBeNull();
		expect(queryByTestId("browser-connect-Profile 7")).toBeNull();
		expect(queryByTestId("browser-instance-i1")).toBeNull();
		// The only dashboard profile rows are the ones from `profiles`.
		expect(container.querySelectorAll('[data-testid^="browser-profile-"]:not([data-testid^="browser-profile-label"]):not([data-testid^="browser-profile-email"])')).toHaveLength(1);
	});

	it("canOpenChrome:false notice keeps its dashboard-host meaning with the block present", async () => {
		installBrowserHost(host);
		installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: false, operatorHosts: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile() }, operatorHosts: [] };
			return { entries: [] };
		});
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-cannot-open-chrome")).toBeTruthy());
		expect(queryByTestId("browser-connect-OSS")).toBeNull();
		await waitFor(() => expect(getByTestId("browser-this-computer")).toBeTruthy());
	});
});
