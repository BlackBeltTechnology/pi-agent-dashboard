/**
 * Shared rig for `DedicatedInstance` tests: a `FakeChromePipe`, an in-memory CDP
 * client socket pair and a recording `AuditRing`. Reusable by the integration wave.
 * See change: add-dedicated-agent-browser.
 */
import { AuditRing } from "../../audit.js";
import { type FakeSocket, flush, socketPair } from "../../relay/__tests__/fake-socket.js";
import { DedicatedInstance, type DedicatedInstanceDeps } from "../dedicated-instance.js";
import { HiddenTargets } from "../hidden-targets.js";
import { FakeChromePipe } from "./fake-chrome-pipe.js";

export const silent = { info: () => {}, warn: () => {}, error: () => {} };

type Json = Record<string, unknown>;

/** The agent's side of the CDP socket. */
export class TestClient {
  private nextId = 1;
  readonly socket: FakeSocket;
  constructor(socket: FakeSocket) {
    this.socket = socket;
  }

  /** Send one command; returns its id. */
  send(method: string, params?: Json, sessionId?: string): number {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
    return id;
  }

  /** Everything the instance sent to the client, parsed, in order. */
  all(): Json[] {
    return this.socket.receivedJson();
  }

  /** Events (no `id`), optionally one method. */
  events(method?: string): Json[] {
    return this.all().filter((m) => m.id === undefined && (method === undefined || m.method === method));
  }

  reply(id: number): Json | undefined {
    return this.all().find((m) => m.id === id);
  }

  /** Send, let the pipe answer, and return the reply. */
  async call(method: string, params?: Json, sessionId?: string): Promise<Json> {
    const id = this.send(method, params, sessionId);
    for (let i = 0; i < 20 && !this.reply(id); i++) await flush(1);
    const reply = this.reply(id);
    if (!reply) throw new Error(`no reply to ${method}`);
    return reply;
  }
}

export interface Rig {
  pipe: FakeChromePipe;
  instance: DedicatedInstance;
  audit: AuditRing;
  hidden: HiddenTargets;
  client: TestClient;
  /** The instance's end of the client socket. */
  serverSocket: FakeSocket;
  closed: string[];
  statusChanges: () => number;
}

export interface RigOptions {
  global?: string[];
  attach?: boolean;
  deps?: Partial<DedicatedInstanceDeps>;
  pipe?: FakeChromePipe;
  hidden?: HiddenTargets;
}

export async function makeRig(opts: RigOptions = {}): Promise<Rig> {
  const pipe = opts.pipe ?? new FakeChromePipe();
  const audit = new AuditRing();
  const hidden = opts.hidden ?? new HiddenTargets();
  const closed: string[] = [];
  let status = 0;
  const instance = new DedicatedInstance({
    instanceId: "inst-ded",
    chrome: pipe,
    audit,
    logger: silent,
    hidden,
    globalAllowedDomains: () => opts.global ?? [],
    onClosed: (reason) => closed.push(reason),
    onStatusChange: () => {
      status += 1;
    },
    ...opts.deps,
  });
  const [serverSocket, clientSocket] = socketPair();
  const client = new TestClient(clientSocket);
  if (opts.attach !== false) {
    instance.attachCdp(serverSocket);
    await pipe.flush();
  }
  return { pipe, instance, audit, hidden, client, serverSocket, closed, statusChanges: () => status };
}
