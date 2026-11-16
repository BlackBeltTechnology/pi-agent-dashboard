// Explore-mode live mock: cancellable steer bubbles (per-entry + bulk) and an
// attached-image marker on pending steers. Issues #1132, #1133.
// Premise (explore findings): the bridge HOLDS dashboard steers and commits them to
// pi inside the awaited `turn_end` handler (agent-loop.js L184-191, before
// steeringQueue.drain()). Until commit, cancel = remove from the bridge buffer,
// exactly like the follow-up buffer. After commit the entry is pi-owned -> no cancel.
//
// Grounding (cancel controls copy the SHIPPED follow-up ones, no new styles):
// - Steer bubble markup: ChatView.tsx L2652-2660 (inline JSX -> PROMOTE extracts `PendingSteerCard`).
// - Per-entry cancel: QueuePanel.tsx follow-up row = `flex items-start gap-1.5`, text `flex-1`,
//   right action cluster `flex items-center gap-0.5 flex-shrink-0`, remove = mdiClose w-6 h-6
//   `hover:text-red-400` (`queue-followup-remove`).
// - Image marker: QueuePanel.tsx `queue-followup-attachments` (mdiImageMultipleOutline + count).
// - Bulk cancel: QueueLane.tsx `queue-followup-clear-all` = "Clear all", mdiCloseCircleOutline,
//   `focus-ring ... max-md:min-h-11`, shown from 2 entries on.
// - Delivered user bubble + `steered` badge: ChatView.tsx L2337-2340 / L334-348.
// Real components: ComposerDock + buildQueueLane (today's follow-up surface).
// MarkdownContent needs ThemeProvider (useTheme writes data-theme on <html>, fighting the
// mock-site theme switch), so bubble text uses `Md`: identical in both panes, not ringed.

import { ComposerDock } from "@app/components/chat/ComposerDock.tsx";
import { buildQueueLane } from "@app/components/chat/QueueLane.tsx";
import { mdiClose, mdiCloseCircleOutline, mdiImageMultipleOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock, Tap } from "mock-site/kit";
import { type ReactNode, useState } from "react";

type Steer = { id: string; text: string; imageCount: number };
type Variant = "current" | "proposed";

const STEERS: Steer[] = [
  { id: "s1", text: "Use the existing `followup-buffer.ts` helper instead of adding a second queue.", imageCount: 0 },
  { id: "s2", text: "Also check this screenshot: the badge overlaps the send button on mobile.", imageCount: 2 },
];
const FOLLOWUP = [
  { text: "When done, run `npm run quality:changed` and summarise the diff.", imageCount: 0 },
  { text: "Then open a PR against develop.", imageCount: 0 },
];
const noop = () => {};

/** Stand-in for MarkdownContent: plain prose + `inline code`, identical in both panes. */
function Md({ content }: { content: string }) {
  return (
    <div className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
      {content.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? <code key={i} className="px-1 rounded bg-[var(--bg-tertiary)] text-[0.85em]">{part.slice(1, -1)}</code> : part)}
    </div>
  );
}

// Exact class strings of the shipped follow-up controls.
const bubble = "relative bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2";
const removeBtn = "inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-red-400 hover:bg-[var(--bg-hover)] transition-colors";
const clearAllBtn = "focus-ring inline-flex min-h-6 min-w-6 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:min-w-11 max-md:justify-center";

// ---- steer bubble ----
function ImageBadge({ count }: { count: number }) {
  return (
    <span data-testid="pending-steer-attachments" title="Attached images"
      className="inline-flex items-center gap-1 self-start text-[10px] text-[var(--text-tertiary)]">
      <Icon path={mdiImageMultipleOutline} size={0.55} />
      {count}
    </span>
  );
}

function SteerBubble({ s, variant, ring, phase = "queued", onCancel }: {
  s: Steer; variant: Variant; ring?: boolean; phase?: "queued" | "delivering"; onCancel?: (id: string) => void;
}) {
  const header = (
    <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-blue-400/80 font-medium">
      <Icon path={mdiLoading} size={0.45} className="animate-spin" />
      {phase === "delivering" ? "Delivering" : "Steering"}
    </div>
  );
  if (variant === "current") {
    const body = <Md content={s.text} />;
    return (
      <div data-testid="pending-steer-card" className="mt-4 mb-4 flex justify-end">
        <div className={`${bubble} max-w-[80%]`}>
          {header}
          {ring ? <Issue n={1} tip="No image marker, no cancel" block>{body}</Issue> : body}
        </div>
      </div>
    );
  }
  const badge = s.imageCount > 0 ? <ImageBadge count={s.imageCount} /> : null;
  const actions = phase === "queued" ? (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button type="button" data-testid={`pending-steer-cancel-${s.id}`} onClick={() => onCancel?.(s.id)}
        aria-label="Cancel steer" title="Cancel" className={removeBtn}>
        <Icon path={mdiClose} size={0.65} />
      </button>
    </div>
  ) : null;
  return (
    <div data-testid="pending-steer-card" className="mt-4 mb-4 flex justify-end">
      <div className={`${bubble} max-w-[80%]`}>
        {header}
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <Md content={s.text} />
            {ring && badge ? <div className="self-start"><Fix n={1} tip="Image count, as on follow-ups">{badge}</Fix></div> : badge}
          </div>
          {ring && actions ? <Fix n={2} tip="Cancel, same as follow-up remove">{actions}</Fix> : actions}
        </div>
      </div>
    </div>
  );
}

function ClearAll({ onClear }: { onClear?: () => void }) {
  return (
    <button type="button" data-testid="pending-steer-clear-all" onClick={onClear}
      aria-label="Clear all steering entries" title="Clear all steering entries" className={clearAllBtn}>
      <Icon path={mdiCloseCircleOutline} size={0.6} aria-hidden="true" />
      Clear all
    </button>
  );
}

function SteerStack({ steers, variant, ring, onCancel, onClear }: {
  steers: Steer[]; variant: Variant; ring?: boolean; onCancel?: (id: string) => void; onClear?: () => void;
}) {
  const list = steers.map((s, i) => (
    <SteerBubble key={s.id} s={s} variant={variant} ring={ring && i === steers.length - 1} onCancel={onCancel} />
  ));
  if (variant === "current" || steers.length < 2) return <>{list}</>;
  const all = <ClearAll onClear={onClear} />;
  return (
    <>
      {list}
      <div className="flex justify-end -mt-2 mb-2">
        {ring ? <Fix n={3} tip="Clear all, same as follow-up lane">{all}</Fix> : all}
      </div>
    </>
  );
}

// ---- shared surroundings (identical in both panes, R1) ----
function AssistantStreaming() {
  return (
    <div className="max-w-[85%] text-[var(--text-secondary)]">
      <Md content={"Adding a bridge-owned steer buffer in `bridge.ts`. Running the extension tests now."} />
    </div>
  );
}
function Dock() {
  const [open, setOpen] = useState<"queue" | null>(null);
  const lane = buildQueueLane({ followUp: FOLLOWUP, onEdit: noop, onRemove: noop, onPromote: noop, onClearAll: noop });
  return (
    <ComposerDock session={undefined} cwd={undefined} openLane={open}
      onOpenLaneChange={(k) => setOpen(k === "queue" ? "queue" : null)} lanes={[lane]} />
  );
}
function ChatTail({ variant, phone }: { variant: Variant; phone?: boolean }) {
  return (
    <div className={`flex flex-col bg-[var(--bg-primary)] ${phone ? "p-3" : "p-4"}`}>
      <AssistantStreaming />
      <SteerStack steers={STEERS} variant={variant} ring />
      <Dock />
    </div>
  );
}

// ---- lifecycle steps (proposed only) ----
const thumb = (label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' fill='#1f2937'/><rect x='70' y='54' width='40' height='16' rx='4' fill='#3b82f6'/><text x='8' y='18' fill='#9ca3af' font-size='10' font-family='monospace'>${label}</text></svg>`)}`;

function DeliveredSteer({ s }: { s: Steer }) {
  return (
    <div className="mt-4 mb-4 flex flex-col items-end">
      <span className="inline-flex items-center self-end mb-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300/80">steered</span>
      <div className={`${bubble} max-w-[80%]`}>
        {s.imageCount > 0 ? (
          <div className="flex gap-2 flex-wrap mb-2">
            {Array.from({ length: s.imageCount }, (_, i) => (
              <img key={i} src={thumb(`mobile-${i + 1}.png`)} alt={`Attachment ${i + 1}`} className="rounded border border-white/20 max-h-20" />
            ))}
          </div>
        ) : null}
        <Md content={s.text} />
      </div>
    </div>
  );
}
function LateCancelNote() {
  return (
    <div className="flex justify-end">
      <span role="status" className="text-[11px] text-[var(--text-tertiary)]">Steer already sent or cancelled.</span>
    </div>
  );
}
const StepShell = ({ children }: { children: ReactNode }) => <div className="flex flex-col p-3 bg-[var(--bg-primary)]">{children}</div>;

// ---- scripted frame: real clicks on local state ----
function LiveStack() {
  const [steers, setSteers] = useState<Steer[]>(STEERS.concat({ id: "s3", text: "Skip the e2e run for now.", imageCount: 0 }));
  const cancel = (id: string) => setSteers((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="flex flex-col p-3 bg-[var(--bg-primary)]">
      <AssistantStreaming />
      {steers.length === 0 ? <div data-testid="steers-empty" className="mt-4 text-[11px] text-[var(--text-tertiary)] text-right">No queued steers</div> : null}
      <SteerStack steers={steers} variant="proposed" onCancel={cancel} onClear={() => setSteers([])} />
    </div>
  );
}

const mock: Mock = {
  title: "Chat - cancellable steer + image marker",
  category: "Chat",
  frames: [
    { title: "Chat tail - desktop", width: 820,
      why: "Steers get the follow-up controls: same remove X per entry, same Clear all, same image count.",
      current: <ChatTail variant="current" />, proposed: <ChatTail variant="proposed" /> },
    { title: "Chat tail - phone", phone: true,
      why: "Same at 375px: X always visible, Clear all grows to a 44px target.",
      current: <ChatTail variant="current" phone />, proposed: <ChatTail variant="proposed" phone /> },
    { title: "Steer lifecycle", width: 520,
      why: "Cancel works while the bridge holds the steer; at turn_end it is handed to pi and the bubble becomes the message.",
      steps: [
        { label: "queued (cancellable)", proposed: <StepShell><SteerStack steers={STEERS} variant="proposed" /></StepShell> },
        { label: "one cancelled", proposed: <StepShell><SteerStack steers={[STEERS[1]]} variant="proposed" /></StepShell> },
        { label: "turn_end hand-off", proposed: <StepShell><DeliveredSteer s={STEERS[1]} /></StepShell> },
        { label: "late cancel", proposed: <StepShell><DeliveredSteer s={STEERS[1]} /><LateCancelNote /></StepShell> },
      ] },
    { title: "Cancel - scripted", width: 560,
      why: "Real clicks: cancel one steer, then clear all of the rest.",
      proposed: <LiveStack />,
      script: [
        { say: "Cancel the screenshot steer", target: "pending-steer-cancel-s2", act: "click" },
        { say: "Clear all remaining steers", target: "pending-steer-clear-all", act: "click" },
        { say: "Queue is empty", act: "wait", target: "steers-empty", expect: "steers-empty" },
      ] },
  ],
};
export default mock;
