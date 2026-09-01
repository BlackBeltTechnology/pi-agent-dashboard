/**
 * E5 + X14 — the async `quit()` / `main()` promises have a named rejection owner.
 *
 * Two production shapes in main.ts:
 *   - E5: `function requestQuit()` wraps the async `quit()` as
 *         `void quit().catch((err) => { log(...); app.quit(); })` and is passed
 *         as `createTray`'s `onQuit: () => void` at four sites plus the
 *         `window-all-closed` handler. The `app.quit()` in the catch is
 *         load-bearing: `quit()` only reaches its own `destroyTray()/app.quit()`
 *         tail AFTER `await stopServerIfNeeded()`, so a rejection there would
 *         otherwise strand the app running with no way to exit.
 *   - X14: the bootstrap `main().catch(async (err) => { ...; app.quit(); })`
 *         owns a `main()` rejection so startup failure cannot float.
 *
 * main.ts self-executes `main()` and registers `app.on(...)` listeners at import
 * time, so it cannot be imported into a unit test without booting the whole
 * Electron bootstrap. This suite therefore has two complementary layers:
 *   1. Runtime: reconstruct the EXACT wrapper / bootstrap-catch shape with
 *      injected deps and prove the rejection is observed (logged + `app.quit()`
 *      called) and nothing floats. The tray Quit click is exercised through the
 *      real, exported `buildTrayMenuTemplate` (the same builder `createTray`
 *      uses to wire `onQuit` onto the Quit menu item).
 *   2. Source guards: assert main.ts actually uses those shapes — passes
 *      `requestQuit` (never bare `quit`) at every seam, and the two catch
 *      bodies call `app.quit()`. Reverting the production fix (passing `quit`
 *      directly) turns these red.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #E5, #X14)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildTrayMenuTemplate } from "../lib/tray.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.resolve(__dirname, "../main.ts"), "utf-8");

/** Two macrotask ticks: enough for the microtask `.catch` to run AND for the
 * runtime to have flagged any still-unhandled rejection. Not a sleep. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

/** Run `fn`, capturing any process-level unhandled rejection it produces. */
async function withUnhandledCapture(fn: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    fn();
    await flush();
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
  return seen;
}

/**
 * Faithful reconstruction of main.ts `requestQuit`: the exact
 * `void quit().catch((err) => { log(...); app.quit(); })` shape, with the three
 * production deps injected so we can observe them.
 */
function makeRequestQuit(deps: {
  quit: () => Promise<void>;
  log: (msg: string) => void;
  appQuit: () => void;
}): () => void {
  return () => {
    void deps.quit().catch((err: unknown) => {
      deps.log(`quit failed: ${err instanceof Error ? err.message : String(err)}`);
      deps.appQuit();
    });
  };
}

// ── E5: runtime — tray Quit click, quit() rejects ───────────────────────────
describe("E5: a rejecting quit() reaches the requestQuit owner (logged + app.quit)", () => {
  it("clicking the tray Quit item routes the rejection to the handler and calls app.quit", async () => {
    const log = vi.fn();
    const appQuit = vi.fn();
    const quit = vi.fn(() => Promise.reject(new Error("stopServerIfNeeded blew up")));
    const requestQuit = makeRequestQuit({ quit, log, appQuit });

    // Build the real tray menu template with our wrapper as onQuit; the Quit
    // item's click handler IS onQuit (see buildTrayMenuTemplate).
    const template = buildTrayMenuTemplate({
      ownership: "none",
      onLaunch: () => {},
      onShow: () => {},
      onQuit: requestQuit,
    });
    const quitItem = template.find((i) => i.label === "Quit");
    expect(quitItem?.click).toBeTypeOf("function");

    const unhandled = await withUnhandledCapture(() => {
      (quitItem!.click as () => void)();
    });

    // quit() was invoked, its rejection was observed by the wrapper...
    expect(quit).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/quit failed: stopServerIfNeeded blew up/);
    // ...and the load-bearing fallback still exits the app.
    expect(appQuit).toHaveBeenCalledTimes(1);
    // Nothing floated as an unhandled rejection.
    expect(unhandled).toHaveLength(0);
  });

  it("control: passing bare quit() (the reverted shape) floats and never calls app.quit", async () => {
    // Demonstrates the teeth of the wrapper: without it, the rejection escapes
    // and the app is never told to quit. We attach our own catch ONLY to keep
    // the test process clean while still proving app.quit is not reached.
    const appQuit = vi.fn();
    const quit = vi.fn(() => Promise.reject(new Error("boom")));

    const template = buildTrayMenuTemplate({
      ownership: "none",
      onLaunch: () => {},
      onShow: () => {},
      // Reverted wiring: quit passed directly as the () => void onQuit.
      onQuit: quit as unknown as () => void,
    });
    const quitItem = template.find((i) => i.label === "Quit");

    let floated: unknown;
    // Wrap the click so the floating rejection is captured here, not by Node.
    const p = (quitItem!.click as () => Promise<void>)();
    await (p as Promise<void>).catch((e) => {
      floated = e;
    });

    expect(quit).toHaveBeenCalledTimes(1);
    expect(appQuit).not.toHaveBeenCalled(); // no fallback exit in the reverted shape
    expect(floated).toBeInstanceOf(Error); // the rejection escaped the click
  });
});

// ── X14: runtime — main() rejects, bootstrap catch owns it ──────────────────
describe("X14: a rejecting main() is owned by the bootstrap catch (no float)", () => {
  it("the main().catch(...) shape observes the rejection and calls app.quit", async () => {
    const log = vi.fn();
    const appQuit = vi.fn();
    const main = vi.fn(() => Promise.reject(new Error("startup exploded")));

    // Faithful reconstruction of the bottom-of-main.ts bootstrap handler.
    const unhandled = await withUnhandledCapture(() => {
      void main().catch((err: unknown) => {
        log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
        appQuit();
      });
    });

    expect(main).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/FATAL: startup exploded/);
    expect(appQuit).toHaveBeenCalledTimes(1);
    expect(unhandled).toHaveLength(0);
  });
});

// ── Source guards: main.ts must actually use these shapes ───────────────────
describe("E5/X14: main.ts wires the rejection owners at every seam (source guard)", () => {
  it("defines requestQuit as void quit().catch(...) with a load-bearing app.quit() fallback", () => {
    expect(mainSrc).toMatch(/function\s+requestQuit\s*\(\s*\)\s*:\s*void/);
    // The catch body owns the rejection and still exits the app.
    expect(mainSrc).toMatch(/void\s+quit\(\)\.catch\(/);
    const wrapper = mainSrc.slice(mainSrc.indexOf("function requestQuit"));
    expect(wrapper).toMatch(/\.catch\([\s\S]*?app\.quit\(\)/);
  });

  it("passes requestQuit (never bare quit) to every createTray call", () => {
    const createTrayCalls = [...mainSrc.matchAll(/createTray\(/g)];
    expect(createTrayCalls.length).toBe(4);
    // No createTray call may pass the async `quit` directly as its onQuit arg.
    expect(mainSrc).not.toMatch(/createTray\([^)]*,\s*quit\s*,/);
    // Every createTray call site names requestQuit as its second arg.
    const requestQuitArgs = [...mainSrc.matchAll(/createTray\([^,]+,\s*requestQuit\s*,/g)];
    expect(requestQuitArgs.length).toBe(4);
  });

  it("window-all-closed calls requestQuit(), not a floating quit()", () => {
    const handler = mainSrc.slice(mainSrc.indexOf('app.on("window-all-closed"'));
    expect(handler).toMatch(/requestQuit\(\)/);
    // No bare `quit();` floating call in the handler body.
    expect(handler.slice(0, 200)).not.toMatch(/[^t]\bquit\(\)\s*;/);
  });

  it("X14: the bootstrap main() rejection is caught (main().catch(...))", () => {
    expect(mainSrc).toMatch(/main\(\)\.catch\(/);
    const boot = mainSrc.slice(mainSrc.indexOf("main().catch("));
    expect(boot).toMatch(/app\.quit\(\)/);
  });
});
