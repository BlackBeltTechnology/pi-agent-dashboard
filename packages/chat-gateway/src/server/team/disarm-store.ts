/**
 * Durable record of the disarm latch (task 11.3).
 *
 * The latch is deliberately NOT part of the plugin config: a chat-initiated
 * disarm must not write config, because the dashboard is the only config writer.
 * But the spec says the layer stays disarmed until an OPERATOR re-arms it, and
 * in-memory state does not survive a restart — so the latch gets its own file. A
 * safety halt that a bounce silently undoes is worse than no halt at all,
 * because the operator believes it still holds.
 *
 * See change: add-chat-gateway-team-controls.
 */
import fs from "node:fs";
import path from "node:path";

export interface DisarmStore {
  /**
   * The persisted latch, or `undefined` when nothing was ever persisted — the
   * distinction is load-bearing. `undefined` means "no opinion, seed from
   * config"; `false` is a real transition (a dashboard re-arm) that must not be
   * overridden by a stale `disarmed: true` in config.
   */
  load(): boolean | undefined;
  /** Best-effort. Never throws; see the note in the implementation. */
  save(disarmed: boolean): void;
}

export function createDisarmStore(deps: { filePath?: string }): DisarmStore {
  const { filePath } = deps;
  return {
    load() {
      if (!filePath) return undefined;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const value = (parsed as { disarmed?: unknown } | null)?.disarmed;
        return typeof value === "boolean" ? value : undefined;
      } catch {
        // Missing or corrupt -> `undefined`, so boot falls back to config rather
        // than failing. An unreadable latch file must not keep the bot down.
        return undefined;
      }
    },
    save(disarmed) {
      if (!filePath) return;
      try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, `${JSON.stringify({ disarmed })}\n`, { mode: 0o600 });
        fs.renameSync(tmp, filePath);
      } catch {
        // Best effort, and deliberately swallowed: this runs on the MESSAGE path
        // (a chat disarm, or a dashboard write). Throwing would turn a full disk
        // or a read-only state dir into a bot that stops answering every message
        // — a far worse failure than a latch that fails to persist. The next
        // successful save keeps the file correct.
      }
    },
  };
}
