/**
 * Unit tests for `installFrameInjector` with a FAKE page + fake WebSocket routes.
 *
 * The injector must keep delivering after a reload even when the new shell
 * socket opens BEFORE the old one reports `close` — the old socket's close must
 * not discard the new connection.
 *
 * See change: fix-worktree-init-chip-overflow.
 */
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { installFrameInjector } from "../init-banner.js";

interface FakeWs {
  sent: string[];
  closeHandler?: () => void;
  send(data: string): void;
  onClose(handler: () => void): void;
  onMessage(handler: (m: unknown) => void): void;
  connectToServer(): { send(m: unknown): void; onMessage(h: (m: unknown) => void): void };
  close(): void;
}

function fakeWs(): FakeWs {
  const ws: FakeWs = {
    sent: [],
    send: (data) => ws.sent.push(data),
    onClose: (h) => {
      ws.closeHandler = h;
    },
    onMessage: () => {},
    connectToServer: () => ({ send: () => {}, onMessage: () => {} }),
    close: () => ws.closeHandler?.(),
  };
  return ws;
}

async function setup() {
  let handler: ((ws: FakeWs) => void) | undefined;
  const page = {
    routeWebSocket: async (_url: RegExp, h: (ws: FakeWs) => void) => {
      handler = h;
    },
  } as unknown as Page;
  const injector = await installFrameInjector(page);
  return { injector, open: (ws: FakeWs) => handler?.(ws) };
}

describe("installFrameInjector", () => {
  it("throws before the page opened a socket", async () => {
    const { injector } = await setup();
    expect(() => injector.send({ a: 1 })).toThrow(/shell WebSocket/);
  });

  it("delivers JSON frames to the open shell socket", async () => {
    const { injector, open } = await setup();
    const ws = fakeWs();
    open(ws);
    injector.send({ a: 1 });
    expect(ws.sent).toEqual(['{"a":1}']);
  });

  it("after reload (old closes first) delivers to the new socket", async () => {
    const { injector, open } = await setup();
    const oldWs = fakeWs();
    open(oldWs);
    oldWs.close();
    expect(() => injector.send({ a: 1 })).toThrow();
    const newWs = fakeWs();
    open(newWs);
    injector.send({ a: 2 });
    expect(newWs.sent).toEqual(['{"a":2}']);
  });

  it("after reload (new opens BEFORE old closes) still delivers to the new socket", async () => {
    const { injector, open } = await setup();
    const oldWs = fakeWs();
    const newWs = fakeWs();
    open(oldWs);
    open(newWs);
    oldWs.close();
    injector.send({ a: 3 });
    expect(newWs.sent).toEqual(['{"a":3}']);
  });
});
