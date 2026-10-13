// Local commit indexing (design G2): a fingerprint over refs + worktree HEADs, a
// streamed incremental `git log --stdin` walk (new tips positive, recorded tips
// `^sha`), applied in bounded pages inside fenced write transactions.
import { createHash } from "node:crypto";
import type { GitConfig } from "../config.js";
import type { Chunk, KbStore } from "../types.js";
import type { GitScopeDeps } from "./deps.js";
import type { GitLease } from "./lease.js";
import { buildEdges, type LinkCtx } from "./links.js";
import { GIT_ROOT, metaDelete, metaGet, metaJson, metaSet, metaSetJson } from "./store.js";

const PAGE_MAX_COMMITS = 500;
const PAGE_MAX_MS = 1000;

interface CommitRecord {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  paths: string[];
}

export interface Fingerprint {
  fp: string;
  tips: string[];
}

/** Hash of `for-each-ref` (heads, remotes, tags) plus every worktree HEAD; one local exec each. */
export function fingerprint(deps: GitScopeDeps, cwd: string): Fingerprint {
  const fmt = "%(objecttype) %(objectname) %(*objecttype) %(*objectname) %(refname)";
  const refs = deps.git(["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes", "refs/tags"], cwd);
  const tips = new Set<string>();
  for (const line of refs.split("\n")) {
    const [type, name, ptype, pname] = line.split(" ");
    if (type === "commit" && name) tips.add(name);
    else if (type === "tag" && ptype === "commit" && pname) tips.add(pname);
  }
  let wt = "";
  try {
    wt = deps.git(["worktree", "list", "--porcelain"], cwd);
  } catch { /* old git without worktree list: refs only */ }
  const heads: string[] = [];
  for (const line of wt.split("\n")) {
    const m = /^HEAD ([0-9a-f]{40,64})$/.exec(line);
    if (m) {
      tips.add(m[1]);
      heads.push(m[1]);
    }
  }
  const fp = createHash("sha256").update(refs).update("\0").update(heads.sort().join("\n")).digest("hex");
  return { fp, tips: [...tips].sort() };
}

/** Streaming parser for `%x00%H%x00%an%x00%aI%x00%s%x00%b%x00` + `--name-only` output:
 *  a leading empty token, then groups of 6 NUL-terminated tokens (the 6th, the paths
 *  blob, ends at the next record's NUL or at EOF). Invalid UTF-8 → U+FFFD. */
class CommitStreamParser {
  private carry: Buffer = Buffer.alloc(0);
  private tokens: string[] = [];
  private first = true;
  private readonly dec = new TextDecoder("utf-8");
  private readonly maxPaths: number;
  constructor(maxPaths: number) {
    this.maxPaths = maxPaths;
  }

  push(chunk: Buffer): CommitRecord[] {
    const buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const out: CommitRecord[] = [];
    let start = 0;
    for (let i = buf.indexOf(0, start); i !== -1; i = buf.indexOf(0, start)) {
      this.take(this.dec.decode(buf.subarray(start, i)), out);
      start = i + 1;
    }
    this.carry = Buffer.from(buf.subarray(start));
    return out;
  }
  end(): CommitRecord[] {
    const out: CommitRecord[] = [];
    if (this.carry.length) this.take(this.dec.decode(this.carry), out);
    this.carry = Buffer.alloc(0);
    return out;
  }
  private take(tok: string, out: CommitRecord[]): void {
    if (this.first) {
      this.first = false; // the empty token before the first record
      return;
    }
    this.tokens.push(tok);
    if (this.tokens.length === 6) {
      const [sha, author, date, subject, body, names] = this.tokens;
      this.tokens = [];
      out.push({ sha, author, date, subject, body, paths: names.split("\n").filter(Boolean).slice(0, this.maxPaths) });
    }
  }
}

function commitChunk(c: CommitRecord): Chunk {
  const path = `commit/${c.sha}`;
  const body = [
    `commit ${c.sha}`,
    `Author: ${c.author}`,
    `Date: ${c.date}`,
    "",
    c.subject,
    ...(c.body.trim() ? ["", c.body.trim()] : []),
    ...(c.paths.length ? ["", `Changed paths (${c.paths.length}):`, ...c.paths] : []),
  ].join("\n");
  return {
    root: GIT_ROOT,
    path,
    chunkId: `${path}#0`,
    headingPath: `commit ${c.sha.slice(0, 7)} · ${c.date.slice(0, 10)} · ${c.author} > ${c.subject}`,
    heading: c.subject,
    level: 0,
    parentChunkId: null,
    docType: "doc",
    body,
    bodyHash: createHash("sha256").update(body).digest("hex"),
  };
}

export interface IngestArgs {
  deps: GitScopeDeps;
  cwd: string;
  cfg: GitConfig;
  store: KbStore;
  lease: GitLease;
  link: LinkCtx;
  signal: AbortSignal;
}
export interface IngestResult {
  indexed: number;
  reset: boolean;
}

class WalkFailed extends Error {
  readonly stderr: string;
  constructor(stderr: string) {
    super(stderr.trim().split("\n").pop() || "git log failed");
    this.stderr = stderr;
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Apply records in pages bounded by PAGE_MAX_COMMITS / PAGE_MAX_MS of write time, one fenced tx each. */
async function applyPage(a: IngestArgs, records: CommitRecord[]): Promise<void> {
  let i = 0;
  while (i < records.length) {
    a.lease.fenced((db) => {
      const t0 = Date.now();
      while (i < records.length && Date.now() - t0 < PAGE_MAX_MS) {
        const rec = records[i];
        const chunk = commitChunk(rec);
        a.store.replaceItem!(GIT_ROOT, chunk.path, [chunk], buildEdges(db, chunk.path, `${rec.subject}\n${rec.body}`, a.link));
        i++;
      }
    });
    await tick();
  }
}

function walk(a: IngestArgs, tips: string[], recorded: string[], first: boolean): Promise<number> {
  const fmt = "--format=%x00%H%x00%an%x00%aI%x00%s%x00%b%x00";
  const args = ["-c", "core.quotepath=false", "log", "--stdin", "--no-color", "--encoding=UTF-8", "--no-renames", "--name-only", fmt];
  if (first) args.push(`--max-count=${a.cfg.commits.maxInitial}`);
  return new Promise<number>((resolve, reject) => {
    const child = a.deps.spawnGit(args, a.cwd);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 4096) stderr += d.toString("utf8");
    });
    const onAbort = () => child.kill("SIGTERM");
    a.signal.addEventListener("abort", onAbort, { once: true });
    child.stdin.on("error", () => {});
    // positive tips, then `^<recorded tip>` — `--not --stdin` would NOT negate stdin lines
    child.stdin.end(`${[...tips, ...recorded.map((t) => `^${t}`)].join("\n")}\n`);

    const parser = new CommitStreamParser(a.cfg.commits.maxPathsPerCommit);
    let indexed = 0;
    let batch: CommitRecord[] = [];
    let chain: Promise<void> = Promise.resolve();
    let failed: unknown;
    const enqueue = (records: CommitRecord[]) => {
      batch.push(...records);
      if (batch.length < PAGE_MAX_COMMITS || failed) return;
      const page = batch;
      batch = [];
      chain = chain.then(async () => {
        if (failed) return;
        try {
          await applyPage(a, page);
          indexed += page.length;
        } catch (e) {
          failed = e;
          child.kill("SIGTERM");
        }
      });
    };
    child.stdout.on("data", (d: Buffer) => {
      enqueue(parser.push(d));
      // backpressure: stop reading while a page is being applied
      child.stdout.pause();
      chain.then(() => child.stdout.resume());
    });
    child.on("error", (e) => {
      // spawn failure (no git): no stream will drain, so settle here
      a.signal.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      a.signal.removeEventListener("abort", onAbort);
      chain = chain.then(async () => {
        if (failed) return;
        try {
          batch.push(...parser.end());
          if (batch.length) {
            const page = batch;
            batch = [];
            await applyPage(a, page);
            indexed += page.length;
          }
        } catch (e) {
          failed = e;
        }
      });
      chain.then(() => {
        if (failed) return reject(failed);
        if (a.signal.aborted) return reject(new Error("aborted"));
        if (code !== 0) return reject(new WalkFailed(stderr));
        resolve(indexed);
      });
    });
  });
}

/** Bring the commit index up to the repository's current tips. No-op when the fingerprint is unchanged. */
export async function ingestCommits(a: IngestArgs): Promise<IngestResult> {
  const { fp, tips } = fingerprint(a.deps, a.cwd);
  const read = <T>(key: string) => a.store.read!((db) => metaJson<T>(db, key));
  const storedFp = a.store.read!((db) => metaGet(db, "commits.fingerprint"));
  if (storedFp === fp) return { indexed: 0, reset: false };
  const recorded = read<string[]>("commits.tips") ?? [];
  let reset = false;
  let indexed = 0;
  try {
    if (tips.length) indexed = await walk(a, tips, recorded, recorded.length === 0);
  } catch (e) {
    if (!(e instanceof WalkFailed) || recorded.length === 0) throw e;
    // a recorded tip no longer exists (gc, rebase): re-walk from the current tips; upserts are idempotent
    reset = true;
    a.lease.fenced((db) => {
      metaDelete(db, "commits.tips");
      metaSet(db, "lastError", `commit walk reset: ${e.message}`);
    });
    indexed = await walk(a, tips, [], true);
  }
  a.lease.fenced((db) => {
    metaSet(db, "commits.fingerprint", fp);
    metaSetJson(db, "commits.tips", tips);
    metaSet(db, "commits.indexedAt", String(a.deps.now()));
    if (!reset) metaDelete(db, "lastError");
  });
  return { indexed, reset };
}
