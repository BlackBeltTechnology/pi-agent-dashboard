/**
 * SubagentsSettings unit tests — initial render reads from usePluginConfig,
 * toggle click POSTs to /api/config/plugins/subagents, error path reverts.
 * See change: add-subagent-inspector §16.3.3.
 */

import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SubagentsSettings } from "../SubagentsSettings.js";

/** Route-aware fetch mock: GET limits → `heapCeilingMb`, every other call → `post()`. */
function routedFetch(post: () => Response, heapCeilingMb: number | null = 512) {
	return vi.fn((url: string, init?: RequestInit) => {
		if (url === "/api/plugins/subagents/limits") {
			return Promise.resolve(new Response(JSON.stringify({ heapCeilingMb }), { status: 200 }));
		}
		void init;
		return Promise.resolve(post());
	});
}

const posts = (m: ReturnType<typeof routedFetch>) =>
	m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

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
		const fetchMock = routedFetch(() => new Response(JSON.stringify({ success: true }), { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		const checkbox = screen.getByRole("switch");
		fireEvent.click(checkbox);

		// Buffered — toggling does NOT autosave.
		expect(posts(fetchMock)).toHaveLength(0);
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		await sources.get("plugin:subagents")!.commit();
		const [url, init] = posts(fetchMock)[0];
		expect(url).toBe("/api/config/plugins/subagents");
		expect((init as RequestInit).method).toBe("POST");
		// An untouched limit is NOT posted (an unrelated save never pins it; D5).
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({ inheritContext: false });
	});

	it("commit() rejects on non-200 so the host keeps the source dirty", async () => {
		const fetchMock = routedFetch(() => new Response("validation failed", { status: 400 }));
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
		const fetchMock = routedFetch(() => new Response("boom", { status: 500 }));
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

	// ── "Max parallel subagents" (change: subagent-queue-visibility, D5) ──────────

	function setConfig(config: Record<string, unknown>) {
		act(() => {
			applyPluginConfigUpdate({ type: "plugin_config_update", id: "subagents", config });
		});
	}
	const field = () => screen.getByTestId("subagents-max-concurrent") as HTMLInputElement;

	it("loads the value from the (reconciled) plugin config; default 4 when absent", () => {
		global.fetch = routedFetch(() => new Response("{}", { status: 200 })) as unknown as typeof fetch;
		setConfig({ inheritContext: true, maxConcurrent: 12 });
		renderInPluginContext();
		expect(field().value).toBe("12");
		cleanup();
		setConfig({ inheritContext: true });
		renderInPluginContext();
		expect(field().value).toBe("4");
	});

	it("an edit marks the page dirty and writes nothing; global Discard reverts", async () => {
		const fetchMock = routedFetch(() => new Response("{}", { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;
		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		fireEvent.change(field(), { target: { value: "8" } });
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		expect(posts(fetchMock)).toHaveLength(0);
		act(() => sources.get("plugin:subagents")!.reset());
		expect(field().value).toBe("4");
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(false));
	});

	it("global Save commits both keys in one POST", async () => {
		const fetchMock = routedFetch(() => new Response("{}", { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;
		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.change(field(), { target: { value: "8" } });
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		await sources.get("plugin:subagents")!.commit();
		expect(posts(fetchMock)).toHaveLength(1);
		expect(JSON.parse(posts(fetchMock)[0][1]!.body as string)).toEqual({ inheritContext: false, maxConcurrent: 8 });
	});

	// test-plan #E12 — field boundaries.
	it.each([
		["0", true],
		["1", true],
		["63", true],
		["64", true],
		["-1", false],
		["65", false],
		["2.5", false],
	])("#E12 value %s → commits=%s", async (value, ok) => {
		const fetchMock = routedFetch(() => new Response("{}", { status: 200 }));
		global.fetch = fetchMock as unknown as typeof fetch;
		const sources = new Map<string, RegisteredSource>();
		renderInPluginContext(sources);
		fireEvent.change(field(), { target: { value } });
		await waitFor(() => expect(sources.get("plugin:subagents")?.isDirty).toBe(true));
		if (ok) {
			await sources.get("plugin:subagents")!.commit();
			expect(screen.queryByTestId("subagents-max-concurrent-error")).toBeNull();
			expect(JSON.parse(posts(fetchMock)[0][1]!.body as string).maxConcurrent).toBe(Number(value));
		} else {
			expect(screen.getByTestId("subagents-max-concurrent-error").textContent).toMatch(/0 to 64/);
			await expect(sources.get("plugin:subagents")!.commit()).rejects.toThrow(/0 to 64/);
			expect(posts(fetchMock)).toHaveLength(0);
		}
	});

	// test-plan #E16 (field render) — heap coupling warning against the session ceiling.
	it.each([
		["4", false],
		["7", true],
		["16", true],
		["0", true],
	])("#E16 at a 512 MB ceiling, value %s → heap warning=%s", async (value, warns) => {
		global.fetch = routedFetch(() => new Response("{}", { status: 200 }), 512) as unknown as typeof fetch;
		renderInPluginContext(new Map());
		fireEvent.change(field(), { target: { value } });
		if (warns) {
			await waitFor(() => expect(screen.getByTestId("subagents-max-concurrent-heap-warning")).toBeTruthy());
		} else {
			// Let the limits fetch land, then assert silence.
			await act(async () => {});
			expect(screen.queryByTestId("subagents-max-concurrent-heap-warning")).toBeNull();
		}
	});

	it("names the per-child figure in the warning", async () => {
		global.fetch = routedFetch(() => new Response("{}", { status: 200 }), 512) as unknown as typeof fetch;
		renderInPluginContext(new Map());
		fireEvent.change(field(), { target: { value: "8" } });
		const warning = await screen.findByTestId("subagents-max-concurrent-heap-warning");
		expect(warning.textContent).toMatch(/56 MB/);
	});
});
