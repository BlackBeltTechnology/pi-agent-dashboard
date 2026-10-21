/**
 * PiSettingsPage — schema-driven Form / JSON editor over pi's global
 * settings.json. Tests inject load/save/migrate/loadCatalogue and a textarea JSON
 * editor (Monaco does not run in jsdom), and mount inside a SettingsDraftProvider
 * with a capturing registry to drive the registered source's commit/reset exactly
 * as the host's unified Save does.
 * See changes: edit-pi-agent-settings, pi-settings-full-coverage.
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PiLegacyCredential, PiSettingsApiError, type PiSettingsReadResponse } from "../../lib/api/pi-settings-api.js";
import { PiSettingsPage } from "../settings/PiSettingsPage.js";

afterEach(() => cleanup());

const TextareaEditor = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <textarea data-testid="json-editor" value={value} onChange={(e) => onChange(e.target.value)} />
);

const snapshot = (settings: Record<string, unknown> = {}, over: Partial<PiSettingsReadResponse> = {}): PiSettingsReadResponse => ({
  success: true,
  settings,
  raw: JSON.stringify(settings, null, 2),
  etag: "etag-1",
  themes: ["dark", "light", "system"],
  legacyCredentials: [],
  ...over,
});

const writeOk = (settings: Record<string, unknown> = {}, extra = {}) => ({
  success: true as const,
  settings,
  raw: JSON.stringify(settings, null, 2),
  etag: "etag-2",
  reloadedSessions: 2,
  legacyCredentials: [] as PiLegacyCredential[],
  ...extra,
});

const CATALOGUE = {
  status: "ok" as const,
  rows: [
    { id: "anthropic/claude-sonnet-4-6", provider: "anthropic" },
    { id: "anthropic/claude-opus-5-5", provider: "anthropic" },
    { id: "openai/gpt-5.5", provider: "openai" },
    { id: "deepseek/deepseek-flash", provider: "deepseek" },
    { id: "deepseek/deepseek-v4-pro", provider: "deepseek" },
    { id: "opencode-go/muse-spark-1.3-contributor", provider: "opencode-go" },
  ],
};

type Props = Parameters<typeof PiSettingsPage>[0];

async function mount(settings: Record<string, unknown> = {}, props: Partial<Props> = {}, snap?: Partial<PiSettingsReadResponse>) {
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => {
      sources.set(id, s);
    },
    remove: (id) => {
      sources.delete(id);
    },
  };
  const load = props.load ?? vi.fn().mockResolvedValue(snapshot(settings, snap));
  const save = props.save ?? vi.fn().mockResolvedValue(writeOk({ steeringMode: "all" }));
  const migrate = props.migrate ?? vi.fn();
  const loadCatalogue = props.loadCatalogue ?? vi.fn().mockResolvedValue(CATALOGUE);
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PiSettingsPage {...props} load={load} save={save} migrate={migrate} loadCatalogue={loadCatalogue} JsonEditor={TextareaEditor} />
    </SettingsDraftProvider>,
  );
  await waitFor(() => expect(r.getByTestId("pi-settings-mode-form")).toBeTruthy());
  const src = () => {
    const s = sources.get("pi-settings");
    if (!s) throw new Error("pi-settings never registered");
    return s;
  };
  return { ...r, load, save, migrate, loadCatalogue, src, sources };
}

type R = Awaited<ReturnType<typeof mount>>;

/** Segmented control: click one option (`""` = the Default segment). */
const pick = (r: R, key: string, value: string) =>
  fireEvent.click(r.getByTestId(`pi-settings-field-${key}-${value === "" ? "default" : value}`));
const setSelect = (r: R, key: string, value: string) =>
  fireEvent.change(r.getByTestId(`pi-settings-field-${key}`), { target: { value } });
const setText = setSelect;
const isChecked = (r: R, testId: string) => (r.getByTestId(testId) as HTMLInputElement).checked;
const commit = async (r: R) => {
  await act(async () => {
    await r.src().commit();
  });
};
const commitFails = async (r: R) => {
  await act(async () => {
    await expect(r.src().commit()).rejects.toBeTruthy();
  });
};

describe("PiSettingsPage", () => {
  it("F3 form edit commits via the unified Save; no private Save button", async () => {
    const r = await mount();
    expect(r.queryByRole("button", { name: /save/i })).toBeNull();
    expect(r.src().isDirty).toBe(false);

    pick(r, "steeringMode", "all");
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    await commit(r);
    expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { steeringMode: "all" }, baseEtag: "etag-1" });
    await waitFor(() => expect(r.src().isDirty).toBe(false));
    expect(r.getByTestId("pi-settings-save-status").textContent).toContain("Reloaded 2");
  });

  it("registers under the pi-settings page", async () => {
    const r = await mount();
    expect(r.src().page).toBe("pi-settings");
  });

  it("builds a nested patch and deletes a cleared field with null", async () => {
    const r = await mount({ steeringMode: "all", compaction: { reserveTokens: 100 } });
    setText(r, "compaction.reserveTokens", "");
    pick(r, "compaction.enabled", "false");
    pick(r, "quietStartup", "header");
    await commit(r);
    expect(r.save).toHaveBeenCalledWith({
      mode: "form",
      patch: { compaction: { reserveTokens: null, enabled: false }, quietStartup: "header" },
      baseEtag: "etag-1",
    });
  });

  it("sends integers, mixed values and strings as typed values", async () => {
    const r = await mount();
    setText(r, "editorPaddingX", "2");
    pick(r, "terminal.hyperlinks", "false");
    setSelect(r, "terminal.images", "false");
    setText(r, "shellPath", "/bin/zsh");
    await commit(r);
    expect(r.save).toHaveBeenCalledWith({
      mode: "form",
      patch: { editorPaddingX: 2, terminal: { hyperlinks: false, images: false }, shellPath: "/bin/zsh" },
      baseEtag: "etag-1",
    });
  });

  describe("Form rows", () => {
    it("F2 unset keys show pi's default with no Changed pill; an unknown stored enum value stays selected and is not patched", async () => {
      const r = await mount({ transport: "quic" });
      expect(r.getByTestId("pi-settings-row-compaction.reserveTokens").textContent).toContain("16,384");
      expect(r.queryByTestId("pi-settings-changed-compaction.reserveTokens")).toBeNull();
      expect((r.getByTestId("pi-settings-field-transport") as HTMLSelectElement).value).toBe("quic");
      expect(r.getByTestId("pi-settings-changed-transport")).toBeTruthy();

      pick(r, "steeringMode", "all");
      await commit(r);
      expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { steeringMode: "all" }, baseEtag: "etag-1" });
    });

    it("a segmented control marks the selected segment and the default segment shows pi's default", async () => {
      const r = await mount();
      const def = r.getByTestId("pi-settings-field-steeringMode-default");
      expect(def.textContent).toMatch(/Default \(one-at-a-time\)/);
      expect(def.getAttribute("aria-checked")).toBe("true");
      pick(r, "steeringMode", "all");
      expect(r.getByTestId("pi-settings-field-steeringMode-all").getAttribute("aria-checked")).toBe("true");
      expect(r.getByTestId("pi-settings-changed-steeringMode").textContent).toMatch(/Changed/);
    });

    // test-plan #E9 — pi 1.3.0 key. See change: update-pi-core-1-3-adopt-apis.
    it("E9 sessionShareDestination renders in Sessions and context as an auto/gist/radius control showing pi's default", async () => {
      const r = await mount();
      const row = r.getByTestId("pi-settings-row-sessionShareDestination");
      expect(r.getByTestId("pi-settings-category-sessions").contains(row)).toBe(true);
      expect(r.getByTestId("pi-settings-category-sessions").querySelector("h3")?.textContent).toContain("Sessions and context");
      const def = r.getByTestId("pi-settings-field-sessionShareDestination-default");
      expect(def.textContent).toMatch(/Default \(auto\)/);
      expect(def.getAttribute("aria-checked")).toBe("true");
      for (const v of ["auto", "gist", "radius"]) {
        expect(r.getByTestId(`pi-settings-field-sessionShareDestination-${v}`)).toBeTruthy();
      }
      expect(r.queryByTestId("pi-settings-changed-sessionShareDestination")).toBeNull();
    });

    it("F3 a range error shows inline, blocks Save and keeps the page dirty", async () => {
      const r = await mount();
      setText(r, "autocompleteMaxVisible", "25");
      expect(r.getByTestId("pi-settings-error-autocompleteMaxVisible").textContent).toMatch(/3 to 20/);
      expect(r.getByTestId("pi-settings-field-autocompleteMaxVisible").getAttribute("aria-invalid")).toBe("true");
      await commitFails(r);
      expect(r.save).not.toHaveBeenCalled();
      expect(r.getByTestId("pi-settings-error").textContent).toMatch(/3 to 20/);
      expect(r.src().isDirty).toBe(true);
    });

    it("a stored out-of-range value does not block an unrelated save", async () => {
      const r = await mount({ autocompleteMaxVisible: 99 });
      pick(r, "steeringMode", "all");
      await commit(r);
      expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { steeringMode: "all" }, baseEtag: "etag-1" });
    });

    it("F4 reset returns a key to unset and patches null", async () => {
      const r = await mount({ theme: "dark" });
      fireEvent.click(r.getByTestId("pi-settings-reset-theme"));
      await commit(r);
      expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { theme: null }, baseEtag: "etag-1" });
    });

    it("Terminal theme offers resolved themes and Custom…, and keeps an unknown stored theme selected", async () => {
      const r = await mount({ theme: "my-theme" }, {}, { themes: ["dark", "light", "nord", "system"] });
      const sel = r.getByTestId("pi-settings-field-theme") as HTMLSelectElement;
      expect(sel.value).toBe("my-theme");
      expect([...sel.options].map((o) => o.value)).toEqual(expect.arrayContaining(["", "nord", "dark", "my-theme", "__custom__"]));
      fireEvent.change(sel, { target: { value: "__custom__" } });
      fireEvent.change(r.getByTestId("pi-settings-field-theme-custom"), { target: { value: "light/dark" } });
      await commit(r);
      expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { theme: "light/dark" }, baseEtag: "etag-1" });
    });

    it("Retry is a link row, not a second editor; default-model keys are read-only with a link", async () => {
      const onNavigate = vi.fn();
      const r = await mount({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", defaultThinkingLevel: "high", retry: { enabled: true } }, { onNavigate });
      expect(r.queryByTestId("pi-settings-field-retry.enabled")).toBeNull();
      fireEvent.click(r.getByTestId("pi-settings-link-retry.*"));
      expect(onNavigate).toHaveBeenCalledWith("sessions");
      expect(r.getByTestId("pi-settings-default-model-value").textContent).toBe("anthropic/claude-opus-5-5 · high");
      expect(r.queryByTestId("pi-settings-field-defaultModel")).toBeNull();
      fireEvent.click(r.getByTestId("pi-settings-link-packages"));
      expect(onNavigate).toHaveBeenCalledWith("add-ons");
    });

    it("object-valued and TUI-only keys are Edit-in-JSON rows without a control", async () => {
      const r = await mount({ tuiMode: "regular" });
      for (const k of ["modelThinkingLevels", "defaultTools", "npmCommand", "prompts", "themes", "tuiMode", "fullscreenScrollbar", "outputPad", "compaction.modelOverrides"]) {
        expect(r.getByTestId(`pi-settings-json-${k}`)).toBeTruthy();
        expect(r.queryByTestId(`pi-settings-field-${k}`)).toBeNull();
      }
      fireEvent.click(r.getByTestId("pi-settings-json-tuiMode"));
      expect(r.getByTestId("json-editor")).toBeTruthy();
    });

    it("dashboard-managed keys are a collapsed read-only list", async () => {
      const r = await mount({ lastChangelogVersion: "1.0.0", dashboardPluginBridges: ["a"] });
      const list = r.getByTestId("pi-settings-managed-list") as HTMLDetailsElement;
      expect(list.open).toBe(false);
      expect(r.getByTestId("pi-settings-managed-lastChangelogVersion").textContent).toBe('"1.0.0"');
      expect(r.getByTestId("pi-settings-managed-_dashboardManagedPackages").textContent).toBe("—");
    });
  });

  describe("Filtering", () => {
    it("F5 filter by key shows only that row, under its category", async () => {
      const r = await mount();
      fireEvent.change(r.getByTestId("pi-settings-filter"), { target: { value: "terminal.images" } });
      expect(r.getByTestId("pi-settings-row-terminal.images")).toBeTruthy();
      expect(r.queryByTestId("pi-settings-row-terminal.showImages")).toBeNull();
      expect(r.getByTestId("pi-settings-category-terminal")).toBeTruthy();
      expect(r.queryByTestId("pi-settings-category-model")).toBeNull();
      expect(r.getByTestId("pi-settings-category-count-terminal").textContent).toMatch(/^1 of \d+$/);
    });

    it("F5 changed-only keeps just the set rows", async () => {
      const r = await mount({ theme: "dark", enabledModels: ["anthropic/*"] });
      fireEvent.click(r.getByTestId("pi-settings-changed-only"));
      expect(r.getByTestId("pi-settings-row-theme")).toBeTruthy();
      expect(r.getByTestId("pi-settings-row-enabledModels")).toBeTruthy();
      expect(r.queryByTestId("pi-settings-row-steeringMode")).toBeNull();
      expect(r.queryByTestId("pi-settings-row-packages")).toBeNull();
    });

    it("F5 no match shows a message naming the query and hides every category", async () => {
      const r = await mount();
      fireEvent.change(r.getByTestId("pi-settings-filter"), { target: { value: "zzz" } });
      expect(r.getByTestId("pi-settings-empty").textContent).toContain("zzz");
      expect(r.queryByTestId("pi-settings-category-model")).toBeNull();
    });

    it("jump chips list the visible categories only", async () => {
      const r = await mount();
      expect(r.getByTestId("pi-settings-jump-model")).toBeTruthy();
      fireEvent.change(r.getByTestId("pi-settings-filter"), { target: { value: "proxy" } });
      expect(r.getByTestId("pi-settings-jump-network")).toBeTruthy();
      expect(r.queryByTestId("pi-settings-jump-model")).toBeNull();
    });
  });

  describe("Model cycling scope", () => {
    const scopeSave = async (r: R) => {
      await commit(r);
      return (r.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.patch;
    };

    it("E19 a stored empty array loads as All models, clean, and is never patched", async () => {
      const r = await mount({ enabledModels: [] });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-mode-all").getAttribute("aria-checked")).toBe("true"));
      expect(r.src().isDirty).toBe(false);
      pick(r, "steeringMode", "all");
      expect((await scopeSave(r)).enabledModels).toBeUndefined();
    });

    it("provider toggle saves a provider glob", async () => {
      const r = await mount();
      await waitFor(() => expect(r.loadCatalogue).toHaveBeenCalled());
      fireEvent.click(r.getByTestId("pi-settings-scope-mode-selected"));
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-provider-anthropic")).toBeTruthy());
      fireEvent.click(r.getByTestId("pi-settings-scope-provider-anthropic"));
      expect(r.getByTestId("pi-settings-scope-preview").textContent).toContain('["anthropic/*"]');
      expect((await scopeSave(r)).enabledModels).toEqual(["anthropic/*"]);
    });

    it("a single model pick saves provider/modelId", async () => {
      const r = await mount();
      fireEvent.click(r.getByTestId("pi-settings-scope-mode-selected"));
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-model-opencode-go/muse-spark-1.3-contributor")).toBeTruthy());
      fireEvent.click(r.getByTestId("pi-settings-scope-model-opencode-go/muse-spark-1.3-contributor"));
      expect((await scopeSave(r)).enabledModels).toEqual(["opencode-go/muse-spark-1.3-contributor"]);
    });

    it("round trip: unrelated edit does not touch enabledModels; patterns and picks render", async () => {
      const r = await mount({ enabledModels: ["openrouter/*", "*sonnet*", "anthropic/claude-opus-5-5"] });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-model-anthropic/claude-opus-5-5")).toBeTruthy());
      expect(isChecked(r, "pi-settings-scope-model-anthropic/claude-opus-5-5")).toBe(true);
      expect(r.getByTestId("pi-settings-scope-pattern-remove-*sonnet*")).toBeTruthy();
      expect(r.getByTestId("pi-settings-scope-pattern-remove-openrouter/*")).toBeTruthy();
      pick(r, "steeringMode", "all");
      expect((await scopeSave(r)).enabledModels).toBeUndefined();
    });

    it("a thinking-level suffix round-trips", async () => {
      const r = await mount({ enabledModels: ["anthropic/claude-opus-5-5:high"] });
      await waitFor(() => expect(isChecked(r, "pi-settings-scope-model-anthropic/claude-opus-5-5")).toBe(true));
      pick(r, "steeringMode", "all");
      expect((await scopeSave(r)).enabledModels).toBeUndefined();
    });

    it("deselecting one model of a whole provider rewrites the glob into picks", async () => {
      const r = await mount({ enabledModels: ["deepseek/*"] });
      await waitFor(() => expect(isChecked(r, "pi-settings-scope-provider-deepseek")).toBe(true));
      fireEvent.click(r.getByTestId("pi-settings-scope-model-deepseek/deepseek-flash"));
      expect((await scopeSave(r)).enabledModels).toEqual(["deepseek/deepseek-v4-pro"]);
    });

    it("a model covered by a pattern is selected and not toggleable", async () => {
      const r = await mount({ enabledModels: ["*sonnet*"] });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-model-anthropic/claude-sonnet-4-6")).toBeTruthy());
      const box = r.getByTestId("pi-settings-scope-model-anthropic/claude-sonnet-4-6") as HTMLInputElement;
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
    });

    it("pattern entries can be added and removed", async () => {
      const r = await mount({ enabledModels: ["openai/*"] });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-pattern-input")).toBeTruthy());
      fireEvent.change(r.getByTestId("pi-settings-scope-pattern-input"), { target: { value: "*opus*" } });
      fireEvent.click(r.getByTestId("pi-settings-scope-pattern-add"));
      expect(r.getByTestId("pi-settings-scope-preview").textContent).toContain('"*opus*"');
      fireEvent.click(r.getByTestId("pi-settings-scope-pattern-remove-*opus*"));
      expect(r.getByTestId("pi-settings-scope-preview").textContent).not.toContain("opus");
    });

    it("F6 Selected only with nothing picked cannot be saved", async () => {
      const r = await mount();
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-mode-selected")).toBeTruthy());
      fireEvent.click(r.getByTestId("pi-settings-scope-mode-selected"));
      await commitFails(r);
      expect(r.save).not.toHaveBeenCalled();
      expect(r.getByTestId("pi-settings-scope-error").textContent).toMatch(/at least one/i);
    });

    it("clearing every selection of a stored scope is the same error", async () => {
      const r = await mount({ enabledModels: ["anthropic/*"] });
      await waitFor(() => expect(isChecked(r, "pi-settings-scope-provider-anthropic")).toBe(true));
      fireEvent.click(r.getByTestId("pi-settings-scope-provider-anthropic"));
      await commitFails(r);
      expect(r.save).not.toHaveBeenCalled();
    });

    it("All models clears the key", async () => {
      const r = await mount({ enabledModels: ["anthropic/*"] });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-mode-all")).toBeTruthy());
      fireEvent.click(r.getByTestId("pi-settings-scope-mode-all"));
      expect((await scopeSave(r)).enabledModels).toBeNull();
    });

    it("F7 a catalogue failure shows a notice, no toggles, and leaves enabledModels out of the patch", async () => {
      const loadCatalogue = vi.fn().mockResolvedValue({ status: "unavailable" });
      const r = await mount({ enabledModels: ["anthropic/*"] }, { loadCatalogue });
      await waitFor(() => expect(r.getByTestId("pi-settings-scope-unavailable")).toBeTruthy());
      expect(r.queryByTestId("pi-settings-scope-provider-anthropic")).toBeNull();
      pick(r, "steeringMode", "all");
      expect((await scopeSave(r)).enabledModels).toBeUndefined();
    });
  });

  it("F4 409 shows a conflict + reload, never retries; reload clears dirty", async () => {
    const save = vi.fn().mockRejectedValue(new PiSettingsApiError(409, { success: false, error: "stale", etag: "e9", settings: {}, raw: "{}" }));
    const load = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ steeringMode: "one-at-a-time" }, { etag: "etag-9" }));
    const r = await mount({}, { load, save });
    pick(r, "steeringMode", "all");
    await commitFails(r);
    expect(r.getByTestId("pi-settings-conflict")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(r.getByTestId("pi-settings-reload"));
    await waitFor(() =>
      expect(r.getByTestId("pi-settings-field-steeringMode-one-at-a-time").getAttribute("aria-checked")).toBe("true"),
    );
    expect(r.queryByTestId("pi-settings-conflict")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(r.src().isDirty).toBe(false));
  });

  it("F5 invalid JSON / server 400 keeps the draft dirty with errors", async () => {
    const r = await mount();
    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    fireEvent.change(r.getByTestId("json-editor"), { target: { value: '{ "a": 1,, }' } });
    await act(async () => {
      await expect(r.src().commit()).rejects.toThrow(/Invalid JSON/);
    });
    expect(r.getByTestId("pi-settings-error").textContent).toMatch(/Invalid JSON/);
    expect(r.src().isDirty).toBe(true);
    expect(r.save).not.toHaveBeenCalled();

    // server-side per-field errors
    const save = vi.fn().mockRejectedValue(new PiSettingsApiError(400, { success: false, error: "x", errors: [{ field: "steeringMode", message: "steeringMode must be one of" }] }));
    const r2 = await mount({}, { save });
    pick(r2, "steeringMode", "all");
    await commitFails(r2);
    expect(r2.getByTestId("pi-settings-errors").textContent).toContain("steeringMode must be one of");
    expect(r2.src().isDirty).toBe(true);
  });

  it.each([413, 503])("F6 %i is a failed commit; draft stays dirty", async (status) => {
    const save = vi.fn().mockRejectedValue(new PiSettingsApiError(status, { success: false, error: status === 413 ? "Request body too large" : "busy" }));
    const r = await mount({}, { save });
    pick(r, "steeringMode", "all");
    await commitFails(r);
    expect(r.getByTestId("pi-settings-error")).toBeTruthy();
    expect(r.src().isDirty).toBe(true);
  });

  it("F7 mode switch while dirty asks; stay keeps the draft, discard shows the loaded JSON", async () => {
    const r = await mount({ a: 1 });
    pick(r, "steeringMode", "all");
    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    expect(r.getByTestId("pi-settings-switch-prompt")).toBeTruthy();
    fireEvent.click(r.getByTestId("pi-settings-switch-stay"));
    expect(r.queryByTestId("pi-settings-switch-prompt")).toBeNull();
    expect(r.getByTestId("pi-settings-field-steeringMode-all").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    fireEvent.click(r.getByTestId("pi-settings-switch-discard"));
    expect((r.getByTestId("json-editor") as HTMLTextAreaElement).value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(r.src().isDirty).toBe(false);
  });

  it("F9 JSON draft changing a managed key shows the notice before save", async () => {
    const r = await mount({ defaultModel: "claude-opus-5-5" });
    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    expect(r.queryByTestId("pi-settings-managed-notice")).toBeNull();
    fireEvent.change(r.getByTestId("json-editor"), { target: { value: '{"defaultModel":"other"}' } });
    expect(r.getByTestId("pi-settings-managed-notice").textContent).toMatch(/defaultModel/);
    expect(r.getByTestId("pi-settings-managed-notice").textContent).toMatch(/managed by the Default model/);
    fireEvent.change(r.getByTestId("json-editor"), { target: { value: '{"defaultModel":"claude-opus-5-5"}' } });
    expect(r.queryByTestId("pi-settings-managed-notice")).toBeNull();
  });

  it("raw commit sends the JSON text with the base token and re-baselines", async () => {
    const save = vi.fn().mockResolvedValue(writeOk({ x: 1 }));
    const r = await mount({}, { save });
    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    fireEvent.change(r.getByTestId("json-editor"), { target: { value: '{"x":1}' } });
    await commit(r);
    expect(save).toHaveBeenCalledWith({ mode: "json", raw: '{"x":1}', baseEtag: "etag-1" });
    expect(r.src().isDirty).toBe(false);
  });

  describe("F10 drift action visibility", () => {
    it.each([
      ["equal", { defaultModel: "anthropic/x" }, { defaultProvider: "anthropic", defaultModel: "x" }, false],
      ["different", { defaultModel: "anthropic/x" }, { defaultModel: "y" }, true],
      ["empty dashboard", { defaultModel: "" }, { defaultModel: "y" }, false],
      ["no separator", { defaultModel: "x" }, { defaultModel: "y" }, false],
    ])("%s", async (_n, dashboard, pi, shown) => {
      const syncDefaults = vi.fn().mockResolvedValue({ success: true, piMirror: { ok: true }, settings: { defaultProvider: "anthropic", defaultModel: "x" }, raw: "{}", etag: "etag-1" });
      const r = await mount(pi, { dashboardDefaults: dashboard, syncDefaults });
      expect(!!r.queryByTestId("pi-settings-sync-defaults")).toBe(shown);
      if (shown) {
        fireEvent.click(r.getByTestId("pi-settings-sync-defaults"));
        await waitFor(() => expect(syncDefaults).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(r.queryByTestId("pi-settings-sync-defaults")).toBeNull());
      }
    });

    it("an invalid dashboard thinking level is never drift", async () => {
      const r = await mount({ defaultThinkingLevel: "low" }, { dashboardDefaults: { defaultThinkingLevel: "loud" } });
      expect(r.queryByTestId("pi-settings-sync-defaults")).toBeNull();
    });

    it("a differing thinking level alone is drift", async () => {
      const r = await mount({ defaultThinkingLevel: "low" }, { dashboardDefaults: { defaultThinkingLevel: "high" } });
      expect(r.getByTestId("pi-settings-sync-defaults")).toBeTruthy();
    });
  });

  it("states the reload and global-only notes", async () => {
    const r = await mount();
    expect(r.getByTestId("pi-settings-reload-note").textContent).toMatch(/reloads running sessions/);
    expect(r.getByTestId("pi-settings-scope-note").textContent).toMatch(/global file only/);
  });

  it("starts in JSON mode with a banner when the file is unparseable", async () => {
    const r = await mount({}, {}, { parseError: "Invalid JSON at line 1, column 8", raw: '{ "a": ' });
    expect(r.getByTestId("pi-settings-parse-error")).toBeTruthy();
    expect((r.getByTestId("json-editor") as HTMLTextAreaElement).value).toBe('{ "a": ');
  });

  describe("legacy API keys", () => {
    const LEGACY: PiLegacyCredential[] = [
      { key: "anthropicApiKey", provider: "anthropic", auth: "same", masked: "…a3F9" },
      { key: "openaiApiKey", provider: "openai", auth: "none", masked: "…Q7mL" },
      { key: "providers.zai.apiKey", provider: "zai", auth: "different", masked: "…zzzz" },
      { key: "apiKey", provider: null, auth: "different", masked: "••••" },
    ];
    const migrated = (legacy: PiLegacyCredential[] = [], over: Record<string, unknown> = {}) => ({
      success: true as const,
      settings: {},
      raw: "{}",
      etag: "etag-2",
      reloadedSessions: 1,
      legacyCredentials: legacy,
      ...over,
    });

    it("F8 per-state actions in Form mode; no actions in JSON mode", async () => {
      const r = await mount({}, {}, { legacyCredentials: LEGACY });
      expect(r.getByTestId("pi-settings-legacy-remove-anthropicApiKey")).toBeTruthy();
      expect(r.getByTestId("pi-settings-legacy-move-openaiApiKey")).toBeTruthy();
      expect(r.getByTestId("pi-settings-legacy-manual-providers.zai.apiKey")).toBeTruthy();
      expect(r.getByTestId("pi-settings-legacy-manual-apiKey")).toBeTruthy();
      expect(r.getByTestId("pi-settings-legacy").textContent).toContain("…a3F9");
      expect(r.getByTestId("pi-settings-legacy").textContent).not.toMatch(/sk-/);
      fireEvent.click(r.getByTestId("pi-settings-mode-json"));
      expect(r.queryByTestId("pi-settings-legacy-remove-anthropicApiKey")).toBeNull();
      expect(r.queryByTestId("pi-settings-legacy-move-openaiApiKey")).toBeNull();
      expect(r.getByTestId("pi-settings-legacy-json-note").textContent).toMatch(/Form mode/);
    });

    it("no legacy keys, no warning", async () => {
      const r = await mount();
      expect(r.queryByTestId("pi-settings-legacy")).toBeNull();
    });

    it("a queued action applies on Save and the warning disappears", async () => {
      const migrate = vi.fn().mockResolvedValue(migrated([]));
      const r = await mount({}, { migrate }, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      expect(r.src().isDirty).toBe(true);
      await commit(r);
      expect(migrate).toHaveBeenCalledWith([{ key: "openaiApiKey", action: "move" }], "etag-1");
      expect(r.save).not.toHaveBeenCalled(); // nothing else to patch
      expect(r.queryByTestId("pi-settings-legacy")).toBeNull();
      await waitFor(() => expect(r.src().isDirty).toBe(false));
    });

    it("F9 undo before Save sends nothing and leaves the page clean", async () => {
      const r = await mount({}, {}, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      fireEvent.click(r.getByTestId("pi-settings-legacy-undo-openaiApiKey"));
      expect(r.src().isDirty).toBe(false);
      await commit(r);
      expect(r.migrate).not.toHaveBeenCalled();
    });

    it("F9 discarding (mode switch) clears the queue", async () => {
      const r = await mount({}, {}, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      fireEvent.click(r.getByTestId("pi-settings-mode-json"));
      fireEvent.click(r.getByTestId("pi-settings-switch-discard"));
      expect(r.src().isDirty).toBe(false);
      fireEvent.click(r.getByTestId("pi-settings-mode-form"));
      expect(r.queryByTestId("pi-settings-legacy-queued-openaiApiKey")).toBeNull();
      expect(r.getByTestId("pi-settings-legacy-move-openaiApiKey")).toBeTruthy();
      await commit(r);
      expect(r.migrate).not.toHaveBeenCalled();
    });

    it("F10 cleanup succeeds, patch fails: patch uses the cleanup token, user edits and the JSON baseline survive, a retry sends only the patch", async () => {
      const migrate = vi.fn().mockResolvedValue(migrated([], { raw: '{\n  "cleaned": true\n}\n', settings: { cleaned: true } }));
      const save = vi
        .fn()
        .mockRejectedValueOnce(new PiSettingsApiError(400, { success: false, error: "x", errors: [{ field: "steeringMode", message: "steeringMode bad" }] }))
        .mockResolvedValue(writeOk({ steeringMode: "all" }));
      const r = await mount({}, { migrate, save }, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      pick(r, "steeringMode", "all");

      await commitFails(r);
      expect(migrate).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith({ mode: "form", patch: { steeringMode: "all" }, baseEtag: "etag-2" });
      expect(r.queryByTestId("pi-settings-legacy")).toBeNull();
      expect(r.getByTestId("pi-settings-field-steeringMode-all").getAttribute("aria-checked")).toBe("true");
      expect(r.src().isDirty).toBe(true);

      // The JSON baseline is the cleanup snapshot, not the pre-cleanup file.
      fireEvent.click(r.getByTestId("pi-settings-mode-json"));
      fireEvent.click(r.getByTestId("pi-settings-switch-discard"));
      expect((r.getByTestId("json-editor") as HTMLTextAreaElement).value).toBe('{\n  "cleaned": true\n}\n');
      fireEvent.click(r.getByTestId("pi-settings-mode-form"));

      // Retry (after re-entering the edit): the move is not re-sent.
      pick(r, "steeringMode", "all");
      await commit(r);
      expect(migrate).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("F11 a field error blocks both the cleanup and the patch", async () => {
      const r = await mount({}, {}, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      setText(r, "autocompleteMaxVisible", "25");
      await commitFails(r);
      expect(r.migrate).not.toHaveBeenCalled();
      expect(r.save).not.toHaveBeenCalled();
    });

    it("a failed cleanup keeps the patch unsent and reconciles the queue with the returned list", async () => {
      const migrate = vi.fn().mockRejectedValue(
        new PiSettingsApiError(409, { success: false, error: "Providers already holds a credential for openai", legacyCredentials: [{ ...LEGACY[1], auth: "different" }] }),
      );
      const r = await mount({}, { migrate }, { legacyCredentials: [LEGACY[1]] });
      fireEvent.click(r.getByTestId("pi-settings-legacy-move-openaiApiKey"));
      pick(r, "steeringMode", "all");
      await commitFails(r);
      expect(r.save).not.toHaveBeenCalled();
      // A credential-appeared 409 is not "the file changed on disk": its own message, no reload banner.
      expect(r.queryByTestId("pi-settings-conflict")).toBeNull();
      expect(r.getByTestId("pi-settings-error").textContent).toContain("already holds a credential for openai");
      expect(r.queryByTestId("pi-settings-legacy-queued-openaiApiKey")).toBeNull();
      expect(r.getByTestId("pi-settings-legacy-manual-openaiApiKey")).toBeTruthy();
    });
  });
});
