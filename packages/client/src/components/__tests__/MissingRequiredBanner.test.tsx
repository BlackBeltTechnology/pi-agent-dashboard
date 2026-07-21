import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { MissingRequiredBanner } from "../session/MissingRequiredBanner.js";
import type { EnrichedRecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";

// ── Mocks ──────────────────────────────────────────────────────────

interface MockedRecommendedResult {
	recommended: EnrichedRecommendedExtension[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

const mockRecommended = vi.fn<() => MockedRecommendedResult>();
const installSpy = vi.fn();

vi.mock("../../hooks/useRecommendedExtensions.js", () => ({
	useRecommendedExtensions: () => mockRecommended(),
}));

vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: () => ({
		operation: { operationId: null, status: "idle", message: "", source: "" },
		install: installSpy,
		remove: vi.fn(),
		update: vi.fn(),
	}),
}));

function makeEntry(
	overrides: Partial<EnrichedRecommendedExtension>,
): EnrichedRecommendedExtension {
	return {
		id: "pi-anthropic-messages",
		source: "git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
		displayName: "pi-anthropic-messages",
		fallbackDescription: "Protocol bridge…",
		status: "required",
		unlocks: ["Tool calls on anthropic-messages providers"],
		description: "Protocol bridge…",
		installed: { scope: null },
		activeInPi: false,
		updateAvailable: false,
		...overrides,
	};
}

beforeEach(() => {
	installSpy.mockReset();
	mockRecommended.mockReset();
	try {
		sessionStorage.clear();
	} catch {
		/* ignore */
	}
});

afterEach(() => cleanup());

describe("MissingRequiredBanner", () => {
	it("renders nothing when there are no required missing entries", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({ status: "required", activeInPi: true }),
				makeEntry({ id: "x", status: "optional", activeInPi: false }),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		const { container } = render(<MissingRequiredBanner />);
		expect(container.querySelector('[data-testid="missing-required-banner"]')).toBeNull();
	});

	it("renders when a single required entry is missing", () => {
		mockRecommended.mockReturnValue({
			recommended: [makeEntry({})],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		render(<MissingRequiredBanner />);
		expect(screen.getByTestId("missing-required-banner")).toBeTruthy();
		expect(screen.getByText(/pi-anthropic-messages is not installed/)).toBeTruthy();
	});

	it("renders a combined message when 2+ required entries are missing", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({ id: "a", displayName: "a" }),
				makeEntry({ id: "b", displayName: "b", source: "npm:b" }),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		render(<MissingRequiredBanner />);
		expect(screen.getByText(/2 required extensions are not installed/)).toBeTruthy();
	});

	it("clicking Install dispatches install() for every missing entry (no scope override when nothing on disk)", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({ id: "a", source: "npm:a" }),
				makeEntry({ id: "b", source: "npm:b", displayName: "b" }),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		render(<MissingRequiredBanner />);
		fireEvent.click(screen.getByTestId("missing-required-install"));
		expect(installSpy).toHaveBeenCalledTimes(2);
		// No scope override when the entries aren't on disk — hook's own scope applies.
		expect(installSpy).toHaveBeenCalledWith("npm:a", undefined);
		expect(installSpy).toHaveBeenCalledWith("npm:b", undefined);
	});

	it("labels the action Activate when every missing entry is on disk", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({
					id: "a",
					source: "npm:a",
					installed: { scope: "global" },
				}),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		render(<MissingRequiredBanner />);
		expect(screen.getByText(/installed but not active in pi/)).toBeTruthy();
		expect(screen.getByTestId("missing-required-install").textContent).toMatch(/Activate/);
		fireEvent.click(screen.getByTestId("missing-required-install"));
		expect(installSpy).toHaveBeenCalledWith("npm:a", "global");
	});

	it("falls back to Install label when at least one missing entry is off disk", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({ id: "a", source: "npm:a", installed: { scope: "global" } }),
				makeEntry({ id: "b", source: "npm:b", displayName: "b", installed: { scope: null } }),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		render(<MissingRequiredBanner />);
		expect(screen.getByTestId("missing-required-install").textContent).toMatch(/Install/);
		fireEvent.click(screen.getByTestId("missing-required-install"));
		// Each entry still uses its own on-disk scope (or undefined) regardless of label.
		expect(installSpy).toHaveBeenCalledWith("npm:a", "global");
		expect(installSpy).toHaveBeenCalledWith("npm:b", undefined);
	});

	it("Dismiss hides the banner and persists in sessionStorage", () => {
		mockRecommended.mockReturnValue({
			recommended: [makeEntry({})],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		const { rerender, container } = render(<MissingRequiredBanner />);
		fireEvent.click(screen.getByTestId("missing-required-dismiss"));
		expect(
			container.querySelector('[data-testid="missing-required-banner"]'),
		).toBeNull();
		expect(sessionStorage.getItem("pi-dashboard:missing-required-dismissed")).toBe("1");

		// Re-mount while still missing — stays dismissed.
		cleanup();
		const { container: c2 } = render(<MissingRequiredBanner />);
		expect(c2.querySelector('[data-testid="missing-required-banner"]')).toBeNull();
	});

	it("ignores strongly-suggested entries (not required)", () => {
		mockRecommended.mockReturnValue({
			recommended: [
				makeEntry({
					id: "pi-flows",
					status: "strongly-suggested",
					displayName: "pi-flows",
				}),
			],
			isLoading: false,
			error: null,
			refresh: async () => {},
		});
		const { container } = render(<MissingRequiredBanner />);
		expect(container.querySelector('[data-testid="missing-required-banner"]')).toBeNull();
	});
});
