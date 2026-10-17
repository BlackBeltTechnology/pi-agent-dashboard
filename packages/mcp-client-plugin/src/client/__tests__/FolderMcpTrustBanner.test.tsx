/**
 * Folder MCP page trust banner (test-plan #F3): who trusts the folder — pi (naming the
 * recorded path), the dashboard (naming source + folder + scope), or nobody.
 * See change: mirror-dashboard-trust-to-pi.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import { FolderMcpPage } from "../FolderMcpPage.js";
import { __resetNotTrackedCache, invalidateEffective } from "../hooks.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

const CWD = "/Users/me/Documents/app";

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function serve(view: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/effective")) return jsonOk({ scope: "project", cwd: CWD, servers: [], layers: [], ...view });
      if (u.includes("/schema")) return jsonOk(schemaDoc);
      throw new Error(`unexpected request: ${u}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  invalidateEffective(CWD);
  __resetNotTrackedCache();
});

const open = () => render(<FolderMcpPage params={{ encodedCwd: encodeURIComponent(CWD) }} onBack={vi.fn()} />);

describe("#F3 folder trust banner", () => {
  it("pi trusts: names the recorded path, no 'not trusted' notice", async () => {
    serve({ trusted: true, trustSource: { kind: "recorded", path: "/Users/me/Project" } });
    open();
    const banner = await screen.findByTestId("mcp-folder-trusted-pi");
    expect(banner.textContent).toContain("/Users/me/Project");
    expect(screen.queryByTestId("mcp-folder-untrusted")).toBeNull();
  });

  it("dashboard trusts: names the source and folder, says dashboard sessions only, no 'not trusted' notice", async () => {
    serve({
      trusted: true,
      trustCoverInteractive: false,
      trustSource: { kind: "dashboard", sourceKind: "pinned", entry: "/Users/me/Documents" },
    });
    open();
    const banner = await screen.findByTestId("mcp-folder-trusted-dashboard");
    expect(banner.textContent).toContain("trusted by the dashboard");
    expect(banner.textContent).toContain("pinned folder /Users/me/Documents");
    expect(banner.textContent).toMatch(/dashboard sessions, not terminal pi/);
    expect(banner.textContent).toMatch(/pi mcp list/);
    expect(screen.queryByTestId("mcp-folder-untrusted")).toBeNull();
  });

  it("dashboard trusts with coverInteractive: states it covers every pi session", async () => {
    serve({ trusted: true, trustCoverInteractive: true, trustSource: { kind: "dashboard", sourceKind: "pinned", entry: "/x" } });
    open();
    expect((await screen.findByTestId("mcp-folder-trusted-dashboard")).textContent).toMatch(/every pi session/);
  });

  it("nobody trusts: the notice links to Settings → Access", async () => {
    serve({ trusted: false });
    open();
    const notice = await screen.findByTestId("mcp-folder-untrusted");
    expect(notice.textContent).toContain("Settings → Access");
    expect(screen.getByTestId("mcp-folder-untrusted-access-link")).toBeTruthy();
    expect(screen.queryByTestId("mcp-folder-trusted-pi")).toBeNull();
    expect(screen.queryByTestId("mcp-folder-trusted-dashboard")).toBeNull();
  });
});
