import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../chat/event-reducer.js";
import { type BurstItem, groupToolBursts, type ToolBurstGroup } from "../chat/group-tool-bursts.js";
import type { ChatItem, ToolCallGroup } from "../chat/group-tool-calls.js";

let seq = 0;
function toolMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${seq++}`,
    role: "toolResult",
    content: "",
    toolName: "bash",
    toolCallId: `tc-${seq}`,
    toolStatus: "complete",
    timestamp: Date.now(),
    args: { command: "curl -s http://localhost:8000/api/health" },
    ...overrides,
  };
}

/** A distinct tool call (different tool + args) so it never semantically merges. */
function distinctTool(name: string, args: Record<string, unknown>): ChatMessage {
  return toolMsg({ toolName: name, args });
}

function userMsg(): ChatMessage {
  return { id: `msg-${seq++}`, role: "user", content: "hello", timestamp: Date.now() };
}

function assistantMsg(content: string): ChatMessage {
  return { id: `msg-${seq++}`, role: "assistant", content, timestamp: Date.now() };
}

function transparent(role: ChatMessage["role"] = "turnSeparator"): ChatMessage {
  return { id: `msg-${seq++}`, role, content: "", timestamp: Date.now() };
}

function isBurst(item: BurstItem): item is ToolBurstGroup {
  return (item as ToolBurstGroup).type === "burst";
}
function isGroup(item: ChatItem): item is ToolCallGroup {
  return (item as ToolCallGroup).type === "group";
}

/** Count underlying tool calls in a burst's items (a nested ×N group counts its members). */
function underlyingCount(burst: ToolBurstGroup): number {
  let n = 0;
  for (const it of burst.items) {
    if (isGroup(it)) n += it.messages.length;
    else if ((it as ChatMessage).role === "toolResult") n += 1;
  }
  return n;
}

describe("groupToolBursts", () => {
  it("forms a burst from 3+ heterogeneous consecutive tool calls", () => {
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      distinctTool("grep", { pattern: "bar" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    expect(underlyingCount(result[0] as ToolBurstGroup)).toBe(3);
  });

  it("carries a stable id = first member id", () => {
    const first = distinctTool("grep", { pattern: "foo" });
    const msgs = [first, distinctTool("read", { path: "/a" }), distinctTool("write", { path: "/b" })];
    const result = groupToolBursts(msgs);
    expect((result[0] as ToolBurstGroup).id).toBe(first.id);
  });

  it("forms a burst from a single tool call (threshold 1)", () => {
    const msgs = [distinctTool("read", { path: "/a" })];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    expect(underlyingCount(result[0] as ToolBurstGroup)).toBe(1);
  });

  it("forms a burst from 2 tools (threshold 1) absorbing intermediate transparents", () => {
    const a = distinctTool("grep", { pattern: "foo" });
    const sep = transparent();
    const b = distinctTool("read", { path: "/a" });
    const result = groupToolBursts([a, sep, b]);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    const burst = result[0] as ToolBurstGroup;
    // The intermediate transparent is absorbed as an interior item.
    expect(burst.items.some((it) => (it as ChatMessage).id === sep.id)).toBe(true);
    expect(underlyingCount(burst)).toBe(2);
  });

  it("absorbs a leading thinking row into the group (turn-scoped, leading)", () => {
    const think = transparent("thinking");
    const msgs = [
      userMsg(),
      think,
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      distinctTool("write", { path: "/b" }),
      assistantMsg("done"),
    ];
    const result = groupToolBursts(msgs);
    // user, burst, assistant — no standalone thinking between user and burst.
    expect(result).toHaveLength(3);
    expect((result[0] as ChatMessage).role).toBe("user");
    expect(isBurst(result[1])).toBe(true);
    expect((result[1] as ToolBurstGroup).items[0]).toBe(think);
    expect((result[2] as ChatMessage).content).toBe("done");
  });

  it("absorbs trailing thinking rows into the group (turn-scoped, trailing)", () => {
    const t1 = transparent("thinking");
    const t2 = transparent("thinking");
    const u = userMsg();
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      distinctTool("write", { path: "/b" }),
      t1,
      t2,
      u,
    ];
    const result = groupToolBursts(msgs);
    // burst (absorbing both trailing thinking), then user — no standalone thinking.
    expect(result).toHaveLength(2);
    expect(isBurst(result[0])).toBe(true);
    const burst = result[0] as ToolBurstGroup;
    expect(burst.items).toContain(t1);
    expect(burst.items).toContain(t2);
    expect((result[1] as ChatMessage).id).toBe(u.id);
  });

  it("does NOT let a group absorb a following turn's reasoning across a HARD row", () => {
    // burst, reply (HARD), thinking, burst — the thinking belongs to turn 2.
    const t = transparent("thinking");
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      assistantMsg("reply"),
      t,
      distinctTool("grep", { pattern: "bar" }),
      distinctTool("read", { path: "/c" }),
    ];
    const result = groupToolBursts(msgs);
    // burst1, reply, burst2 (with leading thinking absorbed).
    expect(result).toHaveLength(3);
    expect(isBurst(result[0])).toBe(true);
    expect((result[1] as ChatMessage).content).toBe("reply");
    expect(isBurst(result[2])).toBe(true);
    expect((result[2] as ToolBurstGroup).items[0]).toBe(t);
  });

  it("walks across empty assistant rows (transparent)", () => {
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      assistantMsg(""),
      distinctTool("read", { path: "/a" }),
      distinctTool("write", { path: "/b" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    expect(underlyingCount(result[0] as ToolBurstGroup)).toBe(3);
  });

  it("treats non-empty assistant prose as a HARD boundary", () => {
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      distinctTool("write", { path: "/b" }),
      assistantMsg("found it"),
      distinctTool("grep", { pattern: "baz" }),
      distinctTool("read", { path: "/c" }),
      distinctTool("write", { path: "/d" }),
    ];
    const result = groupToolBursts(msgs);
    // burst, prose, burst
    expect(result).toHaveLength(3);
    expect(isBurst(result[0])).toBe(true);
    expect((result[1] as ChatMessage).role).toBe("assistant");
    expect((result[1] as ChatMessage).content).toBe("found it");
    expect(isBurst(result[2])).toBe(true);
  });

  it.each(["user", "interactiveUi", "bashOutput", "inlineTerminal"] as const)(
    "treats %s as a HARD boundary",
    (role) => {
      const hard: ChatMessage = { id: `msg-${seq++}`, role, content: "", timestamp: Date.now() };
      const msgs = [
        distinctTool("grep", { pattern: "foo" }),
        distinctTool("read", { path: "/a" }),
        distinctTool("write", { path: "/b" }),
        hard,
        distinctTool("grep", { pattern: "baz" }),
        distinctTool("read", { path: "/c" }),
        distinctTool("write", { path: "/d" }),
      ];
      const result = groupToolBursts(msgs);
      expect(result).toHaveLength(3);
      expect(isBurst(result[0])).toBe(true);
      expect((result[1] as ChatMessage).role).toBe(role);
      expect(isBurst(result[2])).toBe(true);
    },
  );

  it("includes a running member in the burst", () => {
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      toolMsg({ toolName: "curl", args: { url: "x" }, toolStatus: "running" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    const burst = result[0] as ToolBurstGroup;
    // The running member is present as a standalone toolResult item.
    const running = burst.items.find(
      (it) => !isGroup(it) && (it as ChatMessage).toolStatus === "running",
    );
    expect(running).toBeDefined();
  });

  it("collapses identical calls split by prose into a ×N (composition flip)", () => {
    // [curl, curl, prose, curl, curl] — semantic-first runs over the full stream
    // and treats prose as transparent for ×N folding, so all 4 fold into one
    // ×4 group with the prose absorbed into `rendered`.
    const prose = assistantMsg("found it");
    const msgs = [toolMsg(), toolMsg(), prose, toolMsg(), toolMsg()];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    // A single ×4 group (1 post-semantic member → below burst threshold, no wrapper).
    expect(isBurst(result[0])).toBe(false);
    expect(isGroup(result[0] as ChatItem)).toBe(true);
    const group = result[0] as unknown as ToolCallGroup;
    expect(group.messages).toHaveLength(4); // toolResult-only count
    // The absorbed prose is present in `rendered`, absent from `messages`.
    expect(group.rendered).toContain(prose);
    expect(group.messages).not.toContain(prose);
  });

  it("nests a ×N group inside a burst (coexistence, finding 4)", () => {
    // grep, read, then 3 identical health polls, then write.
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      toolMsg(),
      toolMsg(),
      toolMsg(),
      distinctTool("write", { path: "/b" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    const burst = result[0] as ToolBurstGroup;
    // One of the items is a nested ×3 group.
    const nested = burst.items.filter((it) => isGroup(it)) as ToolCallGroup[];
    expect(nested).toHaveLength(1);
    expect(nested[0].messages).toHaveLength(3);
    // Underlying count = grep + read + 3 polls + write = 6.
    expect(underlyingCount(burst)).toBe(6);
  });

  it("nests a NARRATED ×N poll loop inside a heterogeneous burst (composition flip)", () => {
    // grep, read, then 3 identical polls EACH separated by narration prose, then
    // write. Semantic-first folds the narrated polls into one ×3 (prose absorbed
    // into rendered); the burst forms over [grep, read, ×3, write] = 4 members.
    const p1 = assistantMsg("still starting");
    const p2 = assistantMsg("still starting");
    const msgs = [
      distinctTool("grep", { pattern: "foo" }),
      distinctTool("read", { path: "/a" }),
      toolMsg(),
      p1,
      toolMsg(),
      p2,
      toolMsg(),
      distinctTool("write", { path: "/b" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    const burst = result[0] as ToolBurstGroup;
    const nested = burst.items.filter((it) => isGroup(it)) as ToolCallGroup[];
    expect(nested).toHaveLength(1);
    expect(nested[0].messages).toHaveLength(3); // toolResult-only
    // Absorbed narration lives in the nested group's `rendered`.
    expect(nested[0].rendered).toContain(p1);
    expect(nested[0].rendered).toContain(p2);
    expect(underlyingCount(burst)).toBe(6); // grep + read + 3 polls + write
  });

  it("counts underlying calls, threshold counts post-semantic members (finding 5)", () => {
    // [grepA, readB, curl×24] = 3 post-semantic members → forms; 26 underlying.
    const polls = Array.from({ length: 24 }, () => toolMsg());
    const msgs = [distinctTool("grep", { pattern: "a" }), distinctTool("read", { path: "/b" }), ...polls];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    const burst = result[0] as ToolBurstGroup;
    expect(underlyingCount(burst)).toBe(26);
  });

  it("keeps a lone ×N group bare when only STRUCTURAL transparents lead it", () => {
    // Leading debug rawEvent + turnSeparator before a pure ×3 poll → the ×N
    // stays a bare group (no double-frame), transparents emit standalone.
    const ev = transparent("rawEvent");
    const sep = transparent("turnSeparator");
    const msgs = [ev, sep, toolMsg(), toolMsg(), toolMsg()];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(3); // rawEvent, turnSeparator, bare ×3 group
    expect((result[0] as ChatMessage).id).toBe(ev.id);
    expect((result[1] as ChatMessage).id).toBe(sep.id);
    expect(isBurst(result[2])).toBe(false);
    expect(isGroup(result[2] as ChatItem)).toBe(true);
  });

  it("wraps a lone ×N group when it absorbed leading reasoning (thinking)", () => {
    // Leading thinking before a pure ×3 poll → wraps so the reasoning folds in.
    const think = transparent("thinking");
    const msgs = [think, toolMsg(), toolMsg(), toolMsg()];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(true);
    expect((result[0] as ToolBurstGroup).items[0]).toBe(think);
  });

  it("does NOT wrap a pure homogeneous ×N run in a burst (byte-identical to today)", () => {
    // 24 identical polls with no other tools → 1 post-semantic member → stays a
    // bare ×24 group, no burst wrapper.
    const msgs = Array.from({ length: 24 }, () => toolMsg());
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(1);
    expect(isBurst(result[0])).toBe(false);
    expect(isGroup(result[0] as ChatItem)).toBe(true);
    expect((result[0] as unknown as ToolCallGroup).messages).toHaveLength(24);
  });

  it("preserves non-tool rows around bursts", () => {
    const u = userMsg();
    const msgs = [
      u,
      distinctTool("grep", { pattern: "a" }),
      distinctTool("read", { path: "/b" }),
      distinctTool("write", { path: "/c" }),
    ];
    const result = groupToolBursts(msgs);
    expect(result).toHaveLength(2);
    expect((result[0] as ChatMessage).id).toBe(u.id);
    expect(isBurst(result[1])).toBe(true);
  });

  it("handles empty array", () => {
    expect(groupToolBursts([])).toEqual([]);
  });

  // ── add-custom-entry-renderer-slot: conditional custom transparency (D7) ──
  function customMsg(customType: string): ChatMessage {
    return { id: `custom-${customType}`, role: "custom", customType, content: "{}", timestamp: Date.now() };
  }
  const claimed = (ct: string) => ct === "om.observations.recorded";

  it("E7: a CLAIMED custom row is absorbed into ONE burst; an unclaimed one splits it", () => {
    const c = customMsg("om.observations.recorded");
    const a = distinctTool("grep", { pattern: "a" });
    const b = distinctTool("read", { path: "/b" });

    const withClaim = groupToolBursts([a, c, b], claimed);
    const bursts = withClaim.filter(isBurst);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].items.map((it) => (it as ChatMessage).id)).toEqual([a.id, c.id, b.id]);

    const withoutClaim = groupToolBursts([a, c, b], () => false);
    expect(withoutClaim.filter(isBurst)).toHaveLength(2);
    // The custom row is emitted verbatim at the top level, not absorbed.
    expect(withoutClaim.some((it) => !isBurst(it) && (it as ChatMessage).id === c.id)).toBe(true);
  });

  it("E10: burst formation is unchanged with no claims registered", () => {
    const fixture = [
      userMsg(),
      distinctTool("grep", { pattern: "a" }),
      customMsg("om.observations.recorded"),
      distinctTool("read", { path: "/b" }),
      assistantMsg("done"),
    ];
    expect(groupToolBursts(fixture, () => false)).toEqual(groupToolBursts(fixture));
  });

  it("E11: a lone ×N group flanked only by a CLAIMED custom row is WRAPPED", () => {
    const c = customMsg("om.observations.recorded");
    const reads = [
      toolMsg({ toolName: "read", args: { path: "/a" } }),
      toolMsg({ toolName: "read", args: { path: "/a" } }),
      toolMsg({ toolName: "read", args: { path: "/a" } }),
    ];
    const withClaim = groupToolBursts([c, ...reads], claimed);
    expect(isBurst(withClaim[0])).toBe(true);
    expect(withClaim.filter(isBurst)).toHaveLength(1);
    // Unclaimed: the custom row is a HARD boundary and the ×N group stays bare
    // (unwrapped) — the bare-group exception applies.
    const withoutClaim = groupToolBursts([c, ...reads], () => false);
    expect(withoutClaim.filter(isBurst)).toHaveLength(0);
    expect(isGroup(withoutClaim[1] as ChatItem)).toBe(true);
  });

  it("F9: display preferences do not re-form bursts (grouping is claim-set only)", () => {
    const fixture = [
      distinctTool("grep", { pattern: "a" }),
      customMsg("om.observations.recorded"),
      distinctTool("read", { path: "/b" }),
    ];
    // No display-pref input exists — re-grouping yields identical boundaries.
    const once = groupToolBursts(fixture, claimed);
    const twice = groupToolBursts(fixture, claimed);
    expect(twice).toEqual(once);
  });

  it("F10: a claim set arriving later re-forms bursts at most once", () => {
    const fixture = [
      distinctTool("grep", { pattern: "a" }),
      customMsg("om.observations.recorded"),
      distinctTool("read", { path: "/b" }),
    ];
    const empty = groupToolBursts(fixture, () => false);
    const registered = groupToolBursts(fixture, claimed);
    expect(registered.filter(isBurst).length).toBeLessThan(empty.filter(isBurst).length);
    // A later re-render with an UNCHANGED claim list produces identical boundaries.
    expect(groupToolBursts(fixture, claimed)).toEqual(registered);
  });

  it("P3: burst-transparency reduces burst splits on an om.*-dense profile", () => {
    // Synthetic stand-in for the ~4.3k-row captured profile: many tool calls
    // sprayed with claimed custom rows between them.
    const fixture: ChatMessage[] = [];
    for (let i = 0; i < 60; i++) {
      fixture.push(toolMsg({ toolName: i % 2 ? "grep" : "read", args: { i } }));
      if (i % 2 === 0) fixture.push(customMsg("om.observations.recorded"));
    }
    const withClaims = groupToolBursts(fixture, claimed).filter(isBurst).length;
    const withoutClaims = groupToolBursts(fixture, () => false).filter(isBurst).length;
    // eslint-disable-next-line no-console
    console.log(`[P3] burst count — claimed: ${withClaims}, none: ${withoutClaims}`);
    expect(withClaims).toBeLessThan(withoutClaims);
  });
});
