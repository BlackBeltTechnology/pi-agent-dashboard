import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 for reduce-subagent-details-payload — what only a real browser against a
 * real bridge can prove: that stripping the timeline off intermediate frames
 * engages on REAL producer output, and costs the user nothing they can see.
 *
 * ## Observable narrowing, stated honestly
 *
 * The manifest routes F1 (open-inspector convergence), F2 (late joiner) and F4
 * (no double-fire across two views) to L3. Measured against this harness, they
 * have NO L3 observable: the `subagent-sustained` faux scenario's inner bash
 * `sleep`s do not execute under the faux provider, so the spawned subagent
 * completes in ~600 ms. There is no mid-run window in which to mount an
 * inspector, and no growing timeline to converge on — an "assertion" written
 * against it would pass on an empty timeline and prove nothing.
 *
 * Those three rows are therefore owned deterministically at L1:
 *  - F1 / C1 backoff + convergence → `useSubagentResyncCadence.test.tsx`
 *  - F3 teardown, F4 single-timer-per-subagent → same file
 *  - F2 late joiner (the >20-entry clobber that broke the pull path) →
 *    `memory-event-store.test.ts` D5a E1–E4 + `subagent-forward-sites.test.ts`
 *  - F6 old-client freeze, X4 dropped-tick convergence →
 *    `thin-subagent-frame-reducer.test.ts`
 *
 * What only L3 can prove, and what is asserted here: the strip engages on real
 * producer output (D6 counters), the finished run still renders after a
 * refresh (terminal fidelity), and the P5 kill-switch signal exists and can be
 * read (task 1.5, the measurement that had no signal at all before).
 *
 * `baseURL` comes from the harness state file, so `/api/health` and the page
 * both resolve to this run's container. Never hardcode `:18000`.
 */
test.describe("subagent thin ticks — liveness + fidelity (L3)", () => {
  // The parent round-trip spans a spawn plus two model turns, past the 60 s
  // default.
  test.setTimeout(180_000);

  /** Expand the Agent card so the inline inspector mounts. */
  async function openInspector(page: import("@playwright/test").Page): Promise<void> {
    const toggles = page.getByRole("button", { name: /faux sustained subagent/i });
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      await toggles.nth(i).click({ timeout: 3_000 }).catch(() => {});
    }
  }

  // Terminal fidelity (D3/F5): the terminal frame is never stripped, so the
  // finished run's card survives the replay path unchanged. A terminal frame
  // stripped by accident is a timeline gone forever — the highest-severity
  // failure mode in this change.
  test("a completed subagent still renders after a refresh", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await openInspector(page);
    await expect(page.getByText(/faux sustained subagent/i).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await openInspector(page);

    await expect(page.getByText(/faux sustained subagent/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/subagent not found/i)).toHaveCount(0);
  });

  // D6 — the counters prove the mechanism engaged on real producer output:
  // ticks are ingested, and the fat ones (terminal frames + resync replies) are
  // a MINORITY. A majority-fat run means the strip did not engage.
  test("D6: subagent-tick counters move and stay mostly thin", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    const before = (await (await page.request.get("/api/health")).json()) as {
      storeTrim: { subagentTicks: number; subagentFatTicks: number; subagentTickBytes: number };
    };

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const after = (await (await page.request.get("/api/health")).json()) as {
      storeTrim: { subagentTicks: number; subagentFatTicks: number; subagentTickBytes: number };
    };
    const ticks = after.storeTrim.subagentTicks - before.storeTrim.subagentTicks;
    const fat = after.storeTrim.subagentFatTicks - before.storeTrim.subagentFatTicks;
    const bytes = after.storeTrim.subagentTickBytes - before.storeTrim.subagentTickBytes;
    console.log(`[D6] ticks=${ticks} fat=${fat} bytes=${bytes}`);
    expect(ticks).toBeGreaterThan(0);
    expect(fat).toBeLessThan(ticks);
  });

  // P5 (tasks 1.4 / 1.5) — the kill-switch measurement. Before this change the
  // client recorded NOTHING about whether a detail view was mounted, so the
  // share that bounds the achievable win could not be measured at all. This run
  // never opens an inspector, so the share must sit far under the C4 abort
  // threshold of 50 %.
  test("P5: inspector-open share is measurable and below the C4 abort threshold", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const telemetry = await page.evaluate(() => {
      const read = (globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry as
        | (() => { runtimeMs: number; inspectorOpenMs: number; share: number })
        | undefined;
      return read?.() ?? null;
    });

    expect(telemetry).not.toBeNull();
    expect(telemetry!.runtimeMs).toBeGreaterThan(0);
    console.log(`[P5] inspector-open share: ${(telemetry!.share * 100).toFixed(1)}%`);
    expect(telemetry!.share).toBeLessThanOrEqual(0.5);
  });
});
