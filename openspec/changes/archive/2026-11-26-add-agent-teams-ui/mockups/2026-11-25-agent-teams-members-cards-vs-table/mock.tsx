// DECISION: members as cards (A) or as a dense table (B). Current pane = A (cards, `<ul>` of cards), Proposed
// pane = B (runtime-kit `SettingsTable`, scrolls sideways instead of widening the page). Same host shell, same
// data (9 members in every status, plus a 10-member stress frame), Members section only so the comparison is
// not diluted. Decide with:  mock-decide accept <this page> "A"   or   "B".
// See change: add-agent-teams-ui (design D10; tasks 1.4, 1.9).
import { LEAD_SESSION, snapshot, stressSnapshot } from "../teams-fixtures";
import { HostShell, hostFixtures, MockHost } from "../teams-host";
import { type Rings, TeamView } from "../teams-view";
import type { Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const snap = snapshot();
const stress = stressSnapshot();

const A: Rings = { side: "a", on: { members: { n: 1, tip: "Cards: name, status, task, actions" } } };
const B: Rings = { side: "b", on: { members: { n: 1, tip: "Table: one row per member" } } };

const shell = (phone?: boolean) => (slot: ReactNode) => (
  <MockHost claims={{ badge: "compact" }}>
    <HostShell phone={phone} selectedId={LEAD_SESSION}>
      <div className="flex min-h-0 flex-1 flex-col">{slot}</div>
    </HostShell>
  </MockHost>
);

const view = (s: typeof snap, members: "cards" | "table", rings: Rings, narrow?: boolean) => (
  <TeamView snap={s} layout="tabs" members={members} rings={rings} narrow={narrow} sessionId={LEAD_SESSION} />
);

const mock: Mock = {
  title: "Team view - members cards or table",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "Members - desktop, 9 members",
      width: 1010,
      why: "Cards give each member room for its task and Stop; the table fits more rows but cramps the task cell.",
      surroundings: shell(),
      current: view(snap, "cards", A),
      proposed: view(snap, "table", B),
    },
    {
      title: "Members - desktop, 10 members stress",
      width: 1010,
      why: "10 members with 50 tasks behind them: how far the eye travels to find the busy ones.",
      surroundings: shell(),
      current: view(stress, "cards", A),
      proposed: view(stress, "table", B),
    },
    {
      title: "Members - phone",
      phone: true,
      why: "375px: cards stack one per row; the table scrolls sideways inside its own bordered wrapper.",
      surroundings: shell(true),
      current: view(snap, "cards", A, true),
      proposed: view(snap, "table", B, true),
    },
  ],
};
export default mock;
