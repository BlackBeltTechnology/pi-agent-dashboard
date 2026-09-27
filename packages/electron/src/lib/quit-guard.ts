/**
 * Route EVERY quit (App menu Quit / Cmd+Q / Dock Quit — all `app.quit()`)
 * through the app's full quit (stop server, destroy tray, exit).
 *
 * Without it, `role:"quit"` fires `app.quit()`, the macOS close-to-tray
 * `close` handler (which only lets the window close when `isQuitting`)
 * cancels the window close, and the app keeps running — reachable only via
 * the tray. Intercepts only while no full quit is in progress; once
 * `isQuitting()` is true (set by the full quit / quitAndInstall) `app.quit()`
 * proceeds, so there is no loop.
 */
interface BeforeQuitEvent {
  preventDefault(): void;
}

interface AppLike {
  on(event: "before-quit", listener: (event: BeforeQuitEvent) => void): unknown;
}

export function installQuitGuard(app: AppLike, opts: { isQuitting: () => boolean; requestQuit: () => void }): void {
  let requested = false;
  app.on("before-quit", (event) => {
    if (opts.isQuitting()) return;
    event.preventDefault();
    if (requested) return; // full quit already stopping the server
    requested = true;
    opts.requestQuit();
  });
}
