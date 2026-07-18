/**
 * Table-driven tests for `mapInitStderrToHint`. Each row asserts a
 * canonical hint short-string for a representative stderr fragment from a
 * real-world install failure.
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect } from "vitest";
import { mapInitStderrToHint } from "../git-worktree/worktree-init-errors.js";

interface Case { name: string; stderr: string; hint: string; }

const cases: Case[] = [
  {
    name: "EACCES on writes",
    stderr: "npm ERR! code EACCES\nnpm ERR! syscall mkdir\nnpm ERR! path /usr/local/lib/node_modules",
    hint: "permission denied — check ownership of the worktree directory",
  },
  {
    name: "engine mismatch (npm)",
    stderr: "npm ERR! code EBADENGINE\nnpm ERR! engine Unsupported engine\nnpm ERR! engine Not compatible with your version of node/npm",
    hint: "node engine mismatch — install/use the version pinned in package.json#engines",
  },
  {
    name: "ETARGET (unresolved package version)",
    stderr: "npm ERR! code ETARGET\nnpm ERR! notarget No matching version found for foo@^99.0.0",
    hint: "package version not found in the registry — check lockfile + registry",
  },
  {
    name: "npm ci lockfile drift",
    stderr: "npm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync",
    hint: "lockfile drift — package.json and package-lock.json disagree; run `npm install` to refresh",
  },
  {
    name: "ENOTFOUND (network)",
    stderr: "npm ERR! code ENOTFOUND\nnpm ERR! syscall getaddrinfo\nnpm ERR! errno ENOTFOUND",
    hint: "registry unreachable — check network / proxy",
  },
  {
    name: "ECONNRESET",
    stderr: "npm ERR! code ECONNRESET\nnpm ERR! errno ECONNRESET",
    hint: "registry unreachable — check network / proxy",
  },
  {
    name: "pnpm: ERR_PNPM_NO_LOCKFILE",
    stderr: "ERR_PNPM_NO_LOCKFILE  Cannot install with \"frozen-lockfile\" because pnpm-lock.yaml is absent",
    hint: "pnpm lockfile missing — run `pnpm install` to generate it",
  },
  {
    name: "unrecognized failure → null",
    stderr: "Some totally bespoke error nobody has ever seen before",
    hint: "",
  },
  {
    name: "empty stderr → null",
    stderr: "",
    hint: "",
  },
];

describe("mapInitStderrToHint", () => {
  for (const c of cases) {
    it(`${c.name}`, () => {
      const result = mapInitStderrToHint(c.stderr);
      if (c.hint === "") {
        expect(result).toBeNull();
      } else {
        expect(result).toBe(c.hint);
      }
    });
  }
});
