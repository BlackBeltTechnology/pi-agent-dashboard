/**
 * `SessionActionsMenu` — the menu component in isolation (focus model, folding,
 * live re-derive, containment, placement writes). The card-level behaviour
 * (entry points, plugin hosting, dialogs) is in `SessionCard.actions-menu.test.tsx`.
 * See change: add-session-actions-flyout (test-plan E14, F3, F4, F15–F18, P3).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMenuGroup, SessionMenuItem } from "../../../lib/session/session-menu-items.js";
import { SessionActionsMenu, type SessionMenuOpenRequest } from "../SessionActionsMenu.js";

afterEach(() => cleanup());

const session = { id: "s1", cwd: "/a", source: "tui", status: "idle", startedAt: 1 } as DashboardSession;
const item = (id: string, over: Partial<SessionMenuItem> = {}): SessionMenuItem => ({ id, label: id, onSelect: vi.fn(), ...over });
const group = (id: SessionMenuGroup["id"], items: SessionMenuItem[], subtitle?: string): SessionMenuGroup => ({ id, title: id.toUpperCase(), subtitle, items });

interface HarnessProps {
  groups: SessionMenuGroup[];
  initialOpen?: boolean;
  source?: SessionMenuOpenRequest["source"];
  point?: { x: number; y: number };
  pluginContainer?: HTMLElement | null;
  onCardClick?: () => void;
  onCardContextMenu?: () => void;
  onCardKeyDown?: () => void;
}

/** A card <li> hosting the trigger, with open state owned like the card does. */
function Harness({ groups, initialOpen = false, source = "trigger", point, pluginContainer, onCardClick, onCardContextMenu, onCardKeyDown }: HarnessProps) {
  const cardRef = React.useRef<HTMLLIElement>(null);
  const [state, setState] = React.useState<{ open: boolean; source: SessionMenuOpenRequest["source"]; opener?: HTMLElement | null }>({
    open: initialOpen,
    source,
  });
  return (
    <ul>
      <li ref={cardRef} data-testid="card" onClick={onCardClick} onContextMenu={onCardContextMenu} onKeyDown={onCardKeyDown}>
        <button type="button" data-testid="archive">archive</button>
        <input data-testid="unrelated" />
        <SessionActionsMenu
          session={session}
          groups={groups}
          open={state.open}
          source={state.source}
          point={point}
          opener={state.opener}
          cardRef={cardRef}
          pluginContainer={pluginContainer}
          onOpenChange={(open, req) => setState({ open, source: req?.source ?? "trigger", opener: req?.opener })}
        />
      </li>
    </ul>
  );
}

const basic = () => [group("session", [item("a"), item("b"), item("c")])];
const trigger = () => screen.getByTestId("session-actions-trigger-s1");
const menu = () => screen.getByTestId("session-actions-menu-s1");
const itemEl = (id: string) => screen.getByTestId(`session-menu-item-${id}`);

describe("trigger", () => {
  it("opens the menu, reports aria-expanded, and never selects the card", () => {
    const onCardClick = vi.fn();
    render(<Harness groups={basic()} onCardClick={onCardClick} />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu().getAttribute("role")).toBe("menu");
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("opening by click focuses the first enabled item", () => {
    render(<Harness groups={[group("session", [item("a", { disabled: true }), item("b")])]} />);
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(itemEl("b"));
  });
});

describe("keyboard model (F3)", () => {
  it("ArrowDown/ArrowUp wrap, Home/End jump", () => {
    render(<Harness groups={basic()} />);
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(itemEl("a"));
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(itemEl("b"));
    fireEvent.keyDown(menu(), { key: "End" });
    expect(document.activeElement).toBe(itemEl("c"));
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(itemEl("a"));
    fireEvent.keyDown(menu(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(itemEl("c"));
    fireEvent.keyDown(menu(), { key: "Home" });
    expect(document.activeElement).toBe(itemEl("a"));
  });

  it("Escape and Tab close the menu and return focus to the trigger (click open)", () => {
    for (const key of ["Escape", "Tab"]) {
      render(<Harness groups={basic()} />);
      fireEvent.click(trigger());
      fireEvent.keyDown(menu(), { key });
      expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
      expect(document.activeElement).toBe(trigger());
      cleanup();
    }
  });

  it("opened from the keyboard, Escape returns focus to the previously focused element", () => {
    render(<Harness groups={basic()} />);
    // simulate the card's Shift+F10 path: the opener is the focused Archive button
    const archive = screen.getByTestId("archive");
    archive.focus();
    // Re-render a harness that opens with an explicit opener
    cleanup();
    function Opener() {
      const cardRef = React.useRef<HTMLLIElement>(null);
      const [st, setSt] = React.useState<{ open: boolean; opener?: HTMLElement | null }>({ open: false });
      return (
        <li ref={cardRef}>
          <button
            type="button"
            data-testid="archive"
            onKeyDown={(e) => {
              if (e.shiftKey && e.key === "F10") setSt({ open: true, opener: e.currentTarget });
            }}
          >
            archive
          </button>
          <SessionActionsMenu
            session={session}
            groups={basic()}
            open={st.open}
            source="keyboard"
            opener={st.opener}
            cardRef={cardRef}
            onOpenChange={(open) => setSt({ open })}
          />
        </li>
      );
    }
    render(<Opener />);
    const btn = screen.getByTestId("archive");
    btn.focus();
    fireEvent.keyDown(btn, { key: "F10", shiftKey: true });
    expect(document.activeElement).toBe(itemEl("a"));
    fireEvent.keyDown(menu(), { key: "Escape" });
    expect(document.activeElement).toBe(btn);
  });

  it("falls back to the trigger when the opener left the document", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    function Gone() {
      const cardRef = React.useRef<HTMLLIElement>(null);
      const [open, setOpen] = React.useState(true);
      return (
        <li ref={cardRef}>
          <SessionActionsMenu session={session} groups={basic()} open={open} source="keyboard" opener={opener} cardRef={cardRef} onOpenChange={setOpen} />
        </li>
      );
    }
    render(<Gone />);
    opener.remove();
    fireEvent.keyDown(menu(), { key: "Escape" });
    expect(document.activeElement).toBe(trigger());
  });

  it("an outside mousedown closes the menu without moving focus", () => {
    render(<Harness groups={basic()} />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });
});

describe("More… expander (F4, E4)", () => {
  const withRare = (n: number) => [group("openspec", [item("w"), ...Array.from({ length: n }, (_, i) => item(`r${i}`, { rare: true }))])];

  it("folds ≥ 2 rare items behind one More… labelled with the count; 1 rare renders inline; 0 renders none", () => {
    render(<Harness groups={withRare(4)} initialOpen />);
    expect(screen.getByTestId("session-menu-more-openspec").textContent).toContain("4");
    expect(screen.queryByTestId("session-menu-item-r0")).toBeNull();
    cleanup();
    render(<Harness groups={withRare(1)} initialOpen />);
    expect(screen.queryByTestId("session-menu-more-openspec")).toBeNull();
    expect(screen.getByTestId("session-menu-item-r0")).toBeTruthy();
    cleanup();
    render(<Harness groups={withRare(0)} initialOpen />);
    expect(screen.queryByTestId("session-menu-more-openspec")).toBeNull();
  });

  it("ArrowDown skips hidden items; Enter reveals them in place, focuses the first and sets aria-expanded; reopening collapses", () => {
    render(<Harness groups={withRare(4)} initialOpen source="trigger" />);
    const more = screen.getByTestId("session-menu-more-openspec");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    itemEl("w").focus();
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(more);
    fireEvent.click(more); // Enter on a button fires click
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(itemEl("r0"));
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(itemEl("r1"));
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
    // close + reopen: collapsed again
    fireEvent.keyDown(menu(), { key: "Escape" });
    fireEvent.click(trigger());
    expect(screen.getByTestId("session-menu-more-openspec").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("session-menu-item-r0")).toBeNull();
  });
});

describe("inert lifecycle segments (E14)", () => {
  const segmentsItem = (): SessionMenuItem => ({
    id: "openspec-lifecycle",
    label: "OpenSpec lifecycle",
    kind: "segments",
    segments: [
      { id: "proposal", label: "Proposal", letter: "P", state: "done", onSelect: vi.fn() },
      { id: "specs", label: "Specs", letter: "S", state: "skipped" },
      { id: "tasks", label: "Tasks", letter: "T", state: "todo" },
      { id: "archive", label: "Archive", letter: "A", state: "todo", onSelect: vi.fn() },
    ],
  });

  it("an inert segment is not a menuitem, not focusable, and ArrowDown skips it", () => {
    render(<Harness groups={[group("openspec", [item("before"), segmentsItem(), item("after")])]} initialOpen />);
    const specs = screen.getByTestId("session-menu-segment-specs");
    expect(specs.getAttribute("role")).toBeNull();
    expect(specs.getAttribute("tabindex")).toBeNull();
    expect(specs.getAttribute("data-inert")).toBe("true");
    itemEl("before").focus();
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("session-menu-segment-proposal"));
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("session-menu-segment-archive")); // specs + tasks skipped
  });

  it("an interactive segment runs its action and closes the menu", () => {
    const seg = segmentsItem();
    render(<Harness groups={[group("openspec", [seg])]} initialOpen />);
    fireEvent.click(screen.getByTestId("session-menu-segment-proposal"));
    expect(seg.segments?.[0].onSelect).toHaveBeenCalled();
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });
});

describe("disabled items", () => {
  it("stay focusable, expose the reason, never invoke and never close the menu (X2)", () => {
    const fork = item("fork", { disabled: true, reason: "session's directory no longer exists" });
    render(<Harness groups={[group("session", [fork, item("x")])]} initialOpen />);
    const el = itemEl("fork");
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("title")).toBe("session's directory no longer exists");
    expect(screen.getByTestId("session-menu-reason-fork").textContent).toBe("session's directory no longer exists");
    el.focus();
    expect(document.activeElement).toBe(el);
    fireEvent.click(el);
    expect(fork.onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
  });

  it("an enabled item runs its handler and closes the menu, returning focus to the trigger", () => {
    const a = item("a");
    render(<Harness groups={[group("session", [a])]} />);
    fireEvent.click(trigger());
    fireEvent.click(itemEl("a"));
    expect(a.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("live re-derive (F15, F16, F17)", () => {
  function Live({ groups, onRender }: { groups: SessionMenuGroup[]; onRender?: () => void }) {
    onRender?.();
    return <Harness groups={groups} initialOpen />;
  }

  it("an item becoming disabled keeps the menu open and focus on it (F15)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<Live groups={[group("git", [item("push", { onSelect }), item("merge")])]} />);
    itemEl("push").focus();
    rerender(<Live groups={[group("git", [item("push", { onSelect, disabled: true, reason: "Session is streaming" }), item("merge")])]} />);
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
    expect(itemEl("push").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(itemEl("push"));
  });

  it("the focused item disappearing moves focus to the first enabled item (F16)", () => {
    const { rerender } = render(<Live groups={[group("git", [item("first"), item("open-pr"), item("close")])]} />);
    itemEl("open-pr").focus();
    rerender(<Live groups={[group("git", [item("first"), item("view-pr"), item("close")])]} />);
    expect(document.activeElement).toBe(itemEl("first"));
  });

  it("the card unmounting under an open menu closes it and puts focus in the list region, not on body (F17)", () => {
    function Region({ showCard }: { showCard: boolean }) {
      return (
        <div data-session-list-region="" tabIndex={-1} data-testid="region">
          {showCard && <Harness groups={basic()} initialOpen />}
        </div>
      );
    }
    const { rerender } = render(<Region showCard />);
    itemEl("a").focus();
    expect(document.activeElement).toBe(itemEl("a"));
    rerender(<Region showCard={false} />);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("region"));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("event containment (F18)", () => {
  it("click, contextmenu and Shift+F10 inside the menu never reach the card's handlers", () => {
    const onCardClick = vi.fn();
    const onCardContextMenu = vi.fn();
    const onCardKeyDown = vi.fn();
    render(<Harness groups={basic()} initialOpen onCardClick={onCardClick} onCardContextMenu={onCardContextMenu} onCardKeyDown={onCardKeyDown} />);
    fireEvent.click(itemEl("a"));
    // reopen (the click closed it)
    cleanup();
    render(<Harness groups={basic()} initialOpen onCardClick={onCardClick} onCardContextMenu={onCardContextMenu} onCardKeyDown={onCardKeyDown} />);
    const panel = menu();
    const ctx = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      itemEl("b").dispatchEvent(ctx);
    });
    expect(ctx.defaultPrevented).toBe(true); // the host menu never offers the browser's
    fireEvent.keyDown(panel, { key: "F10", shiftKey: true });
    fireEvent.keyDown(panel, { key: "ContextMenu" });
    fireEvent.click(panel);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardContextMenu).not.toHaveBeenCalled();
    expect(onCardKeyDown).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
  });
});

describe("hover-opened menu (F9)", () => {
  it("never moves focus on open; Escape closes it and leaves focus on the unrelated element", () => {
    render(<Harness groups={basic()} />);
    const input = screen.getByTestId("unrelated");
    input.focus();
    // hover open: no opener, source=hover
    cleanup();
    function HoverOpen() {
      const cardRef = React.useRef<HTMLLIElement>(null);
      const [open, setOpen] = React.useState(true);
      return (
        <li ref={cardRef}>
          <input data-testid="unrelated" />
          <SessionActionsMenu session={session} groups={basic()} open={open} source="hover" cardRef={cardRef} onOpenChange={setOpen} />
        </li>
      );
    }
    render(<HoverOpen />);
    const field = screen.getByTestId("unrelated");
    field.focus();
    expect(document.activeElement).toBe(field);
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

describe("plugin hosting", () => {
  it("hides the PLUGINS heading unless the container renders content, and reacts to later changes", async () => {
    const container = document.createElement("div");
    const empty = document.createElement("div");
    empty.setAttribute("data-plugin-group", "");
    container.appendChild(empty);
    render(<Harness groups={basic()} initialOpen pluginContainer={container} />);
    expect(screen.getByTestId("session-menu-group-plugins").hasAttribute("hidden")).toBe(true);
    const btn = document.createElement("button");
    btn.textContent = "Pause";
    act(() => {
      empty.appendChild(btn);
    });
    await waitFor(() => expect(screen.getByTestId("session-menu-group-plugins").hasAttribute("hidden")).toBe(false));
    expect(menu().textContent).toContain("Pause");
  });

  it("plugin buttons join the arrow order; activating one closes the menu", () => {
    const container = document.createElement("div");
    const group_ = document.createElement("div");
    group_.setAttribute("data-plugin-group", "");
    const btn = document.createElement("button");
    btn.textContent = "Pause";
    group_.appendChild(btn);
    container.appendChild(group_);
    render(<Harness groups={[group("git", [item("only")]), group("view", [item("last")])]} initialOpen pluginContainer={container} />);
    itemEl("only").focus();
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(itemEl("last"));
    act(() => {
      btn.click();
    });
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });
});

describe("placement writes (P3)", () => {
  it("scroll events reposition through the panel's style without re-rendering the menu content", () => {
    let rect = { left: 10, top: 100, right: 210, bottom: 160, width: 200, height: 60, x: 10, y: 100, toJSON() {} };
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return (this.getAttribute("data-testid") === "card" ? rect : { ...rect, left: 0, top: 0, right: 0, bottom: 0 }) as DOMRect;
    });
    const renders = vi.fn();
    function Counter() {
      renders();
      return <Harness groups={basic()} />;
    }
    render(<Counter />);
    // opened after mount, like every real open (the card element exists by then)
    fireEvent.click(trigger());
    const before = menu().style.top;
    expect(before).not.toBe("");
    const callsBefore = renders.mock.calls.length;
    for (let i = 0; i < 30; i++) {
      rect = { ...rect, top: rect.top - 2, bottom: rect.bottom - 2 };
      act(() => {
        window.dispatchEvent(new Event("scroll"));
      });
    }
    expect(menu().style.top).not.toBe(before);
    expect(renders.mock.calls.length).toBe(callsBefore);
    spy.mockRestore();
  });
});

/**
 * Edge trigger (pill) — markup, click semantics, emphasis variants.
 * See change: move-session-actions-trigger-to-card-edge (test-plan E4, F1, F3, F7).
 */
describe("edge trigger pill", () => {
  function direct(open: boolean, source: SessionMenuOpenRequest["source"], onOpenChange = vi.fn()) {
    const cardRef = { current: document.createElement("li") } as React.RefObject<HTMLElement | null>;
    render(<SessionActionsMenu session={session} groups={basic()} open={open} source={source} cardRef={cardRef} onOpenChange={onOpenChange} />);
    return onOpenChange;
  }

  it("E4: renders an inline three-dot SVG pill with a 24px hit box, no mdi path, no 44/32px min sizes", () => {
    direct(false, "trigger");
    const btn = trigger();
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("circle").length).toBe(3);
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("path")).toBeNull();
    const cls = btn.className;
    for (const c of ["focus-ring", "inline-flex", "before:content-['']", "before:w-[24px]"]) expect(cls).toContain(c);
    expect(cls).not.toContain("min-h-[44px]");
    expect(cls).not.toContain("sm:min-h-[32px]");
    const wrapperCls = (btn.parentElement as HTMLElement).className.split(/\s+/);
    expect(wrapperCls).toContain("absolute");
    expect(wrapperCls).toContain("card-edge-trigger");
    expect(wrapperCls).not.toContain("relative");
  });

  it("F1: a click on a hover-opened menu pins it (re-opens as a trigger open), never closes it", () => {
    const onOpenChange = direct(true, "hover");
    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true, { source: "trigger", opener: trigger() });
  });

  it("F3: a click on a click-opened menu still toggles it closed", () => {
    const onOpenChange = direct(true, "trigger");
    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("F7: carries the aria-expanded emphasis variants", () => {
    direct(true, "trigger");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().className).toMatch(/aria-expanded:text-\[var\(--text-secondary\)\]/);
    expect(trigger().className).toMatch(/aria-expanded:border-\[var\(--border-primary\)\]/);
  });
});

describe("unmount under a pinned menu (move-session-actions-trigger-to-card-edge X2)", () => {
  it("a card removed while its menu is pinned by a trigger click leaves no menu and focus in the region", () => {
    function Region({ showCard }: { showCard: boolean }) {
      return (
        <div data-session-list-region="" tabIndex={-1} data-testid="region">
          {showCard && <Harness groups={basic()} initialOpen source="hover" />}
        </div>
      );
    }
    const { rerender } = render(<Region showCard />);
    fireEvent.click(trigger()); // F1 path: pins the hover-opened menu
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    itemEl("a").focus();
    rerender(<Region showCard={false} />);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("region"));
  });
});

describe("pinning a hover-opened menu moves focus into it (CodeRabbit, move-session-actions-trigger-to-card-edge F1)", () => {
  it("hover open leaves focus alone; the pinning click then focuses the first enabled item", () => {
    render(<Harness groups={basic()} initialOpen source="hover" />);
    expect(document.activeElement).not.toBe(itemEl("a"));
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(itemEl("a"));
  });
});
