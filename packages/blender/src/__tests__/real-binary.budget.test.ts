/**
 * Budget lane (`*.budget.test.*`: excluded from blocking runs by `BUDGET_TEST_EXCLUDE`, collected when the
 * nightly `budget` job sets RUN_BUDGET_TESTS=1). No env gate of its own; the runtime gate `describeReal`
 * (BLENDER_WASM_E2E=1 + JSPI, helpers/runtime.ts) stays.
 *
 * P1–P3: boot time, median `blender_scene` latency and host RSS against the real Blender WebAssembly
 * runtime. The functional cases (E10–E51) stay in `real-binary.test.ts`.
 *
 * Split from `real-binary.test.ts`. See change: add-blender-wasm-mcp, stabilize-blocking-test-lanes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { hostPidBelow } from "./helpers/mcp-client.js";
import { boot, ok, reset, rssBytes, type Session, scene } from "./helpers/real-binary-session.js";
import { describeReal } from "./helpers/runtime.js";

describeReal("blender-wasm real: performance budget (P1–P3)", () => {
  let s: Session;

  beforeAll(() => {
    s = boot();
  });

  it("P1: the first blender_scene (boot included) from a fresh server against a valid cache takes <= 15 s", async () => {
    const t0 = Date.now();
    const r = ok(await scene(s));
    const ms = Date.now() - t0;
    expect(r.data.total).toBe(3);
    expect(ms, `first call took ${ms} ms`).toBeLessThanOrEqual(15_000);
  });

  it("P2: the median of 5 blender_scene calls on a live factory session is <= 2 s", async () => {
    ok(await reset(s, "factory"));
    ok(await scene(s)); // make sure the session is live whatever ran before
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      ok(await scene(s));
      times.push(Date.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[2];
    expect(median, `call times ms: ${times.join(", ")}`).toBeLessThanOrEqual(2_000);
  });

  it("P3: after boot and a .glb export the Blender host process holds <= 2.5 GB RSS", async () => {
    ok(await reset(s, "factory"));
    ok(await s.c.call("blender_export", { path: "out/f.glb" }));
    expect(fs.statSync(path.join(s.ws, "out", "f.glb")).size).toBeGreaterThan(0);
    const launcher = s.c.child.pid as number;
    const host = hostPidBelow(launcher);
    expect(host, "host pid below the launcher").toBeDefined();
    const rss = rssBytes(host as number);
    expect(rss, `host RSS ${(rss / 2 ** 20).toFixed(0)} MiB`).toBeGreaterThan(0);
    expect(rss, `host RSS ${(rss / 2 ** 20).toFixed(0)} MiB`).toBeLessThanOrEqual(2.5 * 1024 ** 3);
  });
});
