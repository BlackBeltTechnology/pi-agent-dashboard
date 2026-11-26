// DECISION: desktop layout of the Team view. Variant A = three regions on desktop (members on top, tasks and
// messages side by side), variant B = tabs everywhere (Members, Tasks, Messages). Below `lg` both are the same
// tablist, so the choice only matters on desktop. There is no shipped Team view, so the Current pane shows
// variant A and the Proposed pane variant B (Issue rings = A, Fix rings = B). Both panes render the identical
// REAL host shell (ResizableSidebar + real SessionCards) around the slot (R1); the team data is the same fixture.
// Decide with:  mock-decide accept <this page> "A"   or   "B"   (note = chosen variant).
// See change: add-agent-teams-ui (design D1, D10; tasks 1.4, 1.9).
import { LEAD_SESSION, snapshot } from "../teams-fixtures";
import { ALICE, HostShell, hostFixtures, MockHost } from "../teams-host";
import { type Rings, TeamView } from "../teams-view";
import type { Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const snap = snapshot();

const A: Rings = {
  side: "a",
  on: {
    body: { n: 1, tip: "Members, tasks and messages at once" },
  },
};
const B: Rings = {
  side: "b",
  on: {
    tabs: { n: 1, tip: "Tablist: one section at a time" },
  },
};

const shell = (selectedId?: string, phone?: boolean) => (slot: ReactNode) => (
  <MockHost claims={{ badge: "compact" }}>
    <HostShell selectedId={selectedId} phone={phone}>
      <div className="flex min-h-0 flex-1 flex-col">{slot}</div>
    </HostShell>
  </MockHost>
);

const mock: Mock = {
  title: "Team view - desktop layout",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "Team view - desktop, lead session",
      width: 1010,
      why: "A: three regions at once. B: one section at a time behind tabs. Same host, same team (9 members, 12 tasks).",
      surroundings: shell(LEAD_SESSION),
      current: <TeamView snap={snap} layout="regions" members="cards" rings={A} sessionId={LEAD_SESSION} announce="alice is now working" />,
      proposed: <TeamView snap={snap} layout="tabs" members="cards" rings={B} sessionId={LEAD_SESSION} announce="alice is now working" />,
    },
    {
      title: "Team view - desktop, teammate session",
      width: 1010,
      why: "From a teammate the header names who is viewing; the same team renders and the sidebar card stays selected.",
      surroundings: shell(ALICE.id),
      current: <TeamView snap={snap} layout="regions" members="cards" rings={A} viewedFrom="alice" sessionId={ALICE.id} />,
      proposed: <TeamView snap={snap} layout="tabs" members="cards" rings={B} viewedFrom="alice" sessionId={ALICE.id} initialTab="tasks" />,
    },
    {
      title: "Team view - desktop, Messages in B",
      width: 1010,
      why: "B shows the log with the full panel height; A gives it half the width. Same 40 mail rows.",
      surroundings: shell(LEAD_SESSION),
      current: <TeamView snap={snap} layout="regions" members="cards" rings={A} sessionId={LEAD_SESSION} />,
      proposed: <TeamView snap={snap} layout="tabs" members="cards" rings={B} sessionId={LEAD_SESSION} initialTab="messages" newMessages />,
    },
    {
      title: "Team view - phone, one tablist",
      phone: true,
      why: "Below lg both variants collapse to the same tablist: Members, Tasks, Messages (≥ 44 px targets, wraps).",
      steps: [
        { label: "Members", proposed: <TeamView snap={snap} layout="tabs" members="cards" narrow sessionId={LEAD_SESSION} /> },
        { label: "Tasks", proposed: <TeamView snap={snap} layout="tabs" members="cards" narrow initialTab="tasks" sessionId={LEAD_SESSION} /> },
        { label: "Messages", proposed: <TeamView snap={snap} layout="tabs" members="cards" narrow initialTab="messages" sessionId={LEAD_SESSION} /> },
      ],
      surroundings: shell(LEAD_SESSION, true),
    },
    {
      title: "Team view - keyboard on the tablist",
      width: 520,
      why: "Real keys on the real tablist: ArrowRight moves focus and selection from Tasks to Messages.",
      surroundings: shell(LEAD_SESSION, true),
      proposed: <TeamView snap={snap} layout="tabs" members="cards" narrow initialTab="tasks" sessionId={LEAD_SESSION} />,
      script: [
        { say: "Focus the Tasks tab", target: "#tab-tasks", act: "click" },
        { say: "ArrowRight selects Messages", target: "#tab-tasks", act: "press", key: "ArrowRight", expect: (d) => d.querySelector("#tab-messages")?.getAttribute("aria-selected") === "true" },
        { say: "Home jumps back to Members", target: "#tab-messages", act: "press", key: "Home", expect: (d) => d.querySelector("#tab-members")?.getAttribute("aria-selected") === "true" },
      ],
    },
  ],
};
export default mock;
