import {
  createSlotRegistry,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  CurrentPluginLayer,
  initPluginConfigs,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaDialog, QuotaSettings } from "../client.js";
import type { ProviderQuota, QuotaPluginConfig } from "../types.js";

const WINDOW = 5 * 3600;
const resetIn = (f: number) => new Date(Date.now() + WINDOW * f * 1000).toISOString();

const PROVIDERS: ProviderQuota[] = [
  { provider: "openai-codex", windows: [{ label: "7d", usedPercent: 30, resetsAt: resetIn(0.5), windowSeconds: WINDOW }] },
  { provider: "github-copilot", windows: [{ label: "month", usedPercent: 10, resetsAt: resetIn(0.5), windowSeconds: 30 * 86400 }] },
];

function quotaState(providers = PROVIDERS, over: Partial<import("../client.js").QuotaState> = {}) {
  return { providers, lastUpdated: Date.now(), refresh: vi.fn(), isRefreshing: false, ...over };
}

function renderDialog(initial: string, onClose = vi.fn(), providers = PROVIDERS) {
  return render(
    withUiPrimitiveProvider(
      { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
      <QuotaDialog quota={quotaState(providers)} initial={initial} onClose={onClose} />,
    ),
  );
}

afterEach(cleanup);

describe("QuotaDialog retained-snapshot badge", () => {
  // Retained (stale) figures are surfaced HERE ONLY — the footer bar renders
  // them identically to fresh ones, by explicit product decision.
  // See change: publish-quota-plugin.
  const RETAINED: ProviderQuota[] = [{ ...PROVIDERS[0], stale: true }];

  it("flags a retained snapshot so the figures are not read as live", () => {
    renderDialog("openai-codex", vi.fn(), RETAINED);
    expect(screen.getByTestId("quota-stale-openai-codex")).toBeTruthy();
  });

  it("shows no badge for a fresh snapshot", () => {
    renderDialog("openai-codex");
    expect(screen.queryByTestId("quota-stale-openai-codex")).toBeNull();
  });

  it("still renders the retained figures themselves", () => {
    renderDialog("openai-codex", vi.fn(), RETAINED);
    expect(screen.getByTestId("quota-card-openai-codex").textContent).toContain("30%");
  });
});

describe("QuotaDialog", () => {
  it("opens the shared Dialog primitive pre-selected to the clicked provider", () => {
    renderDialog("openai-codex");
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("quota-card-openai-codex")).toBeTruthy();
    expect(screen.queryByTestId("quota-card-github-copilot")).toBeNull();
  });

  it("selector switches to All → a card per provider", () => {
    renderDialog("openai-codex");
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByTestId("quota-card-openai-codex")).toBeTruthy();
    expect(screen.getByTestId("quota-card-github-copilot")).toBeTruthy();
  });

  it("selector switches to another single provider", () => {
    renderDialog("openai-codex");
    fireEvent.click(screen.getByText("Copilot"));
    expect(screen.getByTestId("quota-card-github-copilot")).toBeTruthy();
    expect(screen.queryByTestId("quota-card-openai-codex")).toBeNull();
  });

  it("F3: a refresh dropping the selected provider falls back to All", () => {
    const { rerender } = render(
      withUiPrimitiveProvider(
        { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
        <QuotaDialog quota={quotaState(PROVIDERS)} initial="openai-codex" onClose={vi.fn()} />,
      ),
    );
    expect(screen.getByTestId("quota-card-openai-codex")).toBeTruthy();

    // The next snapshot no longer carries openai-codex.
    const withoutCodex = PROVIDERS.filter((p) => p.provider !== "openai-codex");
    rerender(
      withUiPrimitiveProvider(
        { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
        <QuotaDialog quota={quotaState(withoutCodex)} initial="openai-codex" onClose={vi.fn()} />,
      ),
    );
    // Selection fell back to All — the remaining provider renders, no empty view.
    expect(screen.getByTestId("quota-card-github-copilot")).toBeTruthy();
    expect(screen.queryByTestId("quota-card-openai-codex")).toBeNull();
  });

  it("renders the header refresh control + last-updated caption", () => {
    renderDialog("openai-codex");
    expect(screen.getByTestId("quota-refresh")).toBeTruthy();
    expect(screen.getByTestId("quota-last-updated")).toBeTruthy();
  });
});

/** Mount QuotaSettings inside the draft + plugin context; expose the source + send. */
async function mountSettings(config: QuotaPluginConfig) {
  initPluginConfigs({ quota: config as Record<string, unknown> });
  global.fetch = vi.fn(async () => ({ json: async () => ({ providers: [] }) })) as unknown as typeof fetch;
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const sent: unknown[] = [];
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider
        registry={createSlotRegistry()}
        sessions={[]}
        send={(m) => {
          sent.push(m);
        }}
      >
        <CurrentPluginLayer pluginId="quota">
          <QuotaSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  await waitFor(() => expect(r.getByTestId("quota-settings")).toBeTruthy());
  const src = () => {
    const s = sources.get("plugin:quota");
    if (!s) throw new Error("plugin:quota never registered");
    return s;
  };
  return { ...r, src, sent };
}

describe("QuotaSettings retry block", () => {
  it("F4: the schedule preview states the honest wall-clock total", async () => {
    const { getByTestId } = await mountSettings({
      enabled: true,
      providers: { "openai-codex": { enabled: true } },
      retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    // Sleeps 1s→2s→4s = 7s, plus (3+1)×15s = 60s → 67s → humanized "1.1 min".
    expect(getByTestId("quota-retry-sequence").textContent).toBe("1 s → 2 s → 4 s");
    expect(getByTestId("quota-retry-total").textContent).toBe("1.1 min");
  });

  it("F4b: a malformed persisted maxAttempts is clamped, preview stays bounded", async () => {
    const { getByTestId } = await mountSettings({
      enabled: true,
      providers: { "openai-codex": { enabled: true } },
      // 1e9 would spin computeSchedule forever without the client-side clamp.
      retry: { enabled: true, maxAttempts: 1e9, baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    // Clamped to RETRY_MAX_ATTEMPTS (5): sequence has exactly 5 entries.
    expect(getByTestId("quota-retry-sequence").textContent).toBe("1 s → 2 s → 4 s → 8 s → 16 s");
  });

  it("E10: toggling a provider preserves the retry config through commit", async () => {
    const { getByTestId, src, sent } = await mountSettings({
      enabled: true,
      providers: { "openai-codex": { enabled: true }, anthropic: { enabled: false } },
      retry: { enabled: true, maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 30_000 },
    });
    fireEvent.click(getByTestId("quota-provider-anthropic"));
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    const msg = sent.at(-1) as { type: string; id: string; config: QuotaPluginConfig };
    expect(msg.type).toBe("plugin_config_write");
    expect(msg.config.retry).toEqual({ enabled: true, maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 30_000 });
    expect(msg.config.providers?.anthropic?.enabled).toBe(true);
    expect(msg.config.providers?.["openai-codex"]?.enabled).toBe(true);
  });

  it("Esc closes via the primitive", () => {
    const onClose = vi.fn();
    renderDialog("openai-codex", onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows when each window resets", () => {
    renderDialog("openai-codex");
    // 5h window, half remaining → ~2h30m out.
    expect(screen.getByTestId("quota-resets-in").textContent).toMatch(/^resets in 2h 2\dm$/);
  });

  it("omits the reset caption for a past/sentinel timestamp", () => {
    render(
      withUiPrimitiveProvider(
        { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
        <QuotaDialog
          quota={quotaState([
            {
              provider: "zai",
              // Epoch-zero sentinel, as Z.ai actually ships for its 5h window.
              windows: [{ label: "5h", usedPercent: 0, resetsAt: "1970-01-01T00:00:00.000Z", windowSeconds: WINDOW }],
            },
          ])}
          initial="zai"
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId("quota-card-zai")).toBeTruthy();
    expect(screen.queryByTestId("quota-resets-in")).toBeNull();
  });
});
