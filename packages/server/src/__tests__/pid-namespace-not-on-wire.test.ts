/**
 * E105 (S6): `pidNamespace` is server-internal. It stays on the in-memory
 * session but no browser (snapshot, session_added, session_updated, REST) or
 * peer payload carries it — it is a non-enumerable property, so every JSON
 * egress omits it structurally.
 * See change: scope-pids-to-namespace.
 */
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createMemorySessionManager, stripNotifyLog } from "../session/memory-session-manager.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };

function setup() {
  const sm = createMemorySessionManager();
  sm.register({ id: "s1", cwd: "/w", source: "tui", pid: 4242, pidNamespace: RL });
  return sm;
}

function assertClean(payload: unknown) {
  const json = JSON.stringify(payload);
  expect(json).not.toContain("pidNamespace");
  expect(json).not.toContain("boot-A");
  expect(json).not.toContain("pid:[4026531836]");
}

describe("E105: pidNamespace never leaves the server", () => {
  it("the in-memory session keeps it", () => {
    expect(setup().get("s1")?.pidNamespace).toEqual(RL);
  });

  it("sessions_snapshot rows", () => {
    const sm = setup();
    assertClean({ type: "sessions_snapshot", ...sm.buildSnapshot() });
    expect(sm.buildSnapshot().sessions.some((s) => s.id === "s1")).toBe(true);
  });

  it("session_added / session list pages", () => {
    const sm = setup();
    const s = sm.get("s1")!;
    assertClean({ type: "session_added", session: s });
    assertClean({ type: "session_list_page", sessions: sm.listAll().map(stripNotifyLog) });
  });

  it("session_updated after an update keeps it in memory but off the wire", () => {
    const sm = setup();
    sm.update("s1", { name: "renamed" });
    expect(sm.get("s1")?.pidNamespace).toEqual(RL);
    assertClean({ type: "session_updated", sessionId: "s1", updates: { ...sm.get("s1") } });
  });

  it("update() cannot install an enumerable copy (register is the sole writer)", () => {
    const sm = setup();
    sm.update("s1", { pidNamespace: { ...RL, hostId: "boot-LEAK" } } as never);
    expect(sm.get("s1")?.pidNamespace).toEqual(RL);
    assertClean(sm.get("s1"));
    expect(JSON.stringify(sm.get("s1"))).not.toContain("boot-LEAK");
  });

  it("REST session GET and a paired-peer payload (plain JSON of the record)", () => {
    const sm = setup();
    assertClean(sm.get("s1"));
    assertClean({ sessions: [sm.get("s1")] });
    assertClean(sessionToMeta(sm.get("s1")!));
  });
});
