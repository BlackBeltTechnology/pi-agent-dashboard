/**
 * Tests for FirstLaunchDisplayModal — preset PATCH on submit, default-to-
 * standard on dismiss. See change: configurable-chat-display.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FirstLaunchDisplayModal } from "../components/settings/FirstLaunchDisplayModal.js";
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

  it("PATCHes the chosen preset on Continue and closes with those prefs", async () => {
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
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(DISPLAY_PRESETS.simple));
  });

  it("refines onClose prefs from the PATCH 200 body when readable", async () => {
    const merged = { ...DISPLAY_PRESETS.simple, tokenStatsBar: true };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ displayPrefs: merged }) });
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(merged));
  });

  it("closes with the preset prefs even when the PATCH returns non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByDisplayValue("everything"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(DISPLAY_PRESETS.everything));
  });

  it("closes with the preset prefs even when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const onClose = vi.fn();
    render(<FirstLaunchDisplayModal apiBase="" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(DISPLAY_PRESETS.standard));
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
