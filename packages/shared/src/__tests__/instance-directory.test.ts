/**
 * Listing and naming the dashboard instances under this HOME (tasks 9.5, 9.6).
 *
 * The delicate part is the D2 boundary. D2 says the rendezvous RECORD is the
 * selector and there is deliberately no scan — an unpinned bridge does one
 * deterministic read, never an enumeration. But `--list` exists precisely to
 * show a human their options, and a record names exactly ONE instance (the lock
 * holder), which is useless for choosing a move target.
 *
 * So the scan here is for DISPLAY, never for automatic selection. That
 * distinction is the whole reason this module is separate from
 * `rendezvous.ts`: nothing on the bridge's connect path may import it.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listLocalInstances, resolveInstanceRef } from "../instance-directory.js";

function makeHome(instances: Array<{ piPort: number; instanceId?: string }>, record?: number) {
  const home = mkdtempSync(path.join(tmpdir(), "inst-dir-"));
  const cfg = path.join(home, ".pi", "dashboard");
  mkdirSync(path.join(cfg, "instances"), { recursive: true });
  for (const inst of instances) {
    writeFileSync(path.join(cfg, `gateway-${inst.piPort}.sock`), "");
    if (inst.instanceId) {
      writeFileSync(path.join(cfg, "instances", `${inst.piPort}.id`), inst.instanceId);
    }
  }
  if (record !== undefined) {
    const inst = instances.find((i) => i.piPort === record);
    writeFileSync(
      path.join(cfg, "server.lock.meta.json"),
      JSON.stringify({ pid: 1, httpPort: 8000, identity: inst?.instanceId ?? "x", piPort: record }),
    );
  }
  return { homedir: home };
}

describe("listLocalInstances", () => {
  it("finds every live gateway socket, not just the one the record names", () => {
    // The exact gap that makes a record-only listing useless for a move.
    const env = makeHome(
      [
        { piPort: 8001, instanceId: "aaaa1111" },
        { piPort: 8002, instanceId: "bbbb2222" },
      ],
      8001,
    );
    const found = listLocalInstances(env);
    expect(found.map((i) => i.piPort).sort()).toEqual([8001, 8002]);
  });

  it("marks which instance is the HOME default, so the list is not just a pile", () => {
    const env = makeHome(
      [
        { piPort: 8001, instanceId: "aaaa1111" },
        { piPort: 8002, instanceId: "bbbb2222" },
      ],
      8001,
    );
    const found = listLocalInstances(env);
    expect(found.find((i) => i.piPort === 8001)?.isDefault).toBe(true);
    expect(found.find((i) => i.piPort === 8002)?.isDefault).toBe(false);
  });

  it("reports an instance whose id file is missing rather than hiding it", () => {
    // A socket with no id is still a reachable dashboard; omitting it would
    // make a connectable instance invisible.
    const env = makeHome([{ piPort: 8003 }]);
    const found = listLocalInstances(env);
    expect(found).toHaveLength(1);
    expect(found[0].instanceId).toBeUndefined();
    expect(found[0].endpoint).toContain("gateway-8003.sock");
  });

  it("returns nothing when there is no config dir at all", () => {
    expect(listLocalInstances({ homedir: path.join(tmpdir(), "definitely-absent-home") })).toEqual([]);
  });
});

describe("resolveInstanceRef", () => {
  const instances = [
    { piPort: 8001, instanceId: "aaaa1111", endpoint: "ws+unix:///c/gateway-8001.sock:/", isDefault: true },
    { piPort: 8002, instanceId: "aaaa2222", endpoint: "ws+unix:///c/gateway-8002.sock:/", isDefault: false },
    { piPort: 8003, instanceId: "bbbb3333", endpoint: "ws+unix:///c/gateway-8003.sock:/", isDefault: false },
  ];

  it("resolves a full instance id", () => {
    const v = resolveInstanceRef("bbbb3333", instances);
    expect(v.ok && v.instance.piPort).toBe(8003);
  });

  it("resolves an unambiguous prefix, git-short-sha style", () => {
    // Nobody will type a full UUID; a prefix is the only humane form.
    const v = resolveInstanceRef("bbbb", instances);
    expect(v.ok && v.instance.piPort).toBe(8003);
  });

  it("REFUSES an ambiguous prefix instead of picking one", () => {
    // Silently choosing between two dashboards would move the session to the
    // wrong one and look like it worked.
    const v = resolveInstanceRef("aaaa", instances);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/ambiguous/);
    expect(v.ok === false && v.reason).toMatch(/8001/);
    expect(v.ok === false && v.reason).toMatch(/8002/);
  });

  it("reports an unknown ref without inventing a fallback", () => {
    const v = resolveInstanceRef("zzzz", instances);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/no instance/);
  });

  it("matches a port as a name, because the port is what a user actually sees", () => {
    const v = resolveInstanceRef("8002", instances);
    expect(v.ok && v.instance.instanceId).toBe("aaaa2222");
  });

  it("prefers an exact id match over a prefix collision", () => {
    const tricky = [
      { piPort: 1, instanceId: "abc", endpoint: "e1", isDefault: false },
      { piPort: 2, instanceId: "abcdef", endpoint: "e2", isDefault: false },
    ];
    // "abc" is both an exact id and a prefix of "abcdef"; exact must win, or
    // an instance whose id happens to prefix another becomes unaddressable.
    const v = resolveInstanceRef("abc", tricky);
    expect(v.ok && v.instance.piPort).toBe(1);
  });
});
