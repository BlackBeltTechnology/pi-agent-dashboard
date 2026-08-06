/**
 * The host — not the plugin — decides which settings page a draft source is
 * filed under. Left to plugins, half would mark `Plugins` and half `General`
 * (a page their settings no longer appear on), and a third-party plugin could
 * point its dirty dot anywhere it liked (design D5).
 *
 * The rewrite lives in `useSettingsDraftSource`, not in the registry: the
 * registry closure is created in `SettingsPanel` scope, ABOVE where the plugin
 * page mounts, so it cannot read a descendant's context.
 *
 * Covers test-plan rows E17, E18.
 * See change: plugin-settings-pages.
 */
import { render } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PluginSettingsPageProvider,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
  useSettingsDraftSource,
} from "../index.js";

function Source({ page }: { page?: string }) {
  useSettingsDraftSource({
    id: "plugin:roles",
    ...(page ? { page } : {}),
    isDirty: true,
    commit: async () => {},
    reset: () => {},
  });
  return null;
}

function harness(node: React.ReactNode) {
  const upsert = vi.fn<(id: string, s: RegisteredSource) => void>();
  const registry: SettingsDraftRegistry = { upsert, remove: vi.fn() };
  render(<SettingsDraftProvider registry={registry}>{node}</SettingsDraftProvider>);
  return upsert;
}

describe("useSettingsDraftSource page attribution", () => {
  // (test-plan #E17)
  it("overrides a plugin-declared page when rendered inside a plugin page", () => {
    const upsert = harness(
      <PluginSettingsPageProvider pluginId="roles">
        <Source page="general" />
      </PluginSettingsPageProvider>,
    );
    expect(upsert).toHaveBeenCalledWith(
      "plugin:roles",
      expect.objectContaining({ page: "plugins/roles" }),
    );
    // General must show no dirty dot on this source's behalf.
    expect(upsert).not.toHaveBeenCalledWith(
      "plugin:roles",
      expect.objectContaining({ page: "general" }),
    );
  });

  // (test-plan #E18)
  it("fills an omitted page with the owning plugin id", () => {
    const upsert = harness(
      <PluginSettingsPageProvider pluginId="flows">
        <Source />
      </PluginSettingsPageProvider>,
    );
    expect(upsert).toHaveBeenCalledWith(
      "plugin:roles",
      expect.objectContaining({ page: "plugins/flows" }),
    );
  });

  it("leaves a built-in source's own page untouched outside a plugin page", () => {
    const upsert = harness(<Source page="sessions" />);
    expect(upsert).toHaveBeenCalledWith(
      "plugin:roles",
      expect.objectContaining({ page: "sessions" }),
    );
  });

  // `page` became optional so plugins can omit it (design D5). Outside a plugin
  // page there is no host to supply one, so the source falls back to `general`
  // rather than filing under `undefined`. Every built-in passes `page`
  // explicitly, so this branch is a guard, not a path — pinned so the fallback
  // cannot drift silently.
  it("falls back to general when page is omitted outside a plugin page", () => {
    const upsert = harness(<Source />);
    expect(upsert).toHaveBeenCalledWith(
      "plugin:roles",
      expect.objectContaining({ page: "general" }),
    );
  });
});
