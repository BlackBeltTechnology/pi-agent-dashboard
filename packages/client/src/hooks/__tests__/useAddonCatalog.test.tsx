/**
 * Catalog hook: one refetch per event, bursts debounced.
 * See change: addons-hub-feature-catalog (test-plan #F4).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feature } from "../../components/__tests__/addons-feature-fixtures.js";
import { ADDON_CATALOG_DEBOUNCE_MS, useAddonCatalog } from "../useAddonCatalog.js";

vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

let version = 0;
const fetchMock = vi.fn();

beforeEach(() => {
	version = 0;
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true, features: [feature(`pkg:v${++version}`)] })));
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("useAddonCatalog", () => {
	it("F4: refetches exactly once per event (burst → one) and converges to the new state", async () => {
		const { result } = renderHook(() => useAddonCatalog());
		await waitFor(() => expect(result.current.features[0]?.id).toBe("pkg:v1"));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.useFakeTimers();
		act(() => {
			window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", success: true } }));
			window.dispatchEvent(new CustomEvent("plugin-config-update", { detail: {} }));
			window.dispatchEvent(new CustomEvent("plugin-config-update", { detail: {} }));
		});
		expect(fetchMock).toHaveBeenCalledTimes(1); // debounced
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ADDON_CATALOG_DEBOUNCE_MS + 10);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.current.features[0]?.id).toBe("pkg:v2");

		// a failed package operation does not refetch
		act(() => {
			window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", success: false } }));
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ADDON_CATALOG_DEBOUNCE_MS + 10);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
