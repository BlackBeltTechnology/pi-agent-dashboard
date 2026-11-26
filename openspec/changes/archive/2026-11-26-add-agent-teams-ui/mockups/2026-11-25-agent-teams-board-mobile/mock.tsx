// DECISION: task board on a phone. A = three side-by-side columns (scroll-snap, one column per swipe),
// B = grouped list (stacked sections with counts, each a disclosure, Completed folded by default).
// Current pane = A, Proposed pane = B. Same host shell, same fixtures (12 tasks, and the 50-task stress).
// Decide with:  mock-decide accept <this page> "A"   or   "B".
// See change: add-agent-teams-ui (design D10; tasks 1.4, 1.9).
import { LEAD_SESSION, snapshot, stressSnapshot } from "../teams-fixtures";
import { HostShell, hostFixtures, MockHost } from "../teams-host";
import { type Rings, TeamView } from "../teams-view";
import type { Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const snap = snapshot();
const stress = stressSnapshot();

const A: Rings = { side: "a", on: { board: { n: 1, tip: "Columns: swipe sideways" } } };
const B: Rings = { side: "b", on: { board: { n: 1, tip: "Grouped list: scroll down" } } };

const shell = (slot: ReactNode) => (
  <MockHost claims={{ badge: "compact" }}>
    <HostShell phone selectedId={LEAD_SESSION}>
      <div className="flex min-h-0 flex-1 flex-col">{slot}</div>
    </HostShell>
  </MockHost>
);

const view = (s: typeof snap, board: "columns" | "grouped", rings: Rings, openTaskIds?: string[]) => (
  <TeamView snap={s} layout="tabs" members="cards" board={board} narrow initialTab="tasks" rings={rings} openTaskIds={openTaskIds} sessionId={LEAD_SESSION} />
);

const mock: Mock = {
  title: "Team view - board on a phone",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "Board - phone, 12 tasks",
      phone: true,
      why: "Columns keep status spatial but hide two of three; the grouped list shows counts for all and folds Completed.",
      surroundings: shell,
      current: view(snap, "columns", A),
      proposed: view(snap, "grouped", B),
    },
    {
      title: "Board - phone, task details open",
      phone: true,
      why: "A blocked task with its dependency chips and a completed task with its result, disclosures open.",
      surroundings: shell,
      current: view(snap, "columns", A, ["6", "1"]),
      proposed: view(snap, "grouped", B, ["6", "1"]),
    },
    {
      title: "Board - phone, 50 tasks stress",
      phone: true,
      why: "50 tasks: a descendant scroller keeps every task reachable; the columns scroll per column.",
      surroundings: shell,
      current: view(stress, "columns", A),
      proposed: view(stress, "grouped", B),
    },
  ],
};
export default mock;
