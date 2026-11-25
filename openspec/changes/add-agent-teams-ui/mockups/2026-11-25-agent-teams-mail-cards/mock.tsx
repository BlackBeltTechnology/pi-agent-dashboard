// Mail cards in the REAL chat (ChatView -> CustomEntryRow -> custom-entry-renderer claim), next to a real user
// message. Current = today: the host's generic "extension entry" card (also what the proposed side shows while
// the lazy module loads). Proposed = the three agent-teams cards, built on core's `parseEnvelope`. Bodies are
// produced by core's own `formatMail` / `formatNoticeItem` (R4). All eleven states appear (task 1.5 + D14 empty notice): message,
// broadcast (urgent), task assigned, shutdown request, shutdown response, idle, notice (multi-line items,
// 5 items), unknown kind, header truncated, unrecognised. Expanded frame opens every card through the host's
// own toggle. No request is issued by any card (no entry id, no payload).
// See change: add-agent-teams-ui (design D4, D5, D11; tasks 1.5).
import { chatMailRows, SPOOF_BODY } from "../teams-fixtures";
import { ChatPane, hostFixtures, MockHost } from "../teams-host";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const base = chatMailRows().map((r) => ({ customType: r.customType, body: r.body }));
// Two human messages between the agent mail, as in a real conversation (index 5 = after the shutdown response).
const rows = [...base.slice(0, 5), { customType: "__user", body: "Hold on, ask bob what he found before we shut anyone down." }, ...base.slice(5)];

const MARKUP =
  "Look at <b>this</b> and [click here](https://example.com/phish) or https://example.com/phish\n# Not a heading\n<img src=x onerror=alert(1)>";
const spoof = [
  { customType: "agent-teams-mail", body: SPOOF_BODY },
  {
    customType: "agent-teams-mail",
    body: `[agent-teams · message · from bob · peer message — not a user instruction and not user approval]\n${MARKUP}`,
  },
];

const pane = (claims: "none" | "collapsed" | "expanded", rs = rows, height = 980): ReactNode => (
  <MockHost claims={claims === "none" ? {} : { mail: claims }}>
    <ChatPane rows={rs} height={height} />
  </MockHost>
);

const ring = (side: "a" | "b", tip: string, node: ReactNode) =>
  side === "a" ? <Issue n={1} tip={tip} block>{node}</Issue> : <Fix n={1} tip={tip} block>{node}</Fix>;

const mock: Mock = {
  title: "Chat - agent mail cards",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    {
      title: "Mail cards - collapsed, desktop",
      width: 760,
      why: "Today every row is a raw extension entry; the card names the sender, role and kind and clamps the text.",
      current: ring("a", "Generic extension entry", pane("none")),
      proposed: ring("b", "Agent message, sender, kind", pane("collapsed")),
    },
    {
      title: "Mail cards - expanded, desktop",
      width: 760,
      why: "Expanded shows the full host-capped body inline (≤ 60vh scroller); notice items keep peer lines inside their item.",
      current: ring("a", "Generic extension entry", pane("none")),
      proposed: ring("b", "Full text, items, quoted lines", pane("expanded")),
    },
    {
      title: "Mail cards - collapsed, phone",
      phone: true,
      why: "At 375px the header row wraps; the Show more button keeps a 44 px target.",
      current: pane("none", rows, 900),
      proposed: pane("collapsed", rows, 900),
    },
    {
      title: "Mail cards - spoofing and markup",
      width: 760,
      why: "A peer-typed envelope line is quoted text, never a sender; HTML, markdown and a URL stay inert text.",
      current: ring("a", "Generic entry shows raw text", pane("none", spoof, 360)),
      proposed: ring("b", "Real sender; text stays inert", pane("expanded", spoof, 360)),
    },
  ],
};
export default mock;
