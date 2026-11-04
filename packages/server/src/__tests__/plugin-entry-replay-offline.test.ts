/**
 * Offline replay of plugin-declared entries: an ended session with no live
 * bridge replays its persisted flow-event records from the MANIFEST-derived
 * set (discovered flows manifest, enabled), not from a runtime declaration.
 * See change: update-flows-plugin (D3; test-plan #X7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverPlugins } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { computeReplayEntryTypes } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/replay-entry-types.js";
import { afterEach, describe, expect, it } from "vitest";
import { resetPluginEntryStatsForTest, setReplayEntryTypesProvider } from "../plugin-entry-stats.js";
import { createSessionLoadWorkerPool } from "../session/session-load-worker-pool.js";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const TS = "2026-01-01T00:00:00.000Z";

function writeSession(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x7-"));
  const file = path.join(dir, "s.jsonl");
  const lines = [{ type: "session", id: "s", timestamp: TS, cwd: "/" }];
  const recs: Array<[number, string]> = [[2, "flow_complete"], [0, "flow_started"], [1, "flow_agent_started"]];
  recs.forEach(([seq, eventType], i) => {
    lines.push({
      type: "custom",
      customType: "flow-event",
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      timestamp: TS,
      data: { seq, eventType, data: { n: seq }, flowRunId: "r" },
    } as never);
  });
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return file;
}

afterEach(() => resetPluginEntryStatsForTest());

describe("offline plugin-entry replay (X7)", () => {
  it("replays the discovered flows manifest's entry type, seq-ordered, with no bridge", async () => {
    const plugins = discoverPlugins(REPO);
    const flows = plugins.find((p) => p.manifest.id === "flows");
    expect(flows?.manifest.replayEntryTypes).toEqual(["flow-event"]);
    setReplayEntryTypesProvider(() =>
      computeReplayEntryTypes(plugins.map((p) => ({ replayEntryTypes: p.manifest.replayEntryTypes, enabled: true }))),
    );
    const pool = createSessionLoadWorkerPool({ useWorker: false });
    const out = await pool.load({ sessionId: "s", sessionFile: writeSession() }).result;
    await pool.dispose();
    expect(out.success).toBe(true);
    expect(out.events.map((e) => e.eventType)).toEqual(["flow_started", "flow_agent_started", "flow_complete"]);
    expect(out.pluginEntriesReplayed).toBe(3);
  });

  it("flows disabled: nothing replayed and no generic custom_entry", async () => {
    const plugins = discoverPlugins(REPO);
    setReplayEntryTypesProvider(() =>
      computeReplayEntryTypes(
        plugins.map((p) => ({ replayEntryTypes: p.manifest.replayEntryTypes, enabled: p.manifest.id !== "flows" })),
      ),
    );
    const pool = createSessionLoadWorkerPool({ useWorker: false });
    const out = await pool.load({ sessionId: "s", sessionFile: writeSession() }).result;
    await pool.dispose();
    expect(out.events).toEqual([]);
  });
});
