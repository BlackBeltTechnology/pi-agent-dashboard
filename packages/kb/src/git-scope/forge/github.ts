// GitHub adapter over `gh api -i`: one `issues` endpoint serves PRs and issues
// (a `pull_request` key marks a PR). Rate comes from `x-ratelimit-*`; there is no
// per-process `rate_limit` preflight, because every list response already carries it.
import type { GitScopeDeps } from "../deps.js";
import { cliRequest } from "./cli.js";
import { type ForgeAdapter, type ForgeComment, type ForgeComments, type ForgeItem, type ForgePage, type ItemKind, type ListArgs, PAGE_SIZE, type RateInfo } from "./types.js";

export interface GithubRepoRef {
  host: string;
  /** `owner/repo` */
  path: string;
}

function githubRate(h: Record<string, string>): RateInfo | null {
  const remaining = Number(h["x-ratelimit-remaining"]);
  const limit = Number(h["x-ratelimit-limit"]);
  const reset = Number(h["x-ratelimit-reset"]);
  if (![remaining, limit, reset].every(Number.isFinite) || limit <= 0) return null;
  return { remaining, limit, resetAt: reset * 1000 };
}

interface GhIssue {
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | string>;
  created_at?: string;
  updated_at?: string;
  pull_request?: { merged_at?: string | null } | null;
}

function mapGithubItem(i: GhIssue): ForgeItem {
  const isPr = !!i.pull_request;
  return {
    kind: isPr ? "pr" : "issue",
    number: i.number,
    title: i.title ?? "",
    body: i.body ?? "",
    state: isPr && i.pull_request?.merged_at ? "merged" : i.state === "closed" ? "closed" : "open",
    author: i.user?.login ?? "ghost",
    labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    createdAt: i.created_at ?? "",
    updatedAt: i.updated_at ?? "",
  };
}

export function createGithubAdapter(deps: GitScopeDeps, ref: GithubRepoRef): ForgeAdapter {
  const base = `repos/${ref.path}`;
  const call = (endpoint: string, etag: string | null, signal?: AbortSignal) =>
    cliRequest(deps, { cli: "gh", args: ["api", "-i", "--hostname", ref.host, "-H", "Accept: application/vnd.github+json", ...(etag ? ["-H", `If-None-Match: ${etag}`] : []), endpoint] }, githubRate, signal);
  return {
    id: "github",
    endpoints: ["issues"],
    sharedNumberSpace: true,
    async list(_ep, a: ListArgs): Promise<ForgePage> {
      const q = `state=all&sort=updated&direction=asc&since=${encodeURIComponent(a.since)}&per_page=${PAGE_SIZE}&page=${a.page}`;
      const r = await call(`${base}/issues?${q}`, a.etag, a.signal);
      if (r.status === 304) return { status: "not_modified", items: [], full: false, etag: a.etag, rate: r.rate };
      const rows = JSON.parse(r.body || "[]") as GhIssue[];
      return { status: "ok", items: rows.map(mapGithubItem), full: rows.length >= PAGE_SIZE, etag: r.headers.etag ?? null, rate: r.rate };
    },
    async comments(kind: ItemKind, n: number, etag: string | null, signal?: AbortSignal): Promise<ForgeComments> {
      const r = await call(`${base}/issues/${n}/comments?per_page=${PAGE_SIZE}`, etag, signal);
      if (r.status === 304) return { status: "not_modified", comments: [], etag, rate: r.rate };
      const rows = JSON.parse(r.body || "[]") as Array<{ user?: { login?: string } | null; created_at?: string; body?: string | null }>;
      const comments: ForgeComment[] = rows.map((c) => ({ author: c.user?.login ?? "ghost", createdAt: c.created_at ?? "", body: c.body ?? "" }));
      void kind;
      return { status: "ok", comments, etag: r.headers.etag ?? null, rate: r.rate };
    },
  };
}
