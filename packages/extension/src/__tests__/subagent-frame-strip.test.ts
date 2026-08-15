/**
 * D2/D3 — the bridge-side strip of `details.entries` on the FORWARD path.
 *
 * The producer builds ONE `snapshotDetails()` object and hands it to both
 * carriers, so tick size grows linearly with run length on both wire segments.
 * The bridge strips the cumulative timeline off frames describing a
 * NON-terminal subagent; the retained buffer copy (the resync/pull source) and
 * every terminal frame keep it.
 *
 * See change: reduce-subagent-details-payload.
 */
import { describe, expect, it } from "vitest";
import { SubagentFrameBuffer } from "../subagent-frame-buffer.js";
import { NON_TERMINAL_STATUSES, stripSubagentEntries } from "../subagent-frame-strip.js";

function frame(status: string, entryCount = 12): Record<string, unknown> {
  return {
    id: "ag1",
    details: {
      agentId: "ag1",
      status,
      description: "explore",
      activity: "reading src/foo.ts",
      toolUses: 3,
      entries: Array.from({ length: entryCount }, (_, i) => ({
        kind: "text",
        text: `step ${i}`,
        ts: 1000 + i,
      })),
    },
  };
}

const entriesOf = (data: Record<string, unknown>): unknown =>
  (data.details as Record<string, unknown> | undefined)?.entries;

describe("stripSubagentEntries", () => {
  // E5 — decision table over every AgentStatus the producer declares
  // (events.ts:34-36) plus "failed", asserted as an ALLOWLIST of non-terminal
  // statuses, never a `!terminal` negation. "stopped" is unemitted today and is
  // exactly the status a negation would silently strip.
  describe("E5: status allowlist × carrier", () => {
    const STRIPPED = ["queued", "running"];
    const KEPT = ["completed", "failed", "aborted", "stopped", "error"];

    for (const status of STRIPPED) {
      it(`strips entries for non-terminal status "${status}"`, () => {
        const out = stripSubagentEntries(frame(status));
        expect(entriesOf(out)).toBeUndefined();
        // Scalars survive — only the timeline goes.
        const details = out.details as Record<string, unknown>;
        expect(details.status).toBe(status);
        expect(details.activity).toBe("reading src/foo.ts");
        expect(details.toolUses).toBe(3);
      });
    }

    for (const status of KEPT) {
      it(`keeps entries for status "${status}"`, () => {
        const out = stripSubagentEntries(frame(status));
        expect(entriesOf(out)).toHaveLength(12);
      });
    }

    it("keeps entries when status is absent (unknown → never strip)", () => {
      const data = { id: "ag1", details: { agentId: "ag1", entries: [{ kind: "text", text: "s", ts: 1 }] } };
      expect(entriesOf(stripSubagentEntries(data))).toHaveLength(1);
    });

    it("applies to the tool_execution_update carrier shape too", () => {
      const data = {
        toolCallId: "tc1",
        toolName: "Agent",
        partialResult: {
          content: [{ type: "text", text: "running…" }],
          details: { agentId: "ag1", status: "running", entries: [{ kind: "text", text: "s", ts: 1 }] },
        },
      };
      const out = stripSubagentEntries(data);
      const details = (out.partialResult as Record<string, unknown>).details as Record<string, unknown>;
      expect(details.entries).toBeUndefined();
      expect(details.status).toBe("running");
      // The sibling streaming content is untouched.
      expect((out.partialResult as Record<string, unknown>).content).toHaveLength(1);
    });
  });

  // E6 — idempotence and degenerate input.
  describe("E6: idempotence / degenerate input", () => {
    it("is a pass-through when details is absent", () => {
      const data = { id: "ag1" };
      expect(() => stripSubagentEntries(data)).not.toThrow();
      expect(stripSubagentEntries(data)).toEqual({ id: "ag1" });
    });

    it("is a pass-through for an already-thin frame", () => {
      const data = { id: "ag1", details: { agentId: "ag1", status: "running", toolUses: 1 } };
      expect(stripSubagentEntries(data)).toEqual(data);
    });

    it("strip(strip(x)) ≡ strip(x)", () => {
      const once = stripSubagentEntries(frame("running"));
      expect(stripSubagentEntries(once)).toEqual(once);
    });

    it("tolerates a non-object details and an empty payload", () => {
      expect(() => stripSubagentEntries({ details: "nope" })).not.toThrow();
      expect(stripSubagentEntries({})).toEqual({});
    });
  });

  // E7 — clone, never mutate: the buffer retains frames BY REFERENCE, so a
  // mutating strip would turn the pull source into another thin frame.
  describe("E7: clone-not-mutate", () => {
    it("leaves the input frame's entries intact", () => {
      const input = frame("running");
      const before = entriesOf(input);
      stripSubagentEntries(input);
      expect(entriesOf(input)).toBe(before);
      expect(entriesOf(input)).toHaveLength(12);
    });

    it("buffer.resync() still yields the full timeline after a forward", () => {
      const buffer = new SubagentFrameBuffer();
      const data = frame("running");
      buffer.markForwarded("subagents:started", data);
      const forwarded = stripSubagentEntries(data);
      expect(entriesOf(forwarded)).toBeUndefined();
      const snap = buffer.resync("ag1");
      expect(entriesOf(snap!.data)).toHaveLength(12);
    });

    it("shares unstripped sub-objects rather than deep-copying the world", () => {
      // A shallow clone down the details path is enough and keeps the hot path
      // cheap; only the paths that change are copied.
      const input = frame("running");
      const out = stripSubagentEntries(input);
      expect(out).not.toBe(input);
      expect(out.details).not.toBe(input.details);
    });
  });

  it("exports the allowlist as the single source of truth", () => {
    expect([...NON_TERMINAL_STATUSES].sort()).toEqual(["queued", "running"]);
  });
});
