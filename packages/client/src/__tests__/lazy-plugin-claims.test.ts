/**
 * Policy guard: heavy on-demand plugin claims stay lazy (manifest `module`).
 *
 * Every `settings-section` and `shell-overlay-route` claim must bind a
 * `lazyClaim` component, except plugins whose claim is already a thin wrapper
 * around an inline `React.lazy` (allowlisted below). A claim that regresses to
 * a static import pulls its whole surface back into the cold-landing chunk
 * (see mdi-chunk-size.test.ts for the measured cap).
 *
 * See change: lazy-plugin-claim-modules.
 */
import { describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY } from "../generated/plugin-registry.js";

const REACT_LAZY = Symbol.for("react.lazy");
/** Plugins whose claim component is already a thin wrapper over an inline `lazy()`. */
const THIN_WRAPPER_PLUGINS = new Set(["gmail", "hermes-memory", "skill-atlas", "obs-studio"]);
const LAZY_SLOTS = new Set(["settings-section", "shell-overlay-route"]);

/** Hot / visible-in-history slots: a suspense gap would pop in, so no claim here may name a `module` (design D5). */
const EAGER_SLOTS = new Set([
  "session-card-badge",
  "session-card-action-bar",
  "session-card-memory",
  "session-card-flows",
  "composer-context-group",
  "composer-panel",
  "sidebar-folder-section",
  "worktree-card-section",
  "custom-entry-renderer",
  "login-provider",
]);

const isLazy = (c: unknown): boolean => (c as { $$typeof?: symbol } | undefined)?.$$typeof === REACT_LAZY;

describe("heavy plugin claims are lazy", () => {
  const claims = PLUGIN_REGISTRY.flatMap((entry) => entry.claims.map((claim) => ({ id: entry.manifest.id, claim })));

  it("every settings-section / shell-overlay-route claim is a lazyClaim (modulo thin wrappers)", () => {
    const eager = claims
      .filter(({ id, claim }) => LAZY_SLOTS.has(claim.slot) && claim.Component && !THIN_WRAPPER_PLUGINS.has(id))
      .filter(({ claim }) => !isLazy(claim.Component))
      .map(({ id, claim }) => `${id}:${claim.slot}`);
    expect(eager, `statically imported heavy claims: ${eager.join(", ")}`).toEqual([]);
  });

  it("claims whose manifest names a module are lazy", () => {
    const withModule = PLUGIN_REGISTRY.flatMap((entry) =>
      entry.manifest.claims
        .filter((c) => c.module)
        .map((c) => ({ id: entry.manifest.id, component: c.component, slot: c.slot })),
    );
    expect(withModule.length).toBeGreaterThan(20);
    for (const { id, component, slot } of withModule) {
      const claim = PLUGIN_REGISTRY.find((e) => e.manifest.id === id)?.claims.find(
        (c) => c.slot === slot && c.Component && isLazy(c.Component),
      );
      expect(claim, `${id} ${slot} ${component} should bind a lazy component`).toBeDefined();
    }
  });

  it("hot-slot claims never name a module (no suspense gap in cards / composer / chat history)", () => {
    const offenders = PLUGIN_REGISTRY.flatMap((entry) =>
      entry.manifest.claims
        .filter((c) => c.module && EAGER_SLOTS.has(c.slot))
        .map((c) => `${entry.manifest.id}:${c.slot}:${c.component}`),
    );
    expect(offenders).toEqual([]);
  });
});
