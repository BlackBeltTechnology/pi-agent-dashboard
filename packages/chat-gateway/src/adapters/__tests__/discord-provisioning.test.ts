/**
 * Discord adapter — channel provisioning (change: add-chat-gateway-team-controls).
 * Scenarios: X2 (no create-then-patch window), plus the reconcile/rename call
 * shapes.
 *
 * The fixture stubs the adapter's channel-management port at the CALL level, so
 * the full sequence of platform calls is observable with no Discord connection —
 * `create` payloads and (by their absence) permission PATCHes.
 */
import { describe, expect, it } from "vitest";
import { DiscordAdapter, type DiscordChannelOps } from "../discord.js";
import type {
  DiscordChannelCreatePayload,
  DiscordChannelUpdatePayload,
} from "../discord-payload.js";

/** Discord VIEW_CHANNEL. */
const VIEW = 1n << 10n;
const GUILD = "g1";

interface Recorded {
  kind: "create" | "update";
  guildId?: string;
  channelId?: string;
  payload: DiscordChannelCreatePayload | DiscordChannelUpdatePayload;
}

/** The REST stub: records the ordered call sequence. */
class FakeOps implements DiscordChannelOps {
  calls: Recorded[] = [];
  failCreate: string | null = null;

  async create(guildId: string, payload: DiscordChannelCreatePayload) {
    if (this.failCreate) throw new Error(this.failCreate);
    this.calls.push({ kind: "create", guildId, payload });
    return { channelId: "chan-1" };
  }

  async update(channelId: string, payload: DiscordChannelUpdatePayload) {
    this.calls.push({ kind: "update", channelId, payload });
  }

  async guildIdFor(_channelId: string) {
    return GUILD;
  }

  /** Permission PATCHes = updates that touch the access list. */
  get overwritePatches(): Recorded[] {
    return this.calls.filter(
      (c) => c.kind === "update" && "permissionOverwrites" in c.payload,
    );
  }
}

function makeAdapter(ops: FakeOps): DiscordAdapter {
  // No initialize(): the injected ops mean no client, no socket, no login.
  return new DiscordAdapter(
    { enabled: true, platform: "discord", botToken: "not-a-real-token" },
    ops,
  );
}

describe("DiscordAdapter channel provisioning", () => {
  it("X2: the create call itself carries the @everyone deny and no permission PATCH follows", async () => {
    const ops = new FakeOps();
    const adapter = makeAdapter(ops);

    const { channelId } = await adapter.provisionChannel({
      guildId: GUILD,
      name: "Platform Team",
      overwrites: [
        { targetId: "u1", kind: "member", viewChannel: true },
        { targetId: "r1", kind: "role", viewChannel: true },
      ],
    });

    expect(channelId).toBe("chan-1");
    // Exactly ONE call, and it is the create.
    expect(ops.calls).toHaveLength(1);
    expect(ops.calls[0].kind).toBe("create");

    const payload = ops.calls[0].payload as DiscordChannelCreatePayload;
    // The platform-default role (`@everyone`, whose id IS the guild id) is denied
    // view — inside the create payload, where it cannot be missed.
    expect(payload.permissionOverwrites[0]).toEqual({
      id: GUILD,
      type: 0,
      allow: 0n,
      deny: VIEW,
    });
    expect(payload.permissionOverwrites[1]).toEqual({
      id: "u1",
      type: 1,
      allow: VIEW,
      deny: 0n,
    });
    expect(payload.permissionOverwrites[2]).toEqual({
      id: "r1",
      type: 0,
      allow: VIEW,
      deny: 0n,
    });

    // The invariant: zero create-then-patch window.
    expect(ops.overwritePatches).toHaveLength(0);
  });

  it("normalizes the channel name in the create payload", async () => {
    const ops = new FakeOps();
    const adapter = makeAdapter(ops);
    await adapter.provisionChannel({ guildId: GUILD, name: "My  Team!", overwrites: [] });
    const payload = ops.calls[0].payload as DiscordChannelCreatePayload;
    expect(payload.name).toBe("my-team");
  });

  it("a platform that rejects create-with-overwrites creates nothing", async () => {
    const ops = new FakeOps();
    ops.failCreate = "Missing Permissions";
    const adapter = makeAdapter(ops);
    await expect(
      adapter.provisionChannel({ guildId: GUILD, name: "ws", overwrites: [] }),
    ).rejects.toThrow(/Missing Permissions/);
    // No channel was created and no follow-up was attempted.
    expect(ops.calls).toHaveLength(0);
  });

  it("reconcile replaces the access list in ONE update, keeping the channel", async () => {
    const ops = new FakeOps();
    const adapter = makeAdapter(ops);
    await adapter.setChannelOverwrites("chan-1", [
      { targetId: "u2", kind: "member", viewChannel: true },
    ]);

    expect(ops.calls).toHaveLength(1);
    expect(ops.calls[0].kind).toBe("update");
    const payload = ops.calls[0].payload as DiscordChannelUpdatePayload;
    // The deny is re-derived from the channel's own guild, so a reconcile can
    // never drop the @everyone deny by forgetting to pass it.
    expect(payload.permissionOverwrites?.[0]).toEqual({
      id: GUILD,
      type: 0,
      allow: 0n,
      deny: VIEW,
    });
    expect(payload.permissionOverwrites?.[1]).toEqual({
      id: "u2",
      type: 1,
      allow: VIEW,
      deny: 0n,
    });
    // Never a recreate.
    expect(ops.calls.some((c) => c.kind === "create")).toBe(false);
  });

  it("rename sends only the name and never an access list", async () => {
    const ops = new FakeOps();
    const adapter = makeAdapter(ops);
    await adapter.renameChannel("chan-1", "New Name");
    expect(ops.calls).toHaveLength(1);
    expect(ops.calls[0].payload).toEqual({ name: "new-name" });
    expect(ops.overwritePatches).toHaveLength(0);
  });
});
