import { expect, test } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

// L3 regression for change: fix-builtin-role-names-relay.
//
// Guards the full bridge→server→client relay of `builtinRoleNames`. The bridge
// attaches it to every `roles_list`; the server re-broadcast (event-wiring.ts)
// and the client handler (useMessageHandler.ts) must both preserve it. When
// either hop drops the field, the Roles panel collapses to its flat
// back-compat render — no Built-in/Custom grouping and no "＋ Add custom role"
// control — which is exactly the defect this change fixes.
//
// Transport: `builtinRoleNames` only reaches the browser once a live pi session
// exists (App.tsx sends `request_roles` through the first non-ended session).
// spawnFreshGitSession provides that session; the container's bridge seeds the
// canonical DEFAULT_ROLE_NAMES set regardless of credential validity.
//
// Selects on existing app data-testids shipped by RolesSettingsSection
// (roles-settings / roles-group-builtin / roles-group-custom / roles-add-custom
// / roles-add-custom-input / roles-add-custom-confirm / roles-model-picker) —
// no new app testids added.
test.describe("custom roles UI (L3: builtinRoleNames relay)", () => {
  test("Built-in/Custom groups + Add custom role render (field survives the relay)", async ({
    page,
  }) => {
    // A live session is the transport for request_roles → roles_list.
    await spawnFreshGitSession(page);

    // General tab hosts the Roles settings section (canonical route).
    await page.goto("/settings/general");

    const roles = page.getByTestId("roles-settings");
    await expect(roles).toBeVisible({ timeout: 30_000 });

    // The split render only appears when builtinRoleNames arrived non-empty.
    // If the relay dropped it, these are absent (flat back-compat layout).
    const builtinGroup = page.getByTestId("roles-group-builtin");
    await expect(builtinGroup).toBeVisible({ timeout: 30_000 });
    // A canonical built-in pill proves the classification, not just presence.
    await expect(builtinGroup).toContainText("@fast");

    await expect(page.getByTestId("roles-group-custom")).toBeVisible();

    // The previously-missing control — its existence is the user-facing payoff.
    const addBtn = page.getByTestId("roles-add-custom");
    await expect(addBtn).toBeVisible();

    // Exercise the add-custom-role affordance up to the model picker WITHOUT
    // persisting (keeps the shared container's providers.json untouched).
    await addBtn.click();
    const nameInput = page.getByTestId("roles-add-custom-input");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("e2e-relay-check");
    await page.getByTestId("roles-add-custom-confirm").click();

    // Confirming a valid, non-colliding name opens the scoped model picker.
    await expect(page.getByTestId("roles-model-picker")).toBeVisible({ timeout: 15_000 });
  });
});
