import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppConfig } from "../config.js";
import { resetIdentityState, setCredential } from "../identity-state.js";
import {
  AppHostProvider,
  createStandaloneHost,
  defineDashboardApp,
  StandaloneBar,
  useAppHost,
} from "../react/app-host.js";

// AppHost contract + standalone host (change: add-team-plugin, minimal AppHost).
beforeEach(() => {
  resetAppConfig();
  resetIdentityState();
  localStorage.clear();
});
afterEach(() => cleanup());

const cfg = { dashboardUrl: "http://localhost" } as never;

describe("createStandaloneHost", () => {
  it("is standalone with no dashboard capability; navigation methods are no-ops", async () => {
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: cfg });
    expect(host).toMatchObject({ version: 1, mode: "standalone", basePath: "/apps/team" });
    expect(host.capabilities.dashboard).toBe(false);
    expect(() => {
      host.openSession("s");
      host.openFolder("/x");
      host.navigateDashboard("/x");
      host.openStandalone();
    }).not.toThrow();
  });

  it("language and theme persist under the <appId>: key prefix and notify subscribers", async () => {
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: cfg, defaultLanguage: "hu" });
    expect(host.i18n.language()).toBe("hu");
    const cb = vi.fn();
    const off = host.i18n.subscribe(cb);
    host.i18n.set?.("en");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("team:lang")).toBe("en");
    off();
    host.theme.set?.("light");
    expect(localStorage.getItem("team:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("identity follows the app-kit credential state", async () => {
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: cfg });
    const cb = vi.fn();
    host.identity.subscribe(cb);
    expect(host.identity.current()).toBeNull();
    setCredential("tok", { iss: "i", sub: "s" });
    expect(host.identity.current()).toMatchObject({ iss: "i", sub: "s" });
    expect(cb).toHaveBeenCalled();
  });

  it("setTitle writes document.title", async () => {
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: cfg });
    host.setTitle("AI Team");
    expect(document.title).toBe("AI Team");
  });
});

describe("AppHostProvider / StandaloneBar", () => {
  it("useAppHost throws without a provider", () => {
    const Probe = () => {
      useAppHost();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AppHostProvider/);
    spy.mockRestore();
  });

  it("StandaloneBar renders the app's HeaderContext and a working language switch", async () => {
    const host = await createStandaloneHost({ appId: "team", basePath: "/apps/team", config: cfg, defaultLanguage: "hu" });
    const app = defineDashboardApp({ id: "team", title: "AI Team", App: () => null, HeaderContext: () => <span>SELECTOR</span> });
    render(
      <AppHostProvider host={host}>
        <StandaloneBar app={app} />
      </AppHostProvider>,
    );
    expect(screen.getByText("SELECTOR")).toBeTruthy();
    expect(screen.getByRole("button", { name: "HU" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => screen.getByRole("button", { name: "EN" }).click());
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.title).toBe("AI Team");
  });
});
