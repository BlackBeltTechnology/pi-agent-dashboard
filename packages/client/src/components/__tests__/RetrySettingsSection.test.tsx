/**
 * RetrySettingsSection — GLOBAL editor over pi's six native retry fields.
 * Tests inject load/save so no fetch is mocked.
 * See change: retry-forever-with-stop-control.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
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
  const r = render(<RetrySettingsSection load={load(over)} save={save} />);
  await waitFor(() => expect(r.getByTestId("retry-maxretries-input")).toBeTruthy());
  return { ...r, save };
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
    const { getByTestId } = await mount({}, save);
    fireEvent.change(getByTestId("retry-maxretries-input"), { target: { value: "24" } });
    fireEvent.change(getByTestId("retry-provider-maxretries-input"), { target: { value: "2" } });
    fireEvent.click(getByTestId("retry-save"));
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
    const { getByTestId } = await mount({}, save);
    fireEvent.change(getByTestId("retry-provider-timeout-input"), { target: { value: "5000" } });
    fireEvent.click(getByTestId("retry-save"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].provider.timeoutMs).toBe(5000);
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
    const { getByTestId } = await mount({}, save);
    fireEvent.change(getByTestId(testId), { target: { value: bad } });
    expect(getByTestId("retry-error")).toBeTruthy();
    expect((getByTestId("retry-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId("retry-save"));
    expect(save).not.toHaveBeenCalled();
  });

  it("previews the delay progression and total", async () => {
    const { getByTestId } = await mount({ maxRetries: 8 });
    expect(getByTestId("retry-schedule-total").textContent).toMatch(/min|h|days/);
    expect(getByTestId("retry-schedule-preview").textContent).toMatch(/2 s/);
  });

  it("warns above ~20 attempts but stays saveable", async () => {
    const { getByTestId } = await mount({ maxRetries: 24 });
    expect(getByTestId("retry-longtail-warning")).toBeTruthy();
    expect((getByTestId("retry-save") as HTMLButtonElement).disabled).toBe(false);
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
