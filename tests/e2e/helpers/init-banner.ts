import type { Page } from "@playwright/test";

/**
 * Shared L3 glue for specs that drive the worktree-init banner without running
 * a real hook: stub the boot rehydration endpoint and inject server→client
 * frames into the page's shell WebSocket.
 *
 * Extracted from `mobile-viewport-bound.spec.ts`.
 * See change: fix-worktree-init-chip-overflow.
 */

interface ActiveInitRun {
  cwd: string;
  phase: "running";
  startedAt: number;
  lastLine?: string;
}

/** Stub `GET /api/git/worktree/active-inits` with the given runs (boot rehydration). */
export async function stubActiveInits(page: Page, runs: ActiveInitRun[]): Promise<void> {
  await page.route("**/api/git/worktree/active-inits", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { runs } }),
    }),
  );
}

/** Two concurrent runs in the boot rehydration endpoint → the concurrent stack renders. */
export async function forceConcurrentInitStack(page: Page): Promise<void> {
  const now = Date.now();
  await stubActiveInits(page, [
    { cwd: "/fixtures/sample-git", phase: "running", startedAt: now, lastLine: "installing" },
    { cwd: "/fixtures/sample-hook-ok", phase: "running", startedAt: now, lastLine: "linking" },
  ]);
}

export interface FrameInjector {
  /** Deliver a synthetic server→client frame to the page's shell WebSocket. */
  send(frame: unknown): void;
}

/**
 * Capture the page's shell WebSocket so the test can deliver a server→client
 * frame. `routeWebSocket` must be installed BEFORE navigation; the first socket
 * the app opens is the shell socket (plugin relay sockets open later, only when
 * a live view is requested).
 */
export async function installFrameInjector(page: Page): Promise<FrameInjector> {
  let live: { send(data: string): void } | undefined;
  await page.routeWebSocket(/.*/, (ws) => {
    // Re-capture after a page reload: the previous socket closes, the app opens a new one.
    live ??= ws;
    ws.onClose(() => {
      if (live === ws) live = undefined;
    });
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
  });
  return {
    send(frame) {
      if (!live) throw new Error("the page has not opened its shell WebSocket yet");
      live.send(JSON.stringify(frame));
    },
  };
}
