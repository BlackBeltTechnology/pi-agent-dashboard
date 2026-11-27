/**
 * Subagents replay-carry handler (D2): what a windowed subscribe carries across
 * the gap. test-plan E22 (carry selection), P2 (cost).
 * See change: move-subagents-to-plugin (D2).
 */
import type { ReplayCarryContext, ReplayCarryEvent } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expect, it } from "vitest";
import { createSubagentsReplayCarry } from "../replay-carry.js";

type Rec = Record<string, unknown>;
const ev = (seq: number, eventType: string, data: Rec): ReplayCarryEvent => ({
	seq,
	event: { eventType, timestamp: seq, data },
});
const entry = (seq: number, agentId: string, index: number, blockId?: number) =>
	ev(seq, "subagent_entry", { agentId, index, entry: { kind: "text" }, ...(blockId === undefined ? {} : { blockId }) });

function ctxOf(head: ReplayCarryEvent[], gap: ReplayCarryEvent[], tail: ReplayCarryEvent[]): ReplayCarryContext {
	return {
		sessionId: "S",
		gapFromSeq: (head.at(-1)?.seq ?? 0) + 1,
		gapToSeq: (tail[0]?.seq ?? 1) - 1,
		head,
		tail,
		getGapEvents: () => gap,
	};
}

const describeOf = (frames: ReplayCarryEvent[]) => frames.map((f) => `${f.event.eventType}:${(f.event.data as Rec).id ?? (f.event.data as Rec).agentId}:${(f.event.data as Rec).index ?? ""}`);

describe("subagents replay carry", () => {
	it("E22: open agent identity + entries; head-created gap-completed terminal; nothing for a fully-in-gap finished agent", async () => {
		const handler = createSubagentsReplayCarry();
		const head = [ev(150, "subagent_created", { id: "a3", type: "x", description: "d" })];
		const gap: ReplayCarryEvent[] = [
			ev(5000, "subagent_created", { id: "a2" }),
			ev(5001, "subagent_started", { id: "a2" }),
			entry(5002, "a2", 0),
			ev(5003, "subagent_completed", { id: "a2" }),
			ev(6000, "subagent_completed", { id: "a3" }),
			ev(9000, "subagent_created", { id: "a1", type: "x", description: "d" }),
			ev(9001, "subagent_started", { id: "a1" }),
			ev(9002, "subagent_started", { id: "a1", status: "running2" }),
		];
		for (let i = 0; i < 80; i++) gap.push(entry(9100 + i, "a1", i));
		const tail = Array.from({ length: 11 }, (_, i) => entry(15000 + i, "a1", 80 + i));
		const out = (await handler(ctxOf(head, gap, tail))) as ReplayCarryEvent[];
		const d = describeOf(out);
		expect(d.slice(0, 3)).toEqual(["subagent_created:a1:", "subagent_started:a1:", "subagent_completed:a3:"]);
		expect(out[1].seq).toBe(9002); // latest started only
		expect(d.filter((x) => x.startsWith("subagent_entry:a1"))).toHaveLength(80);
		expect(d.some((x) => x.includes(":a2:"))).toBe(false);
		expect(d.filter((x) => x.includes(":a3:"))).toEqual(["subagent_completed:a3:"]);
	});

	it("orders identity frames first, then terminal, then entries, then open-block deltas", async () => {
		const handler = createSubagentsReplayCarry();
		const head = [ev(1, "subagent_created", { id: "h" })];
		const gap = [
			ev(10, "subagent_created", { id: "o" }),
			entry(11, "o", 0, 1),
			ev(12, "subagent_delta", { agentId: "o", blockId: 1, offset: 0, kind: "text", text: "closed" }),
			ev(13, "subagent_delta", { agentId: "o", blockId: 2, offset: 0, kind: "text", text: "open" }),
			ev(14, "subagent_failed", { id: "h" }),
		];
		const out = (await handler(ctxOf(head, gap, []))) as ReplayCarryEvent[];
		expect(out.map((e) => e.event.eventType)).toEqual([
			"subagent_created",
			"subagent_failed",
			"subagent_entry",
			"subagent_delta",
		]);
		expect((out[3].event.data as Rec).blockId).toBe(2);
	});

	it("P2: 30 open agents, 3000 gap entries stay fast and carry within the 2 MiB bound", async () => {
		const handler = createSubagentsReplayCarry();
		const gap: ReplayCarryEvent[] = [];
		let seq = 1000;
		for (let a = 0; a < 30; a++) gap.push(ev(seq++, "subagent_created", { id: `a${a}`, type: "t", description: "d" }));
		for (let i = 0; i < 3000; i++) gap.push(entry(seq++, `a${i % 30}`, Math.floor(i / 30)));
		const t0 = performance.now();
		const out = (await handler(ctxOf([], gap, []))) as ReplayCarryEvent[];
		expect(performance.now() - t0).toBeLessThan(200);
		expect(out.length).toBe(3030);
		expect(Buffer.byteLength(JSON.stringify(out.slice(0, 2000)))).toBeLessThan(2 * 1024 * 1024);
	});
});
