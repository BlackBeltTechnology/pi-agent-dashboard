// Gitea / Forgejo / Codeberg adapter over HTTPS (`fetch`). Always `https://<host>`,
// even when the git remote is `http://` or ssh: no request and no credential ever
// goes over cleartext. The token (the env var named by GLOBAL `forge.gitea.tokenEnv`)
// is sent ONLY to a host listed in global `git.forge.hosts` as `gitea`. Ascending
// update order is `sort=leastupdate` (spike 1.3); `since` is inclusive.
import type { GitScopeDeps } from "../deps.js";
import { type ForgeAdapter, type ForgeComment, type ForgeComments, type ForgeItem, type ForgePage, ForgeRateLimited, ForgeUnavailable, type ItemKind, type ListArgs, type RateInfo } from "./types.js";

export interface GiteaRepoRef {
  /** host[:port] as written in the remote */
  host: string;
  /** `owner/repo` */
  path: string;
}
export interface GiteaAuth {
  /** True iff the host is listed in global `git.forge.hosts` as gitea. */
  allowlisted: boolean;
  /** Name of the env var holding the token (global config). */
  tokenEnv: string;
}

const GITEA_PAGE = 50;

/** `RateLimit: "baseline";r=1999;t=600` + `RateLimit-Policy: "baseline";q=2000;w=600` (no x-ratelimit-*). */
function giteaRate(h: Headers, now: number): RateInfo | null {
  const rl = h.get("ratelimit");
  const pol = h.get("ratelimit-policy");
  const r = /;\s*r=(\d+)/.exec(rl ?? "");
  const t = /;\s*t=(\d+)/.exec(rl ?? "");
  const q = /;\s*q=(\d+)/.exec(pol ?? "");
  if (!r || !q) return null;
  return { remaining: Number(r[1]), limit: Number(q[1]), resetAt: now + Number(t?.[1] ?? 0) * 1000 };
}

/** Normalise a zone-offset timestamp to UTC `Z`. */
const toUtc = (ts: string | undefined): string => (ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString().replace(".000Z", "Z") : "");

interface GtIssue {
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string }>;
  created_at?: string;
  updated_at?: string;
  pull_request?: { merged?: boolean } | null;
}

function mapGiteaItem(i: GtIssue): ForgeItem {
  const isPr = !!i.pull_request;
  return {
    kind: isPr ? "pr" : "issue",
    number: i.number,
    title: i.title ?? "",
    body: i.body ?? "",
    state: isPr && i.pull_request?.merged ? "merged" : i.state === "closed" ? "closed" : "open",
    author: i.user?.login ?? "ghost",
    labels: (i.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    createdAt: toUtc(i.created_at),
    updatedAt: toUtc(i.updated_at),
  };
}

/** Why a fetch failed, without blaming https for a timeout or a DNS error. */
function networkReason(e: unknown, timedOut: boolean): string {
  if (timedOut) return "request timed out";
  const code = (e as { cause?: { code?: string } }).cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  return "https required"; // refused / reset / TLS failure: the https endpoint is not usable
}

/** Classify a non-2xx/304 answer. */
function statusError(res: Response, rate: RateInfo | null, hasToken: boolean, now: number): Error {
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 429 || (res.status === 403 && retryAfter)) {
    const ra = Number(retryAfter);
    return new ForgeRateLimited(Number.isFinite(ra) && ra > 0 ? now + ra * 1000 : null, rate);
  }
  if (res.status === 401 || res.status === 403) return new ForgeUnavailable(hasToken ? "access forbidden" : "authentication required");
  if (res.status === 404) return new ForgeUnavailable("repository not found or no access");
  return new ForgeUnavailable(`forge answered HTTP ${res.status}`);
}

export function createGiteaAdapter(deps: GitScopeDeps, ref: GiteaRepoRef, auth: GiteaAuth): ForgeAdapter {
  const base = `https://${ref.host}/api/v1/repos/${ref.path}`;
  const token = auth.allowlisted ? deps.env[auth.tokenEnv] : undefined;
  const get = async (url: string, etag: string | null, signal?: AbortSignal): Promise<{ res: Response; rate: RateInfo | null }> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `token ${token}`;
    if (etag) headers["if-none-match"] = etag;
    const timeout = AbortSignal.timeout(deps.requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await deps.fetch(url, { headers, signal: combined, redirect: "error" });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ForgeUnavailable(networkReason(e, timeout.aborted));
    }
    const rate = giteaRate(res.headers, deps.now());
    if (res.status === 200 || res.status === 304) return { res, rate };
    throw statusError(res, rate, !!token, deps.now());
  };
  return {
    id: "gitea",
    endpoints: ["issues"],
    sharedNumberSpace: true,
    async list(_ep, a: ListArgs): Promise<ForgePage> {
      const q = `state=all&type=all&sort=leastupdate&since=${encodeURIComponent(a.since)}&limit=${GITEA_PAGE}&page=${a.page}`;
      const { res, rate } = await get(`${base}/issues?${q}`, a.etag, a.signal);
      if (res.status === 304) return { status: "not_modified", items: [], full: false, etag: a.etag, rate };
      const rows = (await res.json()) as GtIssue[];
      return { status: "ok", items: rows.map(mapGiteaItem), full: rows.length >= GITEA_PAGE, etag: res.headers.get("etag"), rate };
    },
    async comments(_kind: ItemKind, n: number, etag: string | null, signal?: AbortSignal): Promise<ForgeComments> {
      const { res, rate } = await get(`${base}/issues/${n}/comments`, etag, signal);
      if (res.status === 304) return { status: "not_modified", comments: [], etag, rate };
      const rows = (await res.json()) as Array<{ user?: { login?: string } | null; created_at?: string; body?: string | null }>;
      const comments: ForgeComment[] = rows.map((c) => ({ author: c.user?.login ?? "ghost", createdAt: toUtc(c.created_at), body: c.body ?? "" }));
      return { status: "ok", comments, etag: res.headers.get("etag"), rate };
    },
  };
}
