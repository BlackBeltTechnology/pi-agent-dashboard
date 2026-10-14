/**
 * Shared RTL harness for the browser-plugin client tests (change:
 * add-browser-relay, tasks 4.1–4.3).
 *
 * `FakeWs` stands in for the shell WebSocket: it records message listeners and
 * lets a test push a server→browser frame. `renderWithPlugin` mounts the
 * component under test inside the provider + `CurrentPluginLayer` that
 * `usePluginConfig` / `usePluginMessage` / `usePluginSend` require.
 */

import {
	CurrentPluginLayer,
	PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { InteractiveUiRequestSnapshot } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { type RenderResult, render } from "@testing-library/react";
import type React from "react";
import { vi } from "vitest";
import { BrowserRelayFeed } from "../BrowserRelayFeed.js";

type MessageListener = (evt: MessageEvent) => void;

class FakeWs {
	private listeners = new Set<MessageListener>();

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
