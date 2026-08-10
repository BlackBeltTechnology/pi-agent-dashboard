/**
 * Component tests for ModelProxySection (task 13.4).
 *
 * Tests:
 * - master toggle fires onChange with enabled flipped
 * - new-key flow shows reveal banner
 * - revoke removes a row via the API
 * - second-port validation rejects out-of-range values
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { ModelProxySection, type ModelProxyConfig } from "../components/settings/ModelProxySection.js";

// ── Mock model-proxy-api ──────────────────────────────────────────────────

vi.mock("../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "../lib/api/model-proxy-api.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noop = () => {};

function renderSection(config: ModelProxyConfig = { enabled: true }, onChange = noop) {
  return render(<ModelProxySection config={config} onChange={onChange} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ModelProxySection — master toggle (task 13.4)", () => {
  it("clicking toggle calls onChange with enabled flipped to true", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: false }, onChange);

    const toggle = getByTestId("proxy-toggle");
    await act(async () => { fireEvent.click(toggle); });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("clicking toggle calls onChange with enabled flipped to false", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: true }, onChange);

    const toggle = getByTestId("proxy-toggle");
    await act(async () => { fireEvent.click(toggle); });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe("ModelProxySection — new key flow (task 13.4)", () => {
  it("clicking New API key shows the form", async () => {
    const { getByTestId } = renderSection();
    await act(async () => {}); // allow useEffect to run

    const btn = getByTestId("new-key-button");
    await act(async () => { fireEvent.click(btn); });

    expect(getByTestId("new-key-form")).toBeDefined();
  });

  it("after create, reveal banner is shown", async () => {
    const createdKey = {
      id: "k1",
      label: "My Key",
      scopes: ["all"],
      createdAt: Date.now(),
      key: "pi-proxy-testkey",
    };
    vi.mocked(api.createApiKey).mockResolvedValue(createdKey);

    const { getByTestId, queryByTestId } = renderSection();
    await act(async () => {}); // useEffect

    // Open form
    await act(async () => { fireEvent.click(getByTestId("new-key-button")); });

    // Fill label and submit
    const input = getByTestId("new-key-label-input");
    await act(async () => { fireEvent.change(input, { target: { value: "My Key" } }); });
    await act(async () => { fireEvent.click(getByTestId("new-key-submit")); });

    // Banner should appear
    await waitFor(() => { expect(queryByTestId("reveal-banner")).not.toBeNull(); });
  });

  it("dismissing reveal banner removes it but leaves trail", async () => {
    const createdKey = {
      id: "k1",
      label: "Test Key",
      scopes: ["all"],
      createdAt: Date.now(),
      key: "pi-proxy-abc",
    };
    vi.mocked(api.createApiKey).mockResolvedValue(createdKey);

    const { getByTestId, queryByTestId, getByText } = renderSection();
    await act(async () => {});

    await act(async () => { fireEvent.click(getByTestId("new-key-button")); });
    const input = getByTestId("new-key-label-input");
    await act(async () => { fireEvent.change(input, { target: { value: "Test Key" } }); });
    await act(async () => { fireEvent.click(getByTestId("new-key-submit")); });

    await waitFor(() => { expect(queryByTestId("reveal-banner")).not.toBeNull(); });

    // Dismiss
    await act(async () => { fireEvent.click(getByTestId("reveal-banner-dismiss")); });
    expect(queryByTestId("reveal-banner")).toBeNull();

    // Trail remains
    expect(getByText(/Test Key/)).toBeDefined();
  });
});

describe("ModelProxySection — revoke removes row (task 13.4)", () => {
  it("clicking revoke calls revokeApiKey and reloads", async () => {
    const entry = {
      id: "k1",
      label: "My Key",
      scopes: ["all"],
      createdAt: Date.now(),
      hash: "***",
    };
    vi.mocked(api.listApiKeys).mockResolvedValue({ keys: [entry], revoked: [] });

    const { getByTestId } = renderSection();
    await act(async () => {}); // let listApiKeys resolve

    // Wait for revoke button to appear
    await waitFor(() => { expect(getByTestId("revoke-k1")).toBeDefined(); });

    vi.mocked(api.listApiKeys).mockResolvedValue({ keys: [], revoked: [{ ...entry, revokedAt: Date.now() }] });

    await act(async () => { fireEvent.click(getByTestId("revoke-k1")); });

    expect(api.revokeApiKey).toHaveBeenCalledWith("k1");
  });
});

describe("ModelProxySection — second port validation (task 13.4)", () => {
  it("accepts valid port in 1024–65535 range", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: true }, onChange);
    await act(async () => {});

    const portInput = getByTestId("second-port-input");
    await act(async () => {
      fireEvent.change(portInput, { target: { value: "9876" } });
      fireEvent.blur(portInput);
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ secondPort: 9876 }));
  });

  it("rejects port below 1024", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: true }, onChange);
    await act(async () => {});

    const portInput = getByTestId("second-port-input");
    await act(async () => {
      fireEvent.change(portInput, { target: { value: "80" } });
      fireEvent.blur(portInput);
    });

    await waitFor(() => {
      expect(getByTestId("second-port-error")).toBeDefined();
    });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ secondPort: 80 }));
  });

  it("rejects port above 65535", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: true }, onChange);
    await act(async () => {});

    const portInput = getByTestId("second-port-input");
    await act(async () => {
      fireEvent.change(portInput, { target: { value: "99999" } });
      fireEvent.blur(portInput);
    });

    await waitFor(() => {
      expect(getByTestId("second-port-error")).toBeDefined();
    });
  });

  it("empty port clears secondPort from config", async () => {
    const onChange = vi.fn();
    const { getByTestId } = renderSection({ enabled: true, secondPort: 9876 }, onChange);
    await act(async () => {});

    const portInput = getByTestId("second-port-input");
    await act(async () => {
      fireEvent.change(portInput, { target: { value: "" } });
      fireEvent.blur(portInput);
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ secondPort: undefined }));
  });
});
