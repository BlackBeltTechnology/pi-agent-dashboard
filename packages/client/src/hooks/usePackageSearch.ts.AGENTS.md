# usePackageSearch.ts — index

Debounced npm package search via `GET /api/packages/search?q=&type=`. Returns `{ query, setQuery, typeFilter, setTypeFilter, packages, total, isLoading, error, refresh }`. 400ms debounce on query; no debounce on initial/type-only. Aborts stale requests.
