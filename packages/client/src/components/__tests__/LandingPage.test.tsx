import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { LandingPage } from "../shell/LandingPage.js";

function TestRouter({ children, path = "/" }: { children: React.ReactNode; path?: string }) {
  const { hook } = memoryLocation({ path, static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

function renderPage(props: Partial<React.ComponentProps<typeof LandingPage>> = {}) {
  const navigate = vi.fn();
  const onOpenPinDialog = vi.fn();
  const onSpawnSession = vi.fn();
  const defaults: React.ComponentProps<typeof LandingPage> = {
    providersReady: false,
    pinnedCount: 0,
    sessionsCount: 0,
    firstPinnedCwd: null,
    onOpenPinDialog,
    onSpawnSession,
    navigate,
  };
  const merged = { ...defaults, ...props };
  render(
    <TestRouter>
      <LandingPage {...merged} />
    </TestRouter>,
  );
  return { navigate: merged.navigate, onOpenPinDialog: merged.onOpenPinDialog, onSpawnSession: merged.onSpawnSession };
}

describe("LandingPage onboarding", () => {
  describe("Step 1: credentials", () => {
    it("pending state shows CTA that navigates to /settings/providers", () => {
      const { navigate } = renderPage({ providersReady: false });
      const btn = screen.getByTestId("onboarding-step-1-cta");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      expect(navigate).toHaveBeenCalledWith("/settings/providers");
    });

    it("done state collapses to checkmark row", () => {
      renderPage({ providersReady: true });
      expect(screen.getByTestId("onboarding-step-1-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
    });
  });

  describe("Step 2: add folder", () => {
    it("locked when providersReady=false", () => {
      renderPage({ providersReady: false, pinnedCount: 0 });
      const btn = screen.getByTestId("onboarding-step-2-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("title")).toMatch(/credential/i);
    });

    it("pending when providersReady && pinnedCount===0; CTA calls onOpenPinDialog", () => {
      const { onOpenPinDialog } = renderPage({ providersReady: true, pinnedCount: 0 });
      const btn = screen.getByTestId("onboarding-step-2-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(onOpenPinDialog).toHaveBeenCalledTimes(1);
    });

    it("done state when pinnedCount>0", () => {
      renderPage({ providersReady: true, pinnedCount: 2 });
      expect(screen.getByTestId("onboarding-step-2-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-2-cta")).toBeNull();
    });
  });

  describe("Step 3: start session", () => {
    it("locked when no folder pinned", () => {
      renderPage({ providersReady: true, pinnedCount: 0, firstPinnedCwd: null });
      const btn = screen.getByTestId("onboarding-step-3-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("title")).toMatch(/folder/i);
    });

    it("pending when pinnedCount>0 && sessionsCount===0; CTA calls onSpawnSession(firstPinnedCwd)", () => {
      const { onSpawnSession } = renderPage({
        providersReady: true,
        pinnedCount: 1,
        sessionsCount: 0,
        firstPinnedCwd: "/home/user/repo",
      });
      const btn = screen.getByTestId("onboarding-step-3-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(onSpawnSession).toHaveBeenCalledWith("/home/user/repo");
    });

    it("done state when sessionsCount>0", () => {
      renderPage({ providersReady: true, pinnedCount: 1, firstPinnedCwd: "/x", sessionsCount: 3 });
      expect(screen.getByTestId("onboarding-step-3-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-3-cta")).toBeNull();
    });
  });

  it("renders all three done rows and no CTAs when fully configured", () => {
    renderPage({
      providersReady: true,
      pinnedCount: 3,
      sessionsCount: 2,
      firstPinnedCwd: "/x",
    });
    expect(screen.getByTestId("onboarding-step-1-done")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-2-done")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-3-done")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-2-cta")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-3-cta")).toBeNull();
  });

  it("renders pi glyph header", () => {
    renderPage();
    expect(screen.getByText("π")).toBeTruthy();
  });
});
