/**
 * Shared L3 helpers for the add-google-connect specs (plugin-settings-pages, plugin-oauth-flow, gmail-plugin,
 * oauth-redirect-base). Real server, real client, in-container fake Google (`fake-google.ts`). The harness
 * browser reaches the dashboard from a NON-loopback peer, so the plugin treats it as a REMOTE browser: consent
 * completes through the paste fallback (own installed client) or the return-page callback (built-in remote,
 * `PI_E2E_GOOGLE_BUILTIN=1` placeholder app). See change: add-google-connect.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect } from "../fixtures.js";
import { BASE_URL, DASHBOARD_PORT, harnessProject, REPO_ROOT } from "../lifecycle.js";
import { FAKE_GOOGLE_BASE, fakeGoogleConsent, fakeGoogleControl, startFakeGoogle } from "./fake-google.js";

export const GOOGLE_SETTINGS = "/settings/plugins/google";
export const API = "/api/plugins/google";
export const RETURN_PAGE = "https://pi-dashboard.dev/oauth/return.html";

export function containerId(): string {
  return execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0] as string;
}

/**
 * A request the server sees from a genuinely LOCAL peer (loopback, no forwarding header) that also carries local
 * proof: `pi-dashboard api` run inside the container (the same path the entrypoint uses to mint a ws ticket).
 * Returns the parsed JSON body; a refusal throws with the CLI output.
 */
export function localDashboardApi<T = unknown>(cid: string, method: string, path: string, data?: unknown): T {
  const args = ["exec", cid, "pi-dashboard", "api", method, path, "--port", String(DASHBOARD_PORT)];
  if (data !== undefined) args.push("--data", JSON.stringify(data));
  return JSON.parse(execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 })) as T;
}

/** The data-use disclosure can only be accepted from the dashboard host itself (`origin_denied` otherwise). */
export function acceptDisclosureOnHost(cid: string): void {
  expect(localDashboardApi<{ ok?: boolean }>(cid, "PUT", `${API}/disclosure`).ok).toBe(true);
}

export interface AccountRow {
  sub: string;
  email: string;
  client: string;
  status: string;
  products: Record<string, { level: string } | undefined>;
  missing?: string[];
}

export interface GoogleState {
  accounts: AccountRow[];
  clients: Array<{ id: string; ref?: string; label: string }>;
  builtin: { available: boolean; ref?: string };
  disclosure: { version: number; accepted: boolean };
  browser: string;
  /** `<dashboard base>/api/plugins/google/oauth/callback` once the server knows its public base. */
  webRedirectUri?: string;
}

export async function googleState(request: APIRequestContext): Promise<GoogleState> {
  const res = await request.get(`${API}/state`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as GoogleState;
}

/** Fresh slate: fake Google running + reset, no accounts, no own clients. */
export async function resetGoogle(request: APIRequestContext, cid: string): Promise<void> {
  await startFakeGoogle(cid);
  fakeGoogleControl(cid, "reset");
  const state = await googleState(request);
  for (const a of state.accounts) await request.delete(`${API}/accounts/${encodeURIComponent(a.sub)}`);
  for (const c of state.clients) await request.delete(`${API}/clients/${encodeURIComponent(c.id.replace(/^own:/, ""))}`);
}

/** Upload an own Desktop (installed) client; returns its ref (`own:<id>`). */
export async function addOwnClient(request: APIRequestContext, label = "E2E org", domains: string[] = []): Promise<string> {
  const json = { installed: { client_id: "e2e.apps.googleusercontent.com", client_secret: "e2e-secret", project_id: "e2e-proj-1" } };
  const res = await request.put(`${API}/clients`, { data: { json, label, domains } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { client: { id: string; ref?: string } };
  return body.client.ref ?? (body.client.id.startsWith("own:") ? body.client.id : `own:${body.client.id}`);
}

/** The Google URL the server handed the dialog / REST caller for a flow. */
export async function flowAuthUrl(request: APIRequestContext, flowId: string): Promise<string> {
  let url = "";
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/provider-auth/flow/${encodeURIComponent(flowId)}`);
        url = ((await res.json()) as { authUrl?: string }).authUrl ?? "";
        return url;
      },
      { timeout: 15_000 },
    )
    .toContain(FAKE_GOOGLE_BASE);
  return url;
}

export async function waitForAccount(request: APIRequestContext, email: string): Promise<AccountRow> {
  let found: AccountRow | undefined;
  await expect
    .poll(async () => (found = (await googleState(request)).accounts.find((a) => a.email === email)) !== undefined, { timeout: 20_000 })
    .toBe(true);
  return found as AccountRow;
}

/**
 * Connect `email` through the REST API on an own installed client: start → follow the auth URL inside the
 * container → hand the redirect to the flow's paste input (what the dialog's fallback does).
 */
export async function seedAccount(
  request: APIRequestContext,
  cid: string,
  email: string,
  client: string,
  products: Record<string, { level: string }> = { calendar: { level: "read" } },
): Promise<AccountRow> {
  fakeGoogleControl(cid, "config", { nextEmail: email });
  const res = await request.post(`${API}/accounts`, { data: { products, client } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { flowId } = (await res.json()) as { flowId: string };
  const redirect = fakeGoogleConsent(cid, await flowAuthUrl(request, flowId));
  const input = await request.post(`/api/provider-auth/flow/${encodeURIComponent(flowId)}/input`, { data: { value: redirect } });
  expect(input.ok(), await input.text()).toBeTruthy();
  return waitForAccount(request, email);
}

/**
 * The harness browser cannot reach the in-container fake Google. Resolve every navigation to it the way
 * the real Google would — through the fake, inside the container — and hand `onRedirect` the location.
 * Default: answer 204 so the popup stays inert (the paste fallback / spec drives the rest).
 */
export async function routeFakeGoogle(
  context: BrowserContext,
  cid: string,
  onAuth?: (authUrl: string, location: string) => string | undefined,
): Promise<string[]> {
  const seen: string[] = [];
  await context.route(`${FAKE_GOOGLE_BASE}/**`, async (route) => {
    const url = route.request().url();
    seen.push(url);
    const location = fakeGoogleConsent(cid, url);
    const next = onAuth?.(url, location);
    // A scripted hop, not a 302: the browser re-routes a fresh navigation but not a fulfilled redirect.
    if (next) await route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(next)})</script>` });
    else await route.fulfill({ status: 200, contentType: "text/html", body: "<title>fake google</title>" });
  });
  return seen;
}

/** Open Settings → Google accounts and wait for the section. */
export async function openGoogleSettings(page: Page): Promise<void> {
  await page.goto(GOOGLE_SETTINGS);
  await expect(page.getByTestId("google-settings")).toBeVisible({ timeout: 20_000 });
}

export const accountRow = (page: Page, email: string) => page.locator(`[data-testid="google-account-row"][data-email="${email}"]`);

/** Collect page console errors from now on. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    // "Failed to load resource" carries no URL; the response listener below names it.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/api/plugins/google")) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** The static return page (`site/oauth/return.html`), served from a fixture origin for `RETURN_PAGE`. */
const RETURN_HTML = readFileSync(path.join(REPO_ROOT, "site", "oauth", "return.html"), "utf8");

/**
 * Remote built-in sign-in without the internet: the fake Google answers the authorize request and redirects to
 * the (fixture-served) return page, whose "Continue to <origin>" button reaches the dashboard's remote-callback.
 */
export async function routeReturnPageSignIn(context: BrowserContext, cid: string): Promise<string[]> {
  const seen = await routeFakeGoogle(context, cid, (_auth, location) => location);
  await context.route(/^https:\/\/pi-dashboard\.dev\/oauth\/return\.html/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: RETURN_HTML }),
  );
  return seen;
}

/** Open the Connect dialog, pick nothing special, press Continue; resolves with the popup Google opened. */
export async function continueWithGoogle(page: Page): Promise<Page> {
  await page.getByTestId("google-connect").click();
  const dialog = page.getByTestId("google-connect-dialog");
  await expect(dialog).toBeVisible();
  const popup = page.context().waitForEvent("page");
  await dialog.getByTestId("google-continue").click();
  return popup;
}

/**
 * The public origin the server believes it lives at (`auth.redirectBaseUrl`, seeded by the harness for the OAuth
 * specs). The return page navigates there, so a tunnel-like proxy routes it back to the harness dashboard.
 */
export async function dashboardPublicOrigin(request: APIRequestContext): Promise<string> {
  const uri = (await googleState(request)).webRedirectUri;
  expect(uri, "the server must know its public base (auth.redirectBaseUrl)").toBeTruthy();
  return new URL(uri as string).origin;
}

/** Tunnel-like proxy: requests to the public origin are answered by the harness dashboard. */
export async function routeTunnel(context: BrowserContext, origin: string): Promise<void> {
  await context.route(`${origin}/**`, async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: `${BASE_URL}${u.pathname}${u.search}` });
    await route.fulfill({ response });
  });
}

/** Ids of every sign-in flow the page starts (POST accounts / products / reauth), so a spec can cancel leftovers. */
export function trackFlows(page: Page): string[] {
  const ids: string[] = [];
  page.on("response", async (r) => {
    if (r.request().method() !== "POST" || !new URL(r.url()).pathname.startsWith(`${API}/accounts`)) return;
    try {
      const id = ((await r.json()) as { flowId?: string }).flowId;
      if (id) ids.push(id);
    } catch {
      /* not a flow reply */
    }
  });
  return ids;
}

/** Cancel flows a (possibly failed) spec left pending — an abandoned consent blocks that account for 300 s. */
export async function cancelFlows(request: APIRequestContext, ids: string[]): Promise<void> {
  for (const id of ids.splice(0)) await request.delete(`/api/provider-auth/flow/${encodeURIComponent(id)}`).catch(() => undefined);
}

/** GET a URL from INSIDE the container (loopback listeners the browser cannot reach); returns the status. */
export function containerGet(cid: string, url: string): number {
  const script = `fetch(${JSON.stringify(url)}).then((r) => process.stdout.write(String(r.status))).catch((e) => { process.stderr.write(String(e)); process.exit(1); });`;
  return Number(execFileSync("docker", ["exec", cid, "node", "-e", script], { encoding: "utf8", timeout: 30_000 }));
}

/**
 * Connect a built-in LOCAL account (`builtin`) from the dashboard host itself: the REST calls and the loopback
 * return both come from inside the container, exactly as a local browser's would.
 */
export async function seedLocalBuiltinAccount(
  request: APIRequestContext,
  cid: string,
  email: string,
  products: Record<string, { level: string }> = { calendar: { level: "read" } },
): Promise<AccountRow> {
  acceptDisclosureOnHost(cid);
  fakeGoogleControl(cid, "config", { nextEmail: email });
  const started = localDashboardApi<{ flowId: string; client: string }>(cid, "POST", `${API}/accounts`, { products, client: "builtin" });
  expect(started.client).toBe("builtin");
  const status = localDashboardApi<{ authUrl?: string }>(cid, "GET", `/api/provider-auth/flow/${encodeURIComponent(started.flowId)}`);
  expect(status.authUrl).toContain(FAKE_GOOGLE_BASE);
  const back = fakeGoogleConsent(cid, status.authUrl as string);
  expect(back).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(containerGet(cid, back)).toBe(200);
  return waitForAccount(request, email);
}
