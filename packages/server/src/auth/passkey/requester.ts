/**
 * Approver-facing description of the device asking to sign in (design D5).
 *
 * Every input is attacker-controlled (the requester sends its own headers).
 * Output is display text only — never used for a decision, never logged:
 * control characters stripped, each field bounded, IP must parse as an IP.
 *
 * See change: add-passkey-user-auth.
 */
import net from "node:net";

export interface RequesterView {
  browser: string;
  os: string;
  host: string;
  ip: string;
}

const MAX_FIELD = 256;
const MAX_HOST = 253;

function clean(v: unknown, max = MAX_FIELD): string {
  if (typeof v !== "string") return "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, max);
}

function browserOf(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return ua ? "Unknown browser" : "Unknown";
}

function osOf(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

function validIp(v: string): string | null {
  const s = v.trim().replace(/^\[|\]$/g, "");
  return net.isIP(s) ? s : null;
}

export function describeRequester(input: {
  userAgent?: unknown;
  host?: unknown;
  ip?: unknown;
  forwardedFor?: unknown;
}): RequesterView {
  const ua = clean(input.userAgent);
  const firstHop = typeof input.forwardedFor === "string" ? validIp(input.forwardedFor.split(",")[0] ?? "") : null;
  const direct = typeof input.ip === "string" ? validIp(input.ip) : null;
  return {
    browser: browserOf(ua),
    os: osOf(ua),
    host: clean(input.host, MAX_HOST) || "unknown",
    ip: firstHop ?? direct ?? "unknown",
  };
}
