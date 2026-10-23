/**
 * Git link builder — parses remote URLs and builds platform-specific links.
 */

import { stripRemoteCredentials } from "@blackbelt-technology/pi-dashboard-shared/remote-credentials.js";

export interface GitLinks {
  branchUrl?: string;
  prUrl?: string;
}

export interface ParsedRemote {
  host: string;
  user: string;
  repo: string;
}

type Platform = "github" | "gitlab" | "bitbucket" | "gitea" | "codeberg" | "sourcehut";

const HOST_TO_PLATFORM: Record<string, Platform> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  "gitea.com": "gitea",
  "codeberg.org": "codeberg",
  "sr.ht": "sourcehut",
};

/** Parse an SSH or HTTPS remote URL into host/user/repo. Credentials never reach a link. */
export function parseRemoteUrl(rawUrl: string): ParsedRemote | undefined {
  // Strip userinfo FIRST so `user:token@host` can never be captured as the host
  // (and so leak into a built link). Unparseable-with-userinfo → no parse, no link.
  // See change: harden-bridge-inbound-and-discovery (D18).
  const stripped = stripRemoteCredentials(rawUrl);
  if (stripped === undefined) return undefined;
  // A query / fragment (`?access_token=…`) is never part of the repository path.
  const url = stripped.replace(/[?#].*$/s, "");
  // SSH: git@host:user/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    const parts = path!.split("/");
    if (parts.length >= 2) {
      return { host: host!, user: parts.slice(0, -1).join("/"), repo: parts[parts.length - 1]! };
    }
  }

  // HTTPS: https://host/user/repo.git
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, path] = httpsMatch;
    const parts = path!.split("/");
    if (parts.length >= 2) {
      return { host: host!, user: parts.slice(0, -1).join("/"), repo: parts[parts.length - 1]! };
    }
  }

  return undefined;
}

/** Detect the hosting platform from a hostname. */
export function detectPlatform(host: string): Platform | undefined {
  return HOST_TO_PLATFORM[host];
}

/** Build branch and PR URLs for a given platform. */
export function buildGitLinks(remoteUrl: string, branch: string, prNumber?: number): GitLinks {
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) return {};

  const platform = detectPlatform(parsed.host);
  if (!platform) return {};

  const baseUrl = `https://${parsed.host}/${parsed.user}/${parsed.repo}`;
  const encodedBranch = encodeURIComponent(branch);

  const links: GitLinks = {};

  // Don't generate branch URL for detached HEAD
  if (branch !== "HEAD") {
    switch (platform) {
      case "github":
      case "sourcehut":
        links.branchUrl = `${baseUrl}/tree/${encodedBranch}`;
        break;
      case "gitlab":
        links.branchUrl = `${baseUrl}/-/tree/${encodedBranch}`;
        break;
      case "bitbucket":
        links.branchUrl = `${baseUrl}/src/${encodedBranch}`;
        break;
      case "gitea":
      case "codeberg":
        links.branchUrl = `${baseUrl}/src/branch/${encodedBranch}`;
        break;
    }
  }

  if (prNumber !== undefined) {
    switch (platform) {
      case "github":
        links.prUrl = `${baseUrl}/pull/${prNumber}`;
        break;
      case "gitlab":
        links.prUrl = `${baseUrl}/-/merge_requests/${prNumber}`;
        break;
      case "bitbucket":
        links.prUrl = `${baseUrl}/pull-requests/${prNumber}`;
        break;
      case "gitea":
      case "codeberg":
        links.prUrl = `${baseUrl}/pulls/${prNumber}`;
        break;
      case "sourcehut":
        links.prUrl = `${baseUrl}/patches/${prNumber}`;
        break;
    }
  }

  return links;
}
