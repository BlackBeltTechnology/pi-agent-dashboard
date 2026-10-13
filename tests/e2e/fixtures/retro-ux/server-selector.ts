import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { CORS, hold, ok, stubApi } from "./stubs.js";

/**
 * Header server-selector states: the trigger (connected) and the
 * portalled menu (probing / mixed / switching). Probe outcomes come from
 * stubbing the selector's own requests — the cross-origin `/api/health` fetch
 * and the server-side `/api/known-servers/probe`. See change:
 * retro-ux-identity-connectivity.
 */

type Behaviour = "available" | "unreachable" | "denied" | "cors-blocked" | "name-not-resolved";

interface Server {
  host: string;
  label: string;
  behaviour: Behaviour;
  fingerprint?: string;
  movedTo?: { host: string; port: number };
}

const SERVERS: Server[] = [
  { host: "office-mac.local", label: "office-mac", behaviour: "available", fingerprint: "sha256:aa" },
  { host: "192.168.16.202", label: "build-box", behaviour: "unreachable" },
  { host: "studio-pi.tail3c2f1.ts.net", label: "studio-pi", behaviour: "cors-blocked", fingerprint: "sha256:bb" },
  { host: "lab-mini.local", label: "lab-mini", behaviour: "denied" },
  { host: "nas.local", label: "nas", behaviour: "name-not-resolved", fingerprint: "sha256:cc", movedTo: { host: "nas-2.local", port: 8000 } },
];

const knownList = () =>
  SERVERS.map((s) => ({
    host: s.host,
    port: 8000,
    label: s.label,
    addedAt: "2026-01-01T00:00:00Z",
    ...(s.fingerprint ? { fingerprint: s.fingerprint } : {}),
    ...(s.movedTo ? { movedTo: s.movedTo } : {}),
  }));

const PROBE_STATUS: Record<Behaviour, string> = {
  available: "reachable",
  unreachable: "refused",
  denied: "reachable",
  "cors-blocked": "reachable",
  "name-not-resolved": "name-not-resolved",
};

async function stubServers(page: Page, mode: "mixed" | "probing"): Promise<void> {
  await stubApi(page, "/api/known-servers", (route) => ok(route, knownList(), { canManage: true }), "GET");
  await stubApi(
    page,
    "/api/known-servers/probe",
    (route) => {
      const { host } = route.request().postDataJSON() as { host: string };
      const found = SERVERS.find((s) => s.host === host);
      return ok(route, { status: found ? PROBE_STATUS[found.behaviour] : "refused" });
    },
    "POST",
  );
  // The selector fetches `http://<host>:8000/api/health` directly from the browser.
  const byHost = new Map(SERVERS.map((s) => [s.host, s]));
  await page.route(
    (url) => byHost.has(url.hostname) && url.pathname === "/api/health",
    async (route: Route) => {
      if (mode === "probing") return hold();
      const server = byHost.get(new URL(route.request().url()).hostname)!;
      switch (server.behaviour) {
        case "available":
          return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        case "denied":
          return route.fulfill({
            status: 403,
            headers: CORS,
            contentType: "application/json",
            body: JSON.stringify({ error: "network_not_allowed" }),
          });
        default:
          return route.abort("failed");
      }
    },
  );
}

const trigger = (page: Page) => page.getByTitle("Switch server").first();
const menu = (page: Page) => page.getByRole("menu");

async function openMenu(page: Page): Promise<void> {
  await trigger(page).waitFor({ state: "visible" });
  await trigger(page).click();
  await menu(page).waitFor({ state: "visible" });
}

export const serverSelectorStates: UiState[] = [
  {
    id: "trigger-connected",
    label: "closed trigger, connected",
    stubs: ["/api/known-servers"],
    install: (page) => stubServers(page, "mixed"),
    open: async (page) => {
      await trigger(page).waitFor({ state: "visible" });
      await page.getByText("Connected", { exact: true }).first().waitFor();
    },
    root: trigger,
  },
  {
    id: "open-probing",
    label: "menu open, probes in flight",
    stubs: ["/api/known-servers"],
    install: (page) => stubServers(page, "probing"),
    open: async (page) => {
      await openMenu(page);
      await menu(page).getByText("Checking…").first().waitFor();
    },
    root: menu,
  },
  {
    id: "open-mixed",
    label: "menu open: current, available, unreachable, blocked, denied, name not found, moved",
    stubs: ["/api/known-servers", "/api/known-servers/probe"],
    install: (page) => stubServers(page, "mixed"),
    open: async (page) => {
      await openMenu(page);
      await menu(page).getByText("Moved", { exact: true }).waitFor();
      await menu(page).getByText("Unreachable", { exact: true }).waitFor();
    },
    root: menu,
  },
  {
    id: "switching",
    label: "switch to an available server in flight",
    stubs: ["/api/known-servers"],
    install: async (page) => {
      await stubServers(page, "mixed");
      // The staging socket to the other server stays CONNECTING (the switch gives up after 5 s), so the
      // switch is in flight while the menu is reopened. A routed socket would open at once and complete it.
      await page.addInitScript(() => {
        const Native = window.WebSocket;
        window.WebSocket = new Proxy(Native, {
          construct(target, args: [string, ...unknown[]]) {
            if (String(args[0]).includes("office-mac.local")) return Object.assign(new EventTarget(), { readyState: 0, close() {} });
            return Reflect.construct(target, args);
          },
        });
      });
    },
    open: async (page) => {
      await openMenu(page);
      await menu(page).getByText("Available", { exact: true }).waitFor();
      await menu(page).getByRole("menuitemradio", { name: /office-mac/ }).click(); // closes the menu
      await openMenu(page); // reopen while the switch is still in flight
      await menu(page).getByText(/Switching/).waitFor();
    },
    root: menu,
  },
];
