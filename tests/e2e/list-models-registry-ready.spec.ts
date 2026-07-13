import { expect, test } from "@playwright/test";
import { LIST_MODELS_MARKER_PREFIX } from "../../qa/fixtures/faux-scenarios.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Registry-readiness discriminator, end-to-end (change:
// fix-list-models-empty-on-unhydrated-registry).
//
// The `[[faux:tool-list-models]]` scenario drives the REAL pi agent loop: step 1
// emits a `list_models` tool call, so the actual bridge `list_models` tool
// executes against the live session registry — NOT a faked event. `faux/faux-1`
// is registered into that registry via `pi.registerProvider`, so `getAvailable()`
// is non-empty and `getRegistry()` is truthy → the tool's `buildModelsResult`
// returns `{ registryReady: true, models: [...] }`. Step 2 reads that tool result
// back out of context and echoes the discriminator as plain assistant text, so
// the assertion is a stable transcript marker (no tool-card collapse /
// virtualization fragility).
//
// This is the live proof of the steady-state `registryReady: true` + populated
// catalogue path (task V.2). The absent-registry race (`registryReady: false`,
// task V.3) is a spawn-before-hydration window that cannot be forced
// deterministically here; it stays unit-proven by
// role-model-tools-registry-readiness.test.ts case A, which the spec's V.3
// explicitly accepts as proof.

test.describe("list_models registry-readiness (L3)", () => {
  test("live list_models tool reports registryReady:true with a populated catalogue", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:tool-list-models]] list the models");

    // Step 2 echoes: `list-models registryReady=true count=<N> hasFaux=true`.
    const marker = page.getByText(new RegExp(`${LIST_MODELS_MARKER_PREFIX}true`));
    await expect(marker.first()).toBeVisible({ timeout: 30_000 });

    // The catalogue is non-empty and includes the faux model the session
    // registers — the tool listed the real in-process registry, not an empty set.
    await expect(page.getByText(/hasFaux=true/).first()).toBeVisible({ timeout: 30_000 });
  });
});
