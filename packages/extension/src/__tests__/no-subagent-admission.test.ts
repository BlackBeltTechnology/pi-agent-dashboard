/**
 * @structural-pin bridge.ts must not register the removed admission handler or write `subagent-admission-refused`; booting `initBridge` starts the connection manager, so the absence is only observable in the source text
 */
/**
 * The dashboard-side subagent fan-out admission gate is gone: `Agent` calls are
 * never refused by the bridge, and no `subagent-admission-refused` entry is
 * written. The producer's `maxConcurrent` semaphore queues the excess instead.
 *
 * Covers test-plan #E17. Same approach as `credential-guard-wiring.test.ts`:
 * booting `initBridge` starts the connection manager, so the registration set is
 * pinned structurally on `bridge.ts` and the behaviour on the exact tool_call
 * handler the bridge registers.
 * See change: subagent-queue-visibility (D6).
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { createCredentialGuard, createCredentialGuardToolCallHandler } from "../credential-guard.js";

const bridgeSrc = fs.readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");

describe("no subagent admission (#E17)", () => {
  it("bridge.ts registers no admission handler and writes no refusal entry", () => {
    expect(bridgeSrc).not.toMatch(/subagent-admission-refused/);
    expect(bridgeSrc).not.toMatch(/FanoutAdmissionGate|SaturationSampler|fanoutAdmission/);
    // Exactly the two blocking tool_call handlers remain: credential guard + path gate.
    expect(bridgeSrc.match(/pi\.on\("tool_call"/g)).toHaveLength(2);
    expect(fs.existsSync(new URL("../subagent-fanout-admission.ts", import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL("../subagent-saturation.ts", import.meta.url))).toBe(false);
  });

  it("20 concurrent Agent tool_calls pass the bridge's tool_call guard unblocked", async () => {
    const home = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "no-admission-")));
    const handler = createCredentialGuardToolCallHandler(
      createCredentialGuard({ env: {}, homedir: home, log: () => {} }),
      () => true,
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, (_u, i) =>
        handler(
          {
            toolName: "Agent",
            toolCallId: `tc-${i}`,
            input: { subagent_type: "Explore", description: `child ${i}`, prompt: "go" },
          } as never,
          { cwd: home } as never,
        ),
      ),
    );
    expect(results.every((r) => r === undefined)).toBe(true);
  });
});
