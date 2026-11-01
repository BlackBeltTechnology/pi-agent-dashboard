/**
 * Discoverability test — flows-plugin manifest.
 *
 * Verifies the flows-plugin's `pi-dashboard-plugin` manifest (read from its
 * own package.json) validates against the dashboard's manifest schema and
 * encodes the contract this plugin promises to the shell.
 *
 * Specifically asserts:
 *   - manifest is present and schema-valid
 *   - plugin id is `flows`
 *   - `SessionFlowActionsClaim` (status) lives in the `session-card-flows` slot
 *     (see change: add-flows-subcard); `SessionFlowMenuClaim` (actions) lives in
 *     `session-card-action-bar` (see change: add-session-actions-flyout)
 *   - the `session-card-flows` claim declares the `shouldRenderFlowsSubcard`
 *     gate so the FLOWS subcard hides cleanly when no flows are available
 *   - `shouldRenderFlowsSubcard` is exported from the client entry so the
 *     vite plugin's name-resolver can wire it
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator";
import * as flowsClientEntry from "../client/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_JSON = resolve(__dirname, "../../package.json");

describe("flows-plugin manifest discoverability", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as {
    name: string;
    "pi-dashboard-plugin"?: unknown;
  };
  const manifest = pkg["pi-dashboard-plugin"];

  it("declares a `pi-dashboard-plugin` manifest field", () => {
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe("object");
  });

  it("validates against the dashboard's manifest schema", () => {
    expect(() => validateManifest(manifest, pkg.name)).not.toThrow();
  });

  // The host emit seam refuses undeclared types; the per-project edit-mode
  // action emits flow:set-edit-mode. See change:
  // stop-flows-edit-mode-project-writes (D5, test-plan #E11).
  it("declares `flow:set-edit-mode` in `emits`", () => {
    const validated = validateManifest(manifest, pkg.name) as { emits?: string[] };
    expect(validated.emits).toContain("flow:set-edit-mode");
  });

  it("declares plugin id `flows`", () => {
    const validated = validateManifest(manifest, pkg.name);
    expect(validated.id).toBe("flows");
  });

  it("routes SessionFlowActions through `session-card-flows` slot", () => {
    // Post add-flows-subcard: SessionFlowActionsClaim moved from
    // `session-card-action-bar` to its own `session-card-flows` slot so the
    // shell can host it inside a dedicated FLOWS subcard.
    const validated = validateManifest(manifest, pkg.name);
    const flowsSubcardClaims = validated.claims.filter(
      (c) => c.slot === "session-card-flows",
    );
    const components = new Set(flowsSubcardClaims.map((c) => c.component));
    expect(components.has("SessionFlowActionsClaim")).toBe(true);
  });

  it("routes the flow actions through `session-card-action-bar` via SessionFlowMenuClaim", () => {
    const validated = validateManifest(manifest, pkg.name);
    const actionBar = validated.claims.filter((c) => c.slot === "session-card-action-bar");
    expect(actionBar.map((c) => c.component)).toEqual(["SessionFlowMenuClaim"]);
    // The claim stays mounted and decides its own output: no manifest shouldRender.
    expect((actionBar[0] as { shouldRender?: string }).shouldRender).toBeUndefined();
    // `session-card-action-bar` is a HOT slot (no suspense gap in cards): the claim is eager, never a `module`.
    expect((actionBar[0] as { module?: string }).module).toBeUndefined();
  });

  it("SessionFlowActionsClaim does not occupy the `session-card-action-bar` slot", () => {
    // The status claim stays in the FLOWS subcard (would double-render otherwise).
    const validated = validateManifest(manifest, pkg.name);
    const actionBarClaims = validated.claims.filter(
      (c) =>
        c.slot === "session-card-action-bar" &&
        c.component === "SessionFlowActionsClaim",
    );
    expect(actionBarClaims).toHaveLength(0);
  });

  it("E27: claims include flows subcard, action bar, header-sticky and content-view; no session-card-badge", () => {
    const validated = validateManifest(manifest, pkg.name);
    const slots = validated.claims.map((c) => c.slot);
    for (const slot of ["session-card-flows", "session-card-action-bar", "content-header-sticky", "content-view"]) {
      expect(slots).toContain(slot);
    }
    expect(slots).not.toContain("session-card-badge");
  });

  it("client entry exports every manifest-referenced claim component and the gate", () => {
    const entry = flowsClientEntry as Record<string, unknown>;
    expect(entry.SessionFlowMenuClaim).toBeTypeOf("function");
    expect(entry.flowsActionsAvailable).toBeTypeOf("function");
  });

  it("every `session-card-flows` claim declares the shouldRenderFlowsSubcard gate", () => {
    const validated = validateManifest(manifest, pkg.name);
    const flowsClaims = validated.claims.filter(
      (c) => c.slot === "session-card-flows",
    );
    expect(flowsClaims.length).toBeGreaterThan(0);
    for (const c of flowsClaims) {
      expect((c as { shouldRender?: string }).shouldRender).toBe(
        "shouldRenderFlowsSubcard",
      );
    }
  });

  it("client entry exports `shouldRenderFlowsSubcard`", () => {
    // The vite plugin's plugin-registry generator resolves the
    // `shouldRender` string against this module's named exports. If the
    // export is missing, the build fails — this test catches the
    // contract break before the build.
    expect(
      (flowsClientEntry as { shouldRenderFlowsSubcard?: unknown })
        .shouldRenderFlowsSubcard,
    ).toBeTypeOf("function");
  });
});
