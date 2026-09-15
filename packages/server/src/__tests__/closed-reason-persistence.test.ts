import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { describe, expect, it } from "vitest";
import { createMetaPersistence } from "../persistence/meta-persistence.js";

/**
 * E15 — the reason SHALL persist through the documented overwrite trap.
 * `session-to-meta.ts` is a FULL OVERWRITE that does not enumerate
 * `closedReason`; only the eager `setLiveness` write persists it, and a later
 * routine (`save`) write must carry it forward rather than wipe it.
 * See change: stop-discarding-known-session-state (design D2).
 */
describe("meta-persistence — closedReason survives the overwrite trap", () => {
  it("E15: an eager liveness write persists the reason, and a routine save does not wipe it", () => {
    const dir = mkdtempSync(join(tmpdir(), "closed-reason-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, "");

    const mp = createMetaPersistence();
    // The eager, atomic terminal write (what onUnregister now does).
    mp.setLiveness(file, { live: false, closedReason: "process_gone" });
    expect(readSessionMeta(file)?.closedReason).toBe("process_gone");

    // A routine full-overwrite stats save that does NOT enumerate closedReason.
    mp.save(file, { status: "ended", cwd: "/repo" });
    mp.flushAll();

    // Without the carry-forward, the naive path would have wiped it here.
    expect(readSessionMeta(file)?.closedReason).toBe("process_gone");
    mp.dispose();
  });
});
