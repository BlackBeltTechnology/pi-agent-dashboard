/**
 * Latency budget: dry-run toggle p95 < 500 ms with 50 known directories, each
 * holding a 20-entry `.pi/settings.json`. See change: addons-hub-feature-catalog
 * (test-plan #P2).
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AddonsEnv } from "./addons-fixture.js";

let env: AddonsEnv;
afterEach(async () => {
  await env?.cleanup();
});

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

describe("dry-run latency", () => {
  it("p95 < 500 ms over 30 sequential dry runs", async () => {
    env = new AddonsEnv("perf-dry");
    env.addPlugin({ id: "goal", requires: ["@ricoyudog/pi-goal-hermes"] });
    env.addPackage("npm:@ricoyudog/pi-goal-hermes", { name: "@ricoyudog/pi-goal-hermes" });
    env.writeSettings({ packages: ["npm:@ricoyudog/pi-goal-hermes"] });
    const dirs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const dir = path.join(env.home, "folders", `f${i}`);
      dirs.push(dir);
      const entries = Array.from({ length: 19 }, (_, j) => `npm:other-${i}-${j}`);
      entries.push("npm:@ricoyudog/pi-goal-hermes");
      env.writeFolderSettings(dir, { packages: entries });
    }
    await env.makeApp({ knownDirs: dirs });
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const res = await env.toggle("plugin:goal", { enabled: false, dryRun: true });
      times.push(performance.now() - t);
      expect(res.status).toBe(200);
      expect(res.body.stillLoadedIn[0].folders).toHaveLength(50);
    }
    expect(p95(times)).toBeLessThan(500);
  });
});
