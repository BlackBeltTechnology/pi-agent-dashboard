/**
 * Decision + outcome tracking for the automatic pi-anthropic-messages install.
 * See change: streamline-first-run (test-plan E19–E24, E27, F1–F3, X1, X2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PEER_SOURCE } from "../package/anthropic-peer.js";
import { packageQueue } from "../package/package-queue.js";
import { peerAutoInstallStore } from "../package/peer-auto-install-store.js";

const PEER_KEY = "@pi/anthropic-messages";
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const healthBody = (am?: { ok: boolean; reason?: string }) => ({
  plugins: am ? [{ id: "flows-anthropic-bridge", lastProbe: { peers: { [PEER_KEY]: am } } }] : [],
});
const recommendedBody = (entry: Record<string, unknown> | null) => ({
  success: true,
  data: { recommended: entry ? [{ id: "pi-anthropic-messages", source: ANTHROPIC_PEER_SOURCE, ...entry }] : [] },
});

interface Net {
  health: () => Promise<Response> | Response;
  recommended: () => Promise<Response> | Response;
  posts: Array<{ url: string; body: any }>;
}
let net: Net;

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        net.posts.push({ url, body });
        return jsonResponse({ success: true, data: { operationId: `op-${net.posts.length}` } });
      }
      if (url.includes("/api/health")) return net.health();
      if (url.includes("/api/packages/recommended")) return net.recommended();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

const installPosts = () => net.posts.filter((p) => p.url.includes("/api/packages/install"));
const outcome = () => peerAutoInstallStore.getSnapshot().outcome;

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function complete(opId: string, success: boolean, action: "install" | "remove" | "update" = "install", error?: string) {
  window.dispatchEvent(
    new CustomEvent("pi-package-event", {
      detail: { type: "package_operation_complete", operationId: opId, action, source: ANTHROPIC_PEER_SOURCE, scope: "global", success, error },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  packageQueue.__resetForTests();
  peerAutoInstallStore.__resetForTests();
  net = {
    health: () => jsonResponse(healthBody()),
    recommended: () => jsonResponse(recommendedBody({ activeInPi: false })),
    posts: [],
  };
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("decision vetoes", () => {
  it("E19: an import failure or a resolving probe vetoes the install", async () => {
    net.health = () => jsonResponse(healthBody({ ok: false, reason: "import failed: x" }));
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(0);
    expect(outcome()).toBeNull();

    net.health = () => jsonResponse(healthBody({ ok: true }));
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(0);
    expect(outcome()).toBeNull();
  });

  it("E20: unreadable or absent recommended state fails open", async () => {
    const cases: Array<() => Promise<Response> | Response> = [
      () => jsonResponse({}, 500),
      () => Promise.reject(new Error("network")),
      () => jsonResponse(recommendedBody(null)),
    ];
    for (const recommended of cases) {
      net.recommended = recommended;
      await expect(peerAutoInstallStore.ensureInstall("sign-in")).resolves.toBeUndefined();
      expect(installPosts()).toHaveLength(0);
      expect(outcome()).toBeNull();
    }
  });

  it("E21: already active in pi → no install, even with a stale non-resolving probe", async () => {
    net.recommended = () => jsonResponse(recommendedBody({ activeInPi: true }));
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(0);
    expect(outcome()).toBeNull();

    net.health = () => jsonResponse(healthBody({ ok: false, reason: "cannot resolve" }));
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(0);
    expect(outcome()).toBeNull();
  });
});

describe("pending operations", () => {
  it("E22: follows another caller's pending install without a second enqueue", async () => {
    packageQueue.enqueue({ source: ANTHROPIC_PEER_SOURCE, action: "install", scope: "global" });
    await flush();
    expect(installPosts()).toHaveLength(1);
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(1);
    expect(outcome()).toBe("running");
    complete("op-1", true);
    expect(outcome()).toBe("installed");
  });

  it("E23: a pending remove is not followed; the install queues behind it", async () => {
    packageQueue.enqueue({ source: ANTHROPIC_PEER_SOURCE, action: "remove", scope: "global" });
    await flush();
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(packageQueue.getQueueDepth()).toBe(1);
    expect(outcome()).toBe("running");
    complete("op-1", true, "remove");
    await flush();
    expect(outcome()).toBe("running");
    expect(installPosts()).toHaveLength(1);
    expect(installPosts()[0].body).toMatchObject({ source: ANTHROPIC_PEER_SOURCE, scope: "global" });
    complete("op-2", true);
    expect(outcome()).toBe("installed");
  });

  it("E24: the install request is built from constants only", async () => {
    net.recommended = () =>
      jsonResponse(recommendedBody({ activeInPi: false, source: "npm:evil", installed: { scope: "local" } }));
    await peerAutoInstallStore.ensureInstall("sign-in");
    expect(installPosts()).toHaveLength(1);
    expect(installPosts()[0].body).toMatchObject({ source: ANTHROPIC_PEER_SOURCE, scope: "global" });
  });
});

describe("decision ordering and bounds", () => {
  it("E27: a newer decision is not clobbered by an older one's rejection", async () => {
    const pending: Array<{ url: string; reject: (e: Error) => void; resolve: (r: Response) => void }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve, reject) => {
            pending.push({ url, resolve, reject });
          }),
      ),
    );
    void peerAutoInstallStore.ensureInstall("sign-in"); // #1: 2 pending reads
    expect(pending).toHaveLength(2);
    peerAutoInstallStore.reset();
    void peerAutoInstallStore.ensureInstall("sign-in"); // #2
    expect(pending).toHaveLength(4);
    expect(outcome()).toBe("deciding");
    pending[0].reject(new Error("boom"));
    pending[1].reject(new Error("boom"));
    await flush();
    expect(outcome()).toBe("deciding");
    pending[2].resolve(jsonResponse(healthBody()));
    pending[3].resolve(jsonResponse(recommendedBody({ activeInPi: true })));
    await flush();
    expect(outcome()).toBeNull();
  });

  it("X1: the decision is bounded at 20 s", async () => {
    net.recommended = () => new Promise<Response>(() => {});
    const done = peerAutoInstallStore.ensureInstall("sign-in");
    await flush();
    expect(outcome()).toBe("deciding");
    await vi.advanceTimersByTimeAsync(20_001);
    await done;
    expect(outcome()).toBeNull();
    expect(installPosts()).toHaveLength(0);
  });
});

describe("outcome tracking", () => {
  async function startRunning(): Promise<void> {
    await peerAutoInstallStore.ensureInstall("sign-in");
    await flush();
    expect(outcome()).toBe("running");
  }

  it("F1: the outcome survives with no subscriber mounted", async () => {
    await startRunning();
    complete("op-1", true);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(outcome()).toBe("installed");
  });

  it("F2: a failure latches with the raw message", async () => {
    await startRunning();
    complete("op-1", false, "install", "npm ERR! ENOTFOUND");
    expect(peerAutoInstallStore.getSnapshot()).toMatchObject({ outcome: "failed", message: "npm ERR! ENOTFOUND" });
  });

  it("F3: another surface's install success recovers; a remove success does not", async () => {
    await startRunning();
    complete("op-1", false, "install", "boom");
    expect(outcome()).toBe("failed");

    packageQueue.enqueue({ source: ANTHROPIC_PEER_SOURCE, action: "remove", scope: "global" });
    await flush();
    complete("op-2", true, "remove");
    expect(outcome()).toBe("failed");

    packageQueue.enqueue({ source: ANTHROPIC_PEER_SOURCE, action: "install", scope: "global" });
    await flush();
    complete("op-3", true);
    expect(outcome()).toBe("installed");
  });

  it("X2: retry re-runs the decision; a second retry while pending enqueues nothing", async () => {
    await startRunning();
    complete("op-1", false, "install", "boom");
    expect(outcome()).toBe("failed");

    await peerAutoInstallStore.retry();
    await flush();
    expect(outcome()).toBe("running");
    expect(installPosts()).toHaveLength(2);

    await peerAutoInstallStore.retry();
    await flush();
    expect(installPosts()).toHaveLength(2);
    expect(outcome()).toBe("running");

    complete("op-2", true);
    expect(outcome()).toBe("installed");
  });

  it("clears installed/failed when a mounted surface sees the probe resolving", async () => {
    await startRunning();
    complete("op-1", true);
    expect(outcome()).toBe("installed");
    peerAutoInstallStore.notifyPeerResolving();
    expect(outcome()).toBeNull();
  });

  it("reset ignores a late success", async () => {
    await startRunning();
    peerAutoInstallStore.reset();
    complete("op-1", true);
    expect(outcome()).toBeNull();
  });
});
