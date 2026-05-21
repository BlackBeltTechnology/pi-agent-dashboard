/**
 * SubagentsSettings unit tests — initial render reads from usePluginConfig,
 * toggle click POSTs to /api/config/plugins/subagents, error path reverts.
 * See change: add-subagent-inspector §16.3.3.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import {
	createSlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import {
	applyPluginConfigUpdate,
	CurrentPluginLayer,
	PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { SubagentsSettings } from "../SubagentsSettings.js";

function renderInPluginContext() {
	const registry = createSlotRegistry();
	return render(
		<PluginContextProvider registry={registry}>
			<CurrentPluginLayer pluginId="subagents">
				<SubagentsSettings />
			</CurrentPluginLayer>
		</PluginContextProvider>,
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
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
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
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
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
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
	});

	it("clicking the toggle POSTs to /api/config/plugins/subagents with the new value", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		renderInPluginContext();
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		fireEvent.click(checkbox);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/config/plugins/subagents");
		expect((init as RequestInit).method).toBe("POST");
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({ inheritContext: false });
	});

	it("shows error message and stays in old state on non-200", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("validation failed", { status: 400 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		renderInPluginContext();
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		fireEvent.click(checkbox);

		await waitFor(() => expect(screen.getByText(/Failed to save:/i)).toBeTruthy());
		// Config did not flip — usePluginConfig still reads the seeded value
		expect(checkbox.checked).toBe(true);
	});
});
