import { execFileSync } from "node:child_process";
import type { APIRequestContext, Page } from "@playwright/test";
import { DASHBOARD_PORT } from "../lifecycle.js";
import { resolveContainer } from "./container-proc.js";

/**
 * Shared plumbing for the runtime-delivery (canary) specs — change: decouple-plugins-from-core.
 *
 * The harness stages the prebuilt canary (`docker/test-up.sh`, `scripts/stage-runtime-canary.mjs`) and either pins
 * its content hash (`PI_E2E_CANARY` unset/`trusted`) or leaves it untrusted with the four failure variants copied
 * next to it (`PI_E2E_CANARY=untrusted`). Specs read the REAL server state (`GET /api/plugins`) and, where a scenario
 * needs the other state, flip it through the real trust endpoints — and ALWAYS restore it.
 *
 * WHY THE TRUST POST GOES THROUGH THE CONTAINER: `POST /api/plugins/:id/trust` grants code execution and is
 * "genuinely local" only (loopback, no forwarding headers). The Playwright host reaches the container through the
 * Docker bridge, so its request is NOT loopback and the server rightly answers `403 local_only`. The spec therefore
 * issues the same request from INSIDE the container (`docker exec … curl http://127.0.0.1:<port>`), which is what an
 * operator at the host machine does. `DELETE …/trust` (operate tier) works from the host directly.
 */

export const CANARY_ID = "runtime-canary";
export const VARIANT_IDS = [
  "runtime-canary-missing-export",
  "runtime-canary-bundled-react",
  "runtime-canary-throws-in-render",
  "runtime-canary-bundled-app-kit",
] as const;
/** Where the harness materialises the canary inside the container (HOME=/home/pi). */
export const CANARY_DIR_IN_CONTAINER = `/home/pi/.pi/dashboard/plugins/${CANARY_ID}`;

export interface PluginClientRow {
  id: string;
  packageDir?: string;
  status?: { loaded?: boolean; error?: string; client?: { delivery?: string; refusedReason?: string; sha256?: string } };
}

export interface RuntimeListingEntry {
  id: string;
  sha256: string;
  entry: string;
  styles?: string;
  claims: Array<{ slot: string; module?: string }>;
}

/** Run a shell script in the harness container; returns trimmed stdout. */
export function containerSh(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
}

/** A request issued from inside the container (loopback ⇒ "genuinely local"). */
export function localFetch(method: string, path: string, body?: string): { status: number; body: string } {
  const data = body === undefined ? "" : `-H 'content-type: application/json' --data-binary '${body.replace(/'/g, "'\\''")}'`;
  const out = containerSh(`curl -s -w '\\n%{http_code}' -X ${method} ${data} http://127.0.0.1:${DASHBOARD_PORT}${path}`);
  const cut = out.lastIndexOf("\n");
  return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut) };
}

export async function pluginRow(request: APIRequestContext, id: string): Promise<PluginClientRow | undefined> {
  const res = await request.get("/api/plugins");
  const body = (await res.json()) as { plugins?: PluginClientRow[] };
  return (body.plugins ?? []).find((p) => p.id === id);
}

/** `GET /api/plugins/runtime-clients` entries (admitted runtime plugins only). */
export async function runtimeListing(request: APIRequestContext): Promise<RuntimeListingEntry[]> {
  const res = await request.get("/api/plugins/runtime-clients");
  return ((await res.json()) as { plugins?: RuntimeListingEntry[] }).plugins ?? [];
}

/** Grant the CURRENT content hash of `id` (local-only endpoint, from inside the container). */
export async function trustPlugin(request: APIRequestContext, id: string): Promise<void> {
  const row = await pluginRow(request, id);
  const sha = row?.status?.client?.sha256;
  if (!sha) throw new Error(`no client hash on the "${id}" row (is the canary staged? PI_E2E_CANARY=off?)`);
  const res = localFetch("POST", `/api/plugins/${id}/trust`, JSON.stringify({ sha256: sha }));
  if (res.status !== 200) throw new Error(`trust ${id} failed: ${res.status} ${res.body}`);
}

export async function revokePlugin(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/plugins/${id}/trust`);
  if (!res.ok()) throw new Error(`revoke ${id} failed: ${res.status()}`);
}

/** Put the canary in the wanted trust state (no-op when already there). */
export async function ensureCanaryState(request: APIRequestContext, want: "trusted" | "untrusted"): Promise<void> {
  const row = await pluginRow(request, CANARY_ID);
  if (!row) throw new Error("runtime-canary is not discovered — start the harness with PI_E2E_SEED=1 (PI_E2E_CANARY != off)");
  const isTrusted = row.status?.client?.delivery === "runtime";
  if (want === "trusted" && !isTrusted) await trustPlugin(request, CANARY_ID);
  if (want === "untrusted" && isTrusted) await revokePlugin(request, CANARY_ID);
}

/** Whether the failure variants are staged (`PI_E2E_CANARY=untrusted`). */
export async function variantsStaged(request: APIRequestContext): Promise<boolean> {
  return (await pluginRow(request, VARIANT_IDS[0])) !== undefined;
}

/**
 * Forward the browser's `POST /api/plugins/<id>/trust` (the Plugins-tab Trust button) through the container, so the
 * REAL server grants it (see the file header). The UI sees the real response.
 */
export async function forwardTrustThroughContainer(page: Page, id: string): Promise<void> {
  await page.route(`**/api/plugins/${id}/trust`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const res = localFetch("POST", `/api/plugins/${id}/trust`, req.postData() ?? "{}");
    await route.fulfill({ status: res.status, contentType: "application/json", body: res.body });
  });
}

/** Collect `console.error` text and uncaught page errors for the lifetime of the page. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Count full document loads of `page` (a `load` event per navigation/reload). */
export function countLoads(page: Page): { readonly count: number } {
  const state = { count: 0 };
  page.on("load", () => {
    state.count += 1;
  });
  return state;
}

/** Resolves once the canary's ENTRY module has been fetched (the loader imported it). */
export function waitForCanaryEntry(page: Page): Promise<unknown> {
  return page.waitForResponse((r) => r.url().includes(`/plugin-assets/${CANARY_ID}/`) && r.url().endsWith("/index.js") && r.status() === 200, { timeout: 30_000 });
}
