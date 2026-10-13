/**
 * Ended-session composer context. test-plan E21 (commands state), F14 (no empty
 * flash on resume), F15 (pick clearing), F16 (chip shows pick), X5 (picks are
 * per session). See change: redesign-directory-home-split.
 */
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndedSessionComposer } from "../useEndedSessionComposer.js";
import { resetFolderCommandsCache } from "../useFolderCommands.js";
import { resetModelCatalogueCache } from "../useModelCatalogue.js";

const json = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "", headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as unknown as Response;

const cmd = (n: string): CommandInfo => ({ name: `skill:${n}`, source: "skill" });

let folderList: CommandInfo[];
beforeEach(() => {
  resetFolderCommandsCache();
  resetModelCatalogueCache();
  folderList = [cmd("x")];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/api/pi-resources/commands")
        ? json({ data: { origin: "scan", commands: folderList } })
        : json({ data: [{ provider: "a", id: "b" }] }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Props = Parameters<typeof useEndedSessionComposer>[0];
const base = (over: Partial<Props>): Props => ({
  selectedId: "s1",
  selectedSession: { status: "ended", cwd: "/p" },
  hasOwnCommands: false,
  sessions: new Map([["s1", { status: "ended" }]]),
  ...over,
});

describe("commands", () => {
  it("E21(a): a live session with no list gets no folder list", () => {
    const { result } = renderHook(() => useEndedSessionComposer(base({ selectedSession: { status: "active", cwd: "/p" } })));
    expect(result.current.folderCommands).toBeUndefined();
    expect(result.current.isEnded).toBe(false);
  });

  it("E21(b): an ended session with no list gets the folder list", async () => {
    const { result } = renderHook(() => useEndedSessionComposer(base({})));
    await waitFor(() => expect(result.current.folderCommands?.commands).toHaveLength(1));
    expect(result.current.folderCommands?.origin).toBe("scan");
  });

  it("E21(c): an ended session with its own stored list is left alone", () => {
    const { result } = renderHook(() => useEndedSessionComposer(base({ hasOwnCommands: true })));
    expect(result.current.folderCommands).toBeUndefined();
  });

  it("F14: after the session goes live without its own list yet, the folder list is kept", async () => {
    const { result, rerender } = renderHook((p: Props) => useEndedSessionComposer(p), { initialProps: base({}) });
    await waitFor(() => expect(result.current.folderCommands?.commands).toHaveLength(1));
    rerender(base({ selectedSession: { status: "active", cwd: "/p" }, sessions: new Map([["s1", { status: "active" }]]) }));
    expect(result.current.folderCommands?.commands).toHaveLength(1); // never []
    rerender(base({ selectedSession: { status: "active", cwd: "/p" }, hasOwnCommands: true, sessions: new Map([["s1", { status: "active" }]]) }));
    expect(result.current.folderCommands).toBeUndefined(); // own list takes over
  });

  it("an ended session fetches the catalogue; a live one does not expose it", async () => {
    const ended = renderHook(() => useEndedSessionComposer(base({})));
    await waitFor(() => expect(ended.result.current.models).toHaveLength(1));
    const live = renderHook(() => useEndedSessionComposer(base({ selectedSession: { status: "active", cwd: "/p" } })));
    expect(live.result.current.models).toEqual([]);
  });
});

describe("picks", () => {
  it("F16/X5: a pick is per session and per field; unpicked fields stay undefined", () => {
    const { result } = renderHook(() => useEndedSessionComposer(base({ sessions: new Map([["s1", { status: "ended" }], ["s2", { status: "ended" }]]) })));
    act(() => result.current.setPickField("s1", "model", "a/b"));
    expect(result.current.pick).toEqual({ model: "a/b" });
    act(() => result.current.setPickField("s1", "thinkingLevel", "low"));
    expect(result.current.pick).toEqual({ model: "a/b", thinkingLevel: "low" });
    expect(result.current.getResumePick("s2")).toBeUndefined();
  });

  it("F15: the pick is cleared once the session is no longer ended", () => {
    const { result, rerender } = renderHook((p: Props) => useEndedSessionComposer(p), { initialProps: base({}) });
    act(() => result.current.setPickField("s1", "model", "a/b"));
    expect(result.current.getResumePick("s1")).toEqual({ model: "a/b" });
    rerender(base({ selectedSession: { status: "active", cwd: "/p" }, sessions: new Map([["s1", { status: "active" }]]) }));
    expect(result.current.getResumePick("s1")).toBeUndefined();
    // …and a later resume starts clean.
    rerender(base({ sessions: new Map([["s1", { status: "ended" }]]) }));
    expect(result.current.getResumePick("s1")).toBeUndefined();
  });
});
