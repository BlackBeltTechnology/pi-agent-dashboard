import { afterEach, describe, expect, it, vi } from "vitest";
import { installRuntimeCancellationCompat } from "../runtime-cancellation-compat.js";

function createRuntime() {
  class FakeSession {
    agent = {
      state: { tools: [] as any[] },
      prompt: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    abortRetry = vi.fn();
    bound: Record<string, unknown> | undefined;

    async bindExtensions(bindings: Record<string, unknown>) {
      this.bound = bindings;
    }
  }
  return FakeSession;
}

afterEach(() => vi.useRealTimers());

describe("runtime cancellation compatibility", () => {
  it("cancels retry before delegating to the TUI abort handler and prevents another request", async () => {
    vi.useFakeTimers();
    const Session = createRuntime();
    installRuntimeCancellationCompat(Session as any);
    const session = new Session();
    const order: string[] = [];
    const providerRequest = vi.fn();
    const retryTimer = setTimeout(providerRequest, 5_000);
    session.abortRetry.mockImplementation(() => {
      order.push("retry");
      clearTimeout(retryTimer);
    });

    await session.bindExtensions({ abortHandler: () => order.push("agent") });
    (session.bound?.abortHandler as () => void)();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(order).toEqual(["retry", "agent"]);
    expect(providerRequest).not.toHaveBeenCalled();
  });

  it("installs once and preserves bindings without a custom abort handler", async () => {
    const Session = createRuntime();
    installRuntimeCancellationCompat(Session as any);
    installRuntimeCancellationCompat(Session as any);
    const session = new Session();
    const bindings = { mode: "rpc" };

    await session.bindExtensions(bindings);

    expect(session.bound).toBe(bindings);
  });

  it("releases an aborted run after grace and suppresses late updates and rejection", async () => {
    vi.useFakeTimers();
    const Session = createRuntime();
    installRuntimeCancellationCompat(Session as any, { toolAbortGraceMs: 25 });
    const session = new Session();
    const controller = new AbortController();
    const update = vi.fn();
    let rejectTool: ((error: Error) => void) | undefined;
    let wrappedTool: any;
    session.agent.state.tools = [{
      name: "stuck",
      execute: vi.fn((_id, _params, _signal, onUpdate) => {
        wrappedTool = { onUpdate };
        return new Promise((_resolve, reject) => {
          rejectTool = reject;
        });
      }),
    }];
    session.agent.prompt.mockImplementation(async () => {
      await session.agent.state.tools[0].execute("tc-1", {}, controller.signal, update);
    });
    await session.bindExtensions({ abortHandler: () => controller.abort() });

    const run = session.agent.prompt();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(25);

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    wrappedTool.onUpdate({ content: "late" });
    rejectTool?.(new Error("late rejection"));
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not impose a timeout before abort", async () => {
    vi.useFakeTimers();
    const Session = createRuntime();
    installRuntimeCancellationCompat(Session as any, { toolAbortGraceMs: 10 });
    const session = new Session();
    let resolveTool: (() => void) | undefined;
    session.agent.state.tools = [{
      name: "slow",
      execute: () => new Promise<void>((resolve) => {
        resolveTool = resolve;
      }),
    }];
    session.agent.prompt.mockImplementation(async () => {
      await session.agent.state.tools[0].execute("tc-1", {}, new AbortController().signal);
    });
    await session.bindExtensions({});

    const run = session.agent.prompt();
    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void run.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveTool?.();
    await expect(run).resolves.toBeUndefined();
  });

  it("allows cooperative cleanup and a subsequent prompt", async () => {
    const Session = createRuntime();
    installRuntimeCancellationCompat(Session as any, { toolAbortGraceMs: 25 });
    const session = new Session();
    let controller = new AbortController();
    const execute = vi.fn((_id, _params, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      }),
    );
    session.agent.state.tools = [{ name: "cooperative", execute }];
    session.agent.prompt.mockImplementation(async () => {
      await session.agent.state.tools[0].execute("tc-1", {}, controller.signal);
    });
    await session.bindExtensions({ abortHandler: () => controller.abort() });

    const firstRun = session.agent.prompt();
    await Promise.resolve();
    await Promise.resolve();
    (session.bound?.abortHandler as () => void)();
    await expect(firstRun).resolves.toBeUndefined();

    controller = new AbortController();
    session.agent.state.tools = [{ name: "next", execute: async () => ({ content: [] }) }];
    await expect(session.agent.prompt()).resolves.toBeUndefined();
    expect(session.abortRetry).toHaveBeenCalledOnce();
  });
});
