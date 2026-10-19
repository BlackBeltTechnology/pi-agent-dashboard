// @vitest-environment jsdom
/**
 * ObsSettingsCard (settings consistency wave 2): human state word + `<code>`
 * commands with a copy action (test-plan #E25), human load failure with
 * "Try again" and no raw `Request failed: 503` (test-plan #X8).
 * See change: retro-ux-plugin-settings-wave-2.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObsSettingsCard } from "../ObsSettingsCard.js";

vi.mock("wouter", () => ({ useLocation: () => ["/settings", () => {}] }));

const base = "/api/plugins/obs-studio";
let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = global.fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

function stubFetch(instances: unknown[]) {
  global.fetch = vi.fn(async (path: string) => {
    expect(path).toBe(`${base}/instances`);
    return new Response(JSON.stringify({ instances }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("ObsSettingsCard", () => {
  it("#E25 stop-failed instance → human state word in a pill, raw state only in data-status", async () => {
    stubFetch([{ id: "studio-mac", mode: "managed", state: "stop-failed" }]);
    render(<ObsSettingsCard />);
    const item = await screen.findByTestId("obs-instance-studio-mac");
    const pill = item.querySelector("[data-status='stop-failed']") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe("Could not stop");
    expect(item.textContent).not.toContain("stop-failed");
    expect(screen.getByRole("button", { name: "Open OBS panel" })).toBeTruthy();
  });

  it("#E25 not provisioned → `pi-obs provision` in <code> with a Copy command action, no backtick", async () => {
    stubFetch([]);
    render(<ObsSettingsCard />);
    const none = await screen.findByTestId("obs-settings-none");
    const code = within(none).getByText("pi-obs provision");
    expect(code.tagName).toBe("CODE");
    expect(within(none).getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByTestId("obs-settings").textContent).not.toContain("`");
  });

  it("#E25 warnings and auth failure render commands as <code> with Copy command, no backtick", async () => {
    stubFetch([
      { id: "living-room", mode: "managed", state: "healthy", exposure: "all-interfaces", recoverySuspended: true, liveError: "auth-failed" },
    ]);
    render(<ObsSettingsCard />);
    const item = await screen.findByTestId("obs-instance-living-room");
    expect(within(item).getByText("pi-obs launch --reset-recovery").tagName).toBe("CODE");
    expect(within(item).getByText("pi-obs provision --update").tagName).toBe("CODE");
    expect(within(item).getAllByRole("button", { name: "Copy command" })).toHaveLength(2);
    expect(item.querySelectorAll("[data-tone='warning']").length).toBeGreaterThanOrEqual(2);
    expect(item.textContent).not.toContain("`");
  });

  it("shows Loading… while the instances load", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    render(<ObsSettingsCard />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("#X8 status 503 → human error + Try again; no `Request failed: 503` visible", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ instances: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    render(<ObsSettingsCard />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not read the OBS status");
    expect(alert.textContent).not.toContain("Request failed");
    expect(alert.textContent).not.toContain("503");
    expect(screen.queryByText(/Request failed: 503/)).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("obs-settings-none")).toBeTruthy());
    expect(calls).toBe(2);
  });
});
