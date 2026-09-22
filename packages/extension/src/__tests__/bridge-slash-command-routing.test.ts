/**
 * Regression test pinning the slash-command routing contract.
 * Drives `command-handler.handle({type:"send_prompt"...})` against a stub pi
 * and asserts the call counts + emitted command_feedback events.
 *
 * Rewritten by `retire-slash-dispatch-via-expand-prompt-templates`: the retired
 * three-way decision (Path B `pi.dispatchCommand` / Path C
 * `dispatch_extension_command` → server → keeper UDS / Path D tmux error) is
 * replaced by ONE in-process `sendUserMessage(text, {expandPromptTemplates:true,
 * deliverAs})` behind a pi >= 0.84.2 gate. Scenario ids reference `test-plan.md`.
 *
 * regression: see openspec/changes/fix-extension-slash-commands-in-dashboard/
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import { tryDispatchExtensionCommand, _resetDispatchWarnings } from "../slash-dispatch.js";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

interface StubOpts {
  getCommandsThrows?: boolean;
  commands?: Array<{ name: string; source: string }>;
}

function makeStubPi(opts: StubOpts = {}) {
  const sendUserMessage = vi.fn();
  const setSessionName = vi.fn();
  const events = { emit: vi.fn() };
  const getCommands = vi.fn(() => {
    if (opts.getCommandsThrows) throw new Error("stale ctx");
    return (
      opts.commands ?? [
        { name: "ctx-stats", source: "extension" },
        { name: "skill:foo", source: "skill" },
        { name: "review", source: "prompt" },
        { name: "__dashboard_reload", source: "extension" },
      ]
    );
  });
  const pi: any = { sendUserMessage, getCommands, setSessionName, events };
  return { pi, sendUserMessage, getCommands, events };
}

function feedbackEvents(sink: ReturnType<typeof vi.fn>, command: string) {
  return sink.mock.calls
    .map((c) => c[0] as ExtensionToServerMessage)
    .filter(
      (m) =>
        m.type === "event_forward" &&
        (m as any).event?.eventType === "command_feedback" &&
        (m as any).event?.data?.command === command,
    )
    .map((m) => (m as any).event.data);
}

function statuses(sink: ReturnType<typeof vi.fn>, command: string): string[] {
  return feedbackEvents(sink, command).map((e) => e.status);
}

async function drive(
  text: string,
  stub: ReturnType<typeof makeStubPi>,
  delivery?: "steer" | "followUp",
) {
  const sink = vi.fn();
  const handler = createCommandHandler(stub.pi as any, "s1", { eventSink: sink });
  await handler.handle({ type: "send_prompt", sessionId: "s1", text, delivery } as any);
  return sink;
}

describe("bridge slash command routing (regression contract)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // This describe drives the REAL argv-anchored version reader (the
    // command-handler call site takes no injection point), whose verdict while
    // running under vitest is environment-dependent. Silence the warn-once
    // chatter; the gate itself is asserted in the direct-driver describe below.
    _resetDispatchWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("extension cmd → ONE in-process sendUserMessage with expandPromptTemplates; started+completed", async () => {
    // test-plan E1: the dispatch is a single `pi.sendUserMessage` call; the old
    // headless-only RPC hand-off (connection.send) no longer exists.
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(stub.sendUserMessage).toHaveBeenCalledWith("/ctx-stats", {
      expandPromptTemplates: true,
      deliverAs: "followUp",
    });
    expect(statuses(sink, "/ctx-stats")).toEqual(["started", "completed"]);
    // No retired transport message is emitted on any path.
    expect(
      sink.mock.calls.filter((c) => (c[0] as any)?.type === "dispatch_extension_command"),
    ).toEqual([]);
  });

  it("extension cmd + delivery: steer → deliverAs: steer", async () => {
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub, "steer");

    expect(stub.sendUserMessage).toHaveBeenCalledWith("/ctx-stats", {
      expandPromptTemplates: true,
      deliverAs: "steer",
    });
    expect(statuses(sink, "/ctx-stats")).toEqual(["started", "completed"]);
  });

  it("extension cmd never reports a session-shape / pi-version-0.71 error", async () => {
    // test-plan E2: identical outcome regardless of session shape — the retired
    // Path D's tmux/Windows-Terminal refusal is gone.
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub);

    const messages = feedbackEvents(sink, "/ctx-stats").map((e) => e.message ?? "");
    expect(messages.some((m) => /session shape|RPC keeper|0\.71\+/.test(m))).toBe(false);
    expect(statuses(sink, "/ctx-stats")).not.toContain("error");
  });

  it("skill command → no command_feedback, plain sendUserMessage fallback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/skill:foo", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/skill:foo")).toEqual([]);
  });

  it("prompt template → no command_feedback, plain sendUserMessage fallback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/review", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/review")).toEqual([]);
  });

  it("passthrough text → plain sendUserMessage, no command_feedback", async () => {
    const stub = makeStubPi();
    const sink = await drive("hello world", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses(sink, "hello world")).toEqual([]);
  });

  it("unrecognized slash → plain sendUserMessage, no command_feedback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/totally-unknown-command", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/totally-unknown-command")).toEqual([]);
  });

  it("bridge-native /__dashboard_reload → no command_feedback, plain sendUserMessage fallback", async () => {
    // test-plan E12: it IS registered with source:"extension", but the
    // `__`-prefix exclusion in isExtensionSlashCommand suppresses it.
    const stub = makeStubPi();
    const sink = await drive("/__dashboard_reload", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/__dashboard_reload")).toEqual([]);
  });

  it("getCommands throws → no crash, no command_feedback, sendUserMessage fallback fires", async () => {
    // test-plan X3.
    const stub = makeStubPi({ getCommandsThrows: true });
    const sink = await drive("/ctx-stats", stub);

    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/ctx-stats")).toEqual([]);
  });

  it("never duplicates command_feedback on the dispatch path", async () => {
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub);
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.filter((e) => e.status === "started")).toHaveLength(1);
    expect(evs.filter((e) => e.status === "completed" || e.status === "error")).toHaveLength(1);
  });
});

/**
 * Direct-driver tests for `tryDispatchExtensionCommand`: the pi >= 0.84.2 gate,
 * the single in-process call, and the exactly-one-terminal invariant.
 * The version reader is injectable, so every gate branch is deterministic here.
 */
describe("tryDispatchExtensionCommand: version gate + one in-process call", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetDispatchWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  function makePi(
    sendImpl?: (text: string, opts: unknown) => void,
    commands: Array<{ name: string; source: string }> = [
      { name: "ctx-stats", source: "extension" },
    ],
  ) {
    const sendUserMessage = sendImpl ? vi.fn(sendImpl) : vi.fn();
    return { pi: { getCommands: () => commands, sendUserMessage }, sendUserMessage };
  }

  function makeSink() {
    const events: any[] = [];
    return {
      events,
      sink: (m: any) => events.push(m),
      statuses: () =>
        events
          .filter((m) => m?.event?.eventType === "command_feedback")
          .map((m) => m.event.data.status),
      data: () =>
        events
          .filter((m) => m?.event?.eventType === "command_feedback")
          .map((m) => m.event.data),
    };
  }

  it("E1: headless session, version 0.86.1 → sendUserMessage with expandPromptTemplates, [started, completed]", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses, events } = makeSink();

    const handled = await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      "followUp",
      () => "0.86.1",
    );

    expect(handled).toBe(true);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith("/ctx-stats", {
      expandPromptTemplates: true,
      deliverAs: "followUp",
    });
    expect(statuses()).toEqual(["started", "completed"]);
    expect(events.filter((m) => m?.type === "dispatch_extension_command")).toEqual([]);
  });

  it("E2: non-headless env + argv → byte-identical outcome (no session-shape refusal)", async () => {
    const prevFlag = process.env.PI_DASHBOARD_SPAWNED;
    const prevArgv = process.argv;
    delete process.env.PI_DASHBOARD_SPAWNED;
    process.argv = ["node", "pi"];
    try {
      const { pi, sendUserMessage } = makePi();
      const { sink, data, statuses } = makeSink();

      const handled = await tryDispatchExtensionCommand(
        pi,
        "/ctx-stats",
        "sid",
        sink,
        undefined,
        () => "0.86.1",
      );

      expect(handled).toBe(true);
      expect(sendUserMessage).toHaveBeenCalledWith("/ctx-stats", {
        expandPromptTemplates: true,
        deliverAs: "followUp",
      });
      expect(statuses()).toEqual(["started", "completed"]);
      expect(
        data().some((d) => /session shape|RPC keeper|require pi 0\.71\+/.test(d.message ?? "")),
      ).toBe(false);
    } finally {
      if (prevFlag === undefined) delete process.env.PI_DASHBOARD_SPAWNED;
      else process.env.PI_DASHBOARD_SPAWNED = prevFlag;
      process.argv = prevArgv;
    }
  });

  it("E3: delivery 'steer' → deliverAs 'steer'", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, "steer", () => "0.86.1");

    expect(sendUserMessage).toHaveBeenCalledWith("/ctx-stats", {
      expandPromptTemplates: true,
      deliverAs: "steer",
    });
  });

  it("E4: delivery omitted → deliverAs 'followUp'", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "0.86.1");

    expect(sendUserMessage.mock.calls[0][1]).toMatchObject({ deliverAs: "followUp" });
  });

  it("E5: min-minus-one (0.84.1) → [started, error] naming the required version, no sendUserMessage", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses, data } = makeSink();

    const handled = await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      undefined,
      () => "0.84.1",
    );

    expect(handled).toBe(true);
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(statuses()).toEqual(["started", "error"]);
    expect(data()[1].message).toContain("require pi 0.84.2+");
  });

  it("E6: exact minimum (0.84.2) → dispatched", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "0.84.2");

    expect(sendUserMessage.mock.calls[0][1]).toMatchObject({ expandPromptTemplates: true });
    expect(statuses()).toEqual(["started", "completed"]);
  });

  it("E7: just-above minimum (0.84.3) → dispatched", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "0.84.3");

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
  });

  it("E8: old mariozechner 0.73.1 → [started, error]", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses, data } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "0.73.1");

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(statuses()).toEqual(["started", "error"]);
    expect(data()[1].message).toContain("require pi 0.84.2+");
  });

  it("E10: reader returns undefined twice → dispatched, exactly one console.warn", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => undefined);
    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => undefined);

    expect(sendUserMessage).toHaveBeenCalledTimes(2);
    expect(statuses()).toEqual(["started", "completed", "started", "completed"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("could not determine the running pi version");
  });

  it("E11: unparseable 'dev' → dispatched (treated as new), one distinct warn, NOT error", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "dev");

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('unrecognized pi version "dev"');
  });

  it("E5b: a PRE-RELEASE of the floor (0.84.2-beta.1) is below it → [started, error]", async () => {
    // SemVer orders a prerelease under its final release, and the feature may
    // only have landed in that final release. Treating it as equal would wave an
    // unsupported build through the gate.
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses, data } = makeSink();

    await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      undefined,
      () => "0.84.2-beta.1",
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(statuses()).toEqual(["started", "error"]);
    expect(data()[1].message).toContain("require pi 0.84.2+");
  });

  it("E6b: a prerelease ABOVE the floor (0.85.0-rc.1) dispatches", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      undefined,
      () => "0.85.0-rc.1",
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
  });

  it("E6c: build metadata (0.84.2+build.9) is at the floor → dispatched", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      undefined,
      () => "0.84.2+build.9",
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
  });

  it("E11b: trailing junk (0.84.2garbage) is UNPARSEABLE → dispatched + one warn", async () => {
    // A loose prefix match would read this as a clean 0.84.2 triplet. The
    // unparseable branch (warn + assume new) is the design's documented outcome.
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    await tryDispatchExtensionCommand(
      pi,
      "/ctx-stats",
      "sid",
      sink,
      undefined,
      () => "0.84.2garbage",
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('unrecognized pi version "0.84.2garbage"');
  });

  it("X1: sendUserMessage throws → [started, error] with that message, no completed, returns true", async () => {
    const { pi } = makePi(() => {
      throw new Error("Extension context is stale");
    });
    const { sink, statuses, data } = makeSink();

    let handled: boolean | undefined;
    await expect(
      (async () => {
        handled = await tryDispatchExtensionCommand(
          pi,
          "/ctx-stats",
          "sid",
          sink,
          undefined,
          () => "0.86.1",
        );
      })(),
    ).resolves.not.toThrow();

    expect(handled).toBe(true);
    expect(statuses()).toEqual(["started", "error"]);
    expect(data()[1].message).toBe("Extension context is stale");
  });

  it("X2: version reader throws → [started, completed], dispatched, no unhandled rejection", async () => {
    const { pi, sendUserMessage } = makePi();
    const { sink, statuses } = makeSink();

    let handled: boolean | undefined;
    await expect(
      (async () => {
        handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => {
          throw new Error("resolve exploded");
        });
      })(),
    ).resolves.not.toThrow();

    expect(handled).toBe(true);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["started", "completed"]);
  });

  it("X3: getCommands throws → returns false, empty sink", async () => {
    const pi: any = {
      getCommands: () => {
        throw new Error("stale ctx");
      },
      sendUserMessage: vi.fn(),
    };
    const { sink, events } = makeSink();

    const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, () => "0.86.1");

    expect(handled).toBe(false);
    expect(events).toEqual([]);
  });

  it("non-extension /skill:foo → returns false; no call, no events", async () => {
    const { pi, sendUserMessage } = makePi(undefined, [{ name: "skill:foo", source: "skill" }]);
    const { sink, events } = makeSink();

    const handled = await tryDispatchExtensionCommand(pi, "/skill:foo", "sid", sink, undefined, () => "0.86.1");

    expect(handled).toBe(false);
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("E18: exactly one started and one terminal, in order, across gate/dispatch/fault sinks", async () => {
    type Scenario = {
      name: string;
      sendImpl?: () => void;
      readVersion: () => string | undefined;
    };
    const scenarios: Scenario[] = [
      { name: "E1 dispatch", readVersion: () => "0.86.1" },
      { name: "E5 too old", readVersion: () => "0.84.1" },
      { name: "E5b floor prerelease", readVersion: () => "0.84.2-beta.1" },
      { name: "E10 undefined", readVersion: () => undefined },
      {
        name: "X1 sync throw",
        sendImpl: () => {
          throw new Error("boom");
        },
        readVersion: () => "0.86.1",
      },
      {
        name: "X2 reader throw",
        readVersion: () => {
          throw new Error("boom");
        },
      },
    ];

    for (const s of scenarios) {
      const { pi } = makePi(s.sendImpl);
      const { sink, statuses } = makeSink();

      await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined, s.readVersion);

      const got = statuses();
      expect(got.filter((x) => x === "started"), s.name).toHaveLength(1);
      expect(got.filter((x) => x === "completed" || x === "error"), s.name).toHaveLength(1);
      expect(got[0], s.name).toBe("started");
      expect(got[1], s.name).not.toBe("started");
    }
  });
});

// See change: add-steering-message (task 4.4).
// Verify the slash-routing fallback paths that call sendUserMessage honor the
// delivery field — `"steer"` → deliverAs:"steer"; absent/"followUp" → deliverAs:"followUp".
describe("bridge slash routing: delivery field → sendUserMessage deliverAs", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    _resetDispatchWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  function lastDeliverAs(sendUserMessage: ReturnType<typeof vi.fn>): string | undefined {
    const lastCall = sendUserMessage.mock.calls.at(-1);
    if (!lastCall) return undefined;
    const opts = lastCall[1];
    return opts?.deliverAs;
  }

  it("skill command + delivery:'steer' → sendUserMessage called with deliverAs:'steer'", async () => {
    const stub = makeStubPi();
    await drive("/skill:foo", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("skill command + delivery:'followUp' → sendUserMessage called with deliverAs:'followUp'", async () => {
    const stub = makeStubPi();
    await drive("/skill:foo", stub, "followUp");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("skill command + delivery omitted → sendUserMessage defaults to deliverAs:'followUp'", async () => {
    const stub = makeStubPi();
    await drive("/skill:foo", stub);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("prompt template + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi();
    await drive("/review", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("passthrough text + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi();
    await drive("hello world", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("passthrough text + delivery omitted → deliverAs:'followUp'", async () => {
    const stub = makeStubPi();
    await drive("hello world", stub);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("unrecognized slash + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi();
    await drive("/totally-unknown-command", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("bridge-native /__dashboard_reload fallback + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi();
    await drive("/__dashboard_reload", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("getCommands throws fallback + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ getCommandsThrows: true });
    await drive("/ctx-stats", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });
});
