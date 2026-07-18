import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZrokInstallGuide } from "../packages/ZrokInstallGuide.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: "unavailable", serverOs: "darwin" }),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ZrokInstallGuide", () => {
  it("should render the guide with back button", () => {
    render(<ZrokInstallGuide onBack={vi.fn()} />);
    expect(screen.getByTestId("tunnel-guide-back")).toBeDefined();
    expect(screen.getByText(/Gateway Setup/)).toBeDefined();
  });

  it("should call onBack when back button clicked", () => {
    const onBack = vi.fn();
    render(<ZrokInstallGuide onBack={onBack} />);
    fireEvent.click(screen.getByTestId("tunnel-guide-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("should show a link to official docs", () => {
    render(<ZrokInstallGuide onBack={vi.fn()} />);
    expect(screen.getByText("Official zrok documentation")).toBeDefined();
  });
});

// support-zrok-v2 (E18): install-guide copy routes per serverOs.
describe("ZrokInstallGuide OS routing (E18)", () => {
  function renderForOs(serverOs: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "unavailable", serverOs }) }),
    );
    return render(<ZrokInstallGuide onBack={vi.fn()} />);
  }

  it("darwin → brew install zrok", async () => {
    renderForOs("darwin");
    expect(await screen.findByText(/brew install zrok/)).toBeDefined();
  });

  it("linux → openziti package-repo install script", async () => {
    renderForOs("linux");
    expect((await screen.findAllByText(/get\.openziti\.io\/install\.bash/)).length).toBeGreaterThan(0);
  });

  it("win32 → references the zrok2 binary on PATH", async () => {
    renderForOs("win32");
    expect(await screen.findByText(/zrok2 version/)).toBeDefined();
  });

  it("unknown OS → falls back to Linux instructions + a docs note", async () => {
    renderForOs("freebsd");
    expect((await screen.findAllByText(/get\.openziti\.io\/install\.bash/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/was not recognized/i)).toBeDefined();
  });
});
