/**
 * Settings → Access: pi trust conferred by the dashboard (test-plan #F2; live
 * rows, live-query controls and the reason-code legend: test-plan #F1 of
 * mirror-dashboard-trust-live-remote).
 * See change: mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote.
 */
import { MIRROR_WITHHELD_LABELS } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiTrustMirrorSection } from "../PiTrustMirrorSection.js";

const CONFIG = {
  enabled: true,
  coverInteractive: false,
  liveQuery: true,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
};

const VIEW: Record<string, unknown> = {
  available: true,
  config: CONFIG,
  agentDir: "/x/agent",
  piEntries: [{ folder: "/Users/me/Project", decision: true }],
  effective: [{ folder: "/Users/me/Documents", sourceKind: "pinned", sourceLabel: "pinned folder", coversSubfolders: true }],
  sourcesNotInstalled: ["workflow"],
  entries: [
    { sourceKind: "pinned", sourceLabel: "pinned folder", folder: "/Users/me/Documents", choice: null, byDefault: true, confers: true },
    { sourceKind: "accessGrants", sourceLabel: "access grant", folder: "/private/tmp", choice: true, byDefault: false, confers: false, reason: "forbidden-folder", reasonLabel: "folder never mirrored (home, system, temp, secrets)" },
    { sourceKind: "worktreeInit", sourceLabel: "worktree-init trust", folder: "/r", choice: null, byDefault: true, confers: false, reason: "hook-changed", reasonLabel: "hook changed — re-approve" },
  ],
  ignored: [],
};

let served: Record<string, unknown> = VIEW;
const writes: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  writes.length = 0;
  served = VIEW;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, status: 200, json: async () => ({ success: true, data: url.includes("/api/access/pi-trust") && method === "GET" ? served : {} }) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("#F2 Access page pi-trust disclosure", () => {
  it("effective list, ignored rows with codes + labels, disclosures, agent dir", async () => {
    render(<PiTrustMirrorSection />);
    const effective = await screen.findByTestId("pi-trust-effective");
    const row = within(effective).getByTestId("pi-trust-effective-row");
    expect(row.textContent).toContain("/Users/me/Documents");
    expect(row.textContent).toContain("pinned folder");
    expect(row.textContent).toContain("covers subfolders");

    const ignored = screen.getAllByTestId("pi-trust-ignored");
    expect(ignored.map((i) => i.getAttribute("data-reason"))).toEqual(["forbidden-folder", "hook-changed"]);
    expect(ignored[1].textContent).toContain("hook changed — re-approve");

    expect(screen.getByTestId("pi-trust-precedence").textContent).toMatch(/defaultProjectTrust.*never/);
    expect(screen.getByTestId("pi-trust-scope").textContent).toMatch(/headless sessions the dashboard starts only/);
    expect(screen.getByTestId("pi-trust-exclusions").textContent).toMatch(/--no-approve.*--no-extensions/);
    expect(screen.getByTestId("pi-trust-agent-dir").textContent).toContain("/x/agent");
    expect(screen.getByTestId("pi-trust-pi-entries").textContent).toContain("/Users/me/Project");
    expect(screen.getByTestId("pi-trust-entries").textContent).toContain("by default");
  });

  it("render performs no write; a choice change PUTs one entry's choice", async () => {
    render(<PiTrustMirrorSection />);
    await screen.findByTestId("pi-trust-effective");
    expect(writes).toEqual([]);
    const first = screen.getAllByTestId("pi-trust-entry-choice")[0];
    fireEvent.click(first);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: "/api/access/pi-trust/choice", method: "PUT", body: { sourceKind: "pinned", folder: "/Users/me/Documents", choice: false } });
  });
});

const UNTIL = Date.UTC(2030, 0, 1, 14, 30);
// The label uses the viewer's locale/timezone, so the expectation is derived the same way.
const UNTIL_LABEL = `YOLO until ${new Date(UNTIL).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

const LIVE_VIEW = {
  ...VIEW,
  config: { ...CONFIG, liveQueryTimeoutMs: 450 },
  effective: [
    { folder: "/w", sourceKind: "yolo", sourceLabel: "YOLO session", coversSubfolders: true, live: true, lifetime: { kind: "yolo-until", until: UNTIL } },
    { folder: "/r", sourceKind: "worktreeInit", sourceLabel: "worktree-init trust", coversSubfolders: true, live: true, lifetime: { kind: "restart" } },
    { folder: "/e", sourceKind: "yolo", sourceLabel: "YOLO session", coversSubfolders: true, live: true, lifetime: { kind: "yolo-process" } },
  ],
  entries: [
    { sourceKind: "worktreeInit", sourceLabel: "worktree-init trust", folder: "/r", choice: null, byDefault: true, confers: true, live: true, lifetime: { kind: "restart" } },
    { sourceKind: "accessGrants", sourceLabel: "access grant", folder: "/g", choice: null, byDefault: false, confers: false, reason: "source-off", reasonLabel: "source switched off", live: true, lifetime: { kind: "restart" } },
  ],
};

describe("#F1 live rows, live-query controls, reason-code legend", () => {
  it("lists live rows with their lifetime", async () => {
    served = LIVE_VIEW;
    render(<PiTrustMirrorSection />);
    const rows = within(await screen.findByTestId("pi-trust-effective")).getAllByTestId("pi-trust-effective-row");
    const byFolder = (f: string) => rows.find((r) => r.textContent?.includes(f))?.textContent ?? "";
    expect(byFolder("/w")).toContain(UNTIL_LABEL);
    expect(UNTIL_LABEL).toMatch(/^YOLO until \d{1,2}:\d{2}/);
    expect(byFolder("/r")).toContain("until dashboard restarts");
    expect(byFolder("/e")).toContain("YOLO while the server runs");
  });

  it("live entries are read-only: lifetime shown, no choice control; a non-conferring one keeps its code", async () => {
    served = LIVE_VIEW;
    render(<PiTrustMirrorSection />);
    const entries = await screen.findAllByTestId("pi-trust-entry");
    expect(entries.every((e) => e.getAttribute("data-live") === "true")).toBe(true);
    expect(screen.queryByTestId("pi-trust-entry-choice")).toBeNull();
    expect(entries[0].textContent).toContain("until dashboard restarts");
    expect(screen.getByTestId("pi-trust-ignored").getAttribute("data-reason")).toBe("source-off");
  });

  it("liveQuery checkbox and timeout input PUT their keys; empty clears the override; value is clamped", async () => {
    served = LIVE_VIEW;
    render(<PiTrustMirrorSection />);
    const box = (await screen.findByTestId("pi-trust-live-query")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    const input = screen.getByTestId("pi-trust-live-query-timeout") as HTMLInputElement;
    expect(input.value).toBe("450");
    expect(screen.getByTestId("pi-trust-live-query-timeout-help").textContent).toMatch(/300 ms local \/ 1000 ms remote.*50.1000/);

    fireEvent.click(box);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: "/api/config", method: "PUT", body: { piTrustMirror: { liveQuery: false } } });

    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body).toEqual({ piTrustMirror: { liveQueryTimeoutMs: 1000 } });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].body).toEqual({ piTrustMirror: { liveQueryTimeoutMs: null } });
  });

  it("the YOLO source switch is listed", async () => {
    render(<PiTrustMirrorSection />);
    expect(((await screen.findByTestId("pi-trust-source-yolo")) as HTMLInputElement).checked).toBe(true);
  });

  it("legend lists all 18 bridge reason codes with their labels", async () => {
    render(<PiTrustMirrorSection />);
    const items = within(await screen.findByTestId("pi-trust-legend")).getAllByTestId("pi-trust-legend-item");
    const codes = Object.keys(MIRROR_WITHHELD_LABELS);
    expect(codes).toHaveLength(18);
    expect(items.map((i) => i.getAttribute("data-code"))).toEqual(codes);
    for (const [code, label] of Object.entries(MIRROR_WITHHELD_LABELS)) {
      const item = items.find((i) => i.getAttribute("data-code") === code);
      expect(item?.textContent).toContain(label);
    }
  });

  it("discloses live entries, other-machine bridges, server-only counters and the npm residual", async () => {
    render(<PiTrustMirrorSection />);
    await screen.findByTestId("pi-trust-disclosures");
    expect(screen.getByTestId("pi-trust-live").textContent).toMatch(/end with their source.*whatever the session kind.*cover interactive/s);
    expect(screen.getByTestId("pi-trust-remote").textContent).toMatch(/another machine.*matches the server's.*live-timeout/s);
    expect(screen.getByTestId("pi-trust-npm-residual").textContent).toMatch(/\.pi\/settings\.json.*by reference, not by .*bytes/s);
  });
});

describe("#F5 (unit) live rows converge without a reload", () => {
  it("a YOLO row appears after the next refresh and disappears when the session ends, never duplicated", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<PiTrustMirrorSection />);
      const effective = await screen.findByTestId("pi-trust-effective");
      expect(within(effective).queryAllByText(/\/workspace\/a/)).toHaveLength(0);

      served = {
        ...VIEW,
        effective: [
          ...(VIEW.effective as unknown[]),
          { folder: "/workspace/a", sourceKind: "yolo", sourceLabel: "YOLO session", coversSubfolders: true, live: true, lifetime: { kind: "yolo-process" } },
        ],
      };
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => expect(within(screen.getByTestId("pi-trust-effective")).getAllByTestId("pi-trust-effective-row")).toHaveLength(2));
      expect(within(screen.getByTestId("pi-trust-effective")).getAllByText(/\/workspace\/a/)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(5_100); // unchanged payload: still one row
      expect(within(screen.getByTestId("pi-trust-effective")).getAllByTestId("pi-trust-effective-row")).toHaveLength(2);

      served = VIEW;
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => expect(within(screen.getByTestId("pi-trust-effective")).getAllByTestId("pi-trust-effective-row")).toHaveLength(1));
    } finally {
      vi.useRealTimers();
    }
  });
});
