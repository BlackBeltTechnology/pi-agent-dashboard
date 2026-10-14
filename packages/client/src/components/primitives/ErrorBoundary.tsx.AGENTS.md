# ErrorBoundary.tsx — index

Generic React error boundary. Exports `ErrorBoundary`. Catches render errors via `getDerivedStateFromError`; logs to console in `componentDidCatch`. Renders `fallback` prop or default red error card with `error.message`.

Optional `resetKey?: unknown` prop: while showing the fallback, a changed `resetKey` clears the error state (`componentDidUpdate`) so children are retried; omitted → sticky as before. Used by `MarkdownContent` (`resetKey=content`). See change: sanitize-untrusted-rendered-content.
