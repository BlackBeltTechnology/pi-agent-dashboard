import { test as base, expect } from "@playwright/test";
import { IsolatedServer, readState } from "./isolated-server.js";
import { type FakeSession, type LiveViewer, Operator } from "./operator.js";
import { startUpstream, type Upstream } from "./upstream.js";

/**
 * Fixtures for the live-preview L3 suite (config: `playwright.live-preview.config.ts`).
 * Import `test`/`expect` from here, never from `@playwright/test`. See README.md.
 *
 *   isolatedServer  (worker)  the host-run isolated dashboard: `.port/.url/.origin(host)`, `.restart({patch,reset})`,
 *                             `.config()`, `.logMark()/.logSince()/.livePreviewLog()`, `.api(method,path,body)`
 *   upstream        (test)    a controllable upstream dev server (see upstream.ts); `upstream.script` drives `/run`
 *   operator        (test)    `.authenticate(ctx,origin)`, `.fakeSession()`, `.gotoDashboard(page,origin,path)`, `.openLivePreview(...)`
 *   livePreview     (test)    `.open(page, {dashHost?, target?, session?})` → `LiveViewer` for `upstream` through the real viewer UI
 *   dashHost        (option)  host the project's dashboard is reached as (`localhost` | `dash.test`); baseURL derives from it
 *   dashOrigin      (test)    `http://<dashHost>:<port>` (== baseURL)
 */
export interface LivePreviewOptions {
  dashHost: string;
}

interface TestFixtures {
  upstream: Upstream;
  operator: Operator;
  dashOrigin: string;
  livePreview: {
    /** Open `upstream` in the viewer pane for a fresh fake session. `dashHost` overrides the project's host (e.g. `127.0.0.1`, `localhost.`); `target` overrides the previewed URL. */
    open(page: import("@playwright/test").Page, opts?: { dashHost?: string; target?: string; session?: FakeSession }): Promise<LiveViewer>;
  };
}

interface WorkerFixtures {
  isolatedServer: IsolatedServer;
}

export const test = base.extend<TestFixtures & LivePreviewOptions, WorkerFixtures>({
  dashHost: ["localhost", { option: true }],
  isolatedServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
    async ({}, use) => {
      await use(new IsolatedServer(readState()));
    },
    { scope: "worker" },
  ],
  dashOrigin: async ({ isolatedServer, dashHost }, use) => {
    await use(isolatedServer.origin(dashHost));
  },
  baseURL: async ({ dashOrigin }, use) => {
    await use(dashOrigin);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  upstream: async ({}, use) => {
    const up = await startUpstream();
    await use(up);
    await up.close();
  },
  operator: async ({ isolatedServer }, use) => {
    const op = new Operator(isolatedServer);
    await use(op);
    await op.dispose();
  },
  livePreview: async ({ operator, upstream, dashOrigin, isolatedServer }, use) => {
    await use({
      open: (page, opts = {}) => {
        const origin = opts.dashHost ? isolatedServer.origin(opts.dashHost) : dashOrigin;
        return operator.openLivePreview(page, { dashOrigin: origin, target: opts.target ?? upstream.url, session: opts.session });
      },
    });
  },
});

export type { LiveViewer } from "./operator.js";
export type { Upstream } from "./upstream.js";
export { expect };
