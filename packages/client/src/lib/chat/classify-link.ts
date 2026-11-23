/**
 * Pure, offline classification of an http(s) URL into a provider, an mdi icon
 * and a display label for chat links (change: rich-chat-links, D8).
 *
 * Never throws, never touches the network, deterministic. Anything
 * unparseable, non-http(s), unrecognised, or loopback keeps its original text
 * as the label. Host matching is exact or on a dot boundary and uses
 * `URL.hostname`, which already excludes `user@` credentials.
 */
import {
  mdiGithub,
  mdiGitlab,
  mdiGoogleDrive,
  mdiJira,
  mdiLaptop,
  mdiLink,
  mdiNpm,
  mdiStackOverflow,
  mdiYoutube,
} from "@mdi/js";

export type LinkProvider =
  | "github"
  | "gitlab"
  | "jira"
  | "youtube"
  | "npm"
  | "stackoverflow"
  | "google"
  | "local"
  | "generic";

export interface LinkClassification {
  provider: LinkProvider;
  /** mdi SVG path data. */
  icon: string;
  /** Short label for a recognised shape; otherwise the original input text. */
  label: string;
}

const ICONS: Record<LinkProvider, string> = {
  github: mdiGithub,
  gitlab: mdiGitlab,
  jira: mdiJira,
  youtube: mdiYoutube,
  npm: mdiNpm,
  stackoverflow: mdiStackOverflow,
  google: mdiGoogleDrive,
  local: mdiLaptop,
  generic: mdiLink,
};

/** Hosts (exact or dot-boundary suffix) → provider. Order is irrelevant. */
const HOST_TABLE: ReadonlyArray<readonly [string, LinkProvider]> = [
  ["github.com", "github"],
  ["gitlab.com", "gitlab"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["npmjs.com", "npm"],
  ["stackoverflow.com", "stackoverflow"],
  ["docs.google.com", "google"],
  ["drive.google.com", "google"],
];

const matchesHost = (host: string, base: string): boolean => host === base || host.endsWith(`.${base}`);

const isLoopback = (host: string): boolean =>
  host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

const JIRA_BROWSE = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/;
const NPM_PACKAGE = /^\/package\/((?:@[^/]+\/)?[^/]+)\/?$/;
const GITHUB_REPO = /^\/([^/]+)\/([^/]+)\/?$/;
const GITHUB_ITEM = /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)\/?$/;
const GITHUB_FILE = /^\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(?:.+\/)?([^/]+)$/;
const GITLAB_ITEM = /^\/([^/]+)\/([^/]+)\/-\/(?:merge_requests|issues)\/(\d+)\/?$/;
const GITLAB_FILE = /^\/([^/]+)\/([^/]+)\/-\/blob\/[^/]+\/(?:.+\/)?([^/]+)$/;

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Short label for a recognised shape, or `null` to keep the URL text. */
function shortLabel(provider: LinkProvider, host: string, pathname: string): string | null {
  switch (provider) {
    case "github": {
      const item = GITHUB_ITEM.exec(pathname);
      if (item) return `${item[1]}/${item[2]}#${item[3]}`;
      const file = GITHUB_FILE.exec(pathname);
      if (file) return `${file[1]}/${file[2]}: ${file[3]}`;
      const repo = GITHUB_REPO.exec(pathname);
      return repo ? `${repo[1]}/${repo[2]}` : null;
    }
    case "gitlab": {
      const item = GITLAB_ITEM.exec(pathname);
      if (item) return `${item[1]}/${item[2]}#${item[3]}`;
      const file = GITLAB_FILE.exec(pathname);
      if (file) return `${file[1]}/${file[2]}: ${file[3]}`;
      const repo = GITHUB_REPO.exec(pathname);
      return repo ? `${repo[1]}/${repo[2]}` : null;
    }
    case "jira": {
      const key = JIRA_BROWSE.exec(pathname);
      return key ? `${key[1]} (${host.slice(0, -".atlassian.net".length)})` : null;
    }
    case "npm": {
      const pkg = NPM_PACKAGE.exec(pathname);
      return pkg ? safeDecode(pkg[1]) : null;
    }
    default:
      return null;
  }
}

function generic(input: string): LinkClassification {
  return { provider: "generic", icon: ICONS.generic, label: input };
}

/** Classify `url`. Total: never throws. */
export function classifyLink(url: string): LinkClassification {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return generic(url);
    const host = parsed.hostname.toLowerCase();
    if (isLoopback(host)) return { provider: "local", icon: ICONS.local, label: url };

    let provider: LinkProvider | undefined;
    if (matchesHost(host, "atlassian.net") && host !== "atlassian.net" && JIRA_BROWSE.test(parsed.pathname)) {
      provider = "jira";
    } else {
      provider = HOST_TABLE.find(([base]) => matchesHost(host, base))?.[1];
    }
    if (!provider) return generic(url);
    return { provider, icon: ICONS[provider], label: shortLabel(provider, host, parsed.pathname) ?? url };
  } catch {
    return generic(url);
  }
}
