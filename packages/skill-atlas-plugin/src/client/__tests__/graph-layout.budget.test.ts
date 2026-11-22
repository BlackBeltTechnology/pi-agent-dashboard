/**
 * Budget lane (`*.budget.test.*`: excluded from blocking runs by `BUDGET_TEST_EXCLUDE`, collected when the
 * nightly `budget` job sets RUN_BUDGET_TESTS=1; no env gate of its own).
 *
 * #P1 — `presettle` over 300 skills / 300 links stays inside its wall-clock budget. Determinism and
 * separation of the same simulation stay asserted by the blocking `graph-layout.test.ts`.
 *
 * Split from `graph-layout.test.ts`. See change: add-skill-atlas-forest-aura, stabilize-blocking-test-lanes.
 */
import { describe, expect, it } from "vitest";
import type { SkillLink } from "../../shared/types.js";
import { createAtlasSimulation, presettle } from "../atlas-simulation.js";
import { link, pairs } from "./helpers/atlas-fixtures.js";

describe("atlas simulation budget (#P1)", () => {
  it("presettle at 300 skills / 300 links stays in budget (#P1)", () => {
    const p = pairs(150);
    // 150 more links inside the pair set's id space keep 300 links total but add chains.
    const extra: SkillLink[] = [];
    for (let i = 0; i < 150; i++) extra.push(link(`p${String(i).padStart(3, "0")}b`, `p${String(i).padStart(3, "0")}a`, "shares-tool"));
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const sim = createAtlasSimulation({ skills: p.skills, links: [...p.links, ...extra] });
      const t0 = performance.now();
      presettle(sim);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // 350 ms is the dev-machine budget; loaded CI forks measured 360-381 ms, so
    // CI gets contention headroom (parallel-test-execution spec).
    expect(times[1]).toBeLessThan(process.env.CI ? 700 : 350);
  });
});
