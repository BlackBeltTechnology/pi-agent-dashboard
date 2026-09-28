/**
 * Dependency-free User-Agent → human label for the pairing approval dialog
 * (change: add-pairing-approval-dialog, D4). The UA is attacker-controlled
 * display text: this only pattern-matches known tokens and never echoes raw
 * input, so junk collapses to "Unknown browser".
 *
 * `describeUserAgent` → dialog "Browser" row ("Chrome 140 on Windows" — the
 * Chrome major is shown because every Chromium build reports it, so it is the
 * one version that reliably identifies a stale browser).
 * `deviceNameFromUserAgent` → versionless name-field prefill ("Chrome on Windows").
 */

const UNKNOWN = "Unknown browser";
const APP = "pi-dashboard app";

interface Parsed {
  browser: string | null;
  version: string | null;
  os: string | null;
}

function parse(ua: string): Parsed {
  let browser: string | null = null;
  let version: string | null = null;
  if (/\bEdg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/\bOPR\//.test(ua)) browser = "Opera";
  else if (/\b(Firefox|FxiOS)\//.test(ua)) browser = "Firefox";
  else if (/\bCriOS\//.test(ua)) browser = "Chrome";
  else if (/\bChrome\/\d/.test(ua)) {
    browser = "Chrome";
    version = /\bChrome\/(\d+)/.exec(ua)?.[1] ?? null;
  } else if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/\biPhone\b/.test(ua)) os = "iPhone";
  else if (/\biPad\b/.test(ua)) os = "iPad";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\bWindows\b/.test(ua)) os = "Windows";
  else if (/\bCrOS\b/.test(ua)) os = "ChromeOS";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = "macOS";
  else if (/\bLinux\b/.test(ua)) os = "Linux";
  return { browser, version, os };
}

function isApp(ua: string): boolean {
  return /\bElectron\/|\bpi-dashboard\//i.test(ua);
}

function label(ua: string | undefined, withVersion: boolean): string {
  if (!ua) return UNKNOWN;
  if (isApp(ua)) return APP;
  const { browser, version, os } = parse(ua);
  if (!browser) return UNKNOWN;
  const name = withVersion && version ? `${browser} ${version}` : browser;
  return os ? `${name} on ${os}` : name;
}

export function describeUserAgent(ua: string | undefined): string {
  return label(ua, true);
}

export function deviceNameFromUserAgent(ua: string | undefined): string {
  return label(ua, false);
}
