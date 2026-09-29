/**
 * Every quit path (App menu Quit / Cmd+Q / Dock Quit) must run the full quit
 * (stop server, destroy tray, exit) — previously `role:"quit"` fired
 * `app.quit()`, the macOS close-to-tray handler cancelled the window close,
 * and the app kept running with an invisible tray icon.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installQuitGuard } from "../quit-guard.js";

function fakeApp() {
  const app = new EventEmitter();
  const quit = () => {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit("before-quit", e);
    return e.defaultPrevented;
  };
  return { app, quit };
}

describe("installQuitGuard", () => {
  it("an un-initiated quit (menu / Cmd+Q / Dock) is intercepted and routed to the full quit once", () => {
    const { app, quit } = fakeApp();
    const requestQuit = vi.fn();
    installQuitGuard(app, { isQuitting: () => false, requestQuit });
    expect(quit()).toBe(true);
    expect(requestQuit).toHaveBeenCalledTimes(1);
  });

  it("once the full quit is in progress, app.quit proceeds (no loop)", () => {
    const { app, quit } = fakeApp();
    const requestQuit = vi.fn();
    installQuitGuard(app, { isQuitting: () => true, requestQuit });
    expect(quit()).toBe(false);
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it("a second quit while the first is still stopping the server is swallowed, not duplicated", () => {
    const { app, quit } = fakeApp();
    const requestQuit = vi.fn();
    installQuitGuard(app, { isQuitting: () => false, requestQuit });
    quit();
    quit();
    expect(requestQuit).toHaveBeenCalledTimes(1);
  });
});
