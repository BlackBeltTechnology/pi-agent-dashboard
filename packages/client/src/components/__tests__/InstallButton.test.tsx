import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { InstallButton } from "../packages/InstallButton.js";

afterEach(cleanup);

describe("InstallButton", () => {
  it("renders when canInstall is true", () => {
    render(<InstallButton canInstall prompt={vi.fn()} />);
    expect(screen.getByTestId("install-btn")).toBeTruthy();
  });

  it("does not render when canInstall is false", () => {
    render(<InstallButton canInstall={false} prompt={vi.fn()} />);
    expect(screen.queryByTestId("install-btn")).toBeNull();
  });

  it("does not render when isInstalled is true", () => {
    render(<InstallButton canInstall isInstalled prompt={vi.fn()} />);
    expect(screen.queryByTestId("install-btn")).toBeNull();
  });

  it("calls prompt on click", () => {
    const prompt = vi.fn();
    render(<InstallButton canInstall prompt={prompt} />);
    fireEvent.click(screen.getByTestId("install-btn"));
    expect(prompt).toHaveBeenCalledOnce();
  });
});
