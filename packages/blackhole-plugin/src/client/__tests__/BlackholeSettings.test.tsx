/**
 * L1 component tests for the three states (test-plan E22, E23, X1/X3-shaped
 * client behaviour) plus the apply-semantics copy rules (F7).
 *
 * The rendered-in-a-browser versions of the state assertions live in the L3
 * Playwright spec; these cover the same branches at component level so a
 * regression is caught without the docker harness.
 *
 * See change: add-blackhole-plugin.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, KNOWN_KEYS } from "../../shared/blackhole-config.js";
import { BlackholeSettings } from "../BlackholeSettings.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: "",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

function allDefaultConfig(over: Record<string, unknown> = {}) {
  const fields: Record<string, { value: unknown; default: unknown; isDefault: boolean }> = {};
  for (const key of KNOWN_KEYS) {
    const def = (DEFAULTS as Record<string, unknown>)[key];
    const has = Object.hasOwn(over, key);
    fields[key] = { value: has ? over[key] : def, default: def, isDefault: !has };
  }
  return {
    status: "ok",
    filePath: "/tmp/agent/pi-blackhole/pi-blackhole-config.json",
    exists: false,
    unmanagedKeys: [],
    fields,
  };
}

/** Wire `fetch` for the two endpoints the component reads. */
function mockFetch(opts: { missing?: string[]; config?: unknown; configStatus?: number }) {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/plugins/blackhole/config")) {
      const status = opts.configStatus ?? 200;
      return jsonRes(opts.config ?? allDefaultConfig(), status < 400, status);
    }
    return jsonRes({
      plugins: [{ id: "blackhole", status: { missingRequirements: opts.missing ?? [] } }],
    });
  });
}

describe("not-installed state (E23, F6)", () => {
  it("renders the install command and no config control when the registry reports it missing", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ missing: ["pi-blackhole"] });
    const { getByTestId, container } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-not-installed")).toBeTruthy());
    expect(getByTestId("blackhole-install-command").textContent).toBe("pi install npm:pi-blackhole");
    expect(container.querySelectorAll("input, select, textarea").length).toBe(0);
  });

  it("is produced by this component, not by the host declining to mount it", async () => {
    // The component is mounted unconditionally; the not-installed branch is its
    // own output. If the host had withheld it, nothing would render at all.
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ missing: ["pi-blackhole"] });
    const { getByTestId } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-not-installed")).toBeTruthy());
  });
});

describe("installed but never run (E22)", () => {
  it("renders the defaults form rather than the not-installed state", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ missing: [] });
    const { getByTestId, queryByTestId } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());
    expect(queryByTestId("blackhole-not-installed")).toBeNull();
    expect((getByTestId("blackhole-input-observeAfterTokens") as HTMLInputElement).value).toBe("15000");
    expect(getByTestId("blackhole-default-badge-observeAfterTokens")).toBeTruthy();
  });

  it("does not fabricate a not-installed state when the probe has not reported yet", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string) => {
      if (url.includes("/config")) return jsonRes(allDefaultConfig());
      return jsonRes({ plugins: [{ id: "blackhole", status: null }] });
    });
    const { getByTestId, queryByTestId } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());
    expect(queryByTestId("blackhole-not-installed")).toBeNull();
  });
});

describe("parse-error state renders no form (X1, X3)", () => {
  it("shows the error, the path and recovery actions, with a disabled save control", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      configStatus: 409,
      config: {
        status: "parse-error",
        filePath: "/tmp/agent/pi-blackhole/pi-blackhole-config.json",
        message: "Unexpected token } in JSON at position 34",
      },
    });
    const { getByTestId, container } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-parse-error")).toBeTruthy());

    expect(getByTestId("blackhole-parse-message").textContent).toContain("Unexpected token");
    expect(getByTestId("blackhole-file-path").textContent).toContain("pi-blackhole-config.json");
    expect(getByTestId("blackhole-recheck")).toBeTruthy();
    expect((getByTestId("blackhole-save-blocked") as HTMLButtonElement).disabled).toBe(true);
    // No config control of any kind — not even a defaults-populated one.
    expect(container.querySelectorAll("input, select, textarea").length).toBe(0);
  });
});

describe("apply semantics (F7)", () => {
  it("never demands a restart and attributes immediate apply to the extension", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ missing: [] });
    const { getByTestId } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    const page = (getByTestId("blackhole-settings") as HTMLElement).textContent ?? "";
    expect(page).not.toMatch(/restart/i);
    const note = getByTestId("blackhole-apply-note").textContent ?? "";
    expect(note).toMatch(/pi-blackhole re-reads this file/i);
  });
});

describe("chains render from the config (E18)", () => {
  it("renders primary then fallbacks in array order", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      missing: [],
      config: allDefaultConfig({
        observerModel: { provider: "openrouter", id: "A" },
        observerFallbackModels: [
          { provider: "ollama", id: "B" },
          { provider: "cerebras", id: "C" },
        ],
      }),
    });
    const { getByTestId } = render(<BlackholeSettings />);
    await waitFor(() => expect(getByTestId("blackhole-chain-observer")).toBeTruthy());
    expect(getByTestId("blackhole-chain-observer-entry-0").textContent).toContain("A");
    expect(getByTestId("blackhole-chain-observer-entry-1").textContent).toContain("B");
    expect(getByTestId("blackhole-chain-observer-entry-2").textContent).toContain("C");
  });
});
