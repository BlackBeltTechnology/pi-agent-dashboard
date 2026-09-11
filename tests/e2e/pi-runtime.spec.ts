import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";

/**
 * pi runtime verification against the docker harness — VERSION-NEUTRAL.
 *
 * The design's standing risk is that a pi-ai symbol break hides behind mocked
 * unit tests: `provider-register.ts` can pass every L1 suite and still fail on
 * a live spawn. These specs therefore assert against a REAL container running
 * the bumped runtime, not a stub.
 *
 * The governed version is READ from `packages/server/package.json` at test
 * time — no version literal lives in this file, so the next pi bump needs no
 * spec edit (design §6: a test that merely NEEDS the pinned version derives it;
 * only the coherence test keeps literals).
 *
 * F2 (streaming integrity) and F3 (replay equivalence) are NOT re-implemented
 * here: `chat-transcript-virtualization.spec.ts` and `chat-render-fx.spec.ts`
 * already drive a 120-turn streaming transcript, tail mounting, scroll-lock and
 * switch-away-and-restore against this same harness, which is strictly stronger
 * coverage of the same paths.
 *
 * See change: update-pi-core-0-85-adopt-apis (test-plan #F1, #F2, #F3, #F4, #X12).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(here, "..", "..", "packages", "server", "package.json"), "utf-8"),
) as { piCompatibility: { minimum: string; recommended: string } };

const PINNED_PI = serverPkg.piCompatibility.recommended;
// The 0.85.1 lockstep policy makes minimum === recommended; read both so the
// spec also catches a future re-divergence rather than assuming it.
const MIN_PI = serverPkg.piCompatibility.minimum;

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

test.describe("pi runtime (L3)", () => {
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
    // Lockstep policy (design §2): the floor moves WITH the pin, so it must
    // equal the governed recommended version — read from the manifest, never
    // restated here.
    expect(compat.minimum).toBe(MIN_PI);
    expect(compat.maximum ?? null).toBeNull();

    // Running exactly AT recommended → neither a block nor a hint.
    expect(compat.error, "no blocking skew error at the pinned runtime").toBeUndefined();
    expect(compat.upgradeRecommended, "no upgrade hint at the pinned runtime").toBeFalsy();
  });

  test("X12: the harness comes up on the moved Dockerfile pin", async ({ request }) => {
    // The Dockerfile's global pi install tracks the governed pin. If the image
    // still carried an older pin, the probed version would disagree.
    const body = await health(request);
    expect(body.compatibility?.current).toBe(PINNED_PI);
    // A server that booted far enough to serve /api/health with a resolved pi
    // version is the observable this scenario asks for.
    expect(body.mode === "dev" || body.mode === "production").toBe(true);
  });

  test("X12: the version probe agrees with the governed pin (no ghost version)", async ({
    request,
  }) => {
    // Regression guard for the bug this harness caught: several workspaces
    // declare a broad `>=0.80.10` pi range while the server pins the governed
    // exact-ish range. Under `nodeLinker: hoisted` that resolved TWO copies, and
    // the probe read the HOISTED one -- so health advertised a pi the dashboard
    // was not running and raised a spurious upgrade hint.
    //
    // SCOPE: this asserts probe/pin AGREEMENT, which is the user-visible
    // symptom. It does NOT prove the tree holds a single copy -- a
    // multi-copy tree still passes whenever the probe happens to select the
    // pinned version. The single-copy invariant itself is enforced upstream by
    // the `overrides` entry in `pnpm-workspace.yaml` (design D8/D9).
    const compat = (await health(request)).compatibility;
    expect(compat?.current).toBe(PINNED_PI);
    expect(compat?.recommended).toBe(PINNED_PI);
    expect(compat?.upgradeRecommended, "probe and pin must agree").toBeFalsy();
  });

  test("F4: pi's fullscreen-TUI mode exposes no control in the web client", async ({
    page,
    request,
  }) => {
    // Fullscreen TUI mode and terminal Mermaid/LaTeX are recorded as no-ops.
    //
    // SCOPE: this asserts only the ABSENCE half -- that running a pi which
    // supports fullscreen TUI adds no dashboard control. The presence half
    // (KaTeX + Mermaid still rendering) is pre-existing behaviour already
    // gated by the `chat-math-rendering` and `mermaid-diagram` suites; it is
    // deliberately not re-asserted here, since this change does not touch it.
    const body = await health(request);
    expect(body.compatibility?.current).toBe(PINNED_PI);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // No control for pi's fullscreen TUI mode leaked into the dashboard UI.
    await expect(page.getByText(/fullscreen tui/i)).toHaveCount(0);
  });
});
