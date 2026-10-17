/**
 * Shared RTL harness for the browser-plugin client tests (change:
 * add-browser-relay, tasks 4.1–4.3).
 *
 * `FakeWs` stands in for the shell WebSocket: it records message listeners and
 * lets a test push a server→browser frame. `renderWithPlugin` mounts the
 * component under test inside the provider + `CurrentPluginLayer` that
 * `usePluginConfig` / `usePluginMessage` / `usePluginSend` require.
 */

import type { InteractiveUiRequestSnapshot } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import {
	CurrentPluginLayer,
	PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type {
	BrowserHostBridge,
	BrowserHostConnectAnswer,
	BrowserHostConsentRow,
	BrowserHostExtEvent,
	BrowserHostFrame,
	BrowserHostIdentity,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { type RenderResult, render } from "@testing-library/react";
import type React from "react";
import { vi } from "vitest";
import { BrowserRelayFeed } from "../BrowserRelayFeed.js";

type MessageListener = (evt: MessageEvent) => void;

export class FakeWs {
	private listeners = new Set<MessageListener>();

	/** The shell socket's target — the operator carrier derives its server origin from it. */
	url: string;

	constructor(url = "ws://dash.test:8000/ws") {
		this.url = url;
	}

	addEventListener(type: string, cb: EventListenerOrEventListenerObject): void {
		if (type === "message") this.listeners.add(cb as MessageListener);
	}

	removeEventListener(type: string, cb: EventListenerOrEventListenerObject): void {
		if (type === "message") this.listeners.delete(cb as MessageListener);
	}

	get listenerCount(): number {
		return this.listeners.size;
	}

	/** Push one server→browser frame to every registered message listener. */
	emit(msg: unknown): void {
		const evt = { data: JSON.stringify(msg) } as MessageEvent;
		for (const cb of this.listeners) cb(evt);
	}
}

interface RenderOptions {
	ws?: FakeWs;
	send?: (message: unknown) => void | Promise<void>;
	pluginId?: string;
	/** Interactive requests per session (the takeover Done tests). */
	interactiveRequests?: (sessionId: string) => readonly InteractiveUiRequestSnapshot[];
	/** Shell connection status exposed to `useShellConnectionStatus` (default: disconnected). */
	connectionStatus?: ShellConnectionStatus;
	/**
	 * Mount `BrowserRelayFeed` next to the component (default true) — in production
	 * the shell mounts it once via the `shell-headless` slot, and it is the SOLE
	 * `browser_relay_status` subscriber. See change: fix-empty-status-subcard.
	 */
	feed?: boolean;
}

type ShellConnectionStatus = "connecting" | "connected" | "disconnected" | "offline" | "auth_required";

interface RenderResultWithHarness extends RenderResult {
	/** Re-render the same tree with a new shell connection status. */
	setConnectionStatus(status: ShellConnectionStatus): void;
	ws: FakeWs;
	send: ReturnType<typeof vi.fn>;
}

export function renderWithPlugin(
	ui: React.ReactElement,
	options: RenderOptions = {},
): RenderResultWithHarness {
	const ws = options.ws ?? new FakeWs();
	const send = (options.send ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>;
	const tree = (connectionStatus: ShellConnectionStatus | undefined) => (
		<PluginContextProvider
			ws={ws as unknown as WebSocket}
			send={send as unknown as (message: unknown) => void}
			useSessionInteractiveRequests={options.interactiveRequests}
			connectionStatus={connectionStatus}
		>
			<CurrentPluginLayer pluginId={options.pluginId ?? "browser"}>
				{options.feed === false ? null : <BrowserRelayFeed />}
				{ui}
			</CurrentPluginLayer>
		</PluginContextProvider>
	);
	const result = render(tree(options.connectionStatus));
	return { ...result, ws, send, setConnectionStatus: (s) => result.rerender(tree(s)) };
}

/** A minimal session — the tile/badge ignore its fields (the relay is global). */
export const SESSION = { id: "s1", cwd: "/tmp" } as unknown as DashboardSession;

/**
 * A fake `window.piDashboard.browserHost` (Electron main's operator host bridge).
 * Every method is a `vi.fn`; `emit*` push main → renderer events to the callbacks
 * the component registered. `signed` records `(nonce, serverId)` pairs.
 */
export interface FakeBrowserHost extends BrowserHostBridge {
	emitConnectAnswer(answer: BrowserHostConnectAnswer): void;
	emitExt(ev: BrowserHostExtEvent): void;
	emitFrame(frame: BrowserHostFrame): void;
	/** Live listener counts (leak checks). */
	listeners: { connect: number; ext: number; frame: number };
	setConsents(rows: BrowserHostConsentRow[]): void;
}

export const FAKE_HOST_ID = "host-0123456789abcdef0123456789abcdef";

export function makeFakeBrowserHost(over: Partial<BrowserHostIdentity> = {}): FakeBrowserHost {
	const connectCbs = new Set<(a: BrowserHostConnectAnswer) => void>();
	const extCbs = new Set<(e: BrowserHostExtEvent) => void>();
	const frameCbs = new Set<(f: BrowserHostFrame) => void>();
	let consents: BrowserHostConsentRow[] = [];
	const identity: BrowserHostIdentity = {
		hostId: FAKE_HOST_ID,
		publicKey: "PUBKEY",
		label: "My Mac",
		platform: "darwin",
		canOpenChrome: true,
		profiles: [{ profileDirectory: "Default", label: "Person 1", installed: true }],
		...over,
	};
	return {
		identity: vi.fn(async () => identity),
		sign: vi.fn(async (nonce: string, serverId: string) => `sig(${nonce}|${serverId})`),
		setTarget: vi.fn(async () => {}),
		connect: vi.fn(async () => {}),
		onConnect: vi.fn((cb) => {
			connectCbs.add(cb);
			return () => connectCbs.delete(cb);
		}),
		cancelConnect: vi.fn(async () => {}),
		extSend: vi.fn(async () => {}),
		extClose: vi.fn(async () => {}),
		onExt: vi.fn((cb) => {
			extCbs.add(cb);
			return () => extCbs.delete(cb);
		}),
		tee: vi.fn(async () => {}),
		onFrame: vi.fn((cb) => {
			frameCbs.add(cb);
			return () => frameCbs.delete(cb);
		}),
		setToken: vi.fn(async () => {}),
		listConsents: vi.fn(async () => consents),
		revokeConsent: vi.fn(async (key: string) => {
			consents = consents.filter((c) => c.key !== key);
		}),
		emitConnectAnswer: (a) => {
			for (const cb of [...connectCbs]) cb(a);
		},
		emitExt: (e) => {
			for (const cb of [...extCbs]) cb(e);
		},
		emitFrame: (f) => {
			for (const cb of [...frameCbs]) cb(f);
		},
		get listeners() {
			return { connect: connectCbs.size, ext: extCbs.size, frame: frameCbs.size };
		},
		setConsents: (rows) => {
			consents = rows;
		},
	};
}

/** Install (or remove, with `null`) `window.piDashboard.browserHost`. */
export function installBrowserHost(host: BrowserHostBridge | null): void {
	const w = window as unknown as { piDashboard?: { browserHost?: BrowserHostBridge } };
	if (host) w.piDashboard = { browserHost: host };
	else delete w.piDashboard;
}
