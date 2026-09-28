import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the chat-gateway TEAM CONTROLS configuration
 * surface (change: add-chat-gateway-team-controls, test-plan rows F1-F6).
 *
 * HARNESS PREREQUISITE — this whole file is dead without it:
 *   PI_E2E_SEED=1 PI_CHAT_GATEWAY_FAKE=1 docker/test-up.sh -d --build --force-recreate
 *
 * `PI_CHAT_GATEWAY_FAKE=1` does two load-bearing things:
 *   1. docker/test-entrypoint.sh seeds `plugins["chat-gateway"]` BEFORE boot —
 *      plus the `ws_e2e` workspace, its binding, and a 3-entry command log.
 *   2. The plugin swaps its platform for the socket-less fixture
 *      (packages/chat-gateway/src/adapters/fake.ts).
 * The harness carries no Discord credential, so without (1)+(2) the plugin is
 * inert and these rows have nothing to render.
 *
 * `--force-recreate` matters: `test-up.sh` does NOT recreate an already-running
 * container even when the image changed, and the entrypoint seed would then
 * silently never run (symptom: a healthy container with no fixtures).
 *
 * Assertions read REAL seeded state over the plugin WebSocket lane. They must:
 * the panel is driven by `TEAM_SURFACE_MESSAGE`, NOT an HTTP route, so the
 * `page.route(...)` interception `blackhole-settings.spec.ts` uses cannot
 * fabricate a surface here — there is no response to intercept.
 *
 * Seeded fixtures (all three must agree or nothing renders):
 *   workspace ws_e2e  folders [/fixtures/sample-git (in allowedRoots),
 *                              /tmp/inert-folder  (outside → inert)]
 *   binding   ws_e2e  roles {e2e_role_1: control}, principals {e2e_invoker: observe}
 *   log       3 entries, written list_sessions → send_prompt → abort_run
 *
 * The fake's roster answers for ANY role id (`e2e_role_1` is not a real
 * Discord role), over three members shaped so the delegation rule has
 * something to exclude:
 *   E2E Owner      position 10, Manage Roles → an assigner
 *   E2E Delegator  position  5, Manage Roles → an assigner (a NON-owner)
 *   E2E Bystander  position  0, no permission → NOT an assigner
 * and target role position 1, so "above the role" is the discriminator.
 */

const PLUGIN_PATH = "/settings/plugins/chat-gateway";
const WORKSPACE_ID = "ws_e2e";
const IN_ROOT_FOLDER = "/fixtures/sample-git";
const OUT_OF_ROOT_FOLDER = "/tmp/inert-folder";

/**
 * Deep-link the plugin settings page.
 *
 * Warms the shell first: on a fresh container the client's plugin bootstrap
 * races a direct deep-link, so the settings route can resolve before the plugin
 * list arrives and bounce to the dashboard. Retried as a BLOCK because the
 * assertion is about RENDERED state, not about latency.
 *
 * Waits past the panel's own "Loading team controls…" state — that placeholder
 * carries the same testid and is replaced when the surface answers, so
 * asserting the testid alone would pass before the data arrived.
 */
async function gotoSettings(page: Page): Promise<void> {
	await gotoDashboard(page);
	await expect(async () => {
		await page.goto(PLUGIN_PATH);
		await expect(page.getByTestId(`team-binding-${WORKSPACE_ID}`)).toBeVisible({
			timeout: 30_000,
		});
	}).toPass({ timeout: 150_000 });
}

test.describe("chat-gateway team controls surface", () => {
	test("F1: the delegation list shows a non-owner who can assign the mapped role", async ({
		page,
	}) => {
		// Needs a platform that CAN enumerate members. Under `=nolist` there is no
		// list to inspect, so this row is not applicable — skipped rather than
		// reported as a failure, so the two-mode reproduction stays clean.
		test.skip(
			process.env.PI_CHAT_GATEWAY_FAKE === "nolist",
			"needs a platform that can enumerate members (run with PI_CHAT_GATEWAY_FAKE=1)",
		);
		await gotoSettings(page);

		// The role mapping itself comes from the seeded config.
		await expect(page.getByTestId(`team-roles-${WORKSPACE_ID}`)).toContainText("e2e_role_1");

		// ...and resolves through the REAL `assignersForRole` rule against the
		// fixture roster, so this asserts shipped logic, not a simplified twin.
		const members = page.getByTestId("delegation-members-e2e_role_1");
		await expect(members).toBeVisible({ timeout: 30_000 });

		// The non-owner is the whole point of the row: an owner assigns
		// trivially, so naming only the owner would prove nothing.
		await expect(members).toContainText("E2E Delegator");
		// The negative half — a member WITHOUT Manage Roles and below the role
		// must not appear. Without this the row passes even if the list were
		// "everyone in the guild".
		await expect(members).not.toContainText("E2E Bystander");
	});

	test("F2: an unavailable delegation read names a reason and is never an empty list", async ({
		page,
	}) => {
		await gotoSettings(page);

		const unavailable = page.getByTestId("delegation-unavailable-e2e_role_1");
		const none = page.getByTestId("delegation-none-e2e_role_1");

		// The two modes cannot co-exist in one container, so the spec reads the
		// SAME env var that drove the seed and asserts the matching branch. That
		// keeps this honest under both runs (`=1`, then `=nolist`) instead of
		// silently passing the branch it never exercised.
		const mode = process.env.PI_CHAT_GATEWAY_FAKE;
		if (mode === "nolist") {
			// The platform declined to answer. A REASON must be named — an
			// unexplained "unavailable" is the same non-answer in different
			// clothing. The fixture supplies the Server Members intent.
			await expect(unavailable).toBeVisible({ timeout: 30_000 });
			await expect(unavailable).toContainText("missing permission");
		} else {
			await expect(page.getByTestId("delegation-members-e2e_role_1")).toBeVisible({
				timeout: 30_000,
			});
		}

		// Invariant across BOTH modes, and the half that actually matters: the
		// panel must never collapse "we could not ask" into "nobody can".
		await expect(none).toHaveCount(0);
	});

	test("F3: a folder outside allowedRoots renders as inert, and an in-root one does not", async ({
		page,
	}) => {
		await gotoSettings(page);

		// The seeded workspace straddles the boundary deliberately, giving both
		// states in one view. Assert on the row attribute so the counts are
		// exact: exactly one inert and exactly one not. A test that only looked
		// for the inert marker would pass even if EVERY folder were marked.
		const folders = page.getByTestId(`team-folders-${WORKSPACE_ID}`);
		await expect(folders.locator('li[data-inert="true"]')).toHaveCount(1);
		await expect(folders.locator('li[data-inert="false"]')).toHaveCount(1);

		// ...and the inert one is the OUT-OF-ROOT folder, not an arbitrary pick.
		await expect(folders.locator('li[data-inert="true"]')).toContainText(OUT_OF_ROOT_FOLDER);
		await expect(folders.locator('li[data-inert="false"]')).toContainText(IN_ROOT_FOLDER);

		// The operator-facing explanation, not just a flag.
		await expect(
			page.getByTestId(`team-folder-inert-${WORKSPACE_ID}-${OUT_OF_ROOT_FOLDER}`),
		).toBeVisible();
	});

	test("F4: the surface reports the armed state and offers no re-arm control", async ({
		page,
	}) => {
		await gotoSettings(page);

		// Arm/disarm is two-sided, and the panel must render BOTH sides
		// honestly. The seeded config is armed, so assert the armed side AND
		// the absence of the control — a re-arm button shown while armed would
		// be a bug a bare "button exists" check could never catch.
		await expect(page.getByTestId("team-disarm-state")).toHaveText("armed");
		await expect(page.getByTestId("team-rearm")).toHaveCount(0);

		// The disarmed transition needs the state driven from chat, so it is
		// covered at L1 (controller.test.ts, dashboard-only re-arm).
	});

	test("F5: the log renders most-recent-first", async ({ page }) => {
		await gotoSettings(page);

		const rows = page.getByTestId("team-log-row");
		await expect(rows).toHaveCount(3);

		// Seed write order: list_sessions (oldest) → send_prompt → abort_run
		// (newest). Assert the RENDERED ORDER, not mere presence: three right
		// rows in the wrong order is exactly the bug this row exists to catch,
		// and a presence check would sail straight past it.
		const verbs = await rows.evaluateAll((els) =>
			els.map((el) => (el.children[2] as HTMLElement).textContent?.trim() ?? ""),
		);
		expect(verbs).toEqual(["abort_run", "send_prompt", "list_sessions"]);
	});

	test("F6: the surface stays the dashboard's copy across a fresh session", async ({ page }) => {
		await gotoSettings(page);

		// Config-altering verbs (set_config, set_providers, install_package) are
		// held out of CHAT_COMMAND_ALLOWLIST, so the chat lane has no route to
		// mutate configuration at all. The L1 proof is config-immutability.test.ts
		// (every tier, both refusal reasons); what L3 can add is the
		// user-visible consequence — re-reading the surface on a new WebSocket
		// session returns the same dashboard-written state, never chat drift.
		const state = page.getByTestId("team-disarm-state");
		// Scoped to the panel's summary line: each BINDING also renders a
		// "ceiling …" span, so a bare text match resolves to several elements
		// and trips strict mode. The panel's line is the only <p>.
		const ceilingLine = page.locator("p").filter({ hasText: /^ceiling / });
		const before = `${await state.innerText()}|${await ceilingLine.innerText()}`;

		await page.reload();
		await expect(page.getByTestId(`team-binding-${WORKSPACE_ID}`)).toBeVisible({
			timeout: 30_000,
		});
		expect(`${await state.innerText()}|${await ceilingLine.innerText()}`).toBe(before);
	});
});
