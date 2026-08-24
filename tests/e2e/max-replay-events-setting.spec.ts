import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

/**
 * L3 browser behaviour for the `maxReplayEvents` control — test-plan rows F12
 * and F13 (change: lazy-load-session-history).
 *
 * These two rows are the part of the change that is honestly testable in a real
 * browser against the shared harness: the control is a plain `NumberField` in
 * an existing section, so it needs no windowed session and no server restart.
 *
 * The remaining L3 rows (F4-F11) all require the SERVER to be running with a
 * non-zero `memoryLimits.maxReplayEvents` — a restart-only field on a container
 * every other spec shares — and their protocol messages arrive over the
 * WebSocket, which `page.route()` cannot intercept. They are covered at jsdom
 * level in `useMessageHandler.history-gap.test.tsx` and
 * `HistoryGapDivider.test.tsx` instead.
 *
 * The dashboard port comes from the Playwright baseURL, which docker/test-up.sh
 * derived into `.pi-test-harness.json`. Never hardcode `:18000`.
 */

const LABEL = "Max Replay Events";

/**
 * Container access for the ONE precondition the API cannot express: a config
 * file with `maxReplayEvents` ABSENT. `PUT /api/config` merges, so it can set a
 * value but never delete a key. Same route as `ended-session-endedat.spec.ts`.
 */
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

const CONFIG_JS =
  'node -e \'const fs=require("fs");const p=process.env.HOME+"/.pi/dashboard/config.json";' +
  'const c=JSON.parse(fs.readFileSync(p,"utf8"));';

/**
 * Replace the whole `memoryLimits` sub-object on disk with `snapshot`.
 *
 * Used for cleanup instead of `PUT /api/config`, which deep-merges and can
 * therefore add or overwrite a key but never REMOVE one — so a test that
 * introduced `maxReplayEvents` where the file had none could not undo it, and
 * would leave its value behind for every later spec. The snapshot is passed as
 * a JSON string literal, never interpolated as code.
 */
function restoreMemoryLimits(snapshot: Record<string, number>): void {
  const json = JSON.stringify(JSON.stringify(snapshot));
  inContainer(
    `${CONFIG_JS}c.memoryLimits=JSON.parse(${json});fs.writeFileSync(p,JSON.stringify(c,null,2))'`,
  );
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined,
  );
  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)).ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

async function openServerSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Server", exact: true }).click();
  await expect(page.getByTestId("settings-content")).toBeVisible();
}

test.describe("maxReplayEvents settings control", () => {
  // test-plan #F12
  test("renders in Memory Limits and writes only its own field", async ({ page }) => {
    await openServerSettings(page);

    const field = page.getByLabel(LABEL, { exact: true });
    await expect(field).toBeVisible();

    // Capture the siblings so the write can be proven NON-DESTRUCTIVE: a
    // careless `c.memoryLimits = { ...one field }` would silently reset them.
    //
    // Read from the SERVER, not from sibling labels: the assertion is about the
    // persisted values the write must preserve, and sourcing them from the API
    // keeps this test from failing over an unrelated field's label copy.
    const before = (await (
      await page.request.get("/api/config")
    ).json()) as { data?: { memoryLimits?: Record<string, number> } };
    const siblings = before.data?.memoryLimits ?? {};
    expect(Object.keys(siblings)).toEqual(
      expect.arrayContaining(["maxEventsPerSession", "maxStringFieldSize", "maxWsBufferBytes"]),
    );

    await field.fill("1000");
    // The Save Bar is dirty-gated: it exists only once a field has changed, so
    // waiting for it also proves the control is wired into the dirty tracking.
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    const write = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().includes("/api/config"),
    );
    await page.getByTestId("save-btn").click();

    try {
      const body = (await (await write).postDataJSON()) as {
        memoryLimits?: Record<string, number>;
      };
      expect(body.memoryLimits?.maxReplayEvents).toBe(1000);
      /**
       * The payload now carries ONLY the edited field. It used to carry the
       * whole `memoryLimits` object, and this test used to assert the siblings
       * were echoed back unchanged — that echo is precisely what pinned a
       * defaulted `maxReplayEvents` whenever a sibling was touched.
       *
       * The non-destructive property this test exists for is unchanged, and is
       * now asserted END-TO-END against the server (a strictly stronger check
       * than inspecting the request body): the persisted siblings must still
       * hold their original values after the write.
       * See change: fix-lazy-history-backfill-ux (D7).
       */
      expect(body.memoryLimits).not.toHaveProperty("maxEventsPerSession");
      const after = (await (
        await page.request.get("/api/config")
      ).json()) as { data?: { memoryLimits?: Record<string, number> } };
      const persisted = after.data?.memoryLimits ?? {};
      expect(persisted.maxReplayEvents).toBe(1000);
      expect(persisted.maxEventsPerSession).toBe(siblings.maxEventsPerSession);
      expect(persisted.maxStringFieldSize).toBe(siblings.maxStringFieldSize);
      expect(persisted.maxWsBufferBytes).toBe(siblings.maxWsBufferBytes);
    } finally {
      // RESTORE the shared harness config. This spec really does write to the
      // container every other spec runs against, and a leftover non-zero
      // `maxReplayEvents` would window THEIR replays — turning this test into a
      // source of cross-spec flake. Runs even when the assertions above fail.
      await page.request.put("/api/config", {
        data: { memoryLimits: { ...siblings, maxReplayEvents: siblings.maxReplayEvents ?? 0 } },
      });
    }
  });

  // test-plan #F13
  test("inherits the section's restart-required affordance, as its siblings do", async ({ page }) => {
    await openServerSettings(page);

    // The control is deliberately NOT given a bespoke warning: it is a fourth
    // NumberField inside the existing "Memory Limits" section, so the section's
    // shared restart line already covers it. Asserting on the shared line is
    // what proves the control was placed inside that section rather than
    // sprouting a variant of its own.
    const field = page.getByLabel(LABEL, { exact: true });
    await expect(field).toBeVisible();

    const section = page
      .getByTestId("settings-content")
      .locator("section, div")
      .filter({ hasText: /Memory Limits/ })
      .filter({ has: page.getByLabel(LABEL, { exact: true }) })
      .last();
    await expect(section).toContainText(/requires server restart/i);
  });
});

/**
 * The default flip and its settings consequences — test-plan rows F12-F15.
 *
 * `GET /api/config` returns the PARSED config, so `maxReplayEvents` is always
 * materialized client-side. That is what made the old whole-object write
 * dangerous: editing ANY sibling serialized an explicit value the user never
 * chose, converting a defaulted field into a pinned one behind their back and
 * freezing the old default across upgrades.
 *
 * See change: fix-lazy-history-backfill-ux (D7, D8).
 */
test.describe("maxReplayEvents — the default flip (F12-F15)", () => {
  const readLimits = async (page: Page): Promise<Record<string, number>> => {
    const body = (await (await page.request.get("/api/config")).json()) as {
      data?: { memoryLimits?: Record<string, number> };
    };
    return body.data?.memoryLimits ?? {};
  };

  /**
   * test-plan #F15 — the precondition is a config file with NO `maxReplayEvents`
   * key, which no API call can produce: `PUT /api/config` merges, so it can set
   * a value but never delete one. The key is therefore removed on disk inside
   * the container, the same route `ended-session-endedat.spec.ts` uses for
   * config state it cannot reach through the API.
   */
  test("F15: with the field ABSENT, the control displays the default, never 0", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const before = JSON.parse(
      inContainer(`${CONFIG_JS}process.stdout.write(JSON.stringify(c.memoryLimits??{}))'`),
    ) as Record<string, number>;
    try {
      inContainer(
        `${CONFIG_JS}if(c.memoryLimits)delete c.memoryLimits.maxReplayEvents;` +
          `fs.writeFileSync(p,JSON.stringify(c,null,2))'`,
      );
      await restartDashboard();

      // The PARSED config resolves the absent field to the default...
      expect((await readLimits(page)).maxReplayEvents).toBe(2000);
      await openServerSettings(page);
      const field = page.getByLabel(LABEL, { exact: true });
      await expect(field).toBeVisible();
      // ...and the control shows it. The pre-change control read `?? 0`, which
      // told every untouched install it was unlimited when it no longer is.
      await expect(field).toHaveValue("2000");
    } finally {
      // Wholesale, not a merge: this test DELETED a key, and `PUT /api/config`
      // cannot remove one. See `restoreMemoryLimits`.
      restoreMemoryLimits(before);
      await restartDashboard();
    }
  });

  // test-plan #F12
  test("F12: the interaction help text is UNCONDITIONAL, and is not a warning", async ({ page }) => {
    await openServerSettings(page);
    const help = page.getByTestId("memory-limits-replay-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText(/Max Replay Events and Max Events Per Session/i);

    // Flip the pairing to the ordering a conditional predicate would have fired
    // on, and prove the copy does not change. The predicate was rejected as
    // both backwards (that pairing forms no window at all) and undecidable
    // (the harmful case depends on session size, unknowable here).
    const before = await readLimits(page);
    const original = await help.textContent();
    try {
      await page.getByLabel("Max Events Per Session", { exact: true }).fill("100");
      await page.waitForTimeout(300);
      await expect(help).toBeVisible();
      expect(await help.textContent()).toBe(original);
      await expect(page.getByTestId("settings-content")).not.toContainText(/too small to back/i);
    } finally {
      await page.request.put("/api/config", { data: { memoryLimits: before } });
    }
  });

  /**
   * F13/F14 — the write must be FIELD-level. Asserted on the PUT body, which is
   * the contract: the server deep-merges `memoryLimits` over the RAW config
   * file, so a key the client omits keeps whatever the file has (including an
   * absent key, and including an explicit `0`).
   */
  test("F13/F14: editing a sibling writes ONLY that sibling", async ({ page }) => {
    await openServerSettings(page);
    const before = await readLimits(page);

    await page.getByLabel("Max Events Per Session", { exact: true }).fill("12345");
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    const write = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/api/config"));
    await page.getByTestId("save-btn").click();

    try {
      const body = (await (await write).postDataJSON()) as {
        memoryLimits?: Record<string, number>;
      };
      expect(body.memoryLimits?.maxEventsPerSession).toBe(12345);
      // F13 — the untouched field is ABSENT from the payload, so a defaulted
      // `maxReplayEvents` is never converted into a pinned one. F14 follows for
      // free: an explicit `0` in the file is equally untouched by this write.
      expect(Object.keys(body.memoryLimits ?? {})).toEqual(["maxEventsPerSession"]);
      expect(body.memoryLimits).not.toHaveProperty("maxReplayEvents");
    } finally {
      await page.request.put("/api/config", { data: { memoryLimits: before } });
    }
  });

  /**
   * F13/F14 against the RAW FILE, not the request body.
   *
   * The test above proves the client OMITS the field; this proves the omission
   * actually preserves on-disk state, which is the property users feel. Both
   * raw states are exercised because they fail differently: an ABSENT key must
   * not be materialized into an explicit value (F13), and an explicit `0` must
   * survive as `0` rather than being re-defaulted to 2000 (F14). Neither is
   * observable through `GET /api/config`, which returns the PARSED config — so
   * the file is read directly in the container.
   */
  for (const raw of ["absent", "explicit-zero"] as const) {
    test(`F13/F14: a sibling edit leaves an ${raw} maxReplayEvents untouched on disk`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const before = JSON.parse(
        inContainer(`${CONFIG_JS}process.stdout.write(JSON.stringify(c.memoryLimits??{}))'`),
      ) as Record<string, number>;
      try {
        inContainer(
          `${CONFIG_JS}c.memoryLimits=c.memoryLimits||{};` +
            (raw === "absent"
              ? "delete c.memoryLimits.maxReplayEvents;"
              : "c.memoryLimits.maxReplayEvents=0;") +
            `fs.writeFileSync(p,JSON.stringify(c,null,2))'`,
        );
        await restartDashboard();

        await openServerSettings(page);
        // Derive a target GUARANTEED to differ from the current value: filling
        // the same number leaves the form clean, the dirty-gated save bar never
        // appears, and the test would hang on a save that had nothing to save.
        const sibling = page.getByLabel("Max Events Per Session", { exact: true });
        const current = Number((await sibling.inputValue()) || "0");
        const target = current === 23_456 ? 23_457 : 23_456;
        await sibling.fill(String(target));
        await expect(page.getByTestId("settings-save-bar")).toBeVisible();
        const write = page.waitForResponse(
          (r) => r.request().method() === "PUT" && r.url().includes("/api/config"),
        );
        await page.getByTestId("save-btn").click();
        await write;

        const after = JSON.parse(
          inContainer(`${CONFIG_JS}process.stdout.write(JSON.stringify(c.memoryLimits??{}))'`),
        ) as Record<string, number>;
        // The sibling edit landed...
        expect(after.maxEventsPerSession).toBe(target);
        // ...and the raw state of the field under test is byte-identical.
        if (raw === "absent") {
          expect(Object.hasOwn(after, "maxReplayEvents")).toBe(false);
        } else {
          expect(after.maxReplayEvents).toBe(0);
        }
      } finally {
        /**
         * Restore the snapshot WHOLESALE on disk, not through `PUT /api/config`.
         *
         * The PUT deep-merges `memoryLimits` over the raw file, so it can add
         * and overwrite keys but never REMOVE one. When the original config had
         * no `maxReplayEvents`, the explicit-zero case above wrote `0`, and a
         * merge-based restore would leave that `0` behind — persisting
         * unlimited replay for every spec that runs afterwards. Writing the
         * snapshot object replaces the whole sub-object, so an originally
         * absent key really goes away again.
         */
        restoreMemoryLimits(before);
        await restartDashboard();
      }
    });
  }
});
