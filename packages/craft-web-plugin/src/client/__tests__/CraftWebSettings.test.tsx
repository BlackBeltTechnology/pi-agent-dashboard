// @vitest-environment jsdom
/**
 * CraftWebSettings (settings-section): per-app enable + version channel draft through the host
 * Save Bar, status/versions, and the immediate Download/Update action.
 * See change: track-latest-craft-web-version (D4).
 */
import {
  createSlotRegistry,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, initPluginConfigs, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CraftWebSettings } from "../CraftWebSettings.js";

type AppRow = Record<string, unknown>;
type Reply = { status: number; body: unknown } | "throw";

function stub(statusSeq: Reply[], prepare: Reply = { status: 200, body: { ok: true } }) {
  const calls: Array<{ url: string; method: string }> = [];
  let i = 0;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const r = url.includes("/prepare/") ? prepare : statusSeq[Math.min(i++, statusSeq.length - 1)];
    if (r === "throw") throw new Error("down");
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return calls;
}
const statusOf = (wordcraft: AppRow): Reply => ({ status: 200, body: { shimVersion: 1, apps: { wordcraft } } });

async function mount(config: Record<string, unknown>, statusSeq: Reply[], prepare?: Reply) {
  initPluginConfigs({ "craft-web": config });
  const calls = stub(statusSeq, prepare);
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => void sources.delete(id),
  };
  const sent: unknown[] = [];
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={(m) => void sent.push(m)}>
        <CurrentPluginLayer pluginId="craft-web">
          <CraftWebSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  await waitFor(() => expect(r.getByTestId("craft-web-settings")).toBeTruthy());
  const src = () => {
    const s = sources.get("plugin:craft-web");
    if (!s) throw new Error("plugin:craft-web never registered");
    return s;
  };
  return { ...r, src, sent, calls };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const okRow = { status: "ok", enabled: true, channel: "pinned", version: "0.8.0", installedVersion: "0.8.0", sizeGzip: 16_000_000 };

describe("CraftWebSettings", () => {
  it("renders one group per claimed app with enable switch, version select, status and installed version", async () => {
    const m = await mount({}, [statusOf(okRow)]);
    await waitFor(() => expect(m.getByTestId("craft-web-wordcraft-status").textContent).toMatch(/Installed/));
    expect(m.getByTestId("craft-web-wordcraft").textContent).toContain("WordCraft");
    expect(m.getByTestId("craft-web-wordcraft-enabled").getAttribute("aria-checked")).toBe("true");
    expect((m.getByTestId("craft-web-wordcraft-version") as HTMLSelectElement).value).toBe("pinned");
    expect(m.getByTestId("craft-web-wordcraft-installed").textContent).toContain("0.8.0");
    expect(m.queryByTestId("craft-web-wordcraft-prepare")).toBeNull();
  });

  it("select + switch dirty the draft; commit sends the full config with unknown keys kept", async () => {
    const m = await mount({ other: 1, apps: { wordcraft: { enabled: true }, gridcraft: { enabled: false } } }, [statusOf(okRow)]);
    expect(m.src().isDirty).toBe(false);
    fireEvent.change(m.getByTestId("craft-web-wordcraft-version"), { target: { value: "latest" } });
    expect(m.src().isDirty).toBe(true);
    fireEvent.click(m.getByTestId("craft-web-wordcraft-enabled"));
    await act(() => m.src().commit());
    expect(m.sent).toContainEqual({
      type: "plugin_config_write",
      id: "craft-web",
      config: { other: 1, apps: { wordcraft: { enabled: false, version: "latest" }, gridcraft: { enabled: false } } },
    });
    act(() => m.src().reset());
    expect((m.getByTestId("craft-web-wordcraft-version") as HTMLSelectElement).value).toBe("pinned");
  });

  it("returning a field to its stored/default value clears dirty (absent key \u2261 default)", async () => {
    const m = await mount({}, [statusOf(okRow)]);
    const sel = m.getByTestId("craft-web-wordcraft-version");
    fireEvent.change(sel, { target: { value: "latest" } });
    expect(m.src().isDirty).toBe(true);
    fireEvent.change(sel, { target: { value: "pinned" } });
    expect(m.src().isDirty).toBe(false);
    fireEvent.click(m.getByTestId("craft-web-wordcraft-enabled"));
    fireEvent.click(m.getByTestId("craft-web-wordcraft-enabled"));
    expect(m.src().isDirty).toBe(false);
  });

  it("update available: button names the version, is disabled while dirty, prepares and refetches", async () => {
    const update = { ...okRow, status: "not-prepared", channel: "latest", version: "0.9.0", latestVersion: "0.9.0" };
    const after = { ...okRow, channel: "latest", version: "0.9.0", installedVersion: "0.9.0", latestVersion: "0.9.0" };
    const m = await mount({ apps: { wordcraft: { version: "latest" } } }, [statusOf(update), statusOf(after)]);
    const btn = await waitFor(() => m.getByTestId("craft-web-wordcraft-prepare") as HTMLButtonElement);
    expect(btn.textContent).toContain("0.9.0");
    expect(m.getByTestId("craft-web-wordcraft-status").textContent).toMatch(/Update available/);
    expect(m.getByTestId("craft-web-wordcraft-latest").textContent).toContain("0.9.0");

    fireEvent.change(m.getByTestId("craft-web-wordcraft-version"), { target: { value: "pinned" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(m.getByTestId("craft-web-wordcraft-version"), { target: { value: "latest" } });
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    await waitFor(() => expect(m.getByTestId("craft-web-wordcraft-installed").textContent).toContain("0.9.0"));
    expect(m.calls.filter((c) => c.method === "POST" && c.url.endsWith("/prepare/wordcraft"))).toHaveLength(1);
    expect(m.queryByTestId("craft-web-wordcraft-prepare")).toBeNull();
  });

  it("not downloaded: Download button; a failed prepare shows the reason", async () => {
    const row = { ...okRow, status: "not-prepared", installedVersion: undefined };
    const m = await mount({}, [statusOf(row)], { status: 503, body: { ok: false, reason: "offline" } });
    const btn = await waitFor(() => m.getByTestId("craft-web-wordcraft-prepare"));
    expect(btn.textContent).toMatch(/Download/);
    expect(m.getByTestId("craft-web-wordcraft-status").textContent).toMatch(/Not downloaded/);
    fireEvent.click(btn);
    await waitFor(() => expect(m.getByTestId("craft-web-wordcraft-error").textContent).toMatch(/offline/i));
  });

  it("status 404 → restart-required notice; unreachable → error notice; form still editable", async () => {
    const m = await mount({}, [{ status: 404, body: {} }]);
    await waitFor(() => expect(m.getByTestId("craft-web-status-notice").textContent).toMatch(/restart/i));
    expect(m.getByTestId("craft-web-wordcraft-version")).toBeTruthy();
    cleanup();
    const m2 = await mount({}, ["throw"]);
    await waitFor(() => expect(m2.getByTestId("craft-web-status-notice").textContent).toMatch(/could not/i));
  });

  it("D11: the Download button carries the download size", async () => {
    const row = { ...okRow, status: "not-prepared", installedVersion: undefined, sizeGzip: 16_580_000 };
    const m = await mount({}, [statusOf(row)]);
    const btn = await waitFor(() => m.getByTestId("craft-web-wordcraft-prepare"));
    expect(btn.textContent).toBe("Download WordCraft (about 15.8 MB)");
  });

  it("D8: an ok build on an older supported shim offers Update (shimUpdate)", async () => {
    const row = { ...okRow, status: "ok", shimUpdate: true };
    const m = await mount({}, [statusOf(row), statusOf(okRow)]);
    const btn = await waitFor(() => m.getByTestId("craft-web-wordcraft-prepare") as HTMLButtonElement);
    expect(btn.textContent).toBe("Update WordCraft");
    expect(m.getByTestId("craft-web-wordcraft-status").textContent).toMatch(/Installed/);
    fireEvent.click(btn);
    await waitFor(() => expect(m.calls.some((c) => c.url.endsWith("/prepare/wordcraft") && c.method === "POST")).toBe(true));
  });

  it("D11 G2: WordCraft sits under 'Edit files in place' with its extensions in the header", async () => {
    const m = await mount({}, [statusOf(okRow)]);
    await waitFor(() => expect(m.getByTestId("craft-web-group-edit").textContent).toMatch(/^Edit files in place/));
    expect(m.getByTestId("craft-web-wordcraft-extensions").textContent).toBe(".docx");
    expect(m.queryByTestId("craft-web-group-sibling")).toBeNull();
    expect(m.queryByTestId("craft-web-group-view")).toBeNull();
  });
});

describe("E24 settings: fixed channel + grouping by app type (D11 G2)", () => {
  const rows = {
    wordcraft: { ...okRow },
    gridcraft: { status: "not-prepared", enabled: true, channel: "pinned", version: "0.8.0", sizeGzip: 7_100_000 },
    deckcraft: { status: "not-prepared", enabled: true, channel: "pinned", version: "0.7.0", sizeGzip: 9_400_000 },
    lightcraft: { status: "not-prepared", enabled: true, channel: "pinned", version: "0.9.1", sizeGzip: 22_400_000 },
  };
  const status: Reply = { status: 200, body: { shimVersion: 2, apps: rows } };

  it("WordCraft keeps its selector; fixed apps show 'Verified <v>' with their reason and no selector", async () => {
    const m = await mount({}, [status]);
    await waitFor(() => expect(m.getByTestId("craft-web-gridcraft-fixed").textContent).toBe("Verified 0.8.0"));
    expect(m.getByTestId("craft-web-wordcraft-version")).toBeTruthy();
    expect(m.queryByTestId("craft-web-gridcraft-version")).toBeNull();
    expect(m.queryByTestId("craft-web-deckcraft-version")).toBeNull();
    expect(m.getByTestId("craft-web-gridcraft-fixed-reason").textContent).toBe("Newer releases are used once they are verified with this dashboard.");
    expect(m.getByTestId("craft-web-deckcraft-fixed").textContent).toBe("Verified 0.7.0");
    expect(m.getByTestId("craft-web-deckcraft-fixed-reason").textContent).toBe("Newer web builds fail to start.");
  });

  it("headings in order: edit in place (WordCraft, GridCraft), own format (DeckCraft), view only (LightCraft); headers list extensions; Download carries the size", async () => {
    const m = await mount({}, [status]);
    await waitFor(() => expect(m.getByTestId("craft-web-group-view")).toBeTruthy());
    const groups = [...m.container.querySelectorAll('[data-testid^="craft-web-group-"]')];
    expect(groups.map((g) => g.getAttribute("data-testid"))).toEqual(["craft-web-group-edit", "craft-web-group-sibling", "craft-web-group-view"]);
    const ids = (g: Element) => [...g.querySelectorAll("details[data-testid]")].map((d) => d.getAttribute("data-testid"));
    expect(ids(groups[0])).toEqual(["craft-web-wordcraft", "craft-web-gridcraft"]);
    expect(ids(groups[1])).toEqual(["craft-web-deckcraft"]);
    expect(ids(groups[2])).toEqual(["craft-web-lightcraft"]);
    expect(groups[0].textContent).toMatch(/^Edit files in place/);
    expect(groups[1].textContent).toMatch(/^Save in their own format, next to the file/);
    expect(groups[2].textContent).toMatch(/^View only/);
    expect(m.getByTestId("craft-web-gridcraft-extensions").textContent).toBe(".xlsx");
    expect(m.getByTestId("craft-web-deckcraft-extensions").textContent).toBe(".pptx → .deckcraft");
    expect(m.getByTestId("craft-web-lightcraft-extensions").textContent).toContain(".dng");
    expect(m.getByTestId("craft-web-gridcraft-prepare").textContent).toBe("Download GridCraft (about 6.8 MB)");
  });
});
