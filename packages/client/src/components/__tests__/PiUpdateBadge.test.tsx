import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { PiUpdateBadge } from "../packages/PiUpdateBadge.js";

const navigateMock = vi.fn();

vi.mock("wouter", () => ({
	useLocation: () => ["/", navigateMock],
}));

function mockVersions(updatesAvailable: number) {
	(globalThis as any).fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: () =>
			Promise.resolve({
				success: true,
				data: {
					packages: [],
					updatesAvailable,
					lastChecked: new Date().toISOString(),
				},
			}),
	});
}

describe("PiUpdateBadge", () => {
	beforeEach(() => {
		navigateMock.mockReset();
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders nothing when there are no updates", async () => {
		mockVersions(0);
		const { container } = render(<PiUpdateBadge />);
		// Give the hook a chance to run
		await new Promise((r) => setTimeout(r, 20));
		expect(container.querySelector("[data-testid='pi-update-badge']")).toBeNull();
	});

	it("renders a count badge when updates available", async () => {
		mockVersions(3);
		render(<PiUpdateBadge />);
		await waitFor(() => {
			const badge = screen.getByTestId("pi-update-badge");
			expect(badge.textContent).toContain("3");
		});
	});

	it("navigates to settings packages tab on click", async () => {
		mockVersions(2);
		render(<PiUpdateBadge />);
		await waitFor(() => screen.getByTestId("pi-update-badge"));
		fireEvent.click(screen.getByTestId("pi-update-badge"));
		expect(navigateMock).toHaveBeenCalledWith("/settings/packages");
	});

	it("sets aria-label with plural-aware wording", async () => {
		mockVersions(1);
		render(<PiUpdateBadge />);
		await waitFor(() => {
			const badge = screen.getByTestId("pi-update-badge");
			expect(badge.getAttribute("aria-label")).toBe("1 pi core update available");
		});
	});
});
