/**
 * Settings field family contract (test-plan #E1–#E5, #E8, #F2).
 * Wave-2 kit members (status pill, item, facts, table, group meta): wave-2
 * test-plan #E1–#E5.
 * See change: retro-ux-plugin-settings-forms, retro-ux-plugin-settings-wave-2.
 */
import { mdiCheck } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NumberField,
  SelectField,
  SettingsActionError,
  SettingsCopyButton,
  SettingsFacts,
  SettingsGroup,
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  SettingsTable,
  TextAreaField,
  TextField,
  ToggleField,
} from "../settings-fields.js";

afterEach(cleanup);

const noop = () => {};
// palette class with a numeric shade, hex, or rgba literal
const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:red|green|blue|yellow|amber|gray|slate|zinc|neutral|stone|emerald|orange|purple|indigo|sky|teal|cyan|lime|pink|rose|violet|fuchsia)-\d+/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FONT = /text-\[(\d+(?:\.\d+)?)px\]/g;

function describedByText(el: Element): string[] {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

describe("aria-describedby wiring (#E1)", () => {
  it("lists hint then error when both exist", () => {
    render(<NumberField label="N" value={1} onChange={noop} hint="the hint" error="the error" />);
    const input = screen.getByRole("spinbutton", { name: "N" });
    expect(describedByText(input)).toEqual(["the hint", "the error"]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("the error");
  });

  it("lists only the hint without an error, and no aria-invalid", () => {
    render(<NumberField label="N" value={1} onChange={noop} hint="the hint" />);
    const input = screen.getByRole("spinbutton");
    expect(describedByText(input)).toEqual(["the hint"]);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hint={null} with an error links only the error", () => {
    render(<NumberField label="N" value={1} onChange={noop} hint={null} error="bad" />);
    expect(describedByText(screen.getByRole("spinbutton"))).toEqual(["bad"]);
  });

  it("hint={null} alone leaves no aria-describedby", () => {
    render(<NumberField label="N" value={1} onChange={noop} hint={null} />);
    expect(screen.getByRole("spinbutton").hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("unit chip (#E2)", () => {
  it("sits inside the label at 12 px and is part of the accessible name", () => {
    render(<NumberField label="Session register timeout" unit="ms" value={1} onChange={noop} hint={null} />);
    const input = screen.getByRole("spinbutton", { name: /Session register timeout.*ms/ });
    const label = document.querySelector(`label[for="${input.id}"]`) as HTMLElement;
    expect(label.textContent).toContain("ms");
    expect(label.textContent).not.toContain("(ms)");
    expect(label.querySelector("span")?.className).toContain("text-[12px]");
  });
});

describe("testIds (#E3)", () => {
  it("places each caller test id on its element", () => {
    render(
      <NumberField
        label="N"
        value={1}
        onChange={noop}
        hint={null}
        state="default"
        onReset={noop}
        error="bad"
        testIds={{ control: "c", state: "s", reset: "r", error: "e" }}
      />,
    );
    expect(screen.getByTestId("c").tagName).toBe("INPUT");
    expect(screen.getByTestId("s").textContent).toBe("Default");
    expect(screen.getByTestId("r").tagName).toBe("BUTTON");
    expect(screen.getByTestId("e").getAttribute("role")).toBe("alert");
  });
});

describe("state pill and reset (#E4)", () => {
  it.each([
    ["default", "Default"],
    ["changed", "Changed"],
  ] as const)("renders the %s pill", (state, text) => {
    render(<TextField label="T" value="" onChange={noop} hint={null} state={state} testIds={{ state: "pill" }} />);
    expect(screen.getByTestId("pill").textContent).toBe(text);
  });

  it("renders no pill without state, and reset only with onReset (called once)", () => {
    const onReset = vi.fn();
    const { rerender } = render(<TextField label="T" value="" onChange={noop} hint={null} testIds={{ reset: "reset" }} />);
    expect(screen.queryByTestId("reset")).toBeNull();
    expect(screen.queryByText("Default")).toBeNull();
    rerender(<TextField label="T" value="" onChange={noop} hint={null} onReset={onReset} testIds={{ reset: "reset" }} />);
    fireEvent.click(screen.getByTestId("reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("caller labels override the built-in words", () => {
    render(<TextField label="T" value="" onChange={noop} hint={null} state="default" stateLabel="vorgabe" onReset={noop} resetLabel="Zurück" />);
    expect(screen.getByText("vorgabe")).toBeTruthy();
    expect(screen.getByText("Zurück")).toBeTruthy();
  });
});

describe("every field kind (#E5)", () => {
  it("gives every control focus-ring, the label recipe and tokens-only classes", () => {
    const { container } = render(
      <>
        <ToggleField label="Tog" value={false} onChange={noop} hint="h" />
        <SelectField label="Sel" value="a" options={[{ value: "a", label: "A" }]} onChange={noop} hint="h" />
        <NumberField label="Num" value={1} onChange={noop} hint="h" />
        <TextField label="Txt" value="" onChange={noop} hint="h" />
        <TextAreaField label="Area" value="" onChange={noop} hint="h" />
      </>,
    );
    for (const el of [
      screen.getByRole("switch"),
      screen.getByRole("combobox"),
      screen.getByRole("spinbutton"),
      ...screen.getAllByRole("textbox"),
    ]) {
      expect(el.className, el.outerHTML).toContain("focus-ring");
    }
    for (const label of container.querySelectorAll("label")) {
      expect(label.className).toContain("text-xs");
      expect(label.className).toContain("font-semibold");
      expect(label.className).toContain("text-[var(--text-primary)]");
    }
    const html = container.innerHTML;
    expect(html).not.toMatch(PALETTE);
    expect(html).not.toMatch(HEX);
    expect(html).not.toContain("rgba(");
    const sizes = new Set([...html.matchAll(FONT)].map((m) => m[1]));
    for (const s of sizes) expect(["11", "12", "14"]).toContain(s);
  });

  it("ToggleField exposes switch state and the optional state word", () => {
    const onChange = vi.fn();
    render(<ToggleField label="Tog" value={true} onChange={onChange} hint={null} onLabel="On" offLabel="Off" />);
    const sw = screen.getByRole("switch", { name: "Tog" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("On")).toBeTruthy();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("NumberField allowEmpty/decimal emit NaN and fractions", () => {
    const onChange = vi.fn();
    render(<NumberField label="N" value={1} onChange={onChange} hint={null} decimal allowEmpty />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(Number.NaN);
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith(1.5);
  });
});

describe("SettingsNotice (#E8)", () => {
  it.each(["info", "warning", "error", "success"] as const)("%s uses its severity triple and no palette class", (tone) => {
    const { container } = render(<SettingsNotice tone={tone}>msg</SettingsNotice>);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain(`bg-[var(--severity-${tone}-bg)]`);
    expect(cls).toContain(`border-[var(--severity-${tone}-border)]`);
    expect(cls).toContain(`text-[var(--severity-${tone}-fg)]`);
    expect(container.innerHTML).not.toMatch(PALETTE);
  });

  it("only the error tone is a live alert by default", () => {
    render(<SettingsNotice tone="error">e</SettingsNotice>);
    expect(screen.getByRole("alert")).toBeTruthy();
    cleanup();
    render(<SettingsNotice tone="info">i</SettingsNotice>);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SettingsGroup (#F2)", () => {
  it("opens from its summary, which is ≥ 44 px tall with a focus ring", () => {
    const { container } = render(
      <SettingsGroup title="Search" defaultOpen={false} meta="3 fields">
        <p>inside</p>
      </SettingsGroup>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = container.querySelector("summary") as HTMLElement;
    expect(details.open).toBe(false);
    expect(summary.className).toContain("focus-ring");
    expect(summary.className).toContain("min-h-[44px]");
    expect(summary.className).toContain("text-sm font-semibold");
    summary.click();
    details.open = true; // jsdom does not toggle on summary click
    expect(details.open).toBe(true);
  });
});

// ── wave 2 (retro-ux-plugin-settings-wave-2) ─────────────────────────────

function fontSizes(html: string): Set<string> {
  return new Set([...html.matchAll(FONT)].map((m) => m[1]));
}

describe("SettingsStatusPill (wave-2 #E1)", () => {
  it.each(["success", "info", "warning", "error", "neutral"] as const)("%s paints from its severity triple", (tone) => {
    const { container } = render(
      <SettingsStatusPill tone={tone} icon={mdiCheck} testId="pill">
        Password rejected
      </SettingsStatusPill>,
    );
    const pill = screen.getByTestId("pill");
    expect(pill.className).toContain(`bg-[var(--severity-${tone}-bg)]`);
    expect(pill.className).toContain(`border-[var(--severity-${tone}-border)]`);
    expect(pill.className).toContain(`text-[var(--severity-${tone}-fg)]`);
    expect(pill.textContent).toBe("Password rejected");
    expect(pill.getAttribute("data-tone")).toBe(tone);
    const svg = pill.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    const html = container.innerHTML;
    expect(html).not.toMatch(PALETTE);
    expect(html).not.toMatch(HEX);
    expect(html).not.toContain("rgba(");
    expect([...fontSizes(html)]).toEqual(["11"]);
  });

  it("renders without an icon when icon={null}, and at 12 px when interactive", () => {
    render(
      <SettingsStatusPill tone="error" icon={null} interactive testId="pill" status="auth-failed">
        Password rejected
      </SettingsStatusPill>,
    );
    const pill = screen.getByTestId("pill");
    expect(pill.querySelector("svg")).toBeNull();
    expect(pill.className).toContain("text-[12px]");
    expect(pill.getAttribute("data-status")).toBe("auth-failed");
    expect(pill.textContent).not.toContain("auth-failed");
  });
});

describe("SettingsItem (wave-2 #E2)", () => {
  const status = <SettingsStatusPill tone="warning">Not paired</SettingsStatusPill>;
  const actions = <button type="button">Connect</button>;

  it("collapsible: <details> with title and status in the summary, status visible while collapsed", () => {
    const { container } = render(
      <SettingsItem title="Profile 3" subtitle="Chrome" status={status} actions={actions} collapsible defaultOpen={false} testId="item" summaryTestId="sum">
        <p>body</p>
      </SettingsItem>,
    );
    const root = screen.getByTestId("item");
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(root.contains(details)).toBe(true);
    expect(details.open).toBe(false);
    const summary = screen.getByTestId("sum");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.textContent).toContain("Profile 3");
    expect(summary.textContent).toContain("Not paired");
    expect(summary.className).toContain("min-h-[44px]");
    expect(summary.className).toContain("focus-ring");
    // No nested interactive control inside the summary (axe nested-interactive).
    expect(summary.querySelector("button")).toBeNull();
    // Pills inside the interactive summary step up to the 12 px floor.
    expect(screen.getByText("Not paired").className).toContain("text-[12px]");
    expect(screen.getByRole("button", { name: "Connect", hidden: true })).toBeTruthy();
  });

  it("collapsible defaultOpen renders open", () => {
    const { container } = render(
      <SettingsItem title="Profile 3" collapsible defaultOpen>
        <p>body</p>
      </SettingsItem>,
    );
    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("non-collapsible: no <details>, actions in the header, testId on root", () => {
    const { container } = render(
      <SettingsItem title="Profile 3" status={status} actions={actions} testId="item">
        <p>body</p>
      </SettingsItem>,
    );
    expect(container.querySelector("details")).toBeNull();
    const root = screen.getByTestId("item");
    expect(root.textContent).toContain("Not paired");
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(root.textContent).toContain("body");
    const html = container.innerHTML;
    expect(html).not.toMatch(PALETTE);
    expect(html).not.toMatch(HEX);
    for (const s of fontSizes(html)) expect(["11", "12", "14"]).toContain(s);
  });
});

describe("SettingsFacts (wave-2 #E3)", () => {
  it("renders a <dl> with term/value pairs at 12 px", () => {
    const { container } = render(
      <SettingsFacts
        testId="facts"
        rows={[
          ["OBS version", "31.0.2"],
          ["Password", "Accepted"],
        ]}
      />,
    );
    const dl = screen.getByTestId("facts");
    expect(dl.tagName).toBe("DL");
    const dts = dl.querySelectorAll("dt");
    const dds = dl.querySelectorAll("dd");
    expect(dts).toHaveLength(2);
    expect(dds).toHaveLength(2);
    expect(dts[0].className).toContain("text-[var(--text-secondary)]");
    expect(dds[1].className).toContain("text-[var(--text-primary)]");
    expect(dds[1].textContent).toBe("Accepted");
    expect(dl.className).toContain("text-[12px]");
    expect(container.innerHTML).not.toMatch(PALETTE);
  });
});

describe("SettingsTable (wave-2 #E4)", () => {
  it("has scoped column headers, a caption and a horizontal-scroll wrapper", () => {
    const { container } = render(
      <SettingsTable
        testId="tbl"
        caption="Sessions"
        columns={["Session", "Status", "Peers", "PID", "Since"]}
        rows={[
          { key: "a", cells: ["a", "Active", "Loaded", "1", "now"], testId: "row-a" },
          { key: "b", cells: ["b", "Degraded", "Missing", "2", "now"] },
        ]}
      />,
    );
    const wrap = screen.getByTestId("tbl");
    expect(wrap.className).toContain("overflow-x-auto");
    const ths = container.querySelectorAll('th[scope="col"]');
    expect(ths).toHaveLength(5);
    expect(container.querySelector("caption")?.textContent).toBe("Sessions");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByTestId("row-a").tagName).toBe("TR");
    expect(container.querySelector("table")?.className).toContain("text-[12px]");
    expect(container.innerHTML).not.toMatch(PALETTE);
  });
});

describe("SettingsGroup meta (wave-2 #E5)", () => {
  it("renders the meta at 12 px in --text-secondary", () => {
    const { container } = render(
      <SettingsGroup title="Search" meta="3 fields">
        <p>inside</p>
      </SettingsGroup>,
    );
    const summary = container.querySelector("summary") as HTMLElement;
    const meta = screen.getByText("3 fields");
    expect(meta.className).toContain("text-[12px]");
    expect(meta.className).toContain("text-[var(--text-secondary)]");
    expect(summary.innerHTML).not.toContain("text-[11px]");
  });
});

describe("SettingsNotice actions + SettingsCopyButton (wave-2 X-series helper)", () => {
  it("renders Try again and Copy details; the raw detail is copied, never shown", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const onRetry = vi.fn();
    render(
      <SettingsNotice tone="error" testId="n" onRetry={onRetry} details="HTTP 500: boom">
        Could not save.
      </SettingsNotice>,
    );
    const notice = screen.getByTestId("n");
    expect(notice.textContent).not.toContain("HTTP 500");
    expect(notice.textContent).not.toContain("boom");
    fireEvent.click(screen.getByTestId("n-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId("n-copy-details"));
    });
    expect(writeText).toHaveBeenCalledWith("HTTP 500: boom");
    expect(screen.getByTestId("n-copy-details").textContent).toContain("Copied");
  });

  it("renders no action row without actions", () => {
    render(<SettingsNotice tone="info" testId="n">msg</SettingsNotice>);
    expect(screen.getByTestId("n").querySelector("button")).toBeNull();
  });

  it("copy button copies its text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SettingsCopyButton text="pi-obs provision" label="Copy command" testId="c" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("c"));
    });
    expect(writeText).toHaveBeenCalledWith("pi-obs provision");
  });
});

describe("kit gaps found by the plugin migrations (wave 2)", () => {
  it("SelectField keeps disabled options listed and disabled", () => {
    render(
      <SelectField
        label="Backend"
        value="a"
        options={[
          { value: "a", label: "Local" },
          { value: "b", label: "Remote (off-machine is off)", disabled: true },
        ]}
        onChange={noop}
        hint={null}
      />,
    );
    const opt = screen.getByRole("option", { name: "Remote (off-machine is off)" }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
  });

  it("TextField passes autoComplete through", () => {
    render(<TextField label="Token" type="password" autoComplete="off" value="" onChange={noop} hint={null} />);
    expect(screen.getByLabelText("Token").getAttribute("autocomplete")).toBe("off");
  });
});

// ── align-ui-contract-recipes: kit extensions (test-plan #E3 #E4 #E5 #X1 #X2) ──

describe("SettingsStatusPill spinning (align #E3)", () => {
  it("adds animate-spin + motion-reduce:animate-none to the icon only when spinning", () => {
    const { rerender } = render(
      <SettingsStatusPill tone="info" spinning testId="pill">
        Running
      </SettingsStatusPill>,
    );
    const on = screen.getByTestId("pill").querySelector("svg")?.getAttribute("class") ?? "";
    expect(on).toContain("animate-spin");
    expect(on).toContain("motion-reduce:animate-none");
    rerender(
      <SettingsStatusPill tone="info" testId="pill">
        Running
      </SettingsStatusPill>,
    );
    const off = screen.getByTestId("pill").querySelector("svg")?.getAttribute("class") ?? "";
    expect(off).not.toContain("animate-spin");
    expect(off).not.toContain("motion-reduce:animate-none");
  });
});

describe("SettingsStatusPill size (align #E4)", () => {
  it("is 11 px alone and 12 px inside a SettingsItem summary", () => {
    render(
      <>
        <SettingsStatusPill tone="info" testId="alone">
          Alone
        </SettingsStatusPill>
        <SettingsItem
          title="Item"
          collapsible
          status={
            <SettingsStatusPill tone="info" testId="inside">
              Inside
            </SettingsStatusPill>
          }
        />
      </>,
    );
    expect(screen.getByTestId("alone").className).toContain("text-[11px]");
    expect(screen.getByTestId("inside").className).toContain("text-[12px]");
  });
});

describe("SettingsNotice remedies (align #E5)", () => {
  it("renders remedy rows in the order given, links stay focusable", () => {
    render(
      <SettingsNotice
        tone="warning"
        testId="n"
        remedies={[
          { icon: "M0 0h1v1z", content: <span>First</span> },
          { icon: "M0 0h2v2z", content: <a href="/auth/login">Sign in</a> },
          { icon: "M0 0h3v3z", content: <span>Third</span> },
        ]}
      >
        Needs access.
      </SettingsNotice>,
    );
    const rows = screen.getByTestId("n").querySelectorAll("ul > li");
    expect([...rows].map((r) => r.textContent)).toEqual(["First", "Sign in", "Third"]);
    const link = screen.getByRole("link", { name: "Sign in" });
    link.focus();
    expect(document.activeElement).toBe(link);
    for (const r of rows) expect(r.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a props-only notice renders no remedy container", () => {
    render(
      <SettingsNotice tone="info" testId="n">
        msg
      </SettingsNotice>,
    );
    expect(screen.getByTestId("n").querySelector("ul")).toBeNull();
    expect(screen.getByTestId("n").getAttribute("aria-busy")).toBeNull();
  });
});

describe("SettingsNotice busy retry (align #X2)", () => {
  it("is aria-busy while retrying; retry is disabled; a second click does not re-fire", async () => {
    let release: () => void = () => {};
    const onRetry = vi.fn(() => new Promise<void>((r) => { release = r; }));
    function Harness() {
      const [retrying, setRetrying] = useState(false);
      return (
        <SettingsNotice
          tone="error"
          testId="n"
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void onRetry().then(() => setRetrying(false));
          }}
        >
          Failed.
        </SettingsNotice>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("n").getAttribute("aria-busy")).toBe("false");
    const retry = screen.getByTestId("n-retry") as HTMLButtonElement;
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("n").getAttribute("aria-busy")).toBe("true");
    expect(retry.disabled).toBe(true);
    await act(async () => {
      release();
    });
    expect(screen.getByTestId("n").getAttribute("aria-busy")).toBe("false");
    expect(retry.disabled).toBe(false);
  });
});

describe("SettingsActionError (align 2.2)", () => {
  it("renders a role=alert sentence with the given id and no details button", () => {
    render(
      <SettingsActionError id="err-1" testId="e">
        Could not stop the service.
      </SettingsActionError>,
    );
    const el = screen.getByTestId("e");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.id).toBe("err-1");
    expect(el.textContent).toBe("Could not stop the service.");
    expect(el.querySelector("button")).toBeNull();
    expect(el.className).toContain("text-[var(--severity-error-fg)]");
    expect(el.className).toContain("text-xs");
    expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(el.outerHTML).not.toMatch(PALETTE);
    expect(el.outerHTML).not.toMatch(HEX);
  });

  it("copies details through the copy button and never renders them", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <SettingsActionError id="err-2" testId="e" details="stop_failed: permission denied">
        Could not stop the service.
      </SettingsActionError>,
    );
    expect(screen.getByTestId("e").textContent).not.toContain("stop_failed");
    await act(async () => {
      fireEvent.click(screen.getByTestId("e-copy-details"));
    });
    expect(writeText).toHaveBeenCalledWith("stop_failed: permission denied");
  });
});

describe("SettingsCopyButton failure (align #X1)", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows the failure label, never Copied, when navigator.clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<SettingsCopyButton text="x" label="Copy details" testId="c" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("c"));
    });
    expect(screen.getByTestId("c").textContent).toContain("Copy failed");
    expect(screen.getByTestId("c").textContent).not.toContain("Copied");
  });

  it("shows the failure label when writeText rejects", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SettingsCopyButton text="x" label="Copy details" testId="c" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("c"));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("c").textContent).toContain("Copy failed");
    expect(screen.getByTestId("c").textContent).not.toContain("Copied");
  });

  it("shows the failure label when writeText throws synchronously", async () => {
    const writeText = vi.fn(() => {
      throw new Error("not allowed");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SettingsCopyButton text="x" label="Copy details" testId="c" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("c"));
    });
    expect(screen.getByTestId("c").textContent).toContain("Copy failed");
  });
});

describe("doubt-review findings on the kit props (align 2.5)", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("non-error notices default to role=status, error to alert, an explicit role wins", () => {
    for (const tone of ["info", "warning", "success"] as const) {
      const { container } = render(<SettingsNotice tone={tone}>m</SettingsNotice>);
      expect((container.firstElementChild as HTMLElement).getAttribute("role")).toBe("status");
      cleanup();
    }
    const { container } = render(<SettingsNotice tone="error">m</SettingsNotice>);
    expect((container.firstElementChild as HTMLElement).getAttribute("role")).toBe("alert");
    cleanup();
    const explicit = render(
      <SettingsNotice tone="info" role="alert">
        m
      </SettingsNotice>,
    );
    expect((explicit.container.firstElementChild as HTMLElement).getAttribute("role")).toBe("alert");
  });

  it("copy result is announced through a live region, not only a label swap", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<SettingsCopyButton text="x" label="Copy details" testId="c" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    await act(async () => {
      fireEvent.click(screen.getByTestId("c"));
    });
    expect(screen.getByRole("status").textContent).toBe("Copy failed");
  });
});

describe("notice hooks needed to migrate core callouts (align 4)", () => {
  it("retrying={false} reports aria-busy=false; no retrying prop leaves it off", () => {
    const { container, rerender } = render(
      <SettingsNotice tone="info" retrying={false}>
        m
      </SettingsNotice>,
    );
    expect((container.firstElementChild as HTMLElement).getAttribute("aria-busy")).toBe("false");
    rerender(<SettingsNotice tone="info">m</SettingsNotice>);
    expect((container.firstElementChild as HTMLElement).hasAttribute("aria-busy")).toBe(false);
  });

  it("remedy rows carry their id as data-remedy and the shared remedyTestId", () => {
    render(
      <SettingsNotice
        tone="info"
        remedyTestId="row"
        remedies={[
          { icon: "M0 0h1v1z", id: "use-host", content: "A" },
          { icon: "M0 0h1v1z", id: "sign-in", content: "B" },
        ]}
      >
        m
      </SettingsNotice>,
    );
    const rows = screen.getAllByTestId("row");
    expect(rows.map((r) => r.getAttribute("data-remedy"))).toEqual(["use-host", "sign-in"]);
  });

  it("a row without an id has no data-remedy attribute", () => {
    render(
      <SettingsNotice tone="info" remedies={[{ icon: "M0 0h1v1z", content: "A" }]}>
        m
      </SettingsNotice>,
    );
    expect(document.querySelector("[data-remedy]")).toBeNull();
  });

  it("the remedy list is named: default 'What you can do', overridable", () => {
    const { unmount } = render(
      <SettingsNotice tone="info" remedies={[{ icon: "M0 0h1v1z", content: "A" }]}>
        m
      </SettingsNotice>,
    );
    expect(screen.getByRole("list", { name: "What you can do" })).toBeTruthy();
    unmount();
    render(
      <SettingsNotice tone="info" remediesLabel="Mit tehetsz" remedies={[{ icon: "M0 0h1v1z", content: "A" }]}>
        m
      </SettingsNotice>,
    );
    expect(screen.getByRole("list", { name: "Mit tehetsz" })).toBeTruthy();
  });

  it("icon overrides the tone icon", () => {
    const { container } = render(
      <SettingsNotice tone="warning" icon="M0 0h9v9z">
        m
      </SettingsNotice>,
    );
    expect(container.querySelector("svg path")?.getAttribute("d")).toBe("M0 0h9v9z");
  });

  it("retryTestId overrides the derived retry test id", () => {
    render(
      <SettingsNotice tone="error" testId="n" onRetry={() => {}} retryTestId="custom-retry">
        m
      </SettingsNotice>,
    );
    expect(screen.getByTestId("custom-retry")).toBeTruthy();
    expect(screen.queryByTestId("n-retry")).toBeNull();
  });
});
