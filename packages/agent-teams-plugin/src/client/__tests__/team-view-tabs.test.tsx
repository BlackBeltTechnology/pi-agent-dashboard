// @vitest-environment jsdom
/**
 * TeamTabs keyboard (test-plan S36, WAI-ARIA APG): roving tabindex, ←/→/Home/End with
 * wrap, each tab controls a labelled tabpanel. See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TABS, type TeamTab, TeamTabs, tabId, tabPanelId } from "../TeamTabs.js";

afterEach(cleanup);

function Harness({ start = "tasks" as TeamTab }) {
  const [tab, setTab] = useState<TeamTab>(start);
  return (
    <div>
      <TeamTabs tab={tab} onTab={setTab} counts={{ members: 2, tasks: 12, messages: 40 }} />
      {TABS.map((id) => (
        <div key={id} role="tabpanel" id={tabPanelId(id)} aria-labelledby={tabId(id)} hidden={tab !== id}>
          {id}
        </div>
      ))}
    </div>
  );
}
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);
const press = (el: HTMLElement, key: string) => fireEvent.keyDown(el, { key });

describe("tablist keyboard (S36)", () => {
  it("ArrowRight / ArrowLeft move focus AND selection AND the visible panel", () => {
    render(<Harness />);
    tab("Tasks").focus();
    press(tab("Tasks"), "ArrowRight");
    expect(document.activeElement).toBe(tab("Messages"));
    expect(selected()).toEqual(["Messages40"]);
    expect(screen.getByRole("tabpanel", { name: /Messages/ }).textContent).toBe("messages");
    press(tab("Messages"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("Tasks"));
  });

  it("Home → first, End → last", () => {
    render(<Harness />);
    press(tab("Tasks"), "Home");
    expect(selected()).toEqual(["Members2"]);
    press(tab("Members"), "End");
    expect(selected()).toEqual(["Messages40"]);
    expect(document.activeElement).toBe(tab("Messages"));
  });

  it("wraps at the ends (APG): ArrowRight on Messages → Members, ArrowLeft on Members → Messages", () => {
    render(<Harness start="messages" />);
    press(tab("Messages"), "ArrowRight");
    expect(selected()).toEqual(["Members2"]);
    press(tab("Members"), "ArrowLeft");
    expect(selected()).toEqual(["Messages40"]);
  });

  it("roving tabindex: exactly one tab stop; unrelated keys do nothing", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    press(tab("Tasks"), "a");
    expect(selected()).toEqual(["Tasks12"]);
  });

  it("each tab controls an existing tabpanel labelled by it; the tablist has a name and counts", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Team sections" })).toBeTruthy();
    for (const t of screen.getAllByRole("tab")) {
      const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
      expect(panel?.getAttribute("aria-labelledby")).toBe(t.id);
    }
  });

  it("click selects", () => {
    render(<Harness />);
    fireEvent.click(tab("Members"));
    expect(selected()).toEqual(["Members2"]);
  });
});
