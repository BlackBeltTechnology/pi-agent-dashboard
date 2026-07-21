import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { SettingsPanel } from "../settings/SettingsPanel.js";

// Worktree auto-init preference is fetched/persisted through git-api, not
// /api/config. Mock those so the Sessions-tab toggle drives them.
// See change: auto-init-worktree-on-spawn.
const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});

// Dual-URL routing is exercised against real wouter + jsdom history (no mock)
// so route-param / ?tab= resolution and the replace-redirects run for real.
// See change: reorganize-settings-into-pages.
function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

// Mock model-proxy-api (called by ModelProxySection when proxy is enabled)
vi.mock("../../lib/api/model-proxy-api.js", () => ({
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
    // Safe defaults so the Sessions-tab WorktreeAutoInitToggle never throws
    // when other tests navigate there.
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
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

  // Back arrow returns to the launching route via onBack (App's goBack), not a
  // hardcoded navigate("/"). See change: fix-settings-back-to-launching-route.
  it("back arrow invokes onBack when not dirty", async () => {
    global.fetch = mockFetchConfig();
    const onBack = vi.fn();

    render(<SettingsPanel onBack={onBack} />);

    await waitFor(() => expect(screen.getByTitle("Back")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Back"));
    expect(onBack).toHaveBeenCalledOnce();
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
      expect(screen.getByText("Dev Build on Reload")).toBeTruthy();
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
    expect(screen.queryByText("Dev Build on Reload")).toBeNull();

    // Dev Build on Reload lives on Developer only; Memory Limits is gone there.
    gotoPage("Developer");
    await waitFor(() => screen.getByText("Dev Build on Reload"));
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

  it("hides the Save Bar (no Save button) when there are no changes", async () => {
    global.fetch = mockFetchConfig();

    render(<SettingsPanel />);

    await waitFor(() => screen.getByText("Interface"));

    // Dirty-gated friction: nothing to save → no bar, no Save button.
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
    expect(screen.queryByTestId("save-btn")).toBeNull();
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

  it("adds a preferred model via ModelSelector and persists modelProxy.preferredModels on Save", async () => {
    const configWithModelProxy = {
      ...mockConfig,
      modelProxy: { enabled: true },
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
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/providers");

    render(<SettingsPanel availableModels={[{ provider: "openai", id: "gpt-4o" }]} />);
    await waitFor(() => screen.getByTestId("preferred-models-editor"));

    // Open the "Add model" selector and pick the one available model.
    const editor = screen.getByTestId("preferred-models-editor");
    fireEvent.click(within(editor).getByTestId("model-selector-button"));
    fireEvent.click(within(editor).getByTestId("model-row"));

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody).toBeTruthy();
      expect(savedBody.modelProxy.preferredModels).toEqual(["openai/gpt-4o"]);
    });
  });

  it("adds a model alias and persists modelProxy.modelAliases on Save", async () => {
    const configWithModelProxy = {
      ...mockConfig,
      modelProxy: { enabled: true },
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
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/providers");

    render(<SettingsPanel availableModels={[{ provider: "anthropic", id: "claude-3-5-sonnet" }]} />);
    await waitFor(() => screen.getByTestId("model-aliases-editor"));

    const editor = screen.getByTestId("model-aliases-editor");
    fireEvent.click(within(editor).getByTestId("add-alias-button"));
    fireEvent.change(within(editor).getByTestId("alias-key-0"), { target: { value: "claude" } });
    // Pick the alias target from the ModelSelector.
    fireEvent.click(within(editor).getByTestId("model-selector-button"));
    fireEvent.click(within(editor).getByTestId("model-row"));

    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => {
      expect(savedBody).toBeTruthy();
      expect(savedBody.modelProxy.modelAliases).toEqual({ claude: "anthropic/claude-3-5-sonnet" });
    });
  });

  it("blank-name LLM provider blocks save with an error and stays dirty", async () => {
    // Regression: a provider row with an empty name must NOT be silently
    // dropped. The save fails with a visible error and the source stays dirty
    // (PUT /api/providers never fires). See change: fix-custom-provider-save-and-auth.
    let putProvidersCalled = false;
    global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
      }
      if (url === "/api/providers" && options?.method === "PUT") {
        putProvidersCalled = true;
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/providers") {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, providers: {} }) });
      }
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    setPath("/settings/providers");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByRole("button", { name: "Add Provider" }));

    // Add a provider, leave the Name blank but fill Base URL + API Key.
    fireEvent.click(screen.getByRole("button", { name: "Add Provider" }));
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), {
      target: { value: "https://proxy.example.com/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-... or $ENV_VAR_NAME"), {
      target: { value: "sk-real-123" },
    });

    // Save bar appears (the new row makes the source dirty).
    await waitFor(() => screen.getByTestId("save-btn"));
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    // Error surfaced; PUT never fired; row not dropped; source stays dirty.
    await waitFor(() => expect(screen.getByText(/Provider name is required/)).toBeTruthy());
    expect(putProvidersCalled).toBe(false);
    expect(screen.getByTestId("settings-save-bar")).toBeTruthy();
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
    await waitFor(() => screen.getByText("Interface"));

    // Nothing changed → no Save Bar appears and no PUT can fire.
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
    expect(putCalled).toBe(false);
  });

  it("buffers 'Initialize on worktree' and persists it only on Save", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/sessions");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Initialize on worktree"));

    const row = screen.getByText("Initialize on worktree").closest("div")!;
    fireEvent.click(within(row).getByRole("button"));

    // Buffered — not persisted on toggle.
    expect(setAutoInitWorktreePref).not.toHaveBeenCalled();

    // Save Bar appears; saving commits the buffered preference.
    await waitFor(() => screen.getByTestId("save-btn"));
    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => {
      expect(setAutoInitWorktreePref).toHaveBeenCalledWith(true);
    });
  });

  it("Save Bar appears on first edit and Discard reverts to baseline", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/server");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("HTTP Port"));
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("8000"), { target: { value: "9000" } });

    await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(screen.getByTestId("save-btn")).toBeTruthy();
    expect(screen.getByTestId("discard-btn")).toBeTruthy();

    fireEvent.click(screen.getByTestId("discard-btn"));
    await waitFor(() => expect(screen.queryByTestId("settings-save-bar")).toBeNull());
    expect(screen.getByDisplayValue("8000")).toBeTruthy();
  });

  it("shows a per-page dirty dot for the page with unsaved edits", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/server");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("HTTP Port"));
    expect(screen.queryByTestId("nav-dirty-server")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("8000"), { target: { value: "9000" } });
    await waitFor(() => screen.getByTestId("nav-dirty-server"));
  });

  it("prompts before leaving while dirty; Cancel keeps editing", async () => {
    global.fetch = mockFetchConfig();
    setPath("/settings/server");

    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("HTTP Port"));
    fireEvent.change(screen.getByDisplayValue("8000"), { target: { value: "9000" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));

    // Header Back is the first button in the header.
    const back = within(screen.getByTestId("settings-header")).getAllByRole("button")[0];
    fireEvent.click(back);

    await waitFor(() => screen.getByTestId("unsaved-changes-dialog"));
    fireEvent.click(screen.getByTestId("unsaved-cancel"));
    await waitFor(() => expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull());
    // Still dirty — edits preserved.
    expect(screen.getByTestId("settings-save-bar")).toBeTruthy();
  });
});

// Resources nav group (global-scope per-type card pages).
// See change: resources-card-tabs.
describe("SettingsPanel Resources group", () => {
  const piResourcesData = {
    local: { extensions: [], skills: [], prompts: [], agents: [] },
    global: {
      extensions: [],
      skills: [{ name: "a11y", description: "Accessibility.", filePath: "/g/.pi/agent/skills/a11y.md", type: "skill", enabled: true }],
      prompts: [],
      agents: [{ name: "doc-writer", description: "Docs.", filePath: "/g/.pi/agent/agents/doc-writer.md", type: "agent", enabled: true, model: "haiku", tools: "write" }],
    },
    packages: [],
  };

  function mockFetchWithResources() {
    return vi.fn().mockImplementation((url: string, options?: any) => {
      if (url.startsWith("/api/pi-resources")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: piResourcesData }) });
      }
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    setPath("/settings/general");
  });
  afterEach(() => cleanup());

  it("lists a Resources group with the five per-type pages", async () => {
    global.fetch = mockFetchWithResources();
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("settings-nav-rail"));
    const rail = screen.getByTestId("settings-nav-rail");
    expect(rail.textContent).toContain("Resources");
    for (const label of ["Skills", "Agents", "Extensions", "Prompts", "Themes"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("renders global agent cards with no scope filter and a global pill", async () => {
    global.fetch = mockFetchWithResources();
    setPath("/settings/agents");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("resource-card-grid"));
    expect(screen.getByTestId("resource-card-grid").getAttribute("data-type")).toBe("agent");
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("doc-writer");
    expect(screen.queryByTestId("resource-scope-filter")).toBeNull();
    expect(screen.getByTestId("resource-global-pill")).toBeTruthy();
  });

  it("falls back to general for an unknown page id (registry gate)", async () => {
    global.fetch = mockFetchWithResources();
    setPath("/settings/bogus-xyz");
    render(<SettingsPanel />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/general");
      expect(screen.getByText("Interface")).toBeTruthy();
    });
  });
});

// Listen-interface picker (Server page). See change: configurable-bind-host.
describe("SettingsPanel listen-interface picker", () => {
  const NIC = { name: "en0", address: "10.0.0.5", netmask: "255.255.255.0", cidr: "10.0.0.0/24" };

  function mockFetchWithInterfaces(configOverrides?: any) {
    const cfg = {
      port: 8000, piPort: 9999, autoStart: true, autoShutdown: false,
      shutdownIdleSeconds: 300, spawnStrategy: "headless", tunnel: { enabled: true },
      devBuildOnReload: false,
      memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
      ...configOverrides,
    };
    return vi.fn().mockImplementation((url: string, options?: any) => {
      if (url === "/api/network-interfaces") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: [NIC] }) });
      }
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: cfg }) });
      }
      if (url === "/api/config" && options?.method === "PUT") {
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    setPath("/settings/server");
  });

  afterEach(() => cleanup());

  it("renders the three listen options and no warning by default (loopback)", async () => {
    global.fetch = mockFetchWithInterfaces();
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("listen-interface-field"));

    const field = screen.getByTestId("listen-interface-field");
    expect(within(field).getByText("Local only")).toBeTruthy();
    expect(within(field).getByText("All interfaces")).toBeTruthy();
    expect(within(field).getByText("Specific interface")).toBeTruthy();
    expect(screen.queryByTestId("listen-exposure-warning")).toBeNull();
  });

  it("shows the exposure warning when All interfaces is selected without guard config", async () => {
    global.fetch = mockFetchWithInterfaces();
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("listen-interface-field"));

    const field = screen.getByTestId("listen-interface-field");
    fireEvent.click(within(field).getByText("All interfaces").closest("label")!.querySelector("input")!);
    await waitFor(() => expect(screen.getByTestId("listen-exposure-warning")).toBeTruthy());
  });

  it("suppresses the exposure warning when trusted networks are configured", async () => {
    global.fetch = mockFetchWithInterfaces({ trustedNetworks: ["10.0.0.0/24"] });
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("listen-interface-field"));

    const field = screen.getByTestId("listen-interface-field");
    fireEvent.click(within(field).getByText("All interfaces").closest("label")!.querySelector("input")!);
    // Mode flips to all, but guard config suppresses the warning.
    expect(screen.queryByTestId("listen-exposure-warning")).toBeNull();
  });

  it("exposes the detected NIC under Specific interface", async () => {
    global.fetch = mockFetchWithInterfaces();
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("listen-interface-field"));

    const field = screen.getByTestId("listen-interface-field");
    const specificRadio = within(field).getByText("Specific interface").closest("label")!.querySelector("input")! as HTMLInputElement;
    // Radio is disabled until GET /api/network-interfaces resolves.
    await waitFor(() => expect(specificRadio.disabled).toBe(false));
    fireEvent.click(specificRadio);
    await waitFor(() => screen.getByTestId("listen-interface-select"));
    const select = screen.getByTestId("listen-interface-select") as HTMLSelectElement;
    expect(within(select).getByText("en0 — 10.0.0.5")).toBeTruthy();
  });
});
