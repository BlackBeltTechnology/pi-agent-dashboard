/**
 * BrowserSettings RTL (change: add-browser-relay, task 4.1; test-plan F1–F3).
 * Covers the spec scenarios: extension not installed, token saved (write-only),
 * kill switch, and capability-missing.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSettings } from "../BrowserSettings.js";
import type {
	BrowserRouteInstance,
	BrowserRouteProfile,
	DedicatedStatus,
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
	it("F1: not-installed row has no Connect and shows the Web Store link", async () => {
		installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile({ installed: false }) } };
			return { entries: [] };
		});

		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-profile-OSS")).toBeTruthy());

		// The disabled Connect on uninstalled rows is retired (design D12): the row
		// sits behind the "without the extension" disclosure with only the store link.
		expect(queryByTestId("browser-connect-OSS")).toBeNull();
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


// ── Dedicated agent browser (change: add-dedicated-agent-browser; test-plan #F6–#F12) ──
function dedicated(over: Partial<DedicatedStatus> = {}): DedicatedStatus {
	return {
		available: true,
		state: "stopped",
		dataDir: "/home/u/.pi/dashboard/agent-chrome",
		downloadsDir: "/home/u/.pi/dashboard/agent-chrome-downloads",
		...over,
	};
}

interface DabFixture {
	enabled?: boolean;
	canOpenChrome?: boolean;
	dedicated?: DedicatedStatus;
	settings?: Record<string, unknown>;
	profiles?: Record<string, BrowserRouteProfile>;
}

function installDab(fx: DabFixture = {}) {
	return installFetch((url) => {
		if (url.endsWith("/status")) {
			return {
				enabled: fx.enabled ?? true,
				canOpenChrome: fx.canOpenChrome ?? true,
				dedicated: fx.dedicated ?? dedicated(),
				...(fx.settings ? { settings: fx.settings } : {}),
			};
		}
		if (url.includes("/profiles")) return { profiles: fx.profiles ?? { OSS: profile() } };
		return { entries: [] };
	});
}

const writes = (mock: ReturnType<typeof installFetch>, suffix: string, method = "POST") =>
	mock.mock.calls.filter(
		([u, i]) => String(u).endsWith(suffix) && (i as RequestInit | undefined)?.method === method,
	);

describe("BrowserSettings — dedicated profile panel", () => {
	const sessions = [{ id: "S1", cwd: "/tmp", name: "fix login flow" }] as unknown as DashboardSession[];

	it("#F6 not-created: offers Create and open to sign in, no Reset", async () => {
		installDab({ dedicated: dedicated({ state: "not-created" }) });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-panel")).toBeTruthy());
		expect(getByTestId("browser-dedicated-open").textContent).toBe("Create and open to sign in");
		expect((getByTestId("browser-dedicated-open") as HTMLButtonElement).disabled).toBe(false);
		expect(queryByTestId("browser-dedicated-reset")).toBeNull();
		expect(queryByTestId("browser-dedicated-stop")).toBeNull();
	});

	it("#F6 stopped: Open and Reset enabled, no Stop; shows last used, size and data dir", async () => {
		installDab({ dedicated: dedicated({ state: "stopped", sizeBytes: 412 * 1024 * 1024, lastUsed: Date.now() - 3 * 60_000 }) });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-panel")).toBeTruthy());
		expect(getByTestId("browser-dedicated-open").textContent).toBe("Open to sign in");
		expect((getByTestId("browser-dedicated-open") as HTMLButtonElement).disabled).toBe(false);
		expect((getByTestId("browser-dedicated-reset") as HTMLButtonElement).disabled).toBe(false);
		expect(queryByTestId("browser-dedicated-stop")).toBeNull();
		expect(getByTestId("browser-dedicated-size").textContent).toContain("412 MB");
		expect(getByTestId("browser-dedicated-last-used").textContent).toMatch(/3 minutes ago/);
		expect(getByTestId("browser-dedicated-data-dir").textContent).toContain("/home/u/.pi/dashboard/agent-chrome");
		expect(getByTestId("browser-dedicated-panel").textContent).toMatch(/one session at a time/i);
	});

	it("#F6 running + holder session: shows its display name; Stop enabled, Reset disabled", async () => {
		installDab({ dedicated: dedicated({ state: "running", instanceId: "d1", holder: { sessionId: "S1" } }) });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />, { sessions });
		await waitFor(() => expect(getByTestId("browser-dedicated-panel")).toBeTruthy());
		expect(getByTestId("browser-dedicated-status").textContent).toContain("fix login flow");
		expect((getByTestId("browser-dedicated-open") as HTMLButtonElement).disabled).toBe(false);
		expect((getByTestId("browser-dedicated-stop") as HTMLButtonElement).disabled).toBe(false);
		expect((getByTestId("browser-dedicated-reset") as HTMLButtonElement).disabled).toBe(true);
	});

	it("#F6 running + REST client label: shows the label; unresolvable session falls back to its id", async () => {
		installDab({ dedicated: dedicated({ state: "running", holder: { client: "gmail-setup" } }) });
		const first = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(first.getByTestId("browser-dedicated-status").textContent).toContain("gmail-setup"));
		first.unmount();

		installDab({ dedicated: dedicated({ state: "running", holder: { sessionId: "gone-session" } }) });
		const second = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(second.getByTestId("browser-dedicated-status").textContent).toContain("gone-session"));
	});

	it("#F6 unavailable: shows the reason and no buttons", async () => {
		installDab({ dedicated: dedicated({ available: false, reason: "no-chrome" }) });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-reason")).toBeTruthy());
		expect(getByTestId("browser-dedicated-reason").textContent).toMatch(/desktop Google Chrome/);
		for (const id of ["open", "stop", "reset"]) expect(queryByTestId(`browser-dedicated-${id}`)).toBeNull();
	});

	it("#F6 no-display reason is distinct from no-chrome", async () => {
		installDab({ dedicated: dedicated({ available: false, reason: "no-display" }) });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-reason").textContent).toMatch(/no display/i));
	});

	it("#F6 Open to sign in posts to dedicated/open; Stop posts to dedicated/stop", async () => {
		const mock = installDab({ dedicated: dedicated({ state: "running" }) });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-open")).toBeTruthy());
		fireEvent.click(getByTestId("browser-dedicated-open"));
		await waitFor(() => expect(writes(mock, "/dedicated/open")).toHaveLength(1));
		fireEvent.click(getByTestId("browser-dedicated-stop"));
		await waitFor(() => expect(writes(mock, "/dedicated/stop")).toHaveLength(1));
	});

	it("#F6 a failing action shows an alert instead of throwing", async () => {
		let fail = false;
		(globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "POST" && String(url).includes("/dedicated/")) {
				fail = true;
				return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
			}
			if (String(url).endsWith("/status")) return jsonOk({ enabled: true, canOpenChrome: true, dedicated: dedicated() });
			if (String(url).includes("/profiles")) return jsonOk({ profiles: { OSS: profile() } });
			return jsonOk({ entries: [] });
		});
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-open")).toBeTruthy());
		fireEvent.click(getByTestId("browser-dedicated-open"));
		await waitFor(() => expect(getByTestId("browser-dedicated-error").getAttribute("role")).toBe("alert"));
		expect(fail).toBe(true);
	});

	it("#F7 plugin disabled: Agent browsing read-only with the reason; panel stopped, every action disabled", async () => {
		installDab({ enabled: false, dedicated: dedicated({ state: "running", holder: { client: "x" } }) });
		const { getByTestId, container } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		expect(getByTestId("browser-agent-browsing-disabled").textContent).toContain("Browser relay disabled");
		const group = getByTestId("browser-agent-browsing");
		const controls = group.querySelectorAll("input, select");
		expect(controls.length).toBeGreaterThan(5);
		for (const c of controls) expect((c as HTMLInputElement).disabled, c.getAttribute("data-testid") ?? c.outerHTML).toBe(true);

		expect(getByTestId("browser-dedicated-state").textContent).toMatch(/stopped/i);
		const panel = getByTestId("browser-dedicated-panel");
		const buttons = panel.querySelectorAll("button");
		expect(buttons.length).toBeGreaterThan(0);
		for (const b of buttons) expect((b as HTMLButtonElement).disabled, b.textContent ?? "").toBe(true);
		// The kill switch itself stays operable.
		expect((getByTestId("browser-enabled-toggle") as HTMLInputElement).disabled).toBe(false);
		expect(container.querySelector('[data-testid="browser-dedicated-stop"]')).toBeNull();
	});

	it("#F8 Reset needs a confirmation: Cancel sends nothing, confirm sends exactly one reset", async () => {
		const mock = installDab({ dedicated: dedicated({ state: "stopped" }) });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-reset")).toBeTruthy());
		expect(getByTestId("browser-dedicated-reset").textContent).toBe("Reset profile…");

		fireEvent.click(getByTestId("browser-dedicated-reset"));
		const dialog = getByTestId("browser-dedicated-reset-dialog");
		expect(dialog.getAttribute("role")).toBe("alertdialog");
		expect(dialog.textContent).toMatch(/cookies, logins and history/);
		fireEvent.click(getByTestId("browser-dedicated-reset-cancel"));
		expect(queryByTestId("browser-dedicated-reset-dialog")).toBeNull();
		expect(writes(mock, "/dedicated/reset")).toHaveLength(0);

		fireEvent.click(getByTestId("browser-dedicated-reset"));
		fireEvent.click(getByTestId("browser-dedicated-reset-confirm"));
		await waitFor(() => expect(writes(mock, "/dedicated/reset")).toHaveLength(1));
		await waitFor(() => expect(queryByTestId("browser-dedicated-reset-dialog")).toBeNull());
	});

	it("#F8 Escape closes the confirmation without a request", async () => {
		const mock = installDab({ dedicated: dedicated({ state: "stopped" }) });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-dedicated-reset")).toBeTruthy());
		fireEvent.click(getByTestId("browser-dedicated-reset"));
		fireEvent.keyDown(getByTestId("browser-dedicated-reset-dialog"), { key: "Escape" });
		expect(queryByTestId("browser-dedicated-reset-dialog")).toBeNull();
		expect(writes(mock, "/dedicated/reset")).toHaveLength(0);
	});

	it("older server without status.dedicated: panel hidden, dedicated choice disabled", async () => {
		installFetch((url) => {
			if (url.endsWith("/status")) return { enabled: true, canOpenChrome: true };
			if (url.includes("/profiles")) return { profiles: { OSS: profile() } };
			return { entries: [] };
		});
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		expect(queryByTestId("browser-dedicated-panel")).toBeNull();
		expect((getByTestId("browser-default-dedicated") as HTMLInputElement).disabled).toBe(true);
	});

	it("#F11 the dedicated panel shows the @dedicated audit list", async () => {
		const fetchMock = installDab({ dedicated: dedicated() });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-audit-empty-@dedicated")).toBeTruthy());
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/audit?profile=%40dedicated"))).toBe(true);
	});
});

describe("BrowserSettings — profile list", () => {
	const row = (dir: string, over: Partial<BrowserRouteProfile> = {}) =>
		profile({ profileDirectory: dir, label: `L-${dir}`, ...over });

	function listFixture(): Record<string, BrowserRouteProfile> {
		return {
			"Profile 21": row("Profile 21", { email: "a@b.test", passwordManagers: ["LastPass"], hasToken: true }),
			OSS: row("OSS"),
			"Profile 99": row("Profile 99", { instances: [liveInstance] }),
			"Profile 31": row("Profile 31", { installed: false }),
			"Profile 32": row("Profile 32", { installed: false }),
			"Profile 33": row("Profile 33", { installed: false }),
		};
	}

	it("#F9 installed + synthetic rows keep every testid; uninstalled sit behind one disclosure with store links and no Connect", async () => {
		installDab({ profiles: listFixture() });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-installed-profiles")).toBeTruthy());

		const installedList = getByTestId("browser-installed-profiles");
		for (const dir of ["Profile 21", "OSS", "Profile 99"]) {
			const rowEl = getByTestId(`browser-profile-${dir}`);
			expect(installedList.contains(rowEl), dir).toBe(true);
			for (const id of [
				"browser-token-input",
				"browser-token-save",
				"browser-zero-dialog",
				"browser-allowed-domains",
				"browser-connect",
				"browser-profile-label",
				"browser-installed",
				"browser-has-token",
				"browser-connected",
			]) {
				expect(within(rowEl).getByTestId(`${id}-${dir}`), `${id}-${dir}`).toBeTruthy();
			}
			expect(within(rowEl).getByTestId(`browser-audit-empty-${dir}`), `audit-${dir}`).toBeTruthy();
		}
		expect(within(getByTestId("browser-profile-Profile 21")).getByTestId("browser-profile-email-Profile 21")).toBeTruthy();
		expect(getByTestId("browser-instance-i1")).toBeTruthy();
		expect(getByTestId("browser-disconnect-i1")).toBeTruthy();

		// LastPass warning on the first row only.
		const warn = within(getByTestId("browser-profile-Profile 21")).getByTestId("browser-password-manager-Profile 21");
		expect(warn.textContent).toContain("LastPass");
		expect(warn.textContent).toMatch(/disconnects on pages with a password field/);
		expect(queryByTestId("browser-password-manager-OSS")).toBeNull();

		// One disclosure for the three uninstalled profiles.
		const disclosure = getByTestId("browser-uninstalled-disclosure");
		expect(disclosure.textContent).toContain("3 more profiles without the extension");
		const uninstalled = getByTestId("browser-uninstalled-profiles");
		for (const dir of ["Profile 31", "Profile 32", "Profile 33"]) {
			expect(uninstalled.contains(getByTestId(`browser-store-link-${dir}`))).toBe(true);
			expect((getByTestId(`browser-store-link-${dir}`) as HTMLAnchorElement).href).toContain("chromewebstore.google.com");
			expect(queryByTestId(`browser-connect-${dir}`)).toBeNull();
			expect(queryByTestId(`browser-token-input-${dir}`)).toBeNull();
		}
		expect(uninstalled.querySelectorAll("button")).toHaveLength(0);
	});

	it("#F9 per-profile domains: placeholder names the global list; help states the guardrail", async () => {
		installDab({ profiles: { OSS: row("OSS") } });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-allowed-domains-OSS")).toBeTruthy());
		expect((getByTestId("browser-allowed-domains-OSS") as HTMLInputElement).placeholder).toMatch(/global list applies/i);
		expect(getByTestId("browser-profile-OSS").textContent).toMatch(/scripts, link clicks and redirects/);
	});

	it("#F9 singular disclosure label for one uninstalled profile; none when all installed", async () => {
		installDab({ profiles: { OSS: row("OSS"), P2: row("P2", { installed: false }) } });
		const first = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(first.getByTestId("browser-uninstalled-disclosure").textContent).toContain("1 more profile without the extension"));
		first.unmount();
		installDab({ profiles: { OSS: row("OSS") } });
		const second = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(second.getByTestId("browser-profile-OSS")).toBeTruthy());
		expect(second.queryByTestId("browser-uninstalled-disclosure")).toBeNull();
	});

	it("#F10 canOpenChrome:false with dedicated available: profile-list notice, no Connect, dedicated choice enabled", async () => {
		installDab({ canOpenChrome: false, dedicated: dedicated(), profiles: { OSS: row("OSS") } });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-cannot-open-chrome")).toBeTruthy());
		expect(getByTestId("browser-installed-profiles").contains(getByTestId("browser-profile-OSS"))).toBe(true);
		expect(queryByTestId("browser-connect-OSS")).toBeNull();
		expect((getByTestId("browser-default-dedicated") as HTMLInputElement).disabled).toBe(false);
		expect((getByTestId("browser-default-real") as HTMLInputElement).disabled).toBe(true);
		// Dedicated panel follows status.dedicated only.
		expect((getByTestId("browser-dedicated-open") as HTMLButtonElement).disabled).toBe(false);
	});

	it("#F10 dedicated unavailable with canOpenChrome: profile rows normal, dedicated choice disabled", async () => {
		installDab({ canOpenChrome: true, dedicated: dedicated({ available: false, reason: "no-display" }), profiles: { OSS: row("OSS") } });
		const { getByTestId, queryByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-connect-OSS")).toBeTruthy());
		expect(queryByTestId("browser-cannot-open-chrome")).toBeNull();
		expect((getByTestId("browser-connect-OSS") as HTMLButtonElement).disabled).toBe(false);
		expect((getByTestId("browser-default-dedicated") as HTMLInputElement).disabled).toBe(true);
		expect((getByTestId("browser-default-real") as HTMLInputElement).disabled).toBe(false);
	});
});

describe("BrowserSettings — Agent browsing group", () => {
	const twoProfiles = () => ({
		"Profile 21": profile({ profileDirectory: "Profile 21", label: "Work", email: "w@x.test" }),
		"Profile 37": profile({ profileDirectory: "Profile 37", label: "OSS" }),
	});
	const lastBody = (mock: ReturnType<typeof installFetch>) => {
		const calls = writes(mock, "/settings", "PUT");
		const last = calls[calls.length - 1];
		return JSON.parse(String((last?.[1] as RequestInit | undefined)?.body));
	};

	it("renders the current values from status.settings", async () => {
		installDab({
			profiles: twoProfiles(),
			settings: {
				defaultBrowser: "@headless",
				onUnavailable: "next",
				idleDisconnectMinutes: 120,
				allowMultipleInstancesPerProfile: true,
				openLiveViewOnConnect: false,
				allowedDomains: ["google.com", "github.com"],
			},
		});
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		expect((getByTestId("browser-default-headless") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-on-unavailable-next") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-idle-select") as HTMLSelectElement).value).toBe("120");
		expect((getByTestId("browser-multi-several") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-live-view") as HTMLInputElement).checked).toBe(false);
		expect((getByTestId("browser-global-domains") as HTMLInputElement).value).toBe("google.com, github.com");
	});

	it("defaults apply when nothing is stored: dedicated, ask, 30 min, one, live view on", async () => {
		installDab({ profiles: twoProfiles() });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		expect((getByTestId("browser-default-dedicated") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-on-unavailable-ask") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-idle-select") as HTMLSelectElement).value).toBe("30");
		expect((getByTestId("browser-multi-one") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-live-view") as HTMLInputElement).checked).toBe(true);
		expect((getByTestId("browser-global-domains") as HTMLInputElement).value).toBe("");
	});

	it("#F12 picking One of my Chrome profiles with Profile 21 sends one PUT with defaultBrowser and realProfile", async () => {
		const mock = installDab({ profiles: twoProfiles() });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-real-profile-select")).toBeTruthy());
		fireEvent.change(getByTestId("browser-real-profile-select"), { target: { value: "Profile 21" } });
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(1));
		expect(lastBody(mock)).toEqual({ defaultBrowser: "Profile 21", realProfile: "Profile 21" });
	});

	it("#F12 selecting the real-profile radio uses the picker's profile (realProfile preselected)", async () => {
		const mock = installDab({ profiles: twoProfiles(), settings: { defaultBrowser: "@dedicated", realProfile: "Profile 37" } });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect((getByTestId("browser-real-profile-select") as HTMLSelectElement).value).toBe("Profile 37"));
		fireEvent.click(getByTestId("browser-default-real"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(1));
		expect(lastBody(mock)).toEqual({ defaultBrowser: "Profile 37", realProfile: "Profile 37" });
	});

	it("choosing dedicated or headless writes only defaultBrowser (realProfile is kept)", async () => {
		const mock = installDab({ profiles: twoProfiles(), settings: { defaultBrowser: "Profile 21", realProfile: "Profile 21" } });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect((getByTestId("browser-default-real") as HTMLInputElement).checked).toBe(true));
		fireEvent.click(getByTestId("browser-default-dedicated"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(1));
		expect(lastBody(mock)).toEqual({ defaultBrowser: "@dedicated" });
		fireEvent.click(getByTestId("browser-default-headless"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(2));
		expect(lastBody(mock)).toEqual({ defaultBrowser: "@headless" });
	});

	it("each remaining control writes its own key", async () => {
		const mock = installDab({ profiles: twoProfiles() });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());

		fireEvent.click(getByTestId("browser-on-unavailable-stop"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(1));
		expect(lastBody(mock)).toEqual({ onUnavailable: "stop" });

		fireEvent.change(getByTestId("browser-idle-select"), { target: { value: "0" } });
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(2));
		expect(lastBody(mock)).toEqual({ idleDisconnectMinutes: 0 });

		fireEvent.click(getByTestId("browser-multi-several"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(3));
		expect(lastBody(mock)).toEqual({ allowMultipleInstancesPerProfile: true });

		fireEvent.click(getByTestId("browser-live-view"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(4));
		expect(lastBody(mock)).toEqual({ openLiveViewOnConnect: false });

		fireEvent.change(getByTestId("browser-global-domains"), { target: { value: " google.com ,, github.com " } });
		fireEvent.blur(getByTestId("browser-global-domains"));
		await waitFor(() => expect(writes(mock, "/settings", "PUT")).toHaveLength(5));
		expect(lastBody(mock)).toEqual({ allowedDomains: ["google.com", "github.com"] });

		// Unchanged domains on blur: no request.
		fireEvent.blur(getByTestId("browser-global-domains"));
		expect(writes(mock, "/settings", "PUT")).toHaveLength(5);
	});

	it("a rejected write shows an alert and restores the stored value", async () => {
		(globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "PUT" && String(url).endsWith("/settings")) {
				return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
			}
			if (String(url).endsWith("/status")) return jsonOk({ enabled: true, canOpenChrome: true, dedicated: dedicated() });
			if (String(url).includes("/profiles")) return jsonOk({ profiles: twoProfiles() });
			return jsonOk({ entries: [] });
		});
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		fireEvent.click(getByTestId("browser-on-unavailable-stop"));
		await waitFor(() => expect(getByTestId("browser-agent-browsing-error").getAttribute("role")).toBe("alert"));
		expect((getByTestId("browser-on-unavailable-ask") as HTMLInputElement).checked).toBe(true);
	});

	it("the saved value shows after a write even before the server echoes settings", async () => {
		installDab({ profiles: twoProfiles() });
		const { getByTestId } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		fireEvent.click(getByTestId("browser-on-unavailable-next"));
		await waitFor(() => expect((getByTestId("browser-on-unavailable-next") as HTMLInputElement).checked).toBe(true));
	});

	it("the radio groups are labelled for assistive tech", async () => {
		installDab({ profiles: twoProfiles() });
		const { getByTestId, getAllByRole } = renderWithPlugin(<BrowserSettings />);
		await waitFor(() => expect(getByTestId("browser-agent-browsing")).toBeTruthy());
		const groups = getAllByRole("radiogroup");
		expect(groups.length).toBeGreaterThanOrEqual(2);
		for (const g of groups) expect(g.getAttribute("aria-labelledby")).toBeTruthy();
		expect(getByTestId("browser-real-profile-select").getAttribute("aria-label")).toBeTruthy();
	});
});
