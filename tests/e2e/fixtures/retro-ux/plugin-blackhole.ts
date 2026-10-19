import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Blackhole settings states: `GET /api/plugins/blackhole/status` decides
 * installed-ness; `GET /api/plugins/blackhole/config` is the real answer (all
 * fields with their defaults) with `exists` set, or a 409 parse-error body.
 * See change: retro-ux-plugin-settings-wave-2.
 */

const STATUS = "/api/plugins/blackhole/status";
const CONFIG = "/api/plugins/blackhole/config";

const installed = (page: Page) => stubApi(page, STATUS, (route) => json(route, { installed: true }), "GET");
const config = (page: Page) =>
  stubApi(
    page,
    CONFIG,
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...body, exists: true } });
    },
    "GET",
  );

const ready = (page: Page) => page.getByTestId("blackhole-settings");

export const blackholeStates: UiState[] = [
  bodyState("blackhole", { id: "populated", label: "installed, file present, defaults", stubs: [STATUS, CONFIG], install: all(installed, config), ready }),
  bodyState("blackhole", {
    id: "group-open-invalid",
    label: "numeric field cleared (invalid)",
    stubs: [STATUS, CONFIG],
    install: all(installed, config),
    ready,
    extra: async (page) => {
      await page.getByTestId("blackhole-input-observeAfterTokens").fill("");
    },
  }),
  bodyState("blackhole", {
    id: "parse-error",
    label: "config file cannot be parsed",
    stubs: [STATUS, CONFIG],
    install: all(installed, (page) =>
      stubApi(
        page,
        CONFIG,
        (route) => json(route, { status: "parse-error", filePath: "/home/pi/.pi/agent/pi-blackhole/pi-blackhole-config.json", message: "Unexpected token } in JSON at position 212" }, 409),
        "GET",
      ),
    ),
    ready: (page) => page.getByTestId("blackhole-parse-error"),
  }),
  bodyState("blackhole", {
    id: "not-installed",
    label: "pi-blackhole absent",
    stubs: [STATUS],
    install: (page) => stubApi(page, STATUS, (route) => json(route, { installed: false }), "GET"),
    ready: (page) => page.getByTestId("blackhole-not-installed"),
  }),
];
