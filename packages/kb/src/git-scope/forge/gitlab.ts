// GitLab adapter over `glab api -i`: two endpoints (`issues`, `merge_requests`),
// `updated_after` (inclusive per spike 1.3) with ascending `updated_at`. The rate
// floor applies only where `RateLimit-Limit` AND `RateLimit-Remaining` are sent.
import type { GitScopeDeps } from "../deps.js";
import { cliRequest } from "./cli.js";
import { type ForgeAdapter, type ForgeComment, type ForgeComments, type ForgeEndpoint, type ForgeItem, type ForgePage, type ItemKind, type ListArgs, PAGE_SIZE, type RateInfo } from "./types.js";

export interface GitlabRepoRef {
  host: string;
  /** `group[/subgroup]/repo` */
  path: string;
}

function gitlabRate(h: Record<string, string>): RateInfo | null {
  const remaining = Number(h["ratelimit-remaining"]);
  const limit = Number(h["ratelimit-limit"]);
  const reset = Number(h["ratelimit-reset"]);
  if (h["ratelimit-remaining"] === undefined || h["ratelimit-limit"] === undefined || !Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return null;
  return { remaining, limit, resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0 };
}

interface GlItem {
  iid: number;
  title?: string;
  description?: string | null;
  state?: string;
  author?: { username?: string } | null;
  labels?: Array<string | { name?: string }>;
  created_at?: string;
  updated_at?: string;
}

function mapGitlabItem(kind: ItemKind, i: GlItem): ForgeItem {
  return {
    kind,
    number: i.iid,
    title: i.title ?? "",
    body: i.description ?? "",
    state: i.state === "merged" ? "merged" : i.state === "closed" ? "closed" : "open",
    author: i.author?.username ?? "ghost",
    labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    createdAt: i.created_at ?? "",
    updatedAt: i.updated_at ? new Date(i.updated_at).toISOString() : "",
  };
}

export function createGitlabAdapter(deps: GitScopeDeps, ref: GitlabRepoRef): ForgeAdapter {
  const project = `projects/${encodeURIComponent(ref.path)}`;
  const call = (endpoint: string, etag: string | null, signal?: AbortSignal) =>
    cliRequest(deps, { cli: "glab", args: ["api", "-i", "--hostname", ref.host, ...(etag ? ["-H", `If-None-Match: ${etag}`] : []), endpoint] }, gitlabRate, signal);
  return {
    id: "gitlab",
    endpoints: ["issues", "merge_requests"],
    sharedNumberSpace: false,
    async list(ep: ForgeEndpoint, a: ListArgs): Promise<ForgePage> {
      const q = `scope=all&updated_after=${encodeURIComponent(a.since)}&order_by=updated_at&sort=asc&per_page=${PAGE_SIZE}&page=${a.page}`;
      const r = await call(`${project}/${ep}?${q}`, a.etag, a.signal);
      if (r.status === 304) return { status: "not_modified", items: [], full: false, etag: a.etag, rate: r.rate };
      const rows = JSON.parse(r.body || "[]") as GlItem[];
      const kind: ItemKind = ep === "merge_requests" ? "pr" : "issue";
      return { status: "ok", items: rows.map((i) => mapGitlabItem(kind, i)), full: rows.length >= PAGE_SIZE, etag: r.headers.etag ?? null, rate: r.rate };
    },
    async comments(kind: ItemKind, n: number, etag: string | null, signal?: AbortSignal): Promise<ForgeComments> {
      const r = await call(`${project}/${kind === "pr" ? "merge_requests" : "issues"}/${n}/notes?sort=asc&per_page=${PAGE_SIZE}`, etag, signal);
      if (r.status === 304) return { status: "not_modified", comments: [], etag, rate: r.rate };
      const rows = JSON.parse(r.body || "[]") as Array<{ author?: { username?: string } | null; created_at?: string; body?: string | null; system?: boolean }>;
      const comments: ForgeComment[] = rows.filter((c) => !c.system).map((c) => ({ author: c.author?.username ?? "ghost", createdAt: c.created_at ?? "", body: c.body ?? "" }));
      return { status: "ok", comments, etag: r.headers.etag ?? null, rate: r.rate };
    },
  };
}
