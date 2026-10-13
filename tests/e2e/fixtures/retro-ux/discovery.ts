import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { fail, hold, ok, settingsSection, stubApi } from "./stubs.js";

/**
 * Settings ▸ Remote Servers ▸ Network Discovery states, reached by stubbing
 * `POST /api/discover-servers` (and the known-servers list the section compares
 * against). See change: retro-ux-identity-connectivity.
 */

const KNOWN = [
  { host: "office-mac.local", port: 8000, label: "office-mac", addedAt: "2026-01-01T00:00:00Z", fingerprint: "sha256:aa" },
];
const found = (host: string, extra: Record<string, unknown> = {}) => ({
  host,
  port: 8000,
  piPort: 9999,
  version: "0.9.4",
  pid: 1,
  isLocal: false,
  source: "mdns",
  ...extra,
});
const DISCOVERED = [
  found("office-mac.local", { name: "office-mac", fingerprint: "sha256:aa" }),
  found("lab-mini.local", { name: "lab-mini", fingerprint: "sha256:dd" }),
  found("mac-studio.local", { name: "mac-studio", isLocal: true, fingerprint: "sha256:ee" }),
];

const section = (page: Page) => settingsSection(page, "Network Discovery");

const install = (discover: Parameters<typeof stubApi>[2], addUpdated = false) => async (page: Page) => {
  await stubApi(page, "/api/known-servers", (route) => ok(route, KNOWN, { canManage: true }), "GET");
  await stubApi(page, "/api/known-servers", (route) => ok(route, { updated: addUpdated }), "POST");
  await stubApi(page, "/api/discover-servers", discover, "POST");
};

async function gotoRemote(page: Page): Promise<void> {
  await page.goto("/settings/remote");
  await section(page).waitFor({ state: "visible" });
}

const scan = async (page: Page) => {
  await gotoRemote(page);
  await section(page).getByRole("button", { name: "Scan network" }).click();
};

const base = { stubs: ["/api/discover-servers"], root: section };

export const discoveryStates: UiState[] = [
  {
    id: "idle",
    label: "before the first scan",
    ...base,
    install: install((route) => ok(route, DISCOVERED)),
    open: gotoRemote,
  },
  {
    id: "scanning",
    label: "scan in flight",
    ...base,
    install: install(() => hold()),
    open: async (page) => {
      await scan(page);
      await section(page).getByRole("button", { name: "Scanning…" }).waitFor();
    },
  },
  {
    id: "scan-error",
    label: "scan request failed",
    ...base,
    install: install((route) => fail(route, "mdns_unavailable")),
    open: async (page) => {
      await scan(page);
      await section(page).getByRole("alert").waitFor();
    },
  },
  {
    id: "empty-diagnostic",
    label: "no servers found: diagnostic and manual add",
    ...base,
    install: install((route) => ok(route, [])),
    open: async (page) => {
      await scan(page);
      await section(page).getByText(/No dashboards found via mDNS/).waitFor();
    },
  },
  {
    id: "manual-error",
    label: "manual add with an unparseable address",
    ...base,
    install: install((route) => ok(route, [])),
    open: async (page) => {
      await scan(page);
      await section(page).getByLabel("Address").fill("[::1");
      await section(page).getByRole("button", { name: "Add", exact: true }).click();
      await section(page).getByLabel("Address").and(page.locator('[aria-invalid="true"]')).waitFor();
    },
  },
  {
    id: "results",
    label: "new, already added and local servers",
    ...base,
    install: install((route) => ok(route, DISCOVERED)),
    open: async (page) => {
      await scan(page);
      await section(page).getByText("Already added").waitFor();
    },
  },
  {
    id: "adding",
    label: "label input open on a discovered server",
    ...base,
    install: install((route) => ok(route, DISCOVERED)),
    open: async (page) => {
      await scan(page);
      await section(page).getByRole("button", { name: /^Add lab-mini/ }).click();
      await section(page).getByLabel("Label for lab-mini").waitFor();
    },
  },
  {
    id: "updated",
    label: "add confirmed and the server reported an update",
    ...base,
    install: install((route) => ok(route, DISCOVERED), true),
    open: async (page) => {
      await scan(page);
      await section(page).getByRole("button", { name: /^Add lab-mini/ }).click();
      await section(page).getByRole("button", { name: "Add lab-mini" }).click();
      await section(page).getByText("Updated existing entry").waitFor();
    },
  },
];
