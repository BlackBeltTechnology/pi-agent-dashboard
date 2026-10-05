import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fileAccessToastKey, useFileAccessToasts } from "../useFileAccessToasts.js";

const sess = (id: string, over: Partial<DashboardSession> = {}): DashboardSession =>
  ({ id, status: "active", ...over }) as DashboardSession;

function setup(initial: Map<string, DashboardSession>, selected?: string) {
  const showToast = vi.fn();
  const dismissToastByKey = vi.fn();
  const onOpen = vi.fn();
  const hook = renderHook(
    ({ sessions, selectedId }) => useFileAccessToasts(sessions, selectedId, { showToast, dismissToastByKey }, onOpen),
    { initialProps: { sessions: initial, selectedId: selected } },
  );
  return { hook, showToast, dismissToastByKey, onOpen };
}

describe("useFileAccessToasts (#F7, #F8)", () => {
  it("F7 toasts for a session not in view, names it, Open selects it, withdrawn on settlement", () => {
    const t = setup(new Map([["B", sess("B")], ["A", sess("A", { name: "Alpha" } as never)]]), "B");
    t.hook.rerender({ sessions: new Map([["B", sess("B")], ["A", sess("A", { name: "Alpha", awaitingFileAccess: true } as never)]]), selectedId: "B" });
    expect(t.showToast).toHaveBeenCalledTimes(1);
    const [text, variant, opts] = t.showToast.mock.calls[0];
    expect(text).toContain("Alpha");
    expect(variant).toBe("warning");
    expect(opts).toMatchObject({ key: fileAccessToastKey("A"), noAutoDismiss: true });
    opts.action.onClick();
    expect(t.onOpen).toHaveBeenCalledWith("A");
    // settles
    t.hook.rerender({ sessions: new Map([["B", sess("B")], ["A", sess("A", { name: "Alpha" } as never)]]), selectedId: "B" });
    expect(t.dismissToastByKey).toHaveBeenCalledWith(fileAccessToastKey("A"));
  });

  it("F8 no toast for the session being viewed", () => {
    const t = setup(new Map([["A", sess("A")]]), "A");
    t.hook.rerender({ sessions: new Map([["A", sess("A", { awaitingFileAccess: true })]]), selectedId: "A" });
    expect(t.showToast).not.toHaveBeenCalled();
  });

  it("does not re-toast on unrelated session updates; withdraws when the operator opens the session", () => {
    const awaiting = (id = "A") => new Map([[id, sess(id, { awaitingFileAccess: true })]]);
    const t = setup(new Map(), "B");
    t.hook.rerender({ sessions: awaiting(), selectedId: "B" });
    t.hook.rerender({ sessions: awaiting(), selectedId: "B" });
    expect(t.showToast).toHaveBeenCalledTimes(1);
    t.hook.rerender({ sessions: awaiting(), selectedId: "A" });
    expect(t.dismissToastByKey).toHaveBeenCalledWith(fileAccessToastKey("A"));
  });

  it("an ended session never toasts", () => {
    const t = setup(new Map(), "B");
    t.hook.rerender({ sessions: new Map([["A", sess("A", { awaitingFileAccess: true, status: "ended" })]]), selectedId: "B" });
    expect(t.showToast).not.toHaveBeenCalled();
  });
});
