/**
 * Pure folder-tree builder for the Instructions file picker.
 *
 * Folds the flat `MdCandidate.relPath` list returned by
 * `GET /api/file/md-candidates` into a nested directory tree: each `relPath` is
 * split on `/`, intermediate segments become directory nodes, and the final
 * segment becomes a leaf file. Plain tree — single-child directories are NOT
 * merged (`.pi/skills/autofix/SKILL.md` stays `skills › autofix › SKILL.md`).
 * Directories and files are each sorted alphabetically for stable rendering.
 *
 * See change: directory-settings-tree-and-resize.
 */
import type { MdCandidate } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

/** A leaf file: its basename plus the originating candidate. */
export interface FileLeaf {
  name: string;
  candidate: MdCandidate;
}

/** A directory node (root has `name === "" && path === ""`). */
export interface TreeNode {
  name: string;
  /** Full directory path from the root, e.g. `.pi/agents`. Empty for the root. */
  path: string;
  dirs: TreeNode[];
  files: FileLeaf[];
}

interface Building {
  dirs: Map<string, Building>;
  files: FileLeaf[];
}

function newBuilding(): Building {
  return { dirs: new Map(), files: [] };
}

function finalize(name: string, path: string, b: Building): TreeNode {
  const dirs = [...b.dirs.entries()]
    .sort((a, z) => a[0].localeCompare(z[0]))
    .map(([n, child]) => finalize(n, path ? `${path}/${n}` : n, child));
  const files = [...b.files].sort((a, z) => a.name.localeCompare(z.name));
  return { name, path, dirs, files };
}

/** Build a nested folder tree from a flat candidate list. */
export function buildTree(candidates: MdCandidate[]): TreeNode {
  const root = newBuilding();
  for (const candidate of candidates) {
    const segments = candidate.relPath.split("/");
    const fileName = segments.pop() ?? candidate.relPath;
    let node = root;
    for (const seg of segments) {
      let child = node.dirs.get(seg);
      if (!child) {
        child = newBuilding();
        node.dirs.set(seg, child);
      }
      node = child;
    }
    node.files.push({ name: fileName, candidate });
  }
  return finalize("", "", root);
}

/** Whether `node`'s name, any descendant file's relPath, or a nested dir matches `q`. */
export function subtreeMatches(node: TreeNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q)) return true;
  for (const f of node.files) {
    if (f.candidate.relPath.toLowerCase().includes(q)) return true;
  }
  for (const d of node.dirs) {
    if (subtreeMatches(d, q)) return true;
  }
  return false;
}
