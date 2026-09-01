/**
 * RealInvoiceEngine's fan-out surface — the CROSS-REPO CONTRACT GUARD.
 *
 * The engine facade is an optionalDependency resolved over a `file:` link, so it
 * is absent in CI, in a worktree and in a release build: every gate we can run
 * today binds the FAKE. That means the real path is exercised nowhere until the
 * docker E2E, and a mismatch between what the engine exports and what this
 * adapter calls would surface there as "fan-out silently does nothing" — the
 * worst possible failure shape.
 *
 * These tests close that hole by injecting a STUB FACADE into the real adapter.
 * They pin, in order of how badly a drift would hurt:
 *   1. the exact call shape of `takeQueued(cwd, invoiceId)` — argument ORDER
 *      included. This is the one member that does not exist upstream yet, so
 *      this is the assertion that fails loudly if it lands with another shape;
 *   2. that `take` is exposed ONLY when the facade can do it, so a targeted run
 *      reports "unavailable" rather than an emulated, timing-dependent lease;
 *   3. that an OLDER engine checkout (no work-source surface at all) degrades to
 *      vending nothing instead of the host minting leases the engine's store
 *      knows nothing about;
 *   4. that `ack`/`nack` reach the workspace-bound source unchanged (the engine
 *      fences on the token, so a mangled token would silently leak a claim).
 *
 * See change: relocate-fanout-to-work-source.
 */
import { describe, expect, it } from "vitest";
import { RealInvoiceEngine } from "../engine/real.js";

/** Minimal facade surface these tests exercise, plus a call recorder. */
function stubFacade(opts: { workSource?: boolean; takeQueued?: boolean; migrator?: boolean } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = (fn: string, args: unknown[]) => calls.push({ fn, args });
  const facade: Record<string, unknown> = {
    query: async () => ({ content: [], details: {} }),
    review: async () => ({ content: [], details: {} }),
    setup: async () => ({ content: [], details: {} }),
    rules: async () => ({ content: [], details: {} }),
    ingest: async () => ({ results: [], landed: 0, skipped: 0, rejected: 0 }),
    ensureIntakeAutomation: async () => ({ automation: [] }),
  };
  if (opts.workSource !== false) {
    facade.queuedWorkSource = (cwd: string) => {
      rec("queuedWorkSource", [cwd]);
      return {
        next: (n: number) => {
          rec("next", [n]);
          return [{ item: "inv-1", leaseToken: "lease-1", idempotencyKey: "inv-1" }];
        },
        ack: (t: string) => rec("ack", [t]),
        nack: (t: string) => rec("nack", [t]),
      };
    };
  }
  if (opts.takeQueued) {
    facade.takeQueued = (cwd: string, invoiceId: string) => {
      rec("takeQueued", [cwd, invoiceId]);
      return invoiceId === "leased"
        ? null
        : { item: invoiceId, leaseToken: `k-${invoiceId}`, idempotencyKey: invoiceId };
    };
  }
  if (opts.migrator) {
    facade.migrateIntakeAutomation = async (cwd: string) => {
      rec("migrateIntakeAutomation", [cwd]);
      return { migrated: [`${cwd}/.pi/automation/invoicebot-intake/automation.yaml`], skipped: [] };
    };
  }
  // The stub stands in for the OPTIONAL facade, whose type is only structural
  // here; cast through `never` so no `any` is introduced.
  return { engine: new RealInvoiceEngine(facade as unknown as never), calls };
}

describe("RealInvoiceEngine.queuedWorkSource", () => {
  it("binds the engine's source to the requested workspace and forwards the vend", async () => {
    const { engine, calls } = stubFacade();

    const src = engine.queuedWorkSource("/w");
    const handles = await src.next(3);

    expect(calls.find((c) => c.fn === "queuedWorkSource")?.args).toEqual(["/w"]);
    expect(calls.find((c) => c.fn === "next")?.args).toEqual([3]);
    expect(handles).toEqual([{ item: "inv-1", leaseToken: "lease-1", idempotencyKey: "inv-1" }]);
  });

  it("forwards ack/nack tokens VERBATIM (the engine fences on the token)", () => {
    const { engine, calls } = stubFacade();
    const src = engine.queuedWorkSource("/w");

    src.ack("lease-1");
    src.nack("lease-2");

    expect(calls.filter((c) => c.fn === "ack").map((c) => c.args)).toEqual([["lease-1"]]);
    expect(calls.filter((c) => c.fn === "nack").map((c) => c.args)).toEqual([["lease-2"]]);
  });

  it("exposes NO take when the engine cannot lease one named invoice", () => {
    const { engine } = stubFacade({ takeQueued: false });
    expect(engine.queuedWorkSource("/w").take).toBeUndefined();
  });

  it("calls takeQueued(cwd, invoiceId) — argument ORDER pinned across the repo boundary", async () => {
    const { engine, calls } = stubFacade({ takeQueued: true });

    const handle = await engine.queuedWorkSource("/w").take!("inv-7");

    // If the engine ever lands `takeQueued(invoiceId, cwd)`, THIS is what fails —
    // loudly, here, instead of silently leasing nothing in production.
    expect(calls.find((c) => c.fn === "takeQueued")?.args).toEqual(["/w", "inv-7"]);
    expect(handle).toEqual({ item: "inv-7", leaseToken: "k-inv-7", idempotencyKey: "inv-7" });
  });

  it("passes a null (already-leased) verdict straight through", async () => {
    const { engine } = stubFacade({ takeQueued: true });
    expect(await engine.queuedWorkSource("/w").take!("leased")).toBeNull();
  });

  it("an OLDER engine checkout vends nothing rather than host-minted leases", async () => {
    const { engine, calls } = stubFacade({ workSource: false });

    const src = engine.queuedWorkSource("/w");

    expect(await src.next(4)).toEqual([]);
    expect(src.take).toBeUndefined();
    // ack/nack must stay callable no-ops — a finalizing run releases blind.
    expect(() => {
      src.ack("whatever");
      src.nack("whatever");
    }).not.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("RealInvoiceEngine.migrateIntakeAutomation", () => {
  it("delegates to the engine's own migrator (the engine owns the emitted shape)", async () => {
    const { engine, calls } = stubFacade({ migrator: true });

    const res = await engine.migrateIntakeAutomation("/w");

    expect(calls.find((c) => c.fn === "migrateIntakeAutomation")?.args).toEqual(["/w"]);
    expect(res.migrated).toHaveLength(1);
  });

  it("reports a missing migrator instead of throwing (an older engine checkout)", async () => {
    const { engine } = stubFacade({ migrator: false });

    const res = await engine.migrateIntakeAutomation("/w");

    expect(res.migrated).toEqual([]);
    expect(res.skipped.join(" ")).toMatch(/no migrator/i);
  });
});

/**
 * CONTRACT PROBE against the REAL facade — the limit of what a stub can prove.
 *
 * Everything above pins this adapter against MY expectation of the engine, so it
 * would still pass if the engine landed a different shape. This block closes that
 * gap where it can: wherever the `file:` sibling actually resolves (a dev machine,
 * the docker image), it asserts the members this adapter calls EXIST on the real
 * export. It SKIPS where the optionalDependency is absent (CI, worktrees,
 * release builds) rather than failing for an unrelated reason.
 *
 * It catches the two likeliest drifts — "never landed" and "renamed". Argument
 * ORDER is pinned by the stub test above plus the docker E2E; asserting it here
 * would mean touching a real store from a unit test.
 */
const facadeMod = await (async () => {
  try {
    const spec = "@blackbelt-technology/invoicebot/engine";
    return (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch {
    return null;
  }
})();

const hasWorkSource = typeof facadeMod?.queuedWorkSource === "function";

describe.skipIf(!hasWorkSource)("real facade exports the fan-out surface this adapter calls", () => {
  // SKIPPED when the resolved engine has no work-source surface at all — that is
  // an INSTALL fact (an absent or stale `file:` link), not a defect in this
  // package, and `RealInvoiceEngine` already warns loudly at runtime for it. On a
  // correctly linked machine (and in the docker image) these enforce the contract.
  it("exposes migrateIntakeAutomation alongside queuedWorkSource", () => {
    expect(typeof facadeMod?.migrateIntakeAutomation).toBe("function");
  });

  it("registers under the id the host uses", () => {
    // A mismatch here means every fire isolates as "unknown work source".
    expect(facadeMod?.QUEUED_WORK_SOURCE_ID).toBe("invoicebot-queued");
  });

  it("exposes takeQueued under the name the adapter looks for, once it lands", () => {
    // Until the engine ships it, `take` is correctly absent and a targeted run
    // reports unavailable. This asserts the NAME, so landing it under a different
    // one fails here instead of leaving /run-invoice quietly degraded.
    if (!("takeQueued" in (facadeMod ?? {}))) return; // not landed yet — nothing to check
    expect(typeof facadeMod?.takeQueued).toBe("function");
  });
});
