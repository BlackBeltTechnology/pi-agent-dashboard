import { expect, test } from "@playwright/test";
import { ensureGitSession } from "./helpers/index.js";

// Scenario 5.2 (change: add-flow-plugin-e2e-tests) — the anthropic-messages
// bridge activation surface, asserted through `/api/health`.plugins[].
//
// OBSERVABILITY NOTE. The bridge's LIVE peer-probe status (`active` /
// `waiting_peers`) is emitted on the pi-session event bus and, in this build,
// is NOT reliably forwarded to the server's plugin-status store — the bridge's
// own server entry documents this v1 gap ("shows 'no sessions reporting'"). So
// `lastProbe.status` is asserted BEST-EFFORT (only when a probe actually
// arrives). The FIRMLY-observable, server-computed regression signal is
// `bridgeLoadedFrom` — derived from settings.json#packages[] — which is the core
// field bug this change guards: a bridge registered only under
// `dashboardPluginBridges` (invisible to pi) vs. correctly mirrored into
// `packages[]`. The live peer semantics (no-am / legacy) are covered by the L1
// probe unit tests + the §4 Docker harness variants.
//
// Managed container: PI_TEST_PEERS=both -> the bridge auto-registers into
// packages[] and loads. The `no-am` case is env-gated (opt-in against a
// separately-booted PI_TEST_PEERS=no-am container).

interface HealthPlugin {
  id: string;
  enabled?: boolean;
  loaded?: boolean;
  bridgeLoadedFrom?: "packages[]" | "dashboardPluginBridges" | "none";
  lastProbe?: { status?: string; peers?: Record<string, { ok: boolean; reason?: string }> };
}

async function bridgePlugin(
  request: import("@playwright/test").APIRequestContext,
): Promise<HealthPlugin | undefined> {
  const res = await request.get("/api/health");
  if (!res.ok()) return undefined;
  const body = (await res.json()) as { plugins?: HealthPlugin[] };
  return (body.plugins ?? []).find((p) => p.id === "flows-anthropic-bridge");
}

test.describe("anthropic bridge activation (L3)", () => {
  test("both peers present → bridge loaded from packages[]", async ({ page }) => {
    test.skip(
      (process.env.PI_TEST_PEERS ?? "both") !== "both",
      "runs against the default PI_TEST_PEERS=both managed container",
    );
    // A session must exist for the bridge to load + probe.
    await ensureGitSession(page);

    // FIRM: the bridge is registered/loaded from packages[] (the "no sessions
    // reporting" / bridge-invisible-to-pi regression guard).
    await expect
      .poll(async () => (await bridgePlugin(page.request))?.bridgeLoadedFrom, { timeout: 60_000 })
      .toBe("packages[]");

    const plugin = await bridgePlugin(page.request);
    expect(plugin?.enabled).toBe(true);
    expect(plugin?.loaded).toBe(true);

    // BEST-EFFORT: if the live probe was forwarded (build-dependent), it must be
    // "active" (both peers resolvable) — never "waiting_peers"/"degraded".
    const statusRes = await page.request.get("/api/flows-anthropic-bridge/status");
    if (statusRes.ok()) {
      const status = (await statusRes.json()) as { sessions?: Array<{ status: string }> };
      const reported = status.sessions ?? [];
      if (reported.length > 0) {
        expect(reported.some((s) => s.status === "active")).toBe(true);
      }
    }
  });

  test("no-am variant → waiting_peers naming the missing anthropic peer", async ({ page }) => {
    test.skip(
      process.env.PI_TEST_PEERS !== "no-am",
      "opt-in: boot a PI_TEST_PEERS=no-am container and set PI_TEST_PEERS=no-am; requires the bridge status-forward path",
    );
    await ensureGitSession(page);

    await expect
      .poll(async () => (await bridgePlugin(page.request))?.lastProbe?.status, { timeout: 90_000 })
      .toBe("waiting_peers");

    const peers = (await bridgePlugin(page.request))?.lastProbe?.peers ?? {};
    const amFailing = Object.values(peers).some(
      (p) => !p.ok && /anthropic-messages/.test(p.reason ?? ""),
    );
    expect(amFailing).toBe(true);
  });

  test("bad-registration variant → bridge NOT loaded from packages[]", async ({ page }) => {
    test.skip(
      process.env.PI_TEST_PEERS !== "bad-registration",
      "opt-in: boot a PI_TEST_PEERS=bad-registration container and set PI_TEST_PEERS=bad-registration",
    );
    await ensureGitSession(page);
    // The escape hatch keeps the bridge OUT of packages[] (registered only under
    // dashboardPluginBridges) -> the "invisible to pi / no sessions reporting"
    // condition is detectable server-side. This IS observable (server-computed).
    await expect
      .poll(async () => (await bridgePlugin(page.request))?.bridgeLoadedFrom, { timeout: 60_000 })
      .not.toBe("packages[]");
  });
});
