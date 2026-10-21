/**
 * attach-evaluation.ts — the single attach-arm evaluation: one `/api/health`
 * fetch → zombie classification → expected-runtime resolution → pure
 * `decideAttachAction` → at most one modal. Fire-and-forget (the window opens
 * first). All I/O is injected so the flow is unit-testable; `main.ts` wires it.
 *
 * Restart goes through `requestServerLaunch({ force: true })` (graceful, PID-
 * confirmed). The result is verified: the app never reports a version it did
 * not actually start.
 *
 * test-plan: X8–X15, P1. See change: electron-attach-version-skew (D3, D4, D5).
 */
import {
  type AttachHealth,
  decideAttachAction,
  decideIsZombie,
  dismissalLaunchSource,
  type HealthLaunchSourceEffective,
  type LaunchOutcome,
  normalizeVersion,
  type VersionSkewPair,
} from "./server-lifecycle.js";
import type {
  MergedZombieSkewChoice,
  SkewInfoChoice,
  SkewRestartChoice,
  ZombieChoice,
} from "./zombie-adoption-dialog.js";

export interface AttachEvaluationDeps {
  shellVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** `--no-zombie-prompt`: decide and log, never show a modal. */
  noPrompt: boolean;
  /** Parsed `/api/health` body, or null when unreachable / non-200. */
  fetchHealth: () => Promise<Record<string, unknown> | null>;
  /** Version a cold launch would start; never throws (null = unknown). */
  resolveExpected: () => Promise<{ version: string | null }>;
  getStoredSpawnedPid: () => number | null;
  setSpawnedPid: (pid: number) => void;
  readDismissals: () => VersionSkewPair[];
  addDismissal: (pair: VersionSkewPair) => void;
  dialogs: {
    zombie: (p: { pid: number }) => Promise<ZombieChoice>;
    restart: (p: { server: string; expected: string; restartIsDefault: boolean }) => Promise<SkewRestartChoice>;
    merged: (p: { pid: number; server: string; expected: string }) => Promise<MergedZombieSkewChoice>;
    info: (p: { server: string; expected: string; shellVersion: string; launchSource: string | undefined }) => Promise<SkewInfoChoice>;
    notify: (p: { title: string; message: string; error?: boolean }) => Promise<void>;
  };
  /** Zombie "Stop now": confirmed-death kill of the PID. */
  stopZombie: (pid: number) => Promise<boolean>;
  /** After a confirmed zombie stop: respawn the current runtime and reload the window. */
  respawnAndReload: () => Promise<void>;
  requestServerLaunch: (opts: { force: true }) => Promise<LaunchOutcome>;
  /** Reload the main window against the (new) server. */
  reloadWindow: () => void;
  /** Show the loading / recovery page. */
  showRecovery: () => void;
  log: (msg: string) => void;
}

export interface AttachEvaluator {
  evaluate: () => Promise<void>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function toAttachHealth(body: Record<string, unknown>): AttachHealth {
  return {
    version: str(body.version),
    launchSource: str(body.launchSource),
    launchSourceEffective: str(body.launchSourceEffective),
    starter: str(body.starter),
    bootParentAlive: typeof body.bootParentAlive === "boolean" ? body.bootParentAlive : undefined,
  };
}

/** Identity of the server a modal was raised for; a changed identity aborts the restart. */
interface ServerIdentity {
  pid: number | undefined;
  bootParentPid: number | undefined;
  launchSourceEffective: string | undefined;
}

const identityOf = (b: Record<string, unknown>): ServerIdentity => ({
  pid: num(b.pid),
  bootParentPid: num(b.bootParentPid),
  launchSourceEffective: str(b.launchSourceEffective),
});

const sameIdentity = (a: ServerIdentity, b: ServerIdentity): boolean =>
  a.pid === b.pid && a.bootParentPid === b.bootParentPid && a.launchSourceEffective === b.launchSourceEffective;

/**
 * Create an evaluator. "Leave running" / "OK" suppress further prompts for the
 * lifetime of THIS evaluator (one per Electron launch); a fresh evaluator asks again.
 */
export function createAttachEvaluator(deps: AttachEvaluationDeps): AttachEvaluator {
  let askedThisLifetime = false;

  async function restartServer(snapshot: ServerIdentity, expected: string): Promise<void> {
    const notify = (message: string, error = true) =>
      deps.dialogs.notify({ title: "Dashboard server restart", message, error });

    const fresh = await deps.fetchHealth();
    if (!fresh || !sameIdentity(identityOf(fresh), snapshot)) {
      deps.log("[attach-check] restart aborted: server identity changed");
      await notify("The dashboard server changed while the dialog was open, so the restart did not complete. No server was stopped.");
      return;
    }
    if (normalizeVersion(str(fresh.version)) === expected) {
      deps.log("[attach-check] restart skipped: server already at the expected version");
      await notify(`The dashboard server is already up to date (v${expected}).`, false);
      return;
    }

    const outcome = await deps.requestServerLaunch({ force: true });
    if (outcome.kind === "failed") {
      deps.log(`[attach-check] restart failed: ${outcome.reason}`);
      await notify(`The dashboard server restart did not complete: ${outcome.reason}`);
      // Old server gone → the page has nothing to talk to: show recovery. Otherwise keep the current page.
      if ((await deps.fetchHealth()) === null) deps.showRecovery();
      return;
    }

    const after = await deps.fetchHealth();
    const spawned = deps.getStoredSpawnedPid();
    if (!after || spawned === null || num(after.pid) !== spawned || str(after.launchSourceEffective) !== "electron") {
      deps.log("[attach-check] restart verification failed: running server is not the one this app started");
      deps.showRecovery();
      return;
    }
    const running = normalizeVersion(str(after.version));
    if (running !== expected) {
      await notify(`The dashboard server was restarted, but v${running ?? "unknown"} is running instead of v${expected}.`);
    }
    deps.reloadWindow();
  }

  async function handleZombie(pid: number): Promise<void> {
    const choice = await deps.dialogs.zombie({ pid });
    if (choice === "adopt") {
      deps.setSpawnedPid(pid);
      deps.log(`[zombie] adopted PID ${pid}`);
      return;
    }
    if (choice === "leave") {
      askedThisLifetime = true;
      deps.log("[zombie] left running, will prompt next launch");
      return;
    }
    deps.log(`[zombie] stopping PID ${pid} and respawning`);
    if (!(await deps.stopZombie(pid))) {
      deps.log(`[zombie] PID ${pid} survived the kill ladder; not starting a new server`);
      await deps.dialogs.notify({
        title: "Leftover server could not be stopped",
        message: `The leftover dashboard server (PID ${pid}) is still running, so no new server was started.`,
        error: true,
      });
      return;
    }
    try {
      await deps.respawnAndReload();
    } catch (err) {
      deps.log(`[zombie] respawn failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function evaluate(): Promise<void> {
    try {
      await evaluateOnce();
    } catch (err) {
      deps.log(`[attach-check] evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function evaluateOnce(): Promise<void> {
    if (askedThisLifetime) return;
    const body = await deps.fetchHealth();
    if (!body) {
      deps.log("[attach-check] skipped reason=health-unreachable");
      return;
    }
    const health = toAttachHealth(body);
    const pid = num(body.pid);
    const isZombie = decideIsZombie({
      healthLaunchSourceEffective: (health.launchSourceEffective as HealthLaunchSourceEffective | undefined) ?? null,
      healthPid: pid,
      healthPpid: num(body.ppid),
      healthBootParentPid: num(body.bootParentPid),
      healthBootParentAlive: health.bootParentAlive,
      storedSpawnedPid: deps.getStoredSpawnedPid(),
      platform: deps.platform,
    });

    let expectedRaw: string | null = null;
    try {
      expectedRaw = (await deps.resolveExpected()).version;
    } catch {
      expectedRaw = null;
    }
    const dismissed = deps.readDismissals();
    const decision = decideAttachAction({
      health,
      expectedVersion: expectedRaw,
      isZombie,
      isPackaged: deps.isPackaged,
      isDismissed: (p) => dismissed.some((d) => d.server === p.server && d.expected === p.expected && d.launchSource === p.launchSource),
    });
    deps.log(
      `[attach-check] server=${JSON.stringify(health.version ?? null)} (${normalizeVersion(health.version) ?? "unknown"}) ` +
        `expected=${JSON.stringify(expectedRaw)} (${normalizeVersion(expectedRaw) ?? "unknown"}) ` +
        `launchSource=${dismissalLaunchSource(health)} effective=${health.launchSourceEffective ?? "unknown"} ` +
        `zombie=${isZombie} action=${decision.action}`,
    );
    if (decision.action === "none") return;
    if (isZombie && pid !== undefined) deps.log(`[zombie] detected leftover server PID ${pid}`);
    if (deps.noPrompt) {
      deps.log("[attach-check] --no-zombie-prompt set; skipping modal");
      return;
    }

    const server = normalizeVersion(health.version) ?? "unknown";
    const expected = normalizeVersion(expectedRaw) ?? "unknown";
    const snapshot = identityOf(body);

    switch (decision.action) {
      case "zombie":
        if (pid !== undefined) await handleZombie(pid);
        return;
      case "skew-zombie-merged": {
        if (pid === undefined) return;
        const choice = await deps.dialogs.merged({ pid, server, expected });
        if (choice === "restart") await restartServer(snapshot, expected);
        else if (choice === "adopt") {
          deps.setSpawnedPid(pid);
          deps.log(`[zombie] adopted PID ${pid}`);
        } else askedThisLifetime = true;
        return;
      }
      case "skew-restart": {
        const choice = await deps.dialogs.restart({ server, expected, restartIsDefault: decision.restartIsDefault });
        if (choice === "restart") await restartServer(snapshot, expected);
        else askedThisLifetime = true;
        return;
      }
      case "skew-info": {
        const launchSource = dismissalLaunchSource(health);
        const choice = await deps.dialogs.info({
          server,
          expected,
          shellVersion: deps.shellVersion,
          launchSource: dismissalLaunchSource(health),
        });
        if (choice === "dismiss") deps.addDismissal({ server, expected, launchSource });
        askedThisLifetime = true;
        return;
      }
    }
  }

  return { evaluate };
}
