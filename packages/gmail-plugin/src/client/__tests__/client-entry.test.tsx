// @vitest-environment jsdom
/**
 * The client barrel's `GmailSettings` lazy-loads the settings UI behind its own
 * Suspense (keeps it off the entry chunk) and still renders it.
 * See change: add-gmail-plugin.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog, GmailSettings } from "../index.js";

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
