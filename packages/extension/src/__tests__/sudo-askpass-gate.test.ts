/**
 * Anti-accident gate (D7), attribution (D4), sticky Cancel, late/stray answers,
 * timeout, single pending. The gate is NOT security: it stops stray or mistaken
 * helper requests. See change: add-sudo-credential-prompt (test-plan #S11-#S13,
 * #S18-#S25, #S76).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, pollUntil, settle, type Harness } from "./sudo-askpass-harness.js";

let h: Harness;

beforeEach(async () => {
  h = createHarness();
  await h.install();
});
afterEach(() => {
  vi.useRealTimers();
  h.dispose();
});

/** A user_bash exec that stays in flight until released. */
function startUserBash(command: string): () => void {
  let release!: () => void;
  const ops = h.ctl.trackUserBash({ exec: () => new Promise((res) => (release = () => res({ exitCode: 0 }))) });
  void ops.exec(command, "/tmp", { onData: () => {} });
  return () => release();
}

describe("anti-accident gate matrix (#S11)", () => {
  const bools = [false, true];
  const rows: Array<[boolean, boolean, boolean, boolean, boolean]> = [];
  for (const bash of bools) for (const user of bools) for (const pending of bools) for (const cancelBlocked of bools) for (const connected of bools) {
    const nothingInFlight = !bash && !user;
    if (nothingInFlight && (pending || cancelBlocked)) continue; // impossible: n/a
    if (pending && cancelBlocked) continue; // impossible: a Cancel-blocked state refuses, so nothing can be pending
    rows.push([bash, user, pending, cancelBlocked, connected]);
  }

  it.each(rows)("bash=%s user_bash=%s pending=%s cancelBlocked=%s connected=%s", async (bash, user, pending, cancelBlocked, connected) => {
    if (bash) h.startTool("A", "sleep 30 && sudo true");
    if (user) startUserBash("sudo -v");
    if (cancelBlocked) {
      const first = h.ask("p", 1);
      await pollUntil(() => h.requests().length === 1);
      h.cancel(h.requests()[0].callId);
      expect(await first).toEqual({ ok: false });
    }
    let firstPending: Promise<unknown> | undefined;
    if (pending) {
      firstPending = h.ask("p1", 2);
      await pollUntil(() => h.requests().length === 1);
    }
    h.link.connected = connected;
    const before = h.requests().length;

    const reply = h.ask("p2", 3);
    const served = (bash || user) && !pending && !cancelBlocked && connected;
    if (served) {
      await pollUntil(() => h.requests().length === before + 1);
      h.respond(h.requests()[before].callId, "pw");
      expect(await reply).toEqual({ ok: true, password: "pw" });
    } else {
      expect(await reply).toEqual({ ok: false });
      await settle();
      expect(h.requests().length).toBe(before);
    }
    void firstPending;
  });
});

describe("direct $SUDO_ASKPASS (#S12) and concurrency attribution (#S13)", () => {
  it("serves a bare askpass call like any request: exact command and prompt text", async () => {
    h.startTool("A", `"$SUDO_ASKPASS" "Enter PIN"`);
    const reply = h.ask("Enter PIN", 7);
    await pollUntil(() => h.requests().length === 1);
    expect(h.requests()[0]).toMatchObject({ commands: [`"$SUDO_ASKPASS" "Enter PIN"`], prompt: "Enter PIN" });
    h.respond(h.requests()[0].callId, "1234");
    expect(await reply).toEqual({ ok: true, password: "1234" });
  });

  it("lists every command in flight, in start order, with no single-call attribution", async () => {
    h.startTool("A", "sleep 30 && sudo true");
    startUserBash("echo hi; sudo -v");
    void h.ask("p", 7);
    await pollUntil(() => h.requests().length === 1);
    const req = h.requests()[0];
    expect(req.commands).toEqual(["sleep 30 && sudo true", "echo hi; sudo -v"]);
    expect(Object.keys(req).sort()).toEqual(["callId", "commands", "prompt", "sessionId", "type"]);
  });
});

describe("sticky Cancel (#S18) and non-sticky refusals (#S19)", () => {
  it("covers every call in flight at Cancel time, not later calls", async () => {
    h.startTool("A", "sudo a");
    h.startTool("B", "sudo b");
    const first = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    h.cancel(h.requests()[0].callId);
    expect(await first).toEqual({ ok: false }); // (1) helper aborts, no retry

    expect(await h.ask("p", 2)).toEqual({ ok: false }); // (2) refused at once
    expect(h.requests().length).toBe(1);

    h.startTool("C", "sudo c"); // (3) C is not covered
    const third = h.ask("p", 3);
    await pollUntil(() => h.requests().length === 2);
    expect(h.requests()[1].commands).toEqual(["sudo a", "sudo b", "sudo c"]);
    h.cancel(h.requests()[1].callId, "unanswerable");
    await third;

    h.endTool("A");
    h.endTool("B");
    h.endTool("C");
    h.startTool("D", "sudo d"); // (4)
    void h.ask("p", 4);
    await pollUntil(() => h.requests().length === 3);
    expect(h.requests()[2].commands).toEqual(["sudo d"]);
  });

  it("an 'unanswerable' refusal frees the slot and is not sticky", async () => {
    h.startTool("A", "sudo a");
    const first = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    h.cancel(h.requests()[0].callId, "unanswerable");
    expect(await first).toEqual({ ok: false });
    void h.ask("p", 2);
    await pollUntil(() => h.requests().length === 2);
  });
});

describe("late and stray answers are dropped (#S23)", () => {
  const dropped = async (): Promise<void> => {
    await settle();
    expect(h.registered).toEqual([]);
    expect(h.ctl.debug.cacheBuffer()).toBeUndefined();
    expect(h.cacheFrames()).toEqual([]);
  };

  it("(a) after the bridge timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.startTool("A", "sudo a");
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    vi.advanceTimersByTime(120_001);
    expect(await reply).toEqual({ ok: false });
    h.respond(callId, "late");
    await dropped();
  });

  it("(b) after the helper socket closed", async () => {
    h.startTool("A", "sudo a");
    const sock = (await import("node:net")).createConnection(h.ctl.socketPath() as string);
    sock.on("error", () => {});
    sock.write(`${JSON.stringify({ promptText: "p", ppid: 1 })}\n`);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    sock.destroy();
    await pollUntil(() => h.frames.some((f) => f.type === "sudo_credential_dismiss"));
    h.respond(callId, "late");
    await dropped();
  });

  it("(c/d) after tool_execution_end (an abort ends the call the same way)", async () => {
    h.startTool("A", "sudo a");
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    h.endTool("A"); // abort also ends the call
    expect(await reply).toEqual({ ok: false });
    expect(h.frames.some((f) => f.type === "sudo_credential_dismiss" && f.callId === callId)).toBe(true);
    h.respond(callId, "late");
    await dropped();
  });

  it("(e) wrong callId and (f) replay of an accepted callId", async () => {
    h.startTool("A", "sudo a");
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    h.cfg.cacheMinutes = 0;
    h.respond("not-the-callId", "stray");
    await settle();
    expect(h.registered).toEqual([]);
    h.respond(callId, "good");
    expect(await reply).toEqual({ ok: true, password: "good" });
    h.respond(callId, "replay");
    await settle();
    expect(h.registered).toEqual(["good"]); // the replay was not registered
    // the next sudo raises a modal again
    void h.ask("p", 2);
    await pollUntil(() => h.requests().length === 2);
  });
});

describe("per-prompt timeout (#S24)", () => {
  it("answers at +119 000 ms are delivered; silence until +121 000 ms dismisses, non-sticky", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.cfg.cacheMinutes = 0;
    h.startTool("A", "sudo a");
    const answered = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    vi.advanceTimersByTime(119_000);
    h.respond(h.requests()[0].callId, "on-time");
    expect(await answered).toEqual({ ok: true, password: "on-time" });

    const silent = h.ask("p", 2);
    await pollUntil(() => h.requests().length === 2);
    const { callId } = h.requests()[1];
    vi.advanceTimersByTime(121_000);
    expect(await silent).toEqual({ ok: false });
    expect(h.frames.some((f) => f.type === "sudo_credential_dismiss" && f.callId === callId)).toBe(true);
    expect(h.ctl.debug.pendingCallId()).toBeUndefined(); // slot freed
    void h.ask("p", 3); // not sticky: a modal again
    await pollUntil(() => h.requests().length === 3);
  });
});

describe("single pending (#S25) and cancel-vs-answer race (#S76)", () => {
  it("refuses a second request at once, leaves the first answerable, then serves the next", async () => {
    h.startTool("A", "sudo a");
    const first = h.ask("p1", 1);
    await pollUntil(() => h.requests().length === 1);
    expect(await h.ask("p2", 2)).toEqual({ ok: false });
    expect(h.requests().length).toBe(1);
    h.respond(h.requests()[0].callId, "pw1");
    expect(await first).toEqual({ ok: true, password: "pw1" });
    h.forget(); // drop the cached entry so the next sudo prompts
    void h.ask("p3", 3);
    await pollUntil(() => h.requests().length === 2);
  });

  it("cancel first: helper aborts, answer neither registered nor cached", async () => {
    h.startTool("A", "sudo a");
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    h.cancel(callId);
    h.respond(callId, "pw");
    expect(await reply).toEqual({ ok: false });
    expect(h.registered).toEqual([]);
    expect(h.ctl.debug.cacheBuffer()).toBeUndefined();
  });

  it("answer first: helper gets it, the later cancel is ignored and not sticky", async () => {
    h.startTool("A", "sudo a");
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    h.respond(callId, "pw");
    h.cancel(callId);
    expect(await reply).toEqual({ ok: true, password: "pw" });
    h.forget();
    void h.ask("p", 2);
    await pollUntil(() => h.requests().length === 2);
  });
});
