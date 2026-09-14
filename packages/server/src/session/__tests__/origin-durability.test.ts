/**
 * Origin has to survive the process that derived it.
 *
 * `originDeviceId` is not a display field — it GATES FILESYSTEM READS. A remote
 * session's recorded `sessionFile` is a path on the origin host, and a machine
 * with the same username has that path too, holding an unrelated transcript
 * (#E15). So the moment origin is forgotten, hydration opens the wrong disk.
 *
 * Three ways it used to be forgotten, each silent:
 *
 *   - a routine meta save (`sessionToMeta` is a FULL OVERWRITE — a field not
 *     enumerated there is erased on the next write, the same trap `hidden` and
 *     `archived` are commented for);
 *   - a server restart (sessions and archive rows are rebuilt from sidecars);
 *   - an unarchive (the restored session is rebuilt from meta + row).
 *
 * Absent still means local, so every sidecar written before this change reads
 * exactly as it did — which is correct, since they predate remote origins.
 *
 * See change: serve-retained-remote-transcripts (review finding A).
 */
import { describe, expect, it } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sessionToMeta } from "../session-to-meta.js";

const REMOTE_DEVICE = "paired-device-7f3a";

function remoteSession(): DashboardSession {
  return {
    id: "sess-remote",
    cwd: "/work/elsewhere",
    source: "tui",
    status: "ended",
    startedAt: 1000,
    lastActivityAt: 2000,
    originDeviceId: REMOTE_DEVICE,
    sessionFile: "/home/sameuser/.pi/sessions/sess-remote.jsonl",
  } as unknown as DashboardSession;
}

describe("origin survives persistence", () => {
  it("enumerates originDeviceId in the full-overwrite meta projection", () => {
    // The bug this pins is not "the value is wrong" but "the key is missing":
    // an unenumerated field is wiped by the next routine save.
    expect(sessionToMeta(remoteSession())).toHaveProperty("originDeviceId", REMOTE_DEVICE);
  });

  it("keeps a LOCAL session's origin absent rather than writing a sentinel", () => {
    const local = { ...remoteSession(), originDeviceId: undefined } as DashboardSession;
    expect(sessionToMeta(local).originDeviceId).toBeUndefined();
  });

  it("round-trips through meta without inventing or dropping the device", () => {
    // A remote session saved and reloaded must still be remote. This is the
    // property the restart path depends on.
    const meta = sessionToMeta(remoteSession());
    expect(meta.originDeviceId).toBe(REMOTE_DEVICE);
    expect(sessionToMeta({ ...remoteSession(), originDeviceId: meta.originDeviceId })).toHaveProperty(
      "originDeviceId",
      REMOTE_DEVICE,
    );
  });
});
