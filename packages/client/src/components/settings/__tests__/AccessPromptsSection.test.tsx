/**
 * Settings → Access prompt surfaces (change: add-access-grant-dialog, tasks
 * 8.1, 8.2 (verdict store), 8.3; test-plan rows 10.62b, 10.62c).
 */
import type { GrantRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessPromptsView, PromptingBlocker } from "../../../lib/access-grants/access-prompts-types.js";
import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { GrantPromptStore } from "../../../lib/access-grants/grant-prompt-store.js";
import { AccessPromptsSection } from "../AccessPromptsSection.js";

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];
let view: AccessPromptsView;

function makeView(blockers: PromptingBlocker[] = ["disabled"]): AccessPromptsView {
  return {
    prompting: {
      enabled: !blockers.includes("disabled"),
      killSwitch: blockers.includes("kill-switch"),
      hostGateMode: blockers.includes("report-mode") ? "report" : "enforce",
      blockers,
    },
    pending: [
      {
        promptId: "p-held",
        plane: "filesystem",
        subject: "/repo/secret-dir",
        mode: "held",
        prompted: false,
        suppressedBy: "disabled",
        recordedAt: 1,
        expiresAt: Date.now() + 60_000,
        hits: 2,
        store: "access-grants.json",
        copy: { mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" },
      },
      {
        promptId: "p-net",
        plane: "network",
        subject: "10.9.0.0/16",
        mode: "deferred",
        prompted: false,
        recordedAt: 1,
        expiresAt: Date.now() + 60_000,
        hits: 1,
        store: "config.trustedNetworks",
        copy: { mode: "deferred", verdicts: ["allow-always", "deny"], store: "config.trustedNetworks" },
      },
    ],
    verdicts: [
      {
        answeredBy: "operator",
        promptId: "v1",
        plane: "filesystem",
        subject: "/repo",
        outcome: "allow-always",
        store: "access-grants.json",
        widenedFrom: "/repo/pkg",
        at: 3,
      },
      { answeredBy: "yolo", plane: "filesystem", subject: "/repo/other", outcome: "auto-allowed", at: 2 },
    ],
    refusals: [{ plane: "filesystem", subject: "/home/u/.ssh", refusedAt: 1 }],
  };
}

function ok(data: unknown = null) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) });
}

beforeEach(() => {
  calls = [];
  view = makeView();
  clearGrantChannel();
  global.fetch = vi.fn((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/access/prompts" && method === "GET") return ok(view);
    if (url.startsWith("/api/access/prompts/") && method === "POST") {
      const id = decodeURIComponent(url.split("/").pop() as string);
      view = { ...view, pending: view.pending.filter((p) => p.promptId !== id) };
      return ok();
    }
    if (url.startsWith("/api/access/refusals") && method === "DELETE") {
      view = { ...view, refusals: [] };
      return ok();
    }
    if (url === "/api/config" && method === "PUT") return ok();
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  }) as unknown as typeof fetch;
});

afterEach(() => cleanup());

const store = () => new GrantPromptStore();
const banner = (id: string) => screen.queryByTestId(`access-prompts-banner-${id}`);

describe("AccessPromptsSection", () => {
  // 8.1 — a pending request is answerable from the page with prompting disabled.
  it("answers a pending request from the page while prompting is disabled", async () => {
    render(<AccessPromptsSection store={store()} />);
    const rows = await screen.findAllByTestId("access-pending-row");
    expect(rows).toHaveLength(2);
    const held = rows[0];
    expect(within(held).getByText("/repo/secret-dir")).toBeTruthy();
    fireEvent.click(within(held).getByTestId("access-pending-allow-once"));
    await waitFor(() => expect(screen.getAllByTestId("access-pending-row")).toHaveLength(1));
    expect(calls).toContainEqual({
      url: "/api/access/prompts/p-held",
      method: "POST",
      body: { plane: "filesystem", subject: "/repo/secret-dir", verdict: "allow-once" },
    });
  });

  it("offers allow-once only on held pending entries", async () => {
    render(<AccessPromptsSection store={store()} />);
    const [held, deferred] = await screen.findAllByTestId("access-pending-row");
    expect(within(held).queryByTestId("access-pending-allow-once")).toBeTruthy();
    expect(within(deferred).queryByTestId("access-pending-allow-once")).toBeNull();
    expect(within(deferred).getByTestId("access-pending-allow-always")).toBeTruthy();
    expect(within(deferred).getByTestId("access-pending-deny")).toBeTruthy();
  });

  // 8.1 / 8.2 — verdicts distinguish operator from YOLO and name the store written.
  it("lists recent verdicts with the store written, widening, and YOLO rows", async () => {
    render(<AccessPromptsSection store={store()} />);
    const rows = await screen.findAllByTestId("access-verdict-row");
    const [op, yolo] = rows;
    expect(op.dataset.answeredBy).toBe("operator");
    expect(op.textContent).toContain("access-grants.json");
    expect(op.textContent).toContain("/repo/pkg");
    expect(yolo.dataset.answeredBy).toBe("yolo");
    expect(yolo.textContent).toMatch(/no human answered/i);
  });

  describe("S4 banners + S5 toggle (8.3)", () => {
    // 10.62b (E54) — report mode: stated, denials still answerable, toggle inert not hidden.
    it("report mode: states held prompts are unavailable and renders the toggle inert", async () => {
      view = makeView(["report-mode"]);
      render(<AccessPromptsSection store={store()} />);
      const b = await screen.findByTestId("access-prompts-banner-report-mode");
      expect(b.textContent).toMatch(/Held prompts unavailable — host-gate mode is report/);
      expect(b.textContent).toMatch(/remain listed and answerable/);
      expect(banner("kill-switch")).toBeNull();
      const toggle = screen.getByTestId("access-prompts-toggle") as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      expect(screen.getByTestId("access-prompts-toggle-reason").textContent).toMatch(/report/);
      expect(screen.getAllByTestId("access-pending-row").length).toBeGreaterThan(0);
      expect(within(b).getByRole("link").getAttribute("href")).toBe("/settings/security");
    });

    it("kill switch: names the env var and renders the toggle inert, reading off", async () => {
      view = makeView(["kill-switch"]);
      view.prompting.enabled = true;
      render(<AccessPromptsSection store={store()} />);
      const b = await screen.findByTestId("access-prompts-banner-kill-switch");
      expect(b.textContent).toContain("PI_DASHBOARD_DISABLE_GRANT_PROMPT");
      expect(banner("report-mode")).toBeNull();
      const toggle = screen.getByTestId("access-prompts-toggle") as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });

    it("both at once: shows both banners", async () => {
      view = makeView(["report-mode", "kill-switch"]);
      render(<AccessPromptsSection store={store()} />);
      await waitFor(() => expect(banner("report-mode")).toBeTruthy());
      expect(banner("kill-switch")).toBeTruthy();
      expect((screen.getByTestId("access-prompts-toggle") as HTMLButtonElement).disabled).toBe(true);
    });

    it("disabled by config: says so, and the toggle writes accessGrants.promptEnabled", async () => {
      render(<AccessPromptsSection store={store()} />);
      const b = await screen.findByTestId("access-prompts-banner-disabled");
      expect(b.textContent).toMatch(/no dialog will be raised/i);
      const toggle = screen.getByTestId("access-prompts-toggle") as HTMLButtonElement;
      expect(toggle.disabled).toBe(false);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(calls).toContainEqual({
          url: "/api/config",
          method: "PUT",
          body: { accessGrants: { promptEnabled: true } },
        }),
      );
    });

    // 10.62c (E55) — a browser without a capability is told so.
    it("states this browser will not receive prompts when it holds no capability", async () => {
      render(<AccessPromptsSection store={store()} />);
      const b = await screen.findByTestId("access-prompts-banner-no-channel");
      expect(b.textContent).toMatch(/This browser will not receive prompts/);
      act(() => setGrantChannel("cap"));
      expect(banner("no-channel")).toBeNull();
    });
  });

  it("lists remembered refusals and clears one", async () => {
    render(<AccessPromptsSection store={store()} />);
    const row = await screen.findByTestId("access-refusal-row");
    expect(row.textContent).toContain("/home/u/.ssh");
    fireEvent.click(within(row).getByTestId("access-refusal-clear"));
    await waitFor(() => expect(screen.queryByTestId("access-refusal-row")).toBeNull());
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe(
      "/api/access/refusals?plane=filesystem&subject=%2Fhome%2Fu%2F.ssh",
    );
  });

  it("refetches when a prompt frame changes the queue", async () => {
    const s = store();
    render(<AccessPromptsSection store={s} />);
    await screen.findAllByTestId("access-pending-row");
    const gets = () => calls.filter((c) => c.method === "GET").length;
    const before = gets();
    const req: GrantRequestMessage = {
      type: "grant_request",
      promptId: "x",
      plane: "cwd",
      subject: "/x",
      expiresAt: Date.now() + 1000,
      copy: { mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "pins" },
    };
    act(() => s.apply(req));
    await waitFor(() => expect(gets()).toBeGreaterThan(before));
  });

  it("renders a markup-bearing pending subject as text", async () => {
    view.pending[1] = { ...view.pending[1], plane: "cors", subject: "https://<img src=x onerror=alert(1)>.example.com" };
    render(<AccessPromptsSection store={store()} />);
    await screen.findByText("https://<img src=x onerror=alert(1)>.example.com");
    expect(document.querySelector("img")).toBeNull();
  });
});
