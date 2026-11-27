/**
 * Lead notice coalescer (task 6.4, design D9). Lifecycle items for the lead
 * (idle, task completed, shutdown outcomes, member exit) are buffered per team and
 * flushed as ONE `notice` mail after a FIXED `notifyCoalesceMs` window measured
 * from the FIRST item (an item arriving later starts the next batch). The batch
 * wakes the lead iff any item is waking; the per-item wake flag encodes the D9 rules
 * at the source (idle with nothing left to claim, member error/exit/spawn failure,
 * shutdown rejection, all pending shutdowns resolved). Each item starts with `• `
 * and every continuation line of peer-authored text is prefixed `│ `, so peer text
 * cannot imitate an item. A waking direct message to the lead drains the buffer
 * first, so ordering by mail id is preserved.
 * See change: add-agent-teams-core.
 */
import type { Clock } from "../shared/clock.js";
import { formatNoticeItem } from "../shared/mail-format.js";
import type { Team } from "../shared/types.js";
import { type ConfigReader, effectiveCoalesceWindowMs } from "./config.js";
import type { TeamStore } from "./store.js";
import type { Logger } from "./types.js";

export interface NoticeItem {
  /** Server-authored single line. */
  head: string;
  /** Peer-authored text; always rendered as `│ ` continuation lines. */
  body?: string;
  wake: boolean;
}

export interface RenderedNoticeItem {
  text: string;
  wake: boolean;
}

export interface NoticesDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  /** Append the composed notice as one mail to the lead (queues while no lead is bound). */
  post(team: Team, notice: { text: string; wake: boolean; details: { items: RenderedNoticeItem[] } }): void;
}

/** `• head` plus `│ `-prefixed continuation lines for peer text. */
function renderNoticeItem(item: Pick<NoticeItem, "head" | "body">): string {
  const head = item.head.replace(/[\r\n]+/g, " ");
  return formatNoticeItem(item.body !== undefined && item.body !== "" ? `${head}\n${item.body}` : head);
}

export function createNoticeBuffer(deps: NoticesDeps) {
  const buffers = new Map<string, { items: RenderedNoticeItem[]; timer: unknown }>();

  function windowMs(team: Team): number {
    return effectiveCoalesceWindowMs(team, deps.config());
  }

  /** Post the buffered batch now (timer fire, or an early drain). */
  function drain(team: Team): void {
    const b = buffers.get(team.id);
    if (!b) return;
    deps.clock.clearTimeout(b.timer);
    buffers.delete(team.id);
    if (b.items.length === 0 || team.status === "closed") return;
    deps.post(team, {
      text: b.items.map((i) => i.text).join("\n"),
      wake: b.items.some((i) => i.wake),
      details: { items: b.items },
    });
  }

  function add(team: Team, item: NoticeItem): void {
    const rendered: RenderedNoticeItem = { text: renderNoticeItem(item), wake: item.wake };
    const b = buffers.get(team.id);
    if (b) {
      b.items.push(rendered);
      return;
    }
    const entry = { items: [rendered], timer: undefined as unknown };
    buffers.set(team.id, entry);
    entry.timer = deps.clock.setTimeout(() => drain(deps.store.get(team.id) ?? team), windowMs(team));
  }

  /** A team closed: its buffered items are dropped with its timer. */
  function drop(teamId: string): void {
    const b = buffers.get(teamId);
    if (!b) return;
    deps.clock.clearTimeout(b.timer);
    buffers.delete(teamId);
  }

  function pending(teamId: string): number {
    return buffers.get(teamId)?.items.length ?? 0;
  }

  function dispose(): void {
    for (const b of buffers.values()) deps.clock.clearTimeout(b.timer);
    buffers.clear();
  }

  return { add, drain, drop, pending, dispose };
}
