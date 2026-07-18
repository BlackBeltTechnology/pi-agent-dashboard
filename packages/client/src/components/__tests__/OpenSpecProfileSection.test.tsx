/**
 * Tests for OpenSpecProfileSection — change: add-openspec-profile-settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const api = {
  saveOpenSpecConfig: vi.fn<(...a: any[]) => Promise<void>>(async () => {}),
  runOpenSpecUpdate: vi.fn<(...a: any[]) => Promise<any[]>>(async () => []),
  fetchUpdateStatus: vi.fn<(...a: any[]) => Promise<any[]>>(async () => [
    { cwd: "/proj/stale", status: "needs-update" },
    { cwd: "/proj/fresh", status: "up-to-date" },
  ]),
  // Default: global config is core. Individual tests override before render.
  fetchGlobalOpenSpecConfig: vi.fn<(...a: any[]) => Promise<any>>(async () => ({
    profile: "core", delivery: "both",
    workflows: ["propose", "explore", "apply", "archive"],
  })),
};

vi.mock("../../lib/openspec/openspec-config-api.js", () => ({
  saveOpenSpecConfig: (...a: any[]) => api.saveOpenSpecConfig(...a),
  runOpenSpecUpdate: (...a: any[]) => api.runOpenSpecUpdate(...a),
  fetchUpdateStatus: (...a: any[]) => api.fetchUpdateStatus(...a),
  fetchGlobalOpenSpecConfig: (...a: any[]) => api.fetchGlobalOpenSpecConfig(...a),
}));

import { OpenSpecProfileSection } from "../openspec/OpenSpecProfileSection.js";
import { SettingsDraftProvider, type RegisteredSource } from "@blackbelt-technology/dashboard-plugin-runtime";

// Renders the section inside a draft registry and returns the live source map
// so tests can assert dirtiness and drive the unified-Save commit().
function renderWithDraft(ui: React.ReactElement) {
  const sources = new Map<string, RegisteredSource>();
  const registry = {
    upsert: (id: string, s: RegisteredSource) => { sources.set(id, s); },
    remove: (id: string) => { sources.delete(id); },
  };
  render(<SettingsDraftProvider registry={registry}>{ui}</SettingsDraftProvider>);
  return sources;
}

beforeEach(() => {
  api.saveOpenSpecConfig.mockClear();
  api.runOpenSpecUpdate.mockClear();
  api.fetchUpdateStatus.mockClear();
  api.fetchGlobalOpenSpecConfig.mockClear();
});
afterEach(cleanup);

describe("OpenSpecProfileSection", () => {
  it("shows a loading state with no profile pre-selected, then reflects the saved core profile", async () => {
    render(<OpenSpecProfileSection />);
    // Before the config resolves: loading shown, no radio authoritatively selected.
    expect(screen.getByTestId("profile-loading")).toBeTruthy();
    expect(screen.getByTestId("profile-option-core").dataset.selected).toBe("false");
    // After resolve (default mock = core), the core radio reflects the saved value.
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-core").dataset.selected).toBe("true"),
    );
    expect(screen.getByTestId("workflow-multiselect").className).toContain("pointer-events-none");
  });

  it("reflects the saved expanded profile after load", async () => {
    api.fetchGlobalOpenSpecConfig.mockResolvedValueOnce({
      profile: "expanded", delivery: "both",
      workflows: ["propose", "explore", "new", "continue", "ff", "apply", "verify", "sync", "archive", "bulk-archive", "onboard"],
    });
    render(<OpenSpecProfileSection />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-expanded").dataset.selected).toBe("true"),
    );
    expect(screen.getByTestId("wf-chip-verify").dataset.on).toBe("true");
  });

  it("retries a transient failure, then shows the saved profile", async () => {
    api.fetchGlobalOpenSpecConfig
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce({
        profile: "expanded", delivery: "both",
        workflows: ["propose", "explore", "new", "continue", "ff", "apply", "verify", "sync", "archive", "bulk-archive", "onboard"],
      });
    render(<OpenSpecProfileSection />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-expanded").dataset.selected).toBe("true"),
    );
    // First attempt failed, retry succeeded.
    expect(api.fetchGlobalOpenSpecConfig).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("profile-error")).toBeNull();
  });

  it("surfaces an error (never a hardcoded core) when the load keeps failing", async () => {
    api.fetchGlobalOpenSpecConfig.mockRejectedValue(new Error("HTTP 503"));
    render(<OpenSpecProfileSection />);
    await waitFor(() => expect(screen.getByTestId("profile-error")).toBeTruthy());
    // No profile is presented as the saved value after a persistent failure.
    expect(screen.getByTestId("profile-option-core").dataset.selected).toBe("false");
    expect(screen.getByTestId("profile-option-expanded").dataset.selected).toBe("false");
    expect(screen.getByTestId("profile-option-custom").dataset.selected).toBe("false");
    expect(screen.getByTestId("profile-load-retry")).toBeTruthy();
  });

  it("initializes from the current global config (custom) on mount", async () => {
    api.fetchGlobalOpenSpecConfig.mockResolvedValueOnce({
      profile: "custom", delivery: "both",
      workflows: ["propose", "apply"],
    });
    render(<OpenSpecProfileSection />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-custom").dataset.selected).toBe("true"),
    );
    // Reflects fetched workflows: propose+apply on, others off.
    expect(screen.getByTestId("wf-chip-propose").dataset.on).toBe("true");
    expect(screen.getByTestId("wf-chip-apply").dataset.on).toBe("true");
    expect(screen.getByTestId("wf-chip-explore").dataset.on).toBe("false");
  });

  it("selecting Custom enables the multiselect", () => {
    render(<OpenSpecProfileSection />);
    fireEvent.click(screen.getByTestId("profile-option-custom"));
    expect(screen.getByTestId("workflow-multiselect").className).not.toContain("pointer-events-none");
  });

  it("buffers the selected profile and the unified Save commit() posts it", async () => {
    api.fetchGlobalOpenSpecConfig.mockResolvedValue({
      profile: "core", delivery: "both",
      workflows: ["propose", "explore", "apply", "archive"],
    });
    const sources = renderWithDraft(<OpenSpecProfileSection />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-core").dataset.selected).toBe("true"),
    );
    fireEvent.click(screen.getByTestId("profile-option-expanded"));
    // Selecting a profile must NOT autosave — it buffers into the draft.
    expect(api.saveOpenSpecConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(sources.get("openspec-profile")?.isDirty).toBe(true));
    await sources.get("openspec-profile")!.commit();
    const [profile, workflows] = api.saveOpenSpecConfig.mock.calls[0];
    expect(profile).toBe("expanded");
    expect(workflows).toContain("verify");
    expect(workflows).toHaveLength(11);
  });

  it("custom toggling chips buffers and commit() posts the changed set", async () => {
    api.fetchGlobalOpenSpecConfig.mockResolvedValue({
      profile: "core", delivery: "both",
      workflows: ["propose", "explore", "apply", "archive"],
    });
    const sources = renderWithDraft(<OpenSpecProfileSection />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-option-core").dataset.selected).toBe("true"),
    );
    fireEvent.click(screen.getByTestId("profile-option-custom"));
    // core seed → toggle off 'apply', toggle on 'verify'
    fireEvent.click(screen.getByTestId("wf-chip-apply"));
    fireEvent.click(screen.getByTestId("wf-chip-verify"));
    expect(api.saveOpenSpecConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(sources.get("openspec-profile")?.isDirty).toBe(true));
    await sources.get("openspec-profile")!.commit();
    const [profile, workflows] = api.saveOpenSpecConfig.mock.calls[0];
    expect(profile).toBe("custom");
    expect(workflows).not.toContain("apply");
    expect(workflows).toContain("verify");
  });

  it("per-cwd list starts collapsed and expands on toggle", async () => {
    render(<OpenSpecProfileSection />);
    await waitFor(() => expect(api.fetchUpdateStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("cwd-list")).toBeNull();
    fireEvent.click(screen.getByTestId("collapse-toggle"));
    expect(screen.getByTestId("cwd-list")).toBeTruthy();
  });

  it("shows staleness badges and gates the per-cwd Update button", async () => {
    render(<OpenSpecProfileSection />);
    await waitFor(() => expect(api.fetchUpdateStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("collapse-toggle"));
    expect(screen.getByTestId("status-badge-/proj/stale").textContent).toContain("needs update");
    expect(screen.getByTestId("status-badge-/proj/fresh").textContent).toContain("up to date");
    // fresh project's Update button disabled; stale one enabled
    expect((screen.getByTestId("update-btn-/proj/fresh") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("update-btn-/proj/stale") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Update all triggers a bulk update", async () => {
    render(<OpenSpecProfileSection />);
    fireEvent.click(screen.getByTestId("update-all-btn"));
    await waitFor(() => expect(api.runOpenSpecUpdate).toHaveBeenCalledWith({ all: true }));
  });

  it("per-cwd Update posts that cwd", async () => {
    render(<OpenSpecProfileSection />);
    await waitFor(() => expect(api.fetchUpdateStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("collapse-toggle"));
    fireEvent.click(screen.getByTestId("update-btn-/proj/stale"));
    await waitFor(() => expect(api.runOpenSpecUpdate).toHaveBeenCalledWith({ cwd: "/proj/stale" }));
  });
});
