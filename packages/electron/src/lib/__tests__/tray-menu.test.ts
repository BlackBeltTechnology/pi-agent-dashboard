/**
 * Unit tests for the pure tray menu-template builder.
 * See change: electron-server-launch-controls (task 4.6).
 */
import { describe, it, expect, vi } from "vitest";
import { buildTrayMenuTemplate } from "../tray.js";

const noop = () => { /* no-op */ };

describe("buildTrayMenuTemplate", () => {
  it("includes 'Start server' when isRunning=false", () => {
    const t = buildTrayMenuTemplate({ isRunning: false, onLaunch: noop, onShow: noop, onQuit: noop });
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).toContain("Start server");
    expect(labels).not.toContain("Restart server");
  });

  it("includes 'Restart server' when isRunning=true", () => {
    const t = buildTrayMenuTemplate({ isRunning: true, onLaunch: noop, onShow: noop, onQuit: noop });
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).toContain("Restart server");
    expect(labels).not.toContain("Start server");
  });

  it("omits server-launch item when isRunning=null (status unknown)", () => {
    const t = buildTrayMenuTemplate({ isRunning: null, onLaunch: noop, onShow: noop, onQuit: noop });
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).not.toContain("Start server");
    expect(labels).not.toContain("Restart server");
    expect(labels).toEqual(["Show", "Quit"]);
  });

  it("Start server item invokes onLaunch with force=false", () => {
    const onLaunch = vi.fn();
    const t = buildTrayMenuTemplate({ isRunning: false, onLaunch, onShow: noop, onQuit: noop });
    const startItem = t.find((i) => i.label === "Start server");
    (startItem as any).click();
    expect(onLaunch).toHaveBeenCalledWith(false);
  });

  it("Restart server item invokes onLaunch with force=true", () => {
    const onLaunch = vi.fn();
    const t = buildTrayMenuTemplate({ isRunning: true, onLaunch, onShow: noop, onQuit: noop });
    const restartItem = t.find((i) => i.label === "Restart server");
    (restartItem as any).click();
    expect(onLaunch).toHaveBeenCalledWith(true);
  });

  it("always includes Show and Quit", () => {
    for (const isRunning of [true, false, null] as const) {
      const t = buildTrayMenuTemplate({ isRunning, onLaunch: noop, onShow: noop, onQuit: noop });
      const labels = t.map((i) => i.label).filter(Boolean);
      expect(labels).toContain("Show");
      expect(labels).toContain("Quit");
    }
  });
});
