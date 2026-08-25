/**
 * Settings gating -- deliberately narrow: Anthropic is the ONLY gated row,
 * because @hk_net/pi-usage-bars is the only source that can serve it. Every
 * other provider stays tickable regardless of which peers are installed.
 * A previous revision gated every provider off a capability table; that made
 * whole settings panels go dead and was reverted. See change:
 * add-provider-quota-plugin.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiQuotaResponse, QuotaSourceStatusDto } from "../types.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useSettingsDraftSource: () => {},
  useT: () => (_k: string, vars?: Record<string, unknown>, fallback?: string) =>
    // Mimic the shell's {var} interpolation so needs-hints are assertable.
    Object.entries(vars ?? {}).reduce<string>(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      fallback ?? _k,
    ),
  useUiPrimitive: () => null,
}));
vi.mock("@blackbelt-technology/dashboard-plugin-runtime/context", () => ({
  usePluginConfig: () => ({ enabled: true, providers: {} }),
  usePluginSend: () => async () => {},
}));

const { QuotaSettings } = await import("../client.js");

function mockSources(installed: string[]) {
  const sources: QuotaSourceStatusDto[] = [
    { id: "pi-quotas", package: "@latentminds/pi-quotas", installed: installed.includes("pi-quotas") },
    { id: "usage-bars", package: "@hk_net/pi-usage-bars", installed: installed.includes("usage-bars") },
  ];
  const body: ApiQuotaResponse = { providers: [], sources };
  global.fetch = vi.fn(async () => ({ json: async () => body })) as unknown as typeof fetch;
}

const box = (id: string) => screen.getByTestId(`quota-provider-${id}`) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuotaSettings provider gating", () => {
  it("without @hk_net/pi-usage-bars, ONLY anthropic is disabled and it names the package", async () => {
    mockSources(["pi-quotas"]);
    render(<QuotaSettings />);

    await waitFor(() => expect(box("anthropic").disabled).toBe(true));
    expect(box("anthropic").checked).toBe(false);
    expect(screen.getByTestId("quota-provider-anthropic-needs").textContent).toContain(
      "@hk_net/pi-usage-bars",
    );
    // No other row is gated -- this is the regression guard.
    for (const id of ["github-copilot", "openai-codex", "zai", "opencode-go", "synthetic"]) {
      expect(box(id).disabled).toBe(false);
      expect(screen.queryByTestId(`quota-provider-${id}-needs`)).toBeNull();
    }
  });

  it("with @hk_net/pi-usage-bars installed, anthropic is tickable and the hint is gone", async () => {
    mockSources(["usage-bars"]);
    render(<QuotaSettings />);

    await waitFor(() => expect(box("anthropic").disabled).toBe(false));
    expect(screen.queryByTestId("quota-provider-anthropic-needs")).toBeNull();
    // pi-quotas being absent must NOT disable the providers it would serve.
    for (const id of ["github-copilot", "opencode-go", "synthetic"]) {
      expect(box(id).disabled).toBe(false);
    }
  });

  it("with no peer installed at all, still only anthropic is gated", async () => {
    mockSources([]);
    render(<QuotaSettings />);

    await waitFor(() => expect(box("anthropic").disabled).toBe(true));
    expect(box("github-copilot").disabled).toBe(false);
    expect(box("openai-codex").disabled).toBe(false);
  });

  it("keeps the Anthropic ToS warning on its own row, gated or not", async () => {
    mockSources(["usage-bars"]);
    render(<QuotaSettings />);

    await waitFor(() => expect(screen.getByTestId("quota-tos-warning")).toBeTruthy());
  });
});
