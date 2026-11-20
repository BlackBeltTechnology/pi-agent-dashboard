// Explore-mode live mock: queued steers grouped, with an explicit MERGE action that joins
// them into ONE steer, so they arrive as one user message at the next turn.
// Premise (explore findings): pi's `steeringMode` defaults to "one-at-a-time"
// (pi-coding-agent settings-defaults.js; agent-core PendingMessageQueue.drain()), and the
// bridge mirrors it (packages/extension/src/bridge-handlers/lifecycle.ts handOffHeldSteers:
// `bridgeSteer.take(mode)`). 4 queued steers -> >= 4 turns. Merge = bridge replaces the N
// held entries with one entry whose text is the N texts joined by a blank line.
//
// Picked look (user rejected the merged numbered card B, and E/F): "D" = today's bubbles
// kept, ONE shared "Steering · N" label instead of a header per bubble, tight gap.
// Merge sits beside Clear all (from 2 entries on). After merge: a plain single steer bubble,
// identical to today's single PendingSteerCard.
//
// Grounding: bubble/control class strings copied from PendingSteerCard.tsx and
// queue-control-classes.ts (imported). `steered` badge copied from ChatView.tsx
// StreamingBehaviorBadge. MarkdownContent needs ThemeProvider (fights the mock-site theme
// switch), so text uses the `Md` stand-in, identical in every pane.

import { ToggleField } from "@blackbelt-technology/dashboard-plugin-runtime";
import { QUEUE_CLEAR_ALL_CLASS, QUEUE_REMOVE_BUTTON_CLASS } from "@app/components/chat/queue-control-classes.ts";
import { mdiCallMerge, mdiCallSplit, mdiClose, mdiCloseCircleOutline, mdiLoading, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock, Tap } from "mock-site/kit";
import { type ReactNode, useState } from "react";

type Steer = { id: string; text: string };

// Real steers from the session that prompted this idea.
const STEERS: Steer[] = [
  { id: "s1", text: "also why can we only see the accounts that are oauth? litellm should have ALL that is API required set up on startup! ALL!" },
  { id: "s2", text: "add to connect and add filter where users can type in!" },
  { id: "s3", text: "And for the native apps why not use an already made widget manager of each os, don't write it yourself" },
  { id: "s4", text: "also app should have the key icon on the trays" },
];
const merge = (xs: Steer[]): Steer => ({ id: "merged", text: xs.map((x) => x.text).join("\n\n") });

// Exact class strings of PendingSteerCard.tsx (BUBBLE_CLASS + header row).
const BUBBLE = "relative bg-[var(--tint-blue-bg)] border border-[var(--tint-blue-border)] border-l-2 border-l-[var(--accent-blue)] rounded-xl shadow-md px-4 py-2";
const HEADER = "flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-[var(--accent-blue-text)] font-medium";
// ChatView.tsx StreamingBehaviorBadge.
const STEERED_BADGE = "inline-flex items-center self-end mb-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300/80";

function Md({ content }: { content: string }) {
  return <div className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">{content}</div>;
}

function RemoveBtn({ id, onCancel }: { id: string; onCancel?: (id: string) => void }) {
  return (
    <button type="button" data-testid={`cancel-${id}`} onClick={() => onCancel?.(id)} aria-label="Cancel steer" title="Cancel" className={QUEUE_REMOVE_BUTTON_CLASS}>
      <Icon path={mdiClose} size={0.65} />
    </button>
  );
}
function ClearAll({ onClear }: { onClear?: () => void }) {
  return (
    <button type="button" data-testid="clear-all" onClick={onClear} aria-label="Clear all steering entries" className={QUEUE_CLEAR_ALL_CLASS}>
      <Icon path={mdiCloseCircleOutline} size={0.6} aria-hidden="true" />
      Clear all
    </button>
  );
}
// New control: same class as Clear all so the pair reads as one toolbar.
function MergeBtn({ n, onMerge }: { n: number; onMerge?: () => void }) {
  return (
    <button type="button" data-testid="merge-steers" onClick={onMerge} aria-label={`Merge ${n} steers into one message`}
      title="Send as one message" className={QUEUE_CLEAR_ALL_CLASS}>
      <Icon path={mdiCallMerge} size={0.6} aria-hidden="true" />
      Merge {n}
    </button>
  );
}

// Toggle partner of Merge: restores the original steers (bridge keeps them on the merged entry).
function SplitBtn({ n, onSplit }: { n: number; onSplit?: () => void }) {
  return (
    <button type="button" data-testid="split-steers" onClick={onSplit} aria-label={`Split back into ${n} steers`}
      title="Send as separate messages" className={QUEUE_CLEAR_ALL_CLASS}>
      <Icon path={mdiCallSplit} size={0.6} aria-hidden="true" />
      Split {n}
    </button>
  );
}

// ---- A (today): a header on every bubble ----
function TodayBubble({ s }: { s: Steer }) {
  return (
    <div className="flex justify-end">
      <div className={`${BUBBLE} max-w-[80%]`}>
        <div className={HEADER}><Icon path={mdiLoading} size={0.45} className="animate-spin" />Steering</div>
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0"><Md content={s.text} /></div>
          <div className="flex items-center gap-0.5 flex-shrink-0"><RemoveBtn id={s.id} /></div>
        </div>
      </div>
    </div>
  );
}
function Today({ steers, ring }: { steers: Steer[]; ring?: boolean }) {
  const list = <div className="flex flex-col gap-3">{steers.map((s) => <TodayBubble key={s.id} s={s} />)}</div>;
  return (
    <>
      {ring ? <Issue n={1} tip="Each one waits a whole turn" block>{list}</Issue> : list}
      <div className="flex justify-end mt-1"><ClearAll /></div>
    </>
  );
}

// ---- proposed: grouped bubbles + Merge ----
function GroupLabel({ n, merged }: { n: number; merged?: boolean }) {
  return (
    <div className={`${HEADER} justify-end mb-0`}>
      <Icon path={mdiLoading} size={0.45} className="animate-spin" />
      {merged ? "Steering · merged" : n > 1 ? `Steering · ${n}` : "Steering"}
      <span className="normal-case tracking-normal text-[11px] font-normal text-[var(--text-tertiary)]">· sends after this turn</span>
    </div>
  );
}
function BareBubble({ s, onCancel }: { s: Steer; onCancel?: (id: string) => void }) {
  return (
    <div className="flex justify-end">
      <div data-testid={`steer-${s.id}`} className={`${BUBBLE} max-w-[80%] py-1.5`}>
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0"><Md content={s.text} /></div>
          <div className="flex items-center gap-0.5 flex-shrink-0"><RemoveBtn id={s.id} onCancel={onCancel} /></div>
        </div>
      </div>
    </div>
  );
}
function Grouped({ steers, merged, mergedCount = 0, ring, tapMerge, onCancel, onMerge, onSplit, onClear }: {
  steers: Steer[]; merged?: boolean; mergedCount?: number; ring?: boolean; tapMerge?: boolean;
  onCancel?: (id: string) => void; onMerge?: () => void; onSplit?: () => void; onClear?: () => void;
}) {
  if (steers.length === 0) return <div data-testid="steers-empty" className="text-xs text-[var(--text-tertiary)] text-right">No queued steers.</div>;
  const label = <GroupLabel n={steers.length} merged={merged} />;
  const list = <div className="flex flex-col gap-1">{steers.map((s) => <BareBubble key={s.id} s={s} onCancel={onCancel} />)}</div>;
  const mergeBtn = merged
    ? <SplitBtn n={mergedCount} onSplit={onSplit} />
    : steers.length >= 2 ? <MergeBtn n={steers.length} onMerge={onMerge} /> : null;
  const tapped = mergeBtn && tapMerge ? <Tap>{mergeBtn}</Tap> : mergeBtn;
  return (
    <div className="flex flex-col gap-1.5">
      {ring ? <Fix n={1} tip="One label for the group" block>{label}</Fix> : label}
      {ring ? <Fix n={2} tip="Own bubbles, tight gap" block>{list}</Fix> : list}
      <div className="flex justify-end items-center gap-1">
        {ring && tapped ? <Fix n={3} tip="Merge into one message">{tapped}</Fix> : tapped}
        {steers.length >= 2 ? <ClearAll onClear={onClear} /> : null}
      </div>
    </div>
  );
}

// ---- shared surroundings (identical in both panes) ----
function StreamingRow() {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1 flex-1 max-w-[50%] rounded-full bg-gradient-to-r from-transparent to-[var(--bg-tertiary)]" />
      <button type="button" className="inline-flex items-center gap-1 rounded border border-[var(--accent-red)] px-2 py-0.5 text-xs text-[var(--accent-red-text)]">
        <Icon path={mdiStop} size={0.5} /> Stop
      </button>
    </div>
  );
}
function Assistant({ text }: { text: string }) {
  return <div className="max-w-[85%] text-[var(--text-secondary)]"><Md content={text} /></div>;
}
const Shell = ({ children, phone }: { children: ReactNode; phone?: boolean }) => (
  <div className={`flex flex-col gap-3 bg-[var(--bg-primary)] ${phone ? "p-3" : "p-4"}`}>{children}</div>
);
const Queued = ({ body, phone }: { body: ReactNode; phone?: boolean }) => (
  <Shell phone={phone}>
    <Assistant text="Wiring the LiteLLM provider list into the Connect dialog. Running the provider tests now." />
    <StreamingRow />
    {body}
  </Shell>
);

// ---- after hand-off ----
function Delivered({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className={STEERED_BADGE}>steered</span>
      <div className={`${BUBBLE} max-w-[80%]`}><Md content={text} /></div>
    </div>
  );
}
const REPLIES = [
  "Right, only OAuth accounts are listed. Seeding every API-key provider at startup.",
  "Adding a type-to-filter box to Connect.",
  "Switching the native tray to the OS widget toolkit instead of a custom one.",
  "Setting the key icon as the tray icon.",
];
function AfterSeparate() {
  return (
    <Shell>
      <Issue n={1} tip="4 turns, one steer each" block>
        <div className="flex flex-col gap-3">
          {STEERS.map((s, i) => (
            <div key={s.id} className="flex flex-col gap-3">
              <Delivered text={s.text} />
              <Assistant text={`(turn ${i + 1}) ${REPLIES[i]}`} />
            </div>
          ))}
        </div>
      </Issue>
    </Shell>
  );
}
function AfterMerged() {
  return (
    <Shell>
      <Fix n={1} tip="1 message, 1 turn, all 4 seen" block>
        <div className="flex flex-col gap-3">
          <Delivered text={merge(STEERS).text} />
          <Assistant text={"Got 4 changes, working through them in order:\n1. Seed every API-key provider at startup.\n2. Type-to-filter in Connect.\n3. OS widget toolkit for the tray.\n4. Key icon on the tray."} />
        </div>
      </Fix>
    </Shell>
  );
}

// ---- scripted: merge, split back, merge again, cancel ----
function LiveMerge() {
  const [steers, setSteers] = useState(STEERS);
  const [parts, setParts] = useState<Steer[] | null>(null); // originals kept while merged
  return (
    <Queued body={
      <Grouped steers={steers} merged={parts !== null} mergedCount={parts?.length ?? 0}
        onCancel={(id) => { setSteers((xs) => xs.filter((x) => x.id !== id)); if (id === "merged") setParts(null); }}
        onMerge={() => { setParts(steers); setSteers([merge(steers)]); }}
        onSplit={() => { if (parts) setSteers(parts); setParts(null); }}
        onClear={() => { setSteers([]); setParts(null); }} />
    } />
  );
}

// ---- Settings > Sessions: default merge behaviour ----
// Section = exact markup of SettingsPanel.tsx local `Section` (not exported).
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
const noop = () => {};
const AUTO_MERGE_HINT = "Steers you send while the agent is working are joined into one message for the next turn. Off sends them one per turn. You can always Merge or Split in the chat.";
function AutoMergeField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleField label="Merge queued steers automatically" value={value} onChange={onChange}
      hint={AUTO_MERGE_HINT} testIds={{ control: "auto-merge-toggle" }} />
  );
}
// Neighbouring rows copied from SettingsPanel.tsx Sessions tab (Session list section), for context.
function SessionsTab({ variant }: { variant: "current" | "proposed" }) {
  return (
    <div className="flex flex-col gap-6 p-4 bg-[var(--bg-primary)]">
      <Section title="Session list">
        <ToggleField label="Put completed session first" value={false} onChange={noop}
          hint="When a session finishes a turn or ends, move its card to the top of its tier (active, resp. ended). Off keeps the card in place." />
        <ToggleField label="Put question session first" value={false} onChange={noop}
          hint="When a session asks a question (ask_user), move its card to the top of the active tier. Off keeps the card in place." />
      </Section>
      {variant === "proposed" ? (
        <Fix n={1} tip="New section, off by default" block>
          <Section title="Steering"><AutoMergeField value={false} onChange={noop} /></Section>
        </Fix>
      ) : null}
      <Section title="Lifecycle & recovery">
        <div className="text-xs text-[var(--text-tertiary)]">...</div>
      </Section>
    </div>
  );
}

// Live: flip the setting, the queued steers re-render merged (Split) or separate (Merge).
function LiveSetting() {
  const [auto, setAuto] = useState(false);
  const view = auto
    ? <Grouped steers={[merge(STEERS)]} merged mergedCount={STEERS.length} />
    : <Grouped steers={STEERS} />;
  return (
    <div className="flex flex-col gap-4 bg-[var(--bg-primary)] p-4">
      <Section title="Steering"><AutoMergeField value={auto} onChange={setAuto} /></Section>
      <div data-testid={auto ? "view-merged" : "view-separate"} className="rounded-xl border border-[var(--border-secondary)]">
        <Queued body={view} />
      </div>
    </div>
  );
}

const mock: Mock = {
  title: "Chat - queued steers: group + merge",
  category: "Chat",
  frames: [
    { title: "Queued steers - today vs grouped + Merge", width: 900, why: "Same bubbles, one label, and a Merge button that sends them as one message.",
      current: <Queued body={<Today steers={STEERS} ring />} />, proposed: <Queued body={<Grouped steers={STEERS} ring />} /> },
    { title: "Settings - Sessions - Steering", width: 760, why: "New Steering section: one switch sets whether queued steers merge by default.",
      current: <SessionsTab variant="current" />, proposed: <SessionsTab variant="proposed" /> },
    { title: "Setting on vs off", width: 760, why: "On: steers arrive merged with Split. Off: separate with Merge.",
      proposed: <LiveSetting />,
      script: [
        { say: "Off: 4 separate steers, Merge button", act: "wait", target: "merge-steers", expect: "view-separate" },
        { say: "Turn auto-merge on", target: "auto-merge-toggle", act: "click" },
        { say: "On: one merged steer, Split button", act: "wait", target: "split-steers", expect: "view-merged" },
        { say: "Turn it off again", target: "auto-merge-toggle", act: "click" },
        { say: "Back to separate", act: "wait", target: "merge-steers", expect: "view-separate" },
      ] },
    { title: "Merge flow", width: 700, why: "Merge joins the steers into one; it goes as one message next turn.",
      steps: [
        { label: "4 queued", proposed: <Queued body={<Grouped steers={STEERS} tapMerge />} /> },
        { label: "merged", proposed: <Queued body={<Grouped steers={[merge(STEERS)]} merged mergedCount={STEERS.length} />} /> },
        { label: "delivered", proposed: <AfterMerged /> },
      ] },
    { title: "After hand-off - transcript", width: 900, why: "Separate steers leave 4 steer and reply pairs; merged leaves 1.",
      current: <AfterSeparate />, proposed: <AfterMerged /> },
    { title: "Phone", phone: true, why: "At 375px the bubbles wrap; Merge and Clear all stay 44px targets.",
      current: <Queued phone body={<Today steers={STEERS} />} />, proposed: <Queued phone body={<Grouped steers={STEERS} />} /> },
    { title: "Merge / Split toggle", width: 700, why: "Merge joins them, Split restores the originals, until the turn ends.",
      proposed: <LiveMerge />,
      script: [
        { say: "Merge the 4 steers", target: "merge-steers", act: "click" },
        { say: "One merged steer, button is now Split", act: "wait", target: "split-steers", expect: "steer-merged" },
        { say: "Split them again", target: "split-steers", act: "click" },
        { say: "Back to 4 steers", act: "wait", target: "steer-s4", expect: "merge-steers" },
        { say: "Merge again", target: "merge-steers", act: "click" },
        { say: "Merged", act: "wait", target: "steer-merged", expect: "steer-merged" },
        { say: "Cancel it", target: "cancel-merged", act: "click" },
        { say: "Nothing queued", act: "wait", target: "steers-empty", expect: "steers-empty" },
      ] },
  ],
};
export default mock;
