import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SettingsPanel } from "../SettingsPanel.js";

// Dual-URL routing is exercised against real wouter + jsdom history (no mock)
// so route-param / ?tab= resolution and the replace-redirects run for real.
// See change: reorganize-settings-into-pages.
function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

// Mock model-proxy-api (called by ModelProxySection when proxy is enabled)
vi.mock("../../lib/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: {
    maxEventsPerSession: 200,
    maxStringFieldSize: 4000,
    maxWsBufferBytes: 4194304,
  },
};

function mockFetchConfig(configOverrides?: any) {
  const cfg = configOverrides ? { ...mockConfig, ...configOverrides } : mockConfig;
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: cfg }) });
    }
    if (url === "/api/providers") {
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    }
    // PUT /api/config
    if (url === "/api/config" && options?.method === "PUT") {
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

// Click a left-nav page item by its visible label.
function gotoPage(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setPath("/settings/general");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the left-nav rail with grouped pages and defaults to General", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeTruthy();
      expect(screen.getByTestId("settings-nav-rail")).toBeTruthy();
      // Nav items (one per page).
      expect(screen.getByRole("button", { name: "General" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Remote Servers" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Security" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "OpenSpec" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Developer" })).toBeTruthy();
      // General page content: Interface section, default selection.
      expect(screen.getByText("Interface")).toBeTruthy();
    });
  });

  it("keeps header and nav rail outside the scroll container", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Settings"));

    const header = screen.getByTestId("settings-header");
    const navRail = screen.getByTestId("settings-nav-rail");
    const content = screen.getByTestId("settings-content");

    expect(content.contains(header)).toBe(false);
    expect(content.contains(navRail)).toBe(false);
  });

  it("marks the active page with aria-current and switches content + URL", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");

    // Switch to Server page.
    gotoPage("Server");
    await waitFor(() => {
      expect(screen.getByText("HTTP Port")).toBeTruthy();
      expect(window.location.pathname).toBe("/settings/server");
      expect(screen.getByRole("button", { name: "Server" }).getAttribute("aria-current")).toBe("page");
    });
  });

  it("redirects bare /settings to /settings/general", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings");

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/general");
      expect(screen.getByText("Interface")).toBeTruthy();
    });
  });

  it("renders a canonical page URL directly", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/security");

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Authentication")).toBeTruthy();
      expect(window.location.pathname).toBe("/settings/security");
    });
  });

  it("replace-upgrades legacy ?tab=<id> to the canonical path", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings?tab=security");

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/security");
      expect(window.location.search).toBe("");
      expect(screen.getByText("Authentication")).toBeTruthy();
    });
  });

  it("aliases legacy ?tab=advanced → developer and ?tab=servers → remote", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings?tab=advanced");

    const { unmount } = render(<SettingsPanel />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/developer");
      expect(screen.getByText("Editor (code-server)")).toBeTruthy();
    });
    unmount();
    cleanup();

    setPath("/settings?tab=servers");
    render(<SettingsPanel />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/remote");
      expect(screen.getByText("Known Servers")).toBeTruthy();
    });
  });

  it("falls back to general for an unknown page id", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/bogus");

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/general");
      expect(screen.getByText("Interface")).toBeTruthy();
    });
  });

  it("shows loading state initially", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<SettingsPanel />);
    expect(screen.getByText("Loading settings...")).toBeTruthy();
  });

  it("renders each section on exactly one page (dedup)", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    // Memory Limits lives on Server only.
    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));
    expect(screen.queryByText("Editor (code-server)")).toBeNull();

    // Editor lives on Developer only; Memory Limits is gone there.
    gotoPage("Developer");
    await waitFor(() => screen.getByText("Editor (code-server)"));
    expect(screen.queryByText("Memory Limits")).toBeNull();
  });

  it("saves changes made across multiple pages in a single operation", async () => {
    let savedBody: any;
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    // Change port on the Server page.
    gotoPage("Server");
    await waitFor(() => screen.getByText("HTTP Port"));
    const portInput = screen.getByDisplayValue("8000");
    fireEvent.change(portInput, { target: { value: "9000" } });

    // Change a memory limit (also Server page) and navigate away/back to prove
    // the draft survives page changes.
    const maxEventsInput = screen.getByDisplayValue("200");
    fireEvent.change(maxEventsInput, { target: { value: "500" } });

    gotoPage("Sessions");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/sessions"));
    gotoPage("Server");
    await waitFor(() => screen.getByText("HTTP Port"));
    // Edits preserved after navigating between pages.
    expect(screen.getByDisplayValue("9000")).toBeTruthy();

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody).toBeTruthy();
      expect(savedBody.port).toBe(9000);
      expect(savedBody.memoryLimits?.maxEventsPerSession).toBe(500);
    });
  });

  it("shows 'No changes' when saving without modifications", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getAllByTestId("save-btn"));

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(screen.getByText("No changes to save")).toBeTruthy();
    });
  });

  it("displays bypass URLs from auth config on the Security page", async () => {
    const configWithAuth = {
      ...mockConfig,
      auth: {
        secret: "***",
        providers: { github: { clientId: "id1", clientSecret: "***" } },
        allowedUsers: ["user@example.com"],
        bypassUrls: ["/webhooks/", "/metrics"],
      },
    };
    global.fetch = mockFetchConfig(configWithAuth);
    setPath("/settings/security");

    render(<SettingsPanel />);

    await waitFor(() => screen.getByTestId("bypass-urls-textarea"));

    const textarea = screen.getByTestId("bypass-urls-textarea");
    expect((textarea as HTMLTextAreaElement).value).toBe("/webhooks/\n/metrics");
  });

  it("includes bypassUrls in the save payload when changed on the Security page", async () => {
    const configWithAuth = {
      ...mockConfig,
      auth: {
        secret: "***",
        providers: { github: { clientId: "id1", clientSecret: "***" } },
        bypassUrls: [],
      },
    };
    let savedBody: any;
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: configWithAuth }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/security");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("bypass-urls-textarea"));

    const textarea = screen.getByTestId("bypass-urls-textarea");
    fireEvent.change(textarea, { target: { value: "/webhooks/\n/public" } });
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody?.auth?.bypassUrls).toEqual(["/webhooks/", "/public"]);
    });
  });

  it("shows restart-required message when port changes", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && options?.method === "PUT") {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, restartRequired: true }),
        });
      }
      if (url === "/api/config") {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: mockConfig }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/server");

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("HTTP Port"));

    const portInput = screen.getByDisplayValue("8000");
    fireEvent.change(portInput, { target: { value: "9000" } });
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(screen.getByText(/require.*restart/i)).toBeTruthy();
    });
  });

  it("includes modelProxy in the save payload when changed on the Providers page", async () => {
    const configWithModelProxy = {
      ...mockConfig,
      modelProxy: { enabled: true, defaultModel: "openai/gpt-4o" },
    };
    let savedBody: any;
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: configWithModelProxy }) });
      }
      if (url === "/api/providers") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      }
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/providers");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("default-model-input"));

    const input = screen.getByTestId("default-model-input");
    fireEvent.change(input, { target: { value: "anthropic/claude-3-5-sonnet" } });

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody).toBeTruthy();
      expect(savedBody.modelProxy.defaultModel).toBe("anthropic/claude-3-5-sonnet");
      expect(savedBody.modelProxy.enabled).toBe(true);
    });
  });

  it("does NOT include modelProxy in the save payload when unchanged", async () => {
    const configWithModelProxy = {
      ...mockConfig,
      modelProxy: { enabled: true },
    };
    let putCalled = false;
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && options?.method === "PUT") {
        putCalled = true;
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: configWithModelProxy }) });
      }
      if (url === "/api/providers") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });

    render(<SettingsPanel />);
    await waitFor(() => screen.getAllByTestId("save-btn"));

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(screen.getByText("No changes to save")).toBeTruthy();
    });
    expect(putCalled).toBe(false);
  });
});
