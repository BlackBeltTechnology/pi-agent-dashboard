/**
 * Settings → Updates (runtime overlay). Test plan F1–F4.
 * See change: electron-runtime-overlay-updates.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeUpdatesSection } from "../packages/RuntimeUpdatesSection.js";

vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

type Status = Record<string, unknown>;

function baseStatus(over: Status = {}): Status {
	return {
		runtime: { origin: "overlay", id: "0.9.0", version: "0.9.0", updatable: true, source: "npm" },
		source: "npm",
		channel: "stable",
		pin: null,
		pending: null,
		previous: null,
		check: { state: "up_to_date", target: "0.9.0", active: "0.9.0", checkedAt: 1 },
		staging: null,
		lastStageError: null,
		...over,
	};
}

let status: Status;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, ok = true) {
	return Promise.resolve({ ok, status: ok ? 200 : 409, json: () => Promise.resolve(body) });
}

beforeEach(() => {
	status = baseStatus();
	fetchMock = vi.fn((url: string, init?: RequestInit) => {
		if (url.startsWith("/api/runtime/status")) return json({ success: true, data: status });
		if (init?.method === "POST") return json({ success: true, data: {} });
		return json({}, false);
	});
	(globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	delete (window as { piDashboard?: unknown }).piDashboard;
});

function emit(detail: unknown) {
	act(() => {
		window.dispatchEvent(new CustomEvent("runtime-update-event", { detail }));
	});
}

describe("RuntimeUpdatesSection", () => {
	it("F1: local source is read-only — path, SHA, dirty; no path input; set from the app menu", async () => {
		status = baseStatus({
			source: "local",
			runtime: { origin: "local", id: "local:/r/co", version: "0.9.0", updatable: true, source: "local", gitSha: "abc123", dirty: true },
		});
		render(<RuntimeUpdatesSection />);
		await screen.findByText("/r/co");
		expect(screen.getByText(/abc123/)).toBeTruthy();
		expect(screen.getByText(/dirty/i)).toBeTruthy();
		expect(screen.getByText(/Set from the app menu/)).toBeTruthy();
		expect(document.querySelector("input[type='text']")).toBeNull();
	});

	it("F2: Update → progress → Activate; Activate disabled until pending = target", async () => {
		status = baseStatus({ check: { state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 } });
		render(<RuntimeUpdatesSection />);
		const update = await screen.findByRole("button", { name: /Update to 0\.9\.1/ });
		expect((screen.getByRole("button", { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(true);

		status = baseStatus({
			check: { state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 },
			staging: { version: "0.9.1" },
		});
		fireEvent.click(update);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/runtime/update", expect.objectContaining({ method: "POST" })));
		emit({ type: "runtime_update_progress", version: "0.9.1", phase: "install" });
		await screen.findByText(/install/i);
		expect((screen.getByRole("button", { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(true);

		status = baseStatus({ check: { state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 }, pending: "0.9.1" });
		emit({ type: "runtime_update_staged", version: "0.9.1" });
		await waitFor(() => expect((screen.getByRole("button", { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: /Activate/ }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/runtime/activate", expect.objectContaining({ method: "POST" })));
	});

	it("F3: requires_app refusal shows the minimum app version and a whole-app update link", async () => {
		const checkAppUpdate = vi.fn();
		(window as { piDashboard?: unknown }).piDashboard = { checkAppUpdate };
		status = baseStatus({
			runtime: {
				origin: "overlay", id: "0.9.0", version: "0.9.0", updatable: true, source: "npm",
				lastFailure: { id: "0.9.1", reason: "requires_app >=0.10.0" },
			},
		});
		render(<RuntimeUpdatesSection />);
		await screen.findByText(/Requires app update ≥0\.10\.0/);
		fireEvent.click(screen.getByRole("button", { name: /Check for app update/ }));
		expect(checkAppUpdate).toHaveBeenCalledTimes(1);
	});

	it("F4: last failure is surfaced; Roll back and Use bundled are enabled", async () => {
		status = baseStatus({
			previous: "0.9.0",
			runtime: {
				origin: "overlay", id: "0.9.0", version: "0.9.0", updatable: true, source: "npm",
				lastFailure: { id: "0.9.1", reason: "health timeout" },
			},
		});
		render(<RuntimeUpdatesSection />);
		await screen.findByText(/0\.9\.1.*health timeout/);
		expect((screen.getByRole("button", { name: /Roll back/ }) as HTMLButtonElement).disabled).toBe(false);
		const bundled = screen.getByRole("button", { name: /Use bundled/ }) as HTMLButtonElement;
		expect(bundled.disabled).toBe(false);
		fireEvent.click(bundled);
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/runtime/rollback",
				expect.objectContaining({ method: "POST", body: JSON.stringify({ to: "bundled" }) }),
			),
		);
	});

	it("a non-updatable runtime (devMonorepo) is read-only — no source/pin/action controls", async () => {
		status = baseStatus({
			runtime: {
				origin: "devMonorepo", id: "devMonorepo", version: "0.9.0", updatable: false,
				lastFailure: { id: "0.9.1", reason: "requires_app >=0.10.0" },
			},
		});
		render(<RuntimeUpdatesSection />);
		await screen.findByText(/not updatable/);
		expect(screen.getByText(/Requires app update ≥0\.10\.0/)).toBeTruthy();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("a stale pending under a non-remote source never enables Activate", async () => {
		status = baseStatus({ source: "bundled", pending: "0.9.1", check: { state: "not_applicable" } });
		render(<RuntimeUpdatesSection />);
		const activate = (await screen.findByRole("button", { name: /Activate/ })) as HTMLButtonElement;
		expect(activate.disabled).toBe(true);
	});

	it("a pending that is not the offered target does not enable Activate", async () => {
		status = baseStatus({ pending: "0.9.0-old", check: { state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 } });
		render(<RuntimeUpdatesSection />);
		expect(((await screen.findByRole("button", { name: /Activate/ })) as HTMLButtonElement).disabled).toBe(true);
	});

	it("pin: only an exact version can be pinned; Unpin clears it", async () => {
		render(<RuntimeUpdatesSection />);
		const input = (await screen.findByRole("textbox", { name: /Pin version/ })) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "latest" } });
		expect((screen.getByRole("button", { name: /^Pin$/ }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(input, { target: { value: "0.9.1" } });
		fireEvent.click(screen.getByRole("button", { name: /^Pin$/ }));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith("/api/runtime/source", expect.objectContaining({ body: JSON.stringify({ source: "npm", pin: "0.9.1" }) })),
		);
		cleanup();
		status = baseStatus({ pin: "0.9.1" });
		render(<RuntimeUpdatesSection />);
		fireEvent.click(await screen.findByRole("button", { name: /Unpin/ }));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith("/api/runtime/source", expect.objectContaining({ body: JSON.stringify({ source: "npm", pin: null }) })),
		);
	});

	it("from a local link, choosing npm leaves local mode via the source route", async () => {
		status = baseStatus({ source: "local", runtime: { origin: "local", id: "local:/r/co", version: "0.9.0", updatable: true } });
		render(<RuntimeUpdatesSection />);
		fireEvent.change(await screen.findByRole("combobox", { name: /Source/ }), { target: { value: "npm" } });
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith("/api/runtime/source", expect.objectContaining({ body: JSON.stringify({ source: "npm" }) })),
		);
	});

	it("shows the runtime's pi version", async () => {
		status = baseStatus({ piVersion: "0.86.1" });
		render(<RuntimeUpdatesSection />);
		await screen.findByText(/pi 0\.86\.1/);
	});

	it("an earlier status response landing late cannot resurrect a finished staging job", async () => {
		let releaseSlow: (v: unknown) => void = () => {};
		const slow = new Promise((r) => {
			releaseSlow = r;
		});
		let calls = 0;
		fetchMock.mockImplementation((url: string) => {
			if (!url.startsWith("/api/runtime/status")) return json({ success: true, data: {} });
			calls++;
			if (calls === 1) return slow.then(() => ({ ok: true, json: () => Promise.resolve({ success: true, data: baseStatus({ staging: { version: "0.9.1" } }) }) }));
			return json({ success: true, data: baseStatus({ pending: "0.9.1", check: { state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 } }) });
		});
		render(<RuntimeUpdatesSection />);
		emit({ type: "runtime_update_staged", version: "0.9.1" });
		await waitFor(() => expect((screen.getByRole("button", { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(false));
		await act(async () => {
			releaseSlow(undefined);
			await slow;
		});
		expect((screen.getByRole("button", { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("a failed status fetch is shown to the user", async () => {
		fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
		render(<RuntimeUpdatesSection />);
		expect((await screen.findByRole("alert")).textContent).toContain("network down");
	});
});
