/**
 * Latency budget: catalog p95 < 300 ms (40 packages, 30 plugins, 9 bridges,
 * warm enricher cache). See change: addons-hub-feature-catalog (test-plan #P1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { AddonsEnv } from "./addons-fixture.js";

let env: AddonsEnv;
afterEach(async () => {
  await env?.cleanup();
});

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

describe("catalog latency", () => {
  it("p95 < 300 ms over 50 sequential requests", async () => {
    env = new AddonsEnv("perf-catalog");
    for (let i = 0; i < 30; i++) {
      env.addPlugin({ id: `pl${i}`, packageName: `pkg-${i}`, requires: [`pkg-${(i + 1) % 40}`], bridge: i < 9 });
    }
    const sources: string[] = [];
    for (let i = 0; i < 40; i++) {
      env.addPackage(`npm:pkg-${i}`, { name: `pkg-${i}` });
      sources.push(`npm:pkg-${i}`);
    }
    env.writeSettings({ packages: sources });
    await env.makeApp({ lookupNpm: async () => ({ version: "1.0.0" }) });
    await env.catalog(); // warm
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      const res = await env.catalog();
      times.push(performance.now() - t);
      expect(res.status).toBe(200);
    }
    expect(p95(times)).toBeLessThan(300);
  });
});
