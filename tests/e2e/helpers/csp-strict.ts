/**
 * Shared plumbing for the strict-CSP / report-sink browser specs (change: harden-cors-and-csp-reporting,
 * test-plan #WF1–#WF7; design D8–D10).
 *
 * - `installCspProbe` / `readCspProbe` — init script recording every `securitypolicyviolation` event.
 * - `cspHeaders` / `nonceOfHeaders` / `importMapNonceOfHtml` — read the (possibly repeated) CSP headers of a
 *   response. `headersArray()` keeps repeated `Content-Security-Policy-Report-Only` values separate, where
 *   `headers()` would comma-join them.
 * - `readCspReports` — the persisted counter block of `GET /api/health`, read from INSIDE the container (loopback
 *   passes the health disclosure predicate; the host's bridge address does not). Chromium does not reliably surface
 *   `report-uri` deliveries to `page.on("request")`, so the browser-delivery specs read counters, not requests.
 * - `pluginIds` — plugin ids from every `packages/*-plugin` manifest.
 */
import fs from "node:fs";
import path from "node:path";
import type { APIResponse, Page, Response } from "@playwright/test";
import { DASHBOARD_PORT, REPO_ROOT } from "../lifecycle.js";
import { containerSh } from "./runtime-canary.js";

export const CSP_REPORT_PREFIX = "/__pi/csp-report/";
export const TT_DIRECTIVE = "require-trusted-types-for 'script'";

export interface CspProbeEntry {
  directive: string;
  blocked: string;
  disposition: string;
}

/** Record every CSP violation event of every document this page loads (`window.__cspProbe`). */
export async function installCspProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: unknown[] = [];
    (window as unknown as { __cspProbe: unknown[] }).__cspProbe = probe;
    document.addEventListener("securitypolicyviolation", (e) => {
      probe.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition });
    });
  });
}

export async function readCspProbe(page: Page): Promise<CspProbeEntry[]> {
  return page.evaluate(() => (window as unknown as { __cspProbe: CspProbeEntry[] }).__cspProbe ?? []);
}

/** Violations whose effective directive is a `script-src*` one. */
export const scriptSrcOnly = (entries: CspProbeEntry[]): CspProbeEntry[] => entries.filter((e) => e.directive.startsWith("script-src"));

export interface CspHeaders {
  enforcing: string[];
  reportOnly: string[];
  reportingEndpoints?: string;
}

export async function cspHeaders(res: APIResponse | Response): Promise<CspHeaders> {
  const out: CspHeaders = { enforcing: [], reportOnly: [] };
  for (const { name, value } of await res.headersArray()) {
    const n = name.toLowerCase();
    if (n === "content-security-policy") out.enforcing.push(value);
    else if (n === "content-security-policy-report-only") out.reportOnly.push(value);
    else if (n === "reporting-endpoints") out.reportingEndpoints = value;
  }
  return out;
}

/** Every `'nonce-…'` source in the given header values. */
export function nonceSources(values: string[]): string[] {
  return values.flatMap((v) => [...v.matchAll(/'nonce-([^']+)'/g)].map((m) => m[1]!));
}

/** The single script nonce a response advertises in its enforcing headers (undefined: none). */
export async function enforcingNonce(res: APIResponse | Response): Promise<string | undefined> {
  return nonceSources((await cspHeaders(res)).enforcing)[0];
}

/** The nonce on the `<script type="importmap">` tag of an HTML body. */
export function importMapNonceOfHtml(html: string): string | undefined {
  return /<script\b[^>]*type="importmap"[^>]*\bnonce="([^"]*)"/.exec(html)?.[1];
}

/** Live DOM: the import map's `.nonce` property (the attribute itself is hidden by the browser after parsing). */
export async function importMapNonceInDom(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector("script[type=importmap]") as HTMLScriptElement | null)?.nonce ?? "");
}

/** The `report-uri` label (`baseline` | `strict` | `trusted-types`) of the header value that carries `needle`. */
export function reportLabelOf(values: string[], needle: string): string | undefined {
  const holder = values.find((v) => v.includes(needle));
  return holder ? new RegExp(`report-uri ${CSP_REPORT_PREFIX}([a-z-]+)`).exec(holder)?.[1] : undefined;
}

export interface CspReportsBlock {
  since: string;
  dropped: number;
  counts: Record<string, Record<string, number>>;
}

/** `cspReports` from `/api/health`, fetched over container loopback; undefined when the block is absent. */
export function readCspReports(): CspReportsBlock | undefined {
  const raw = containerSh(`curl -s http://127.0.0.1:${DASHBOARD_PORT}/api/health`);
  return (JSON.parse(raw) as { cspReports?: CspReportsBlock }).cspReports;
}

/** `counts[policy][directive]` (0 when absent). */
export const countOf = (block: CspReportsBlock | undefined, policy: string, directive: string): number => block?.counts?.[policy]?.[directive] ?? 0;

/** Plugin ids from each `packages/*-plugin` manifest. */
export function pluginIds(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, "packages"))
    .filter((d) => d.endsWith("-plugin"))
    .map((d) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages", d, "package.json"), "utf8"));
        return pkg["pi-dashboard-plugin"]?.id as string | undefined;
      } catch {
        return undefined;
      }
    })
    .filter((id): id is string => !!id)
    .sort();
}
