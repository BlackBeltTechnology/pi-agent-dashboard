/**
 * Build-time fetch of the latest GitHub release, grouped by platform.
 *
 * Resolution order:
 *   1. Live GitHub API fetch — freshest, picked on every build.
 *   2. Static cache at `site/src/data/latest-release.json` — updated on
 *      every release by `.github/workflows/sync-release-version.yml`,
 *      committed back to develop. Survives offline / rate-limited builds
 *      and is human-inspectable in git history.
 *   3. `null` — components fall back to a generic "releases" link.
 *
 * The deploy-site workflow also triggers on `release: { types: [published] }`
 * so each new release rebuilds and redeploys the site with fresh data.
 */

import cachedRelease from "~/data/latest-release.json";

const REPO = "BlackBeltTechnology/pi-agent-dashboard";
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_JSON = `https://api.github.com/repos/${REPO}/releases/latest`;

export const FALLBACK_RELEASES_URL = RELEASES_URL;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  downloadCount: number;
}

export interface PlatformBundle {
  id: "macos" | "linux" | "windows";
  label: string;
  primary?: ReleaseAsset;
  items: Array<{ kind: string; asset: ReleaseAsset }>;
  /**
   * Per-arch primary picks for platforms that publish multiple arches
   * (currently macOS: Apple Silicon arm64 + Intel x64). Populated only
   * when the platform's items contain BOTH arches; otherwise undefined,
   * which signals the renderer to fall back to single-button behavior.
   * Field is additive — older renderers can ignore it safely.
   */
  primaryByArch?: {
    arm64?: { kind: string; asset: ReleaseAsset };
    x64?: { kind: string; asset: ReleaseAsset };
  };
}

export interface LatestRelease {
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  notesMarkdown: string;
  platforms: PlatformBundle[];
  releasesUrl: string;
}

function classify(
  name: string,
): { platform: PlatformBundle["id"]; kind: string; priority: number } | null {
  const n = name.toLowerCase();

  if (n.endsWith(".dmg")) {
    if (n.includes("arm64") || n.includes("apple"))
      return { platform: "macos", kind: "DMG (Apple Silicon)", priority: 1 };
    if (n.includes("x64") || n.includes("intel"))
      return { platform: "macos", kind: "DMG (Intel)", priority: 2 };
    return { platform: "macos", kind: "DMG (universal)", priority: 0 };
  }

  if (n.endsWith(".appimage"))
    return { platform: "linux", kind: "AppImage", priority: 0 };
  if (n.endsWith(".deb")) {
    if (n.includes("arm64"))
      return { platform: "linux", kind: ".deb (arm64)", priority: 2 };
    return { platform: "linux", kind: ".deb (x64)", priority: 1 };
  }

  if (n.endsWith(".exe")) {
    if (n.includes("setup"))
      return { platform: "windows", kind: "Installer (.exe)", priority: 0 };
    if (n.includes("arm64") && n.includes("portable"))
      return { platform: "windows", kind: "Portable (arm64)", priority: 3 };
    if (n.includes("portable"))
      return { platform: "windows", kind: "Portable (x64)", priority: 2 };
    return { platform: "windows", kind: "Windows .exe", priority: 1 };
  }
  if (n.endsWith(".zip") && n.includes("win32")) {
    if (n.includes("arm64"))
      return { platform: "windows", kind: "Windows ZIP (arm64)", priority: 5 };
    return { platform: "windows", kind: "Windows ZIP (x64)", priority: 4 };
  }

  return null;
}

interface RawRelease {
  tag_name?: string;
  tagName?: string;
  name?: string;
  html_url?: string;
  url?: string;
  published_at?: string;
  publishedAt?: string;
  body?: string;
  assets?: Array<{
    name: string;
    browser_download_url?: string;
    url?: string;
    size: number;
    download_count?: number;
    downloadCount?: number;
  }>;
}

function normalize(data: RawRelease): LatestRelease {
  const buckets: Record<PlatformBundle["id"], PlatformBundle> = {
    macos: { id: "macos", label: "macOS", items: [] },
    linux: { id: "linux", label: "Linux", items: [] },
    windows: { id: "windows", label: "Windows", items: [] },
  };

  for (const a of data.assets ?? []) {
    const c = classify(a.name);
    if (!c) continue;
    buckets[c.platform].items.push({
      kind: c.kind,
      asset: {
        name: a.name,
        url: a.browser_download_url ?? a.url ?? "",
        size: a.size,
        downloadCount: a.download_count ?? a.downloadCount ?? 0,
      },
    });
  }

  for (const p of Object.values(buckets)) {
    p.items.sort((a, b) => {
      const pa = classify(a.asset.name)?.priority ?? 99;
      const pb = classify(b.asset.name)?.priority ?? 99;
      return pa - pb;
    });
    p.primary = p.items[0]?.asset;
  }

  // Populate primaryByArch for macOS when both arches are present.
  // Classifier kinds for macOS DMGs: "DMG (Apple Silicon)" / "DMG (Intel)"
  // / "DMG (universal)". We surface arm64+x64 as separate buttons; if only
  // a universal DMG ships, leave primaryByArch undefined so the renderer
  // falls back to the single-button path (the universal asset is primary).
  const mac = buckets.macos;
  const armEntry = mac.items.find((it) => /apple silicon|arm64/i.test(it.kind));
  const x64Entry = mac.items.find((it) => /intel|x64/i.test(it.kind));
  if (armEntry && x64Entry) {
    mac.primaryByArch = { arm64: armEntry, x64: x64Entry };
  }

  return {
    tagName: data.tag_name ?? data.tagName ?? "",
    name: data.name ?? data.tag_name ?? data.tagName ?? "",
    url: data.html_url ?? data.url ?? RELEASES_URL,
    publishedAt: data.published_at ?? data.publishedAt ?? "",
    notesMarkdown: data.body ?? "",
    platforms: [buckets.macos, buckets.linux, buckets.windows],
    releasesUrl: RELEASES_URL,
  };
}

function fromCache(): LatestRelease | null {
  try {
    const c = cachedRelease as RawRelease;
    if (!c || !(c.tag_name || c.tagName)) return null;
    return normalize(c);
  } catch {
    return null;
  }
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  // Escape hatch for offline / CI-avoid-rate-limit builds.
  if (process.env.PI_SKIP_RELEASE_FETCH === "1") {
    // eslint-disable-next-line no-console
    console.log("[github-release] PI_SKIP_RELEASE_FETCH=1 — using cache");
    return fromCache();
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN)
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(LATEST_JSON, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[github-release] API ${res.status} ${res.statusText} — using cache`,
      );
      return fromCache();
    }
    return normalize((await res.json()) as RawRelease);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[github-release] fetch failed (${(err as Error).message}) — using cache`,
    );
    return fromCache();
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
