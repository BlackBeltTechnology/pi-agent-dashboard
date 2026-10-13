/**
 * Test harness: the real adapter core wired to the scripted fake ACP agent over
 * in-memory pipes (no child process, no gateway).
 * See change: add-acp-session-driver.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { type AcpAgentConfig, type AcpSettings, DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { type AcpSessionAdapterOptions, type AgentHandle, createAcpSessionAdapter } from "../acp-session-adapter.js";
import { type FakeAgentKnobs, runFakeAgent } from "./fake-acp-agent.mjs";

export const SESSION_ID = "11111111-2222-4333-8444-555555555555";

export interface Harness {
  adapter: ReturnType<typeof createAcpSessionAdapter>;
  sent: ExtensionToServerMessage[];
  logs: string[];
  exits: number[];
  agent: ReturnType<typeof runFakeAgent>;
  /** Raw bytes the "agent" writes to the adapter (for garbage injection). */
  agentOut: PassThrough;
  handle: StubHandle;
  /** `event_forward` events, in order. */
  events(): DashboardEvent[];
  eventTypes(): string[];
  of<T extends ExtensionToServerMessage["type"]>(type: T): Array<Extract<ExtensionToServerMessage, { type: T }>>;
  send(m: Omit<ServerToExtensionMessage, "sessionId"> & Record<string, unknown>): void;
  prompt(text: string, extra?: Record<string, unknown>): void;
  waitFor(pred: () => boolean, ms?: number): Promise<void>;
  /** Requests the fake agent received (JSON-RPC). */
  received(): Array<Record<string, any>>;
}

class StubHandle extends EventEmitter implements AgentHandle {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr = new PassThrough();
  pid = 4242;
  killed: string[] = [];
  constructor(stdin: PassThrough, stdout: PassThrough) {
    super();
    this.stdin = stdin;
    this.stdout = stdout;
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

export interface HarnessOptions {
  protocol?: 1 | 2;
  knobs?: FakeAgentKnobs;
  settings?: Partial<AcpSettings>;
  agent?: Partial<AcpAgentConfig>;
  sessionId?: string;
  spawnToken?: string;
  /** Do not run the fake agent (the test drives raw bytes via `agentOut`). */
  silent?: boolean;
  adapter?: Partial<AcpSessionAdapterOptions>;
  launchThrows?: Error;
  fixture?: Record<string, any>;
}

export function makeHarness(o: HarnessOptions = {}): Harness {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const handle = new StubHandle(toAgent, fromAgent);
  const agent = o.silent
    ? ({ done: Promise.resolve(), received: [] as Array<Record<string, unknown>> } as ReturnType<typeof runFakeAgent>)
    : runFakeAgent({ input: toAgent, output: fromAgent, protocol: o.protocol ?? 1, knobs: o.knobs ?? {}, fixture: o.fixture });
  const sent: ExtensionToServerMessage[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const adapter = createAcpSessionAdapter({
    agent: { id: "qmt", name: "querymt", command: "qmtcode", args: ["--stdio"], env: {}, durable: false, ...o.agent },
    settings: { ...DEFAULT_ACP_SETTINGS, protocolV2: o.protocol === 2, ...o.settings },
    cwd: "/work/repo",
    sessionId: o.sessionId ?? SESSION_ID,
    spawnToken: o.spawnToken,
    send: (m) => sent.push(m),
    log: (l) => logs.push(l),
    onExit: (c) => exits.push(c),
    launchAgent: () => {
      if (o.launchThrows) throw o.launchThrows;
      return handle;
    },
    ...o.adapter,
  });
  const h: Harness = {
    adapter,
    sent,
    logs,
    exits,
    agent,
    agentOut: fromAgent,
    handle,
    events: () => sent.filter((m): m is Extract<ExtensionToServerMessage, { type: "event_forward" }> => m.type === "event_forward").map((m) => m.event),
    eventTypes: () => h.events().map((e) => e.eventType),
    of: (type) => sent.filter((m) => m.type === type) as never,
    send: (m) => adapter.handle({ sessionId: o.sessionId ?? SESSION_ID, ...m } as ServerToExtensionMessage),
    prompt: (text, extra = {}) => h.send({ type: "send_prompt", text, ...extra } as never),
    waitFor: async (pred, ms = 2000) => {
      const t0 = Date.now();
      while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error(`waitFor timeout; sent types: ${sent.map((m) => m.type).join(",")}`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    received: () => agent.received as Array<Record<string, any>>,
  };
  return h;
}

/** Start the adapter and wait until it is ready (models published). */
export async function startReady(h: Harness): Promise<void> {
  await h.adapter.start();
  if (h.exits.length > 0) throw new Error(`adapter exited during start: ${JSON.stringify(h.events().slice(-2))}`);
}

/** A `launchAgent` backed by the scripted fake agent (for host-level tests). */
export function fakeAgentLauncher(o: { protocol?: 1 | 2; knobs?: FakeAgentKnobs; fixture?: Record<string, any> } = {}) {
  const state: { handle?: StubHandle; agent?: ReturnType<typeof runFakeAgent>; launches: number } = { launches: 0 };
  const launch = (): AgentHandle => {
    const toAgent = new PassThrough();
    const fromAgent = new PassThrough();
    state.handle = new StubHandle(toAgent, fromAgent);
    state.agent = runFakeAgent({ input: toAgent, output: fromAgent, protocol: o.protocol ?? 1, knobs: o.knobs ?? {}, fixture: o.fixture });
    state.launches += 1;
    return state.handle;
  };
  return { launch, state };
}
