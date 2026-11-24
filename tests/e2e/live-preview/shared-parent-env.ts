import { type Browser, chromium } from "@playwright/test";
import type { IsolatedServer } from "./isolated-server.js";

/**
 * "Shared-parent" tier-2 topology for the cookie-toss specs: dashboard `dash.a.test`, previews
 * `<label>.preview.a.test` — both under the registrable parent `a.test`, so a preview page CAN set a
 * `Domain=a.test` cookie that the dashboard host also receives (D10). The project-level resolver rules only
 * map `dash.test` / `dash5.test` / `*.preview.test`, so these specs launch their own Chromium.
 */
export const SHARED_PARENT = {
  dashHost: "dash.a.test",
  suffix: "preview.a.test",
  parent: "a.test",
  rules: "MAP *.preview.a.test 127.0.0.1, MAP dash.a.test 127.0.0.1",
} as const;

/** Config patch + restart that puts the isolated server into the shared-parent topology. */
export async function useSharedParentConfig(server: IsolatedServer): Promise<void> {
  await server.restart({
    patch: {
      allowedHosts: ["dash.test", "dash5.test", SHARED_PARENT.dashHost],
      liveServer: { previewOrigins: { wildcard: { suffix: SHARED_PARENT.suffix, scheme: "http", forHosts: [SHARED_PARENT.dashHost], port: server.port } } },
    },
  });
}

/** A Chromium that resolves the shared-parent hosts to 127.0.0.1. The caller closes it. */
export const launchSharedParentBrowser = (): Promise<Browser> => chromium.launch({ args: [`--host-resolver-rules=${SHARED_PARENT.rules}`] });

/** The boot-log fragment `[live-preview]` prints for a parent-domain sharer (config-snapshot). */
export const PARENT_DOMAIN_WARNING = /\[live-preview\] wildcard suffix shares a parent domain with /;
