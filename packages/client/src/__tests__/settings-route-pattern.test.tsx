/**
 * The settings route grew a second optional segment (`/settings/:page?/:sub?`)
 * so `/settings/plugins/<id>` resolves instead of `replace`-bouncing to
 * General. Two consecutive optional segments must be verified against wouter's
 * compiled pattern rather than assumed — a one-line risk, a one-line test
 * (design D2).
 *
 * The folder-scoped settings route deliberately did NOT grow the segment:
 * plugin configuration is global, and `/folder/:cwd/settings/...` renders
 * `DirectorySettings`, a different component entirely.
 *
 * Covers test-plan rows E6, E7.
 * See change: plugin-settings-pages.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Router, useRoute } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const SETTINGS_PATTERN = "/settings/:page?/:sub?";

function matchAt(
  path: string,
  pattern: string,
): [boolean, Record<string, string | undefined> | null] {
  const { hook } = memoryLocation({ path });
  const { result } = renderHook(() => useRoute(pattern), {
    wrapper: ({ children }) => <Router hook={hook}>{children}</Router>,
  });
  const [match, params] = result.current;
  return [match, (params ?? null) as Record<string, string | undefined> | null];
}

const CLIENT_SRC = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);

describe("settings route pattern", () => {
  // Both route sites must carry the second segment. `SettingsPanel` owns the
  // interpretation, but `App` owns whether the URL matches AT ALL — widening
  // only the panel leaves a bookmarked plugin page falling through to the
  // dashboard root, with the settings view never mounted. (task 2.4)
  it("is widened at BOTH route sites, not just the panel", () => {
    for (const rel of ["App.tsx", "components/settings/SettingsPanel.tsx"]) {
      const src = fs.readFileSync(path.join(CLIENT_SRC, rel), "utf-8");
      expect(src, rel).toContain('useRoute("/settings/:page?/:sub?")');
      expect(src, rel).not.toContain('useRoute("/settings/:page?")');
    }
  });

  // (test-plan #E6)
  it("splits two consecutive optional segments unambiguously", () => {
    const [bareMatch, bareParams] = matchAt("/settings/plugins", SETTINGS_PATTERN);
    expect(bareMatch).toBe(true);
    expect(bareParams?.page).toBe("plugins");
    expect(bareParams?.sub).toBeUndefined();

    const [deepMatch, deepParams] = matchAt("/settings/plugins/roles", SETTINGS_PATTERN);
    expect(deepMatch).toBe(true);
    expect(deepParams?.page).toBe("plugins");
    expect(deepParams?.sub).toBe("roles");
  });

  it("still matches the bare and single-segment settings routes", () => {
    expect(matchAt("/settings", SETTINGS_PATTERN)[0]).toBe(true);
    expect(matchAt("/settings/general", SETTINGS_PATTERN)[1]?.page).toBe("general");
  });

  it("does not swallow a fourth segment", () => {
    expect(matchAt("/settings/plugins/roles/extra", SETTINGS_PATTERN)[0]).toBe(false);
  });

  // (test-plan #E7) — the folder-scoped route keeps ONE optional segment, so a
  // `plugins/flows` tail cannot resolve there.
  it("leaves the folder-scoped settings route at a single optional segment", () => {
    const folderPattern = "/folder/:encodedCwd/settings/:page?";
    const [match] = matchAt("/folder/L3RtcA/settings/plugins/flows", folderPattern);
    expect(match).toBe(false);

    // A bare `plugins` there falls through the existing invalid-page fallback,
    // because `plugins` is not in VALID_FOLDER_SETTINGS_PAGES.
    const [bareMatch, bareParams] = matchAt("/folder/L3RtcA/settings/plugins", folderPattern);
    expect(bareMatch).toBe(true);
    expect(bareParams?.page).toBe("plugins");
    // Read the real list out of App.tsx rather than restating it here: a local
    // copy would keep passing after App.tsx started accepting `plugins`.
    const app = fs.readFileSync(path.join(CLIENT_SRC, "App.tsx"), "utf-8");
    const decl = app.match(/const VALID_FOLDER_SETTINGS_PAGES = \[(.*?)\]/s);
    expect(decl, "VALID_FOLDER_SETTINGS_PAGES not found in App.tsx").toBeTruthy();
    expect(decl![1]).not.toContain('"plugins"');
    // And the folder route must still carry exactly one optional segment.
    expect(app).toContain('useRoute("/folder/:encodedCwd/settings/:page?")');
  });
});
