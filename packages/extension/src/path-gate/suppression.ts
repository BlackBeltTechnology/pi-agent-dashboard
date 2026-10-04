/**
 * Per-session "recently denied" map (D5): after a Deny / dismiss / timeout, any
 * gated call under the same lexical parent directory is blocked without a prompt
 * for 120 s. Keyed on the lexical parent, so a not-yet-existing `/w/newproj1/a`
 * keys `/w/newproj1`, never the shared ancestor `/w`.
 * See change: ask-agent-file-access-in-chat.
 */
const SUPPRESSION_MS = 120_000;

export class Suppression {
  private denied = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  deny(key: string): void {
    this.denied.set(key, this.now() + SUPPRESSION_MS);
  }

  /** Forget every denial (session switch: suppression is per session). */
  clear(): void {
    this.denied.clear();
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
