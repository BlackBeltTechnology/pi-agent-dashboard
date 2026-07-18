import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { InstallBanner } from "../packages/InstallBanner.js";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

describe("InstallBanner", () => {
  it("renders install button when canInstall is true", () => {
    render(<InstallBanner canInstall isIOS={false} isInstalled={false} prompt={vi.fn()} />);
    expect(screen.getByTestId("install-banner")).toBeTruthy();
    expect(screen.getByText("Install")).toBeTruthy();
  });

  it("renders iOS guidance when isIOS is true", () => {
    render(<InstallBanner canInstall={false} isIOS isInstalled={false} prompt={vi.fn()} />);
    expect(screen.getByTestId("install-banner")).toBeTruthy();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
  });

  it("does not render when isInstalled is true", () => {
    render(<InstallBanner canInstall isIOS={false} isInstalled prompt={vi.fn()} />);
    expect(screen.queryByTestId("install-banner")).toBeNull();
  });

  it("does not render when canInstall=false and isIOS=false", () => {
    render(<InstallBanner canInstall={false} isIOS={false} isInstalled={false} prompt={vi.fn()} />);
    expect(screen.queryByTestId("install-banner")).toBeNull();
  });

  it("calls prompt when install button is clicked", () => {
    const prompt = vi.fn();
    render(<InstallBanner canInstall isIOS={false} isInstalled={false} prompt={prompt} />);
    fireEvent.click(screen.getByText("Install"));
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("dismisses banner and persists to localStorage", () => {
    render(<InstallBanner canInstall isIOS={false} isInstalled={false} prompt={vi.fn()} />);
    expect(screen.getByTestId("install-banner")).toBeTruthy();
    fireEvent.click(screen.getByTestId("install-banner-dismiss"));
    expect(screen.queryByTestId("install-banner")).toBeNull();
    expect(localStorage.getItem("pwa-install-dismissed")).toBe("true");
  });

  it("does not render when previously dismissed", () => {
    localStorage.setItem("pwa-install-dismissed", "true");
    render(<InstallBanner canInstall isIOS={false} isInstalled={false} prompt={vi.fn()} />);
    expect(screen.queryByTestId("install-banner")).toBeNull();
  });
});
