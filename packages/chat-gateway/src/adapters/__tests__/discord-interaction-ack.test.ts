/**
 * Discord interaction acknowledgement ordering (task 6.4).
 *
 * The team-controls gate decides WHETHER an activation counts, but it must not
 * re-specify chat-gateway's ack machinery: Discord gives an interaction a hard
 * 3-second window, and the adapter already satisfies it (`deferUpdate` /
 * `deferReply`) BEFORE it emits the response the gate later judges. So a
 * refused activation is already acknowledged and never surfaces as
 * "interaction failed" — and the gate adds no ack of its own.
 *
 * This pins that ordering on the REAL adapter, with a stubbed interaction, so
 * the composition premise cannot rot silently.
 *
 * See change: add-chat-gateway-team-controls.
 */
import { describe, expect, it } from "vitest";
import type { AdapterCallbacks, InteractiveResponse } from "../base.js";
import { DiscordAdapter } from "../discord.js";
import { customIdFor } from "../discord-payload.js";

function stubAdapter(): { order: string[]; seen: InteractiveResponse[]; adapter: DiscordAdapter } {
  const adapter = new DiscordAdapter({ enabled: true, platform: "discord", botToken: "t" });
  const order: string[] = [];
  const seen: InteractiveResponse[] = [];
  // `callbacks` is set by start(); start() needs a live client, so wire the
  // protected field directly — this test is about handleInteraction, not login.
  (adapter as unknown as { callbacks: AdapterCallbacks }).callbacks = {
    onMessage: async () => {},
    onInteractiveResponse: (r) => {
      order.push("emitted");
      seen.push(r);
    },
  };
  return { order, seen, adapter };
}

describe("Discord interaction ack ordering (task 6.4)", () => {
  it("acknowledges a button BEFORE emitting, so a downstream refusal is never 'interaction failed'", async () => {
    const { order, seen, adapter } = stubAdapter();
    const interaction = {
      isButton: () => true,
      customId: customIdFor("req-1", "confirm", "yes"),
      user: { id: "u1" },
      message: { content: "Pick" },
      deferUpdate: async () => {
        order.push("deferred");
      },
      editReply: async () => {},
    };

    await (adapter as unknown as { handleInteraction(i: unknown): Promise<void> }).handleInteraction(
      interaction,
    );

    // The ack happens first — the gate never has to (and must not) do it.
    expect(order[0]).toBe("deferred");
    expect(order).toContain("emitted");
    // The adapter hands the gate the actor's identity, so the gate can refuse.
    expect(seen).toEqual([{ requestId: "req-1", value: "yes", confirmed: true, userId: "u1" }]);
  });

  it("acknowledges a select menu BEFORE emitting", async () => {
    const { order, adapter } = stubAdapter();
    const interaction = {
      isButton: () => false,
      isStringSelectMenu: () => true,
      values: [customIdFor("req-2", "select-option", "beta", 1)],
      user: { id: "u2" },
      message: { content: "Pick" },
      deferUpdate: async () => {
        order.push("deferred");
      },
      editReply: async () => {},
    };

    await (adapter as unknown as { handleInteraction(i: unknown): Promise<void> }).handleInteraction(
      interaction,
    );

    expect(order[0]).toBe("deferred");
    expect(order).toContain("emitted");
  });
});
