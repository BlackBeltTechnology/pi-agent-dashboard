/**
 * L1 — the blackhole `custom-entry-renderer` component (change:
 * add-custom-entry-renderer-slot; spec: blackhole-om-entry-rendering).
 *
 * Covers the collapsed summary contract (E6 — counts only for a COMPLETE
 * parseable body), per-type icon distinctness (F12), no-interpretation of
 * payload text (F13), structural expansion (F14), the no-affordance rule when
 * no entry id is present (F11), and the evicted-entry fallback (X3).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { OmEntryCard } from "../OmEntryCard.js";

afterEach(() => cleanup());

const noop = () => {};

function props(overrides: Partial<CustomEntryRendererProps> = {}): CustomEntryRendererProps {
  return {
    customType: "om.observations.recorded",
    body: '{"observations":[]}',
    timestamp: 1756300000000,
    expanded: false,
    onToggle: noop,
    payloadLoading: false,
    ...overrides,
  };
}

function count(): string | null {
  return screen.queryByTestId("om-entry-count")?.textContent ?? null;
}

describe("OmEntryCard — collapsed summary (E6)", () => {
  it("reports a count for a complete, parseable body", () => {
    render(<OmEntryCard {...props({ body: JSON.stringify({ observations: [] }) })} />);
    expect(count()).toBe("0");
  });

  it("counts 1 and 4 records", () => {
    const { unmount } = render(
      <OmEntryCard {...props({ body: JSON.stringify({ observations: [{ content: "a" }] }) })} />,
    );
    expect(count()).toBe("1");
    unmount();
    render(
      <OmEntryCard
        {...props({
          body: JSON.stringify({ observations: [{ content: "a" }, { content: "b" }, { content: "c" }, { content: "d" }] }),
        })}
      />,
    );
    expect(count()).toBe("4");
  });

  it("omits the count for a head-truncated body (no partial count)", () => {
    const pretty = JSON.stringify(
      { observations: Array.from({ length: 20 }, (_, i) => ({ content: `obs-${i}` })) },
      null,
      2,
    );
    const truncated = pretty.split("\n").slice(20).join("\n");
    render(<OmEntryCard {...props({ body: truncated })} />);
    expect(screen.getByTestId("om-entry-label")).toBeTruthy();
    expect(count()).toBeNull();
  });

  it("omits the count for a non-JSON plain string body", () => {
    render(<OmEntryCard {...props({ body: "not json at all" })} />);
    expect(count()).toBeNull();
  });
});

describe("OmEntryCard — per-type affordance (F11/F12)", () => {
  it("F12: the three types carry distinct icons AND expose their kind as text", () => {
    const { container } = render(
      <div>
        <OmEntryCard {...props({ customType: "om.observations.recorded" })} />
        <OmEntryCard {...props({ customType: "om.reflections.recorded" })} />
        <OmEntryCard {...props({ customType: "om.observations.dropped" })} />
      </div>,
    );
    const icons = [...container.querySelectorAll('[data-testid="om-entry-icon"]')].map((el) =>
      el.getAttribute("data-icon"),
    );
    expect(new Set(icons).size).toBe(3);
    const labels = [...container.querySelectorAll('[data-testid="om-entry-label"]')].map((el) => el.textContent);
    expect(labels).toEqual(["Observations recorded", "Reflections recorded", "Observations dropped"]);
  });

  it("F11: a row without an entryId offers NO expand affordance", () => {
    render(<OmEntryCard {...props({ entryId: undefined })} />);
    expect(screen.getByTestId("om-entry-label")).toBeTruthy();
    expect(screen.queryByTestId("om-entry-toggle")).toBeNull();
    expect(screen.queryByTestId("om-entry-chevron")).toBeNull();
  });

  it("offers an expand affordance when the row carries an entryId", () => {
    render(<OmEntryCard {...props({ entryId: "e1" })} />);
    expect(screen.getByTestId("om-entry-toggle")).toBeTruthy();
  });
});

describe("OmEntryCard — expanded structural view (F13/F14)", () => {
  it("F14: observations expand as discrete records", () => {
    render(
      <OmEntryCard
        {...props({
          entryId: "e1",
          expanded: true,
          payload: { observations: [1, 2, 3, 4].map((n) => ({ content: `observation ${n}` })) },
        })}
      />,
    );
    const records = screen.getAllByTestId("om-entry-record");
    expect(records).toHaveLength(4);
    expect(records.map((r) => r.textContent)).toEqual([
      "observation 1",
      "observation 2",
      "observation 3",
      "observation 4",
    ]);
  });

  it("F14: reflections expand as discrete records", () => {
    render(
      <OmEntryCard
        {...props({
          customType: "om.reflections.recorded",
          entryId: "e1",
          expanded: true,
          payload: { reflections: [1, 2, 3].map((n) => ({ content: `reflection ${n}` })) },
        })}
      />,
    );
    expect(screen.getAllByTestId("om-entry-record")).toHaveLength(3);
  });

  it("F14: dropped observations identify what was dropped", () => {
    render(
      <OmEntryCard
        {...props({
          customType: "om.observations.dropped",
          entryId: "e1",
          expanded: true,
          payload: { dropped: [{ content: "dropped-a" }, { content: "dropped-b" }] },
        })}
      />,
    );
    expect(screen.getAllByTestId("om-entry-record").map((r) => r.textContent)).toEqual([
      "dropped-a",
      "dropped-b",
    ]);
  });

  it("F13: record text is NEVER interpreted (markdown/HTML renders literally)", () => {
    const evil = "**bold** https://example.com <img src=x onerror=1>";
    const { container } = render(
      <OmEntryCard
        {...props({ entryId: "e1", expanded: true, payload: { observations: [{ content: evil }] } })}
      />,
    );
    const record = screen.getByTestId("om-entry-record");
    expect(record.textContent).toBe(evil);
    expect(record.querySelector("strong")).toBeNull();
    expect(record.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("OmEntryCard — payload unavailability (X3)", () => {
  it("falls back to the stored body as plain text on a payload error", () => {
    const { container } = render(
      <OmEntryCard
        {...props({ entryId: "e1", expanded: true, payloadError: "entry evicted", body: "**bold** <img src=x>" })}
      />,
    );
    const pre = screen.getByTestId("om-entry-fallback-body");
    expect(pre.textContent).toBe("**bold** <img src=x>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a neutral loading state while the payload is in flight", () => {
    render(<OmEntryCard {...props({ entryId: "e1", expanded: true, payloadLoading: true })} />);
    expect(screen.getByTestId("om-entry-loading")).toBeTruthy();
  });

  it("falls back to the stored body for an UNRECOGNISED payload shape (never 'No records')", () => {
    render(
      <OmEntryCard
        {...props({ entryId: "e1", expanded: true, payload: { unexpected: "shape" }, body: '{"unexpected":"shape"}' })}
      />,
    );
    expect(screen.queryByText("No records")).toBeNull();
    expect(screen.getByTestId("om-entry-stored-body").textContent).toBe('{"unexpected":"shape"}');
  });

  it("still reports 'No records' for a genuinely empty recognised payload", () => {
    render(<OmEntryCard {...props({ entryId: "e1", expanded: true, payload: { observations: [] } })} />);
    expect(screen.getByText("No records")).toBeTruthy();
  });
});
