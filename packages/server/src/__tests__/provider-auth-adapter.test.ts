/**
 * Adapter tests: the `AuthInteraction` implementation and flow record against
 * scripted fake flows. Covers test-plan E7, E9, E14, E20, E21, E22, X5, X6,
 * X9, X13.
 *
 * The fake models pi-ai's own abort semantics (see
 * `helpers/fake-oauth-flow.ts`), which is what makes X4/X13 meaningful rather
 * than tautological.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D1, D7).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  abortAllFlows,
  cancelFlow,
  flowStoreSize,
  getFlow,
  startFlow,
  toFlowStatus,
  type StartFlowParams,
  type StartedFlow,
} from "../auth/provider-auth-adapter.js";
import {
  anthropicFlow,
  createFakeOAuthFlow,
  deviceCodeFlow,
  resetFakeFlows,
  type FakeOAuthFlow,
  type FakeStep,
} from "./helpers/fake-oauth-flow.js";

/** Let the fake's `await` chain advance one turn under real timers. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

type StartResult = {
  started: StartedFlow;
  writeCredential: Mock<StartFlowParams["writeCredential"]>;
  notifyBridges: Mock<() => void>;
};

function start(loginFlow: FakeOAuthFlow, extra: Partial<StartFlowParams> = {}): StartResult {
  const writeCredential = vi.fn<StartFlowParams["writeCredential"]>(
    extra.writeCredential ?? (async () => {}),
  );
  const notifyBridges = vi.fn<() => void>(extra.notifyBridges ?? (() => {}));
  const started = startFlow({
    provider: extra.provider ?? "anthropic",
    loginFlow,
    preAnswers: extra.preAnswers ?? [],
    writeCredential,
    notifyBridges,
    ...(extra.openInBrowser ? { openInBrowser: extra.openInBrowser } : {}),
  });
  return { started, writeCredential, notifyBridges };
}

beforeEach(() => {
  resetFakeFlows();
  vi.useRealTimers();
});

afterEach(() => {
  abortAllFlows();
});

describe("flow record — authUrl + pending co-exist (E9)", () => {
  it("holds BOTH the authorization URL and the manual_code prompt", () => {
    const fake = anthropicFlow();
    const { started } = start(fake);

    const status = toFlowStatus(started.flow);
    expect(status.status).toBe("pending");
    expect(status.authUrl).toContain("https://claude.ai/oauth/authorize");
    expect(status.pending).toMatchObject({
      kind: "manual_code",
      message: "Paste the authorization code",
      placeholder: "code or full redirect URL",
    });
  });

  it("opens the browser on the FIRST auth_url only", () => {
    const openInBrowser = vi.fn();
    const fake = createFakeOAuthFlow([
      { kind: "notify", event: { type: "auth_url", url: "https://one.example/auth" } },
      { kind: "notify", event: { type: "auth_url", url: "https://two.example/auth" } },
      { kind: "notify", event: { type: "device_code", userCode: "U", verificationUri: "https://v" } },
    ]);
    const { started } = start(fake, { openInBrowser });

    expect(openInBrowser).toHaveBeenCalledTimes(1);
    expect(openInBrowser).toHaveBeenCalledWith("https://one.example/auth");
    // Sticky: the LAST url is retained.
    expect(toFlowStatus(started.flow).authUrl).toBe("https://two.example/auth");
  });

  it("does not open a browser when the flow is already cancelled", async () => {
    const openInBrowser = vi.fn();
    const fake = createFakeOAuthFlow([
      {
        kind: "prompt",
        prompt: { type: "text", message: "domain?" },
        continueOnAbort: true,
      },
      { kind: "notify", event: { type: "auth_url", url: "https://late.example/auth" } },
    ]);
    const { started } = start(fake, { openInBrowser });
    cancelFlow(started.flow);
    await started.settled;

    expect(fake.aborted).toBe(true);
    expect(openInBrowser).not.toHaveBeenCalled();
    expect(started.flow.error).toBe("Cancelled");
  });
});

describe("prompt handling", () => {
  it("E14: resolving the prompt completes the flow, then rejects further input", async () => {
    const fake = anthropicFlow();
    const { started, writeCredential, notifyBridges } = start(fake);
    const resolve = started.flow.resolveInput;
    expect(typeof resolve).toBe("function");

    resolve?.("http://localhost:53692/callback?code=abc&state=fake-state");
    await started.settled;

    const status = toFlowStatus(started.flow);
    expect(status.status).toBe("complete");
    expect(status.pending).toBeUndefined();
    expect(started.flow.resolveInput).toBeUndefined();
    expect(writeCredential).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({ type: "oauth" }),
    );
    expect(notifyBridges).toHaveBeenCalledTimes(1);
  });

  it("E7: preAnswers answers only the FIRST text prompt", async () => {
    const fake = createFakeOAuthFlow([
      { kind: "prompt", prompt: { type: "text", message: "first question" } },
      { kind: "prompt", prompt: { type: "text", message: "second question" } },
      { kind: "resolve" },
    ]);
    const { started } = start(fake, { preAnswers: ["x.ghe.com"] });
    // The pre-answer resolves on a microtask (never becomes `pending`), so the
    // second prompt is only reachable after a flush.
    await flush();

    expect(fake.answers).toEqual(["x.ghe.com"]);
    expect(toFlowStatus(started.flow).pending).toMatchObject({
      kind: "text",
      message: "second question",
    });
  });

  it("E7b: a non-text first prompt DISCARDS the pre-answer", async () => {
    const fake = createFakeOAuthFlow([
      {
        kind: "prompt",
        prompt: {
          type: "select",
          message: "pick",
          options: [{ id: "a", label: "A" }],
        },
      },
      { kind: "prompt", prompt: { type: "text", message: "domain?" } },
      { kind: "resolve" },
    ]);
    const { started } = start(fake, { preAnswers: ["x.ghe.com"] });
    await flush();

    // The `select` is NOT answered by the enterprise-domain pre-answer …
    expect(started.flow.pending).toMatchObject({ kind: "select" });
    expect(fake.answers).toEqual([]);

    // … and the pre-answer is gone by the time the text prompt arrives.
    started.flow.resolveInput?.("a");
    await flush();
    expect(started.flow.pending).toMatchObject({ kind: "text", message: "domain?" });
  });

  it("X9: a `secret` prompt rejects the flow with an explicit message", async () => {
    const fake = createFakeOAuthFlow([
      { kind: "prompt", prompt: { type: "secret", message: "token?" } },
    ]);
    const { started } = start(fake);

    await started.settled;
    expect(started.flow.status).toBe("error");
    expect(started.flow.error).toBe("unsupported prompt: secret");
  });

  it("X13: a prompt's OWN signal abort clears pending while login continues", async () => {
    const controller = new AbortController();
    const fake = createFakeOAuthFlow([
      {
        kind: "prompt",
        prompt: {
          type: "manual_code",
          message: "Paste the code",
          signal: controller.signal,
        },
        continueOnAbort: true,
      },
      { kind: "resolve" },
    ]);
    const { started } = start(fake);
    expect(toFlowStatus(started.flow).pending).toMatchObject({ kind: "manual_code" });

    controller.abort();
    await started.settled;

    expect(started.flow.pending).toBeUndefined();
    expect(started.flow.resolveInput).toBeUndefined();
    // The flow itself was not cancelled — it carried on past the prompt.
    expect(started.flow.status).toBe("complete");
  });

  it("X13b: a prompt whose signal is ALREADY aborted never becomes pending", () => {
    const controller = new AbortController();
    controller.abort();
    const fake = createFakeOAuthFlow([
      {
        kind: "prompt",
        prompt: { type: "manual_code", message: "Paste", signal: controller.signal },
        continueOnAbort: true,
      },
      { kind: "resolve" },
    ]);
    const { started } = start(fake);
    expect(started.flow.pending).toBeUndefined();
  });
});

describe("cancellation", () => {
  it("X5: a mid-poll abort stores 'Cancelled', never pi-ai's own string", async () => {
    const fake = deviceCodeFlow({ expiresInSeconds: 900 });
    const { started } = start(fake, { provider: "xai" });
    expect(toFlowStatus(started.flow).pending).toMatchObject({ kind: "device_code" });

    cancelFlow(started.flow);
    await started.settled;

    expect(started.flow.status).toBe("error");
    expect(started.flow.error).toBe("Cancelled");
  });

  it("X6: a late resolve after cancel is DISCARDED, never written", async () => {
    vi.useFakeTimers();
    const fake = createFakeOAuthFlow([
      {
        kind: "notify",
        event: {
          type: "device_code",
          userCode: "U",
          verificationUri: "https://v",
          expiresInSeconds: 600,
        },
      },
      { kind: "wait", ms: 10 },
      { kind: "resolve" },
    ]);
    const { started, writeCredential } = start(fake, { provider: "xai" });

    cancelFlow(started.flow);
    await vi.advanceTimersByTimeAsync(10);
    await started.settled;

    expect(started.flow.status).toBe("error");
    expect(started.flow.error).toBe("Cancelled");
    expect(writeCredential).not.toHaveBeenCalled();
  });

  it("X4: the pending prompt is rejected on abort, so the listener closes", async () => {
    const fake = anthropicFlow();
    const { started } = start(fake);
    expect(fake.openListeners).toBe(1);

    cancelFlow(started.flow);
    await started.settled;

    expect(fake.aborted).toBe(true);
    expect(fake.listenerClosed).toBe(true);
    expect(fake.openListeners).toBe(0);
    expect(started.flow.error).toBe("Cancelled");
  });

  it("X7: a refused credential write reports the write error and leaves state intact", async () => {
    const fake = anthropicFlow();
    const writeCredential = vi.fn(async () => {
      throw new Error(
        'Refusing to overwrite the stored api_key credential for "openrouter"',
      );
    });
    const { started } = start(fake, { provider: "openrouter", writeCredential });

    started.flow.resolveInput?.("https://openrouter.ai/callback?code=c&state=s");
    await started.settled;

    expect(started.flow.status).toBe("error");
    expect(started.flow.error).toContain("Refusing to overwrite");
  });
});

describe("device-code lifetime (D7)", () => {
  it("E20: a non-numeric expiresInSeconds leaves expiresAt untouched (no NaN)", () => {
    const fake = deviceCodeFlow({ expiresInSeconds: undefined });
    const { started } = start(fake, { provider: "xai" });

    expect(started.flow.deviceCodeDeadline).toBeUndefined();
    expect(started.flow.expiresAt).toBe(started.flow.createdAt + 10 * 60 * 1000);
    expect(Number.isNaN(started.flow.expiresAt)).toBe(false);
    expect(toFlowStatus(started.flow).pending).toMatchObject({ kind: "device_code" });
  });

  it("E18: a 900 s device code extends the lifetime to 16 minutes", () => {
    const fake = deviceCodeFlow({ expiresInSeconds: 900 });
    const { started } = start(fake, { provider: "xai" });

    expect(started.flow.deviceCodeDeadline).toBe(started.flow.createdAt + 900_000);
    expect(started.flow.expiresAt).toBe(started.flow.createdAt + 960_000);
  });

  it("E21: a rejection AT/after the deadline reports `expired`", async () => {
    vi.useFakeTimers();
    const fake = createFakeOAuthFlow([
      {
        kind: "notify",
        event: {
          type: "device_code",
          userCode: "U",
          verificationUri: "https://v",
          expiresInSeconds: 60,
        },
      },
      { kind: "reject", afterMs: 61_000, message: "Device flow timed out" },
    ]);
    const { started } = start(fake, { provider: "xai" });

    await vi.advanceTimersByTimeAsync(61_000);
    await started.settled;

    expect(started.flow.status).toBe("expired");
    expect(getFlow(started.flow.id)?.status).toBe("expired");
  });

  it("E22: a rejection BEFORE the deadline reports `error` with the message", async () => {
    vi.useFakeTimers();
    const fake = createFakeOAuthFlow([
      {
        kind: "notify",
        event: {
          type: "device_code",
          userCode: "U",
          verificationUri: "https://v",
          expiresInSeconds: 60,
        },
      },
      { kind: "reject", afterMs: 30_000, message: "Device flow timed out" },
    ]);
    const { started } = start(fake, { provider: "xai" });

    await vi.advanceTimersByTimeAsync(30_000);
    await started.settled;

    expect(started.flow.status).toBe("error");
    expect(started.flow.error).toBe("Device flow timed out");
  });
});

describe("serialisation guard (E12)", () => {
  it("never exposes server-only fields", () => {
    const fake = anthropicFlow();
    const { started } = start(fake);
    const keys = Object.keys(toFlowStatus(started.flow)).sort();
    expect(keys).toEqual(["authUrl", "flowId", "pending", "provider", "status"]);
  });

  it("omits `pending` once the flow is terminal", async () => {
    const fake = anthropicFlow();
    const { started } = start(fake);
    started.flow.resolveInput?.("code");
    await started.settled;
    expect(toFlowStatus(started.flow)).not.toHaveProperty("pending");
  });
});

describe("write ordering (folded from provider-auth-device-code-await)", () => {
  it("reports `complete` only AFTER the credential write resolves", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writeCredential = vi.fn(async () => {
      await gate;
    });
    const fake = anthropicFlow();
    const { started } = start(fake, { writeCredential });

    started.flow.resolveInput?.("code");
    await flush();

    // The flow resolved a credential, but the write is still in flight: the
    // flow must NOT claim completion before the bytes are on disk.
    expect(writeCredential).toHaveBeenCalledTimes(1);
    expect(started.flow.status).toBe("pending");

    release();
    await started.settled;
    expect(started.flow.status).toBe("complete");
  });
});

describe("shutdown (E31 at the store level)", () => {
  it("aborts every pending flow with Cancelled and empties the store", async () => {
    const started = [
      start(anthropicFlow()).started,
      start(deviceCodeFlow({ expiresInSeconds: 900 }), { provider: "xai" }).started,
      start(deviceCodeFlow({ expiresInSeconds: 900 }), { provider: "meta" }).started,
    ];
    expect(flowStoreSize()).toBe(3);

    abortAllFlows();
    await Promise.all(started.map((s) => s.settled));

    expect(flowStoreSize()).toBe(0);
    for (const s of started) {
      expect(s.flow.status).toBe("error");
      expect(s.flow.error).toBe("Cancelled");
    }
  });
});

describe("flow ids (E13 support)", () => {
  it("are UUID v4 and distinct", () => {
    const ids = new Set<string>();
    const fake: FakeStep[] = [];
    for (let i = 0; i < 50; i += 1) {
      const flow = createFakeOAuthFlow(fake, { name: "n" });
      ids.add(start(flow).started.flow.id);
    }
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
