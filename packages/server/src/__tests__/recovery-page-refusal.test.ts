/**
 * The recovery page renders a refused action (403) as a `role="alert"` callout
 * with the remedy, and leaves both buttons enabled (mockup C2).
 * See change: harden-server-capability-bounds (test-plan #F7).
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildRecoveryHtml } from "../lifecycle/recovery-server.js";

// jsdom ships no types in this workspace; load it untyped.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, opts: object) => { window: { document: any } } };

const REMEDY = "Recovery actions only work on the machine running the dashboard. Open http://localhost:8000 there.";

function loadPage(fetchImpl: (url: string, init?: unknown) => Promise<unknown>) {
  const html = buildRecoveryHtml({ port: 8000, error: new Error("Cannot find module 'fastify'"), missingModule: "fastify" });
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost:8000/",
    beforeParse(window: { fetch?: unknown }) {
      window.fetch = fetchImpl;
    },
  });
}
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("recovery page refusal rendering", () => {
  it("F7 a 403 on Retry shows the remedy in a role=alert callout and keeps both buttons enabled", async () => {
    const dom = loadPage(async () => ({ ok: false, status: 403, text: async () => REMEDY }));
    const doc = dom.window.document;
    (doc.getElementById("retry")).click();
    await flush();
    const alert = doc.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(REMEDY);
    expect((doc.getElementById("retry")).disabled).toBe(false);
    expect((doc.getElementById("reinstall")).disabled).toBe(false);
  });

  it("a 403 on Reinstall renders the same callout", async () => {
    const dom = loadPage(async () => ({ ok: false, status: 403, text: async () => REMEDY }));
    const doc = dom.window.document;
    (doc.getElementById("reinstall")).click();
    await flush();
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain(REMEDY);
  });

  it("no callout is visible before any action, and a retry attempt clears an old one", async () => {
    let n = 0;
    const dom = loadPage(async () => (n++ === 0
      ? { ok: false, status: 403, text: async () => REMEDY }
      : { ok: true, status: 200, text: async () => "Restarting" }));
    const doc = dom.window.document;
    const visibleAlert = () => {
      const a = doc.querySelector('[role="alert"]') as { hidden: boolean; textContent: string | null } | null;
      return !!a && !a.hidden && (a.textContent ?? "").trim() !== "";
    };
    expect(visibleAlert()).toBe(false);
    (doc.getElementById("retry")).click();
    await flush();
    expect(visibleAlert()).toBe(true);
    (doc.getElementById("retry")).click();
    await flush();
    expect(visibleAlert()).toBe(false);
  });

  it("a non-403 failure keeps the plain status line, not the alert", async () => {
    const dom = loadPage(async () => ({ ok: false, status: 500, text: async () => "Reinstall failed (exit 1)" }));
    const doc = dom.window.document;
    (doc.getElementById("reinstall")).click();
    await flush();
    expect(doc.getElementById("status")?.textContent).toContain("Reinstall failed");
  });
});
