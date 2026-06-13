import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createEditorManager } from "../editor-manager.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";

const DEFAULT_CONFIG: EditorConfig = { idleTimeoutMinutes: 10, maxInstances: 3 };
const DETECTED: EditorDetectionResult = { available: true, binary: "/usr/local/bin/code-server" };

const CWD = "/tmp/project-under-test";

function settingsPathFor(home: string, cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return path.join(home, ".pi", "dashboard", "editors", hash, "User", "settings.json");
}

function readSettings(home: string, cwd: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPathFor(home, cwd), "utf-8"));
}

/**
 * setTheme(cwd, theme) writes <dataDir>/User/settings.json via the same
 * writeVscodeUserSettings() path that start(cwd) uses, so it is the public
 * surface for verifying the seeding contract without spawning a keeper.
 */
describe("editor settings seeding (writeVscodeUserSettings via setTheme)", () => {
  let home: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "pi-editor-settings-"));
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    rmSync(home, { recursive: true, force: true });
  });

  it("seeds all persistence keys on a fresh data dir", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    mgr.setTheme(CWD, "dark");

    const s = readSettings(home, CWD);
    expect(s["window.restoreWindows"]).toBe("all");
    expect(s["workbench.editor.restoreViewState"]).toBe(true);
    expect(s["files.hotExit"]).toBe("onExitAndWindowClose");
    expect(s["security.workspace.trust.enabled"]).toBe(false);
    expect(s["update.mode"]).toBe("none");
    expect(s["extensions.autoCheckUpdates"]).toBe(false);
    expect(s["workbench.startupEditor"]).toBe("none");
    // theme keys also present
    expect(s["workbench.colorTheme"]).toBe("Default Dark Modern");
  });

  it("preserves a user-set value and seeds absent keys", () => {
    const p = settingsPathFor(home, CWD);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ "security.workspace.trust.enabled": true }) + "\n");

    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    mgr.setTheme(CWD, "dark");

    const s = readSettings(home, CWD);
    // user value wins over the seeded default
    expect(s["security.workspace.trust.enabled"]).toBe(true);
    // absent keys still seeded
    expect(s["files.hotExit"]).toBe("onExitAndWindowClose");
    expect(s["window.restoreWindows"]).toBe("all");
  });

  it("setTheme(light) updates theme keys without stripping persistence keys", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    mgr.setTheme(CWD, "dark");
    mgr.setTheme(CWD, "light");

    const s = readSettings(home, CWD);
    expect(s["workbench.colorTheme"]).toBe("Default Light Modern");
    // persistence keys survive the theme update
    expect(s["files.hotExit"]).toBe("onExitAndWindowClose");
    expect(s["security.workspace.trust.enabled"]).toBe(false);
    expect(s["workbench.startupEditor"]).toBe("none");
  });
});
