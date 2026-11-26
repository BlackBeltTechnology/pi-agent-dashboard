/**
 * Hook TOFU trust store (design D7): `<dataDir>/hook-trust.json`, one confirmation per
 * `realpath(cwd)` + sha256 of the canonical hook set (`hashHooks`). Fail closed: a missing, corrupt,
 * unreadable or wrong-shaped file means "no confirmations" (logged once); writes are serialised and
 * atomic (tmp + rename). Revocation only gates LATER starts; a running team's hooks are frozen on the
 * team record and are never read from here.
 * The REST routes (`POST`/`DELETE hook-trust`) and `team.start` are mounted by the start module on
 * top of the plain functions below (`trustHook`, `revokeHookTrust`, `decideHookTrust`).
 * See change: add-agent-teams-templates-hooks.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import type { HooksUntrustedDetails } from "../shared/protocol.js";
import type { TeamHooks } from "../shared/types.js";
import { hashHooks } from "./hook-hash.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";
import type { Logger } from "./types.js";

export const HOOK_TRUST_FILE = "hook-trust.json";

export interface HookTrustEntry {
  /** `realpath(cwd)`. */
  cwd: string;
  hash: string;
  /** Epoch ms of the confirmation. */
  at: number;
}

/** File operations (injectable for fault injection in tests). */
export interface HookTrustFs {
  readFile(file: string): Promise<string>;
  mkdir(dir: string): Promise<void>;
  writeFile(file: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
  realpath(p: string): Promise<string>;
}

export const nodeHookTrustFs: HookTrustFs = {
  readFile: (file) => fsp.readFile(file, "utf8"),
  mkdir: async (dir) => void (await fsp.mkdir(dir, { recursive: true, mode: 0o700 })),
  writeFile: (file, data) => fsp.writeFile(file, data, { encoding: "utf8", mode: 0o600 }),
  rename: (from, to) => fsp.rename(from, to),
  unlink: (file) => fsp.unlink(file),
  realpath: (p) => fsp.realpath(p),
};

export interface HookTrustStore {
  /** Whether a confirmation exists for `realpath(cwd)` + `hash`. */
  isTrusted(cwd: string, hash: string): Promise<boolean>;
  /** Record a confirmation (idempotent). Rejects when the file cannot be written; nothing is recorded then. */
  trust(cwd: string, hash: string): Promise<void>;
  /** Remove one confirmation, or (no `hash`) every one of the cwd. Resolves with the number removed. */
  revoke(cwd: string, hash?: string): Promise<number>;
  list(cwd?: string): Promise<HookTrustEntry[]>;
}

interface TrustFile {
  version: 1;
  entries: HookTrustEntry[];
}

function parseFile(raw: string): HookTrustEntry[] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entries = (json as Partial<TrustFile> | null)?.entries;
  if (!Array.isArray(entries)) return undefined;
  const out: HookTrustEntry[] = [];
  for (const e of entries as unknown[]) {
    const r = e as Partial<HookTrustEntry> | null;
    if (!r || typeof r.cwd !== "string" || typeof r.hash !== "string") return undefined;
    out.push({ cwd: r.cwd, hash: r.hash, at: typeof r.at === "number" ? r.at : 0 });
  }
  return out;
}

export interface HookTrustStoreOptions {
  /** Plugin data dir; the file is `<dataDir>/hook-trust.json`. */
  dataDir: string;
  logger: Logger;
  now?: () => number;
  fs?: HookTrustFs;
}

export function createHookTrustStore(opts: HookTrustStoreOptions): HookTrustStore {
  const fs = opts.fs ?? nodeHookTrustFs;
  const file = path.join(opts.dataDir, HOOK_TRUST_FILE);
  const now = opts.now ?? Date.now;
  let entries: HookTrustEntry[] | undefined;
  let tmpSeq = 0;
  /** Mutations run one at a time (no lost update across concurrent confirms/revokes). */
  let chain: Promise<unknown> = Promise.resolve();

  const realKey = async (cwd: string): Promise<string> => {
    try {
      return await fs.realpath(cwd);
    } catch {
      return path.resolve(cwd); // a moved/deleted project: its own (never matching) key
    }
  };

  async function load(): Promise<HookTrustEntry[]> {
    if (entries) return entries;
    try {
      const parsed = parseFile(await fs.readFile(file));
      if (parsed) entries = parsed;
      else {
        opts.logger.error(`agent-teams: ${HOOK_TRUST_FILE} is corrupt; treating every hook confirmation as missing`);
        entries = [];
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") entries = [];
      else {
        opts.logger.error(`agent-teams: ${HOOK_TRUST_FILE} is unreadable (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}); treating every hook confirmation as missing`);
        entries = [];
      }
    }
    return entries;
  }

  async function persist(next: HookTrustEntry[]): Promise<void> {
    await fs.mkdir(opts.dataDir);
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
    const body: TrustFile = { version: 1, entries: next };
    try {
      await fs.writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
    entries = next;
  }

  function mutate<T>(fn: (current: HookTrustEntry[]) => Promise<{ next: HookTrustEntry[]; out: T }>): Promise<T> {
    const run = chain.then(async () => {
      const { next, out } = await fn(await load());
      if (next !== entries) await persist(next);
      return out;
    });
    chain = run.catch(() => undefined);
    return run;
  }

  return {
    async isTrusted(cwd, hash) {
      const key = await realKey(cwd);
      await chain; // see the latest confirmed state
      return (await load()).some((e) => e.cwd === key && e.hash === hash);
    },
    trust(cwd, hash) {
      return mutate(async (current) => {
        const key = await realKey(cwd);
        if (current.some((e) => e.cwd === key && e.hash === hash)) return { next: current, out: undefined };
        return { next: [...current, { cwd: key, hash, at: now() }], out: undefined };
      });
    },
    revoke(cwd, hash) {
      return mutate(async (current) => {
        const key = await realKey(cwd);
        const next = current.filter((e) => !(e.cwd === key && (hash === undefined || e.hash === hash)));
        return { next: next.length === current.length ? current : next, out: current.length - next.length };
      });
    },
    async list(cwd) {
      await chain;
      const all = await load();
      if (cwd === undefined) return [...all];
      const key = await realKey(cwd);
      return all.filter((e) => e.cwd === key);
    },
  };
}

// ── Trust decisions (consumed by `team.start` and the REST routes) ─────────────

export type HookTrustFailure = { ok: false; error: "hash_mismatch"; hash: string } | ({ ok: false; error: "hooks_untrusted" } & HooksUntrustedDetails);

/** The `hooks_untrusted` details: the current hash and the exact commands the user must confirm. */
export function describeHooks(hooks: TeamHooks, defaultTimeoutMs: number): HooksUntrustedDetails {
  const rec = hooks as Record<string, Array<{ command: string; timeoutMs?: number }> | undefined>;
  const commands = Object.keys(rec)
    .sort()
    .flatMap((event) => (rec[event] ?? []).map((h) => ({ event, command: h.command, timeoutMs: h.timeoutMs ?? defaultTimeoutMs })));
  return { hash: hashHooks(hooks, defaultTimeoutMs), commands };
}

export interface DecideHookTrustInput {
  cwd: string;
  /** `user` hooks are trusted; `project` hooks need a confirmation. */
  source: "user" | "project" | "bundled";
  hooks: TeamHooks;
  /** Effective default `timeoutMs` (`effectiveHookTimeoutMs(config())`); part of the hash. */
  defaultTimeoutMs: number;
  /** The hash the user was shown in an earlier `hooks_untrusted` answer. */
  trustHooks?: string | undefined;
}

/**
 * `team.start` hook gate. No hooks or a non-project source ⇒ ok. A project hook set needs a stored
 * confirmation for `realpath(cwd)` + the CURRENT hash; with `trustHooks` equal to the current hash the
 * confirmation is recorded (then ok); a different `trustHooks` is `hash_mismatch` and records nothing.
 */
export async function decideHookTrust(store: HookTrustStore, input: DecideHookTrustInput): Promise<{ ok: true; hash?: string } | HookTrustFailure> {
  const empty = Object.values(input.hooks).every((list) => !list || list.length === 0);
  if (empty || input.source !== "project") return { ok: true };
  const details = describeHooks(input.hooks, input.defaultTimeoutMs);
  if (input.trustHooks !== undefined) {
    if (input.trustHooks !== details.hash) return { ok: false, error: "hash_mismatch", hash: details.hash };
    await store.trust(input.cwd, details.hash);
    return { ok: true, hash: details.hash };
  }
  if (await store.isTrusted(input.cwd, details.hash)) return { ok: true, hash: details.hash };
  return { ok: false, error: "hooks_untrusted", ...details };
}

/** `POST /hook-trust {cwd, hash}`: records only when `hash` is the hash the server currently computes (`currentHash`). */
export async function trustHook(store: HookTrustStore, input: { cwd: string; hash: string; currentHash: string | undefined }): Promise<{ ok: true } | { ok: false; error: "hash_mismatch" }> {
  if (input.currentHash === undefined || input.hash !== input.currentHash) return { ok: false, error: "hash_mismatch" };
  await store.trust(input.cwd, input.hash);
  return { ok: true };
}

/** `DELETE /hook-trust?cwd=&hash=`: no `hash` removes every confirmation of the cwd. */
export async function revokeHookTrust(store: HookTrustStore, input: { cwd: string; hash?: string | undefined }): Promise<{ removed: number }> {
  return { removed: await store.revoke(input.cwd, input.hash) };
}

const stores = new WeakMap<object, HookTrustStore>();

/** The one store of a runtime (memoised on the deps bag: every module sees the same instance and write chain). */
export function getHookTrustStore(deps: Pick<TemplatesHooksDeps, "dataDir" | "logger" | "clock">): HookTrustStore {
  let store = stores.get(deps);
  if (!store) {
    store = createHookTrustStore({ dataDir: deps.dataDir, logger: deps.logger, now: () => deps.clock.now() });
    stores.set(deps, store);
  }
  return store;
}

/** Creates the runtime's store (lazy file read); routes and `team.start` are mounted by the start module. */
export function registerHookTrust(deps: TemplatesHooksDeps): void {
  getHookTrustStore(deps);
}
