/**
 * Baseline deck (spec "Baseline deck") and the re-import rules (spec
 * "Re-import keeps tuning"): slide id matching by fingerprint, then by title
 * at the nearest position; baseline overrides added only where absent; and
 * reconciliation of imported (`pptx-`) assets by id.
 */
import type { Draft } from "./shapes.js";
import { luminance } from "./theme.js";
import type { Layout, LayoutSlide, MediaFile, ThemeInfo } from "./types.js";

export interface AssetEntry {
  id: string;
  path: string;
  sha256: string;
  mime: string;
}

export const LAYOUT_ASSET_ID = "pptx-layout";

/** One markdown line safe for the deck grammar (no heading/bullet/fence/comment/pin). */
export function mdLine(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/```/g, "'''")
    .replace(/<!--/g, "<!-")
    .replace(/\{#/g, "{ #")
    .replace(/^[#>*\-+\s]+/, "")
    .replace(/^(\d+)\.\s/, "$1 ");
}

const SKIP_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum"]);

/** Subtitle + bullets: paragraphs of the slide's own non-title text items. */
export function slideBody(drafts: Draft[]): { subtitle?: string; bullets: string[] } {
  const paras: string[] = [];
  for (const d of drafts) {
    if (d.isTitle || d.item.origin || d.item.kind !== "text") continue;
    if (d.placeholder && SKIP_PLACEHOLDERS.has(d.placeholder)) continue;
    for (const p of d.text.split("\n")) {
      const line = mdLine(p);
      if (line) paras.push(line);
    }
  }
  const [subtitle, ...bullets] = paras;
  return subtitle ? { subtitle, bullets } : { bullets: [] };
}

export function baselineMarkdown(slides: Array<{ id: string; title: string; drafts: Draft[] }>): string {
  const out: string[] = [];
  for (const s of slides) {
    const title = mdLine(s.title);
    out.push(`# ${title ? `${title} ` : ""}{#${s.id}}`, "");
    const body = slideBody(s.drafts);
    if (body.subtitle) out.push(body.subtitle, "");
    for (const b of body.bullets) out.push(`- ${b}`);
    if (body.bullets.length) out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** `light` when the dominant background luminance is above 0.5. */
export function baselineMode(layout: Layout): "light" | "dark" {
  const colors = layout.slides.map((s) => s.background?.color).filter((c): c is string => !!c);
  const counts = new Map<string, number>();
  for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? layout.theme.colors.lt1;
  return luminance(dominant) > 0.5 ? "light" : "dark";
}

export function baselineDeckOverrides(theme: ThemeInfo, mode: "light" | "dark"): Record<string, unknown> {
  return {
    palette: "custom",
    mode,
    colors: { accent: theme.colors.accent1, secondary: theme.colors.accent2, card: mode === "light" ? theme.colors.lt2 : theme.colors.dk2 },
  };
}

export function importedAssets(media: MediaFile[], layoutSha: string): AssetEntry[] {
  const out: AssetEntry[] = [{ id: LAYOUT_ASSET_ID, path: "pptx/layout.json", sha256: layoutSha, mime: "application/json" }];
  for (const m of media) out.push({ id: m.asset, path: `pptx/media/${m.name}`, sha256: m.sha256, mime: m.mime });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ── re-import ────────────────────────────────────────────────────────────────

export interface IdMatch {
  ids: string[];
  warnings: string[];
}

/**
 * Give each new slide the id of the previous slide with an equal fingerprint,
 * else of the previous slide with the same title at the nearest position,
 * else the next unused `sNN`. Every new, moved or vanished id is reported.
 */
export function matchSlideIds(next: Array<{ title: string; fingerprint: string }>, previous: LayoutSlide[] | undefined): IdMatch {
  const pad = (n: number) => `s${String(n).padStart(2, "0")}`;
  if (!previous?.length) return { ids: next.map((_, i) => pad(i + 1)), warnings: [] };
  const used = new Set<string>();
  const ids: Array<string | undefined> = next.map(() => undefined);
  next.forEach((s, i) => {
    const hit = previous.find((p) => !used.has(p.id) && p.fingerprint === s.fingerprint);
    if (hit) {
      ids[i] = hit.id;
      used.add(hit.id);
    }
  });
  next.forEach((s, i) => {
    if (ids[i] || !s.title) return;
    const candidates = previous.filter((p) => !used.has(p.id) && p.title === s.title);
    candidates.sort((a, b) => Math.abs(a.index - (i + 1)) - Math.abs(b.index - (i + 1)) || a.index - b.index);
    const hit = candidates[0];
    if (hit) {
      ids[i] = hit.id;
      used.add(hit.id);
    }
  });
  let n = Math.max(0, ...previous.map((p) => Number(/^s(\d+)$/.exec(p.id)?.[1] ?? 0)));
  const warnings: string[] = [];
  const final = ids.map((id, i) => {
    if (id) return id;
    let fresh: string;
    do fresh = pad(++n);
    while (used.has(fresh));
    used.add(fresh);
    warnings.push(`warning slide ${fresh} is new (position ${i + 1}${next[i].title ? `: "${next[i].title}"` : ""})`);
    return fresh;
  });
  final.forEach((id, i) => {
    const prev = previous.find((p) => p.id === id);
    if (prev && prev.index !== i + 1) warnings.push(`warning slide ${id} moved from position ${prev.index} to ${i + 1}`);
  });
  for (const p of previous) if (!final.includes(p.id)) warnings.push(`warning slide ${p.id} vanished (was position ${p.index}${p.title ? `: "${p.title}"` : ""})`);
  return { ids: final, warnings };
}

/** `overrides` paths of effect params whose string value equals `id`. */
export function effectParamRefs(overrides: Record<string, unknown>, id: string): string[] {
  const refs: string[] = [];
  const scan = (v: unknown, at: string): void => {
    if (v === id) refs.push(at);
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${at}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${at}.${k}`);
  };
  const lists: Array<[unknown, string]> = [[overrides.effects, "overrides.effects"]];
  for (const [sid, s] of Object.entries((overrides.slides ?? {}) as Record<string, { effects?: unknown }>)) {
    lists.push([s.effects, `overrides.slides["${sid}"].effects`]);
  }
  for (const [list, at] of lists) {
    if (!Array.isArray(list)) continue;
    list.forEach((ref, i) => scan((ref as { params?: unknown }).params, `${at}[${i}].params`));
  }
  return refs;
}

export interface Reconciled {
  assets: AssetEntry[];
  warnings: string[];
  /** Non-empty ⇒ the import must fail without writing. */
  dangling: string[];
}

/**
 * Keep user assets (no `pptx-` prefix) untouched; replace imported ones by
 * id; drop imported ids whose part vanished — failing when an effect param
 * still references one.
 */
export function reconcileAssets(previous: AssetEntry[] | undefined, imported: AssetEntry[], overrides: Record<string, unknown>): Reconciled {
  const user = (previous ?? []).filter((a) => !a.id.startsWith("pptx-"));
  const nextIds = new Set(imported.map((a) => a.id));
  const warnings: string[] = [];
  const dangling: string[] = [];
  for (const a of previous ?? []) {
    if (!a.id.startsWith("pptx-") || nextIds.has(a.id)) continue;
    const refs = effectParamRefs(overrides, a.id);
    if (refs.length) dangling.push(...refs.map((r) => `${r} references dropped asset '${a.id}'`));
    else warnings.push(`warning asset ${a.id} dropped (its pptx part vanished)`);
  }
  const userIds = new Set(user.map((a) => a.id));
  const merged = [...user, ...imported.filter((a) => !userIds.has(a.id))];
  return { assets: merged.sort((a, b) => a.id.localeCompare(b.id)), warnings, dangling };
}
