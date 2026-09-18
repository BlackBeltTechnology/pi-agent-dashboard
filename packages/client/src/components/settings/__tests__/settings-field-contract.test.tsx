import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FIELD_PAGE, computeConfigPartial, NumberField, SelectField, TextField, ToggleField } from "../SettingsPanel.js";
import { SettingsPanel } from "../SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});
vi.mock("../../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

// Field-level name + description contract for the four shared settings field
// components. Harness glue copied from ../../__tests__/SettingsPanel.test.tsx.
// See change: reorganize-settings-pages-and-descriptions.

/**
 * Resolve a control's accessible description the way an AT would: follow
 * aria-describedby to the referenced element(s) and join their text. Returns
 * null when the attribute is absent, so "no description" and "empty
 * description" stay distinguishable.
 */
function accessibleDescription(control: Element): string | null {
  const ids = control.getAttribute("aria-describedby");
  if (ids === null) return null;
  return ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

const noop = () => {};

afterEach(() => cleanup());

describe("shared settings field components — accessible name", () => {
  // test-plan #E4
  it("gives every one of the four components an accessible name from its label", () => {
    render(
      <>
        <ToggleField label="Probe toggle" value={false} onChange={noop} hint={null} />
        <SelectField label="Probe select" value="a" options={[{ value: "a", label: "A" }]} onChange={noop} hint={null} />
        <NumberField label="Probe number" value={1} onChange={noop} hint={null} />
        <TextField label="Probe text" value="" onChange={noop} hint={null} />
      </>,
    );

    // getByRole resolves the accessible name through label htmlFor/id — it
    // fails if the label is merely adjacent rather than associated.
    expect(screen.getByRole("switch", { name: "Probe toggle" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Probe select" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Probe number" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Probe text" })).toBeTruthy();
  });

  // test-plan #E3
  it("renders unit inside the label so it forms part of the accessible name", () => {
    render(<NumberField label="Session register timeout" value={30000} onChange={noop} unit="ms" hint={null} />);

    const control = screen.getByRole("spinbutton", { name: /Session register timeout/ });
    const label = document.querySelector(`label[for="${control.id}"]`);

    expect(label).toBeTruthy();
    // The unit lives inside the <label>, not in a sibling node.
    expect(label!.textContent).toContain("ms");
    // …and the label no longer carries the old parenthetical form.
    expect(label!.textContent).not.toContain("(ms)");
    // The computed accessible name therefore covers both parts.
    expect(screen.getByRole("spinbutton", { name: /Session register timeout.*ms/ })).toBeTruthy();
  });
});

describe("shared settings field components — accessible description", () => {
  // test-plan #E1
  it("renders a non-null hint and wires aria-describedby to it", () => {
    render(<ToggleField label="Debug events" value={false} onChange={noop} hint="Buffered until Save" />);

    const control = screen.getByRole("switch", { name: "Debug events" });
    expect(screen.getByText("Buffered until Save")).toBeTruthy();
    expect(accessibleDescription(control)).toBe("Buffered until Save");
  });

  // test-plan #E2
  it("suppresses both the hint element and aria-describedby when hint is null", () => {
    render(<ToggleField label="Debug events" value={false} onChange={noop} hint={null} />);

    const control = screen.getByRole("switch", { name: "Debug events" });
    expect(control.hasAttribute("aria-describedby")).toBe(false);
    expect(accessibleDescription(control)).toBeNull();
  });

  // test-plan #E6
  it("flattens a ReactNode hint into the accessible description", () => {
    render(
      <NumberField
        label="ask_user prompt timeout"
        value={300}
        onChange={noop}
        hint={
          <>
            Use <code>-1</code> to wait forever. Default: {300}.
          </>
        }
      />,
    );

    const control = screen.getByRole("spinbutton", { name: /ask_user prompt timeout/ });
    const description = accessibleDescription(control);

    expect(description).toContain("-1");
    expect(description).toContain("wait forever");
    expect(description).toContain("300");
  });

  // test-plan #E5
  it("generates distinct ids so two instances never cross-describe", () => {
    render(
      <>
        <NumberField label="First" value={1} onChange={noop} hint="First hint" />
        <NumberField label="Second" value={2} onChange={noop} hint="Second hint" />
      </>,
    );

    const first = screen.getByRole("spinbutton", { name: "First" });
    const second = screen.getByRole("spinbutton", { name: "Second" });

    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute("aria-describedby")).not.toBe(second.getAttribute("aria-describedby"));
    expect(accessibleDescription(first)).toBe("First hint");
    expect(accessibleDescription(second)).toBe("Second hint");
  });
});

describe("shared settings field components — disabled state", () => {
  // test-plan #F10 — D9 accepts that a disabled control's hint dims WITH the
  // control, where the old sibling <p> stayed at full opacity. Asserted at
  // component level because it is a property of the field root: on the page,
  // the gated fields are a mix of `disabled` and conditional rendering.
  it("dims the hint along with a disabled control", () => {
    render(<NumberField label="Auto-collapse" value={30} onChange={noop} hint="Collapse after this many seconds." disabled />);

    const hint = screen.getByText("Collapse after this many seconds.");
    expect(hint.closest(".opacity-50"), "hint is not inside the dimmed field root").not.toBeNull();
  });

  it("leaves an enabled control's hint undimmed", () => {
    render(<NumberField label="Auto-collapse" value={30} onChange={noop} hint="Collapse after this many seconds." />);

    const hint = screen.getByText("Collapse after this many seconds.");
    expect(hint.closest(".opacity-50")).toBeNull();
  });
});

describe("shared settings field components — required hint prop", () => {
  // test-plan #E7 — the compiler is the gate (design D1). Each block below must
  // raise a type error; if the prop ever becomes optional the @ts-expect-error
  // directives go unused and `tsc --noEmit` fails, which is the point.
  it("fails type-checking when a call site omits hint", () => {
    const omissions = (
      <>
        {/* @ts-expect-error hint is required on ToggleField */}
        <ToggleField label="No hint" value={false} onChange={noop} />
        {/* @ts-expect-error hint is required on SelectField */}
        <SelectField label="No hint" value="a" options={[{ value: "a", label: "A" }]} onChange={noop} />
        {/* @ts-expect-error hint is required on NumberField */}
        <NumberField label="No hint" value={1} onChange={noop} />
        {/* @ts-expect-error hint is required on TextField */}
        <TextField label="No hint" value="" onChange={noop} />
      </>
    );

    expect(omissions).toBeTruthy();
  });
});

// ── Host-gate fields through the panel Save contract ────────────────────────
// test-plan #E27 — `allowedHosts` + `hostGate` persist exactly like every other
// Settings field: diffed whole by `computeConfigPartial`, mapped to the
// security page for the nav-rail dirty dot. The section issues no write of
// its own (design D8).
// See change: add-host-allowlist-admission.
describe("host-gate fields — Save diff + page mapping", () => {
  // Enough of a Config for computeConfigPartial to run (it reads tunnel,
  // memoryLimits, … unconditionally); identical in draft and original so the
  // partial contains ONLY the host-gate delta.
  const base = {
    port: 8000,
    piPort: 9999,
    autoStart: true,
    autoShutdown: true,
    shutdownIdleSeconds: 300,
    spawnStrategy: "headless",
    tunnel: { enabled: true },
    devBuildOnReload: false,
    defaultModel: "",
    defaultThinkingLevel: "",
    memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
    trustedNetworks: [],
  };

  it("diffs hostGate.mode and allowedHosts into the Save partial", () => {
    const original = { ...base, hostGate: { mode: "report" }, allowedHosts: [] };
    const draft = { ...base, hostGate: { mode: "enforce" }, allowedHosts: ["a"] };

    const partial = computeConfigPartial(draft as any, original as any);

    expect(partial).toEqual({ hostGate: { mode: "enforce" }, allowedHosts: ["a"] });
  });

  it("maps both fields to the security page for the dirty dot", () => {
    expect(CONFIG_FIELD_PAGE.allowedHosts).toBe("security");
    expect(CONFIG_FIELD_PAGE.hostGate).toBe("security");
  });
});

// ── Memory Limits byte-budget + resident-count controls ────────────────────
// See change: bound-event-store-by-bytes (D5/D7/D8, tasks 5.2-5.8).
// F1-F6: render configured/default values (MiB at the edge), write bytes back,
// keep the partial write field-scoped, and indicate restart-required.
describe("Memory Limits — byte budgets and resident count", () => {
  const baseConfig = {
    port: 8000,
    piPort: 9999,
    autoStart: true,
    autoShutdown: true,
    shutdownIdleSeconds: 300,
    spawnStrategy: "headless",
    tunnel: { enabled: true },
    devBuildOnReload: false,
    memoryLimits: {
      maxEventsPerSession: 200,
      maxStringFieldSize: 4000,
      maxWsBufferBytes: 4194304,
      maxBytesPerSession: 16 * 1024 * 1024,
      maxTotalEventBytes: 805306368,
      maxCachedSessions: 8,
    },
  };
  let puts: any[] = [];

  const installFetch = (config: Record<string, unknown>) => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: config }) });
      }
      if (url === "/api/config" && options?.method === "PUT") {
        puts.push(JSON.parse(options.body));
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  };

  const gotoServer = () =>
    fireEvent.click(within(screen.getByTestId("settings-nav-rail")).getByRole("button", { name: "Server" }));

  const field = (label: RegExp) =>
    screen.getByRole("spinbutton", { name: label }) as HTMLInputElement;

  const openMemoryLimits = async (config: Record<string, unknown>) => {
    installFetch(config);
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoServer();
    await waitFor(() => screen.getByText("Memory Limits"));
  };

  const save = async () => {
    fireEvent.click(await waitFor(() => screen.getByTestId("save-btn")));
    await waitFor(() => expect(puts.length).toBeGreaterThan(0));
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    puts = [];
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
  });
  afterEach(() => cleanup());

  // F1 — configured byte values render in MiB (converted at the edge).
  it("renders configured values converted to MiB", async () => {
    await openMemoryLimits({ ...baseConfig, memoryLimits: { ...baseConfig.memoryLimits, maxBytesPerSession: 33554432, maxTotalEventBytes: 805306368 } });
    expect(field(/Max Bytes Per Session/).value).toBe("32");
    expect(field(/Max Total Event Bytes/).value).toBe("768");
  });

  // F2 — absent keys render the server-applied defaults.
  it("renders the defaults when the three keys are absent", async () => {
    await openMemoryLimits({
      ...baseConfig,
      memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
    });
    expect(field(/Max Bytes Per Session/).value).toBe("32");
    expect(field(/Max Total Event Bytes/).value).toBe("768");
    expect(field(/Max Cached Sessions/).value).toBe("32");
  });

  // F3 — the edited MiB value is written back in bytes.
  it("writes the edited per-session value back in bytes", async () => {
    await openMemoryLimits(baseConfig);
    fireEvent.change(field(/Max Bytes Per Session/), { target: { value: "32" } });
    await save();
    expect(puts[0].memoryLimits.maxBytesPerSession).toBe(33554432);
  });

  // F4 — editing one control does not pin the others.
  it("writes only the changed control (maxCachedSessions)", async () => {
    await openMemoryLimits(baseConfig);
    fireEvent.change(field(/Max Cached Sessions/), { target: { value: "4" } });
    await save();
    expect(puts[0].memoryLimits).toEqual({ maxCachedSessions: 4 });
  });

  // F5 — an unrelated Memory Limits field pins none of the new keys.
  it("does not pin the new keys when an unrelated field changes", async () => {
    await openMemoryLimits(baseConfig);
    fireEvent.change(field(/Max Events Per Session/), { target: { value: "300" } });
    await save();
    expect(puts[0].memoryLimits.maxBytesPerSession).toBeUndefined();
    expect(puts[0].memoryLimits.maxTotalEventBytes).toBeUndefined();
    expect(puts[0].memoryLimits.maxCachedSessions).toBeUndefined();
  });

  // F6 — restart-required is indicated, consistent with sibling controls.
  it("indicates that a restart is required", async () => {
    await openMemoryLimits(baseConfig);
    fireEvent.change(field(/Max Cached Sessions/), { target: { value: "4" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(screen.getByText(/Requires server restart/)).toBeTruthy();
  });
});
