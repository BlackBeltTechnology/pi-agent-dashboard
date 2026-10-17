/**
 * `host.isProjectTrusted(cwd)` mirrors a pi session's trust rule
 * (migrate-mcp-to-pi-builtin test-plan E32): the recorded decision wins; with
 * none, `defaultProjectTrust: always` trusts and `ask` does not. The second
 * block runs the REAL installed pi through `getPiCore()` (the
 * pi-core-trust-exports pattern), so a pi API drift fails here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostProjectTrust, type DefaultProjectTrust, loadHostProjectTrust } from "../pi/host-project-trust.js";
import { getPiCore } from "../pi/pi-resource-activation.js";

describe("E32 — decision table", () => {
  const cases: Array<[string, boolean | null, DefaultProjectTrust, boolean]> = [
    ["recorded yes × always", true, "always", true],
    ["recorded yes × ask", true, "ask", true],
    ["recorded no × always", false, "always", false],
    ["recorded no × ask", false, "ask", false],
    ["none × always", null, "always", true],
    ["none × ask", null, "ask", false],
    ["none × never", null, "never", false],
  ];
  it.each(cases)("%s", (_label, recorded, dflt, expected) => {
    const trust = createHostProjectTrust({ recordedDecision: () => recorded, defaultProjectTrust: () => dflt });
    expect(trust("/p")).toBe(expected);
  });

  it("an unreadable store fails closed even when the default is always", () => {
    const trust = createHostProjectTrust({
      recordedDecision: () => {
        throw new Error("lock held");
      },
      defaultProjectTrust: () => "always",
    });
    expect(trust("/p")).toBe(false);
  });

  it("a throwing store or settings read is untrusted, never a throw", () => {
    const trust = createHostProjectTrust({
      recordedDecision: () => {
        throw new Error("corrupt");
      },
      defaultProjectTrust: () => {
        throw new Error("corrupt");
      },
    });
    expect(trust("/p")).toBe(false);
  });
});

describe("E32 — against the real installed pi", () => {
  it("recorded decision wins; none + ask (pi default) is untrusted; none + always is trusted", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-"));
    const yes = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-yes-"));
    const no = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-no-"));
    const none = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-none-"));
    try {
      // A folder is only gated when it holds trust-requiring project resources.
      for (const d of [yes, no, none]) {
        fs.mkdirSync(path.join(d, ".pi"), { recursive: true });
        fs.writeFileSync(path.join(d, ".pi", "settings.json"), "{}");
      }
      const { ProjectTrustStore } = await getPiCore();
      const store = new ProjectTrustStore(agentDir);
      store.set(yes, true);
      store.set(no, false);
      fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask" }));
      let trust = await loadHostProjectTrust(agentDir);
      expect(trust(yes)).toBe(true);
      expect(trust(no)).toBe(false);
      expect(trust(none)).toBe(false);

      fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
      trust = await loadHostProjectTrust(agentDir);
      expect(trust(none)).toBe(true);
      expect(trust(no)).toBe(false);
    } finally {
      for (const d of [agentDir, yes, no, none]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

// ── mirror-dashboard-trust-to-pi ──────────────────────────────────────────

import { afterEach, beforeEach, vi } from "vitest";
import { createHostProjectTrustService, loadHostProjectTrustService } from "../pi/host-project-trust.js";

describe("shared decision (#E9 consumer)", () => {
  const base = {
    hasTrustRequiringResources: () => true,
    recordedEntry: () => null,
    defaultProjectTrust: () => "ask" as const,
  };
  const pinned = { enabled: () => true, covering: () => ({ sourceKind: "pinned" as const, key: "/r" }) };

  it("dashboard trust fills the gap, also over never, with its source", () => {
    for (const dflt of ["ask", "never"] as const) {
      const svc = createHostProjectTrustService({ ...base, defaultProjectTrust: () => dflt, mirror: pinned });
      expect(svc.isProjectTrusted("/r")).toBe(true);
      expect(svc.projectTrustSource("/r")).toEqual({ kind: "dashboard", sourceKind: "pinned", entry: "/r" });
    }
  });

  it("a recorded refusal beats a pin; a disabled mirror equals pi's own resolution", () => {
    const refused = createHostProjectTrustService({ ...base, recordedEntry: () => ({ path: "/r", decision: false }), mirror: pinned });
    expect(refused.isProjectTrusted("/r")).toBe(false);
    expect(refused.projectTrustSource("/r")).toEqual({ kind: "recorded", path: "/r" });
    const off = createHostProjectTrustService({ ...base, mirror: { ...pinned, enabled: () => false } });
    expect(off.isProjectTrusted("/r")).toBe(false);
    expect(off.projectTrustSource("/r")).toEqual({ kind: "default", value: "ask" });
  });

  it("no trust-requiring resources is implicitly trusted", () => {
    const svc = createHostProjectTrustService({ ...base, hasTrustRequiringResources: () => false });
    expect(svc.projectTrustSource("/r")).toEqual({ kind: "implicit" });
  });
});

describe("#E24 / #X10 / #E27 host predicate", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust2-")));
  });
  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("#E24 honours PI_CODING_AGENT_DIR: recorded entry there wins, with its source", async () => {
    const proj = path.join(tmp, "r");
    fs.mkdirSync(path.join(proj, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(proj, ".pi", "settings.json"), "{}");
    const agent = path.join(tmp, "x", "agent");
    fs.mkdirSync(agent, { recursive: true });
    const key = fs.realpathSync(proj);
    fs.writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [key]: true }));
    process.env.PI_CODING_AGENT_DIR = agent;
    const svc = await loadHostProjectTrustService();
    expect(svc.isProjectTrusted(proj)).toBe(true);
    expect(svc.projectTrustSource(proj)).toEqual({ kind: "recorded", path: key });
  });

  it("#X10 an unresolvable pi logs exactly once and every project reads untrusted", async () => {
    const log = vi.fn();
    const svc = await loadHostProjectTrustService(undefined, {
      getCore: (async () => {
        throw new Error("no pi");
      }) as never,
      log,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(svc.isProjectTrusted("/anything")).toBe(false);
    expect(svc.isProjectTrusted("/else")).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("#E27 50 host predicate calls leave trust.json bytes and mtime unchanged", async () => {
    const agent = path.join(tmp, "agent");
    fs.mkdirSync(agent);
    const file = path.join(agent, "trust.json");
    fs.writeFileSync(file, JSON.stringify({ "/some/folder": true }));
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const svc = await loadHostProjectTrustService(agent);
    for (let i = 0; i < 50; i++) svc.isProjectTrusted(i % 2 ? "/some/folder/x" : tmp);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });
});
