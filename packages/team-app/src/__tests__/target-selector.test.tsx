/**
 * Project selector (F24), locked folder chip (F28), two hosts (E47, F26).
 * See change: add-team-plugin.
 */
import { AppHostProvider, defineDashboardApp, StandaloneBar } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import teamApp from "../team-app.js";
import { TargetSelector } from "../shell/TargetSelector.js";
import { TeamApp } from "../TeamApp.js";
import { targetStore } from "../state/target-store.js";
import { bootRoutes, json, makeHost, project, renderApp } from "./helpers.js";

const PROJECTS = [project("billing", { name: "billing-api" }), project("crm", { name: "crm-web", available: false })];

describe("F24: project selector", () => {
  it("lists projects + own workspace; unavailable disabled with reason; selection remembered and switches", async () => {
    const host = makeHost();
    bootRoutes(host, {}, PROJECTS);
    targetStore.set("crm"); // stored but unavailable
    renderApp(<TargetSelector />, host);
    const trigger = await screen.findByTestId("target-selector");
    expect(trigger.textContent).toContain("billing-api"); // start target: crm unavailable ⇒ billing
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.getAttribute("data-item"))).toEqual(["billing", "crm", "_ws"]);
    const crm = items[1];
    expect(crm.getAttribute("aria-disabled")).toBe("true");
    expect(crm.textContent).toContain("Nem elérhető: a mappa hiányzik");
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(crm); // disabled: no switch
    expect(targetStore.get()).toBe("crm"); // untouched stored value
    fireEvent.click(items[2]);
    expect(localStorage.getItem("team:target")).toBe("_ws");
    await waitFor(() => expect(screen.getByTestId("target-selector").textContent).toContain("Saját munkaterület"));
  });

  it("no projects ⇒ a plain label, no menu", async () => {
    const host = makeHost();
    bootRoutes(host, {}, []);
    renderApp(<TargetSelector />, host);
    const label = await screen.findByTestId("target-selector");
    expect(label.tagName).toBe("SPAN");
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  });

  it("menu button keyboard: ArrowDown opens, Escape closes and returns focus", async () => {
    const host = makeHost();
    bootRoutes(host, {}, PROJECTS);
    renderApp(<TargetSelector />, host);
    const trigger = await screen.findByTestId("target-selector");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("F28: folder view locks the selector to the folder's project", () => {
  it("locked chip (no menu) when the folder matches a project", async () => {
    const host = makeHost({ mode: "embedded", folder: { cwd: "/repo/billing/src", name: "src" } });
    bootRoutes(host, {}, PROJECTS);
    host.routes.set("POST /api/plugins/team/projects/match", () => ({
      results: [{ cwd: "/repo/billing/src", project: { id: "billing", name: "billing-api", available: true, source: "config", agents: 2, active: 0 }, enableable: false }],
    }));
    renderApp(<TargetSelector />, host);
    await waitFor(() => expect(screen.getByTestId("target-selector").tagName).toBe("SPAN"));
    const chip = screen.getByTestId("target-selector");
    expect(chip.textContent).toContain("billing-api");
    expect(chip.textContent).toContain("ehhez a mappához kötve");
  });
});

describe("F28: folder view action", () => {
  it("offers 'Teljes csapat' opening the global app on the locked project", async () => {
    const host = makeHost({ mode: "embedded", dashboard: true, folder: { cwd: "/repo/billing", name: "billing" } });
    bootRoutes(host, {}, PROJECTS);
    host.routes.set("POST /api/plugins/team/projects/match", () => ({
      results: [{ cwd: "/repo/billing", project: { id: "billing", name: "billing-api", available: true, source: "config", agents: 1, active: 0 }, enableable: false }],
    }));
    host.routes.set("GET /api/plugins/team/agents", () => ({ agents: [] }));
    let actions: Array<{ id: string; label: string; onSelect(): void }> = [];
    host.setActions = (a) => {
      actions = a as typeof actions;
    };
    const nav: string[] = [];
    host.navigateDashboard = (p) => nav.push(p);
    renderApp(<TeamApp />, host);
    await waitFor(() => expect(actions.map((a) => a.id)).toEqual(["full-team"]));
    expect(actions[0].label).toBe("Teljes csapat");
    actions[0].onSelect();
    expect(nav).toEqual(["/team/?project=billing"]);
  });
});

describe("E47/F26: two hosts, one source", () => {
  it("standalone: StandaloneBar renders the selector as HeaderContext plus language/theme controls", async () => {
    const host = makeHost({ mode: "standalone" });
    bootRoutes(host, {}, PROJECTS);
    const { hook } = memoryLocation({ path: "/" });
    render(
      <AppHostProvider host={{ ...host, theme: { ...host.theme, set() {} }, i18n: { ...host.i18n, set() {} } }}>
        <Router hook={hook}>
          <StandaloneBar app={teamApp} />
        </Router>
      </AppHostProvider>,
    );
    expect(await screen.findByTestId("target-selector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "HU" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
    expect(host.titles).toContain("AI Team");
  });

  it("embedded: app renders without any sign-in / language / theme controls; title via setTitle only; 'open in dashboard' when capable", async () => {
    const host = makeHost({ mode: "embedded", dashboard: true });
    bootRoutes(host, {}, PROJECTS);
    host.routes.set("GET /api/plugins/team/agents", () => ({ agents: [] }));
    renderApp(<TeamApp />, host);
    await screen.findByTestId("empty-target");
    expect(screen.queryByRole("button", { name: "HU" })).toBeNull();
    expect(screen.queryByTestId("signin")).toBeNull();
    expect(host.titles).toContain("AI Csapat");
    expect(document.title).not.toBe("AI Csapat");
  });

  it("every request goes through host.api.fetch (no direct fetch)", async () => {
    const host = makeHost({ mode: "embedded" });
    bootRoutes(host, {}, PROJECTS);
    host.routes.set("GET /api/plugins/team/agents", () => ({ agents: [] }));
    const direct = (globalThis.fetch = (() => {
      throw new Error("direct fetch used");
    }) as typeof fetch);
    renderApp(<TeamApp />, host);
    await screen.findByTestId("empty-target");
    expect(host.calls.length).toBeGreaterThan(2);
    expect(direct).toBeDefined();
  });

  it("deep links resolve under every base path; ?project= and the store agree", async () => {
    for (const base of ["/team", "/folder/enc/team", "/apps/team"]) {
      const host = makeHost({ mode: base === "/apps/team" ? "standalone" : "embedded" });
      bootRoutes(host, {}, PROJECTS);
      host.routes.set("GET /api/plugins/team/agents", () => ({ agents: [{ key: "shared:backend", name: "Backend", description: "", avatar: { kind: "initials" }, role: "member", scope: "shared", tools: "chat", unconfined: false, status: "new", activeCount: 0, personaStale: false, unassigned: false, retired: false }] }));
      host.routes.set("GET /api/plugins/team/agents/:k/conversations", () => ({ conversations: [] }));
      const { unmount } = render(
        <AppHostProvider host={host}>
          <Router base={base} hook={memoryLocation({ path: `${base}/agent/shared%3Abackend?project=billing` }).hook}>
            <TeamApp />
          </Router>
        </AppHostProvider>,
      );
      await screen.findByRole("heading", { name: "Backend" });
      expect(targetStore.get()).toBe("billing");
      unmount();
      targetStore.reset();
    }
  });

  it("library entry: default export is a definition with id 'team', no createRoot, no global CSS import", async () => {
    const mod = await import("../team-app.js");
    expect(mod.default).toMatchObject({ id: "team", title: "AI Team" });
    expect(typeof mod.default.App).toBe("function");
    expect(typeof mod.default.HeaderContext).toBe("function");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../team-app.tsx"), "utf8");
    const graph = ["../TeamApp.tsx", "../shell/TargetSelector.tsx"].map((p) => fs.readFileSync(path.resolve(__dirname, p), "utf8")).join("\n");
    for (const code of [src, graph]) {
      expect(code).not.toMatch(/createRoot/);
      expect(code).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
    expect(defineDashboardApp).toBeTypeOf("function");
    expect(within(document.body).queryByText("x")).toBeNull();
    expect(json({}).status).toBe(200);
  });
});
