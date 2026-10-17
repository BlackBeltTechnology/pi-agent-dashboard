/**
 * Settings → Access: pi trust conferred by the dashboard (test-plan #F2).
 * See change: mirror-dashboard-trust-to-pi.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiTrustMirrorSection } from "../PiTrustMirrorSection.js";

const CONFIG = {
  enabled: true,
  coverInteractive: false,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false },
};

const VIEW = {
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

const writes: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, status: 200, json: async () => ({ success: true, data: url.includes("/api/access/pi-trust") && method === "GET" ? VIEW : {} }) };
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
