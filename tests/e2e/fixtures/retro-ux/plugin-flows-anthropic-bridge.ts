import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Anthropic Messages Bridge settings states, reached by answering
 * `GET /api/flows-anthropic-bridge/status` (one row per pi session process).
 * `bridgeSessions` is exported for the table-scroll assertion (test-plan E39).
 * See change: retro-ux-plugin-settings-wave-2.
 */

const STATUS = "/api/flows-anthropic-bridge/status";
const AM = "@pi/anthropic-messages";
const OK = { ok: true };

export const bridgeSessions = {
  none: [],
  active: [
    { status: "active", peers: { [AM]: OK, "pi-flows": OK }, pid: 4121, at: 1 },
    { status: "active", peers: { [AM]: OK, "pi-flows": OK }, pid: 4188, at: 2 },
  ],
  degraded: [
    { status: "active", peers: { [AM]: OK, "pi-flows": OK }, pid: 4121, at: 1 },
    {
      status: "waiting_peers",
      peers: { [AM]: { ok: false, reason: "extension not loaded in this session" }, "pi-flows": OK },
      pid: 4188,
      at: 2,
    },
    {
      status: "degraded",
      peers: { [AM]: OK, "pi-flows": { ok: false, reason: "no flows registered after 30 seconds" } },
      pid: 4302,
      at: 3,
    },
  ],
};

export const answerBridge = (sessions: unknown[]) => (page: Page) =>
  stubApi(page, STATUS, (route) => json(route, { sessions }), "GET");

const ready = (page: Page) => page.getByTestId("flows-anthropic-bridge-settings");

export const bridgeStates: UiState[] = [
  bodyState("flows-anthropic-bridge", {
    id: "no-sessions",
    label: "no pi session has reported",
    stubs: [STATUS],
    install: answerBridge(bridgeSessions.none),
    ready,
  }),
  bodyState("flows-anthropic-bridge", {
    id: "active",
    label: "bridge active in every session",
    stubs: [STATUS],
    install: answerBridge(bridgeSessions.active),
    ready: (page) => page.getByTestId("flows-anthropic-bridge-session-4121"),
  }),
  bodyState("flows-anthropic-bridge", {
    id: "degraded-gate-changed",
    label: "degraded sessions, gate switched to Always on (unsaved)",
    stubs: [STATUS],
    install: answerBridge(bridgeSessions.degraded),
    ready: (page) => page.getByTestId("flows-anthropic-bridge-session-4302"),
    extra: async (page) => {
      await page.getByTestId("flows-anthropic-bridge-force").click();
    },
  }),
];
