/**
 * Per-session "recently denied" map (D5): after a Deny / dismiss / timeout, any
 * gated call under the same lexical parent directory is blocked without a prompt
 * for 120 s. Keyed on the lexical parent, so a not-yet-existing `/w/newproj1/a`
 * keys `/w/newproj1`, never the shared ancestor `/w`.
 * Consulted AFTER the YOLO ask (a live YOLO session overrides an unremembered
 * Deny/timeout; a remembered refusal answers `refused`) and again inside the mutex.
 * See change: harden-path-and-process-guards (#1115).
 * See change: ask-agent-file-access-in-chat.
 */
const SUPPRESSION_MS = 120_000;

export class Suppression {
  private denied = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  deny(key: string): void {
    this.denied.set(key, this.now() + SUPPRESSION_MS);
  }

  isSuppressed(key: string): boolean {
    const until = this.denied.get(key);
    if (until === undefined) return false;
    if (this.now() >= until) {
      this.denied.delete(key);
      return false;
    }
    return true;
  }
}
