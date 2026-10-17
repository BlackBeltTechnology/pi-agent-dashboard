/**
 * Pure model of the Services pages: the action-gating table (design D9) and the
 * list grouping. See change: add-services-settings-ui — test-plan E33, E34.
 */
import type { ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { describe, expect, it } from "vitest";
import { actionsFor, groupOf, groupServices, needsAttention, reasonSentence, type ServiceActions } from "../../../../lib/services/services-model.js";
import { makeService } from "./services-fixtures.js";

type Row = {
  patch: Partial<ServiceStatus>;
  /** The set of action names expected — everything else must be absent. */
  actions: Array<keyof Omit<ServiceActions, "remove"> | "start" | "try-again">;
};

/** The design D9 table, row by row, written out independently of `actionsFor`. */
const TABLE: Row[] = [
  { patch: { state: "stopped" }, actions: ["start", "pin"] },
  { patch: { state: "stopped", drivers: ["native"] }, actions: ["start", "prefetch", "pin"] },
  { patch: { state: "stopped", volumes: ["v"] }, actions: ["start", "pin", "resetData"] },
  { patch: { state: "stopped", pinned: true }, actions: ["start", "unpin"] },
  { patch: { state: "starting" }, actions: ["stop", "pin"] },
  { patch: { state: "healthy" }, actions: ["stop", "pin"] },
  { patch: { state: "idle", startedBy: "dashboard" }, actions: ["stop", "pin"] },
  { patch: { state: "healthy", startedBy: "external", mode: "attached" }, actions: ["forceStop"] },
  { patch: { state: "blocked" }, actions: ["stop", "pin"] },
  { patch: { state: "blocked", startedBy: "external", mode: "attached" }, actions: ["forceStop"] },
  { patch: { state: "stopping" }, actions: ["pin"] },
  { patch: { state: "stop-failed" }, actions: ["stop", "pin"] },
  { patch: { state: "failed" }, actions: ["retry", "pin"] },
  { patch: { state: "unavailable", reason: "runtime-unreachable" }, actions: ["try-again", "pin"] },
  { patch: { state: "unavailable", reason: "runtime-unreachable", volumes: ["v"] }, actions: ["try-again", "pin", "resetData"] },
  { patch: { state: "unavailable", reason: "image-absent" }, actions: ["try-again", "pin"] },
  { patch: { state: "unavailable", reason: "package-absent", drivers: ["native"] }, actions: ["try-again", "prefetch", "pin"] },
  { patch: { state: "unavailable", reason: "adoption-uncertain", volumes: ["v"] }, actions: ["forceStop", "pin"] },
  { patch: { state: "unavailable", reason: "duplicate-instances", volumes: ["v"] }, actions: ["stop", "pin"] },
  { patch: { state: "unavailable", reason: "owner-conflict", volumes: ["v"] }, actions: ["pin"] },
  { patch: { state: "healthy", mode: "attached" }, actions: ["stop"] },
  { patch: { state: "healthy", mode: "external" }, actions: [] },
];

function present(a: ServiceActions): string[] {
  const out: string[] = [];
  if (a.start === "start") out.push("start");
  if (a.start === "try-again") out.push("try-again");
  for (const k of ["retry", "stop", "forceStop", "prefetch", "pin", "unpin", "resetData"] as const) if (a[k]) out.push(k);
  return out;
}

const STICKY = ["adoption-uncertain", "duplicate-instances", "owner-conflict"];

/** Properties every combination must satisfy, whatever the exact table says. */
function checkInvariants(p: Partial<ServiceStatus>): void {
  const s = makeService({ ...p, drivers: ["native"] });
  const a = actionsFor(s);
  const tag = JSON.stringify(p);
  // Stop is hidden where the server refuses a plain stop; Force stop appears exactly there, never both.
  if (s.startedBy === "external" && s.state !== "unavailable") expect(a.stop, tag).toBe(false);
  if (a.forceStop) {
    expect(s.startedBy === "external" || s.reason === "adoption-uncertain", tag).toBe(true);
    expect(a.stop, tag).toBe(false);
  }
  if (a.retry) expect(s.state, tag).toBe("failed");
  if (a.start === "start") expect(s.state, tag).toBe("stopped");
  if (a.start === "try-again") {
    expect(s.state, tag).toBe("unavailable");
    expect(STICKY, tag).not.toContain(s.reason);
  }
  if (a.resetData) expect(s.volumes, tag).toBeDefined();
  if (a.resetData && s.state === "unavailable") expect(STICKY, tag).not.toContain(s.reason);
  expect(a.pin || a.unpin, tag).toBe(s.mode === "managed");
  expect(a.pin && a.unpin, tag).toBe(false);
}

describe("E33 — action gating matches the D9 table", () => {
  it.each(TABLE.map((r, i) => [i, r] as const))("row %i", (_i, row) => {
    const a = actionsFor(makeService(row.patch));
    expect(present(a).sort()).toEqual([...row.actions].sort());
    expect(a.remove).toBe(true); // Remove is always available
  });

  it("holds the table's invariants over every state × reason × startedBy × mode × volumes", () => {
    const states = ["stopped", "starting", "healthy", "idle", "blocked", "stopping", "stop-failed", "failed", "unavailable"] as const;
    const reasons = [undefined, "runtime-unreachable", "image-absent", "package-absent", "adoption-uncertain", "duplicate-instances", "owner-conflict"] as const;
    const startedBys = [undefined, "dashboard", "external"] as const;
    const modes = ["managed", "attached", "external"] as const;
    const volumeSets = [undefined, ["v"]];
    const pins = [false, true];
    const combos: Array<Partial<ServiceStatus>> = states.flatMap((state) =>
      reasons.flatMap((reason) =>
        startedBys.flatMap((startedBy) =>
          modes.flatMap((mode) => volumeSets.flatMap((volumes) => pins.map((pinned) => ({ state, reason, startedBy, mode, volumes, pinned })))),
        ),
      ),
    );
    for (const c of combos) checkInvariants(c);
    expect(combos).toHaveLength(9 * 7 * 3 * 3 * 2 * 2);
  });

  it("an unknown state offers only Remove (and Pin for managed)", () => {
    expect(present(actionsFor(makeService({ state: "weird" as never })))).toEqual(["pin"]);
  });
});

describe("E34 — list grouping", () => {
  const all: ServiceStatus[] = (["unavailable", "failed", "blocked", "stop-failed", "healthy", "idle", "starting", "stopping", "stopped"] as const).map((state) =>
    makeService({ id: `svc-${state}`, state }),
  );

  it("Needs attention → Running → Stopped, counts right", () => {
    const groups = groupServices(all);
    expect(groups.map((g) => g.group)).toEqual(["attention", "running", "stopped"]);
    expect(groups.map((g) => g.services.map((s) => s.state))).toEqual([
      ["unavailable", "failed", "blocked", "stop-failed"],
      ["healthy", "idle", "starting", "stopping"],
      ["stopped"],
    ]);
  });

  it("an empty group is absent", () => {
    expect(groupServices([makeService({ state: "healthy" })]).map((g) => g.group)).toEqual(["running"]);
    expect(groupServices([])).toEqual([]);
  });

  it("groupOf / needsAttention agree", () => {
    for (const s of all) expect(needsAttention(s)).toBe(groupOf(s.state) === "attention");
  });
});

describe("reason sentences", () => {
  it("every known reason has a plain sentence; an unknown one names itself", () => {
    expect(reasonSentence("image-absent")).toMatch(/image is not on this machine/);
    expect(reasonSentence("brand-new-reason")).toContain("brand-new-reason");
  });
});
