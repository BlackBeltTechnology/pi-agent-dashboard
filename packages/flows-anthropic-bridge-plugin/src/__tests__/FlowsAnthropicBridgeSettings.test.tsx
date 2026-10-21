/**
 * FlowsAnthropicBridgeSettings — kit notices/table/pills, a three-way "Bridge gate"
 * and the host Save bar (draft id `plugin:flows-anthropic-bridge`).
 *
 * Harness mirrors `grammar-plugin/src/__tests__/GrammarSettings.test.tsx`: a capturing
 * `SettingsDraftProvider` registry whose registered source is driven like the host does.
 * See change: retro-ux-plugin-settings-wave-2 (test-plan E7, E18, E19, F5, X9).
 */
import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowsAnthropicBridgeSettings } from "../FlowsAnthropicBridgeSettings.js";

const AM = "@pi/anthropic-messages";
const FLOWS = "pi-flows";

interface Session {
  pid: number;
  status: string;
  peers: Record<string, { ok: boolean; reason?: string }>;
  at: number;
}

const okPeers = { [AM]: { ok: true }, [FLOWS]: { ok: true } };
const session = (pid: number, status: string, peers: Session["peers"] = okPeers): Session => ({
  pid,
  status,
  peers,
  at: 0,
});

const jsonResponse = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response;

/** Install a fetch stub answering `/api/flows-anthropic-bridge/status` from a queue of handlers. */
function stubFetch(...handlers: Array<() => Promise<Response>>) {
  let n = 0;
  const mock = vi.fn(async () => {
    const h = handlers[Math.min(n, handlers.length - 1)];
    n += 1;
    return h();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const sessionsOk = (sessions: Session[]) => () => Promise.resolve(jsonResponse({ sessions }));

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
    applyPluginConfigUpdate({ type: "plugin_config_update", id: "flows-anthropic-bridge", config });
  });
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={send}>
        <CurrentPluginLayer pluginId="flows-anthropic-bridge">
          <FlowsAnthropicBridgeSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  const src = (): RegisteredSource => {
    const s = sources.get("plugin:flows-anthropic-bridge");
    if (!s) throw new Error("plugin:flows-anthropic-bridge never registered with the unified-Save registry");
    return s;
  };
  return { ...r, src, send };
}

const radio = (r: ReturnType<typeof mount>, name: string) => r.getByRole("radio", { name });
const selected = (r: ReturnType<typeof mount>) =>
  r
    .getAllByRole("radio")
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => el.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Bridge gate mapping (E18)", () => {
  const states: { force: boolean; disable: boolean; expected: string[] }[] = [
    { force: false, disable: false, expected: ["Automatic"] },
    { force: true, disable: false, expected: ["Always on"] },
    { force: false, disable: true, expected: ["Off"] },
    { force: true, disable: true, expected: [] },
  ];
  for (const s of states) {
    it(`(force ${s.force}, disable ${s.disable}) selects ${s.expected[0] ?? "no option"}`, async () => {
      stubFetch(sessionsOk([]));
      const r = mount({ forceCanonical: s.force, disableCanonical: s.disable });
      expect(selected(r)).toEqual(s.expected);
      const conflict = r.queryByTestId("flows-anthropic-bridge-conflict");
      if (s.force && s.disable) {
        expect(conflict?.getAttribute("data-tone")).toBe("warning");
        expect(conflict?.textContent).toMatch(/both overrides are set/i);
        // unchanged until the user picks
        expect(r.src().isDirty).toBe(false);
        await r.src().commit();
        expect(r.send).not.toHaveBeenCalled();
      } else {
        expect(conflict).toBeNull();
      }
      await waitFor(() => expect(r.queryByText("Checking sessions…")).toBeNull());
    });
  }

  const picks: { from: Record<string, boolean>; pick: string; payload: Record<string, boolean> }[] = [
    { from: { forceCanonical: true, disableCanonical: false }, pick: "Automatic", payload: { forceCanonical: false, disableCanonical: false } },
    { from: { forceCanonical: false, disableCanonical: false }, pick: "Always on", payload: { forceCanonical: true, disableCanonical: false } },
    { from: { forceCanonical: false, disableCanonical: false }, pick: "Off", payload: { forceCanonical: false, disableCanonical: true } },
    { from: { forceCanonical: true, disableCanonical: true }, pick: "Off", payload: { forceCanonical: false, disableCanonical: true } },
    { from: { forceCanonical: true, disableCanonical: true }, pick: "Automatic", payload: { forceCanonical: false, disableCanonical: false } },
  ];
  for (const p of picks) {
    it(`picking ${p.pick} from ${JSON.stringify(p.from)} commits ${JSON.stringify(p.payload)}`, async () => {
      stubFetch(sessionsOk([]));
      const r = mount(p.from);
      fireEvent.click(radio(r, p.pick));
      await waitFor(() => expect(r.src().isDirty).toBe(true));
      expect(selected(r)).toEqual([p.pick]);
      expect(r.queryByTestId("flows-anthropic-bridge-conflict")).toBeNull();
      expect(r.send).not.toHaveBeenCalled();
      await r.src().commit();
      expect(r.send).toHaveBeenCalledTimes(1);
      expect(r.send.mock.calls[0][0]).toEqual({
        type: "plugin_config_write",
        id: "flows-anthropic-bridge",
        config: p.payload,
      });
    });
  }

  it("picking the persisted option is not a change; reset restores the stored gate", async () => {
    stubFetch(sessionsOk([]));
    const r = mount({ forceCanonical: true, disableCanonical: false });
    fireEvent.click(radio(r, "Off"));
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    fireEvent.click(radio(r, "Always on"));
    await waitFor(() => expect(r.src().isDirty).toBe(false));
    fireEvent.click(radio(r, "Off"));
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    act(() => r.src().reset());
    await waitFor(() => expect(r.src().isDirty).toBe(false));
    expect(selected(r)).toEqual(["Always on"]);
  });

  // doubt-review 4.50 #1: re-picking the stored gate leaves no ghost pick, so a
  // gate saved elsewhere is adopted instead of turning into a phantom edit.
  it("re-picking the stored gate leaves no ghost: a later broadcast is adopted", async () => {
    stubFetch(sessionsOk([]));
    const r = mount({ forceCanonical: true, disableCanonical: false });
    fireEvent.click(radio(r, "Off"));
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    fireEvent.click(radio(r, "Always on"));
    await waitFor(() => expect(r.src().isDirty).toBe(false));
    act(() => {
      applyPluginConfigUpdate({
        type: "plugin_config_update",
        id: "flows-anthropic-bridge",
        config: { forceCanonical: false, disableCanonical: false },
      });
    });
    await waitFor(() => expect(selected(r)).toEqual(["Automatic"]));
    expect(r.src().isDirty).toBe(false);
  });

  it("keeps the force/disable testids on the Always on / Off options and shows env vars as code in the hint", () => {
    stubFetch(sessionsOk([]));
    const r = mount({});
    expect(r.getByTestId("flows-anthropic-bridge-force").textContent).toBe("Always on");
    expect(r.getByTestId("flows-anthropic-bridge-disable").textContent).toBe("Off");
    fireEvent.click(radio(r, "Always on"));
    const codes = Array.from(r.container.querySelectorAll("code")).map((c) => c.textContent);
    expect(codes).toContain("PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL");
    fireEvent.click(radio(r, "Off"));
    expect(Array.from(r.container.querySelectorAll("code")).map((c) => c.textContent)).toContain(
      "PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL",
    );
    for (const label of ["Automatic", "Always on", "Off"]) {
      expect(radio(r, label).textContent).not.toMatch(/PI_ANTHROPIC/);
    }
  });
});

describe("Status table (E19)", () => {
  it("renders word pills for every status and peer result, no raw enum or glyph", async () => {
    stubFetch(
      sessionsOk([
        session(300, "probing", { [AM]: { ok: false, reason: "not resolved" }, [FLOWS]: { ok: false } }),
        session(100, "active"),
        session(200, "waiting_peers", { [AM]: { ok: true }, [FLOWS]: { ok: false, reason: "not installed" } }),
        session(250, "degraded"),
      ]),
    );
    const r = mount({});
    const row = (pid: number) => r.findByTestId(`flows-anthropic-bridge-session-${pid}`);
    const r100 = await row(100);
    expect(within(r100).getByText("Active").getAttribute("data-tone")).toBe("success");
    expect(within(r100).getAllByText("Loaded")).toHaveLength(2);
    expect(within(await row(200)).getByText("Waiting for peers").getAttribute("data-tone")).toBe("warning");
    expect(within(await row(250)).getByText("Degraded").getAttribute("data-tone")).toBe("warning");
    expect(within(await row(300)).getByText("Checking").getAttribute("data-tone")).toBe("info");

    const r200 = await row(200);
    expect(within(r200).getByText("Missing").getAttribute("data-tone")).toBe("error");
    expect(r200.textContent).toContain("not installed");
    // a peer absent from the payload counts as missing
    expect(within(await row(300)).getAllByText("Missing")).toHaveLength(2);

    const text = r.container.textContent ?? "";
    for (const raw of ["waiting_peers", "probing", "degraded"]) expect(text).not.toContain(raw);
    expect(text).not.toMatch(/[✓✗]/);
    // raw enum survives only as data-status
    expect(r200.querySelector('[data-status="waiting_peers"]')).not.toBeNull();
    // rows sorted by pid, columns named
    const pids = r.getAllByTestId(/^flows-anthropic-bridge-session-/).map((el) => el.getAttribute("data-testid"));
    expect(pids).toEqual([100, 200, 250, 300].map((p) => `flows-anthropic-bridge-session-${p}`));
    for (const col of ["Session process", "Bridge", AM, FLOWS]) {
      expect(r.getByRole("columnheader", { name: col })).toBeTruthy();
    }
    expect(r100.querySelector("code")?.textContent).toBe("100");
  });

  it("aggregates the notice tone: success when all active, warning with a count otherwise", async () => {
    stubFetch(sessionsOk([session(1, "active"), session(2, "active")]));
    let r = mount({});
    await waitFor(() => expect(r.getByRole("status").getAttribute("data-tone")).toBe("success"));
    expect(r.getByRole("status").textContent).toContain("all 2 sessions");
    cleanup();

    stubFetch(sessionsOk([session(1, "active"), session(2, "degraded"), session(3, "active")]));
    r = mount({});
    await waitFor(() => expect(r.getByRole("status").getAttribute("data-tone")).toBe("warning"));
    expect(r.getByRole("status").textContent).toContain("1 of 3 sessions");
  });
});

describe("Save move + loading (F5, E7)", () => {
  it("F5: 'Checking sessions…' first, then the info notice; no own Save; the gate dirties the draft", async () => {
    let resolve!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((res) => (resolve = res)));
    const r = mount({});

    expect(r.getByText("Checking sessions…")).toBeTruthy();
    expect(r.queryByText(/No pi session has reported yet/)).toBeNull();
    expect((r.getByTestId("flows-anthropic-bridge-refresh") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolve(jsonResponse({ sessions: [] }));
    });
    await waitFor(() => expect(r.queryByText("Checking sessions…")).toBeNull());
    const notice = r.getByText(/No pi session has reported yet/).closest("[data-tone]");
    expect(notice?.getAttribute("data-tone")).toBe("info");
    expect(r.queryByTestId("flows-anthropic-bridge-save")).toBeNull();
    expect(r.queryByRole("button", { name: "Save" })).toBeNull();

    expect(r.src().isDirty).toBe(false);
    fireEvent.click(radio(r, "Off"));
    await waitFor(() => expect(r.src().isDirty).toBe(true));
    expect(r.send).not.toHaveBeenCalled();
  });

  it("E7: no identity header, no id text, no own card or checkbox", async () => {
    stubFetch(sessionsOk([]));
    const r = mount({});
    await waitFor(() => expect(r.queryByText("Checking sessions…")).toBeNull());
    const root = r.getByTestId("flows-anthropic-bridge-settings");
    expect(root.textContent).not.toContain("flows-anthropic-bridge");
    for (const h of r.queryAllByRole("heading")) {
      expect(h.textContent).not.toMatch(/Anthropic Messages Bridge/i);
    }
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("Fetch failure (X9)", () => {
  it("keeps the previous table, shows a one-sentence error with Try again + Copy details, raw text hidden", async () => {
    stubFetch(
      sessionsOk([session(100, "active"), session(200, "degraded")]),
      () => Promise.reject(new Error("ECONNRESET 503 upstream")),
      sessionsOk([session(100, "active")]),
    );
    const r = mount({});
    await r.findByTestId("flows-anthropic-bridge-session-200");

    fireEvent.click(r.getByTestId("flows-anthropic-bridge-refresh"));
    const err = await r.findByTestId("flows-anthropic-bridge-error");
    expect(err.getAttribute("data-tone")).toBe("error");
    expect(err.textContent).toMatch(/Couldn't refresh the bridge status/);
    expect(within(err).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(err).getByRole("button", { name: "Copy details" })).toBeTruthy();
    expect(r.container.textContent).not.toContain("ECONNRESET");
    expect(r.container.textContent).not.toContain("503");
    // previous list kept, Refresh usable again
    expect(r.getByTestId("flows-anthropic-bridge-session-100")).toBeTruthy();
    expect(r.getByTestId("flows-anthropic-bridge-session-200")).toBeTruthy();
    expect((r.getByTestId("flows-anthropic-bridge-refresh") as HTMLButtonElement).disabled).toBe(false);

    // Try again re-fetches and clears the error
    fireEvent.click(within(err).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(r.queryByTestId("flows-anthropic-bridge-error")).toBeNull());
    expect(r.queryByTestId("flows-anthropic-bridge-session-200")).toBeNull();
  });

  it("Refresh keeps its accessible name while busy", async () => {
    let resolve!: (r: Response) => void;
    stubFetch(sessionsOk([]), () => new Promise<Response>((res) => (resolve = res)));
    const r = mount({});
    await waitFor(() => expect(r.queryByText("Checking sessions…")).toBeNull());
    fireEvent.click(r.getByTestId("flows-anthropic-bridge-refresh"));
    const btn = r.getByTestId("flows-anthropic-bridge-refresh") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Refresh");
    await act(async () => {
      resolve(jsonResponse({ sessions: [] }));
    });
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});
