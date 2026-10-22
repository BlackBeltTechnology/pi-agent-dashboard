import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { CORS, hold, ok, stubApi } from "./stubs.js";

/**
 * Header server-selector states: the trigger (connected) and the
 * portalled menu (probing / mixed / switching). Probe outcomes come from
 * stubbing the selector's own requests — the cross-origin `/api/health` fetch
 * and the server-side `/api/known-servers/probe`. See change:
 * retro-ux-identity-connectivity.
 *
 * group-servers-by-identity: each route is proven with a signed identity challenge, so the stubs
 * hold real Ed25519 keys; `open-identity` shows one row per identity (route chips, a refused
 * route, pair actions) and `open-mixed` adds the can't-prove and different-identity rows.
 */

type Behaviour = "available" | "unreachable" | "denied" | "cors-blocked" | "name-not-resolved" | "cant-prove" | "different-identity";

/**
 * Real Ed25519 identities, generated once per run: the selector proves each route with a signed
 * challenge, so a stub has to hold a key it can sign with (and the saved fingerprint is the one
 * its public key hashes to). The fingerprint form is the server's: `sha256:` + base64url of the
 * SHA-256 over the SPKI DER key.
 */
export interface Identity {
  publicKey: string;
  fingerprint: string;
  sign: (nonce: string) => string;
}
const identities = new Map<string, Identity>();
export function identity(name: string): Identity {
  let id = identities.get(name);
  if (!id) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    id = {
      publicKey: der.toString("base64url"),
      fingerprint: `sha256:${createHash("sha256").update(der).digest("base64url")}`,
      sign: (nonce) => sign(null, Buffer.from(nonce, "utf-8"), privateKey).toString("base64url"),
    };
    identities.set(name, id);
  }
  return id;
}

interface HostStub {
  behaviour: Behaviour;
  /** The identity that host's challenge is signed with (default: its own name). */
  signsAs?: string;
}

/** What each address answers. The browser fetches `<scheme>://<host>:<port>/api/pair/challenge` + `/api/health` directly. */
const HOSTS: Record<string, HostStub> = {
  "office-mac.local": { behaviour: "available", signsAs: "office-mac" },
  "192.168.16.202": { behaviour: "unreachable" },
  "studio-pi.tail3c2f1.ts.net": { behaviour: "cors-blocked", signsAs: "studio-pi" },
  "lab-mini.local": { behaviour: "denied", signsAs: "lab-mini" },
  "nas.local": { behaviour: "name-not-resolved", signsAs: "nas" },
  "old-nas.lan": { behaviour: "cant-prove" },
  "imposter.lan": { behaviour: "different-identity", signsAs: "someone-else" },
  // One identity under three addresses, plus a LAN address that proves another identity (a refused chip).
  "192.168.16.204": { behaviour: "available", signsAs: "home-imac" },
  "home-imac.local": { behaviour: "available", signsAs: "home-imac" },
  "home-imac-0a1b.share.zrok.io": { behaviour: "available", signsAs: "home-imac" },
  "192.168.16.50": { behaviour: "different-identity", signsAs: "lab-server" },
  // Reachable only through a tunnel: its pair action is "Pair with code…".
  "cloud-box-9z8y.share.zrok.io": { behaviour: "available", signsAs: "cloud-box" },
  // Discovered by the Settings scan fixtures (a local server answers like any other).
  "mac-studio.local": { behaviour: "available", signsAs: "mac-studio" },
};

interface StubRoute {
  host: string;
  port: number;
  scheme: "http" | "https";
  source: "saved" | "mdns" | "pairing";
}
export interface Server {
  label: string;
  /** Identity this entry is saved under (omitted: an unpinned entry). */
  pinned?: string;
  routes: StubRoute[];
  movedTo?: { host: string; port: number };
}
const lan = (host: string): StubRoute => ({ host, port: 8000, scheme: "http", source: "saved" });
const tunnel = (host: string): StubRoute => ({ host, port: 443, scheme: "https", source: "pairing" });

export const MIXED: Server[] = [
  { label: "office-mac", pinned: "office-mac", routes: [lan("office-mac.local")] },
  { label: "build-box", routes: [lan("192.168.16.202")] },
  { label: "studio-pi", pinned: "studio-pi", routes: [lan("studio-pi.tail3c2f1.ts.net")] },
  { label: "lab-mini", routes: [lan("lab-mini.local")] },
  { label: "nas", pinned: "nas", routes: [lan("nas.local")], movedTo: { host: "nas-2.local", port: 8000 } },
  { label: "old-nas", routes: [lan("old-nas.lan")] },
  { label: "imposter", pinned: "imposter-claimed", routes: [lan("imposter.lan")] },
];

/** One row per identity: three routes proving the same server, one refused, and a tunnel-only server. */
export const IDENTITY: Server[] = [
  {
    label: "home-imac",
    pinned: "home-imac",
    routes: [lan("192.168.16.204"), lan("home-imac.local"), tunnel("home-imac-0a1b.share.zrok.io"), lan("192.168.16.50")],
  },
  { label: "cloud-box", pinned: "cloud-box", routes: [tunnel("cloud-box-9z8y.share.zrok.io")] },
];

const knownList = (servers: Server[]) =>
  servers.map((s) => ({
    host: s.routes[0].host,
    port: s.routes[0].port,
    label: s.label,
    addedAt: "2026-01-01T00:00:00Z",
    routes: s.routes,
    ...(s.pinned ? { fingerprint: identity(s.pinned).fingerprint } : {}),
    ...(s.movedTo ? { movedTo: s.movedTo } : {}),
  }));

/** The dashboard server's own probe of a route the browser could not reach. */
const PROBE_STATUS: Record<Behaviour, string> = {
  available: "reachable",
  unreachable: "refused",
  denied: "reachable",
  "cors-blocked": "reachable",
  "name-not-resolved": "name-not-resolved",
  "cant-prove": "reachable",
  "different-identity": "reachable",
};

/** A bare CORS preflight answer: the selector POSTs JSON to another origin. */
const PREFLIGHT = {
  ...CORS,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function answerChallenge(route: Route, host: HostStub): Promise<void> {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: PREFLIGHT });
  switch (host.behaviour) {
    case "unreachable":
    case "cors-blocked":
    case "name-not-resolved":
      return route.abort("failed");
    case "cant-prove":
      return json(route, 404, { success: false, error: "Not found" });
    default: {
      const { nonce } = request.postDataJSON() as { nonce: string };
      const id = identity(host.signsAs ?? "unknown");
      return json(route, 200, { success: true, data: { fingerprint: id.fingerprint, publicKey: id.publicKey, signature: id.sign(nonce), v: 1 } });
    }
  }
}

async function answerHealth(route: Route, host: HostStub): Promise<void> {
  if (host.behaviour === "denied") return json(route, 403, { error: "network_not_allowed" });
  if (host.behaviour === "available" || host.behaviour === "different-identity") return json(route, 200, { ok: true });
  return route.abort("failed");
}

/**
 * What every stubbed address answers: the selector and Settings ▸ Servers challenge each route
 * (`/api/pair/challenge`, signed), then check access (`/api/health`). `probing` never answers.
 */
export async function stubHosts(page: Page, mode: "mixed" | "probing"): Promise<void> {
  await page.route(
    (url) => url.hostname in HOSTS && (url.pathname === "/api/pair/challenge" || url.pathname === "/api/health"),
    async (route: Route) => {
      if (mode === "probing") return hold();
      const url = new URL(route.request().url());
      const host = HOSTS[url.hostname];
      return url.pathname === "/api/health" ? answerHealth(route, host) : answerChallenge(route, host);
    },
  );
}

/** The saved list (`GET /api/known-servers`), the server-side probe and every stubbed address. */
export async function stubServers(page: Page, mode: "mixed" | "probing", servers: Server[] = MIXED, canManage = true): Promise<void> {
  await stubApi(page, "/api/known-servers", (route) => ok(route, knownList(servers), { canManage }), "GET");
  await stubApi(
    page,
    "/api/known-servers/probe",
    (route) => {
      const { host } = route.request().postDataJSON() as { host: string };
      const found = HOSTS[host];
      return ok(route, { status: found ? PROBE_STATUS[found.behaviour] : "refused" });
    },
    "POST",
  );
  await stubHosts(page, mode);
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
      await page.locator('[data-testid="connection-chip"][aria-label$=", connected"]').first().waitFor();
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
    label: "menu open: current, available, unreachable, blocked, denied, name not found, moved, can't prove, different identity",
    stubs: ["/api/known-servers", "/api/known-servers/probe"],
    install: (page) => stubServers(page, "mixed"),
    open: async (page) => {
      await openMenu(page);
      await menu(page).getByText("Moved", { exact: true }).waitFor();
      await menu(page).getByText("Unreachable", { exact: true }).waitFor();
      await menu(page).getByText("Can't prove identity", { exact: true }).waitFor();
      await menu(page).getByText("Different identity", { exact: true }).waitFor();
    },
    root: menu,
  },
  {
    id: "open-identity",
    label: "menu open: one row per identity with route chips (one refused), Request access and Pair with code actions",
    stubs: ["/api/known-servers", "/api/known-servers/probe"],
    install: (page) => stubServers(page, "mixed", IDENTITY),
    open: async (page) => {
      await openMenu(page);
      await menu(page).getByText("Checking…").first().waitFor({ state: "detached" });
      await menu(page).getByTestId("route-chip").filter({ hasText: "different identity" }).first().waitFor();
      await menu(page).getByRole("menuitem", { name: "Request access…" }).waitFor();
      await menu(page).getByRole("menuitem", { name: "Pair with code…" }).waitFor();
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
