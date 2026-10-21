// @vitest-environment jsdom
/**
 * CostSettings — kit fields on the host Save bar (draft id `plugin:cost-estimator`).
 *
 * Harness mirrors `automation-plugin/src/__tests__/AutomationSettings.test.tsx`:
 * `SettingsDraftProvider` + `PluginContextProvider` + `CurrentPluginLayer`, with the
 * registered draft source driven the way the host Save bar drives it.
 * See change: retro-ux-plugin-settings-wave-2 (test-plan E11, F1).
 */
import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostSettings } from "../CostEstimator.js";

function mount(config: Record<string, unknown> = {}) {
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const send = vi.fn<(m: unknown) => Promise<void>>(() => Promise.resolve());
  act(() => {
    applyPluginConfigUpdate({ type: "plugin_config_update", id: "cost-estimator", config });
  });
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={send}>
        <CurrentPluginLayer pluginId="cost-estimator">
          <CostSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  const src = (): RegisteredSource => {
    const s = sources.get("plugin:cost-estimator");
    if (!s) throw new Error("plugin:cost-estimator never registered with the unified-Save registry");
    return s;
  };
  return { ...r, src, send };
}

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CostSettings — field ranges (E11)", () => {
  // test-plan #E11: invalid (0, "", 0, 121, -1) → field error + commit blocked;
  // valid (1, 1, 120, 0) → no error; empty never written as 0.
  const cases: { name: string; testId: string; value: string; invalid: boolean }[] = [
    { name: "Seats 0", testId: "cost-seats", value: "0", invalid: true },
    { name: "Seats 1", testId: "cost-seats", value: "1", invalid: false },
    { name: 'Seats ""', testId: "cost-seats", value: "", invalid: true },
    { name: "Break after 0", testId: "cost-gap-cap", value: "0", invalid: true },
    { name: "Break after 1", testId: "cost-gap-cap", value: "1", invalid: false },
    { name: "Break after 120", testId: "cost-gap-cap", value: "120", invalid: false },
    { name: "Break after 121", testId: "cost-gap-cap", value: "121", invalid: true },
    { name: "Price -1", testId: "cost-seat-monthly", value: "-1", invalid: true },
    { name: "Price 0", testId: "cost-seat-monthly", value: "0", invalid: false },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.invalid ? "error and commit blocked" : "valid"}`, async () => {
      // Seats starts at 3 / price at 25 so "1"/"0" are real edits, not no-ops.
      const { getByTestId, queryByRole, src, send } = mount({
        seatPlan: "custom",
        seatMonthlyUsd: 25,
        seats: 3,
        gapCapMinutes: 15,
      });
      const control = getByTestId(c.testId) as HTMLInputElement;
      type(control, c.value);

      if (c.invalid) {
        await waitFor(() => expect(queryByRole("alert")).not.toBeNull());
        expect(control.getAttribute("aria-invalid")).toBe("true");
        await expect(src().commit()).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
      } else {
        expect(queryByRole("alert")).toBeNull();
        expect(control.getAttribute("aria-invalid")).toBeNull();
        await src().commit();
        expect(send).toHaveBeenCalledTimes(1);
      }
    });
  }

  it("an emptied field is never written as 0", async () => {
    const { getByTestId, src, send } = mount({ seats: 3 });
    type(getByTestId("cost-seats"), "");
    await expect(src().commit()).rejects.toThrow();
    for (const call of send.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('"seats":0');
    }
    expect((getByTestId("cost-seats") as HTMLInputElement).value).toBe("");
  });
});

describe("CostSettings — draft, no keystroke write (F1)", () => {
  it("F1: typing sends nothing, marks 1 unsaved change, host Save writes only {seats:12}", async () => {
    const { getByTestId, src, send } = mount({ seats: 1, gapCapMinutes: 15 });
    const seats = getByTestId("cost-seats");

    type(seats, "1");
    type(seats, "12"); // typed "1" then "2"
    expect(send).toHaveBeenCalledTimes(0);
    await waitFor(() => expect(src().isDirty).toBe(true));

    await src().commit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      type: "plugin_config_write",
      id: "cost-estimator",
      config: { seats: 12 },
    });
  });

  it("reset discards the edit", async () => {
    const { getByTestId, src } = mount({ seats: 2 });
    type(getByTestId("cost-seats"), "9");
    await waitFor(() => expect(src().isDirty).toBe(true));
    act(() => src().reset());
    await waitFor(() => expect(src().isDirty).toBe(false));
    expect((getByTestId("cost-seats") as HTMLInputElement).value).toBe("2");
  });

  it("a clean draft adopts a plugin_config_update; a dirty one keeps its edited key", async () => {
    const { getByTestId, src } = mount({ seats: 2, gapCapMinutes: 15 });
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "cost-estimator", config: { seats: 4, gapCapMinutes: 15 } });
    });
    await waitFor(() => expect((getByTestId("cost-seats") as HTMLInputElement).value).toBe("4"));

    type(getByTestId("cost-seats"), "7");
    await waitFor(() => expect(src().isDirty).toBe(true));
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "cost-estimator", config: { seats: 5, gapCapMinutes: 30 } });
    });
    await waitFor(() => expect((getByTestId("cost-gap-cap") as HTMLInputElement).value).toBe("30"));
    expect((getByTestId("cost-seats") as HTMLInputElement).value).toBe("7");
  });
});

describe("CostSettings — no ghost drafts (doubt-review 4.50 #1)", () => {
  it("a field typed back to its stored value leaves no edit; a later broadcast is adopted", async () => {
    const { getByTestId, src } = mount({ seats: 2 });
    type(getByTestId("cost-seats"), "9");
    await waitFor(() => expect(src().isDirty).toBe(true));
    type(getByTestId("cost-seats"), "2");
    await waitFor(() => expect(src().isDirty).toBe(false));
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "cost-estimator", config: { seats: 6 } });
    });
    await waitFor(() => expect((getByTestId("cost-seats") as HTMLInputElement).value).toBe("6"));
    expect(src().isDirty).toBe(false);
  });
});

describe("CostSettings — shows the stored plan", () => {
  it("unset plan shows Metered with a Default pill, not Max 20×", () => {
    const { getByTestId, getAllByText } = mount({});
    expect((getByTestId("cost-seat-plan") as HTMLSelectElement).value).toBe("metered");
    expect(getAllByText("Default").length).toBeGreaterThan(0);
  });

  it("a stored plan is shown as-is", () => {
    const { getByTestId } = mount({ seatPlan: "anthropic-pro" });
    expect((getByTestId("cost-seat-plan") as HTMLSelectElement).value).toBe("anthropic-pro");
  });

  it("the custom price field only appears for the custom plan", () => {
    const a = mount({ seatPlan: "metered" });
    expect(a.queryByTestId("cost-seat-monthly")).toBeNull();
    cleanup();
    const b = mount({ seatPlan: "custom" });
    expect(b.queryByTestId("cost-seat-monthly")).not.toBeNull();
  });
});
