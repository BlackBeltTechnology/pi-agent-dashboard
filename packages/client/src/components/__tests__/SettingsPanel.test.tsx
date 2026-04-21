import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SettingsPanel } from "../SettingsPanel.js";

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
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

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should load and display config on mount with General tab active", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeTruthy();
      // Tab bar should be visible
      expect(screen.getByText("General")).toBeTruthy();
      expect(screen.getByText("Providers")).toBeTruthy();
      expect(screen.getByText("Security")).toBeTruthy();
      expect(screen.getByText("Advanced")).toBeTruthy();
      // General tab content should be visible by default
      expect(screen.getByText("Server")).toBeTruthy();
      expect(screen.getByText("Sessions")).toBeTruthy();
      expect(screen.getByText("Tunnel")).toBeTruthy();
      expect(screen.getByText("Developer")).toBeTruthy();
    });
  });

  it("should have fixed header and tab bar outside scroll container", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Settings"));

    const header = screen.getByTestId("settings-header");
    const tabBar = screen.getByTestId("settings-tab-bar");
    const content = screen.getByTestId("settings-content");

    // Header and tab bar should NOT be inside the scrollable content
    expect(content.contains(header)).toBe(false);
    expect(content.contains(tabBar)).toBe(false);
  });

  it("should switch visible content when clicking tabs", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Server"));

    // General tab content visible by default
    expect(screen.getByText("Server")).toBeTruthy();
    expect(screen.queryByText("Memory Limits")).toBeNull();

    // Click Advanced tab
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByText("Memory Limits")).toBeTruthy();
    expect(screen.queryByText("Server")).toBeNull();

    // Click Security tab
    fireEvent.click(screen.getByText("Security"));
    expect(screen.getByText("Authentication")).toBeTruthy();
    expect(screen.queryByText("Memory Limits")).toBeNull();

    // Click back to General
    fireEvent.click(screen.getByText("General"));
    expect(screen.getByText("Server")).toBeTruthy();
  });

  it("should show pointer cursor on settings tabs", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Settings"));

    expect(screen.getByRole("button", { name: "General" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("button", { name: "Servers" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("button", { name: "Packages" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("button", { name: "Providers" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("button", { name: "Security" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("button", { name: "Advanced" }).className).toContain("cursor-pointer");
  });

  it("should show loading state initially", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<SettingsPanel />);
    expect(screen.getByText("Loading settings...")).toBeTruthy();
  });

  it("should save changes from multiple tabs in single operation", async () => {
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
    await waitFor(() => screen.getByText("Server"));

    // Change port on General tab
    const portInput = screen.getAllByDisplayValue("8000")[0];
    fireEvent.change(portInput, { target: { value: "9000" } });

    // Switch to Advanced tab and change memory limit
    fireEvent.click(screen.getByText("Advanced"));
    await waitFor(() => screen.getByText("Memory Limits"));
    const maxEventsInput = screen.getByDisplayValue("200");
    fireEvent.change(maxEventsInput, { target: { value: "500" } });

    // Save
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody).toBeTruthy();
      expect(savedBody.port).toBe(9000);
      expect(savedBody.memoryLimits?.maxEventsPerSession).toBe(500);
    });
  });

  it("should show 'No changes' when saving without modifications", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getAllByTestId("save-btn"));

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(screen.getByText("No changes to save")).toBeTruthy();
    });
  });

  it("should display bypass URLs from auth config on Security tab", async () => {
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

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Security"));
    fireEvent.click(screen.getByText("Security"));

    await waitFor(() => screen.getByTestId("bypass-urls-textarea"));

    const textarea = screen.getByTestId("bypass-urls-textarea");
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("/webhooks/\n/metrics");
  });

  it("should include bypassUrls in save payload when changed on Security tab", async () => {
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

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Security"));
    fireEvent.click(screen.getByText("Security"));

    await waitFor(() => screen.getByTestId("bypass-urls-textarea"));

    const textarea = screen.getByTestId("bypass-urls-textarea");
    fireEvent.change(textarea, { target: { value: "/webhooks/\n/public" } });
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody?.auth?.bypassUrls).toEqual(["/webhooks/", "/public"]);
    });
  });

  it("should show restart required message when port changes", async () => {
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

    render(<SettingsPanel />);

    await waitFor(() => screen.getAllByTestId("save-btn"));

    // Change port (first input with value 8000)
    const portInput = screen.getAllByDisplayValue("8000")[0];
    fireEvent.change(portInput, { target: { value: "9000" } });
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(screen.getByText(/require.*restart/i)).toBeTruthy();
    });
  });
});
