// Adapter factory: resolved forge identity → adapter (or null when unsupported).
import type { GitConfig } from "../../config.js";
import type { GitScopeDeps } from "../deps.js";
import type { ForgeResolution } from "../repo.js";
import { createGiteaAdapter } from "./gitea.js";
import { createGithubAdapter } from "./github.js";
import { createGitlabAdapter } from "./gitlab.js";
import type { ForgeAdapter } from "./types.js";

export function createAdapter(deps: GitScopeDeps, forge: Extract<ForgeResolution, { kind: "ok" }>, cfg: GitConfig): ForgeAdapter {
  const path = forge.segments.join("/");
  if (forge.forge === "github") return createGithubAdapter(deps, { host: forge.hostname, path });
  if (forge.forge === "gitlab") return createGitlabAdapter(deps, { host: forge.hostname, path });
  const hosts = cfg.forge.hosts;
  const allowlisted = hosts[forge.host] === "gitea" || hosts[forge.hostname] === "gitea";
  return createGiteaAdapter(deps, { host: forge.host, path }, { allowlisted, tokenEnv: cfg.forge.gitea.tokenEnv });
}
