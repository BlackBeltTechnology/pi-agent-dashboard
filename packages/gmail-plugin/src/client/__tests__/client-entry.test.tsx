// @vitest-environment jsdom
/**
 * The client barrel's `GmailSettings` lazy-loads the settings UI behind its own Suspense and still renders it;
 * the eager catalog keeps zh-CN / hu parity and carries the pointer-notice keys.
 * See change: add-gmail-plugin, add-google-connect.
 */
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ moved: true }), { status: 200 })));
    render(<GmailSettings />);
    expect(await screen.findByTestId("gmail-settings")).toBeTruthy();
  });

  it("zh-CN and hu carry the pointer-notice keys", () => {
    for (const k of ["movedNotice", "movedLink", "googleOff", "title"]) {
      expect(catalog["zh-CN"], k).toHaveProperty(k);
      expect(catalog.hu, k).toHaveProperty(k);
    }
  });
});
