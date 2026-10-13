// Endpoint-oriented forge adapter contract (design G3). One GitHub request serves
// both PRs and issues, so the sync loop is per ENDPOINT, not per kind.
import type { ForgeKind } from "../../config.js";

export type ForgeEndpoint = "issues" | "merge_requests";
export type ItemKind = "pr" | "issue";

export interface ForgeItem {
  kind: ItemKind;
  number: number;
  title: string;
  body: string;
  /** open | closed | merged (forge wording normalised to those three). */
  state: string;
  author: string;
  labels: string[];
  createdAt: string;
  /** UTC, `YYYY-MM-DDTHH:MM:SS(.sss)Z`, normalised by the adapter; the sort/cursor key. */
  updatedAt: string;
}

/** Remaining request budget as reported by the forge. `resetAt` is epoch ms. */
export interface RateInfo {
  remaining: number;
  limit: number;
  resetAt: number;
}

export interface ListArgs {
  /** Inclusive lower bound on `updatedAt` (ascending order). */
  since: string;
  /** 1-based page within the `since` query (cohort walking only; keyset paging stays on 1). */
  page: number;
  /** Validator for the exact `since`, page-1 request; null on any other request. */
  etag: string | null;
  signal?: AbortSignal;
}
export interface ForgePage {
  status: "ok" | "not_modified";
  items: ForgeItem[];
  /** The page was full: more items may follow. */
  full: boolean;
  etag: string | null;
  rate: RateInfo | null;
}
export interface ForgeComment {
  author: string;
  createdAt: string;
  body: string;
}
export interface ForgeComments {
  status: "ok" | "not_modified";
  comments: ForgeComment[];
  etag: string | null;
  rate: RateInfo | null;
}

export interface ForgeAdapter {
  id: ForgeKind;
  endpoints: ForgeEndpoint[];
  /** GitHub and Gitea number issues and PRs in one space; GitLab does not. */
  sharedNumberSpace: boolean;
  list(endpoint: ForgeEndpoint, args: ListArgs): Promise<ForgePage>;
  comments(kind: ItemKind, n: number, etag: string | null, signal?: AbortSignal): Promise<ForgeComments>;
}

/** The forge cannot be used right now for a reason worth showing (`forge unavailable: <reason>`). */
export class ForgeUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "ForgeUnavailable";
    this.reason = reason;
  }
}
/** The forge asked us to slow down. `retryAt` is epoch ms, or null (caller defaults to 15 min). */
export class ForgeRateLimited extends Error {
  readonly retryAt: number | null;
  readonly rate: RateInfo | null;
  constructor(retryAt: number | null, rate: RateInfo | null = null) {
    super("forge rate limited");
    this.name = "ForgeRateLimited";
    this.retryAt = retryAt;
    this.rate = rate;
  }
}

export const PAGE_SIZE = 100;
