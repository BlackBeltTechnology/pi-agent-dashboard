// @vitest-environment jsdom
/**
 * The client barrel: eager catalog (zh-CN / hu parity, every key the UI uses), lazy `GoogleSettings` behind its own
 * Suspense. Plus the English consent / publishing copy the sign-in help relies on (ported from the gmail plugin).
 * See change: add-google-connect.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIENCE_HELP_EN, CONSENT_HINT_EN, ERROR_EN, errorKey } from "../wizard.js";
import { catalog, GoogleSettings } from "../index.js";
import { json, mockApi, STATE_URL, state } from "./harness.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("client entry", () => {
  it("exports the catalog eagerly and renders the lazy settings section", async () => {
    mockApi({ [`GET ${STATE_URL}`]: () => json(state()) });
    render(<GoogleSettings />);
    expect(await screen.findByTestId("google-settings")).toBeTruthy();
  });

  it("zh-CN and hu carry the identical key set", () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });

  it("every literal t() key of the Google accounts components exists in zh-CN and hu", () => {
    const dir = join(__dirname, "..");
    const keys = new Set<string>();
    for (const f of ["GoogleSettings.tsx", "AccountCard.tsx", "ConnectDialog.tsx", "OrgSignIn.tsx", "SetupWizard.tsx", "AutoSetup.tsx"]) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1] as string);
    }
    expect(keys.size).toBeGreaterThan(100);
    for (const k of keys) {
      expect(catalog["zh-CN"], k).toHaveProperty(k);
      expect(catalog.hu, k).toHaveProperty(k);
    }
  });
});

describe("consent and publishing copy (ported)", () => {
  it("the English copy names both consent shapes, the cleanup URL and the publishing facts", () => {
    for (const phrase of ["second screen", "wants additional access", "myaccount.google.com/connections"]) {
      expect(ERROR_EN.errScopeMissing, phrase).toContain(phrase);
    }
    expect(CONSENT_HINT_EN).toContain("checkbox");
    expect(CONSENT_HINT_EN).toContain("wants additional access");
    expect(AUDIENCE_HELP_EN).toMatch(/7 days/);
    expect(AUDIENCE_HELP_EN).toContain("100 users");
    expect(AUDIENCE_HELP_EN).toContain("re-auth");
  });

  it("their zh-CN and hu scope-missing copy names the cleanup URL; every error key has both translations", () => {
    expect(catalog["zh-CN"].errScopeMissing).toContain("myaccount.google.com/connections");
    expect(catalog.hu.errScopeMissing).toContain("myaccount.google.com/connections");
    for (const code of ["org_internal", "client_mismatch", "too_many_keys", "scope_missing", "unknown"]) {
      expect(catalog["zh-CN"], code).toHaveProperty(errorKey(code));
      expect(catalog.hu, code).toHaveProperty(errorKey(code));
    }
  });
});
