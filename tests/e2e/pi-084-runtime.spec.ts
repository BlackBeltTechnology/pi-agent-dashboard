import { expect, test } from "@playwright/test";

/**
 * pi 0.84.1 runtime verification against the docker harness.
 *
 * The design's standing risk is that a pi-ai symbol break hides behind mocked
 * unit tests: `provider-register.ts` can pass every L1 suite and still fail on
 * a live spawn. These specs therefore assert against a REAL container running
 * the bumped runtime, not a stub.
 *
 * F2 (streaming integrity) and F3 (replay equivalence) are NOT re-implemented
 * here: `chat-transcript-virtualization.spec.ts` and `chat-render-fx.spec.ts`
 * already drive a 120-turn streaming transcript, tail mounting, scroll-lock and
 * switch-away-and-restore against this same harness, which is strictly stronger
 * coverage of the same paths. Both suites were run green against pi 0.84.1.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #F1, #F4, #X12).
 */

const PINNED_PI = "0.84.1";

interface Health {
  piVersion?: string;
  mode?: string;
  compatibility?: {
    current?: string;
    minimum?: string;
    recommended?: string;
    maximum?: string | null;
    error?: string;
    upgradeRecommended?: boolean;
  } | null;
}

async function health(request: import("@playwright/test").APIRequestContext): Promise<Health> {
  const res = await request.get("/api/health");
  expect(res.ok(), "/api/health must respond").toBe(true);
  return (await res.json()) as Health;
}

test.describe("pi 0.84.1 runtime (L3)", () => {
  // Guard the post-boot server-stabilization race: a session spawned while the
  // server is still settling never reaches a usable state, and the spec then
  // fails on a symptom far from the cause. Mirrors the sibling faux specs.
  test.beforeEach(async ({ page }) => {
    await expect
      .poll(
        async () => {
          let oks = 0;
          for (let n = 0; n < 3; n++) {
            try {
              const r = await page.request.get("/api/health");
              if (!r.ok()) return 0;
              oks++;
            } catch {
              return 0;
            }
            await new Promise((res) => setTimeout(res, 300));
          }
          return oks;
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe(3);
  });

  test("F1: health reports the pinned runtime with no skew error and no upgrade hint", async ({
    request,
  }) => {
    // `compatibility.current` is the SERVER-computed probe of the running pi.
    // (`piVersion` is a different field, pushed by a live session's bridge, so
    // it stays undefined until one connects — not the signal here.)
    // Converge: the probe is computed lazily per request and cached 30s, and
    // the container may still be settling right after boot.
    await expect
      .poll(async () => (await health(request)).compatibility?.current, {
        message: "the probed running pi should converge to the pinned runtime",
        timeout: 60_000,
      })
      .toBe(PINNED_PI);

    const body = await health(request);
    expect(body.compatibility, "compatibility must be populated when pi resolves").not.toBeNull();
    const compat = body.compatibility!;

    expect(compat.current).toBe(PINNED_PI);
    expect(compat.recommended).toBe(PINNED_PI);
    // The floor is an INDEPENDENT broad-support value and must NOT have moved
    // with the runtime pin. See change design D2.
    expect(compat.minimum).toBe("0.78.0");
    expect(compat.maximum ?? null).toBeNull();

    // Running exactly AT recommended → neither a block nor a hint.
    expect(compat.error, "no blocking skew error at the pinned runtime").toBeUndefined();
    expect(compat.upgradeRecommended, "no upgrade hint at the pinned runtime").toBeFalsy();
  });

  test("X12: the harness comes up on the moved Dockerfile pin", async ({ request }) => {
    // The Dockerfile's global pi install moved to @0.84.1 in this change. If the
    // image still carried the old pin, the probed version would disagree.
    const body = await health(request);
    expect(body.compatibility?.current).toBe(PINNED_PI);
    // A server that booted far enough to serve /api/health with a resolved pi
    // version is the observable this scenario asks for.
    expect(body.mode === "dev" || body.mode === "production").toBe(true);
  });

  test("X12: exactly ONE pi version is resolvable, so the probe cannot report a ghost", async ({
    request,
  }) => {
    // Regression guard for the bug this harness caught: several workspaces
    // declare a broad `>=0.80.10` pi range while the server pins `^0.84.1`.
    // Under `nodeLinker: hoisted` that resolved TWO copies, and the probe read
    // the HOISTED one -- so health advertised a pi the dashboard was not
    // running and raised a spurious upgrade hint. A workspace override pins
    // resolution to one version; this asserts the observable consequence.
    const compat = (await health(request)).compatibility;
    expect(compat?.current).toBe(PINNED_PI);
    expect(compat?.recommended).toBe(PINNED_PI);
    expect(compat?.upgradeRecommended, "probe and pin must agree").toBeFalsy();
  });

  test("F4: the TUI-only 0.84 features stay absent from the web client", async ({
    page,
    request,
  }) => {
    // Fullscreen TUI mode and terminal Mermaid/LaTeX are recorded as no-ops:
    // the web client renders math/diagrams via its own components and exposes
    // no fullscreen-TUI control. See change spec: pi-api-feature-detection.
    const body = await health(request);
    expect(body.compatibility?.current).toBe(PINNED_PI);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // No control for pi's fullscreen TUI mode leaked into the dashboard UI.
    const fullscreenTui = page.getByText(/fullscreen tui/i);
    await expect(fullscreenTui).toHaveCount(0);
  });
});
