/**
 * PiSettingsSection — Form / JSON editor over pi's global settings.json.
 * Tests inject load/save/syncDefaults and a textarea JSON editor (Monaco does
 * not run in jsdom), and mount inside a SettingsDraftProvider with a capturing
 * registry to drive the registered source's commit/reset exactly as the host's
 * unified Save does. See change: edit-pi-agent-settings.
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSettingsApiError, type PiSettingsReadResponse } from "../../lib/api/pi-settings-api.js";
import { PiSettingsSection } from "../settings/PiSettingsSection.js";

afterEach(() => cleanup());

const TextareaEditor = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <textarea data-testid="json-editor" value={value} onChange={(e) => onChange(e.target.value)} />
);

const snapshot = (settings: Record<string, unknown> = {}, over: Partial<PiSettingsReadResponse> = {}): PiSettingsReadResponse => ({
  success: true,
  settings,
  raw: JSON.stringify(settings, null, 2),
  etag: "etag-1",
  ...over,
});

const writeOk = (settings: Record<string, unknown> = {}, extra = {}) => ({
  success: true as const,
  settings,
  raw: JSON.stringify(settings, null, 2),
  etag: "etag-2",
  reloadedSessions: 2,
  ...extra,
});

type Props = Parameters<typeof PiSettingsSection>[0];

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
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PiSettingsSection {...props} load={load} save={save} JsonEditor={TextareaEditor} />
    </SettingsDraftProvider>,
  );
  await waitFor(() => expect(r.getByTestId("pi-settings-mode-form")).toBeTruthy());
  const src = () => {
    const s = sources.get("pi-settings");
    if (!s) throw new Error("pi-settings never registered");
    return s;
  };
  return { ...r, load, save, src };
}

const setSelect = (r: { getByTestId: (id: string) => HTMLElement }, key: string, value: string) =>
  fireEvent.change(r.getByTestId(`pi-settings-field-${key}`), { target: { value } });

describe("PiSettingsSection", () => {
  it("F3 form edit commits via the unified Save; no private Save button", async () => {
    const r = await mount();
    expect(r.queryByRole("button", { name: /save/i })).toBeNull();
    expect(r.src().isDirty).toBe(false);

    setSelect(r, "steeringMode", "all");
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    await act(async () => {
      await r.src().commit();
    });
    expect(r.save).toHaveBeenCalledWith({ mode: "form", patch: { steeringMode: "all" }, baseEtag: "etag-1" });
    await waitFor(() => expect(r.src().isDirty).toBe(false));
    expect(r.getByTestId("pi-settings-save-status").textContent).toContain("Reloaded 2");
  });

  it("builds a nested patch and deletes a cleared field with null", async () => {
    const r = await mount({ steeringMode: "all", compaction: { reserveTokens: 100 } });
    fireEvent.change(r.getByTestId("pi-settings-field-compaction.reserveTokens"), { target: { value: "" } });
    setSelect(r, "compaction.enabled", "false");
    setSelect(r, "quietStartup", "header");
    await act(async () => {
      await r.src().commit();
    });
    expect(r.save).toHaveBeenCalledWith({
      mode: "form",
      patch: { compaction: { reserveTokens: null, enabled: false }, quietStartup: "header" },
      baseEtag: "etag-1",
    });
  });

  it("rejects a negative integer client-side and stays dirty", async () => {
    const r = await mount();
    fireEvent.change(r.getByTestId("pi-settings-field-compaction.reserveTokens"), { target: { value: "-5" } });
    await act(async () => {
      await expect(r.src().commit()).rejects.toThrow();
    });
    expect(r.save).not.toHaveBeenCalled();
    expect(r.getByTestId("pi-settings-error")).toBeTruthy();
    expect(r.src().isDirty).toBe(true);
  });

  it("F4 409 shows a conflict + reload, never retries; reload clears dirty", async () => {
    const save = vi.fn().mockRejectedValue(new PiSettingsApiError(409, { success: false, error: "stale", etag: "e9", settings: {}, raw: "{}" }));
    const load = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ steeringMode: "one-at-a-time" }, { etag: "etag-9" }));
    const r = await mount({}, { load, save });
    setSelect(r, "steeringMode", "all");
    await act(async () => {
      await expect(r.src().commit()).rejects.toBeTruthy();
    });
    expect(r.getByTestId("pi-settings-conflict")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(r.getByTestId("pi-settings-reload"));
    await waitFor(() =>
      expect((r.getByTestId("pi-settings-field-steeringMode") as HTMLSelectElement).value).toBe("one-at-a-time"),
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
    setSelect(r2, "steeringMode", "all");
    await act(async () => {
      await expect(r2.src().commit()).rejects.toBeTruthy();
    });
    expect(r2.getByTestId("pi-settings-errors").textContent).toContain("steeringMode must be one of");
    expect(r2.src().isDirty).toBe(true);
  });

  it.each([413, 503])("F6 %i is a failed commit; draft stays dirty", async (status) => {
    const save = vi.fn().mockRejectedValue(new PiSettingsApiError(status, { success: false, error: status === 413 ? "Request body too large" : "busy" }));
    const r = await mount({}, { save });
    setSelect(r, "steeringMode", "all");
    await act(async () => {
      await expect(r.src().commit()).rejects.toBeTruthy();
    });
    expect(r.getByTestId("pi-settings-error")).toBeTruthy();
    expect(r.src().isDirty).toBe(true);
  });

  it("F7 mode switch while dirty asks; stay keeps the draft, discard shows the loaded JSON", async () => {
    const r = await mount({ a: 1 });
    setSelect(r, "steeringMode", "all");
    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    expect(r.getByTestId("pi-settings-switch-prompt")).toBeTruthy();
    fireEvent.click(r.getByTestId("pi-settings-switch-stay"));
    expect(r.queryByTestId("pi-settings-switch-prompt")).toBeNull();
    expect((r.getByTestId("pi-settings-field-steeringMode") as HTMLSelectElement).value).toBe("all");

    fireEvent.click(r.getByTestId("pi-settings-mode-json"));
    fireEvent.click(r.getByTestId("pi-settings-switch-discard"));
    expect((r.getByTestId("json-editor") as HTMLTextAreaElement).value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(r.src().isDirty).toBe(false);
  });

  it("F8 managed keys are read-only text with a pointer to Default model", async () => {
    const r = await mount({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", defaultThinkingLevel: "high" });
    for (const [k, v] of [
      ["defaultProvider", "anthropic"],
      ["defaultModel", "claude-opus-5-5"],
      ["defaultThinkingLevel", "high"],
    ]) {
      const el = r.getByTestId(`pi-settings-managed-${k}`);
      expect(el.textContent).toBe(v);
      expect(el.querySelector("input,select")).toBeNull();
      expect(r.queryByTestId(`pi-settings-field-${k}`)).toBeNull();
    }
    expect(r.getByTestId("pi-settings-managed-note").textContent).toMatch(/Default model/);
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
    await act(async () => {
      await r.src().commit();
    });
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
    const r = await mount({}, {}, { parseError: "Unexpected end", raw: '{ "a": ' });
    expect(r.getByTestId("pi-settings-parse-error")).toBeTruthy();
    expect((r.getByTestId("json-editor") as HTMLTextAreaElement).value).toBe('{ "a": ');
  });
});
