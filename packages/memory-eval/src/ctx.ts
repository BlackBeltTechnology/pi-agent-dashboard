import { homedir } from "node:os";
import { terminalConfirm } from "./confirm.js";
import type { ScrubRule } from "./scrub.js";
import type { SnapshotDeps } from "./snapshot.js";
import type { Out } from "./util.js";

/** Everything a command needs from its environment; tests inject fakes. */
export interface Ctx extends Out {
  /** Project dir (the checkout whose sessions are mined). */
  cwd: string;
  home: string;
  isTTY: boolean;
  /** Ask a yes/no question on the terminal. Absent => treated as "no". */
  confirm?: (question: string) => Promise<boolean>;
  /** argv prefix that launches `pi` (default `["pi"]`); tests point it at a stub. */
  piCommand: string[];
  snapshotDeps?: Partial<SnapshotDeps>;
  /** Per-search timeout for retriever adapters (default 30 s). */
  searchTimeoutMs?: number;
  /** Per-call judge timeout (default 120 s). */
  judgeTimeoutMs?: number;
  /** Judge prompt file (default: the repo's `prompts/judge.v1.md`). */
  promptPath?: string;
  /** Scrub rule table (default: the shipped rules). */
  scrubRules?: ScrubRule[];
  /** Override the hermes package root used for the version lookup. */
  hermesPackageDir?: string;
  /** Override `pi --version` output (tests). */
  piVersion?: string;
  /** Clock override (tests). */
  now?: () => Date;
}

export function defaultCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: process.cwd(),
    home: homedir(),
    isTTY: Boolean(process.stdin.isTTY),
    confirm: (q) => terminalConfirm(q),
    piCommand: ["pi"],
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    ...over,
  };
}
