# ErrorBoundary.tsx — index

Generic React error boundary. Exports `ErrorBoundary`. Catches render errors via `getDerivedStateFromError`; logs to console in `componentDidCatch`. Renders `fallback` prop or default red error card with `error.message`.
