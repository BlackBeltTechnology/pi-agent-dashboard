/**
 * Language switch without reload + accessible names (F18). See change: add-team-plugin.
 */
import { AppHostProvider, createStandaloneHost, StandaloneBar } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TeamApp } from "../TeamApp.js";
import teamApp from "../team-app.js";
import { agent, bootRoutes, makeHost, project } from "./helpers.js";

describe("F18: language, focus, accessible names", () => {
  it("HU→EN switches every string without a reload; every button has an accessible name; focus is visible-able", async () => {
    const base = makeHost();
    bootRoutes(base, { admin: true }, [project("billing")]);
    base.routes.set("GET /api/plugins/team/agents", () => ({ agents: [agent("shared:a", { name: "Alpha", status: "running", activeCount: 1 })] }));
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: { dashboardUrl: "http://localhost" } as never, defaultLanguage: "hu" });
    host.api.fetch = base.api.fetch;
    const { hook } = memoryLocation({ path: "/" });
    render(
      <AppHostProvider host={host}>
        <Router hook={hook}>
          <StandaloneBar app={teamApp} />
          <TeamApp />
        </Router>
      </AppHostProvider>,
    );
    await screen.findByRole("heading", { name: "Alpha" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Csapat");
    expect(screen.getByTestId("talk").textContent).toContain("Beszélgetés");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "EN" })));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
    expect(screen.getByTestId("talk").textContent).toContain("Conversation");
    expect(document.title).toBe("AI Team");

    // no icon-only button without an accessible name
    for (const b of screen.getAllByRole("button")) {
      const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      expect(name.length, b.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    }
    // decorative icons are hidden from AT
    for (const svg of document.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
    // the primary action is reachable by keyboard (focusable, not tabindex=-1)
    const talk = screen.getByTestId("talk");
    talk.focus();
    expect(document.activeElement).toBe(talk);
    expect(talk.getAttribute("tabindex")).not.toBe("-1");
  });
});
