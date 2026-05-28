/**
 * Tests for FirstLaunchDisplayModal — preset PATCH on submit, default-to-
 * standard on dismiss. See change: configurable-chat-display.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FirstLaunchDisplayModal } from "../components/FirstLaunchDisplayModal.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

describe("FirstLaunchDisplayModal", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
  });

  it("PATCHes the chosen preset on Continue", async () => {
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByDisplayValue("simple"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("/api/preferences/display");
    expect(call[1].method).toBe("PATCH");
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual(DISPLAY_PRESETS.simple);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("PATCHes standard on Skip dismissal", async () => {
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Skip/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual(DISPLAY_PRESETS.standard);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("PATCHes standard on Escape key", async () => {
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual(DISPLAY_PRESETS.standard);
  });

  it("PATCHes everything when chosen", async () => {
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByDisplayValue("everything"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual(DISPLAY_PRESETS.everything);
  });
});
