/**
 * Setup run lifecycle (test-plan #R7, #R12, #R13, #R17; tasks 2.4, 2.7): browser
 * closed under the run, cancel, busy + atomic takeover, other refusals, saved
 * inputs, per-step log lines, and that no secret reaches a log, a run view or a
 * route response. See change: add-gmail-auto-setup.
 */
import { describe, expect, it } from "vitest";
import {
  autopilot,
  EXISTING,
  type Harness,
  makeHarness,
  OWNER,
  preset,
  startExisting,
  until,
} from "../../__tests__/setup-harness.js";
import { acctKey } from "../accounts.js";
import { SetupRunManager } from "../setup/run.js";
import { PATHS } from "../setup/steps.js";

const SECRET_RE = /GOCSPX-[A-Za-z0-9_-]{4,}/;
/** Any `GOCSPX-<4+ chars>` that is not the mask. */
function leaks(text: string): string[] {
  return (text.match(/GOCSPX-[A-Za-z0-9_*-]{1,}/g) ?? []).filter((m) => m !== "GOCSPX-***");
}

describe("R7 browser closed / cancel", () => {
  it("(a) the browser side closes the socket mid-api → handoff browser_closed @ api / 1, instance disconnected", async () => {
    const h = await makeHarness();
    preset(h.console, "project");
    // The api step is stuck so the close lands mid-step.
    h.console.hang = (method, u) => method === "Accessibility.queryAXTree" && u.pathname === PATHS.apiOverview;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.step === "api" && v.steps[1]?.status === "running");
    h.console.serverClose();
    const v = await until(() => h.view(id), (x) => x.state === "handoff");
    expect(v.handoff).toEqual({ step: "api", wizardStep: 1, reason: "browser_closed" });
    await until(() => h.browser.calls.disconnect, (d) => d.length > 0);
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });

  it("(a2) the close lands during a human wait (decision) → browser_closed too", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    h.console.serverClose();
    const v = await until(() => h.view(id), (x) => x.state === "handoff");
    expect(v.handoff).toMatchObject({ step: "branding", wizardStep: 2, reason: "browser_closed" });
  });

  it("(b) DELETE cancels the run and disconnects the instance; the socket is closed", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    const r = await h.del(`/setup/run/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().state).toBe("cancelled");
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
    expect(h.console.socketClosed).toBe(true);
    // The run stays cancelled (no late hand-off overwrites it) and a repeat DELETE is harmless.
    expect((await h.view(id)).state).toBe("cancelled");
    expect((await h.del(`/setup/run/${id}`)).json().state).toBe("cancelled");
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });

  it("cancel while waiting on the busy profile never disconnects the holder's instance", async () => {
    const h = await makeHarness({ browser: { busyHolder: "agent-session" } });
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "busy");
    expect((await h.del(`/setup/run/${id}`)).json().state).toBe("cancelled");
    expect(h.browser.calls.disconnect).toEqual([]);
  });
});

describe("R12 busy profile + takeover", () => {
  it("busy view names the holder, never the instance id; takeover is atomic, private and ephemeral; the run continues", async () => {
    const h = await makeHarness({ browser: { busyHolder: "session-S" } });
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    const busy = await until(() => h.view(id), (v) => v.state === "busy");
    expect(busy.busy).toEqual({ holder: "session-S" });
    expect(JSON.stringify(busy)).not.toContain("holder-instance");
    expect(h.browser.calls.connect[0]).toEqual({ client: "gmail-setup", private: true, ephemeral: true });
    expect(h.browser.calls.connect).toHaveLength(1); // no takeover until the user confirms

    const r = await h.post(`/setup/run/${id}/takeover`);
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toContain("holder-instance");
    const v = await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect(v.step).toBe("branding");
    expect(h.browser.calls.connect[1]).toEqual({ client: "gmail-setup", takeover: true, private: true, ephemeral: true });
    expect(h.browser.calls.connect).toHaveLength(2);
    const done = await autopilot(h, id);
    expect(done.state).toBe("done");
  });

  it("takeover when the run is not busy → 409 not_busy and no second connect", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    const r = await h.post(`/setup/run/${id}/takeover`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("not_busy");
    expect(h.browser.calls.connect).toHaveLength(1);
  });

  it("a plain connect is private and ephemeral (the dialog is never streamed, the context is discarded)", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    expect(h.browser.calls.connect).toEqual([{ client: "gmail-setup", private: true, ephemeral: true }]);
  });
});

describe("R13 other dedicated-browser refusals", () => {
  const reasons = ["disabled", "unloaded", "no-chrome", "no-display", "owned-by-other-server", "profile-in-use", "launch-failed"] as const;
  for (const reason of reasons) {
    it(`${reason} → handoff @ project / 1 with that reason`, async () => {
      const h = await makeHarness({ browser: { refuse: reason } });
      const id = await startExisting(h);
      const v = await until(() => h.view(id), (x) => x.state === "handoff");
      expect(v.handoff).toEqual({ step: "project", wizardStep: 1, reason });
      expect(v.steps[0]?.status).toBe("handoff");
      expect(h.browser.calls.disconnect).toEqual([]); // nothing was connected
    });
  }

  it("the service gone when the run connects (unloaded after the availability check) → handoff unloaded @ project", async () => {
    const h = await makeHarness({ noService: true });
    const run = new SetupRunManager(h.deps).start({ mode: "existing", projectId: "my-proj-123", ownerEmail: OWNER });
    await run?.settled;
    expect(run?.view().handoff).toEqual({ step: "project", wizardStep: 1, reason: "unloaded" });
  });
});

describe("task 2.4 run bookkeeping", () => {
  it("saves projectId + ownerAccount to the plugin config at start", async () => {
    const h = await makeHarness();
    await startExisting(h);
    await until(() => h.configUpdates, (u) => u.length > 0);
    expect(h.configUpdates[0]).toEqual({ projectId: "pi-dashboard-abc123", ownerAccount: OWNER });
    expect(h.pluginConfig).toMatchObject({ projectId: "pi-dashboard-abc123", ownerAccount: OWNER });
  });

  it("logs one masked line per step: id, outcome, ms", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    const stepLines = h.logger.lines.filter((l) => l.startsWith("[gmail] setup step"));
    expect(stepLines).toHaveLength(6);
    for (const id of ["project", "api", "branding", "publish", "client", "capture"]) {
      expect(stepLines.filter((l) => l.startsWith(`[gmail] setup step ${id} `))).toHaveLength(1);
    }
    for (const l of stepLines) expect(l).toMatch(/^\[gmail\] setup step (project|api|branding|publish|client|capture) (done|skipped|handoff:[a-z_-]+) \d+ms$/);
    expect(stepLines[0]).toContain("project skipped");
    expect(stepLines[2]).toContain("branding done");
    // No URL (and so no project id / email) in a step line.
    expect(stepLines.join("\n")).not.toMatch(/https?:|@/);
  });

  it("a hand-off is logged with its reason", async () => {
    const h = await makeHarness({ browser: { refuse: "no-chrome" } });
    const id = await startExisting(h);
    await until(() => h.view(id), (x) => x.state === "handoff");
    expect(h.logger.lines.some((l) => /^\[gmail\] setup step project handoff:no-chrome \d+ms$/.test(l))).toBe(true);
  });

  it("an unexpected internal error hands off at the current step and logs the class name only", async () => {
    const h = await makeHarness();
    preset(h.console, "publish");
    h.store.setClient = async () => {
      throw new TypeError("kaboom GOCSPX-neverlogged_123");
    };
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toMatchObject({ step: "capture", reason: "secret_capture_failed" });
    expect(h.logger.lines.join("\n")).not.toContain("kaboom");
    expect(leaks(h.logger.lines.join("\n"))).toEqual([]);
  });
});

describe("R17 secrets never reach a log, a run view or a response", () => {
  async function collect(h: Harness, id: string, extra: string[] = []) {
    const view = await h.view(id);
    return [
      ...h.logger.lines,
      JSON.stringify(view),
      JSON.stringify(await h.state()),
      JSON.stringify(h.configUpdates),
      ...extra,
    ].join("\n");
  }

  it("a full run: the stored client holds the secret, nothing else does", async () => {
    const h = await makeHarness();
    h.console.secret = "GOCSPX-fullrunSecret_ABCDEF";
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    const id = r.json().runId;
    const bodies = [r.body];
    const v = await autopilot(h, id);
    expect(v.state).toBe("done");
    expect((await h.store.getClient())?.clientSecret).toBe("GOCSPX-fullrunSecret_ABCDEF");
    const all = await collect(h, id, bodies);
    expect(all).not.toContain("fullrunSecret");
    expect(leaks(all)).toEqual([]);
    // One log line per step, still present.
    expect(h.logger.lines.filter((l) => l.startsWith("[gmail] setup step"))).toHaveLength(6);
  });

  it("a failing run (the store refuses after the secret was read): no secret anywhere", async () => {
    const h = await makeHarness({ client: true });
    h.console.secret = "GOCSPX-failingRunSecret_XYZ789";
    preset(h.console, "publish");
    // An account connected during the run makes the store refuse the new client.
    h.console.beforeNavigate = (u) => {
      if (u.pathname === PATHS.clientCreate) {
        h.creds.data.set(acctKey("s1"), {
          sub: "s1", email: "a@x.com", tier: "readonly", scopes: [], refresh: "r", access: "a", expires: 1, status: "ok", addedAt: 1,
        });
      }
    };
    const id = await startExisting(h);
    const v = await autopilot(h, id);
    expect(v.handoff).toMatchObject({ reason: "client_in_use" });
    const all = await collect(h, id);
    expect(all).not.toContain("failingRunSecret");
    expect(leaks(all)).toEqual([]);
    expect(all).not.toMatch(SECRET_RE);
  });

  it("a failing run where the dialog text is the only place the secret appears: handoff text is fixed and masked", async () => {
    const h = await makeHarness();
    h.console.secret = "GOCSPX-dialogOnly_QQQ111";
    preset(h.console, "publish");
    h.console.downloadWorks = false;
    // The dialog shows a secret but no client id → the id cannot be parsed; fallback has nothing either.
    h.console.clientId = "not-a-client-id";
    const id = await startExisting(h);
    const v = await autopilot(h, id);
    expect(v.handoff).toMatchObject({ step: "capture", wizardStep: 4, reason: "secret_capture_failed" });
    const all = await collect(h, id);
    expect(leaks(all)).toEqual([]);
    expect(all).not.toContain("dialogOnly");
  });
});

describe("browser endpoint hardening (security review #2, #3)", () => {
  it("a non-loopback cdpUrl is never dialled → handoff launch-failed @ project, instance disconnected", async () => {
    const h = await makeHarness({ browser: { cdpUrl: "ws://evil.example:9222/devtools/browser/x" } });
    preset(h.console, "project");
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "handoff");
    expect(v.handoff).toEqual({ step: "project", wizardStep: 1, reason: "launch-failed" });
    expect(h.console.log).toHaveLength(0);
    await until(() => h.browser.calls.disconnect, (d) => d.length > 0);
  });

  it("a Chrome that never answers the connect hands off browser_closed instead of wedging the run slot", async () => {
    const h = await makeHarness({ timing: { stepLimitMs: 80 } });
    preset(h.console, "project");
    h.console.hang = (method) => method === "Target.createTarget";
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "handoff");
    expect(v.handoff).toMatchObject({ step: "project", reason: "browser_closed" });
    // The slot is free again.
    expect((await h.start({ mode: "existing", projectId: "pi-dashboard-abc123", ownerEmail: OWNER })).statusCode).toBe(200);
  });
});

describe("review B1 — human waits obey cancel and a closing browser", () => {
  it("cancel during a waiting_decision settles the run task as cancelled", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const run = new SetupRunManager(h.deps).start({ mode: "existing", projectId: "pi-dashboard-abc123", ownerEmail: OWNER });
    if (!run) throw new Error("no run");
    await until(() => run.view(), (v) => v.state === "waiting_decision");
    await run.cancel();
    const settled = await Promise.race([run.settled.then(() => "settled"), new Promise((r) => setTimeout(() => r("hung"), 1500))]);
    expect(settled).toBe("settled");
    expect(run.view().state).toBe("cancelled");
  });

  it("the browser closing during a waiting_decision hands off browser_closed", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    h.console.serverClose();
    const v = await until(() => h.view(id), (x) => x.state === "handoff", 1500);
    expect(v.handoff).toMatchObject({ step: "branding", reason: "browser_closed" });
  });

  it("the browser closing during a waiting_user checkpoint hands off browser_closed, not timeout", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    const id = await startExisting(h);
    await autopilot(h, id, { stopAt: (v) => v.state === "waiting_user" && v.checkpoint?.kind === "policy" });
    h.console.serverClose();
    const v = await until(() => h.view(id), (x) => x.state === "handoff", 1500);
    expect(v.handoff).toMatchObject({ reason: "browser_closed" });
  });
});

describe("review (CodeRabbit) — cancel while the first connect is pending", () => {
  it("a connect that answers busy after the cancel never overwrites `cancelled`; the run slot is free", async () => {
    const h = await makeHarness({ browser: { busyHolder: "agent-session" } });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const realConnect = h.browser.service.connect;
    h.browser.service.connect = async (o) => {
      await gate;
      return realConnect(o);
    };
    const id = await startExisting(h);
    await new Promise((r) => setTimeout(r, 20)); // the gated connect() is in flight
    expect((await h.del(`/setup/run/${id}`)).json().state).toBe("cancelled");
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect((await h.view(id)).state).toBe("cancelled");
    // Not wedged: a new run can start.
    expect((await h.start(EXISTING)).statusCode).toBe(200);
  });

  it("a connect that succeeds after the cancel is disconnected, not leaked", async () => {
    const h = await makeHarness();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const realConnect = h.browser.service.connect;
    h.browser.service.connect = async (o) => {
      await gate;
      return realConnect(o);
    };
    const id = await startExisting(h);
    expect((await h.del(`/setup/run/${id}`)).json().state).toBe("cancelled");
    release();
    await until(() => h.browser.calls.disconnect, (d) => d.length > 0);
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });
});

describe("review — a closed sign-in tab is not a completed sign-in", () => {
  it("tabOrigin null keeps the checkpoint waiting until the user confirms", async () => {
    let flipped = false;
    const h = await makeHarness({ browser: { tabOrigin: () => null } });
    preset(h.console, "publish");
    h.console.beforeNavigate = (u) => {
      if (u.pathname === PATHS.clientCreate && !flipped) {
        flipped = true;
        h.console.signedIn = false;
      }
    };
    const id = await startExisting(h);
    const v = await autopilot(h, id, { stopAt: (x) => x.state === "waiting_user" && x.checkpoint?.kind === "sign_in" });
    expect(v.checkpoint?.kind).toBe("sign_in");
    await new Promise((r) => setTimeout(r, 120));
    expect((await h.view(id)).checkpoint?.kind).toBe("sign_in"); // still waiting: null never counts as signed in
    expect(h.browser.calls.open).toHaveLength(1); // no second sign-in tab was opened by a restarted step
    h.console.signedIn = true;
    expect((await h.post(`/setup/run/${id}/continue`)).statusCode).toBe(200);
    expect((await autopilot(h, id)).state).toBe("done");
  });
});
