/**
 * Bridge-side lease client (design D5). ONE lease per tool call over the
 * private request lane — no bridge cache, so a lowered level refuses the very
 * next call. The returned `tier` is re-checked against the op (defence in
 * depth). Error codes from the server (`<code>: <detail>`) are parsed into
 * `GmailToolError`. See change: add-gmail-plugin.
 */
import {
  type PluginLaneReply,
  requestPluginServer,
} from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { ACCOUNTS_TYPE, type AccountInfo, LEASE_TYPE, type LeaseReply, PLUGIN_ID } from "../shared/protocol.js";
import { isTier, type Op, tierAllows } from "../shared/scopes.js";

export type LaneRequest = (pluginId: string, type: string, payload?: unknown) => Promise<PluginLaneReply>;

export class GmailToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GmailToolError";
  }
}

function laneError(error: string): GmailToolError {
  const m = /^([a-z_]{1,64}): ([\s\S]*)$/.exec(error);
  if (m) return new GmailToolError(m[1] as string, `${m[1]}: ${m[2]}`);
  if (error === "unavailable") {
    return new GmailToolError("unavailable", "unavailable: the pi-dashboard is not connected; Gmail tools need it");
  }
  return new GmailToolError(error.slice(0, 64) || "lane_error", `Gmail lease failed: ${error.slice(0, 200)}`);
}

export class LeaseClient {
  constructor(private readonly request: LaneRequest = requestPluginServer) {}

  async lease(account: string, op: Op): Promise<LeaseReply> {
    const reply = await this.request(PLUGIN_ID, LEASE_TYPE, { account, op });
    if (!reply.ok) throw laneError(reply.error);
    const r = reply.result as Partial<LeaseReply> | null;
    if (!r || typeof r.accessToken !== "string" || !isTier(r.tier) || typeof r.email !== "string") {
      throw new GmailToolError("bad_lease", "Gmail lease reply was malformed");
    }
    if (!tierAllows(r.tier, op)) {
      throw new GmailToolError("tier_denied", `tier_denied: ${r.email} is at level "${r.tier}", which does not allow "${op}"`);
    }
    return r as LeaseReply;
  }

  async accounts(): Promise<AccountInfo[]> {
    const reply = await this.request(PLUGIN_ID, ACCOUNTS_TYPE, {});
    if (!reply.ok) throw laneError(reply.error);
    return Array.isArray(reply.result) ? (reply.result as AccountInfo[]) : [];
  }
}
