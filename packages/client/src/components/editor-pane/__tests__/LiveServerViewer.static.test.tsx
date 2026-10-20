/**
 * LiveServerViewer — static targets, tab policy on every mint, address bar,
 * Scripts ⇄ Static, exposure, Open ↗, keepalive, picker, egress banner.
 * See change: improve-canvas-html-and-url-ux (test-plan #F6–#F13).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewProvenance } from "../../../lib/access-grants/preview-provenance.js";
import { setActiveCanvasPort } from "../../../lib/canvas/active-canvas-target.js";
import { notifyExposureChanged, resetExposureStore } from "../../../lib/live-preview/exposure-store.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { type FakeServers, installFakeLiveServer } from "./live-fake-api.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";

let fake: FakeServers;
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const iframe = () => screen.getByTestId("live-iframe") as HTMLIFrameElement;
const sandbox = () => iframe().getAttribute("sandbox");
const src = () => iframe().getAttribute("src") ?? "";
const agent = (ui: ReactNode) => <PreviewProvenance autoOpened>{ui}</PreviewProvenance>;
const operator = (ui: ReactNode) => <PreviewProvenance autoOpened={false}>{ui}</PreviewProvenance>;
const staticViewer = (extra: Record<string, unknown> = {}) => (
  <LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" {...extra} />
);
const lastMint = () => fake.mints().at(-1)?.body ?? {};
const submitAddress = (value: string) => {
  const input = screen.getByTestId("live-address") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetExposureStore();
  fake = installFakeLiveServer();
});
afterEach(() => {
  cleanup();
  fake.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F6 — policy on every mint, token reuse per (target, policy, epoch, viewer)", () => {
  it("launch, reload, toggle, epoch bump and the re-mint timer", async () => {
    render(agent(staticViewer()));
    await flush();
    // The static preset registered through start-static, then minted under the restricted policy.
    expect(fake.callsTo("/start-static", "POST")).toHaveLength(1);
    expect(fake.callsTo("/start-static")[0].body).toEqual({ cwd: "/p", path: "/p/m/a/index.html" });
    expect(fake.mints()).toHaveLength(1);
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: true });
    expect(typeof lastMint().viewerId).toBe("string");
    expect(src()).toBe("/live/stat1234/~c/tok1_padpadpadpadpadpadpad/index.html");

    // Reload at the same epoch reuses the token (no new mint).
    fireEvent.click(screen.getByTestId("live-reload"));
    await flush();
    expect(fake.mints()).toHaveLength(1);

    // Toggle → a new mint carrying the flipped scripts flag and the SAME egress.
    fireEvent.click(screen.getByTestId("live-mode-static"));
    await flush();
    expect(fake.mints()).toHaveLength(2);
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: false });
    fireEvent.click(screen.getByTestId("live-mode-scripts"));
    await flush();
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: true });
    expect(fake.mints()).toHaveLength(3);

    // Exposure epoch bump → new mint (and, exposed, without scripts).
    fake.policy = { exposure: "exposed", epoch: 2, promptingEnabled: false };
    act(() => notifyExposureChanged(2));
    await flush(10);
    expect(fake.mints()).toHaveLength(4);
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: false });

    // The re-mint timer (10 min before the 2 h expiry) mints again under the same policy.
    await flush(2 * 3600_000 - 10 * 60_000 + 1000);
    const n = fake.mints().length;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: false });
    for (const m of fake.mints()) {
      expect(m.body).toMatchObject({ egress: "restricted" });
      expect(typeof m.body?.scripts).toBe("boolean");
    }
  });

  it("a second viewer instance mints with its own viewerId", async () => {
    render(agent(staticViewer()));
    await flush();
    const first = lastMint().viewerId;
    cleanup();
    render(agent(staticViewer()));
    await flush();
    expect(lastMint().viewerId).not.toBe(first);
  });
});

describe("static targets: policy by provenance", () => {
  it("an operator open mints OPEN egress; an undeclared surface mints restricted", async () => {
    render(operator(staticViewer()));
    await flush();
    expect(lastMint()).toMatchObject({ egress: "open", scripts: true });
    cleanup();
    render(staticViewer());
    await flush();
    expect(lastMint()).toMatchObject({ egress: "restricted" });
  });

  it("a refused start-static shows the refusal and frames nothing", async () => {
    fake.staticRefusal = { status: 403, body: { error: "unknown session path" } };
    render(operator(staticViewer()));
    await flush();
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toContain("unknown session path");
    expect(fake.mints()).toHaveLength(0);
  });
});

describe("F7 — address bar", () => {
  it("static: a sibling path re-points the frame without registering anything", async () => {
    render(operator(staticViewer()));
    await flush();
    const starts = fake.calls.filter((c) => c.url.includes("/start")).length;
    submitAddress("screens/b.html");
    await flush();
    expect(src().endsWith("/screens/b.html")).toBe(true);
    expect(fake.calls.filter((c) => c.url.includes("/start")).length).toBe(starts);
    // empty → the root
    submitAddress("");
    await flush();
    expect(src()).toBe("/live/stat1234/~c/tok1_padpadpadpadpadpadpad/");
  });

  it("static: a dot-segment path is refused and the frame is unchanged", async () => {
    render(operator(staticViewer()));
    await flush();
    const before = src();
    submitAddress("../../api/sessions");
    await flush();
    expect(screen.getByTestId("live-address-error").getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("live-address").getAttribute("aria-invalid")).toBe("true");
    expect(src()).toBe(before);
  });

  it("static: a URL (even loopback) is refused", async () => {
    render(operator(staticViewer()));
    await flush();
    const before = src();
    submitAddress("http://localhost:5174/");
    await flush();
    expect(screen.getByTestId("live-address-error")).toBeTruthy();
    expect(src()).toBe(before);
  });

  it("port: another loopback port asks for confirmation, then starts it as a user target", async () => {
    render(operator(<LiveServerViewer path="live:http://localhost:5173/" cwd="/p" />));
    await flush();
    const startsBefore = fake.callsTo("/api/live-server/start", "POST").length;
    submitAddress("http://localhost:5174/");
    await flush();
    expect(screen.getByTestId("live-address-confirm")).toBeTruthy();
    expect(fake.callsTo("/api/live-server/start", "POST")).toHaveLength(startsBefore);
    fireEvent.click(screen.getByTestId("live-address-add"));
    await flush();
    const started = fake.callsTo("/api/live-server/start", "POST").at(-1);
    expect(started?.body).toMatchObject({ host: "localhost", port: 5174, addedBy: "user" });
  });

  it("port: a non-loopback address shows the loopback-only error and leaves the frame alone", async () => {
    render(operator(<LiveServerViewer path="live:http://localhost:5173/" cwd="/p" />));
    await flush();
    const before = src();
    submitAddress("http://10.0.0.5/");
    await flush();
    expect(screen.getByTestId("live-address-error").textContent).toMatch(/localhost/i);
    expect(src()).toBe(before);
    expect(screen.queryByTestId("live-address-confirm")).toBeNull();
  });
});

describe("F8 — Scripts ⇄ Static toggle", () => {
  it("operator open: 4 tokens → empty → 4 tokens again (egress preserved)", async () => {
    render(operator(staticViewer()));
    await flush();
    expect(sandbox()).toBe("allow-scripts allow-forms allow-popups allow-downloads");
    fireEvent.click(screen.getByTestId("live-mode-static"));
    await flush();
    expect(sandbox()).toBe("");
    expect(iframe().hasAttribute("sandbox")).toBe(true);
    expect(lastMint()).toMatchObject({ egress: "open", scripts: false });
    fireEvent.click(screen.getByTestId("live-mode-scripts"));
    await flush();
    expect(sandbox()).toBe("allow-scripts allow-forms allow-popups allow-downloads");
    expect(lastMint()).toMatchObject({ egress: "open", scripts: true });
  });

  it("restricted: no popups, no downloads; never allow-same-origin in any mode", async () => {
    render(agent(staticViewer()));
    await flush();
    expect(sandbox()).toBe("allow-scripts allow-forms");
    expect(sandbox()).not.toContain("allow-same-origin");
  });

  it("the toggle is a static-only control", async () => {
    render(operator(<LiveServerViewer path="live:http://localhost:5173/" cwd="/p" />));
    await flush();
    expect(screen.queryByTestId("live-scripts-toggle")).toBeNull();
  });

  it("an HtmlPreview-style frame never carries srcdoc", async () => {
    render(operator(staticViewer()));
    await flush();
    expect(iframe().hasAttribute("srcdoc")).toBe(false);
  });
});

describe("F9 — exposure", () => {
  it("exposed: restricted scripts are off with Run scripts; the click mints runScripts:true", async () => {
    fake.policy = { exposure: "exposed", epoch: 3, promptingEnabled: false };
    render(agent(staticViewer()));
    await flush();
    expect(sandbox()).toBe("");
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: false });
    expect(lastMint().runScripts).toBeUndefined();
    const run = screen.getByTestId("live-run-scripts");
    fireEvent.click(run);
    await flush();
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: true, runScripts: true });
    expect(sandbox()).toBe("allow-scripts allow-forms");
    expect(screen.queryByTestId("live-run-scripts")).toBeNull();
    // Only the click carried the marker.
    expect(fake.mints().filter((m) => m.body?.runScripts === true)).toHaveLength(1);
  });

  it("an operator open is not gated: scripts run on an exposed dashboard, no Run scripts", async () => {
    fake.policy = { exposure: "exposed", epoch: 3, promptingEnabled: false };
    render(operator(staticViewer()));
    await flush();
    expect(sandbox()).toContain("allow-scripts");
    expect(screen.queryByTestId("live-run-scripts")).toBeNull();
  });

  it("a tunnel starting under a scripted local-only preview re-mints WITHOUT scripts within 2 s", async () => {
    render(agent(staticViewer()));
    await flush();
    expect(sandbox()).toBe("allow-scripts allow-forms");
    expect(screen.queryByTestId("live-run-scripts")).toBeNull();
    fake.policy = { exposure: "exposed", epoch: 2, promptingEnabled: false };
    act(() => notifyExposureChanged(2));
    await flush(2000);
    expect(lastMint()).toMatchObject({ egress: "restricted", scripts: false });
    expect(lastMint().runScripts).toBeUndefined();
    expect(sandbox()).toBe("");
    expect(screen.getByTestId("live-run-scripts")).toBeTruthy();
  });

  it("an unreadable /policy fails closed (scripts stay off)", async () => {
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    globalThis.fetch = vi.fn((u: string, i?: RequestInit) =>
      u.endsWith("/policy") ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response) : real(u, i)) as unknown as typeof fetch;
    render(agent(staticViewer()));
    await flush();
    expect(sandbox()).toBe("");
  });
});

describe("F10 — Open ↗", () => {
  const setHost = (hostname: string) =>
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, hostname } });
  const realLocation = window.location;
  afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: realLocation }));

  const fakeWindow = () => {
    const w = { location: { href: "" }, opener: {}, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(w as unknown as Window);
    return w;
  };

  it("local operator + user-added port target → the real localhost URL (no mint)", async () => {
    setHost("localhost");
    fake.servers = [{ id: "port5173", label: "vite", host: "localhost", port: 5173, addedBy: "user" }];
    render(operator(<LiveServerViewer path="live:http://localhost:5173/dash" cwd="/p" />));
    await flush();
    const open = screen.getByTestId("live-open") as HTMLAnchorElement;
    expect(open.tagName).toBe("A");
    expect(open.getAttribute("href")).toBe("http://localhost:5173/dash");
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("local operator + agent preset → a freshly minted capability URL, never the loopback origin", async () => {
    setHost("localhost");
    const w = fakeWindow();
    render(agent(<LiveServerViewer path="live:http://localhost:54321/" cwd="/p" />));
    await flush();
    const minted = fake.mints().length;
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    expect(fake.mints()).toHaveLength(minted + 1);
    expect(w.location.href).toBe(`/live/port54321/~c/tok${minted + 1}_padpadpadpadpadpadpad/`);
    expect(w.location.href).not.toContain("54321/ ");
    expect(w.opener).toBeNull();
  });

  it("static target → a freshly minted capability URL with the deep path", async () => {
    setHost("localhost");
    const w = fakeWindow();
    render(operator(staticViewer()));
    await flush();
    submitAddress("screens/b.html");
    await flush();
    const minted = fake.mints().length;
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    expect(fake.mints()).toHaveLength(minted + 1);
    expect(w.location.href).toBe(`/live/stat1234/~c/tok${minted + 1}_padpadpadpadpadpadpad/screens/b.html`);
  });

  it("remote operator + user-added port → still a minted capability URL", async () => {
    setHost("dash.example.com");
    const w = fakeWindow();
    fake.servers = [{ id: "port5173", label: "vite", host: "localhost", port: 5173, addedBy: "user" }];
    render(operator(<LiveServerViewer path="live:http://localhost:5173/dash" cwd="/p" />));
    await flush();
    const open = screen.getByTestId("live-open");
    expect(open.tagName).toBe("BUTTON");
    const minted = fake.mints().length;
    fireEvent.click(open);
    await flush();
    expect(fake.mints()).toHaveLength(minted + 1);
    expect(w.location.href).toBe(`/live/port5173/~c/tok${minted + 1}_padpadpadpadpadpadpad/dash`);
  });
});

describe("F11 — keepalive touch", () => {
  const setVisibility = (v: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => setVisibility("visible"));

  it("touches every 5 min while visible, never while hidden", async () => {
    render(operator(staticViewer()));
    await flush();
    await flush(15 * 60_000);
    expect(fake.callsTo("/touch", "POST")).toHaveLength(3);
    expect(fake.callsTo("/touch")[0].body).toEqual({ tokenId: "tid1" });
    act(() => setVisibility("hidden"));
    await flush(10 * 60_000);
    expect(fake.callsTo("/touch", "POST")).toHaveLength(3);
  });

  it("a failed touch (revoked token) re-reads the policy and re-mints", async () => {
    render(operator(staticViewer()));
    await flush();
    fake.touchOk = false;
    const minted = fake.mints().length;
    const policyReads = fake.callsTo("/policy").length;
    await flush(5 * 60_000);
    expect(fake.callsTo("/policy").length).toBeGreaterThan(policyReads);
    expect(fake.mints().length).toBeGreaterThan(minted);
  });
});

describe("F12 — picker", () => {
  const seed = () => {
    const mk = (port: number, addedBy: "user" | "preset" | "legacy" | undefined) => ({ id: `port${port}`, label: `localhost:${port}`, host: "localhost", port, addedBy });
    fake.servers = [
      mk(54321, "preset"),
      mk(5173, "user"),
      mk(6006, "user"),
      ...[1, 2, 3, 4, 5].map((n) => mk(50000 + n, undefined)),
      ...[6, 7, 8, 9].map((n) => mk(50000 + n, "preset")),
    ];
  };
  const mount = () =>
    render(
      <SplitWorkspaceProvider sessionId="sPick" cwd="/p" orientation="h">
        <LiveServerViewer path="live:preview" cwd="/p" />
      </SplitWorkspaceProvider>,
    );
  afterEach(() => setActiveCanvasPort("sPick", null));

  it("orders active canvas → added by you → collapsed older (9), with a confirmed Clear all", async () => {
    seed();
    setActiveCanvasPort("sPick", 54321);
    mount();
    await flush();
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["Active canvas", "Added by you"]);
    const active = screen.getByRole("region", { name: "Active canvas" });
    expect(within(active).getByText("localhost:54321")).toBeTruthy();
    expect(within(active).getByText("Live")).toBeTruthy();
    const older = screen.getByTestId("live-older") as HTMLDetailsElement;
    expect(older.open).toBe(false);
    expect(within(older).getByText("Older targets (9)")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Added by you" })).getAllByTestId("live-target-row")).toHaveLength(2);

    // Clear all asks first; Cancel keeps all nine.
    fireEvent.click(screen.getByTestId("live-clear-older"));
    expect(screen.getByTestId("live-clear-confirm-row").textContent).toContain("Remove 9 older targets?");
    fireEvent.click(screen.getByTestId("live-clear-cancel"));
    expect(within(older).getAllByTestId("live-target-row")).toHaveLength(9);
    expect(fake.callsTo("/api/live-server/", "DELETE")).toHaveLength(0);

    // Remove deletes every older target (the server revokes presets, drops persisted entries).
    fireEvent.click(screen.getByTestId("live-clear-older"));
    fireEvent.click(screen.getByTestId("live-clear-confirm"));
    await flush();
    const deleted = fake.callsTo("/api/live-server/", "DELETE").map((c) => c.url.split("/").pop());
    expect(deleted.sort()).toEqual(
      ["port50001", "port50002", "port50003", "port50004", "port50005", "port50006", "port50007", "port50008", "port50009"],
    );
    expect(screen.queryByTestId("live-older")).toBeNull();
  });

  it("✕ on one target removes just that one", async () => {
    seed();
    mount();
    await flush();
    fireEvent.click(screen.getByLabelText("Remove target localhost:5173"));
    await flush();
    expect(fake.callsTo("/api/live-server/", "DELETE").map((c) => c.url.split("/").pop())).toEqual(["port5173"]);
  });

  it("launching a saved user target is an operator open (open egress)", async () => {
    seed();
    mount();
    await flush();
    fireEvent.click(screen.getByText("localhost:5173"));
    await flush();
    expect(lastMint()).toMatchObject({ egress: "open", scripts: true });
  });
});

describe("F13 — egress banner", () => {
  const report = (promptingEnabled = true) => ({
    origins: [
      { origin: "https://cdn.tailwindcss.com", source: "markup" as const, state: "blocked" as const },
      { origin: "https://stats.example-cdn.net", source: "runtime" as const, state: "blocked" as const },
      { origin: "https://someone.github.io", source: "markup" as const, state: "blocked" as const, shared: true },
      { origin: "http://192.168.1.10", source: "markup" as const, state: "blocked" as const, ungrantable: true },
    ],
    scanIncomplete: true,
    rootAbsolute: false,
    runtimeChannel: true,
    promptingEnabled,
  });
  const row = (origin: string) => screen.getAllByTestId("egress-row").find((r) => r.textContent?.includes(origin)) as HTMLElement;

  it("labels sources, flags shared hosting, offers controls per entitlement", async () => {
    fake.egress = report();
    render(agent(staticViewer()));
    await flush();
    const banner = screen.getByTestId("egress-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain("4 external sources blocked");
    // markup origin: both controls, "in markup"
    const cdn = row("cdn.tailwindcss.com");
    expect(within(cdn).getByTestId("egress-source").textContent).toBe("in markup");
    expect(within(cdn).getByTestId("egress-allow-once")).toBeTruthy();
    expect(within(cdn).getByTestId("egress-allow-project")).toBeTruthy();
    // runtime origin: Allow once only
    const stats = row("stats.example-cdn.net");
    expect(within(stats).getByTestId("egress-source").textContent).toBe("reported by this page");
    expect(within(stats).getByTestId("egress-allow-once")).toBeTruthy();
    expect(within(stats).queryByTestId("egress-allow-project")).toBeNull();
    // shared hosting warning
    expect(within(row("someone.github.io")).getByTestId("egress-shared-warning")).toBeTruthy();
    // private: no controls
    const priv = row("192.168.1.10");
    expect(within(priv).queryByRole("button")).toBeNull();
    // incomplete scan
    expect(screen.getByTestId("egress-incomplete").textContent).toBe("Some resources may be blocked.");
    // prompting on → no footnote; no dialog raised just by rendering
    expect(screen.queryByTestId("egress-prompts-note")).toBeNull();
    expect(fake.callsTo("/egress-grant-request")).toHaveLength(0);
  });

  it("prompting disabled: no project button, a footnote instead", async () => {
    fake.egress = report(false);
    render(agent(staticViewer()));
    await flush();
    expect(screen.queryByTestId("egress-allow-project")).toBeNull();
    expect(screen.getByTestId("egress-prompts-note").textContent).toContain("Settings");
  });

  it("Allow once → allow-once for this viewer, the frame reloads, a pill names the origin", async () => {
    fake.egress = report();
    render(agent(staticViewer()));
    await flush();
    const before = iframe();
    const viewerId = lastMint().viewerId;
    fireEvent.click(within(row("cdn.tailwindcss.com")).getByTestId("egress-allow-once"));
    await flush();
    const call = fake.callsTo("/allow-once", "POST")[0];
    expect(call.body).toEqual({ tokenId: "tid1", viewerId, origin: "https://cdn.tailwindcss.com" });
    expect(iframe()).not.toBe(before); // reloaded
    expect(screen.getByText("cdn.tailwindcss.com allowed for this preview")).toBeTruthy();
    // No grant request was made.
    expect(fake.callsTo("/egress-grant-request")).toHaveLength(0);
  });

  it("Allow for this project is the operator's click: it posts the request", async () => {
    fake.egress = report();
    render(agent(staticViewer()));
    await flush();
    expect(fake.callsTo("/egress-grant-request")).toHaveLength(0);
    fireEvent.click(within(row("cdn.tailwindcss.com")).getByTestId("egress-allow-project"));
    await flush();
    expect(fake.callsTo("/egress-grant-request", "POST")[0].body).toEqual({ tokenId: "tid1", origin: "https://cdn.tailwindcss.com" });
    expect(row("cdn.tailwindcss.com").textContent).toContain("Waiting for your answer");
  });

  it("a prompting-disabled reply shows the note", async () => {
    fake.egress = report();
    fake.grantReply = { status: 200, body: { ok: false, reason: "prompting-disabled" } };
    render(agent(staticViewer()));
    await flush();
    fireEvent.click(within(row("cdn.tailwindcss.com")).getByTestId("egress-allow-project"));
    await flush();
    expect(within(row("cdn.tailwindcss.com")).getByTestId("egress-row-note").textContent).toContain("Settings");
  });

  it("polls every 2 s while restricted, and stops after 30 s of no change", async () => {
    fake.egress = report();
    render(agent(staticViewer()));
    await flush();
    const polls = () => fake.callsTo("/egress?token=").length;
    await flush(10_000);
    expect(polls()).toBeGreaterThanOrEqual(5);
    await flush(25_000);
    const settled = polls();
    await flush(60_000);
    expect(polls()).toBe(settled);
    expect(settled).toBeLessThanOrEqual(17);
  });

  it("an open (operator) static preview reads the report once, for the root-absolute hint only", async () => {
    fake.egress = { ...report(), rootAbsolute: true };
    render(operator(staticViewer()));
    await flush(10_000);
    expect(fake.callsTo("/egress?token=")).toHaveLength(1);
    expect(screen.queryByTestId("egress-banner")).toBeNull();
    expect(screen.getByTestId("live-hint-root-absolute").textContent).toContain("root-absolute");
  });

  it("the Restricted pill shows only under the restricted policy", async () => {
    render(agent(staticViewer()));
    await flush();
    expect(screen.getByTestId("live-restricted-pill")).toBeTruthy();
    cleanup();
    render(operator(staticViewer()));
    await flush();
    expect(screen.queryByTestId("live-restricted-pill")).toBeNull();
  });
});

describe("agent re-declare of the active tab", () => {
  it("shows Updated by the agent · Reload without disturbing the frame; Reload acknowledges", async () => {
    render(
      <SplitWorkspaceProvider sessionId="sUpd" cwd="/p" orientation="h">
        {agent(<LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" updatedByAgent />)}
      </SplitWorkspaceProvider>,
    );
    await flush();
    const before = iframe();
    expect(screen.getByTestId("live-updated-notice")).toBeTruthy();
    expect(iframe()).toBe(before);
    fireEvent.click(screen.getByTestId("live-updated-reload"));
    await flush();
    expect(iframe()).not.toBe(before);
  });
});
