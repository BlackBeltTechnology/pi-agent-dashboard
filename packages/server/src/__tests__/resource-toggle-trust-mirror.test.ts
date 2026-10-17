/**
 * Toggle trust gate with durable dashboard trust (test-plan #E17 #E18):
 * a covered folder with nothing recorded gets the existing prompt with "Trust"
 * pre-selected and the lasting effect stated — never an auto-record, and never a
 * silent proceed/refusal.
 * See change: mirror-dashboard-trust-to-pi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let covering: { sourceKind: "pinned"; key: string } | null = null;
vi.mock("../pi/host-project-trust.js", () => ({
  coveringDashboardEntry: () => covering,
}));

import { getPiCore, type PiSettingsManager } from "../pi/pi-resource-activation.js";
import { resolveToggleTrust } from "../pi/resource-toggle-trust.js";

let tmp: string;
let agentDir: string;
let cwd: string;
const sm = (dflt: "ask" | "never" | "always") => ({ getDefaultProjectTrust: () => dflt }) as unknown as PiSettingsManager;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-mirror-")));
  agentDir = path.join(tmp, "agent");
  fs.mkdirSync(agentDir);
  cwd = path.join(tmp, "r");
  fs.mkdirSync(cwd);
  covering = { sourceKind: "pinned", key: cwd };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function record(p: string, decision: boolean): Promise<void> {
  const { ProjectTrustStore } = await getPiCore();
  new ProjectTrustStore(agentDir).set(p, decision);
}

describe("#E17 pinned folder, nothing recorded, default ask", () => {
  it("prompts with trust pre-selected, the source named and the lasting effect; records nothing", async () => {
    const r = await resolveToggleTrust(cwd, agentDir, sm("ask"));
    expect(r.outcome).toBe("prompt");
    if (r.outcome !== "prompt") return;
    expect(r.preselected).toBe("trust");
    expect(r.dashboardSource).toBe("pinned folder");
    expect(r.message).toMatch(/pinned folder/);
    expect(r.message).toMatch(/lasting pi trust decision/);
    expect(r.message).toMatch(/does not remove it/);
    expect(r.options.map((o) => o.id)).toContain("trust");
    expect(fs.existsSync(path.join(agentDir, "trust.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".pi", "settings.json"))).toBe(false);
  });
});

describe("#E18 refusal and never", () => {
  it("pinned + default never → prompt (not refuse), pre-selected", async () => {
    const r = await resolveToggleTrust(cwd, agentDir, sm("never"));
    expect(r).toMatchObject({ outcome: "prompt", preselected: "trust" });
  });

  it("exact recorded refusal + pinned → refused, no prompt", async () => {
    await record(cwd, false);
    expect((await resolveToggleTrust(cwd, agentDir, sm("ask"))).outcome).toBe("refused");
  });

  it("ancestor refusal + pinned child → prompt without pre-selection", async () => {
    await record(tmp, false);
    const r = await resolveToggleTrust(cwd, agentDir, sm("ask"));
    expect(r.outcome).toBe("prompt");
    if (r.outcome === "prompt") expect(r.preselected).toBeUndefined();
  });

  it("without dashboard trust, never still refuses and ask prompts without pre-selection", async () => {
    covering = null;
    expect((await resolveToggleTrust(cwd, agentDir, sm("never"))).outcome).toBe("refused");
    const r = await resolveToggleTrust(cwd, agentDir, sm("ask"));
    expect(r.outcome === "prompt" && r.preselected).toBeFalsy();
  });

  it("default always still proceeds without recording", async () => {
    expect((await resolveToggleTrust(cwd, agentDir, sm("always"))).outcome).toBe("proceed");
    expect(fs.existsSync(path.join(agentDir, "trust.json"))).toBe(false);
  });
});
