/**
 * Persists BrowserWindow size and position across restarts.
 * Stores in ~/.pi/dashboard/window-state.json (config dir, NOT the
 * legacy managed-install dir which is described in legacy-managed-dir.ts).
 *
 * Migrated from the legacy managed dir under change:
 * eliminate-electron-runtime-install — the immutable-bundle
 * architecture forbids Electron-side writes into that directory.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";

const STATE_FILE = path.join(os.homedir(), ".pi", "dashboard", "window-state.json");

/** One-shot migration: if a window-state.json exists at the legacy path
 * but not the new one, move it. Failure is silent (the file is non-critical). */
function migrateLegacyStateFile(): void {
  try {
    if (existsSync(STATE_FILE)) return;
    const legacy = path.join(os.homedir(), ".pi" + "-dashboard", "window-state.json");
    if (!existsSync(legacy)) return;
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    renameSync(legacy, STATE_FILE);
  } catch {
    /* non-critical — next save will write fresh state */
  }
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const DEFAULTS: WindowState = { width: 1280, height: 800 };

export function loadWindowState(): WindowState {
  migrateLegacyStateFile();
  try {
    if (!existsSync(STATE_FILE)) return { ...DEFAULTS };
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    const state: WindowState = {
      x: typeof data.x === "number" ? data.x : undefined,
      y: typeof data.y === "number" ? data.y : undefined,
      width: typeof data.width === "number" ? data.width : DEFAULTS.width,
      height: typeof data.height === "number" ? data.height : DEFAULTS.height,
      isMaximized: data.isMaximized === true,
    };
    // Clamp to visible displays — if the saved coords land off-screen (e.g. user
    // moved the install to a different machine / monitor layout), the window
    // would open invisible. Drop the position to fall back to centered default.
    if (state.x !== undefined && state.y !== undefined && !isPointOnAnyDisplay(state.x, state.y, state.width, state.height)) {
      state.x = undefined;
      state.y = undefined;
    }
    return state;
  } catch {
    return { ...DEFAULTS };
  }
}

/** Return true iff at least 50px wide x 50px tall of the window rect is visible on any display. */
function isPointOnAnyDisplay(x: number, y: number, w: number, h: number): boolean {
  try {
    const displays = screen.getAllDisplays();
    for (const d of displays) {
      const b = d.workArea;
      const ix = Math.max(x, b.x);
      const iy = Math.max(y, b.y);
      const iw = Math.min(x + w, b.x + b.width) - ix;
      const ih = Math.min(y + h, b.y + b.height) - iy;
      if (iw >= 50 && ih >= 50) return true;
    }
    return false;
  } catch {
    // screen API unavailable (very early in app lifecycle) — assume on-screen.
    return true;
  }
}

export function saveWindowState(win: BrowserWindow): void {
  const isMaximized = win.isMaximized();
  const bounds: Rectangle = isMaximized ? (loadWindowState() as Rectangle) : win.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}
