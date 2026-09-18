/**
 * Unit tests for the PURE Discord payload layer + the recording fake.
 * Deliberately imports NO `discord.js`: this is the layer that must be
 * testable without a socket. See change: add-chat-gateway.
 */

import { describe, expect, it } from "vitest";
import type { InteractivePrompt, InteractiveResponse, PlatformMessage } from "../base.js";
import {
  assignersForRole,
  channelCreatePayload,
  channelNameFor,
  channelOverwrites,
  chunkForDiscord,
  customIdFor,
  DISCORD_CUSTOM_ID_LIMIT,
  parseCustomId,
  toDiscordControl,
} from "../discord-payload.js";
import { RecordingAdapter } from "./recording-adapter.js";

function prompt(over: Partial<InteractivePrompt>): InteractivePrompt {
  return { requestId: "req-1", method: "notify", title: "T", ...over } as InteractivePrompt;
}

describe("toDiscordControl", () => {
  it("maps select to a string-select with round-trippable option values", () => {
    const p = prompt({ method: "select", title: "Pick", options: ["alpha", "beta"] });
    const spec = toDiscordControl(p);
    expect(spec.kind).toBe("string-select");
    expect(spec.select?.options).toHaveLength(2);
    expect(spec.select?.min).toBe(1);
    expect(spec.select?.max).toBe(1);
    expect(spec.select?.options.map((o) => o.label)).toEqual(["alpha", "beta"]);
    const parsed = parseCustomId(spec.select?.options[1].value ?? "");
    expect(parsed).toMatchObject({ requestId: "req-1", value: "beta", subIndex: 1 });
  });

  it("maps confirm to exactly two buttons (Yes primary / No secondary)", () => {
    const spec = toDiscordControl(prompt({ method: "confirm", title: "Sure?" }));
    expect(spec.kind).toBe("buttons");
    const row = spec.rows?.[0] ?? [];
    expect(row).toHaveLength(2);
    expect(row[0]).toMatchObject({ label: "Yes", value: "yes", style: "primary" });
    expect(row[1]).toMatchObject({ label: "No", value: "no", style: "secondary" });
    expect(parseCustomId(row[0].customId)).toMatchObject({ requestId: "req-1", value: "yes" });
  });

  it("maps input to a short modal and editor to a paragraph modal", () => {
    const input = toDiscordControl(
      prompt({ method: "input", title: "Name", placeholder: "who?", prefill: "bob" }),
    );
    expect(input.kind).toBe("modal");
    expect(input.modal?.inputs[0].style).toBe("short");
    expect(input.modal?.inputs[0].placeholder).toBe("who?");
    expect(input.modal?.inputs[0].prefill).toBe("bob");

    const editor = toDiscordControl(prompt({ method: "editor", title: "Edit" }));
    expect(editor.kind).toBe("modal");
    expect(editor.modal?.inputs[0].style).toBe("paragraph");
  });

  it("clamps a modal title to Discord's 45-char budget", () => {
    const spec = toDiscordControl(prompt({ method: "input", title: "x".repeat(200) }));
    expect(spec.modal?.title.length).toBeLessThanOrEqual(45);
  });

  it("maps notify to a message with a severity prefix", () => {
    expect(toDiscordControl(prompt({ method: "notify", message: "hi" })).content).toBe("ℹ️ hi");
    expect(
      toDiscordControl(prompt({ method: "notify", message: "careful", notifyType: "warning" }))
        .content,
    ).toBe("⚠️ careful");
    expect(
      toDiscordControl(prompt({ method: "notify", message: "boom", notifyType: "error" })).content,
    ).toBe("❌ boom");
  });

  it("falls back to a plain message for unknown methods, never throwing", () => {
    for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text", "wat"]) {
      const spec = toDiscordControl(prompt({ method: method as InteractivePrompt["method"] }));
      expect(spec.kind).toBe("message");
      expect(spec.content.length).toBeGreaterThan(0);
    }
  });

  it("degrades a >25-option select to a message, listing every option", () => {
    const options = Array.from({ length: 26 }, (_, i) => `opt-${i}`);
    const spec = toDiscordControl(prompt({ method: "select", title: "Pick", options }));
    expect(spec.kind).toBe("message");
    expect(spec.select).toBeUndefined();
    // Nothing silently dropped.
    for (const opt of options) expect(spec.content).toContain(opt);
  });

  it("keeps a 25-option select native (boundary)", () => {
    const options = Array.from({ length: 25 }, (_, i) => `opt-${i}`);
    expect(toDiscordControl(prompt({ method: "select", title: "Pick", options })).kind).toBe(
      "string-select",
    );
  });

  it("degrades a select with no options to a message", () => {
    expect(toDiscordControl(prompt({ method: "select", title: "Pick" })).kind).toBe("message");
  });
});

describe("customId codec", () => {
  it("round-trips a short id inline", () => {
    const id = customIdFor("req-1", "confirm", "yes");
    expect(id.length).toBeLessThanOrEqual(DISCORD_CUSTOM_ID_LIMIT);
    expect(parseCustomId(id)).toEqual({ requestId: "req-1", kind: "confirm", value: "yes" });
  });

  it("round-trips a subIndex", () => {
    expect(parseCustomId(customIdFor("r", "k", "v", 7))).toEqual({
      requestId: "r",
      kind: "k",
      value: "v",
      subIndex: 7,
    });
  });

  it("round-trips a 32-char requestId with a long option value within 100 chars", () => {
    const requestId = "a".repeat(32);
    const value = "some extremely long option label ".repeat(6);
    const id = customIdFor(requestId, "select-option", value, 3);
    expect(id.length).toBeLessThanOrEqual(DISCORD_CUSTOM_ID_LIMIT);
    expect(parseCustomId(id)).toEqual({ requestId, kind: "select-option", value, subIndex: 3 });
  });

  it("round-trips values containing the separator and escape characters", () => {
    const id = customIdFor("re|q%1", "ki|nd", "a|b%7Cc%25");
    expect(parseCustomId(id)).toEqual({ requestId: "re|q%1", kind: "ki|nd", value: "a|b%7Cc%25" });
  });

  it("never collides two distinct long records", () => {
    const requestId = "b".repeat(32);
    const a = customIdFor(requestId, "select-option", `${"x".repeat(120)}A`, 0);
    const b = customIdFor(requestId, "select-option", `${"x".repeat(120)}B`, 0);
    expect(a).not.toBe(b);
    expect(parseCustomId(a)?.value).toBe(`${"x".repeat(120)}A`);
    expect(parseCustomId(b)?.value).toBe(`${"x".repeat(120)}B`);
  });

  it("returns null for junk", () => {
    expect(parseCustomId("")).toBeNull();
    expect(parseCustomId("garbage")).toBeNull();
    expect(parseCustomId("p1|only|three")).toBeNull();
    expect(parseCustomId("p2|nope")).toBeNull();
  });
});

describe("chunkForDiscord", () => {
  it("returns [] for empty input", () => {
    expect(chunkForDiscord("")).toEqual([]);
  });

  it("returns one chunk when under the limit", () => {
    expect(chunkForDiscord("hello")).toEqual(["hello"]);
  });

  it("never truncates — chunks rejoin to the original", () => {
    const text = `${"word ".repeat(1200)}\ntail`;
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
  });

  it("prefers the last newline before the limit", () => {
    const text = "aaaa\nbbbb cccc";
    expect(chunkForDiscord(text, 10)).toEqual(["aaaa\n", "bbbb cccc"]);
  });

  it("falls back to the last space when there is no newline", () => {
    const text = "aaaa bbbb cccc";
    const chunks = chunkForDiscord(text, 10);
    expect(chunks[0]).toBe("aaaa bbbb ");
    expect(chunks).toEqual(["aaaa bbbb ", "cccc"]);
    expect(chunks.join("")).toBe(text);
  });

  it("hard-splits a single over-long token", () => {
    const text = "x".repeat(25);
    const chunks = chunkForDiscord(text, 10);
    expect(chunks).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(chunks.join("")).toBe(text);
  });
});

describe("RecordingAdapter", () => {
  it("records outbound calls in order with deterministic ids", async () => {
    const adapter = new RecordingAdapter();
    await adapter.initialize();
    await adapter.start({ onMessage: async () => {} });

    const first = await adapter.sendMessage("c1", "one");
    const second = await adapter.sendMessage("c1", "two");
    expect([first, second]).toEqual(["m1", "m2"]);

    await adapter.editMessage("c1", first, "one-edited");
    await adapter.deleteMessage("c1", second);
    await adapter.setTyping("c1", true);
    const { messageId } = await adapter.sendInteractive(
      "c1",
      prompt({ method: "confirm", title: "ok?" }),
    );
    expect(messageId).toBe("m3");
    await adapter.cleanupInteractive("c1", messageId);

    expect(adapter.sent).toEqual([
      { channelId: "c1", content: "one", id: "m1" },
      { channelId: "c1", content: "two", id: "m2" },
    ]);
    expect(adapter.edited).toEqual([
      { channelId: "c1", messageId: "m1", content: "one-edited" },
    ]);
    expect(adapter.deleted).toEqual(["m2"]);
    expect(adapter.typing).toEqual([{ channelId: "c1", isTyping: true }]);
    expect(adapter.interactive).toHaveLength(1);
    expect(adapter.cleaned).toEqual(["m3"]);
    expect(await adapter.getStatus()).toMatchObject({ connected: true });
  });

  it("drives the registered callbacks and resets", async () => {
    const adapter = new RecordingAdapter();
    const messages: PlatformMessage[] = [];
    const responses: InteractiveResponse[] = [];
    await adapter.start({
      onMessage: async (m) => {
        messages.push(m);
      },
      onInteractiveResponse: (r) => {
        responses.push(r);
      },
    });

    await adapter.emitMessage({
      id: "1",
      platform: "recording",
      channelId: "c1",
      userId: "u1",
      content: "hi",
      timestamp: 0,
    });
    adapter.emitInteractiveResponse({ requestId: "req-1", value: "yes", confirmed: true });

    expect(messages).toHaveLength(1);
    expect(responses).toEqual([{ requestId: "req-1", value: "yes", confirmed: true }]);

    await adapter.sendMessage("c1", "x");
    adapter.reset();
    expect(adapter.sent).toEqual([]);
    expect(await adapter.sendMessage("c1", "y")).toBe("m1");
    expect(adapter.registered).not.toBeNull();

    await adapter.stop();
    expect(await adapter.getStatus()).toMatchObject({ connected: false });
  });
});

const VIEW = 1n << 10n;

describe("channel provisioning payload", () => {
  it("channelNameFor slugifies, never returns empty, and caps at the limit", () => {
    expect(channelNameFor("Platform Team")).toBe("platform-team");
    expect(channelNameFor("  My  Team!! ")).toBe("my-team");
    expect(channelNameFor("a--b")).toBe("a-b");
    expect(channelNameFor("---")).toBe("workspace");
    expect(channelNameFor("!!!")).toBe("workspace");
    expect(channelNameFor("")).toBe("workspace");
    expect(channelNameFor("x".repeat(200))).toHaveLength(100);
  });

  it("channelOverwrites PREPENDS the platform-default-role deny", () => {
    const out = channelOverwrites("guild-1", [
      { targetId: "u1", kind: "member", viewChannel: true },
    ]);
    expect(out[0]).toEqual({ id: "guild-1", type: 0, allow: 0n, deny: VIEW });
    expect(out[1]).toEqual({ id: "u1", type: 1, allow: VIEW, deny: 0n });
  });

  it("channelOverwrites denies a grant flagged viewChannel:false", () => {
    const out = channelOverwrites("g", [{ targetId: "u1", kind: "member", viewChannel: false }]);
    expect(out[1]).toEqual({ id: "u1", type: 1, allow: 0n, deny: VIEW });
  });

  it("an empty access list still denies @everyone — a private channel, always", () => {
    const payload = channelCreatePayload({ guildId: "g", name: "ws", overwrites: [] });
    expect(payload.permissionOverwrites).toEqual([
      { id: "g", type: 0, allow: 0n, deny: VIEW },
    ]);
  });

  it("the create payload carries the overwrites by construction", () => {
    // There is deliberately no create-without-overwrites shape: every create
    // path goes through this function, so the deny cannot be omitted.
    const payload = channelCreatePayload({
      guildId: "g",
      name: "ws",
      overwrites: [{ targetId: "r1", kind: "role", viewChannel: true }],
    });
    expect(payload.name).toBe("ws");
    expect(payload.permissionOverwrites).toHaveLength(2);
    expect(payload.permissionOverwrites[0].deny).toBe(VIEW);
  });
});

// ── Role delegation (task 8.2, F1/F2) ─────────────────────────────────────

describe("assignersForRole", () => {
  const ROLE = { id: "r_ops", position: 5 };
  const member = (id: string, pos: number, canManage: boolean, name?: string) => ({
    id,
    highestRolePosition: pos,
    canManageRoles: canManage,
    ...(name === undefined ? {} : { name }),
  });

  it("always includes the guild owner, who needs no permission", () => {
    // Discord lets the owner assign anything regardless of role position.
    const result = assignersForRole([member("u_owner", -1, false, "boss")], ROLE, "u_owner");
    expect(result).toEqual([{ id: "u_owner", name: "boss" }]);
  });

  it("includes a manager whose highest role sits strictly ABOVE the role", () => {
    const result = assignersForRole([member("u_admin", 9, true, "deputy")], ROLE, "u_owner");
    expect(result).toEqual([{ id: "u_admin", name: "deputy" }]);
  });

  it("EXCLUDES a manager whose highest role EQUALS the role's position", () => {
    // Discord refuses a manager assigning a role at their own level, so naming
    // them would promise a delegation the platform then rejects.
    expect(assignersForRole([member("u_peer", 5, true)], ROLE, "u_owner")).toEqual([]);
  });

  it("excludes a manager below the role and any non-manager above it", () => {
    const result = assignersForRole(
      [member("u_low", 2, true), member("u_flat", 99, false)],
      ROLE,
      "u_owner",
    );
    expect(result).toEqual([]);
  });

  it("omits `name` rather than emitting undefined when a member has none", () => {
    const result = assignersForRole([member("u_x", 9, true)], ROLE, "u_owner");
    expect(result).toEqual([{ id: "u_x" }]);
    expect("name" in result[0]).toBe(false);
  });

  it("returns every qualifying member, owner first only by input order", () => {
    const result = assignersForRole(
      [member("u_a", 9, true), member("u_owner", 3, false), member("u_b", 7, true)],
      ROLE,
      "u_owner",
    );
    expect(result.map((m) => m.id)).toEqual(["u_a", "u_owner", "u_b"]);
  });
});
