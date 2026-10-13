// Shared transport for the CLI-backed adapters (`gh api -i`, `glab api -i`): the
// CLIs hold the user's credentials (including enterprise hosts and SSO) and only
// send them to hosts the user authenticated. The kb never reads, stores or logs a
// token. Spike 1.1 shape: stdout = HTTP status line + headers + blank line + body;
// a 304 or any error status exits non-zero with the head still on stdout.
import type { CliResult, GitScopeDeps } from "../deps.js";
import { ForgeRateLimited, ForgeUnavailable, type RateInfo } from "./types.js";

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Parse `gh api -i` / `glab api -i` stdout. Null when there is no HTTP head. */
function parseHttpHead(stdout: string): HttpResult | null {
  const text = stdout.replace(/\r\n/g, "\n");
  const split = text.indexOf("\n\n");
  const headBlock = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split + 2);
  const [statusLine, ...headLines] = headBlock.split("\n");
  const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(statusLine ?? "");
  if (!m) return null;
  const headers: Record<string, string> = {};
  for (const line of headLines) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(m[1]), headers, body };
}

/** Seconds → epoch ms from a `retry-after` (seconds) or reset (epoch seconds) header. */
function retryAtFrom(headers: Record<string, string>, now: number): number | null {
  const ra = Number(headers["retry-after"]);
  if (Number.isFinite(ra) && ra > 0) return now + ra * 1000;
  const reset = Number(headers["x-ratelimit-reset"] ?? headers["ratelimit-reset"]);
  if (Number.isFinite(reset) && reset > 0) return reset * (reset < 1e12 ? 1000 : 1);
  return null;
}

export interface CliCall {
  /** `gh` or `glab`. */
  cli: "gh" | "glab";
  args: string[];
}

/** No HTTP head on stdout: not logged in, no network, or a CLI-level error. */
function headlessError(cli: string, r: CliResult): ForgeUnavailable {
  const msg = r.stderr.trim().split("\n")[0] ?? "";
  if (/auth|log ?in|token|credential/i.test(msg) || r.code === 4) return new ForgeUnavailable(`${cli} is not authenticated`);
  return new ForgeUnavailable(msg ? `${cli}: ${msg.slice(0, 120)}` : `${cli} failed (exit ${r.code})`);
}

/** Classify a non-2xx/304 answer. */
function statusError(cli: string, http: HttpResult, rate: RateInfo | null, now: number): Error {
  const h = http.headers;
  const exhausted = h["x-ratelimit-remaining"] === "0" || h["ratelimit-remaining"] === "0";
  if (http.status === 429 || (http.status === 403 && (exhausted || h["retry-after"] || /rate limit/i.test(http.body)))) return new ForgeRateLimited(retryAtFrom(h, now), rate);
  if (http.status === 401) return new ForgeUnavailable(`${cli} is not authenticated`);
  if (http.status === 403) return new ForgeUnavailable("access forbidden");
  if (http.status === 404) return new ForgeUnavailable("repository not found or no access");
  return new ForgeUnavailable(`forge answered HTTP ${http.status}`);
}

/** Run one CLI request and classify the outcome. Returns the parsed response for 200/304. */
export async function cliRequest(deps: GitScopeDeps, call: CliCall, rateFrom: (h: Record<string, string>) => RateInfo | null, signal?: AbortSignal): Promise<HttpResult & { rate: RateInfo | null }> {
  const bin = deps.resolveBin(call.cli);
  if (!bin) throw new ForgeUnavailable(`${call.cli} is not installed`);
  const r: CliResult = await deps.runCli(bin, call.args, { signal, timeoutMs: 30_000 });
  if (r.spawnError) throw new ForgeUnavailable(`${call.cli} could not be started`);
  const http = parseHttpHead(r.stdout);
  if (!http) throw headlessError(call.cli, r);
  const rate = rateFrom(http.headers);
  if (http.status === 200 || http.status === 304) return { ...http, rate };
  throw statusError(call.cli, http, rate, deps.now());
}
