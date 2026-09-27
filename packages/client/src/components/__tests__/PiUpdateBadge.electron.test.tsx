/**
 * E21: under Electron the pi-core badge stays hidden (runtime updates live in
 * Settings → Packages → Dashboard runtime). See change: electron-runtime-overlay-updates.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiUpdateBadge } from "../packages/PiUpdateBadge.js";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("../../hooks/useLaunchSource.js", () => ({ useLaunchSource: () => "electron" }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("PiUpdateBadge under Electron", () => {
	it("E21: stays hidden even with core updates available", async () => {
		(globalThis as { fetch: unknown }).fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true, data: { packages: [], updatesAvailable: 3, lastChecked: new Date().toISOString() } }),
		});
		const { container } = render(<PiUpdateBadge />);
		await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
		await act(async () => {});
		expect(container.querySelector("[data-testid='pi-update-badge']")).toBeNull();
	});
});
