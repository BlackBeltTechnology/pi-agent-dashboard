/**
 * Native `agent_settled` wire contract — the surviving half of the retired
 * floor-pi synthesis (test-plan #F4, #X5, #F6).
 *
 * pi emits `agent_settled` exactly once per run from 0.80.4, and the 0.85.1
 * floor makes that version guaranteed. The bridge therefore consumes the
 * native event unconditionally: it no longer synthesizes a floor-pi settle
 * after `agent_end`. This pins the wire contract (exactly ONE terminal settle,
 * sourced from the native event, carrying no per-attempt compatibility shape)
 * and guards that the retired synthesis module cannot reappear.
 *
 * See change: update-pi-core-0-85-adopt-apis (task 3.3, design §3).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AbortLatch } from "../abort-latch.js";
import { mapEventToProtocol } from "../event-forwarder.js";
import { RetryTracker } from "../retry-tracker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeSrc = path.join(here, "..", "bridge.ts");

interface Frame {
	eventType: string;
	data: Record<string, unknown>;
}

/**
 * Faithful mini-loop of the bridge's enriched `agent_start` / `agent_end` /
 * `agent_settled` branches AFTER the floor-pi synthesis block was removed.
 * Uses the real `mapEventToProtocol`, `AbortLatch` and `RetryTracker`.
 */
function replayNativeRun() {
	const frames: Frame[] = [];
	const state = { isAgentStreaming: false };
	const abortLatch = new AbortLatch();
	const retryTracker = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
	const sessionId = "s1";
	// Arm the latch so we can prove the native settle clears it.
	abortLatch.request(sessionId);

	const emit = (eventType: string, data: Record<string, unknown> = {}): void => {
		if (eventType === "agent_start") state.isAgentStreaming = true;
		if (eventType === "agent_end") state.isAgentStreaming = false;
		if (eventType === "agent_settled") {
			state.isAgentStreaming = false;
			abortLatch.clear(sessionId);
			retryTracker.observeAgentSettled(sessionId);
		}
		const msg = mapEventToProtocol(sessionId, { type: eventType, ...data });
		frames.push({ eventType: msg.event.eventType, data: msg.event.data });
	};

	// pi's real order: a failed attempt, a successful retry, then ONE settle.
	emit("agent_start");
	emit("message_end", { role: "assistant", stopReason: "error", errorMessage: "503" });
	emit("agent_end", {
		messages: [{ role: "assistant", stopReason: "error", errorMessage: "503" }],
	});
	emit("agent_start");
	emit("message_end", { role: "assistant", stopReason: "end_turn" });
	emit("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
	emit("agent_settled");

	return { frames, state, abortLatch, retryTracker, sessionId };
}

describe("F4: exactly one terminal settle, never synthesized", () => {
	it("a native run forwards exactly ONE agent_settled, payload-free", () => {
		const { frames, state } = replayNativeRun();
		const settles = frames.filter((f) => f.eventType === "agent_settled");
		expect(settles).toHaveLength(1);
		// The forwarded frame is the NATIVE event shape — the bridge adds
		// nothing to it. The removed synth stamped an extra compatibility flag
		// onto every floor-pi settle.
		expect(settles[0].data).toEqual({ type: "agent_settled" });
		expect(state.isAgentStreaming).toBe(false);
	});

	it("no synthesized settle is appended after agent_end", () => {
		const { frames } = replayNativeRun();
		const lastAgentEnd = frames.map((f) => f.eventType).lastIndexOf("agent_end");
		const afterEnd = frames.slice(lastAgentEnd + 1).map((f) => f.eventType);
		expect(afterEnd).toEqual(["agent_settled"]);
	});

	it("the native settle clears the abort latch", () => {
		const { abortLatch, sessionId } = replayNativeRun();
		expect(abortLatch.isActive(sessionId)).toBe(false);
	});

	it("the retry chain closes on the native settle", () => {
		const { retryTracker, sessionId } = replayNativeRun();
		expect(retryTracker.isRetrying(sessionId)).toBe(false);
	});
});

describe("X5 / F6: the floor-pi synthesis and its version gate are retired", () => {
	it("the agent-settled module is deleted", () => {
		expect(fs.existsSync(path.join(here, "..", "agent-settled.ts"))).toBe(false);
	});

	it("bridge.ts carries no synthesis or version-gate reference", () => {
		const src = fs.readFileSync(bridgeSrc, "utf8");
		for (const needle of [
			"./agent-settled",
			"settleFollowUp",
			"markFloorSettle",
			"piEmitsNativeSettled",
			"floorRetry",
			"nativeAgentSettledSupported",
			"synthesizeAgentSettledEvent",
			"NATIVE_AGENT_SETTLED",
		]) {
			expect(src, `bridge.ts must not reference ${needle}`).not.toContain(needle);
		}
	});

	it("the retired version-gate API appears nowhere in the extension source tree", () => {
		// Walk the WHOLE extension source tree (not one file) for the removed
		// synthesis API names. These tokens never appear in comments, so a
		// reintroduction fails here rather than passing vacuously.
		const srcRoot = path.join(here, "..");
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "__tests__" || entry.name === "node_modules") continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!entry.name.endsWith(".ts")) continue;
				const src = fs.readFileSync(full, "utf8");
				for (const needle of [
					"NATIVE_AGENT_SETTLED",
					"nativeAgentSettledSupported",
					"settleFollowUp",
					"synthesizeAgentSettledEvent",
					"markFloorSettle",
				]) {
					if (src.includes(needle)) offenders.push(`${entry.name}: ${needle}`);
				}
			}
		};
		walk(srcRoot);
		expect(offenders).toEqual([]);
	});
});
