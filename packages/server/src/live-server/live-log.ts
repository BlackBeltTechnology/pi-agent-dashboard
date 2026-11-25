/**
 * One-line structured log for live-preview events (`[live-preview] <event> k=v …`).
 * Values are JSON-encoded (no field can forge a second line) and the whole line
 * passes `redactCapability`, so a capability token never reaches a log.
 *
 * See change: improve-canvas-html-and-url-ux (task 2.11).
 */
import { redactCapability } from "./capability-redact.js";

export type LiveLogSink = (line: string) => void;

/** A plain token (ids, hashes, tiers, ports, reasons) prints bare; anything else is JSON-encoded so no field can forge a second line. */
const BARE = /^[A-Za-z0-9._:-]{1,64}$/;
const render = (v: unknown): string => (typeof v === "string" && BARE.test(v) ? v : (JSON.stringify(v) ?? "null"));

function formatLiveLog(event: string, fields: Record<string, unknown> = {}): string {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${render(v)}`)
    .join(" ");
  return redactCapability(`[live-preview] ${event}${kv ? ` ${kv}` : ""}`);
}

export function liveLog(sink: LiveLogSink | undefined, event: string, fields?: Record<string, unknown>): void {
  (sink ?? ((line) => console.log(line)))(formatLiveLog(event, fields));
}
