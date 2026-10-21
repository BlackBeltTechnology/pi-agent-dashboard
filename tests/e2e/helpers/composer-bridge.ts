/**
 * Synthetic-bridge glue for composer-toolbar L3 specs (`add-composer-dock`).
 *
 * Registers a fake pi session under the pre-trusted `FIXTURE_GIT` over the real
 * gateway pairing flow, serves it a model catalogue, and can flip it to
 * `streaming` — states the harness cannot produce on demand. Same primitives as
 * `composer-session-strip.spec.ts` / `composer-liveness-reload.spec.ts`; the
 * dashboard port comes from the fixtures' baseURL, never hardcoded.
 */

import { expect, type Locator, type Page, test } from "../fixtures.js";
import { BASE_URL } from "../lifecycle.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./bridge-credential.js";
import { FIXTURE_GIT, pinDirectory } from "./index.js";

interface ComposerModel {
  provider: string;
  id: string;
}

/** Catalogue in the shape the harness serves; `LONGEST` is its longest `provider/id`. */
export const COMPOSER_MODELS: ComposerModel[] = [
  { provider: "anthropic", id: "claude-haiku-4-5" },
  { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
  { provider: "openrouter", id: "google/gemini-2.5-flash-preview-05-20-thinking" },
];
export const LONGEST_MODEL = COMPOSER_MODELS.reduce((a, b) =>
  `${b.provider}/${b.id}`.length > `${a.provider}/${a.id}`.length ? b : a,
);

/** One background process as the bridge scan reports it (`process_list`). */
export interface BridgeProcess {
  pid: number;
  pgid: number;
  command: string;
  elapsedMs: number;
  kind?: "task" | "sub-session" | "pi-worker" | "plugin";
  label?: string;
  sessionRef?: string;
}

export interface ComposerBridge {
  sessionId: string;
  /** Flip the session to `streaming` (`agent_start` + a running heartbeat). */
  startStreaming: () => void;
  /** Report the session's background processes (a bridge scan); replaces the previous list. */
  setProcesses: (processes: BridgeProcess[]) => void;
  /** Send any bridge → server message (e.g. `git_info_update`). */
  send: (payload: Record<string, unknown>) => void;
  /** Messages the server forwarded to this bridge (e.g. `kill_process { pgid }`), oldest first. */
  received: () => Record<string, unknown>[];
  close: () => void;
}

async function piGatewayPort(page: Page): Promise<number | null> {
  const body = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  return body.piGatewayPort ?? null;
}

/** Pin `FIXTURE_GIT` before a synthetic session registers there (shared container). */
export async function ensureFixturePinned(page: Page): Promise<void> {
  const body = (await (await page.request.get("/api/pinned-dirs")).json()) as { data?: string[] };
  if (!(body.data ?? []).includes(FIXTURE_GIT)) await pinDirectory(page, FIXTURE_GIT);
}

export async function connectComposerBridge(page: Page, tag: string): Promise<ComposerBridge> {
  const port = await piGatewayPort(page);
  test.skip(!port, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, port as number, bearer);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    s.addEventListener("open", () => { clearTimeout(timer); resolve(s); }, { once: true });
    s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  const sessionId = `e2e-composer-${tag}-${Date.now()}`;
  const inbox: Record<string, unknown>[] = [];
  ws.addEventListener("message", (ev) => {
    try {
      inbox.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
    } catch {
      // non-JSON frame: not a command for the bridge
    }
  });
  const send = (payload: Record<string, unknown>) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {
      // socket died with the test
    }
  };
  send({
    type: "session_register",
    sessionId,
    cwd: FIXTURE_GIT,
    source: "tui",
    pid: 426000 + Math.floor(Math.random() * 999),
    model: `${LONGEST_MODEL.provider}/${LONGEST_MODEL.id}`,
  });
  send({ type: "models_list", sessionId, models: COMPOSER_MODELS.map((m) => ({ ...m, name: m.id })) });
  send({ type: "replay_complete", sessionId });
  // A real bridge rescans periodically and every scan carries the full list, so a scan the server
  // saw before the page had bound the session is superseded by the next one. Mirror that: resend the
  // latest list until close (a one-shot send is lost when it races the session's registration).
  let processes: BridgeProcess[] | null = null;
  const rescan = setInterval(() => {
    if (processes) send({ type: "process_list", sessionId, processes });
  }, 1500);
  return {
    sessionId,
    startStreaming: () => {
      send({ type: "event_forward", sessionId, event: { eventType: "agent_start", timestamp: Date.now(), data: {} } });
      send({ type: "session_heartbeat", sessionId, agentRunning: true });
    },
    send,
    setProcesses: (next) => {
      processes = next;
      send({ type: "process_list", sessionId, processes });
    },
    received: () => inbox,
    close: () => {
      clearInterval(rescan);
      send({ type: "session_unregister", sessionId });
      ws.close();
    },
  };
}

/** Select the synthetic session and wait for its composer card. */
export async function openComposerSession(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.getByTestId("composer-card")).toBeVisible({ timeout: 20_000 });
}

/**
 * Pin the composer card's CONTENT width (what its `@container` queries read) to
 * `px`, regardless of the pane: border-box width = content + padding + border.
 */
export async function setComposerContentWidth(page: Page, px: number): Promise<void> {
  await page.getByTestId("composer-card").evaluate((el, w) => {
    const cs = getComputedStyle(el);
    const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
      .map((k) => Number.parseFloat(cs[k as keyof CSSStyleDeclaration] as string) || 0)
      .reduce((a, v) => a + v, 0);
    (el as HTMLElement).style.width = `${w + chrome}px`;
    (el as HTMLElement).style.flex = "none";
  }, px);
}

/** True when `el`'s toolbar content fits: `scrollWidth <= clientWidth`. */
export async function fitsHorizontally(el: Locator): Promise<{ scrollWidth: number; clientWidth: number }> {
  return el.evaluate((n) => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
}

/**
 * Whether an element is clipped to ≤ 1 px (the `sr-only` shape) yet still
 * rendered — i.e. exposed to assistive technology (no `display:none`, no
 * `visibility:hidden`). Playwright's `toBeVisible` counts a 1 px box as visible,
 * so the visually-hidden word needs this probe.
 */
export async function isVisuallyHiddenButExposed(el: Locator): Promise<boolean> {
  return el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return r.width <= 1 && r.height <= 1 && cs.display !== "none" && cs.visibility !== "hidden";
  });
}

/**
 * Report a worktree session with an open, passing PR and 3 dirty files — the state
 * that gives the dock a Changes lane (the harness has no GitHub to produce it).
 */
export function pushWorktreeWithPr(bridge: ComposerBridge): void {
  bridge.send({
    type: "git_info_update",
    sessionId: bridge.sessionId,
    gitBranch: "os/e2e-composer-dock",
    isGitRepo: true,
    gitWorktree: { mainPath: FIXTURE_GIT, name: "e2e-composer-dock", base: "develop" },
    gitStatus: { dirtyCount: 3, staged: 1, unstaged: 2, untracked: 0, ahead: 2, behind: 0 },
    gitPrNumber: 747,
    gitPrUrl: "https://github.com/o/r/pull/747",
    gitPrState: "open",
    gitPrDraft: false,
    gitPrChecks: "passing",
    gitPrCheckedAt: Date.now(),
  });
}

/** Stub `/api/session-diff` with a fixed owned-file list (a synthetic session has no transcript to diff). */
export async function stubSessionDiff(page: Page, files = 2): Promise<void> {
  await page.route("**/api/session-diff*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          files: Array.from({ length: files }, (_, i) => ({
            path: `src/file-${i}.ts`,
            changes: [],
            origin: "edit",
            sessionOwned: true,
            previewable: true,
            additions: 3 + i,
            deletions: 1,
          })),
          isGitRepo: true,
          totalAdditions: 12,
          totalDeletions: 4,
        },
      }),
    }),
  );
}

/** Stub `/api/quota` so every session gets a Context lane (the harness has no provider credentials). */
export async function stubQuota(page: Page): Promise<void> {
  await page.route("**/api/quota", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          {
            provider: "anthropic",
            windows: [{ label: "5h", usedPercent: 14, resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), windowSeconds: 5 * 3600 }],
          },
        ],
        unavailable: [],
      }),
    }),
  );
}

/** `n` synthetic background processes (`kind: "task"`). */
export function fakeProcesses(n: number, base = 70_000): BridgeProcess[] {
  return Array.from({ length: n }, (_, i) => ({
    pid: base + i,
    pgid: base + i,
    command: `node worker-${i}.js`,
    elapsedMs: 5_000 + i * 1_000,
    kind: "task" as const,
  }));
}
