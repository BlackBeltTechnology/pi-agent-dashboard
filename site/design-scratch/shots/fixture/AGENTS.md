# sample-git

Small TypeScript workspace: an in-memory session store plus display formatters.

## Layout

| Path | Purpose |
|---|---|
| `src/session-store.ts` | `SessionStore` — Map-backed session registry with a change feed |
| `src/format.ts` | Pure display helpers: bytes, elapsed, tokens, cost, truncate |
| `src/__tests__/format.test.ts` | Unit tests for the formatters |

## Commands

```bash
npm test          # vitest
npm run build     # tsc
```

## Conventions

- Formatters are pure and total — they return `—` rather than throwing.
- `SessionStore` preserves insertion order; cards must not reorder mid-stream.
