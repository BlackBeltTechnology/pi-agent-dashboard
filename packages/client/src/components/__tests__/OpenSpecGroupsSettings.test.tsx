/**
 * Component tests for OpenSpec Groups settings section.
 * See change: add-openspec-change-grouping (task 10.4).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({
    schemaVersion: 1,
    groups: [{ id: "ui", name: "UI", color: "#3b82f6", order: 0 }],
    assignments: {},
  })),
  createGroup: vi.fn(async () => ({ id: "new", name: "New", order: 1 })),
  updateGroup: vi.fn(async () => ({})),
  deleteGroup: vi.fn(async () => {}),
}));

// Mock fetch for /api/sessions
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import { OpenSpecGroupsSettingsSection } from "../openspec/OpenSpecGroupsSettingsSection.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OpenSpecGroupsSettingsSection", () => {
  it("renders section with cwd list after loading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: [{ id: "s1", cwd: "/project/foo" }],
      }),
    });

    render(<OpenSpecGroupsSettingsSection />);
    expect(screen.getByText("Loading…")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/\/project\/foo/)).toBeTruthy();
    });
  });

  it("shows empty state when no sessions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    render(<OpenSpecGroupsSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText("No projects with active sessions.")).toBeTruthy();
    });
  });
});
