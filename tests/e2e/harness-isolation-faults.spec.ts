/**
 * L3 — deliberate-poisoning scenarios for harness-global trust isolation
 * (change: triage-browser-e2e-offbox-poison; test-plan #X8, #X10, #X14, #X15).
 *
 * Every test here POISONS the shared harness on purpose and then asserts the
 * fixtures recovered, so this file must never run in the default shards. It
 * SKIPS unless `PW_E2E_HARNESS_FAULTS=1` (same gate pattern as
 * `network-guard.spec.ts`'s `PW_E2E_GUARD_UNTRUSTED`) and is meant for a
 * dedicated, freshly booted harness:
 *
 *   PW_E2E_HARNESS_FAULTS=1 npm run test:e2e -- tests/e2e/harness-isolation-faults.spec.ts
 *
 * It is allowlisted by the trust-write lint (`scripts/check-e2e-fixture-import.mjs`)
 * because raw writes are exactly the faults under test.
 *
 * READ THE RESULT AS: the "fault" tests are RED BY DESIGN — a timeout, a leak
 * caught before the body runs, a killed worker (`test.fail()` only absorbs a
 * plain assertion failure, so it is used where it can be, e.g. X15) — and every
 * "recovery" test after one MUST be green: it proves the harness is back at its
 * boot baseline. The groups are deliberately not `serial`, so a red fault test
 * does not skip its recovery test.
 *
 * Not reproducible here, by construction: a network-guard refusal of the
 * credential-free client on a harness that holds an operator credential is
 * healed by the pre-test baseline check before the refusal verdict can latch
 * (design D3), and a host-gate refusal needs a non-loopback `Host`. The
 * refusal verdict is pinned at L1 (`scripts/__tests__/e2e-reap-core.test.mjs`).
 */
import { expect, narrowTrust, test } from "./fixtures.js";
import { readBaselineFile, readConfig, writeConfig } from "./helpers/trust-access.js";
import { compareTrust, pickTrust } from "./reap-core.js";

const ENABLED = process.env.PW_E2E_HARNESS_FAULTS === "1";
const WHY = "deliberate harness poisoning — set PW_E2E_HARNESS_FAULTS=1 on a dedicated fresh harness";
const LEAK_HOST = "leak.fault.example";

/** Assert the live trust keys equal the recorded boot baseline (credentialed read). */
async function expectBaseline(): Promise<void> {
  const file = readBaselineFile();
  expect(file?.baseline, "globalSetup must have recorded a trust baseline (needs an operator credential)").toBeTruthy();
  const read = await readConfig(true);
  expect(read.status).toBe(200);
  const cmp = compareTrust(file?.baseline ?? undefined, pickTrust(read.data));
  expect(cmp.message).toBe("");
}

test.describe("X8 — a timed-out narrowing is still restored", () => {
  test.skip(!ENABLED, WHY);

  test("narrows trustedNetworks, then hangs past its timeout", async ({ request }) => {
    test.fail(true, "expected: the test times out; the reap fixture must still restore");
    test.setTimeout(8_000);
    await narrowTrust(request, { trustedNetworks: [] });
    await new Promise(() => {});
  });

  test("the next test reaches the harness and trust equals the baseline", async () => {
    await expectBaseline();
  });
});

test.describe("X15 — an undeclared write is attributed to the test that made it", () => {
  test.skip(!ENABLED, WHY);

  test("writes allowedHosts without narrowTrust (stands in for an undeclared UI Save)", async () => {
    test.fail(true, "expected: the tripwire fails the owning test, naming allowedHosts");
    expect(await writeConfig({ allowedHosts: [LEAK_HOST] })).toBe(200);
  });

  test("the tripwire healed the leak, so the next test is not the first to fail", async () => {
    await expectBaseline();
  });
});

test.describe("X14 — a leaked afterAll narrowing is caught at the next test", () => {
  test.skip(!ENABLED, WHY);

  test("passes; its afterAll then leaks allowedHosts (no restore ran)", async () => {
    await expectBaseline();
  });

  test.afterAll(async () => {
    await writeConfig({ allowedHosts: [LEAK_HOST] });
  });
});

test.describe("X14 (continued) — the victim fails, naming the leak; the one after passes", () => {
  test.skip(!ENABLED, WHY);

  test("pre-test baseline check re-asserts and fails this test", async () => {
    test.fail(true, "expected: decidePreRead fails the first test after the leak");
  });

  test("the following test passes on a healed harness", async () => {
    await expectBaseline();
  });
});

test.describe("X10 — a killed worker does not poison its successor", () => {
  test.skip(!ENABLED, WHY);

  test("narrows, then the worker is SIGKILLed mid-test", async ({ request }) => {
    test.fail(true, "expected: the worker dies; no teardown runs");
    await narrowTrust(request, { trustedNetworks: [] });
    process.kill(process.pid, "SIGKILL");
    await new Promise(() => {});
  });

  test("the fresh worker re-asserted the baseline before its first test", async () => {
    await expectBaseline();
  });
});
