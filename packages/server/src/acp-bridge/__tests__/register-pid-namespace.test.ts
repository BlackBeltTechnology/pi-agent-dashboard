/**
 * E60: the ACP adapter reports the namespace of the process whose pid it
 * reports, on the first and on every reattach register; without `reportPid`
 * (host A, the server's own process) it reports neither.
 * See change: scope-pids-to-namespace.
 */
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { makeHarness, startReady } from "./adapter-harness.js";

const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };

describe("ACP adapter session_register carries pidNamespace (E60)", () => {
  it("spawn and reattach both carry pid 5150 and the namespace", async () => {
    const h = makeHarness({ adapter: { reportPid: 5150, reportPidNamespace: RL } });
    await startReady(h);
    await h.adapter.reconnected();
    const regs = h.of("session_register");
    expect(regs.map((r) => r.registerReason)).toEqual(["spawn", "reattach"]);
    for (const r of regs) {
      expect(r.pid).toBe(5150);
      expect(r.pidNamespace).toEqual(RL);
    }
    await h.adapter.stop();
  });

  it("without reportPid neither pid nor namespace is sent", async () => {
    const h = makeHarness();
    await startReady(h);
    const [reg] = h.of("session_register");
    expect(reg).not.toHaveProperty("pid");
    expect(reg).not.toHaveProperty("pidNamespace");
    await h.adapter.stop();
  });
});
