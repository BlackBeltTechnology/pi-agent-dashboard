/**
 * Cheap live reader for `sudoCredentialPrompt`. `loadConfig()` re-reads and
 * re-parses the whole config file, which is too heavy for a poll tick plus every
 * helper request, so the parsed section is cached against the file's mtime and
 * re-read only when it changes (the live-disable path, G6).
 *
 * See change: add-sudo-credential-prompt (D2, D3).
 */

import {
  parseSudoCredentialPrompt,
  type SudoCredentialPromptConfig,
} from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";

export interface SudoConfigReaderDeps {
  /** The raw `sudoCredentialPrompt` section of the current config (clamped here). */
  load: () => unknown;
  /** The config file's mtime in ms; undefined when it cannot be read (then every call reloads). */
  mtimeMs: () => number | undefined;
}

export function createSudoConfigReader(deps: SudoConfigReaderDeps): () => SudoCredentialPromptConfig {
  let cachedMtime: number | undefined;
  let cached: SudoCredentialPromptConfig | undefined;
  return () => {
    const mtime = deps.mtimeMs();
    if (cached && mtime !== undefined && mtime === cachedMtime) return cached;
    cached = parseSudoCredentialPrompt(deps.load());
    cachedMtime = mtime;
    return cached;
  };
}
