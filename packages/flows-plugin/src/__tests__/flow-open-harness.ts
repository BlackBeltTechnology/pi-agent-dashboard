/**
 * Shared fake-ctx harness for the `flow/open` lane tests
 * (flow-files-server.test.ts, flow-catalog-server.test.ts).
 * See change: add-flow-open-tool.
 */
import fs from "node:fs";
import { vi } from "vitest";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";
import { FlowFileRegistry } from "../server/flow-files.js";
import { FLOWS_OPEN_ACK, type FlowOpenResult, registerFlowOpen } from "../server/flow-open.js";

export interface OpenFrame {
  type: string;
  sessionId: string;
  requestId: string;
  attachment: { name: string; source: string; viewOnly: boolean; baselineStartedAt: number };
}

export function openHarness(
  opts: {
    sessions?: Record<string, string>;
    flows?: Record<string, FlowCatalogEntry[]>;
    readFileGuarded?: ((p: string) => Promise<string | null>) | null;
    requestCatalog?: (sessionId: string, o?: { rediscover?: boolean }) => boolean;
    /** Sockets that ack every broadcast synchronously. */
    autoAck?: unknown[];
    registry?: FlowFileRegistry;
  } = {},
) {
  const sessions = opts.sessions ?? {};
  const flows = new Map<string, FlowCatalogEntry[]>(Object.entries(opts.flows ?? {}));
  const broadcasts: OpenFrame[] = [];
  const logs: string[] = [];
  const registry = opts.registry ?? new FlowFileRegistry();
  let ackHandler: (msg: unknown, ws: unknown) => void = () => {};
  let laneOpts: { hubLocalOnly?: boolean } | undefined;
  let laneType: string | undefined;
  let ended: (id: string) => void = () => {};
  const readFileGuarded =
    opts.readFileGuarded === null
      ? undefined
      : vi.fn(opts.readFileGuarded ?? (async (p: string) => fs.readFileSync(p, "utf8")));
  const requestCatalog = vi.fn(opts.requestCatalog ?? (() => true));
  const ctl = registerFlowOpen({
    registerPiRequestHandler: (type, _h, o) => {
      laneType = type;
      laneOpts = o;
    },
    registerBrowserHandler: (type, h) => {
      if (type === FLOWS_OPEN_ACK) ackHandler = h;
    },
    broadcastToSubscribers: (msg) => {
      const frame = msg as OpenFrame;
      broadcasts.push(frame);
      for (const ws of opts.autoAck ?? []) ackHandler({ type: FLOWS_OPEN_ACK, sessionId: frame.sessionId, requestId: frame.requestId }, ws);
    },
    sessionManager: { getSession: (id) => (sessions[id] ? { id, cwd: sessions[id] } : undefined) },
    onSessionEnded: (h) => {
      ended = h;
      return () => {};
    },
    store: { getState: (id) => ({ flows: flows.get(id) ?? [] }) },
    requestCatalog,
    registry,
    readFileGuarded,
    logger: { info: (m) => logs.push(m) },
  });
  /** Run one call to completion under fake timers. */
  const call = async (payload: unknown, sessionId = "S"): Promise<FlowOpenResult> => {
    const p = ctl.handle(payload, { sessionId });
    await vi.advanceTimersByTimeAsync(2_000);
    return p;
  };
  return {
    ctl,
    call,
    registry,
    broadcasts,
    logs,
    readFileGuarded,
    requestCatalog,
    setFlows: (sid: string, f: FlowCatalogEntry[]) => flows.set(sid, f),
    ack: (ws: unknown, sessionId: string, requestId: unknown) => ackHandler({ type: FLOWS_OPEN_ACK, sessionId, requestId }, ws),
    end: (sid: string) => ended(sid),
    lane: () => ({ type: laneType, opts: laneOpts }),
  };
}

export const entry = (name: string, source: string): FlowCatalogEntry => ({ name, source, description: "", taskRequired: false });
