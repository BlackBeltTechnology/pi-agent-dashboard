/**
 * `pi-obs stop` — explicit, warned, local only (design D5, spike F2: every
 * external stop of OBS 32.2.2 crashed during teardown, 3/3).
 * Refuses any service other than the local `attached` one. Resolves the OBS
 * pid with the managed-services exact-basename matcher, sends the per-OS quit
 * (darwin `osascript quit app "OBS"`, win32 `taskkill /PID`, linux `kill -TERM
 * <pid>`), and judges success ONLY by that pid exiting within 15 s — never by
 * the quit command's rc (osascript returned 1 on a real quit). No force-kill
 * without `--force`. Afterwards `pi-dashboard service status <id>` re-probes.
 * Before quitting it stops active stream/record/virtual-camera outputs over
 * obs-websocket (`stopOutputs`): with one running, OBS opens an exit-confirm
 * modal, the outside quit is cancelled (osascript -128) and the modal may sit
 * on an off-screen window. An output that stays active refuses the quit
 * (`output-active`); an unreachable websocket only warns.
 * See change: add-obs-studio-plugin.
 */
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { DashboardCli } from "./dashboard-cli.js";
import { ObsError } from "./errors.js";
import type { Platform } from "./paths.js";

const STOP_TIMEOUT_MS = 15_000;
const STOP_WARNING = "OBS 32 may crash when it is quit from outside; the next `pi-dashboard service start` recovers automatically.";

export interface StopDeps {
  serviceId: string;
  defs: readonly ServiceDefinition[];
  platform: Platform;
  confirm: (question: string) => Promise<boolean>;
  findObs: () => Promise<number[]>;
  run: (file: string, args: string[]) => Promise<{ code: number }>;
  isAlive: (pid: number) => boolean;
  /** Force-kill (only with `--force`). */
  forceKill: (pid: number) => Promise<void>;
  cli: DashboardCli;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  warn: (line: string) => void;
  force?: boolean;
  timeoutMs?: number;
  /** Stop active outputs over obs-websocket; throws when OBS is unreachable. */
  stopOutputs?: () => Promise<{ stopped: string[]; stillActive: string[] }>;
}

export interface StopResult {
  stopped: boolean;
  pid?: number;
  forced?: boolean;
  notRunning?: boolean;
  /** Outputs stopped before the quit; absent when the websocket was unreachable. */
  outputsStopped?: string[];
}

function quitArgv(platform: Platform, pid: number): string[] {
  if (platform === "darwin") return ["osascript", "-e", 'quit app "OBS"'];
  if (platform === "win32") return ["taskkill", "/PID", String(pid)];
  return ["kill", "-TERM", String(pid)];
}

/** Stopped output names; `undefined` when unreachable (warned) or not wired. */
async function stopOutputsBeforeQuit(d: StopDeps): Promise<string[] | undefined> {
  if (!d.stopOutputs) return undefined;
  let r: { stopped: string[]; stillActive: string[] };
  try {
    r = await d.stopOutputs();
  } catch (e) {
    d.warn(
      `could not reach obs-websocket (${(e as Error).message}); stop streaming, recording and the virtual camera in OBS first, otherwise OBS asks to confirm and the quit times out. Run as \`pi-dashboard service exec ${d.serviceId} -- pi-obs stop --service ${d.serviceId}\` to stop them automatically.`,
    );
    return undefined;
  }
  if (r.stillActive.length > 0) {
    throw new ObsError("output-active", `outputs still active after stop: ${r.stillActive.join(", ")}; OBS would block the quit`, { stillActive: r.stillActive });
  }
  return r.stopped;
}

export async function stopObs(d: StopDeps): Promise<StopResult> {
  const def = d.defs.find((x) => x.id === d.serviceId);
  if (def?.mode !== "attached") {
    throw new ObsError("refused", `pi-obs stop only quits the local OBS (an attached service); ${d.serviceId} is ${def ? `${def.mode}` : "not a known service"}`);
  }
  d.warn(STOP_WARNING);
  if (!(await d.confirm("Quit the local OBS now?"))) throw new ObsError("refused", "stop not confirmed");
  const pid = (await d.findObs())[0];
  if (pid === undefined) return { stopped: true, notRunning: true };

  const outputsStopped = await stopOutputsBeforeQuit(d);

  const argv = quitArgv(d.platform, pid);
  await d.run(argv[0], argv.slice(1)).catch(() => ({ code: 1 }));
  const deadline = d.now() + (d.timeoutMs ?? STOP_TIMEOUT_MS);
  let stopped = false;
  for (;;) {
    if (!d.isAlive(pid)) {
      stopped = true;
      break;
    }
    if (d.now() >= deadline) break;
    await d.sleep(250);
  }
  let forced = false;
  if (!stopped && d.force) {
    await d.forceKill(pid);
    forced = true;
    stopped = !d.isAlive(pid);
  }
  await d.cli.run(["service", "status", d.serviceId]).catch(() => undefined);
  return { stopped, pid, ...(forced ? { forced } : {}), ...(outputsStopped ? { outputsStopped } : {}) };
}
