/**
 * The Services pages inside the real SettingsPanel: route resolution, nav group
 * and attention indicator, Save Bar exemption. Real wouter + jsdom history.
 * See change: add-services-settings-ui — test-plan E32, E34 (nav), E35.
 */
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../../SettingsPanel.js";
import { callsTo, makeList, makeService, ok, stubServicesFetch } from "./services-fixtures.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/git/git-api.js")>("../../../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});
vi.mock("../../../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({ install: vi.fn(), remove: vi.fn(), update: vi.fn(), statusFor: () => "idle", messageFor: () => "" }),
}));

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

let calls: ReturnType<typeof stubServicesFetch>;

/** Services endpoints answer with real Responses; everything else keeps the panel's plain-object stubs. */
function mount(path: string, services = [makeService({ id: "docling", state: "healthy" })], listPatch = {}) {
  window.history.replaceState({}, "", path);
  const base = stubServicesFetch({
    list: () => makeList(services, listPatch),
    handler: (c) => {
      if (c.url === "/api/config" && c.method === "GET") return ok(mockConfig);
      if (c.url.endsWith("/api/plugins")) return new Response(JSON.stringify({ success: true, plugins: [] }), { headers: { "content-type": "application/json" } });
      return undefined;
    },
  });
  calls = base;
  const original = globalThis.fetch;
  // `/api/config` is read as `{success,data}` plain JSON by the panel (no content-type check).
  vi.stubGlobal("fetch", (url: string, init?: Parameters<typeof fetch>[1]) => {
    if (url === "/api/config" && !init?.method) return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    if (url.includes("/api/health")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, startedAt: "2025-01-01T00:00:00Z" }) });
    return (original as typeof fetch)(url, init);
  });
  render(<SettingsPanel />);
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E32 — settings registry and route parse", () => {
  it("/settings/services renders the list", async () => {
    mount("/settings/services");
    expect(await screen.findByTestId("services-list-page")).toBeTruthy();
    expect(screen.getByTestId("service-row-docling")).toBeTruthy();
  });

  it("/settings/services/<id> renders that service's detail (no redirect)", async () => {
    mount("/settings/services/docling");
    expect(await screen.findByTestId("service-detail")).toBeTruthy();
    expect(window.location.pathname).toBe("/settings/services/docling");
  });

  it("an unknown id renders the list with a not-found notice", async () => {
    mount("/settings/services/nope");
    expect((await screen.findByTestId("services-not-found")).textContent).toContain("nope");
    expect(screen.getByTestId("services-list-page")).toBeTruthy();
  });

  it("/settings/runtimes/x renders the runtimes page and ignores the segment", async () => {
    mount("/settings/runtimes/x");
    expect(await screen.findByTestId("runtimes-page")).toBeTruthy();
    expect(screen.queryByTestId("service-detail")).toBeNull();
    expect(window.location.pathname).toBe("/settings/runtimes/x");
  });

  it("folder settings never host the services pages (source pin)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../../shell/ShellContent.tsx"), "utf8");
    const list = src.slice(src.indexOf("VALID_FOLDER_SETTINGS_PAGES = ["), src.indexOf("] as const"));
    expect(list).not.toMatch(/services|runtimes/);
  });
});

describe("nav group and attention indicator", () => {
  it("the Services group sits between Network and Add-ons with All services, Runtimes", async () => {
    mount("/settings/services");
    const rail = await screen.findByTestId("settings-nav-rail");
    const groups = [...rail.querySelectorAll("[data-testid^='settings-nav-group-label-']")].map((e) => e.textContent);
    expect(groups.indexOf("Services")).toBe(groups.indexOf("Network") + 1);
    expect(groups.indexOf("Add-ons")).toBe(groups.indexOf("Services") + 1);
    const items = within(screen.getByTestId("settings-nav-group-services")).getAllByRole("button").map((b) => b.textContent);
    expect(items).toEqual(["All services", "Runtimes"]);
  });

  it("E34 the nav item carries an indicator with a text alternative while a service needs attention", async () => {
    mount("/settings/services", [makeService({ id: "a", state: "failed" }), makeService({ id: "b", state: "unavailable", reason: "image-absent" }), makeService({ id: "c", state: "healthy" })]);
    const mark = await screen.findByTestId("nav-services-attention");
    expect(mark.textContent).toMatch(/2 services need attention/);
    cleanup();
    mount("/settings/services", [makeService({ state: "healthy" })]);
    await screen.findByTestId("service-row-docling");
    expect(screen.queryByTestId("nav-services-attention")).toBeNull();
  });
});

describe("E35 — not a Save Bar source", () => {
  it("stopping a service and saving a secret leaves no Save Bar and no unsaved count", async () => {
    mount("/settings/services/docling", [makeService({ id: "docling", state: "healthy", secrets: { token: { configured: false } }, secretRefs: { token: "store:docling/token" } })]);
    fireEvent.click(await screen.findByTestId("service-action-stop"));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/services/docling/stop")).toHaveLength(1));
    fireEvent.change(screen.getByTestId("service-secret-input-token"), { target: { value: "a-secret-value" } });
    fireEvent.click(screen.getByTestId("service-secret-save-token"));
    await waitFor(() => expect(callsTo(calls, "PUT", "/api/services/docling/secrets/token")).toHaveLength(1));
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
    expect(screen.queryByTestId("unsaved-count")).toBeNull();
    expect(document.querySelector("[data-testid^='nav-dirty-']")).toBeNull();
  });
});
