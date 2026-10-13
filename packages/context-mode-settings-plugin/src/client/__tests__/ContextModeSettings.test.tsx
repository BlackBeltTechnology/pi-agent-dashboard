/**
 * Component tests. Folds E20, F2-ish inline validation, notices.
 * See change: add-context-mode-settings-plugin.
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_SETTINGS } from "../../shared/settings-descriptors.js";
import { ContextModeSettings } from "../ContextModeSettings.js";
import type { EffectiveSettings } from "../context-api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function effective(over: Record<string, { value: unknown; isDefault: boolean }> = {}): EffectiveSettings {
  const fields: EffectiveSettings["fields"] = {};
  for (const d of CONTEXT_SETTINGS) fields[d.key] = { value: d.default, default: d.default, isDefault: true };
  for (const [k, v] of Object.entries(over)) fields[k] = { ...fields[k], ...v };
  return { filePath: "/h/.pi/context-mode/settings.json", exists: false, raw: {}, fields };
}
const jsonOk = (body: unknown) =>
  ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as unknown as Response;

function mount(fetchMock: ReturnType<typeof vi.fn>) {
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, src) => sources.set(id, src),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const utils = render(
    <SettingsDraftProvider registry={registry}>
      <ContextModeSettings />
    </SettingsDraftProvider>,
  );
  return { ...utils, sources };
}

describe("ContextModeSettings", () => {
  it("unset field shows the default with a DEFAULT badge; notices render", async () => {
    const { findByTestId, getByTestId } = mount(vi.fn(async () => jsonOk(effective())));
    const input = (await findByTestId("cms-input-search.windowMs")) as HTMLInputElement;
    expect(input.value).toBe("60000");
    expect(getByTestId("cms-default-badge-search.windowMs")).toBeTruthy();
    expect(getByTestId("cms-notice-new-sessions")).toBeTruthy();
    expect(getByTestId("cms-notice-precedence").textContent).toContain("tmux");
    expect(getByTestId("cms-notice-storage")).toBeTruthy();
  });

  it("E20: reset returns to default; the PUT body lacks the key", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) =>
      jsonOk(effective({ "search.windowMs": { value: 30000, isDefault: false } })),
    );
    const { findByTestId, getByTestId, sources } = mount(fetchMock);
    await findByTestId("cms-reset-search.windowMs");
    expect((getByTestId("cms-input-search.windowMs") as HTMLInputElement).value).toBe("30000");
    fireEvent.click(getByTestId("cms-reset-search.windowMs"));
    await waitFor(() => expect(getByTestId("cms-default-badge-search.windowMs")).toBeTruthy());
    expect((getByTestId("cms-input-search.windowMs") as HTMLInputElement).value).toBe("60000");
    await waitFor(() => expect(sources.get("plugin:context-mode-settings")?.isDirty).toBe(true));
    await sources.get("plugin:context-mode-settings")!.commit();
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT");
    expect(JSON.parse((put![1] as RequestInit).body as string)).not.toHaveProperty("search.windowMs");
  });

  it("invalid edit shows an inline error and commit rejects without a PUT", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => jsonOk(effective()));
    const { findByTestId, getByTestId, sources } = mount(fetchMock);
    fireEvent.change(await findByTestId("cms-input-search.blockAfter"), { target: { value: "0" } });
    await waitFor(() => expect(getByTestId("cms-error-search.blockAfter")).toBeTruthy());
    await waitFor(() => expect(sources.get("plugin:context-mode-settings")?.isDirty).toBe(true));
    await expect(sources.get("plugin:context-mode-settings")!.commit()).rejects.toThrow();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(false);
  });

  it("saving an edit PUTs logical keys only", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => jsonOk(effective()));
    const { findByTestId, sources } = mount(fetchMock);
    fireEvent.change(await findByTestId("cms-input-search.windowMs"), { target: { value: "30000" } });
    await waitFor(() => expect(sources.get("plugin:context-mode-settings")?.isDirty).toBe(true));
    await sources.get("plugin:context-mode-settings")!.commit();
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT");
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ "search.windowMs": 30000 });
  });

  // test-plan #E11 — retro-ux-plugin-settings-forms
  it("E11: default badge + reset ids render; an invalid edit is announced and counted", async () => {
    const { findByTestId, getByTestId, getByRole } = mount(vi.fn(async () => jsonOk(effective({ "search.maxResultsAfter": { value: 5, isDefault: false } }))));
    const input = (await findByTestId("cms-input-search.maxResultsAfter")) as HTMLInputElement;
    expect(getByTestId("cms-default-badge-search.windowMs")).toBeTruthy();
    expect(getByTestId("cms-reset-search.maxResultsAfter")).toBeTruthy();
    fireEvent.change(input, { target: { value: "-2" } });
    await waitFor(() => expect(getByTestId("cms-error-search.maxResultsAfter")).toBeTruthy());
    const err = getByTestId("cms-error-search.maxResultsAfter");
    expect(err.getAttribute("role")).toBe("alert");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(err.id);
    await waitFor(() => expect(getByRole("status", { name: "" }).textContent).toMatch(/1 unsaved change/));
  });

  // test-plan #F3
  it("F3: saving PUTs the override once and the status returns to No changes", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => jsonOk(effective()));
    const { findByTestId, sources, getByText } = mount(fetchMock);
    fireEvent.change(await findByTestId("cms-input-search.maxResultsAfter"), { target: { value: "6" } });
    await waitFor(() => expect(sources.get("plugin:context-mode-settings")?.isDirty).toBe(true));
    await sources.get("plugin:context-mode-settings")!.commit();
    const puts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).toEqual({ "search.maxResultsAfter": 6 });
    await waitFor(() => expect(getByText("No changes")).toBeTruthy());
  });

  // test-plan #X1
  it("X1: a failed load renders inside an error notice without an accent class", async () => {
    const { findByTestId } = mount(vi.fn(async () => ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "down" }) as unknown as Response));
    const el = await findByTestId("cms-load-error");
    expect(el.getAttribute("data-tone")).toBe("error");
    expect(el.className).toContain("--severity-error-fg");
    expect(el.className).not.toContain("--accent-red");
  });
});
