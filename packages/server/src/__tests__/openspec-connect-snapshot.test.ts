/**
 * On-connect snapshot semantics: emits exactly one `openspec_update`
 * per known cwd, with correct `pending` value.
 *
 * See change: fix-cold-boot-openspec-protocol.
 */
import { describe, it, expect, vi } from "vitest";
import { buildOpenSpecConnectSnapshot } from "../pairing/browser-gateway.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ds(map: Record<string, OpenSpecData | undefined>) {
  return {
    knownDirectories: vi.fn(() => Object.keys(map)),
    getOpenSpecData: vi.fn((cwd: string) => map[cwd]),
  };
}

describe("buildOpenSpecConnectSnapshot", () => {
  it("emits cached payload for cwds with initialized data (legacy: hasOpenspecDir backfilled from probe)", () => {
    const cached: OpenSpecData = { initialized: true, changes: [{ name: "x" } as never] };
    const msgs = buildOpenSpecConnectSnapshot(ds({ "/p": cached }), () => true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      type: "openspec_update",
      cwd: "/p",
      data: { ...cached, hasOpenspecDir: true },
    });
  });

  it("preserves cached hasOpenspecDir field when set (does NOT overwrite from probe)", () => {
    const cached: OpenSpecData = {
      initialized: true,
      changes: [],
      hasOpenspecDir: true,
    };
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": cached }),
      () => false,
      () => false, // probe disagrees — cached value wins
    );
    expect(msgs[0].data).toEqual(cached);
  });

  it("emits pending: true when openspec dir exists but cache is empty", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": { initialized: false, changes: [] } }),
      (cwd) => cwd === "/p",
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: true, changes: [], hasOpenspecDir: true },
      },
    ]);
  });

  it("emits pending: true when openspec dir exists but cache is undefined", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": undefined }),
      () => true,
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: true, changes: [], hasOpenspecDir: true },
      },
    ]);
  });

  it("emits pending: false when no openspec dir exists", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": undefined }),
      () => false,
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: false, changes: [], hasOpenspecDir: false },
      },
    ]);
  });

  it("emits exactly one message per known cwd, mixed states preserved", () => {
    const cached: OpenSpecData = { initialized: true, changes: [{ name: "x" } as never] };
    const map = { "/hot": cached, "/cold": undefined, "/none": undefined };
    const msgs = buildOpenSpecConnectSnapshot(
      ds(map),
      (cwd) => cwd === "/cold",
    );
    expect(msgs).toHaveLength(3);
    // legacy cached data without hasOpenspecDir gets backfilled from hasRoot
    // probe (defaults to hasDir when not provided)
    expect(msgs[0]).toEqual({
      type: "openspec_update",
      cwd: "/hot",
      data: { ...cached, hasOpenspecDir: false },
    });
    expect(msgs[1]).toEqual({
      type: "openspec_update",
      cwd: "/cold",
      data: { initialized: false, pending: true, changes: [], hasOpenspecDir: true },
    });
    expect(msgs[2]).toEqual({
      type: "openspec_update",
      cwd: "/none",
      data: { initialized: false, pending: false, changes: [], hasOpenspecDir: false },
    });
  });

  it("emits hasOpenspecDir: true when openspec/ exists but openspec/changes/ does NOT (fresh init)", () => {
    // Exact compsych-letter-demo scenario: `openspec init` was run (openspec/
    // exists with config.yaml) but no `openspec/changes/` subdir yet.
    // Snapshot must surface the project as OpenSpec-applicable so the session
    // card's OPENSPEC subcard renders as an init/attach affordance.
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/fresh": { initialized: false, changes: [] } }),
      () => false, // hasDir(openspec/changes/) → false
      () => true,  // hasRoot(openspec/) → true
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/fresh",
        data: {
          initialized: false,
          pending: false,
          changes: [],
          hasOpenspecDir: true,
        },
      },
    ]);
  });

  it("hasRoot defaults to hasDir when omitted (backwards compat)", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": undefined }),
      () => true, // hasDir only — hasRoot will mirror it
    );
    expect(msgs[0].data).toMatchObject({ hasOpenspecDir: true });
  });

  it("returns empty array when there are no known directories", () => {
    expect(buildOpenSpecConnectSnapshot(ds({}), () => true)).toEqual([]);
  });
});
