import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * MCP Client settings states: `GET /api/mcp-client/effective` (the merged view)
 * and `GET /api/mcp-client/live` (pi's live server state).
 * See change: retro-ux-plugin-settings-wave-2.
 */

const EFFECTIVE = "/api/mcp-client/effective";
const LIVE = "/api/mcp-client/live";
const LAYER = { layer: "pi-global", path: "/home/pi/.pi/agent/mcp.json", exists: true, ok: true };

const server = (name: string, extra: Record<string, unknown>) => ({
  name,
  provenance: "pi-global",
  entry: {},
  transport: "stdio",
  enabled: true,
  exposure: "codemode",
  active: true,
  ignoredKeys: [],
  adapterLeftovers: [],
  ...extra,
});

const answer = (servers: unknown[], live: unknown) =>
  all(
    (page: Page) => stubApi(page, EFFECTIVE, (route) => json(route, { scope: "global", servers, layers: [LAYER] }), "GET"),
    (page: Page) => stubApi(page, LIVE, (route) => json(route, live), "GET"),
  );


export const mcpClientStates: UiState[] = [
  bodyState("mcp-client", {
    id: "empty",
    label: "no servers configured",
    stubs: [EFFECTIVE, LIVE],
    install: answer([], { ok: true, servers: {}, errors: [] }),
    ready: (page) => page.getByTestId("mcp-empty"),
  }),
  bodyState("mcp-client", {
    id: "populated",
    label: "three servers: ready, needs auth, disabled",
    stubs: [EFFECTIVE, LIVE],
    install: answer(
      [
        server("imcp", { entry: { command: "imcp-server" } }),
        server("notion", { transport: "http", exposure: "direct", entry: { url: "https://mcp.notion.com/mcp" } }),
        server("sandbox", { enabled: false, active: false, inactiveReason: "disabled", entry: { command: "sandbox-mcp" } }),
      ],
      {
        ok: true,
        servers: { imcp: { state: "ready", tools: 12 }, notion: { state: "needs-auth", tools: 0 } },
        errors: [],
      },
    ),
    ready: (page) => page.getByTestId("mcp-refresh"),
  }),
];

