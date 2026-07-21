/**
 * Utility to build a directory tree structure from a flat list of file paths.
 */
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

export interface TreeNode {
  /** Display name (file or directory name) */
  name: string;
  /** Full relative path */
  path: string;
  /** Whether this is a directory */
  isDir: boolean;
  /** Child nodes (directories and files) */
  children: TreeNode[];
  /** File diff entry (only for file nodes) */
  file?: FileDiffEntry;
}

/** Sentinel path for the synthetic "outside workspace" group node. */
export const OUTSIDE_WORKSPACE_PATH = "\u0000outside-workspace";

/**
 * Build a tree structure from file diff entries.
 * Groups files by directory, collapsing single-child directory chains.
 *
 * Out-of-cwd entries (`previewable === false`, keyed by ABSOLUTE path) are NOT
 * split into the relative tree — an absolute `/tmp/x` would yield a blank-root
 * (`""`) node and an incoherent mixed tree. They are collected under a distinct
 * "outside workspace" group node (leaf per file, basename label). See change:
 * opt-in-out-of-cwd-session-diffs.
 */
export function buildFileTree(files: FileDiffEntry[]): TreeNode[] {
  if (files.length === 0) return [];

  const inCwd = files.filter((f) => f.previewable !== false);
  const outOfCwd = files.filter((f) => f.previewable === false);

  // Build raw tree from in-cwd entries only.
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of inCwd) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: partPath,
          isDir: !isFile,
          children: [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetically
  sortTree(root);

  // Collapse single-child directory chains (e.g., src/server → src/server)
  collapseTree(root);

  const result = root.children;

  if (outOfCwd.length > 0) {
    const children: TreeNode[] = outOfCwd
      .map((file) => ({
        name: file.path.split(/[/\\]/).pop() || file.path,
        path: file.path,
        isDir: false,
        children: [],
        file,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      name: "outside workspace",
      path: OUTSIDE_WORKSPACE_PATH,
      isDir: true,
      children,
    });
  }

  return result;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.isDir) sortTree(child);
  }
}

function collapseTree(node: TreeNode): void {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    // Collapse single-child directory chains
    while (child.isDir && child.children.length === 1 && child.children[0].isDir) {
      const grandchild = child.children[0];
      child = {
        ...grandchild,
        name: `${child.name}/${grandchild.name}`,
      };
      node.children[i] = child;
    }
    if (child.isDir) collapseTree(child);
  }
}
