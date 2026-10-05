/**
 * Shared harness for server-level identity boot tests (identity-boot.test.ts,
 * identity-d20-smoke.test.ts): a throwaway HOME holding a config + trusted
 * drop-in plugins, console capture, and a ticketless WS dial.
 *
 * Not a test file (no `.test.ts` suffix ⇒ not collected). See change:
 * add-multi-user-identity-plane (D20/D21).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { vi } from "vitest";
import { WebSocket } from "ws";
import { resetConfigSnapshot } from "../../config-snapshot.js";
import { createTestServer, type TestServerHandle } from "../../test-support/test-server.js";

export interface BootHarness {
  readonly home: string;
  readonly logs: string[];
  handle(): TestServerHandle;
  /** Drop a fixture plugin under `<HOME>/.pi/dashboard/plugins/<id>/`. */
  dropIn(id: string, serverSource: string): void;
  writeConfig(config: Record<string, unknown>): void;
  boot(overrides?: Parameters<typeof createTestServer>[0]): Promise<TestServerHandle>;
  json(urlPath: string, init?: RequestInit): Promise<any>;
  output(): string;
  notEnforcedLines(): string[];
  /** Dial `/ws` (optionally with `?ticket=`): resolves the WebSocket once open, or null if refused. */
  dial(ticket?: string): Promise<WebSocket | null>;
  /** Restore HOME, stop the server, remove the temp dir. */
  teardown(): Promise<void>;
}

export const loginPlugin = (id: string, opts: { thenThrow?: boolean } = {}): string =>
  `export default async (ctx) => { ctx.registerBrowserLoginConfig({ loginUrl: "/${id}/login", logoutUrl: "/${id}/logout" });${
    opts.thenThrow ? ' throw new Error("boom");' : ""
  } };`;

export function createBootHarness(): BootHarness {
  const realHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-boot-"));
  fs.mkdirSync(path.join(home, ".pi", "dashboard", "plugins"), { recursive: true });
  process.env.HOME = home;
  vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");

  const logs: string[] = [];
  const capture = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);

  let current: TestServerHandle | undefined;

  const h: BootHarness = {
    home,
    logs,
    handle: () => {
      if (!current) throw new Error("server not booted");
      return current;
    },
    dropIn(id, serverSource) {
      const dir = path.join(home, ".pi", "dashboard", "plugins", id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: `@test/${id}`,
          version: "0.0.0",
          type: "module",
          "pi-dashboard-plugin": { id, fixture: true, displayName: id, claims: [], priority: 100, server: "./server.mjs" },
        }),
      );
      fs.writeFileSync(path.join(dir, "server.mjs"), serverSource);
    },
    writeConfig(config) {
      fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(config));
      resetConfigSnapshot();
    },
    async boot(overrides = {}) {
      clearDiscoveryCache();
      current = await createTestServer(overrides);
      return current;
    },
    async json(urlPath, init) {
      return (await fetch(`http://127.0.0.1:${h.handle().httpPort}${urlPath}`, init)).json();
    },
    output: () => logs.join("\n"),
    notEnforcedLines: () => logs.filter((l) => l.includes("identity is NOT enforced")),
    dial(ticket) {
      return new Promise((resolve) => {
        const qs = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
        const ws = new WebSocket(`ws://127.0.0.1:${h.handle().httpPort}/ws${qs}`);
        let settled = false;
        const done = (v: WebSocket | null) => {
          if (settled) return;
          settled = true;
          if (!v) {
            try {
              ws.close();
            } catch {
              /* best-effort */
            }
          }
          resolve(v);
        };
        ws.on("open", () => done(ws));
        ws.on("unexpected-response", () => done(null));
        ws.on("error", () => done(null));
        setTimeout(() => done(null), 5000);
      });
    },
    async teardown() {
      if (current) await current.stop();
      current = undefined;
      // Late async logs from the stopped server must still land in the capture,
      // not on the real console after the worker has begun closing its rpc.
      await new Promise((r) => setTimeout(r, 100));
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      process.env.HOME = realHome;
      fs.rmSync(home, { recursive: true, force: true });
      clearDiscoveryCache();
      resetConfigSnapshot();
    },
  };
  return h;
}
