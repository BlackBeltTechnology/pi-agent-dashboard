/**
 * Tone rendering in the session actions menu: MenuEntry, NEXT, `More…`, lifecycle row.
 * See change: colorize-actions-menus (test-plan #E10, #E11, #E12).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMenuGroup, SessionMenuItem } from "../../../lib/session/session-menu-items.js";
import { SessionActionsMenu } from "../SessionActionsMenu.js";

afterEach(() => cleanup());

const session = { id: "s1", cwd: "/a", source: "tui", status: "idle", startedAt: 1 } as DashboardSession;
const item = (id: string, over: Partial<SessionMenuItem> = {}): SessionMenuItem => ({ id, label: id, icon: "M0 0", onSelect: vi.fn(), ...over });
const group = (id: SessionMenuGroup["id"], items: SessionMenuItem[]): SessionMenuGroup => ({ id, title: id.toUpperCase(), items });

function Harness({ groups }: { groups: SessionMenuGroup[] }) {
  const cardRef = React.useRef<HTMLLIElement>(null);
  return (
    <ul>
      <li ref={cardRef}>
        <SessionActionsMenu session={session} groups={groups} open source="trigger" cardRef={cardRef} onOpenChange={() => {}} />
      </li>
    </ul>
  );
}

const el = (id: string) => screen.getByTestId(`session-menu-item-${id}`);
const iconOf = (id: string) => el(id).querySelector("svg") as SVGElement;
const cls = (e: Element | null) => e?.getAttribute("class") ?? "";

describe("MenuEntry tone (E10)", () => {
  it("renders each state", () => {
    render(
      <Harness
        groups={[
          group("next", [item("apply", { emphasis: true })]),
          group("session", [
            item("danger", { tone: "danger" }),
            item("danger-off", { tone: "danger", disabled: true }),
            item("go", { tone: "go" }),
            item("plain"),
          ]),
          group("git", [item("next-off", { disabled: true, tone: undefined })]),
        ]}
      />,
    );
    expect(el("danger").getAttribute("data-action-tone")).toBe("danger");
    expect(cls(iconOf("danger"))).toContain("text-[var(--accent-red-text)]");
    expect(cls(el("danger"))).toContain("hover:bg-[var(--tint-red-bg)]");

    expect(el("danger-off").getAttribute("data-action-tone")).toBe("danger");
    expect(cls(iconOf("danger-off"))).not.toContain("accent-red");
    expect(cls(el("danger-off"))).not.toContain("hover:");

    expect(cls(iconOf("go"))).toContain("text-[var(--accent-green-text)]");
    expect(el("plain").hasAttribute("data-action-tone")).toBe(false);
    expect(cls(el("plain"))).toContain("hover:bg-[var(--bg-hover)]");

    const next = el("apply");
    expect(next.getAttribute("data-emphasis")).toBe("primary");
    expect(next.hasAttribute("data-action-tone")).toBe(false);
    expect(cls(next)).toContain("border-[var(--tint-blue-border)]");
    expect(cls(next)).not.toContain("bg-[var(--tint-");
    expect(cls(next)).toContain("focus:bg-[var(--bg-hover)]");
    expect(cls(iconOf("apply"))).toContain("text-[var(--accent-blue-text)]");

    expect(cls(el("next-off"))).not.toContain("border-[var(--tint-blue-border)]");
  });

  it("an emphasised item ignores a stray tone", () => {
    render(<Harness groups={[group("next", [item("apply", { emphasis: true, tone: "danger" })])]} />);
    expect(el("apply").hasAttribute("data-action-tone")).toBe(false);
  });
});

describe("keyboard focus background (E11)", () => {
  it("neutral, inert, NEXT and More… keep focus:bg; ITEM_BASE does not carry it", () => {
    render(
      <Harness
        groups={[
          group("next", [item("apply", { emphasis: true })]),
          group("session", [item("n"), item("i", { disabled: true }), item("r1", { rare: true }), item("r2", { rare: true })]),
        ]}
      />,
    );
    for (const id of ["n", "i", "apply"]) expect(cls(el(id))).toContain("focus:bg-[var(--bg-hover)]");
    expect(cls(screen.getByTestId("session-menu-more-session"))).toContain("focus:bg-[var(--bg-hover)]");
  });

  it("danger rows do not carry the neutral focus background", () => {
    render(<Harness groups={[group("session", [item("d", { tone: "danger" })])]} />);
    expect(cls(el("d"))).not.toContain("focus:bg-[var(--bg-hover)]");
  });
});

describe("lifecycle row (E12)", () => {
  it("glyph, colour and data-state per segment", () => {
    const seg = (id: string, letter: string, label: string, state: string, onSelect?: () => void) => ({ id, letter, label, state, onSelect }) as never;
    render(
      <Harness
        groups={[
          group("openspec", [
            {
              id: "lifecycle",
              label: "Lifecycle",
              kind: "segments",
              segments: [
                seg("proposal", "P", "Proposal", "done"),
                seg("design", "D", "Design", "done"),
                seg("specs", "S", "Specs", "skipped"),
                seg("tasks", "T", "Tasks", "current"),
                seg("archive", "A", "Archive", "todo"),
              ],
            },
          ]),
        ]}
      />,
    );
    const expected: Array<[string, string, string, string]> = [
      ["proposal", "✓", "accent-green-text", "done"],
      ["design", "✓", "accent-green-text", "done"],
      ["specs", "–", "accent-green-text", "skipped"],
      ["tasks", "▸", "accent-yellow-text", "current"],
      ["archive", "○", "text-tertiary", "todo"],
    ];
    for (const [id, glyph, token, state] of expected) {
      const e = screen.getByTestId(`session-menu-segment-${id}`);
      expect(e.textContent).toContain(glyph);
      expect(cls(e)).toContain(`text-[var(--${token})]`);
      expect(e.getAttribute("data-state")).toBe(state);
    }
    expect(screen.getByTestId("session-menu-segment-proposal").getAttribute("aria-label")).toBe("Proposal, done");
    expect(screen.getByTestId("session-menu-segment-archive").getAttribute("aria-label")).toBe("Archive, todo");
  });
});
