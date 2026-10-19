import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Apple Tools settings states, reached by answering `GET /api/apple-tools/status`
 * (the shared checker's readout). The container is Linux, so every state fakes
 * `platform: "darwin"`. See change: retro-ux-plugin-settings-wave-2.
 */

const STATUS = "/api/apple-tools/status";
const PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

const readout = (extra: Record<string, unknown>) => (page: Page) =>
  stubApi(page, STATUS, (route) => json(route, { platform: "darwin", imcpServerPath: PATH, appPresent: false, ...extra }), "GET");

const settled = (testId: string) => (page: Page) => page.getByTestId(testId);

export const appleToolsStates: UiState[] = [
  bodyState("apple-tools", {
    id: "macos-too-old",
    label: "iMCP needs a newer macOS",
    stubs: [STATUS],
    install: readout({ state: "OS_TOO_OLD", message: "macOS 14.6.1 is below the minimum supported 15.3." }),
    ready: settled("apple-tools-notice"),
  }),
  bodyState("apple-tools", {
    id: "not-installed",
    label: "iMCP app absent, install from a terminal",
    stubs: [STATUS],
    install: readout({ state: "READY", message: "ok" }),
    ready: settled("apple-tools-needs-cli"),
  }),
  bodyState("apple-tools", {
    id: "installed",
    label: "installed, grants pending",
    stubs: [STATUS],
    install: readout({ state: "READY_PENDING_GRANTS", message: "ok", appPresent: true, resolvedPath: PATH }),
    ready: settled("apple-tools-notice"),
  }),
  bodyState("apple-tools", {
    id: "status-unavailable",
    label: "status request answers 404",
    stubs: [STATUS],
    install: (page) => stubApi(page, STATUS, (route) => json(route, { error: "not found" }, 404), "GET"),
    ready: settled("apple-tools-error"),
  }),
];
