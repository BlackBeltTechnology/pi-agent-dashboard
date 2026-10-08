// @vitest-environment jsdom
/**
 * The client barrel's `GmailSettings` lazy-loads the settings UI behind its own
 * Suspense (keeps it off the entry chunk) and still renders it.
 * See change: add-gmail-plugin.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog, GmailSettings } from "../index.js";
import { errorKey, KNOWN_FLOW_CODES } from "../wizard.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("client entry", () => {
  it("exports the catalog eagerly and renders the lazy settings section", async () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ client: { configured: false }, accounts: [] }), { status: 200 })),
    );
    render(withUiPrimitiveProvider({ "ui:oauth-flow": () => null }, <GmailSettings />));
    expect(await screen.findByTestId("gmail-settings")).toBeTruthy();
  });
});

describe("improve-gmail-settings-ux", () => {
  const src = readFileSync(join(__dirname, "..", "GmailSettings.tsx"), "utf8");

  it("test-plan #E8 — link text uses --accent-text, never the 3:1 --accent", () => {
    expect(src).not.toContain("text-[var(--accent)]");
    expect(src).toMatch(/function StepLink[\s\S]*?text-\[var\(--accent-text\)\]/);
  });

  it("test-plan #E4 — zh-CN and hu carry every new key", () => {
    const keys = new Set([
      ...[...KNOWN_FLOW_CODES, "Cancelled", "unknown"].map(errorKey),
      "summaryProject",
      "summaryClient",
      "summaryNotConfigured",
      "consentHint",
    ]);
    for (const k of keys) {
      expect(catalog["zh-CN"], k).toHaveProperty(k);
      expect(catalog.hu, k).toHaveProperty(k);
    }
  });
});
