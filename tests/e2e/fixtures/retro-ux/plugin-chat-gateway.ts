import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyState, json, patchConfig } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Chat Gateway settings states: config via the real `GET /api/config` patched
 * (`plugins.chat-gateway`), the bindings table via `GET /api/chat-gateway/
 * bindings` (404 = not set up). "Team disarmed" needs the WebSocket-pushed team
 * surface, so it answers the page's `chat_gateway_team_surface` request itself
 * through `page.routeWebSocket`. See change: retro-ux-plugin-settings-wave-2.
 */

const BINDINGS = "/api/chat-gateway/bindings";
const TEAM_SURFACE = "chat_gateway_team_surface";

const CONFIGURED = {
  enabled: true,
  allowedRoots: ["/fixtures/sample-git"],
  defaultCwd: "/fixtures/sample-git",
  fixedMap: { "discord:1234567890:-": "/fixtures/sample-git" },
  allowlist: ["anna#0001"],
};
const BOUND = {
  bindings: [
    { platform: "discord", channelId: "1234567890", sessionId: "s-1", cwd: "/fixtures/sample-git", boundBy: "anna", source: "fixed" },
  ],
  status: { running: true, boundChannels: 1, pendingSpawns: 0 },
};

const ready = (page: Page) => page.getByTestId("chat-gateway-settings");

const SURFACE = {
  configured: true,
  disarmed: true,
  ceiling: "observe",
  allowedRoots: ["/fixtures/sample-git"],
  bindings: [],
  log: [{ at: 1_700_000_000_000, principal: "anna", channelId: "1234567890", verb: "stop", outcome: "refused" }],
  logLimit: 50,
};

/** Forward the dashboard socket, but answer the team-surface request locally with a disarmed surface. */
const disarmedSurface = (page: Page) =>
  page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (typeof m === "string" && m.includes(TEAM_SURFACE)) ws.send(JSON.stringify({ type: TEAM_SURFACE, surface: SURFACE }));
      else server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });

export const chatGatewayStates: UiState[] = [
  bodyState("chat-gateway", {
    id: "not-set-up",
    label: "no bot token, gateway route absent",
    stubs: [BINDINGS, "/api/config"],
    install: all(patchConfig("chat-gateway", { enabled: true }), (page) => stubApi(page, BINDINGS, (route) => json(route, { error: "not found" }, 404), "GET")),
    ready: (page) => page.getByTestId("chat-gateway-status"),
  }),
  bodyState("chat-gateway", {
    id: "running",
    label: "configured, gateway running, one bound channel",
    stubs: [BINDINGS, "/api/config"],
    install: all(patchConfig("chat-gateway", CONFIGURED), (page) => stubApi(page, BINDINGS, (route) => json(route, BOUND), "GET")),
    ready: (page) => page.getByTestId("chat-gateway-bindings"),
  }),
  bodyState("chat-gateway", {
    id: "invalid-before-save",
    label: "malformed channel-folder line typed",
    stubs: [BINDINGS, "/api/config"],
    install: all(patchConfig("chat-gateway", CONFIGURED), (page) => stubApi(page, BINDINGS, (route) => json(route, BOUND), "GET")),
    ready,
    extra: async (page) => {
      await page.getByTestId("chat-gateway-fixed-map").fill("not-a-pair");
      await page.getByTestId("chat-gateway-fixed-map-error").waitFor({ state: "visible" });
    },
  }),
  bodyState("chat-gateway", {
    id: "team-disarmed",
    label: "team controls disarmed (pushed over the dashboard socket)",
    stubs: [BINDINGS, "/api/config"],
    install: all(patchConfig("chat-gateway", CONFIGURED), (page) => stubApi(page, BINDINGS, (route) => json(route, BOUND), "GET"), disarmedSurface),
    ready: (page) => page.getByTestId("team-disarm-state"),
  }),
];
