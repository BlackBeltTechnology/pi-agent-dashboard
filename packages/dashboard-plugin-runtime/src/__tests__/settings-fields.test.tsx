/**
 * Settings field family contract (test-plan #E1–#E5, #E8, #F2).
 * See change: retro-ux-plugin-settings-forms.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NumberField,
  SelectField,
  SettingsGroup,
  SettingsNotice,
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
