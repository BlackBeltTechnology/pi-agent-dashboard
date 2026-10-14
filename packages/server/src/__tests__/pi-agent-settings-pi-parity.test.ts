import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyPiSettingsPatch, readPiSettings } from "../pi-agent-settings.js";

/**
 * pi's published `.d.ts` barrel is not value-importable under this repo's
 * `moduleResolution`, so load it dynamically with a minimal structural type
 * (same pattern as `provider-auth-adapter.ts`).
 */
interface PiSettingsManagerLike {
  setSteeringMode(mode: string): void;
  flush(): Promise<void>;
}
const loadSettingsManager = async () =>
  ((await import("@earendil-works/pi-coding-agent")) as unknown as {
    SettingsManager: { create(cwd: string, agentDir: string): PiSettingsManagerLike };
  }).SettingsManager;

/**
 * Parity guards against the installed pi: the dashboard's settings.json writer
 * must take the SAME lock artifact pi takes, and must interleave correctly with
 * pi's queued flush. Fails when pi changes its lock scheme.
 * See change: edit-pi-agent-settings (design D5, Risks).
 */
describe("pi settings lock parity", () => {
  /** pi's `exports` map blocks a deep resolve, so walk up to node_modules. */
  const piSource = () => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (;;) {
      const candidate = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "settings-manager.js");
      if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
      const parent = dirname(dir);
      if (parent === dir) throw new Error("pi-coding-agent not found in any node_modules");
      dir = parent;
    }
  };

  it("E42 pi locks the UNRESOLVED <agentDir>/settings.json via proper-lockfile realpath:false", () => {
    const src = piSource();
    expect(src).toMatch(/this\.globalSettingsPath = join\(resolvedAgentDir, "settings\.json"\)/);
    expect(src).toMatch(/lockfile\.lockSync\(path, \{ realpath: false \}\)/);
    // retry budget the dashboard's own 10 x 20 ms is sized against
    expect(src).toMatch(/maxAttempts = 10/);
    expect(src).toMatch(/delayMs = 20/);
  });

  it("X9 a pi flush after a dashboard write keeps both sides' fields", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-parity-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-parity-cwd-"));
    writeFileSync(join(agentDir, "settings.json"), "{}");
    const deps = { agentDirEnv: agentDir };

    // pi loads its snapshot first, then the dashboard writes, then pi flushes a
    // setter. (pi's flush takes a SYNC lock with a spin-wait, so it can only be
    // exercised out of the dashboard's critical section in-process.)
    const sm = (await loadSettingsManager()).create(cwd, agentDir);
    const r = await applyPiSettingsPatch({ compaction: { reserveTokens: 20000 } }, readPiSettings(deps).etag, deps);
    expect(r.ok).toBe(true);
    sm.setSteeringMode("one-at-a-time");
    await sm.flush();

    const onDisk = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
    expect(onDisk.steeringMode).toBe("one-at-a-time"); // pi wins its own field
    expect(onDisk.compaction.reserveTokens).toBe(20000); // dashboard field kept
  });
});
