// Skill Atlas graph: live d3-force layout + forest auras with click-to-zoom.
// Current = the real SkillGraphView; Proposed = mock-local ForestGraph prototype.
// Fixture = snapshot of the global atlas (49 skills, 160 links).
// See change: add-skill-atlas-forest-aura.
import type { SkillGraph, SkillNode } from "@atlas/shared/types.ts";
import { SkillGraphView } from "@atlas/client/SkillGraphView.tsx";
import { Fix, Issue, type Mock } from "mock-site/kit";
import { ForestGraph } from "./ForestGraph.tsx";
import graph from "./graph.fixture.json";

const g = graph as SkillGraph;
const all = () => true;
const noop = () => {};

const Current = () => (
  <div style={{ height: 600 }} className="bg-[var(--bg-primary)]">
    <SkillGraphView allSkills={g.skills} allLinks={g.links} skills={g.skills} links={g.links} selected={null} hops={0} matches={all as (s: SkillNode) => boolean} query="" onSelect={noop} />
  </div>
);

const mock: Mock = {
  title: "Skill Atlas graph - forest auras",
  category: "Plugins",
  frames: [
    {
      title: "Global atlas - desktop",
      width: 1100,
      why: "Groups get a clickable halo. Standard d3 drag, heavily damped: neighbours follow, the dot settles slowly.",
      current: (
        <Issue n={1} tip="Clusters float with no boundary" block>
          <Current />
        </Issue>
      ),
      proposed: (
        <Fix n={1} tip="Each forest wrapped in a clickable aura" block>
          <ForestGraph skills={g.skills} links={g.links} />
        </Fix>
      ),
    },
    {
      title: "Zoom into a forest",
      width: 1100,
      why: "Click the halo to fit that group; others dim. Esc, the chip, or clicking empty space returns.",
      steps: [
        { label: "click an aura", proposed: <ForestGraph skills={g.skills} links={g.links} /> },
        {
          label: "zoomed forest",
          proposed: (
            <Fix n={2} tip="Fit to forest, labels shown, rest dimmed" block>
              <ForestGraph skills={g.skills} links={g.links} initialForestOf="anti-slop-frontend" />
            </Fix>
          ),
        },
      ],
    },
    {
      title: "Relation filter: same package off",
      width: 1100,
      why: "Forests come from visible links, so hiding bundle edges re-forms groups around real references.",
      proposed: (
        <Fix n={3} tip="Graph reheats; auras regroup" block>
          <ForestGraph skills={g.skills} links={g.links} relations={["references", "shares-tool"]} />
        </Fix>
      ),
    },
  ],
};
export default mock;
