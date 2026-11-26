/**
 * Advisory shell-command checks for the teammate `tool_call` guard (tasks 9.6,
 * 9.9; design D11): the sleep-poll guard (GNU `sleep` durations) and the git-write
 * guard. Both only look at the SIMPLE-command structure of a `bash` command line;
 * with `bash` allowed they are advisory (a script, `$(…)` indirection or `bash -c`
 * is deliberately NOT chased — pinned by `guard.test.ts`).
 * See change: add-agent-teams-core.
 */

/** A teammate with nothing to claim ends its turn; the reason the sleep guard returns. */
export const SLEEP_REASON = "nothing to claim → end your turn (do not busy-wait; you are woken when mail or work arrives)";
export const GIT_WRITE_REASON = "git writes are lead-only here: the lead commits. Leave your changes in the working tree and report them in your task result";

/** Total seconds at or above which a bare `sleep` is refused. */
const SLEEP_BLOCK_SECONDS = 10;

/**
 * Split a command line into simple commands at `; & | ( ) `` ` `` and newlines (outside quotes) and
 * word-split each one (quotes removed). Empty commands are dropped.
 */
export function splitSimpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | undefined;
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i);
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command.charAt(++i);
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command.charAt(++i);
      inWord = true;
    } else if (/\s/.test(c) && c !== "\n") {
      endWord();
    } else if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")" || c === "`" || c === "\n") {
      endCommand();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
const DURATION = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?([smhd])?$/;

/** One GNU `sleep` operand in seconds; `undefined` when it is not a duration. `infinity` is infinite. */
function durationSeconds(token: string): number | undefined {
  if (/^(inf|infinity)$/i.test(token)) return Number.POSITIVE_INFINITY;
  const m = DURATION.exec(token);
  if (!m) return undefined;
  const base = Number(`${m[1]}${m[2] ?? ""}`);
  return Number.isFinite(base) ? base * (UNIT_SECONDS[m[3] ?? "s"] ?? 1) : undefined;
}

const baseName = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

/** True when the whole command is a bare `sleep` whose operands total at least `SLEEP_BLOCK_SECONDS`. */
export function isSleepPoll(command: string): boolean {
  const commands = splitSimpleCommands(command);
  if (commands.length !== 1) return false;
  const [head, ...operands] = commands[0] as string[];
  if (head === undefined || baseName(head) !== "sleep" || operands.length === 0) return false;
  let total = 0;
  for (const op of operands) {
    const s = durationSeconds(op);
    if (s === undefined) return false; // not a duration: let the shell report it
    total += s;
  }
  return total >= SLEEP_BLOCK_SECONDS;
}

const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
const WRAPPERS = new Set(["env", "command", "exec", "time", "nohup"]);
const MAX_UNWRAP_DEPTH = 3;

function gitWriteIn(args: readonly string[]): boolean {
  let i = 0;
  while (i < args.length) {
    const a = args[i] as string;
    if (GIT_OPTIONS_WITH_VALUE.has(a)) i += 2;
    else if (a.startsWith("-")) i += 1;
    else break;
  }
  const sub = args[i];
  if (sub === undefined) return false;
  if (sub === "commit" || sub === "push" || sub === "rebase" || sub === "merge") return true;
  return sub === "reset" && args.slice(i + 1).includes("--hard");
}

function simpleCommandWritesGit(tokens: readonly string[], depth: number): boolean {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) i += 1;
    else if (WRAPPERS.has(baseName(t))) {
      i += 1;
      if (baseName(t) === "env") while (i < tokens.length && ((tokens[i] as string).startsWith("-") || (tokens[i] as string).includes("="))) i += 1;
    } else break;
  }
  const head = tokens[i];
  if (head === undefined) return false;
  const word = baseName(head);
  if (word === "git") return gitWriteIn(tokens.slice(i + 1));
  if (word === "sh" && tokens[i + 1] === "-c" && tokens[i + 2] !== undefined && depth < MAX_UNWRAP_DEPTH) {
    return commandWritesGit(tokens[i + 2] as string, depth + 1);
  }
  return false;
}

/**
 * Does a shell command line run `git commit|push|rebase|merge|reset --hard` as a simple command
 * (also through `sh -c`, env assignments, `env`, `command`, `exec`)? `echo git commit` is not a git run.
 */
export function commandWritesGit(command: string, depth = 0): boolean {
  return splitSimpleCommands(command).some((tokens) => simpleCommandWritesGit(tokens, depth));
}
