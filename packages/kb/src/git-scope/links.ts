// Cross-links between history items (design G6): `#N`, `!N` (GitLab), same-repo
// URLs and `See change: <id>` become `references` edges. A target that is not
// indexed yet gets a placeholder node so the edge survives until it syncs.
import type { ForgeKind } from "../config.js";
import type { GraphEdge, RawDb } from "../types.js";

export interface LinkCtx {
  forge: ForgeKind | null;
  /** `host/owner/repo`, lower-case. Same-repo URLs only; foreign repos are ignored. */
  identity: string | null;
}

const MAX_LINKS = 50;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** GitHub and Gitea share one number space for issues and PRs; GitLab does not. */
export const sharedNumberSpace = (forge: ForgeKind | null): boolean => forge === "github" || forge === "gitea";

/** Pure extraction → target ids (`issue/12`, `pr/7`, `change:add-foo`), deduped, in first-seen order. */
export function extractRefs(text: string, ctx: LinkCtx): string[] {
  const out = new Set<string>();
  const add = (id: string) => out.size < MAX_LINKS && out.add(id);
  if (ctx.identity) {
    const re = new RegExp(`https?://${escapeRe(ctx.identity)}/(?:-/)?(pull|pulls|issues|merge_requests)/(\\d+)`, "gi");
    for (const m of text.matchAll(re)) add(`${/^issues$/i.test(m[1]) ? "issue" : "pr"}/${m[2]}`);
  }
  for (const m of text.matchAll(/(?<![\w/&#])#(\d+)\b/g)) add(`issue/${m[1]}`);
  if (ctx.forge === "gitlab") for (const m of text.matchAll(/(?<![\w/&!])!(\d+)\b/g)) add(`pr/${m[1]}`);
  for (const m of text.matchAll(/See change:\s*([A-Za-z0-9][A-Za-z0-9._-]*)/g)) add(`change:${m[1]}`);
  return [...out];
}

const nodeHasItem = (db: RawDb, name: string): boolean => {
  const r = db.prepare("SELECT path FROM nodes WHERE type='file' AND name=?").get(name) as { path: string | null } | undefined;
  return !!r && r.path !== null;
};

/** Outbound edges for `srcPath`. On a shared-number-space forge a bare `#N` whose
 *  PR is already indexed targets `pr/N` instead of an `issue/N` placeholder. */
export function buildEdges(db: RawDb, srcPath: string, text: string, ctx: LinkCtx): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const id of extractRefs(text, ctx)) {
    let dst = id;
    if (sharedNumberSpace(ctx.forge) && id.startsWith("issue/") && !nodeHasItem(db, id) && nodeHasItem(db, `pr/${id.slice(6)}`)) dst = `pr/${id.slice(6)}`;
    if (dst !== srcPath) edges.push({ src: srcPath, dst, rel: "references" });
  }
  return edges;
}

/** PR `n` just synced on a shared-number-space forge: move edges that pointed at the
 *  `issue/n` placeholder to `pr/n`, then drop the placeholder (never a real issue). */
export function repointIssuePlaceholder(db: RawDb, n: number): void {
  const ph = db.prepare("SELECT id FROM nodes WHERE type='file' AND name=? AND path IS NULL").get(`issue/${n}`) as { id: number } | undefined;
  if (!ph) return;
  db.prepare("INSERT OR IGNORE INTO nodes(type,name,path) VALUES('file',?,NULL)").run(`pr/${n}`);
  const pr = db.prepare("SELECT id FROM nodes WHERE type='file' AND name=?").get(`pr/${n}`) as { id: number };
  db.prepare("UPDATE OR IGNORE edges SET dst=? WHERE dst=?").run(pr.id, ph.id);
  db.prepare("DELETE FROM edges WHERE dst=?").run(ph.id);
  db.prepare("DELETE FROM nodes WHERE id=?").run(ph.id);
}

/** Outbound + inbound neighbours of an item path (for the `Linked:` line). `indexed`
 *  is false for a placeholder whose item has not synced yet. */
export function linkedItems(db: RawDb, path: string, max = 20): Array<{ id: string; indexed: boolean }> {
  const rows = db
    .prepare(
      `SELECT n.name AS name, n.path AS path FROM edges e JOIN nodes n ON n.id = e.dst JOIN nodes s ON s.id = e.src WHERE s.type='file' AND s.name=?
       UNION SELECT s.name AS name, s.path AS path FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes n ON n.id = e.dst WHERE n.type='file' AND n.name=?
       ORDER BY name LIMIT ?`,
    )
    .all(path, path, max) as Array<{ name: string; path: string | null }>;
  return rows.map((r) => ({ id: r.name, indexed: r.path !== null }));
}
