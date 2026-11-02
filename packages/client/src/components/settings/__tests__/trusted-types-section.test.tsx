import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FIELD_PAGE, computeConfigPartial } from "../SettingsPanel.js";
import { TrustedTypesSection } from "../TrustedTypesSection.js";

/** Settings ▸ Security ▸ Trusted Types mode (test-plan #E8). See change: enforce-trusted-types-default. */
afterEach(() => cleanup());

const base: any = { port: 1, piPort: 2, tunnel: { enabled: false }, memoryLimits: {} };
const select = () => screen.getByTestId("trusted-types-select") as HTMLSelectElement;

describe("TrustedTypesSection", () => {
  it("offers Default / Enforce / Report only / Off and reflects the stored value", () => {
    render(<TrustedTypesSection value="report" envOverride={null} onChange={() => {}} />);
    expect(select().value).toBe("report");
    expect([...select().options].map((o) => o.textContent)).toEqual([
      expect.stringContaining("Default"),
      "Enforce",
      "Report only",
      "Off",
    ]);
  });

  it("shows Default when nothing (or an unrecognized value) is stored", () => {
    render(<TrustedTypesSection value={undefined} envOverride={null} onChange={() => {}} />);
    expect(select().value).toBe("");
  });

  it("edits the draft through onChange; Default maps to undefined (no writes of its own)", () => {
    const onChange = vi.fn();
    render(<TrustedTypesSection value="report" envOverride={null} onChange={onChange} />);
    fireEvent.change(select(), { target: { value: "enforce" } });
    expect(onChange).toHaveBeenLastCalledWith("enforce");
    fireEvent.change(select(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("is read-only and names the variable and mode under an env override", () => {
    render(<TrustedTypesSection value="enforce" envOverride="report" onChange={() => {}} />);
    expect(screen.queryByTestId("trusted-types-select")).toBeNull();
    expect(screen.getByTestId("trusted-types-locked").textContent).toBe("Set by PI_DASHBOARD_TRUSTED_TYPES: Report only");
  });
});

describe("computeConfigPartial security.trustedTypes", () => {
  it("nothing stored → select Report only sends the key", () => {
    const draft = { ...base, security: { trustedTypes: "report" } };
    expect(computeConfigPartial(draft, base).security).toEqual({ trustedTypes: "report" });
  });

  it("stored report → Default sends null", () => {
    const original = { ...base, security: { trustedTypes: "report" } };
    const draft = { ...base, security: {} };
    expect(computeConfigPartial(draft, original).security).toEqual({ trustedTypes: null });
  });

  it("untouched sends no security key", () => {
    const original = { ...base, security: { trustedTypes: "report" } };
    expect(computeConfigPartial(JSON.parse(JSON.stringify(original)), original).security).toBeUndefined();
    expect(computeConfigPartial({ ...base }, { ...base }).security).toBeUndefined();
  });

  it("is routed to the security page", () => {
    expect(CONFIG_FIELD_PAGE.security).toBe("security");
  });
});
