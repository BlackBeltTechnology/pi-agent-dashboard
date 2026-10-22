/**
 * Runtime update badge (task 7.6): driven only by runtime.updatable + status.
 * See change: electron-runtime-overlay-updates.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeUpdateBadge } from "../packages/RuntimeUpdateBadge.js";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", navigate] }));
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

function serve(data: Record<string, unknown>) {
	const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) }));
	(globalThis as { fetch: unknown }).fetch = fetchMock;
	return fetchMock;
}

const runtime = (updatable: boolean) => ({ origin: "overlay", id: "0.9.0", version: "0.9.0", updatable });

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigate.mockReset();
});

describe("RuntimeUpdateBadge", () => {
	it("E12: glyph-only — the available version is in title/aria-label, not visible text; click opens Settings → Packages", async () => {
		serve({ runtime: runtime(true), check: { state: "available", target: "0.12.3" }, pending: null });
		render(<RuntimeUpdateBadge />);
		const badge = await screen.findByTestId("runtime-update-badge");
		expect(badge.textContent).toBe("");
		expect(badge.getAttribute("title")).toContain("0.12.3");
		expect(badge.getAttribute("aria-label")).toContain("0.12.3");
		fireEvent.click(badge);
		expect(navigate).toHaveBeenCalledWith("/settings/add-ons");
	});

	it("shows a staged pending that is not the active runtime", async () => {
		serve({ runtime: runtime(true), check: { state: "up_to_date", target: "0.9.0" }, pending: "0.9.2" });
		render(<RuntimeUpdateBadge />);
		expect((await screen.findByTestId("runtime-update-badge")).getAttribute("aria-label")).toContain("0.9.2");
	});

	it("hidden when the runtime is not updatable, even with a release available", async () => {
		const f = serve({ runtime: runtime(false), check: { state: "available", target: "0.9.1" }, pending: null });
		render(<RuntimeUpdateBadge />);
		await waitFor(() => expect(f).toHaveBeenCalled());
		await Promise.resolve();
		expect(screen.queryByTestId("runtime-update-badge")).toBeNull();
	});

	it("hidden when up to date with nothing staged", async () => {
		const f = serve({ runtime: runtime(true), check: { state: "up_to_date", target: "0.9.0" }, pending: null });
		render(<RuntimeUpdateBadge />);
		await waitFor(() => expect(f).toHaveBeenCalled());
		await Promise.resolve();
		expect(screen.queryByTestId("runtime-update-badge")).toBeNull();
	});
});
