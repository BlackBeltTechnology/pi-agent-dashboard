/**
 * SubagentsSettings unit tests — initial render reads from usePluginConfig,
 * toggle click POSTs to /api/config/plugins/subagents, error path reverts.
 * See change: add-subagent-inspector §16.3.3.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
	createSlotRegistry,
	SettingsDraftProvider,
	type RegisteredSource,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import {
	applyPluginConfigUpdate,
	CurrentPluginLayer,
	PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { SubagentsSettings } from "../SubagentsSettings.js";

function renderInPluginContext(sources?: Map<string, RegisteredSource>, location = memoryLocation({ path: "/settings/plugins/subagents", record: true })) {
	const registry = createSlotRegistry();
	const draft = {
		upsert: (id: string, s: RegisteredSource) => { sources?.set(id, s); },
		remove: (id: string) => { sources?.delete(id); },
	};
	return render(
		<Router hook={location.hook}>
			<PluginContextProvider registry={registry}>
				<SettingsDraftProvider registry={draft}>
					<CurrentPluginLayer pluginId="subagents">
						<SubagentsSettings />
					</CurrentPluginLayer>
				</SettingsDraftProvider>
			</PluginContextProvider>
		</Router>,
	);
}

describe("SubagentsSettings", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = global.fetch;
		// Seed config to a known state before each test
		act(() => {
			applyPluginConfigUpdate({
				type: "plugin_config_update",
				id: "subagents",
				config: { inheritContext: true },
			});
		});
	});

	afterEach(() => {
		global.fetch = originalFetch;
		cleanup();
	});

	it("renders the toggle checked when inheritContext is true", () => {
		renderInPluginContext();
		const checkbox = screen.getByRole("switch");
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
	});

	it("renders the toggle unchecked when inheritContext is false", () => {
		act(() => {
			applyPluginConfigUpdate({
				type: "plugin_config_update",
				id: "subagents",
				config: { inheritContext: false },
			});
		});
		renderInPluginContext();
		const checkbox = screen.getByRole("switch");
		expect(checkbox.getAttribute("aria-checked")).toBe("false");
	});

	it("defaults to checked when inheritContext is missing from config", () => {
		act(() => {
			applyPluginConfigUpdate({
				type: "plugin_config_update",
				id: "subagents",
				config: {}, // empty
			});
		});
		renderInPluginContext();
		const checkbox = screen.getByRole("switch");
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
	});

	it("buffers the toggle (no POST on click); commit() POSTs the new value", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		const checkbox = screen.getByRole("switch");
		fireEvent.click(checkbox);

		// Buffered — toggling does NOT autosave.
		expect(fetchMock).not.toHaveBeenCalled();
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		await sources.get("plugin:subagents")!.commit();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/config/plugins/subagents");
		expect((init as RequestInit).method).toBe("POST");
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({ inheritContext: false });
	});

	it("commit() rejects on non-200 so the host keeps the source dirty", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("validation failed", { status: 400 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		const checkbox = screen.getByRole("switch");
		fireEvent.click(checkbox);

		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		await expect(sources.get("plugin:subagents")!.commit()).rejects.toThrow();
		// Draft retains the user's choice for retry.
		expect(checkbox.getAttribute("aria-checked")).toBe("false");
	});

	// test-plan #X6 — fault-injection: POST → 500 body `boom`, host Save.
	it("#X6 save failure → human sentence; HTTP 500 and boom only in Copy details", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
		global.fetch = fetchMock as unknown as typeof fetch;
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		fireEvent.click(screen.getByRole("switch"));
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));

		// What the host Save bar shows is the thrown message.
		let thrown: Error | undefined;
		await act(async () => {
			await sources.get("plugin:subagents")!.commit().catch((e: Error) => { thrown = e; });
		});
		expect(thrown?.message).toMatch(/could not save/i);
		expect(thrown?.message).not.toMatch(/HTTP|500|boom/);

		// The body shows its own sentence, never the raw status or body.
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/could not save/i);
		expect(alert.textContent).not.toMatch(/HTTP|500|boom/);
		expect(document.body.textContent).not.toMatch(/HTTP 500|boom/);

		// ...which only the "Copy details" payload carries.
		fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0][0]).toContain("HTTP 500");
		expect(writeText.mock.calls[0][0]).toContain("boom");
	});

	it("shows a plain lead (no internal package name) and an info notice with Open Model roles", () => {
		const location = memoryLocation({ path: "/settings/plugins/subagents", record: true });
		renderInPluginContext(undefined, location);
		expect(document.body.textContent).not.toContain("pi-dashboard-subagents");
		const notice = screen.getByTestId("subagents-settings-roles-dep");
		expect(notice.getAttribute("data-tone")).toBe("info");
		expect(Array.from(notice.querySelectorAll("code")).map((c) => c.textContent)).toEqual(["@fast", "@fast"]);
		expect(document.body.querySelector("input[type='checkbox']")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Open Model roles" }));
		expect(location.history?.at(-1)).toBe("/settings/plugins/roles");
	});
});
