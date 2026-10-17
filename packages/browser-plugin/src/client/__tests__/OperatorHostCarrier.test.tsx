/**
 * OperatorHostCarrier RTL (change: add-operator-browser-relay, tasks 3.1, 3.2,
 * 3.7; test-plan #E8 #E9 #F1 + the IPC <-> `browser_host_*` bridge of task 8.1).
 *
 * The carrier bridges `window.piDashboard.browserHost` (Electron main) and the
 * dashboard `/ws`. `FakeWs` + `makeFakeBrowserHost` stand in for both ends.
 */
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_REGISTER_TIMEOUT_MS, OperatorHostCarrier } from "../OperatorHostCarrier.js";
import { __resetRelayStoreForTests, getOperatorHostId } from "../relay-store.js";
import {
	FAKE_HOST_ID,
	type FakeBrowserHost,
	FakeWs,
	installBrowserHost,
	makeFakeBrowserHost,
	renderWithPlugin,
} from "./test-utils.js";

let host: FakeBrowserHost;
let statusBody: Record<string, unknown>;
let statusCalls: number;

beforeEach(() => {
	__resetRelayStoreForTests();
	host = makeFakeBrowserHost();
	installBrowserHost(host);
	statusBody = { enabled: true, canOpenChrome: true, operatorHosts: true };
	statusCalls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (String(url).endsWith("/api/browser/status")) {
				statusCalls += 1;
				return { ok: true, json: async () => statusBody };
			}
			return { ok: true, json: async () => ({ profiles: {} }) };
		}),
	);
});
afterEach(() => {
	cleanup();
	installBrowserHost(null);
	__resetRelayStoreForTests();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const allSent = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map((c) => c[0] as { type: string });
const hostMsgs = (send: ReturnType<typeof vi.fn>) => allSent(send).filter((m) => m.type.startsWith("browser_host_"));
const ofType = (send: ReturnType<typeof vi.fn>, type: string) => allSent(send).filter((m) => m.type === type);

/** `PluginContextProvider` itself listens for `plugin_config_update` on the socket. */
const PROVIDER_LISTENERS = 1;

const mount = () => renderWithPlugin(<OperatorHostCarrier />, { feed: false, connectionStatus: "connected" });

/** Drive hello → challenge → register → registered and wait until the carrier is bridged. */
async function register(r: ReturnType<typeof mount>, nonce = "n1", serverId = "srv-1") {
	await waitFor(() => expect(ofType(r.send, "browser_host_hello").length).toBeGreaterThan(0));
	act(() => r.ws.emit({ type: "browser_host_challenge", nonce, serverId }));
	await waitFor(() => expect(ofType(r.send, "browser_host_register").length).toBeGreaterThan(0));
	act(() => r.ws.emit({ type: "browser_host_registered", hostId: FAKE_HOST_ID }));
	await waitFor(() => expect(getOperatorHostId()).toBe(FAKE_HOST_ID));
}

describe("gating (#E8 #E9)", () => {
	it("#E8 older server (no operatorHosts in status): zero browser_host_* messages, no IPC", async () => {
		statusBody = { enabled: true, canOpenChrome: true };
		const r = mount();
		await waitFor(() => expect(statusCalls).toBeGreaterThan(0));
		await act(async () => {});
		expect(hostMsgs(r.send)).toEqual([]);
		expect(host.identity).not.toHaveBeenCalled();
		expect(host.setTarget).not.toHaveBeenCalled();
		expect(getOperatorHostId()).toBeNull();
	});

	it("a status without a literal `true` (string, missing body, failed fetch) never registers", async () => {
		for (const body of [{ operatorHosts: "true" }, { operatorHosts: false }, {}]) {
			statusBody = body;
			const r = mount();
			await waitFor(() => expect(statusCalls).toBeGreaterThan(0));
			await act(async () => {});
			expect(hostMsgs(r.send)).toEqual([]);
			r.unmount();
			statusCalls = 0;
		}
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			throw new Error("offline");
		});
		const r = mount();
		await act(async () => {});
		expect(hostMsgs(r.send)).toEqual([]);
	});

	it("#E9 no window.piDashboard.browserHost: no status probe, no browser_host_* message, no IPC", async () => {
		installBrowserHost(null);
		const r = mount();
		await act(async () => {});
		expect(statusCalls).toBe(0);
		expect(hostMsgs(r.send)).toEqual([]);
		expect(host.identity).not.toHaveBeenCalled();
		expect(host.onConnect).not.toHaveBeenCalled();
		expect(host.onExt).not.toHaveBeenCalled();
		expect(r.ws.listenerCount).toBe(PROVIDER_LISTENERS);
	});

	it("does nothing while the shell socket is not connected", async () => {
		const r = renderWithPlugin(<OperatorHostCarrier />, { feed: false, connectionStatus: "connecting" });
		await act(async () => {});
		expect(statusCalls).toBe(0);
		expect(hostMsgs(r.send)).toEqual([]);
	});
});

describe("registration (D2)", () => {
	it("sets the target, then hello → challenge → signed register → registered", async () => {
		const r = mount();
		await register(r, "nonce-9", "srv-9");

		expect(host.setTarget).toHaveBeenCalledWith("http://dash.test:8000");
		expect(host.sign).toHaveBeenCalledWith("nonce-9", "srv-9");
		const hello = ofType(r.send, "browser_host_hello")[0];
		expect(hello).toEqual({ type: "browser_host_hello", hostId: FAKE_HOST_ID, publicKey: "PUBKEY" });
		expect(ofType(r.send, "browser_host_register")[0]).toEqual({
			type: "browser_host_register",
			hostId: FAKE_HOST_ID,
			signature: "sig(nonce-9|srv-9)",
			label: "My Mac",
			platform: "darwin",
			canOpenChrome: true,
			profiles: [{ profileDirectory: "Default", label: "Person 1", installed: true }],
		});
		// The private key / token never cross: only the contract's fields were sent.
		expect(JSON.stringify(hostMsgs(r.send))).not.toMatch(/privateKey|token/i);
		// setTarget happens before the hello (main clears the target on navigation).
		const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
		expect(order(host.setTarget as unknown as ReturnType<typeof vi.fn>)).toBeLessThan(
			r.send.mock.invocationCallOrder[allSent(r.send).findIndex((m) => m.type === "browser_host_hello")],
		);
	});

	it("maps a wss:// socket to an https:// target origin", async () => {
		const ws = new FakeWs("wss://tunnel.example.com/ws?ticket=SECRET");
		renderWithPlugin(<OperatorHostCarrier />, { feed: false, connectionStatus: "connected", ws });
		await waitFor(() => expect(host.setTarget).toHaveBeenCalledWith("https://tunnel.example.com"));
		// The ticket query never reaches main.
		expect(JSON.stringify((host.setTarget as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("SECRET");
	});

	it("a challenge whose serverId main refuses to sign yields no register and no host id", async () => {
		(host.sign as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("server id mismatch"));
		const r = mount();
		await waitFor(() => expect(ofType(r.send, "browser_host_hello")).toHaveLength(1));
		act(() => r.ws.emit({ type: "browser_host_challenge", nonce: "n", serverId: "evil" }));
		await waitFor(() => expect(host.sign).toHaveBeenCalled());
		await act(async () => {});
		expect(ofType(r.send, "browser_host_register")).toEqual([]);
		expect(getOperatorHostId()).toBeNull();
	});

	it("an unsolicited challenge (no hello in flight) is ignored", async () => {
		statusBody = { operatorHosts: true };
		const r = mount();
		await register(r);
		const before = ofType(r.send, "browser_host_register").length;
		act(() => r.ws.emit({ type: "browser_host_challenge", nonce: "again", serverId: "srv-1" }));
		await act(async () => {});
		expect(ofType(r.send, "browser_host_register")).toHaveLength(before);
	});

	it("a `registered` naming another hostId does not mark this window as registered", async () => {
		const r = mount();
		await waitFor(() => expect(ofType(r.send, "browser_host_hello")).toHaveLength(1));
		act(() => r.ws.emit({ type: "browser_host_challenge", nonce: "n", serverId: "s" }));
		await waitFor(() => expect(ofType(r.send, "browser_host_register")).toHaveLength(1));
		act(() => r.ws.emit({ type: "browser_host_registered", hostId: "host-ffffffffffffffffffffffffffffffff" }));
		await act(async () => {});
		expect(getOperatorHostId()).toBeNull();
	});

	it("a missing `registered` after the timeout is a refusal: not registered, nothing bridged", async () => {
		vi.useFakeTimers();
		const r = mount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(ofType(r.send, "browser_host_hello")).toHaveLength(1);
		act(() => r.ws.emit({ type: "browser_host_challenge", nonce: "n", serverId: "s" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0); // let sign() resolve and the register go out
		});
		expect(ofType(r.send, "browser_host_register")).toHaveLength(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(HOST_REGISTER_TIMEOUT_MS + 1);
		});
		expect(getOperatorHostId()).toBeNull();
		// A late `registered` after the refusal window is not trusted.
		act(() => r.ws.emit({ type: "browser_host_registered", hostId: FAKE_HOST_ID }));
		expect(getOperatorHostId()).toBeNull();
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "q", linkId: "l", instanceId: "i", profileDirectory: "Default", serverLabel: "x" }));
		expect(host.connect).not.toHaveBeenCalled();
	});
});

describe("reconnect (#F1)", () => {
	it("#F1 exactly one new hello/register cycle per reconnect; `registered as H` restored", async () => {
		const r = mount();
		await register(r);
		expect(ofType(r.send, "browser_host_hello")).toHaveLength(1);
		expect(host.setTarget).toHaveBeenCalledTimes(1);

		r.setConnectionStatus("disconnected");
		await waitFor(() => expect(getOperatorHostId()).toBeNull());

		r.setConnectionStatus("connected");
		await waitFor(() => expect(ofType(r.send, "browser_host_hello")).toHaveLength(2));
		act(() => r.ws.emit({ type: "browser_host_challenge", nonce: "n2", serverId: "srv-1" }));
		await waitFor(() => expect(ofType(r.send, "browser_host_register")).toHaveLength(2));
		act(() => r.ws.emit({ type: "browser_host_registered", hostId: FAKE_HOST_ID }));
		await waitFor(() => expect(getOperatorHostId()).toBe(FAKE_HOST_ID));

		await act(async () => {});
		expect(ofType(r.send, "browser_host_hello")).toHaveLength(2);
		expect(ofType(r.send, "browser_host_register")).toHaveLength(2);
		// main clears the target on navigation / switch: it is set again every cycle.
		expect(host.setTarget).toHaveBeenCalledTimes(2);
		// No leaked IPC listeners from the first cycle.
		expect(host.listeners).toEqual({ connect: 1, ext: 1, frame: 0 });
		expect(r.ws.listenerCount).toBe(PROVIDER_LISTENERS + 1);
	});

	it("re-probes the status on reconnect: a server downgraded to an older version gets nothing", async () => {
		const r = mount();
		await register(r);
		statusBody = { enabled: true, canOpenChrome: true };
		r.setConnectionStatus("disconnected");
		r.setConnectionStatus("connected");
		await waitFor(() => expect(statusCalls).toBe(2));
		await act(async () => {});
		expect(ofType(r.send, "browser_host_hello")).toHaveLength(1);
		expect(getOperatorHostId()).toBeNull();
	});

	it("unmount unregisters, drops every IPC and socket listener", async () => {
		const r = mount();
		await register(r);
		r.unmount();
		expect(getOperatorHostId()).toBeNull();
		expect(host.listeners).toEqual({ connect: 0, ext: 0, frame: 0 });
		expect(r.ws.listenerCount).toBe(0); // the provider unmounted too: nothing of ours is left
	});
});

describe("IPC ↔ browser_host_* bridge", () => {
	it("connect → browserHost.connect with the request fields; answer → connect_result", async () => {
		const r = mount();
		await register(r);
		act(() =>
			r.ws.emit({
				type: "browser_host_connect",
				requestId: "rq1",
				linkId: "lk1",
				instanceId: "inst-1",
				profileDirectory: "Default",
				serverLabel: "dash.test:8000",
				extra: "dropped",
			}),
		);
		await waitFor(() => expect(host.connect).toHaveBeenCalledTimes(1));
		expect(host.connect).toHaveBeenCalledWith({
			requestId: "rq1",
			linkId: "lk1",
			instanceId: "inst-1",
			profileDirectory: "Default",
			serverLabel: "dash.test:8000",
		});

		act(() => host.emitConnectAnswer({ requestId: "rq1", ok: true }));
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "rq2", linkId: "lk2", instanceId: "inst-1", profileDirectory: "Default", serverLabel: "x" }));
		await waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2));
		act(() => host.emitConnectAnswer({ requestId: "rq2", ok: false, reason: "denied" }));
		// An answer for a request this carrier never forwarded is dropped.
		act(() => host.emitConnectAnswer({ requestId: "rq-unknown", ok: true }));
		expect(ofType(r.send, "browser_host_connect_result")).toEqual([
			{ type: "browser_host_connect_result", requestId: "rq1", ok: true },
			{ type: "browser_host_connect_result", requestId: "rq2", ok: false, reason: "denied" },
		]);
	});

	it("a malformed connect (non-string fields) is answered `invalid` without calling main", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "rq1", linkId: 5, instanceId: "i", profileDirectory: "D", serverLabel: "s" }));
		await waitFor(() => expect(ofType(r.send, "browser_host_connect_result")).toHaveLength(1));
		expect(ofType(r.send, "browser_host_connect_result")[0]).toEqual({ type: "browser_host_connect_result", requestId: "rq1", ok: false, reason: "invalid" });
		expect(host.connect).not.toHaveBeenCalled();
	});

	it("a failing browserHost.connect is answered with a failure result", async () => {
		(host.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "rq1", linkId: "lk1", instanceId: "i", profileDirectory: "Default", serverLabel: "s" }));
		await waitFor(() => expect(ofType(r.send, "browser_host_connect_result")).toHaveLength(1));
		expect(ofType(r.send, "browser_host_connect_result")[0]).toMatchObject({ requestId: "rq1", ok: false });
	});

	it("connect_cancel → cancelConnect(requestId)", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_connect_cancel", requestId: "rq1" }));
		await waitFor(() => expect(host.cancelConnect).toHaveBeenCalledWith("rq1"));
	});

	it("relay_data/relay_close → extSend/extClose; extension events → ext_open/data/close", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_relay_data", linkId: "lk1", data: "{\"id\":1}" }));
		act(() => r.ws.emit({ type: "browser_host_relay_close", linkId: "lk1", code: 1000, reason: "bye" }));
		await waitFor(() => expect(host.extClose).toHaveBeenCalledWith("lk1", 1000));
		expect(host.extSend).toHaveBeenCalledWith("lk1", "{\"id\":1}");

		act(() => host.emitExt({ kind: "open", linkId: "lk2" }));
		act(() => host.emitExt({ kind: "data", linkId: "lk2", data: "frame" }));
		act(() => host.emitExt({ kind: "close", linkId: "lk2", code: 1006 }));
		expect(ofType(r.send, "browser_host_ext_open")).toEqual([{ type: "browser_host_ext_open", linkId: "lk2" }]);
		expect(ofType(r.send, "browser_host_ext_data")).toEqual([{ type: "browser_host_ext_data", linkId: "lk2", data: "frame" }]);
		expect(ofType(r.send, "browser_host_ext_close")).toEqual([{ type: "browser_host_ext_close", linkId: "lk2", code: 1006 }]);
	});

	it("non-string relay data / ids are not forwarded to main", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_relay_data", linkId: "lk1", data: { a: 1 } }));
		act(() => r.ws.emit({ type: "browser_host_relay_data", linkId: 7, data: "x" }));
		act(() => r.ws.emit({ type: "browser_host_relay_close", linkId: "lk1", code: "nope" }));
		act(() => r.ws.emit({ type: "browser_host_tee", linkId: "lk1", instanceId: "i", tabId: "1", on: true }));
		await act(async () => {});
		expect(host.extSend).not.toHaveBeenCalled();
		expect(host.extClose).not.toHaveBeenCalled();
		expect(host.tee).not.toHaveBeenCalled();
	});

	it("tee → browserHost.tee(linkId, instanceId, tabId, on)", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_tee", linkId: "lk1", instanceId: "inst-1", tabId: 4, on: true }));
		act(() => r.ws.emit({ type: "browser_host_tee", linkId: "lk1", instanceId: "inst-1", tabId: 4, on: false }));
		await waitFor(() => expect(host.tee).toHaveBeenCalledTimes(2));
		expect((host.tee as ReturnType<typeof vi.fn>).mock.calls).toEqual([
			["lk1", "inst-1", 4, true],
			["lk1", "inst-1", 4, false],
		]);
	});

	it("nothing is bridged before registration completes", async () => {
		const r = mount();
		await waitFor(() => expect(ofType(r.send, "browser_host_hello")).toHaveLength(1));
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "q", linkId: "l", instanceId: "i", profileDirectory: "Default", serverLabel: "x" }));
		act(() => r.ws.emit({ type: "browser_host_relay_data", linkId: "l", data: "x" }));
		act(() => r.ws.emit({ type: "browser_host_tee", linkId: "l", instanceId: "i", tabId: 1, on: true }));
		await act(async () => {});
		expect(host.connect).not.toHaveBeenCalled();
		expect(host.extSend).not.toHaveBeenCalled();
		expect(host.tee).not.toHaveBeenCalled();
	});

	it("a connection loss cancels pending connects and closes live links in main", async () => {
		const r = mount();
		await register(r);
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "rq1", linkId: "lk1", instanceId: "i", profileDirectory: "Default", serverLabel: "s" }));
		await waitFor(() => expect(host.connect).toHaveBeenCalledTimes(1));
		act(() => host.emitConnectAnswer({ requestId: "rq1", ok: true }));
		act(() => r.ws.emit({ type: "browser_host_connect", requestId: "rq2", linkId: "lk2", instanceId: "i", profileDirectory: "Default", serverLabel: "s" }));
		await waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2));

		r.setConnectionStatus("disconnected");
		await waitFor(() => expect(getOperatorHostId()).toBeNull());
		expect(host.cancelConnect).toHaveBeenCalledWith("rq2"); // still unanswered
		expect(host.cancelConnect).not.toHaveBeenCalledWith("rq1"); // already answered
		expect(host.extClose).toHaveBeenCalledWith("lk1", 1001); // live link ends with the carrier
	});
});
