// @vitest-environment jsdom
/**
 * Panel states (design D6) rendered with a stub fetcher: no instance → provision
 * hint and no controls; blocked → host-input message, no actions; stopped →
 * Start posts to /api/services/obs/start; healthy → scenes + preview; never a
 * Stop control. See change: add-obs-studio-plugin.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ObsPanel } from "../ObsPanel.js";

afterEach(cleanup);
const t = (_k: string, vars?: Record<string, string | number>, fallback?: string) => (fallback ?? "").replace(/\{(\w+)\}/g, (m, n: string) => String(vars?.[n] ?? m));

function fetcher(routes: Record<string, unknown>, calls: string[] = []) {
  return async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const body = routes[path] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}
const base = "/api/plugins/obs-studio";

describe("ObsPanel", () => {
  it("no OBS provisioned → hint, no buttons", async () => {
    render(<ObsPanel fetcher={fetcher({ [`${base}/instances`]: { instances: [] } })} t={t} />);
    expect(await screen.findByTestId("obs-none")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("blocked → host-input message and no actions", async () => {
    const st = { id: "obs", mode: "attached", state: "blocked" };
    render(<ObsPanel fetcher={fetcher({ [`${base}/instances`]: { instances: [st] }, [`${base}/obs/status`]: st })} t={t} />);
    expect(await screen.findByTestId("obs-blocked")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("stopped → Start posts to the managed-services start route; no Stop anywhere", async () => {
    const st = { id: "obs", mode: "attached", state: "stopped" };
    const calls: string[] = [];
    render(<ObsPanel fetcher={fetcher({ [`${base}/instances`]: { instances: [st] }, [`${base}/obs/status`]: st }, calls)} t={t} />);
    const start = await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(calls).toContain("POST /api/services/obs/start"));
  });

  it("healthy → scenes and the preview image", async () => {
    const st = { id: "obs", mode: "attached", state: "healthy", live: { scenes: ["Webcam", "Desktop"], current: "Webcam", virtualCam: false, recording: false } };
    render(
      <ObsPanel
        fetcher={fetcher({ [`${base}/instances`]: { instances: [st] }, [`${base}/obs/status`]: st, [`${base}/obs/screenshot`]: { ok: true, result: { imageData: "data:image/jpeg;base64,AA==" } } })}
        t={t}
      />,
    );
    expect(await screen.findByRole("button", { name: "Switch to Desktop" })).toBeTruthy();
    await waitFor(() => expect((screen.getByTestId("obs-preview") as HTMLImageElement).src).toMatch(/^data:image\/jpeg/));
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
  });
});
