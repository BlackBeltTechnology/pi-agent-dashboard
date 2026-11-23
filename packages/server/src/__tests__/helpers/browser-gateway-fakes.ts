/**
 * Shared fakes for the browser-gateway broadcast tests: a fake `ws` socket and a stub `PiGateway`.
 * Used by `browser-gateway-broadcast-serialize-once.test.ts` and its budget-lane file
 * `browser-gateway-broadcast-serialize-once.budget.test.ts`.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { PiGateway } from "../../pi/pi-gateway.js";

export function makeFakeWs(opts?: { bufferedAmount?: number; readyState?: number }) {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    bufferedAmount: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = opts?.readyState ?? 1;
  ws.bufferedAmount = opts?.bufferedAmount ?? 0;
  ws.OPEN = 1;
  return ws;
}

export function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}
