import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NumberField, SelectField, TextField, ToggleField } from "../SettingsPanel.js";

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
