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

/**
 * pi 1.5 `getEntry` returns the STORED key spelling, matched with `pathsEqual`
 * (case-insensitive on Windows). The "recorded for this folder itself" check
 * compares with pi's `pathsEqual` too, so a Windows own-folder refusal saved
 * with different casing still refuses. The win32 branch runs on every host via
 * an injected `path.win32`.
 * See change: update-pi-core-1-5-adopt-apis (test-plan #E29 #E30 #E31).
 */
describe("own-folder check uses pi's pathsEqual (#E29 #E30 #E31)", () => {
  afterEach(() => vi.restoreAllMocks());

  async function stubEntry(entry: { path: string; decision: boolean } | null) {
    const { ProjectTrustStore } = await getPiCore();
    return vi.spyOn(ProjectTrustStore.prototype, "getEntry").mockReturnValue(entry as never);
  }

  it("#E29 win32: own refusal saved with different casing → refused, no prompt, nothing written", async () => {
    covering = null;
    await stubEntry({ path: "C:\\Work\\Repo", decision: false });
    const r = await resolveToggleTrust("c:\\work\\repo", agentDir, sm("ask"), path.win32);
    expect(r.outcome).toBe("refused");
    expect(fs.existsSync(path.join(agentDir, "trust.json"))).toBe(false);
  });

  it("#E30 win32: an inherited ancestor refusal still prompts (trust / trust-parent / decline)", async () => {
    covering = null;
    await stubEntry({ path: "C:\\Work", decision: false });
    const r = await resolveToggleTrust("c:\\work\\repo", agentDir, sm("ask"), path.win32);
    expect(r.outcome).toBe("prompt");
    if (r.outcome === "prompt") expect(r.options.map((o) => o.id)).toEqual(["trust", "trust-parent", "decline"]);
    expect(fs.existsSync(path.join(agentDir, "trust.json"))).toBe(false);
  });

  it("#E31 posix: own refusal under a non-normalised key or through a symlink → refused", async () => {
    covering = null;
    const spy = await stubEntry({ path: `${cwd}/`, decision: false });
    expect((await resolveToggleTrust(cwd, agentDir, sm("ask"))).outcome).toBe("refused");
    const link = path.join(tmp, "link");
    fs.symlinkSync(cwd, link);
    spy.mockReturnValue({ path: cwd, decision: false } as never);
    expect((await resolveToggleTrust(link, agentDir, sm("ask"))).outcome).toBe("refused");
    expect(fs.existsSync(path.join(agentDir, "trust.json"))).toBe(false);
  });
});
