# __tests__/node-cap-single-source.test.ts — index

Repo-lint (#E5): engines-cap arithmetic lives only in `node-version.ts`. Scans `packages/*/src/**` for `/major\s*>=\s*2\d/`, EXCLUDING `__tests__/` (load-bearing — this file states both literals, so it would self-match); sole hit must be `node-version.ts` at `27`. Code only — the message literal is covered by server `node-cap-message-matches-engines.test.ts` (#E10).
