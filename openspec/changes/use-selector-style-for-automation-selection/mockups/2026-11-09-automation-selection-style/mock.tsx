// Automation board: selected-card treatment.
// Current = the shipped rainbow neon (host `.card-glow-fx` x2 + `.card-ring-fx`, rotating
// conic gradient) applied by AutomationBoard.tsx on the selected card.
// Proposed = the ui-contract "selected-chip" recipe (ui-contract.md, Pressed chips):
// `--accent` border + `--accent-soft` fill on the HEADER ROW only (body keeps --bg-secondary so
// --accent-text links stay >= 4.5:1), no FX layers, plus aria-current for AT.
// The card shell replicates AutomationCard's classes; rail/dot/pill/buttons come from the
// REAL `automation-card-visuals` helpers via the `@automation` alias.
// Pending change: automation card selection uses selector style instead of neon glow.
import {
  cardButtonClass,
  deriveCardState,
  dotClass,
  GLOW_FX_CLASS,
  GLOW_FX_OUTER_CLASS,
  headlessSourceIcon,
  pillClass,
  pillLabel,
  RING_FX_CLASS,
  railBgClass,
  stripeFxClass,
} from "@automation/client/automation-card-visuals.ts";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

type Variant = "current" | "proposed";
interface Def { name: string; scope: string; schedule: string; next: string; last: string; running?: boolean; disabled?: boolean }

const defs: Def[] = [
  { name: "nightly-deps-audit", scope: "project", schedule: "Daily at 02:00", next: "in 9h", last: "done · 3m 12s · yesterday" },
  { name: "daily-digest", scope: "project", schedule: "Weekdays at 09:20", next: "in 16h", last: "done · 48s · today 09:20" },
  { name: "pr-triage", scope: "global", schedule: "Every 30 min", next: "in 12m", last: "running · started 2m ago", running: true },
  { name: "weekly-cleanup", scope: "project", schedule: "Sundays at 18:00", next: "—", last: "stopped · 5d ago", disabled: true },
];

function Card({ d, variant, selected, ring }: { d: Def; variant: Variant; selected: boolean; ring?: number }): ReactNode {
  const state = deriveCardState({ valid: true, disabled: !!d.disabled, running: !!d.running });
  const stripe = stripeFxClass(state);
  const rootSel =
    variant === "current"
      ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
      : "border-[var(--accent)] bg-[var(--bg-secondary)]";
  const headSel = selected && variant === "proposed";
  const card = (
    <li
      aria-current={selected && variant === "proposed" ? "true" : undefined}
      className={`relative isolate flex overflow-hidden rounded-xl border cursor-pointer ${
        selected ? rootSel : "border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
      }`}
    >
      {selected && variant === "current" ? (
        <>
          <div className={`${GLOW_FX_CLASS} ${GLOW_FX_OUTER_CLASS}`} aria-hidden="true" />
          <div className={GLOW_FX_CLASS} aria-hidden="true" />
          <div className={RING_FX_CLASS} aria-hidden="true" />
        </>
      ) : null}
      <div className={`relative isolate w-1 self-stretch overflow-hidden ${railBgClass(state)}`} aria-hidden="true">
        {stripe ? <div className={stripe} /> : null}
      </div>
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        <div className={`flex flex-wrap items-center gap-2 ${headSel ? "-mx-3 -mt-3 px-3 pt-3 pb-1.5 bg-[var(--accent-soft)]" : ""}`}>
          <Icon path={headlessSourceIcon} size={0.5} className="text-[var(--text-secondary)]" />
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass(state)}`} />
          <span className={`font-mono text-[13px] text-[var(--text-primary)] ${selected && variant === "proposed" ? "font-bold" : "font-semibold"}`}>{d.name}</span>
          <span className="text-[11px] rounded px-1 bg-[var(--bg-surface)] text-[var(--text-secondary)]">{d.scope}</span>
          <span className={pillClass(state)}>
            {stripe ? <span className={stripe} aria-hidden="true" /> : null}
            {pillLabel(state)}
          </span>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">
            {d.running ? (
              <button type="button" className={cardButtonClass("danger")}>⏹ Stop</button>
            ) : (
              <>
                <button type="button" className={cardButtonClass()}>▶ Run now</button>
                <button type="button" className={cardButtonClass()}>{d.disabled ? "Enable" : "Disable"}</button>
              </>
            )}
            <button type="button" className={cardButtonClass()}>Edit</button>
            <button type="button" aria-label="More actions" className={cardButtonClass()}>⋯</button>
          </div>
        </div>
        <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{d.schedule}</span>
          <span>next {d.next}</span>
        </div>
        <div className="text-xs text-[var(--text-secondary)]">Last run: {d.last}</div>
      </div>
    </li>
  );
  if (!ring) return card;
  return variant === "current" ? (
    <Issue n={ring} tip="Rotating rainbow glow + rim, unlike other selectors" block>{card}</Issue>
  ) : (
    <Fix n={ring} tip="Selected-chip recipe: accent border + accent-soft header row" block>{card}</Fix>
  );
}

function Board({ variant, sel = 1, phone }: { variant: Variant; sel?: number; phone?: boolean }): ReactNode {
  return (
    <div className={`flex flex-col gap-3 bg-[var(--bg-primary)] ${phone ? "p-3" : "p-5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Automations</h2>
        <span className="text-xs text-[var(--text-secondary)]">~/work/web-app</span>
        <span className="flex-1" />
        <button type="button" className={cardButtonClass("primary")}>+ Create Automation</button>
      </div>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">Definitions</h3>
        <ul className="space-y-2">
          {defs.map((d, i) => (
            <Card key={d.name} d={d} variant={variant} selected={i === sel} ring={i === sel ? 1 : undefined} />
          ))}
        </ul>
      </section>
    </div>
  );
}

const mock: Mock = {
  title: "Automation board - selected card",
  category: "Automations",
  frames: [
    {
      title: "Automation board - desktop",
      width: 900,
      why: "Selection should read like every other selector: calm accent border + soft fill, no rotating rainbow.",
      current: <Board variant="current" />,
      proposed: <Board variant="proposed" />,
    },
    {
      title: "Selected + running",
      width: 900,
      why: "Running stripe stays on rail + pill; selection must not compete with it.",
      current: <Board variant="current" sel={2} />,
      proposed: <Board variant="proposed" sel={2} />,
    },
    {
      title: "Automation board - phone",
      phone: true,
      why: "Same recipe at 375px; the glow halo no longer bleeds past the narrow card edge.",
      current: <Board variant="current" phone />,
      proposed: <Board variant="proposed" phone />,
    },
  ],
};
export default mock;
