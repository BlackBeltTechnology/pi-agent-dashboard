/**
 * Settings panel loads on demand: loading state → panel; import failure →
 * error state + retry that re-attempts the import. Each test starts from a
 * fresh module graph (the lazy component and its memo are module-level).
 * See change: shrink-client-entry-lazy-islands (task 4.1).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.doUnmock("../SettingsPanel.js");
  vi.restoreAllMocks();
});

const props: any = { onMessage: () => {}, onBack: () => {} };

describe("LazySettingsPanel", () => {
  it("shows the loading state, then the panel", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.doMock("../SettingsPanel.js", async () => {
      await gate;
      return { SettingsPanel: () => <div data-testid="real-panel">panel</div> };
    });
    const { LazySettingsPanel } = await import("../LazySettingsPanel.js");
    render(<LazySettingsPanel {...props} />);
    expect(screen.getByTestId("settings-loading")).toBeTruthy();
    expect(screen.queryByTestId("real-panel")).toBeNull();
    release();
    expect(await screen.findByTestId("real-panel")).toBeTruthy();
    expect(screen.queryByTestId("settings-loading")).toBeNull();
  });

  it("shows an error state with retry when the import fails, and recovers on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    vi.doMock("../SettingsPanel.js", () => {
      if (fail) throw new Error("chunk 404");
      return { SettingsPanel: () => <div data-testid="real-panel">panel</div> };
    });
    const { LazySettingsPanel } = await import("../LazySettingsPanel.js");
    render(<LazySettingsPanel {...props} />);
    expect(await screen.findByTestId("settings-load-error")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByTestId("real-panel")).toBeTruthy());
    expect(screen.queryByTestId("settings-load-error")).toBeNull();
  });

  it("does not refetch the module when mounted again in the same page", async () => {
    const factory = vi.fn(() => ({ SettingsPanel: () => <div data-testid="real-panel">panel</div> }));
    vi.doMock("../SettingsPanel.js", factory);
    const { LazySettingsPanel } = await import("../LazySettingsPanel.js");
    const first = render(<LazySettingsPanel {...props} />);
    await screen.findByTestId("real-panel");
    first.unmount();
    render(<LazySettingsPanel {...props} />);
    await screen.findByTestId("real-panel");
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
