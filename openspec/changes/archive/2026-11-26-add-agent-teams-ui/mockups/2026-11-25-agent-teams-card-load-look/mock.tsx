// DECISION: entry card eager or lazy look (design D9). LAZY (A): the first mail row after page load shows the host's
// generic "extension entry" card for one chunk fetch, then swaps to the team card. EAGER (B): the team card is
// there from first paint (costs cold-chunk budget, allowed only if it fits including its strings).
// Current pane = A's FIRST PAINT, Proposed pane = B. The second frame plays A's swap in one pane (reduced motion:
// side by side). Same real CustomEntryRow in both. Decide with:  mock-decide accept <this page> "lazy"  or  "eager".
// See change: add-agent-teams-ui (design D9; test-plan S84; tasks 1.5, 1.9).
import { chatMailRows } from "../teams-fixtures";
import { hostFixtures, MailRow, MockHost } from "../teams-host";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const all = chatMailRows();
const pick = ["message", "notice (5 items)", "idle"].map((l) => all.find((r) => r.label === l)!);

const rows = (claims: "none" | "collapsed") => (
  <MockHost claims={claims === "none" ? {} : { mail: "collapsed" }}>
    <div className="flex flex-col gap-1 bg-[var(--bg-primary)] py-3 text-[var(--text-primary)]">
      {pick.map((r) => (
        <MailRow key={r.label} customType={r.customType} body={r.body} />
      ))}
    </div>
  </MockHost>
);

const ring = (side: "a" | "b", tip: string, node: ReactNode) =>
  side === "a" ? <Issue n={1} tip={tip} block>{node}</Issue> : <Fix n={1} tip={tip} block>{node}</Fix>;

const mock: Mock = {
  title: "Chat - card load look",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "First paint - lazy or eager",
      width: 720,
      why: "A: generic entry for one chunk fetch. B: the team card at once. Same three rows.",
      current: ring("a", "Lazy: generic card first", rows("none")),
      proposed: ring("b", "Eager: team card at once", rows("collapsed")),
    },
    {
      title: "Lazy swap - what the user sees",
      width: 720,
      play: true,
      why: "The generic card is replaced in place by the team card; no duplicate row, no blank frame.",
      steps: [
        { label: "chunk loading", proposed: rows("none") },
        { label: "chunk ready", proposed: rows("collapsed") },
      ],
    },
  ],
};
export default mock;
