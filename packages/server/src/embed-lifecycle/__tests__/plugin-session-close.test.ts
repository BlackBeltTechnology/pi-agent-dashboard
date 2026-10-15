/**
 * Plugin close API + scope (test-plan #E12, #E13, #E16, #E19, #X4):
 * `requestSessionClose` acts only on sessions the calling (trusted) plugin
 * declared, `now` closes through the graceful ladder without a closer consult,
 * refusals warn once each, untrusted plugins get no-ops, a disabled owner's
 * closer is not consulted, and no other close path reaches the closer.
 * See change: add-session-close-plugin-hook.
 *
 * @structural-pin closer-scope guard: the closer registry must only be wired to the reaper and the plugin close API in server.ts, never a shutdown/abort/watchdog/socket path; a wiring fact over source text
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createEmbedLifecycleController } from "../embed-lifecycle-controller.js";
import { createPluginSessionCloseApi, createSessionCloserRegistry } from "../plugin-session-close.js";

const NOW = Date.now();

function sess(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/w",
    pid: 4242,
    source: "dashboard",
    status: "idle",
    startedAt: NOW - 3_600_000,
    lastActivityAt: NOW - 3_600_000,
    closePolicy: { owner: "team", idleAfterMs: 1000, mode: "sleep" },
    ...over,
  } as DashboardSession;
}

function api(sessions: DashboardSession[], pluginId = "team", trusted = true, closeOk = true) {
  const registry = createSessionCloserRegistry();
  const calls = { kills: [] as string[], archived: [] as string[], restored: [] as string[], warns: [] as string[], requests: 0 };
  const a = createPluginSessionCloseApi(
    {
      registry,
      getSession: (id) => sessions.find((s) => s.id === id),
      closeNow: async (id) => {
        calls.kills.push(id);
        return closeOk;
      },
      markArchiveOnEnd: (id, value = true) => (value ? calls.archived : calls.restored).push(id),
      onCloseRequest: () => {
        calls.requests += 1;
      },
      log: () => {},
      warn: (m) => calls.warns.push(m),
    },
    pluginId,
    trusted,
  );
  return { a, registry, calls };
}

describe("requestSessionClose", () => {
  it("E13: when:now closes through the graceful shutdown + terminator path, no closer consult (test-plan #E13)", async () => {
    const { a, registry, calls } = api([sess()]);
    let asked = 0;
    a.registerSessionCloser(() => {
      asked += 1;
      return "keep";
    });
    expect(registry.get("team")).toBeTypeOf("function");
    expect(await a.requestSessionClose({ sessionId: "s1", reason: "owner_revoked", when: "now" })).toBe(true);
    expect(calls.kills).toEqual(["s1"]);
    expect(asked).toBe(0);
    expect(calls.requests).toBe(1);
  });

  it("E13: when:now on an archive-mode session marks archive-on-end", async () => {
    const { a, calls } = api([sess({ closePolicy: { owner: "team", mode: "archive" } })]);
    await a.requestSessionClose({ sessionId: "s1", reason: "x", when: "now" });
    expect(calls.archived).toEqual(["s1"]);
    expect(calls.restored).toEqual([]);
  });

  it("E13: a failed when:now close rolls the archive mark back (PR #923 review)", async () => {
    const { a, calls } = api([sess({ closePolicy: { owner: "team", mode: "archive" } })], "team", true, false);
    expect(await a.requestSessionClose({ sessionId: "s1", reason: "x", when: "now" })).toBe(false);
    expect(calls.archived).toEqual(["s1"]);
    expect(calls.restored).toEqual(["s1"]);
  });

  it("when:idle records a request instead of killing", async () => {
    const { a, registry, calls } = api([sess()]);
    expect(await a.requestSessionClose({ sessionId: "s1", reason: "x", when: "idle" })).toBe(true);
    expect(registry.isCloseRequested("s1")).toBe(true);
    expect(calls.kills).toEqual([]);
  });

  it.each<[string, DashboardSession[], string, string]>([
    ["other plugin's session", [sess({ closePolicy: { owner: "other", mode: "sleep" } })], "s1", "now"],
    ["undeclared session", [sess({ closePolicy: undefined })], "s1", "now"],
    ["unknown session", [], "nope", "now"],
    ["ended session", [sess({ status: "ended" })], "s1", "now"],
    ["invalid when", [sess()], "s1", "later"],
  ])("E16: refuses %s with exactly one warning (test-plan #E16)", async (_n, sessions, id, when) => {
    const { a, registry, calls } = api(sessions);
    expect(await a.requestSessionClose({ sessionId: id, reason: "x", when: when as "now" })).toBe(false);
    expect(calls.kills).toEqual([]);
    expect(registry.isCloseRequested(id)).toBe(false);
    expect(calls.warns).toHaveLength(1);
    expect(calls.requests).toBe(0);
  });

  it("E19: untrusted plugin — closer never registered, request refused (test-plan #E19)", async () => {
    const { a, registry, calls } = api([sess()], "team", false);
    a.registerSessionCloser(() => "keep");
    expect(registry.get("team")).toBeUndefined();
    expect(await a.requestSessionClose({ sessionId: "s1", reason: "x", when: "now" })).toBe(false);
    expect(calls.kills).toEqual([]);
  });
});

describe("controller wiring", () => {
  it("X4: a disabled owner's closer is not consulted (no closer ⇒ close) (test-plan #X4)", async () => {
    const registry = createSessionCloserRegistry();
    let asked = 0;
    registry.register("team", () => {
      asked += 1;
      return "keep";
    });
    const kills: string[] = [];
    const ctl = createEmbedLifecycleController({
      config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: false }),
      listSessions: () => [sess()],
      getSubscriberCount: () => 0,
      listTerminalCwds: () => [],
      hasPendingUiRequest: () => false,
      terminate: async (id) => {
        kills.push(id);
        return { outcome: "confirmed-dead" as const, terminated: true };
      },
      sendStopAfterTurn: () => true,
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
      closers: registry,
      isPluginEnabled: () => false,
      log: () => {},
    });
    await ctl.reaper.sweepOnce();
    expect(asked).toBe(0);
    expect(kills).toEqual(["s1"]);
    expect(ctl.snapshot().declaredReaps).toBe(1);
  });

  it("E12: only the reaper and the plugin close API reach the closer registry (test-plan #E12)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../server.ts"), "utf8");
    const uses = src.split("\n").filter((l) => /\bsessionClosers\b/.test(l));
    // Declaration + controller dep + plugin close API dep — never shutdown/abort/watchdog/socket paths.
    expect(uses.map((l) => l.trim())).toEqual([
      "const sessionClosers = createSessionCloserRegistry();",
      "closers: sessionClosers,",
      "registry: sessionClosers,",
    ]);
  });
});
