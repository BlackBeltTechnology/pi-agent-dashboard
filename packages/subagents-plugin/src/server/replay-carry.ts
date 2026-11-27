/**
 * Subagents replay-carry handler: what a windowed subscribe must carry across
 * the replay gap so subagent rows and timelines match a full replay.
 *
 * For every agent NOT terminal before the tail, in priority order (the core
 * bound keeps the longest prefix):
 *   1. identity: `subagent_created` + latest `subagent_started` (open agents);
 *   2. terminal frame in the gap of an agent that has a frame in the head;
 *   3. `subagent_entry` events, newest run first (agents by last frame desc);
 *   4. `subagent_delta` events of each open block.
 * An agent created AND finished inside the gap contributes nothing.
 * Only resident gap events are read; a trimmed gap carries what survives.
 *
 * See change: move-subagents-to-plugin (D2).
 */
import type {
	ReplayCarryContext,
	ReplayCarryEvent,
	ReplayCarryHandler,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

type Rec = Record<string, unknown>;

const dataOf = (e: ReplayCarryEvent): Rec => (e.event.data && typeof e.event.data === "object" ? (e.event.data as Rec) : {});
const isTerminal = (type: string): boolean => type === "subagent_completed" || type === "subagent_failed";

/** Agent id of a subagent frame: `id` on lifecycle frames, `agentId` on entry/delta. */
function agentOf(e: ReplayCarryEvent): string | undefined {
	const d = dataOf(e);
	const id = e.event.eventType === "subagent_entry" || e.event.eventType === "subagent_delta" ? d.agentId : d.id;
	return typeof id === "string" ? id : undefined;
}

interface AgentFrames {
	created?: ReplayCarryEvent;
	started?: ReplayCarryEvent;
	terminal?: ReplayCarryEvent;
	entries: ReplayCarryEvent[];
	deltas: ReplayCarryEvent[];
	first: number;
	last: number;
}

export function createSubagentsReplayCarry(): ReplayCarryHandler {
	return (ctx: ReplayCarryContext): ReplayCarryEvent[] => {
		const inHead = new Set<string>();
		const terminalBeforeTail = new Set<string>();
		for (const e of ctx.head) {
			if (!e.event.eventType.startsWith("subagent_")) continue;
			const id = agentOf(e);
			if (id === undefined) continue;
			inHead.add(id);
			if (isTerminal(e.event.eventType)) terminalBeforeTail.add(id);
		}

		const agents = new Map<string, AgentFrames>();
		for (const e of ctx.getGapEvents()) {
			const type = e.event.eventType;
			if (!type.startsWith("subagent_")) continue;
			const id = agentOf(e);
			if (id === undefined) continue;
			let a = agents.get(id);
			if (!a) agents.set(id, (a = { entries: [], deltas: [], first: e.seq, last: e.seq }));
			a.last = e.seq;
			if (type === "subagent_created") a.created = e;
			else if (type === "subagent_started") a.started = e;
			else if (isTerminal(type)) a.terminal = e;
			else if (type === "subagent_entry") a.entries.push(e);
			else if (type === "subagent_delta") a.deltas.push(e);
		}

		// Blocks closed by an entry in the gap or tail never need their deltas.
		const closedBlockMax = new Map<string, number>();
		const noteClosed = (e: ReplayCarryEvent): void => {
			if (e.event.eventType !== "subagent_entry") return;
			const id = agentOf(e);
			const blockId = dataOf(e).blockId;
			if (id === undefined || typeof blockId !== "number") return;
			closedBlockMax.set(id, Math.max(closedBlockMax.get(id) ?? -1, blockId));
		};
		for (const a of agents.values()) a.entries.forEach(noteClosed);
		ctx.tail.forEach(noteClosed);

		const open: Array<[string, AgentFrames]> = [];
		const terminalFrames: ReplayCarryEvent[] = [];
		for (const [id, a] of agents) {
			if (terminalBeforeTail.has(id)) continue;
			if (a.terminal) {
				// Finished in the gap: only a head-visible agent needs its terminal frame.
				if (inHead.has(id)) terminalFrames.push(a.terminal);
				continue;
			}
			open.push([id, a]);
		}
		open.sort((x, y) => x[1].first - y[1].first);

		const out: ReplayCarryEvent[] = [];
		for (const [, a] of open) {
			if (a.created) out.push(a.created);
			if (a.started) out.push(a.started);
		}
		out.push(...terminalFrames.sort((x, y) => x.seq - y.seq));
		for (const [, a] of [...open].sort((x, y) => y[1].last - x[1].last)) out.push(...a.entries);
		for (const [id, a] of open) {
			const closed = closedBlockMax.get(id) ?? -1;
			let latest = -1;
			for (const d of a.deltas) {
				const b = dataOf(d).blockId;
				if (typeof b === "number" && b > closed) latest = Math.max(latest, b);
			}
			if (latest < 0) continue;
			for (const d of a.deltas) if (dataOf(d).blockId === latest) out.push(d);
		}
		return out;
	};
}
