/**
 * Redaction of git-derived text (error / message / stderr) before it reaches a client.
 *
 * Rules, applied in this order:
 *   1. strip URL userinfo from `http(s)://user:pw@host` (password-less `user@` too);
 *      `ssh://user:pw@host` keeps the user, drops the password; scp-form is untouched;
 *   2. mask specific token shapes only (`sk-`, `ghp_`, `github_pat_`, `glpat-`, `Bearer`) to
 *      their prefix + `***` — deliberately NOT a generic long-blob rule, so 40-hex commit SHAs
 *      survive;
 *   3. absolute paths under the operation's repository root become repo-relative (root → `.`);
 *   4. absolute paths under the home directory become `~/…`;
 *   5. any other absolute path (POSIX or drive-letter) becomes `<path>`.
 *
 * Pure and linear-time: every pattern is anchored on a literal prefix and uses bounded or
 * single-pass character classes (no nested quantifiers). Never throws.
 *
 * See change: harden-git-terminal-plugin-boundaries (B20).
 */

import os from "node:os";

export interface RedactContext {
  /** The repository / worktree root the git operation ran in. Captured at operation time. */
  root?: string;
  /** Home directory (default: `os.homedir()`). Pass `""` to disable the `~` rule. */
  home?: string;
}

/** `http(s)://[userinfo@]host` — userinfo runs to the LAST `@` of the authority (a raw `@` may sit in a password). */
const HTTP_USERINFO = /(https?:\/\/)[^\s/]*@/gi;
/** `ssh://user:password@host` → `ssh://user@host`. */
const SSH_PASSWORD = /(ssh:\/\/[^\s/:@]*):[^\s/]*@/gi;
/** Token shapes: prefix + >= 20 `[A-Za-z0-9_-]`, with a non-word character (or start) before the prefix. */
const TOKEN = /(?<![A-Za-z0-9_])(sk-|ghp_|github_pat_|glpat-)[A-Za-z0-9_-]{20,}/g;
const BEARER = /\b(Bearer)[ \t]+[A-Za-z0-9._~+/=-]+/gi;
/**
 * An absolute path: POSIX `/…` after start / whitespace / an opening or quoting character (never
 * after `:` or a word character, so `https://host/x`, `git@h:o/r.git` and `a/b` are not paths), or a
 * drive-letter `D:\…` / `D:/…`. The body stops at whitespace, quotes, brackets and `:` so a
 * `path:line:col` suffix survives.
 */
const ABS_PATH =
  /(?<=^|[\s"'`(\[{=,;<>|]|file:\/\/)\/[^\s"'`<>|*?:,;()[\]{}]*|(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`<>|*?:,;()[\]{}]*/g;
const TRAILING_PUNCT = /[.!?]+$/;

function stripTrailingSep(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, "") || p.slice(0, 1) : p;
}

/** If `p` is `base` or lies inside it, the remainder (without a leading separator); else `undefined`. */
function under(p: string, base: string | undefined): string | undefined {
  if (!base) return undefined;
  const b = stripTrailingSep(base);
  if (b.length === 0) return undefined;
  const windows = /^[A-Za-z]:/.test(b) || b.includes("\\");
  const norm = (s: string) => (windows ? s.replace(/\\/g, "/").toLowerCase() : s);
  const np = norm(p);
  const nb = norm(b);
  if (np === nb) return "";
  const prefix = nb.endsWith("/") ? nb : `${nb}/`;
  if (np.startsWith(prefix)) return p.slice(prefix.length);
  return undefined;
}

function redactPath(p: string, root: string | undefined, home: string | undefined): string {
  const rel = under(p, root);
  if (rel !== undefined) return rel === "" ? "." : rel;
  const homeRel = under(p, home);
  if (homeRel !== undefined) return homeRel === "" ? "~" : `~/${homeRel}`;
  return "<path>";
}

/** Best-effort text of an unknown thrown value (Error → message, string as is, else empty). */
export function gitErrorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

function toText(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input)) return input.toString("utf-8");
  if (input instanceof Error) return input.message ?? "";
  return gitErrorText(input);
}

function homeDir(ctx: RedactContext): string | undefined {
  if (ctx.home !== undefined) return ctx.home || undefined;
  try {
    return os.homedir() || undefined;
  } catch {
    return undefined;
  }
}

/** Redact `input` per the module rules. Never throws; `""`/nullish → `""`. */
export function redactGitText(input: unknown, ctx: RedactContext = {}): string {
  try {
    let text = toText(input);
    if (text.length === 0) return "";
    const root = ctx.root || undefined;
    const home = homeDir(ctx);
    if (text.includes("://")) {
      text = text.replace(HTTP_USERINFO, "$1").replace(SSH_PASSWORD, "$1@");
    }
    text = text.replace(TOKEN, "$1***").replace(BEARER, "$1 ***");
    if (text.includes("/") || text.includes(":\\")) {
      text = text.replace(ABS_PATH, (match) => {
        const tail = TRAILING_PUNCT.exec(match)?.[0] ?? "";
        const body = tail ? match.slice(0, match.length - tail.length) : match;
        if (body.length <= 1) return match; // a lone "/" is not a path
        return redactPath(body, root, home) + tail;
      });
    }
    return text;
  } catch {
    // Fail closed: never echo the unredacted text if redaction itself failed.
    return "";
  }
}
