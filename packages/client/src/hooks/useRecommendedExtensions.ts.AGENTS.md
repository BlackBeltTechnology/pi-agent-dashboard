# useRecommendedExtensions.ts — index

Fetches `GET /api/packages/recommended`, returns `EnrichedRecommendedExtension[]` + `isLoading`/`error`/`refresh`. Refetches on `pi-package-event` (`package_operation_complete`+success). Exports `useRecommendedExtensions`.
