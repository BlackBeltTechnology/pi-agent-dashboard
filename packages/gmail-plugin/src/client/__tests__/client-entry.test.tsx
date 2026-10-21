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
import { AUDIENCE_HELP_EN, CONSENT_HINT_EN, ERROR_EN, errorKey, KNOWN_FLOW_CODES } from "../wizard.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * @structural-pin GmailSettings.tsx pulls the full plugin client graph; the entry registration is checked in its text
 */
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

describe("test-plan #E30 (improve-gmail-plugin-setup-ux) — consent and publishing copy", () => {
  const NEW_KEYS = [
    "projectModeLegend", "projectModeNew", "projectModeExisting", "projectIdHint", "openProjectList", "ownerAccount", "ownerHint",
    "errOwnerInvalid", "errSetupSave", "errProjectLooksLikeName", "errProjectInvalid", "projectMismatch", "projectMismatchUse",
    "authLoginNote", "findProject", "needValidProjectId", "filtersFor", "filtersHelp",
  ];

  it("the English copy names both consent shapes, the cleanup URL and the publishing facts", () => {
    for (const phrase of ["second screen", "wants additional access", "myaccount.google.com/connections"]) {
      expect(ERROR_EN.errScopeMissing, phrase).toContain(phrase);
    }
    expect(CONSENT_HINT_EN).toContain("checkbox");
    expect(CONSENT_HINT_EN).toContain("wants additional access");
    for (const phrase of ["7-day", "100 users", "re-auth"]) expect(AUDIENCE_HELP_EN, phrase).toContain(phrase);
  });

  it("every new key exists in zh-CN and hu, and their scope-missing copy names the cleanup URL", () => {
    for (const k of NEW_KEYS) {
      expect(catalog["zh-CN"], k).toHaveProperty(k);
      expect(catalog.hu, k).toHaveProperty(k);
    }
    expect(catalog["zh-CN"].errScopeMissing).toContain("myaccount.google.com/connections");
    expect(catalog.hu.errScopeMissing).toContain("myaccount.google.com/connections");
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });
});
