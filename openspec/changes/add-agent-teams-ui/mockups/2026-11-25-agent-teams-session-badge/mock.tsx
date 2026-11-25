// DECISION: badge density on the session card. A = compact (one text chip: `Lead` or the member name),
// B = fuller (a "Team" segment with a shape glyph, then the role or member name). The REAL SessionCard renders the
// REAL session-card-badge slot (STATUS subcard) for a lead, two teammates, a plain session and a session whose
// stamp was cleared (`teamId: null`): the last two show NO badge and NO empty STATUS subcard.
// Current pane = A, Proposed pane = B. Decide with:  mock-decide accept <this page> "A"   or   "B".
// See change: add-agent-teams-ui (design D6; tasks 1.7, 1.9).
import { LEAD_SESSION } from "../teams-fixtures";
import { ALICE, Card, CLEARED, hostFixtures, LEAD, MockHost, PLAIN, SCOUT } from "../teams-host";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const LONG = {
  ...ALICE,
  id: "5b2e9c40-71d8-4a3f-b0c6-92e1d4a7f358",
  name: "documentation-reviewer-2",
  "agent-teams": { teamId: "t-7k2m9q", member: "documentation-reviewer-2", role: "reviewer" },
} as unknown as DashboardSession;

// The card is an <li>; each ringed card gets its own <ul> so the ring wrapper never sits between a list and its item.
const one = (node: ReactNode) => <ul className="m-0 list-none p-0">{node}</ul>;
const ring = (side: "a" | "b", n: number, tip: string, node: ReactNode) =>
  side === "a" ? (
    <Issue n={n} tip={tip} block>{one(node)}</Issue>
  ) : (
    <Fix n={n} tip={tip} block>{one(node)}</Fix>
  );

function Column({ density, side }: { density: "compact" | "full"; side: "a" | "b" }) {
  return (
    <MockHost claims={{ badge: density }}>
      <div className="flex w-full max-w-[300px] flex-col gap-3 bg-[var(--bg-primary)] p-3">
        {ring(side, 1, side === "a" ? "Compact: Lead / name" : "Fuller: Team + role", <Card session={LEAD} selectedId={LEAD_SESSION} />)}
        {ring(side, 2, side === "a" ? "Name only" : "Team glyph + name", <Card session={SCOUT} />)}
        {one(<Card session={ALICE} />)}
        {one(<Card session={LONG} />)}
        {ring(side, 3, "Plain card: no badge", <Card session={PLAIN} />)}
        {one(<Card session={CLEARED} />)}
      </div>
    </MockHost>
  );
}

const mock: Mock = {
  title: "Session card - team badge density",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "Session cards - desktop column",
      width: 340,
      why: "Lead, teammates, a long member name, a plain card and a cleared stamp on the real card, A beside B.",
      current: <Column density="compact" side="a" />,
      proposed: <Column density="full" side="b" />,
    },
    {
      title: "Session cards - phone",
      phone: true,
      why: "At 375px the long member name must truncate inside the chip, never wrap the STATUS subcard.",
      current: <Column density="compact" side="a" />,
      proposed: <Column density="full" side="b" />,
    },
  ],
};
export default mock;
