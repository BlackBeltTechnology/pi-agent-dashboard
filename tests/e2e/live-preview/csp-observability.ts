import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { IsolatedServer } from "./isolated-server.js";
import type { Operator } from "./operator.js";
import type { Upstream } from "./upstream.js";

/**
 * Shared scenario of test-plan #F30 (observability: no secret in browser-visible places): a restricted (agent-declared) preview
 * provokes a CSP violation; the label / pid / capability secret may live only where the browser needs them (the URL / the report
 * the browser itself posts to the preview origin) — never in the dashboard's counters, the stored violation rows or the server log.
 * See change: serve-live-previews-on-capability-origin (tasks 12.x; test-plan #F30).
 */
const BLOCKED_ORIGIN = "http://203.0.113.9";

/** Upstream document that provokes an `img-src` violation with NO script (an agent-declared preview starts restricted, scripts off). */
export const violationHtml = `<!doctype html><h1 id="static">csp upstream</h1><img alt="" src="${BLOCKED_ORIGIN}/p.png">`;

export interface CspProbe {
  reports: { url: string; status?: number }[];
  mints: { id: string; tokenId: string }[];
}

/** Record what the page posts to a `/__pi/csp-report` sink and the capability mints (ids + token ids). */
export function probeCsp(page: Page): CspProbe {
  const probe: CspProbe = { reports: [], mints: [] };
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() === "POST" && u.includes("/__pi/csp-report")) probe.reports.push({ url: u, status: r.status() });
    const m = /\/api\/live-server\/([^/]+)\/capability$/.exec(new URL(u).pathname);
    if (m && r.request().method() === "POST" && r.ok()) {
      const body = (await r.json().catch(() => null)) as { tokenId?: string } | null;
      if (body?.tokenId) probe.mints.push({ id: m[1], tokenId: body.tokenId });
    }
  });
  return probe;
}

/** Secrets of a preview: its label (tiers 1-4) or pid (tier 5) and the capability token id. */
function secretsOf(src: string, dashOrigin: string, probe: CspProbe): string[] {
  const u = new URL(src, dashOrigin);
  const label = /^([a-z2-7]{26})\./.exec(u.hostname)?.[1];
  const pid = /^\/preview\/([A-Za-z0-9_-]{22})\//.exec(u.pathname)?.[1];
  return [label, pid, ...probe.mints.map((m) => m.tokenId)].filter((s): s is string => !!s);
}

/**
 * An agent-declared preview starts RESTRICTED (its CSP carries the `report-uri` sink); the picker UI always opens with open egress, so
 * the capability is minted the way the viewer does (`POST /api/live-server/<id>/capability`, restricted, scripts off) from the operator's
 * dashboard page and the preview document is loaded top-level. Returns the capability's URL (tier 1: absolute label origin; tier 5:
 * `/preview/<pid>/`).
 */
export async function loadRestrictedPreview(page: Page, operator: Operator, server: IsolatedServer, dashOrigin: string, upstream: Upstream, probe: CspProbe, opts: { tier5?: boolean } = {}): Promise<string> {
  const port = upstream.port;
  const reg = await server.api("POST", "/api/live-server/start", { host: "127.0.0.1", port, addedBy: "preset" });
  const id = reg.json?.data?.id as string;
  expect(id, JSON.stringify(reg.json)).toBeTruthy();
  await operator.gotoDashboard(page, dashOrigin);
  if (opts.tier5) {
    // Tier 5 forwards the FULL `/preview/<pid>/…` path: the upstream must already serve under the reserved base (D8/D9).
    let base: string | null = null;
    for (let i = 0; i < 40 && !base; i++) {
      base = ((await server.api("POST", "/api/live-server/preview-path", { port })).json?.path as string | null) ?? null;
      if (!base) await new Promise((r) => setTimeout(r, 500));
    }
    expect(base, "a tier-5 viewer socket is registered").toBeTruthy();
    upstream.route(base as string, violationHtml);
  }
  const minted = await page.evaluate(
    async (targetId) => {
      const res = await fetch(`/api/live-server/${targetId}/capability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: ["origin", "preview"], egress: "restricted", scripts: false, viewerId: `lp-${Math.random().toString(36).slice(2)}-${Date.now()}` }),
      });
      return (await res.json()) as { ok?: boolean; origin?: string; path: string; tokenId: string; policy: { egress: string } };
    },
    id,
  );
  expect(minted.policy?.egress, JSON.stringify(minted)).toBe("restricted");
  probe.mints.push({ id, tokenId: minted.tokenId });
  const url = minted.origin ? `${minted.origin}${minted.path}` : `${dashOrigin}${minted.path}`;
  await page.goto(url);
  return minted.origin ? url : minted.path;
}

/** Drive the violation and assert nothing secret reached a place the browser did not itself need. */
export async function assertNoSecretLeak(opts: {
  page: Page;
  /** The loaded capability URL (`loadRestrictedPreview`). */
  src: string;
  server: IsolatedServer;
  probe: CspProbe;
  dashOrigin: string;
  logMark: number;
  tier5?: boolean;
}): Promise<void> {
  const { page, src, server, probe, dashOrigin, logMark } = opts;
  await expect(page.locator("#static")).toHaveText("csp upstream");
  // 1. The browser delivered the violation report to the PREVIEW origin's sink, and the server accepted it.
  await expect.poll(() => probe.reports.length, { message: "a CSP report reached the preview's /__pi/csp-report", timeout: 20_000 }).toBeGreaterThan(0);
  const sink = new URL(probe.reports[0].url);
  expect(sink.origin, "the report goes to the preview's own origin, never the dashboard's").toBe(new URL(src, dashOrigin).origin);
  expect(sink.pathname).toMatch(/\/__pi\/csp-report(\/|$)/);
  for (const r of probe.reports) expect(r.status, `report sink answered ${r.url}`).toBeLessThan(300);

  const secrets = secretsOf(src, dashOrigin, probe);
  expect(secrets.length, "label/pid and token id known").toBeGreaterThanOrEqual(2);

  // 2. The dashboard's own violation counters carry none of them.
  const counters = JSON.stringify((await server.api("GET", "/api/csp-violations")).json);
  for (const s of secrets) expect(counters, "GET /api/csp-violations").not.toContain(s);

  // 3. The stored (runtime) violation rows keep the blocked ORIGIN only: no label/pid/token in them.
  // (Tier 5: `GET /api/live-server/:id/egress?token=` resolves tokens through `LiveCapabilityStore.findByTokenId` only, which does not
  // know `/preview/<pid>/` grants, so the stored rows of a tier-5 preview are not addressable over REST — noted, not asserted.)
  const mint = probe.mints.at(-1);
  if (mint && !opts.tier5) {
    // As the operator that minted it (the browser's credential, same-origin fetch from a dashboard document): the view is per principal.
    const dashPage = await page.context().newPage();
    let status = 0;
    let rows = "";
    try {
      await dashPage.goto(`${dashOrigin}/api/health`);
      ({ status, rows } = await dashPage.evaluate(async (u) => {
        const r = await fetch(u);
        return { status: r.status, rows: await r.text() };
      }, `/api/live-server/${mint.id}/egress?token=${encodeURIComponent(mint.tokenId)}`));
    } finally {
      await dashPage.close();
    }
    expect(status, rows.slice(0, 300)).toBe(200);
    expect(rows, "the blocked origin is recorded").toContain(BLOCKED_ORIGIN);
    for (const s of secrets) expect(rows, "stored egress rows").not.toContain(s);
  }

  // 4. The server log shows only redacted forms.
  const log = server.logSince(logMark).join("\n");
  for (const s of secrets) expect(log, "server log").not.toContain(s);
}
