/**
 * RetrySettingsSection — GLOBAL editor over pi's six native retry fields.
 * Tests inject load/save so no fetch is mocked.
 *
 * The section has NO private Save button: it commits through the panel's
 * unified Save. Tests therefore mount it inside a SettingsDraftProvider with a
 * capturing registry and drive the registered source's `commit`/`reset`, which
 * is exactly what the host does. See change: unify-settings-save-contract.
 *
 * See change: retry-forever-with-stop-control.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { RetrySettingsSection } from "../settings/RetrySettingsSection.js";
import type { PiRetryPolicy } from "../../lib/api/pi-retry-api.js";

afterEach(() => cleanup());

const DEFAULTS: PiRetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
};

const load = (p: Partial<PiRetryPolicy> = {}) =>
  vi.fn().mockResolvedValue({ ...DEFAULTS, ...p });

const okSave = (reloadedSessions = 0) =>
  vi.fn().mockResolvedValue({ policy: DEFAULTS, reloadedSessions });

async function mount(over: Partial<PiRetryPolicy> = {}, save = okSave()) {
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => { sources.set(id, s); },
    remove: (id) => { sources.delete(id); },
  };
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <RetrySettingsSection load={load(over)} save={save} />
    </SettingsDraftProvider>,
  );
  await waitFor(() => expect(r.getByTestId("retry-maxretries-input")).toBeTruthy());
  /** The live registered source — re-read per call; the hook re-registers on dirty change. */
  const src = () => {
    const s = sources.get("pi-retry");
    if (!s) throw new Error("pi-retry never registered with the unified-Save registry");
    return s;
  };
  return { ...r, save, src, sources };
}

describe("RetrySettingsSection — all six native fields", () => {
  it("shows pi's defaults when unset", async () => {
    const { getByTestId } = await mount();
    expect((getByTestId("retry-enabled-toggle") as HTMLInputElement).checked).toBe(true);
    expect((getByTestId("retry-maxretries-input") as HTMLInputElement).value).toBe("3");
    expect((getByTestId("retry-basedelay-input") as HTMLInputElement).value).toBe("2000");
    expect((getByTestId("retry-provider-maxretries-input") as HTMLInputElement).value).toBe("0");
    expect((getByTestId("retry-provider-maxdelay-input") as HTMLInputElement).value).toBe("60000");
  });

  it("offers a control for each of the six fields", async () => {
    const { getByTestId } = await mount();
    for (const id of [
      "retry-enabled-toggle",
      "retry-maxretries-input",
      "retry-basedelay-input",
      "retry-provider-timeout-input",
      "retry-provider-maxretries-input",
      "retry-provider-maxdelay-input",
    ]) {
      expect(getByTestId(id)).toBeTruthy();
    }
  });

  it("renders provider.timeoutMs blank when absent (SDK default)", async () => {
    const { getByTestId } = await mount();
    expect((getByTestId("retry-provider-timeout-input") as HTMLInputElement).value).toBe("");
  });

  it("round-trips an existing provider.timeoutMs", async () => {
    const { getByTestId } = await mount({ provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 } });
    expect((getByTestId("retry-provider-timeout-input") as HTMLInputElement).value).toBe("3600000");
    expect((getByTestId("retry-provider-maxretries-input") as HTMLInputElement).value).toBe("5");
    expect((getByTestId("retry-provider-maxdelay-input") as HTMLInputElement).value).toBe("0");
  });

  it("saves all six fields, omitting a blank timeout", async () => {
    const save = okSave(3);
    const { getByTestId, src } = await mount({}, save);
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "24" } });
    fireEvent.change(getByTestId("retry-provider-maxretries-input"), { target: { value: "2" } });
    await src().commit();
    await waitFor(() => expect(getByTestId("retry-save-status").textContent).toMatch(/3/));
    expect(save).toHaveBeenCalledWith({
      enabled: true,
      maxRetries: 24,
      baseDelayMs: 2000,
      provider: { maxRetries: 2, maxRetryDelayMs: 60000 },
    });
    // timeoutMs must be absent, not 0/null.
    expect("timeoutMs" in save.mock.calls[0]![0].provider).toBe(false);
  });

  it("sends provider.timeoutMs when filled", async () => {
    const save = okSave();
    const { getByTestId, src } = await mount({}, save);
    fireEvent.change(getByTestId("retry-provider-timeout-input"), { target: { value: "5000" } });
    await src().commit();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].provider.timeoutMs).toBe(5000);
  });
});

describe("RetrySettingsSection — unified-Save contract", () => {
  it("registers as a draft source on the sessions page", async () => {
    const { src } = await mount();
    // Must match the tab SettingsPanel renders it on, else the dirty dot lands
    // on the wrong nav item.
    expect(src().page).toBe("sessions");
  });

  it("renders NO private Save button", async () => {
    const { queryByTestId } = await mount();
    expect(queryByTestId("retry-save")).toBeNull();
  });

  it("is clean on load and dirty only after an edit", async () => {
    const { getByTestId, src } = await mount();
    expect(src().isDirty).toBe(false);
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "9" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
  });

  it("goes clean again after a successful commit", async () => {
    const { getByTestId, src } = await mount();
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "9" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    await waitFor(() => expect(src().isDirty).toBe(false));
  });

  it("reset (Discard) restores the loaded policy and clears dirty", async () => {
    const { getByTestId, src } = await mount();
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "42" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    src().reset();
    await waitFor(() => {
      expect((getByTestId("retry-maxretries-input") as HTMLInputElement).value).toBe("3");
      expect(src().isDirty).toBe(false);
    });
  });

  it("a failing PUT REJECTS commit and stays dirty, so the host can report it", async () => {
    const save = vi.fn().mockRejectedValue(new Error("boom"));
    const { getByTestId, src } = await mount({}, save);
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "9" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await expect(src().commit()).rejects.toThrow(/boom/);
    expect(src().isDirty).toBe(true);
  });

  it("unregisters on unmount", async () => {
    const { unmount, sources } = await mount();
    expect(sources.has("pi-retry")).toBe(true);
    unmount();
    expect(sources.has("pi-retry")).toBe(false);
  });
});

describe("RetrySettingsSection — validation, warnings, disclosures", () => {
  it.each([
    ["retry-maxretries-input", "-1"],
    ["retry-basedelay-input", "0"],
    ["retry-provider-maxretries-input", "-1"],
    ["retry-provider-maxdelay-input", "-5"],
    ["retry-provider-timeout-input", "0"],
  ])("rejects %s=%s and does NOT save", async (testId, bad) => {
    const save = okSave();
    const { getByTestId, src } = await mount({}, save);
    fireEvent.change(getByTestId(testId), { target: { value: bad } });
    expect(getByTestId("retry-error")).toBeTruthy();
    // Invalid input must REJECT the unified commit, never silently no-op:
    // the host keeps the source dirty and names it in savePartialFail.
    await expect(src().commit()).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it("previews the delay progression and total", async () => {
    const { getByTestId } = await mount({ maxRetries: 8 });
    expect(getByTestId("retry-schedule-total").textContent).toMatch(/min|h|days/);
    expect(getByTestId("retry-schedule-preview").textContent).toMatch(/2 s/);
  });

  it("warns above ~20 attempts but stays saveable", async () => {
    const { getByTestId, src } = await mount({ maxRetries: 24 });
    expect(getByTestId("retry-longtail-warning")).toBeTruthy();
    fireEvent.change(getByTestId("retry-basedelay-input"), { target: { value: "2500" } });
    await expect(src().commit()).resolves.toBeUndefined();
  });

  it("discloses global scope", async () => {
    const { getByTestId } = await mount();
    expect(getByTestId("retry-scope-note").textContent).toMatch(/global/i);
  });

  it("discloses that a provider-layer wait is invisible", async () => {
    const { getByTestId } = await mount();
    expect(getByTestId("retry-provider-note").textContent).toMatch(/no event|no countdown/i);
  });

  it("the enabled toggle greys the agent-level numeric controls when off", async () => {
    const { getByTestId } = await mount({ enabled: true });
    fireEvent.click(getByTestId("retry-enabled-toggle"));
    expect((getByTestId("retry-maxretries-input") as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId("retry-basedelay-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("offers no project-scoped or per-session variant", async () => {
    const { container, getByTestId } = await mount();
    expect(getByTestId("retry-settings-section")).toBeTruthy();
    expect(container.querySelector('[data-testid*="project"]')).toBeNull();
    expect(container.querySelector('[data-testid*="session"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\.pi\/settings\.json/);
  });
});
