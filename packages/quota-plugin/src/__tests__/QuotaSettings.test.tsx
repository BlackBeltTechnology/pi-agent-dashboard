/**
 * QuotaSettings anatomy tests (retro-ux-plugin-settings-wave-2): reason pills,
 * the visible ToS notice, retry fields. Mounts inside the draft + plugin
 * context like `dialog.test.tsx`; `/api/quota` is stubbed per case.
 */
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
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_PROVIDERS } from "../providers.js";
import { QuotaSettings } from "../QuotaSettings.js";
import type { ApiQuotaResponse, QuotaPluginConfig } from "../types.js";

const WINDOW = 5 * 3600;

async function mountSettings(config: QuotaPluginConfig, quota: ApiQuotaResponse = { providers: [] }) {
  initPluginConfigs({ quota: config as Record<string, unknown> });
  global.fetch = vi.fn(async () => ({ json: async () => quota })) as unknown as typeof fetch;
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuotaSettings anatomy", () => {
  it("E7: the body has no title/id header and no own bordered card", async () => {
    const { getByTestId } = await mountSettings({ enabled: true });
    const section = getByTestId("quota-settings");
    expect(section.querySelector("h1, h2, h3")).toBeNull();
    const repeats = Array.from(section.querySelectorAll("*")).filter((el) =>
      ["Provider Quota", "quota"].includes((el.textContent ?? "").trim()),
    );
    expect(repeats).toEqual([]);
    expect(section.className).not.toMatch(/\bborder\b/);
  });

  it("E8: master switch is 'Check quotas', keeps its testid, hint says the plugin stays on, writes enabled", async () => {
    const { getByRole, getByTestId, src, sent } = await mountSettings({ enabled: true });
    const sw = getByRole("switch", { name: "Check quotas" });
    expect(sw).toBe(getByTestId("quota-enable"));
    for (const bad of ["Enabled", "Enable", "On", "Enable quota tracking"]) {
      expect(() => getByRole("switch", { name: bad })).toThrow();
    }
    const desc = (sw.getAttribute("aria-describedby") ?? "").split(" ")[0];
    expect(sw.ownerDocument.getElementById(desc)?.textContent).toMatch(/plugin stays on/);
    fireEvent.click(sw);
    await waitFor(() => expect(src().isDirty).toBe(true));
    await act(async () => {
      await src().commit();
    });
    const msg = sent.at(-1) as { type: string; config: QuotaPluginConfig };
    expect(msg.type).toBe("plugin_config_write");
    expect(msg.config.enabled).toBe(false);
  });

  it("every provider is a labelled switch, off by default", async () => {
    const { getByTestId, container } = await mountSettings({});
    for (const id of SUPPORTED_PROVIDERS) {
      const sw = getByTestId(`quota-provider-${id}`);
      expect(sw.getAttribute("role")).toBe("switch");
      expect(sw.getAttribute("aria-checked")).toBe("false");
    }
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("E15: worded status pill per provider reason; off → no pill; reason testid on the pill", async () => {
    // test-plan #E15 (decision table on reason)
    const { getByTestId, queryByTestId } = await mountSettings(
      {
        enabled: true,
        providers: {
          anthropic: { enabled: true }, // has data
          openrouter: { enabled: true }, // no-credential
          "opencode-go": { enabled: true }, // peer-rejected
          zai: { enabled: true }, // no-data
          synthetic: { enabled: true }, // no-adapter
          "github-copilot": { enabled: false }, // off
        },
      },
      {
        providers: [
          {
            provider: "anthropic",
            windows: [{ label: "5h", usedPercent: 10, resetsAt: new Date(Date.now() + 3600_000).toISOString(), windowSeconds: WINDOW }],
          },
        ],
        unavailable: [
          { provider: "openrouter", reason: "no-credential" },
          { provider: "opencode-go", reason: "peer-rejected" },
          { provider: "zai", reason: "no-data" },
          { provider: "synthetic", reason: "no-adapter" },
        ],
      },
    );
    const cases: Array<[string, string, string]> = [
      ["openrouter", "Not signed in", "neutral"],
      ["opencode-go", "Request refused", "warning"],
      ["zai", "No quota reported", "neutral"],
      ["synthetic", "Not supported", "neutral"],
    ];
    for (const [id, word, tone] of cases) {
      const pill = await waitFor(() => getByTestId(`quota-provider-${id}-reason`));
      expect(pill.textContent).toBe(word);
      expect(pill.getAttribute("data-tone")).toBe(tone);
    }
    const signed = getByTestId("quota-provider-anthropic-row").querySelector("[data-tone]");
    expect(signed?.textContent).toBe("Signed in");
    expect(signed?.getAttribute("data-tone")).toBe("success");
    expect(queryByTestId("quota-provider-anthropic-reason")).toBeNull();
    expect(getByTestId("quota-provider-github-copilot-row").querySelector("[data-tone]")).toBeNull();
    expect(queryByTestId("quota-provider-github-copilot-reason")).toBeNull();
    // 11 px minimum, never muted text.
    const all = getByTestId("quota-provider-zai-reason");
    expect(all.className).not.toMatch(/text-\[(9|10)px\]/);
    expect(all.className).not.toMatch(/--text-(muted|faint)/);
  });

  it("E16: the ToS warning is a visible warning notice above the providers, not a tooltip", async () => {
    // test-plan #E16
    const { getByTestId, container } = await mountSettings({ enabled: true });
    const tos = getByTestId("quota-tos-warning");
    expect(tos.getAttribute("data-tone")).toBe("warning");
    expect(tos.textContent).toMatch(/undocumented provider endpoints/);
    expect(tos.className).toContain("--severity-warning-");
    expect(tos.className).toContain("text-xs");
    const first = getByTestId(`quota-provider-${SUPPORTED_PROVIDERS[0]}`);
    expect(tos.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const titled = Array.from(container.querySelectorAll("[title]")).filter((el) =>
      /undocumented|terms/i.test(el.getAttribute("title") ?? ""),
    );
    expect(titled).toEqual([]);
    expect(tos.closest("[title]")).toBeNull();
  });

  it("E17: retry off → disabled fields and no preview", async () => {
    // test-plan #E17 (retry.enabled false)
    const { getByTestId, queryByTestId } = await mountSettings({ enabled: true, retry: { enabled: false } });
    for (const id of ["maxAttempts", "baseDelayMs", "maxDelayMs"]) {
      expect((getByTestId(`quota-retry-${id}`) as HTMLInputElement).disabled).toBe(true);
    }
    expect(queryByTestId("quota-retry-preview")).toBeNull();
    expect(getByTestId("quota-retry-enabled").getAttribute("role")).toBe("switch");
  });

  it("E17: retry on → enabled fields, ≥ 12 px info preview, ms chips inside labels, ranges in hints", async () => {
    // test-plan #E17 (retry.enabled true)
    const { getByTestId } = await mountSettings({
      enabled: true,
      retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    for (const id of ["maxAttempts", "baseDelayMs", "maxDelayMs"]) {
      expect((getByTestId(`quota-retry-${id}`) as HTMLInputElement).disabled).toBe(false);
    }
    const preview = getByTestId("quota-retry-preview");
    expect(preview.getAttribute("data-tone")).toBe("info");
    expect(preview.className).toContain("text-xs");
    expect(preview.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
    expect(preview.innerHTML).not.toMatch(/--text-(muted|faint)/);
    expect(getByTestId("quota-retry-total")).toBeTruthy();
    expect(getByTestId("quota-retry-sequence")).toBeTruthy();
    for (const id of ["baseDelayMs", "maxDelayMs"]) {
      const input = getByTestId(`quota-retry-${id}`) as HTMLInputElement;
      const label = input.ownerDocument.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent).toContain("ms");
      expect(label?.textContent).not.toContain("(ms)");
      const hint = input.ownerDocument.getElementById((input.getAttribute("aria-describedby") ?? "").split(" ")[0]);
      expect(hint?.textContent).toMatch(/\d/);
    }
  });

  it("an emptied retry field is invalid: error shown, commit refused", async () => {
    const { getByTestId, src, sent, container } = await mountSettings({
      enabled: true,
      retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    fireEvent.change(getByTestId("quota-retry-baseDelayMs"), { target: { value: "" } });
    await waitFor(() => expect(getByTestId("quota-retry-baseDelayMs").getAttribute("aria-invalid")).toBe("true"));
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    await act(async () => {
      await expect(src().commit()).rejects.toThrow();
    });
    expect(sent).toHaveLength(0);
    expect(src().isDirty).toBe(true);
  });
});
