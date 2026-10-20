import { describe, expect, it } from "vitest";
import { reconcileSupervised } from "../supervised-reconcile.js";

// test-plan #E31 — (bridge, server) decision table.
describe("reconcileSupervised (E31)", () => {
  const cases: Array<[string, { on: boolean; rev?: number }, { on: boolean; rev?: number } | undefined, boolean, number]> = [
    ["bridge higher rev wins (OFF the server missed)", { on: false, rev: 5 }, { on: true, rev: 4 }, false, 5],
    ["server higher rev wins", { on: true, rev: 4 }, { on: false, rev: 5 }, false, 5],
    ["tie, different values → Supervised", { on: false, rev: 5 }, { on: true, rev: 5 }, true, 5],
    ["bridge has no rev, server has one → Supervised", { on: false }, { on: false, rev: 3 }, true, 3],
    ["tie, same value", { on: true, rev: 2 }, { on: true, rev: 2 }, true, 2],
    ["server has no rev, bridge has one → Supervised", { on: false, rev: 4 }, { on: false }, true, 4],
    ["rev 0 counts as no rev", { on: false, rev: 0 }, { on: false, rev: 3 }, true, 3],
    ["neither ever flipped → bridge default stands (no flip on restart)", { on: false, rev: 0 }, { on: false, rev: 0 }, false, 0],
    ["neither ever flipped, bridge default Supervised", { on: true, rev: 0 }, { on: false }, true, 0],
    ["nothing stored on the server → bridge stands", { on: false, rev: 7 }, undefined, false, 7],
    ["nothing stored on the server, no bridge rev", { on: true }, undefined, true, 0],
  ];
  it.each(cases)("%s", (_name, bridge, server, on, rev) => {
    expect(reconcileSupervised(bridge, server)).toEqual({ on, rev });
  });
});
