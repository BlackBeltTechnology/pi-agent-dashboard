/**
 * macOS wake hook for `capture refresh`. OBS 31 screen captures freeze when the
 * Mac sleeps and never restart (see `refreshScreenCaptures`). A per-user
 * LaunchAgent runs `pi-obs wake-hook run`, which ticks every `tickMs` and treats
 * a wall-clock jump larger than `gapMs` as a wake (no sleepwatcher/IOKit
 * dependency). After `settleMs` (displays reconnect) it calls `onWake`, which
 * the CLI wires to `pi-dashboard service exec <id> -- pi-obs capture refresh`.
 * The plist carries no secret: the password is injected by `service exec`.
 * See change: add-obs-capture-refresh.
 */
import path from "node:path";

export const PLIST_LABEL = "com.blackbelt.pi-obs.wake-refresh";

export function plistPath(home: string): string {
  return path.join(home, "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
}

export interface WatchOptions {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onWake: (gapMs: number) => Promise<void>;
  log?: (line: string) => void;
  tickMs?: number;
  gapMs?: number;
  settleMs?: number;
  /** Stop after this many ticks (tests); unbounded when omitted. */
  maxTicks?: number;
}

export async function watchForWake(o: WatchOptions): Promise<void> {
  const tickMs = o.tickMs ?? 15_000;
  const gapMs = o.gapMs ?? 60_000;
  const settleMs = o.settleMs ?? 10_000;
  let last = o.now();
  for (let tick = 0; o.maxTicks === undefined || tick < o.maxTicks; tick++) {
    await o.sleep(tickMs);
    const t = o.now();
    const elapsed = t - last;
    last = t;
    if (elapsed - tickMs <= gapMs) continue;
    o.log?.(`[wake-hook] wake detected (clock gap ${Math.round(elapsed / 1000)} s); refreshing in ${settleMs / 1000} s`);
    await o.sleep(settleMs);
    try {
      await o.onWake(elapsed);
      o.log?.("[wake-hook] capture refresh done");
    } catch (e) {
      o.log?.(`[wake-hook] capture refresh failed: ${(e as Error).message}`);
    }
    last = o.now();
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderPlist(o: { nodePath: string; entryPath: string; service: string; pathEnv: string; logFile: string }): string {
  const args = [o.nodePath, o.entryPath, "wake-hook", "run", "--service", o.service];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(o.pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${esc(o.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(o.logFile)}</string>
</dict>
</plist>
`;
}
