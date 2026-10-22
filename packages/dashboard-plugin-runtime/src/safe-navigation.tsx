/**
 * Navigation chokepoints shared by the dashboard client and plugins.
 *
 * Every variable navigation target goes through `classifyUrl`
 * (`@blackbelt-technology/pi-dashboard-shared/url-policy`) first:
 *
 *   - `SafeLink`         renders `<a>` for an allowed target (`rel="noopener
 *                        noreferrer"` for external / loopback), or an inert
 *                        `<span>` for a blocked one.
 *   - `openExternalUrl`  non-hook: opens an allowed target in a new browsing
 *                        context (no opener / referrer for external targets).
 *   - `useSafeNavigation` hook: `{ openUrl, navigateTo }`; internal targets
 *                        are history-pushed, never assigned to `location`.
 *
 * A blocked target is never navigated or opened; a single non-blocking
 * `role="status"` notice says so. `classifyUrl` is a floor — stricter callers
 * (e.g. the embedded-app `navigateDashboard` validator) keep their own rules.
 *
 * This module (and the client `lib/nav/safe-navigation.tsx` built on it) is
 * the allowlisted home of raw navigation sinks for `check-client-sinks.mjs`.
 *
 * See change: harden-client-sinks (design D3).
 */
import { classifyUrl, type UrlClass } from "@blackbelt-technology/pi-dashboard-shared/url-policy.js";
import type React from "react";
import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";

const NOTICE_ID = "pi-link-blocked-notice";
const NOTICE_MS = 4000;
const DEFAULT_NOTICE = "Link blocked: this address is not allowed to open.";

let noticeText: () => string = () => DEFAULT_NOTICE;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Let the host shell supply the translated notice text (called once at boot). */
export function setLinkBlockedNoticeText(text: () => string): void {
  noticeText = text;
}

/** Show (or refresh) the single non-blocking "link blocked" notice. */
export function showLinkBlockedNotice(): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(NOTICE_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = NOTICE_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("data-testid", "link-blocked-notice");
    el.className =
      "fixed bottom-4 left-1/2 -translate-x-1/2 z-toast px-3 py-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm shadow-lg";
    document.body.append(el);
  }
  el.textContent = noticeText();
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    document.getElementById(NOTICE_ID)?.remove();
    noticeTimer = undefined;
  }, NOTICE_MS);
}

function pageOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

/** Classify `url` against the current page origin. */
export function classifyNavigationTarget(url: unknown): UrlClass {
  return classifyUrl(url, pageOrigin());
}

export interface OpenUrlOptions {
  /** Window name; a named target reuses its window. Default `_blank`. */
  target?: string;
}

/**
 * Open `url` in a new browsing context when it classifies as `internal`,
 * `loopback` or `external` (`mailto` hands off to the mail client). External
 * and loopback targets never get an `opener` or a referrer. A blocked target
 * opens nothing, shows the notice and returns `false`.
 */
export function openExternalUrl(url: unknown, opts: OpenUrlOptions = {}): boolean {
  const cls = classifyNavigationTarget(url);
  if (cls === "blocked") {
    showLinkBlockedNotice();
    return false;
  }
  const raw = String(url).trim();
  if (cls === "mailto") {
    // A mail client opens; the page itself does not navigate.
    window.location.assign(raw);
    return true;
  }
  const target = opts.target ?? "_blank";
  if (cls === "internal") window.open(raw, target);
  else window.open(raw, target, "noopener,noreferrer");
  return true;
}

/**
 * Full-page navigation of the CURRENT document (sign-in / sign-out redirects,
 * leaving the SPA). Classifies first; a blocked target is not navigated,
 * shows the notice and returns `false`. Prefer `navigateTo` for in-app routes.
 */
export function assignLocation(url: unknown): boolean {
  const cls = classifyNavigationTarget(url);
  if (cls === "blocked") {
    showLinkBlockedNotice();
    return false;
  }
  window.location.assign(String(url).trim());
  return true;
}

export type SafeLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | null | undefined;
  children?: React.ReactNode;
};

/**
 * `<a>` for an allowed target, inert `<span>` (no `href`) for a blocked one.
 * External / loopback links always carry `rel="noopener noreferrer"`.
 */
export function SafeLink({ href, children, rel, target, ...rest }: SafeLinkProps) {
  const cls = classifyNavigationTarget(href);
  if (cls === "blocked" || !href) {
    // Inert text: keep presentational / test attributes, drop anchor-only ones.
    const { download: _d, hrefLang: _h, media: _m, ping: _p, referrerPolicy: _r, type: _t, ...spanProps } = rest;
    return <span {...(spanProps as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>;
  }
  const outward = cls === "external" || cls === "loopback";
  return (
    <a {...rest} href={href.trim()} target={target} rel={outward ? "noopener noreferrer" : rel}>
      {children}
    </a>
  );
}

export interface SafeNavigation {
  /** Open in a new browsing context. `false` when blocked (nothing opened). */
  openUrl: (url: unknown, opts?: OpenUrlOptions) => boolean;
  /** Navigate the current page. Internal → history push; blocked → `false`. */
  navigateTo: (url: unknown) => boolean;
}

/** Host hooks the dashboard shell layers on top (tracked nav, split viewer). */
export interface SafeNavigationHostHooks {
  /** Push an internal path (default: wouter `navigate`). */
  navigateInternal?: (path: string) => void;
  /** Route a loopback target in-app; return `true` when handled. */
  openLoopback?: (url: string) => boolean;
}

/** Hook form of the chokepoints. `hooks` lets the host shell refine routing. */
export function useSafeNavigation(hooks: SafeNavigationHostHooks = {}): SafeNavigation {
  const [, navigate] = useLocation();
  const { navigateInternal, openLoopback } = hooks;
  const openUrl = useCallback(
    (url: unknown, opts?: OpenUrlOptions) => {
      if (openLoopback && classifyNavigationTarget(url) === "loopback" && openLoopback(String(url).trim())) return true;
      return openExternalUrl(url, opts);
    },
    [openLoopback],
  );
  const navigateTo = useCallback(
    (url: unknown) => {
      const cls = classifyNavigationTarget(url);
      if (cls === "blocked") {
        showLinkBlockedNotice();
        return false;
      }
      const raw = String(url).trim();
      if (cls === "internal") {
        const u = new URL(raw, window.location.origin);
        (navigateInternal ?? navigate)(`${u.pathname}${u.search}${u.hash}`);
        return true;
      }
      return assignLocation(raw);
    },
    [navigate, navigateInternal],
  );
  return useMemo(() => ({ openUrl, navigateTo }), [openUrl, navigateTo]);
}
