import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyState, enableInHealth, json, patchRow } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Browser Relay settings states, reached by answering the plugin's own
 * `/api/browser/{status,profiles,audit}` routes. The plugin is `defaultEnabled:
 * false`, so its `GET /api/plugins` row is patched to enabled (no harness write).
 * See change: retro-ux-plugin-settings-wave-2.
 */

const ROUTES = ["/api/browser/status", "/api/browser/profiles", "/api/browser/audit"];

const tab = { tabId: 7, title: "Dashboard", url: "http://localhost:8000/", state: "live" };
const PROFILES = {
  Default: {
    profileDirectory: "Default",
    label: "Anna (work)",
    email: "anna@blackbelt.hu",
    installed: true,
    hasToken: true,
    instances: [{ instanceId: "inst-1", state: "connected", tabs: [tab, { ...tab, tabId: 8, title: "Docs" }] }],
  },
  "Profile 1": {
    profileDirectory: "Profile 1",
    label: "Personal",
    email: "anna@gmail.com",
    installed: true,
    hasToken: false,
    passwordManagers: ["1Password"],
    instances: [],
  },
  "Profile 2": { profileDirectory: "Profile 2", label: "Old profile", installed: false, hasToken: false, instances: [] },
};
const AUDIT = {
  entries: [
    { ts: 1_700_000_300_000, profileDirectory: "Default", instanceId: "inst-1", kind: "attach", detail: "" },
    { ts: 1_700_000_200_000, profileDirectory: "Default", instanceId: "inst-1", kind: "detach", detail: "idle" },
    { ts: 1_700_000_100_000, profileDirectory: "Default", instanceId: "inst-1", kind: "navigate", detail: "https://example.com/" },
  ],
};

/** `/api/plugins` row enabled + `status`, `profiles`, `audit` answered; `extra` adds write stubs. */
const relay = (enabled: boolean, extra?: (page: Page) => Promise<void>) =>
  all(
    enableInHealth("browser"),
    patchRow("browser", (row) => {
      row.status = { ...(row.status ?? {}), enabled: true, loaded: true };
    }),
    (page) =>
      stubApi(page, "/api/browser/status", (route) => json(route, { enabled, canOpenChrome: true, settings: { defaultBrowser: "Default", onUnavailable: "ask" } }), "GET"),
    (page) => stubApi(page, "/api/browser/profiles", (route) => json(route, { profiles: PROFILES }), "GET"),
    (page) => stubApi(page, "/api/browser/audit", (route) => json(route, AUDIT), "GET"),
    extra ?? (async () => {}),
  );

/** Relay on, three profiles — also the F7 collapsed-card scenario. */
export const browserInstall = relay(true);

const ready = (page: Page) => page.getByTestId("browser-settings");

export const browserStates: UiState[] = [
  bodyState("browser", { id: "profiles", label: "relay on, three profiles", stubs: ROUTES, install: browserInstall, ready }),
  bodyState("browser", {
    id: "paired-connected",
    label: "paired profile, connected tabs",
    stubs: ROUTES,
    install: relay(true),
    ready: (page) => page.getByTestId("browser-connected-Default"),
  }),
  bodyState("browser", {
    id: "relay-off",
    label: "relay connections off",
    stubs: ROUTES,
    install: relay(false),
    ready: (page) => page.getByTestId("browser-relay-off"),
  }),
  bodyState("browser", {
    id: "write-failed",
    label: "pairing token write refused",
    stubs: [...ROUTES, "/api/browser/profile"],
    install: relay(true, (page) => stubApi(page, "/api/browser/profile", (route) => json(route, { error: "boom" }, 500), "PUT")),
    ready,
    extra: async (page) => {
      await page.getByTestId("browser-token-input-Profile 1").fill("tok-123");
      await page.getByTestId("browser-token-save-Profile 1").click();
      await page.getByTestId("browser-error-Profile 1").waitFor({ state: "visible" });
    },
  }),
];
