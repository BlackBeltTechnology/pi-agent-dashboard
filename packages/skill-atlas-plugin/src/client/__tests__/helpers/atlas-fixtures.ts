/**
 * Shared graph fixtures for the atlas layout tests: `node`/`link` builders and `pairs` (disjoint
 * two-skill forests). Used by `graph-layout.test.ts` and its budget-lane file `graph-layout.budget.test.ts`.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import type { SkillLink, SkillNode } from "../../../shared/types.js";

export const node = (id: string, degree = 0): SkillNode => ({ id, description: "", filePath: "", origin: "global", degree });
export const link = (source: string, target: string, type: SkillLink["type"] = "references"): SkillLink => ({ source, target, type, why: "" });

/** `n` disjoint two-skill forests (references), plus `extra` singletons. */
export function pairs(n: number, extra = 0) {
  const skills: SkillNode[] = [];
  const links: SkillLink[] = [];
  for (let i = 0; i < n; i++) {
    const a = `p${String(i).padStart(3, "0")}a`;
    const b = `p${String(i).padStart(3, "0")}b`;
    skills.push(node(a, 1), node(b, 1));
    links.push(link(a, b));
  }
  for (let i = 0; i < extra; i++) skills.push(node(`s${String(i).padStart(3, "0")}`));
  return { skills, links };
}
