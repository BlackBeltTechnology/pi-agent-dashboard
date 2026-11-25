// Every Team view state of the specs (task 1.8), each inside the same real host shell: loading skeleton, no team,
// not found, error with no snapshot, error with a stale snapshot, starting, orphaned, closing, closed,
// persist_degraded, degraded member, empty sections (members / tasks / messages), inline Stop errors (403 permission,
// 409 not_busy, 15 s no-response), the Shut down confirmation, a viewer without control, the 50-task / 10-member
// stress fixture and the long-text fixture. Layout shown is the tablist (B); every state also holds for A.
// New surface: panes are labelled "New" (no Current). No decision on this page.
// See change: add-agent-teams-ui (specs team-view "Every state renders something"; tasks 1.3, 1.8).
import { LEAD_SESSION, longTextSnapshot, MEMBERS, snapshot, stressSnapshot, TASKS } from "../teams-fixtures";
import { HostShell, hostFixtures, MockHost } from "../teams-host";
import { TeamView, type TeamViewProps } from "../teams-view";
import type { Frame, Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const shell = (phone?: boolean) => (slot: ReactNode) => (
  <MockHost claims={{ badge: "compact" }}>
    <HostShell phone={phone} selectedId={LEAD_SESSION}>
      <div className="flex min-h-0 flex-1 flex-col">{slot}</div>
    </HostShell>
  </MockHost>
);

const view = (p: Partial<TeamViewProps> & { snap: TeamViewProps["snap"] }) => <TeamView layout="tabs" members="cards" sessionId={LEAD_SESSION} {...p} />;

const f = (title: string, why: string, proposed: ReactNode, extra: Partial<Frame> = {}): Frame =>
  ({ title, why, width: 900, surroundings: shell(), proposed, ...extra }) as Frame;

const heidi = MEMBERS.filter((m) => m.name === "heidi" || m.name === "bob");
const noControl = snapshot({ viewerCanControl: false });

const mock: Mock = {
  title: "Team view - every state",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    f("State - loading", "Skeleton with aria-busy and a status label; never a bare 'Loading…'.", view({ snap: null, state: "loading" })),
    f("State - no team", "Session belongs to no visible team: identical for a hidden team (no existence oracle).", view({ snap: null, state: "none" })),
    f("State - not found", "Only after a resolved team later answers 404: the cache is dropped.", view({ snap: null, state: "notFound" })),
    f("State - error, nothing cached", "First load failed: an error notice with Retry, never an empty state.", view({ snap: null, state: "error" })),
    f("State - error, stale snapshot", "A refresh failed: the last snapshot stays, with a stale notice and Retry.", view({ snap: snapshot(), state: "error", initialTab: "tasks" })),
    f("State - starting", "Lead bound, no member yet: a starting pill, empty sections, Shut down team still offered.", view({ snap: snapshot({ status: "starting", members: [], tasks: [], mail: [] }) })),
    f("State - orphaned", "Lead ended: static copy, no countdown; teammates still shown and Stop still works.", view({ snap: snapshot({ status: "orphaned" }) })),
    f("State - closing", "Shutdown in progress: pill, notice, Stop and Shut down off, Closing… disabled.", view({ snap: snapshot({ status: "closing", closeReason: "user" }) })),
    f("State - closed", "Read-only: no Stop, no Shut down; history stays readable.", view({ snap: snapshot({ status: "closed", closeReason: "user" }), initialTab: "messages" })),
    f("State - persist degraded", "The team file could not be saved: a warning that changes may not survive a restart.", view({ snap: snapshot({ persistDegraded: true }) })),
    f("State - degraded member", "A member without its safety guard: a text notice naming the condition, not colour alone.", view({ snap: snapshot({ members: heidi }) })),
    f("State - inline Stop errors", "403 permission, 409 not_busy and the 15 s no-response, each at its own button, no toast.", view({ snap: snapshot(), notes: { alice: "forbidden", scout: "not_busy", heidi: "no_response" } })),
    f("State - Shut down confirmation", "Drawn inline (ui:confirm-dialog portals to body): states the lead session stays open; Cancel is the safe default.", view({ snap: snapshot(), confirm: true })),
    f("State - viewer without control", "viewerCanControl false: no Stop, no Shut down anywhere.", view({ snap: noControl })),
    {
      title: "State - empty sections",
      why: "No members, no tasks, no messages: each section says what is empty and why.",
      phone: true,
      surroundings: shell(true),
      steps: [
        { label: "no members", proposed: view({ snap: snapshot({ status: "starting", members: [], tasks: TASKS, mail: [] }), narrow: true }) },
        { label: "no tasks", proposed: view({ snap: snapshot({ tasks: [] }), narrow: true, initialTab: "tasks" }) },
        { label: "no messages", proposed: view({ snap: snapshot({ mail: [] }), narrow: true, initialTab: "messages" }) },
      ],
    } as Frame,
    f("Stress - 10 members, 50 tasks", "A descendant scroller keeps all 50 tasks reachable; counts in the tabs stay legible.", view({ snap: stressSnapshot(), initialTab: "tasks" })),
    f("Stress - message log tail", "100 shown of 5000, a vanished member filter reset with a note, and the New messages control.", view({ snap: stressSnapshot(), initialTab: "messages", logFilter: "worker-11", newMessages: true })),
    f("Long text - tasks and members", "400-character unbroken tokens and a very long role wrap; nothing widens the page.", view({ snap: longTextSnapshot(), initialTab: "tasks", openTaskIds: ["1", "3"] })),
    f("Long text - phone, 320px content", "Unbroken tokens at phone width: no horizontal page scroll.", view({ snap: longTextSnapshot(), narrow: true, initialTab: "members" }), { phone: true, width: undefined, surroundings: shell(true) }),
  ],
};
export default mock;
