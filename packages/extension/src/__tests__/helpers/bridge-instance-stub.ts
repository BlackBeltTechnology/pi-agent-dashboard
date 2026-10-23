/**
 * Stub `pi` + `BridgeInstance` for the extracted bridge-handler modules.
 *
 * The handlers receive everything through one instance object, so a test supplies only the
 * fields the handler under test touches. Everything else is absent (`undefined`), which makes
 * an unexpected read fail loudly instead of silently succeeding.
 *
 * See change: test-trust-audit (design D2).
 */
import { vi } from "vitest";
import { type BridgeInstance, type BridgeState, createInstance } from "../../bridge-handlers/instance.js";
import { createInboundLimits } from "../../inbound-limits.js";

export interface StubPi {
  on: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
  getSessionName: ReturnType<typeof vi.fn>;
  events: { emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  /** Handlers registered through `pi.on`, by event name, in registration order. */
  handlers: Map<string, Array<(...args: any[]) => any>>;
}

export function makeStubPi(): StubPi {
  const handlers = new Map<string, Array<(...args: any[]) => any>>();
  return {
    handlers,
    on: vi.fn((name: string, fn: (...args: any[]) => any) => {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
    }),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    setThinkingLevel: vi.fn(),
    getSessionName: vi.fn(() => undefined),
    events: { emit: vi.fn(), on: vi.fn() },
  };
}

export interface StubConnection {
  send: ReturnType<typeof vi.fn>;
  pauseAutoStart: ReturnType<typeof vi.fn>;
}

export function makeStubConnection(): StubConnection {
  return { send: vi.fn(), pauseAutoStart: vi.fn() };
}

/** A fresh instance over a fresh process-global state, with a pass-through `safe`. */
export function makeStubInstance(
  overrides: Partial<BridgeInstance> = {},
  opts: { generation?: number; shared?: BridgeState; pi?: StubPi } = {},
): { inst: BridgeInstance; pi: StubPi; shared: BridgeState; connection: StubConnection } {
  const pi = opts.pi ?? makeStubPi();
  const shared: BridgeState = opts.shared ?? { generation: opts.generation ?? 1 };
  const connection = (overrides.connection as unknown as StubConnection | undefined) ?? makeStubConnection();
  const inst = createInstance(pi as never, opts.generation ?? 1, shared, {
    safe: ((fn: unknown) => fn) as BridgeInstance["safe"],
    sessionId: "S1",
    sessionReady: true,
    connection: connection as never,
    // A real limiter (defaults): a dispatch test that never floods never trips it.
    inboundLimits: createInboundLimits(),
    // Inert vault delivery: tests that exercise it pass their own.
    vaultDelivery: {
      onServerMessage: () => false,
      onSessionStart: async () => {},
      onOpen: () => {},
      onClose: () => {},
      tick: () => {},
      redactionValues: () => [],
      redactionState: () => ({ version: 0, entries: [] }),
      withdrawAll: () => {},
      dispose: () => {},
    },
    ...overrides,
  });
  return { inst, pi, shared, connection };
}
