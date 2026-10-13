import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { fail, hold, ok, settingsSection, stubApi } from "./stubs.js";

/**
 * Settings ▸ Remote Servers ▸ Known Servers states, reached by stubbing
 * `/api/known-servers`. See change: retro-ux-identity-connectivity.
 */

const entry = (host: string, label: string, extra: Record<string, unknown> = {}) => ({
  host,
  port: 8000,
  label,
  addedAt: "2026-01-01T00:00:00Z",
  ...extra,
});
const LIST = [
  entry("office-mac.local", "office-mac", { fingerprint: "sha256:aa" }),
  entry("192.168.16.202", "build-box"),
  entry("studio-pi.tail3c2f1.ts.net", "studio-pi", { fingerprint: "sha256:bb" }),
  entry("nas.local", "nas", { fingerprint: "sha256:cc", movedTo: { host: "nas-2.local", port: 8000 } }),
];

const section = (page: Page) => settingsSection(page, "Known Servers");

async function gotoRemote(page: Page): Promise<void> {
  await page.goto("/settings/remote");
  await section(page).waitFor({ state: "visible" });
}

const listWith = (servers: unknown[], canManage = true) => (page: Page) =>
  stubApi(page, "/api/known-servers", (route) => ok(route, servers, { canManage }), "GET");

const base = { stubs: ["/api/known-servers"], root: section };

export const knownServersStates: UiState[] = [
  {
    id: "list",
    label: "verified, unverified and moved-to entries",
    ...base,
    install: listWith(LIST),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText("office-mac", { exact: true }).waitFor();
    },
  },
  {
    id: "remove-confirm",
    label: "remove awaiting confirmation",
    ...base,
    install: listWith(LIST),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Remove office-mac/ }).click();
      await section(page).getByRole("button", { name: /^Confirm remove/ }).waitFor();
    },
  },
  {
    id: "row-error",
    label: "remove rejected by the server",
    ...base,
    install: async (page) => {
      await listWith(LIST)(page);
      await stubApi(page, "/api/known-servers", (route) => fail(route, "operator credential required"), "DELETE");
    },
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Remove office-mac/ }).click();
      await section(page).getByRole("button", { name: /^Confirm remove/ }).click();
      await section(page).getByRole("alert").waitFor();
    },
  },
  {
    id: "read-only",
    label: "viewer without an operator credential",
    ...base,
    install: listWith(LIST, false),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText(/Read-only/).waitFor();
    },
  },
  {
    id: "add-open",
    label: "add form open",
    ...base,
    install: listWith(LIST.slice(0, 1)),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: "Add server manually" }).click();
      await section(page).getByLabel("Host").waitFor();
    },
  },
  {
    id: "add-error",
    label: "add form submitted empty",
    ...base,
    install: listWith(LIST.slice(0, 1)),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: "Add server manually" }).click();
      await section(page).getByRole("button", { name: "Add server" }).click();
      await section(page).getByRole("alert").waitFor();
    },
  },
  {
    id: "empty",
    label: "no remote servers saved",
    ...base,
    install: listWith([]),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText(/No remote servers saved/).waitFor();
    },
  },
  {
    id: "loading",
    label: "request in flight",
    ...base,
    install: (page) => stubApi(page, "/api/known-servers", () => hold(), "GET"),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("status").waitFor();
    },
  },
  {
    id: "load-error",
    label: "list request failed",
    ...base,
    install: (page) => stubApi(page, "/api/known-servers", (route) => fail(route, "HTTP 503"), "GET"),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("alert").waitFor();
    },
  },
];
