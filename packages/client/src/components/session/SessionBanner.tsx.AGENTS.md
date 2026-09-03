# SessionBanner.tsx — index

Single-card error/retry surface driven by `BannerState`. Active retry: error/reason header + retry status/countdown + Copy + local Collapse/Expand; no Retry, dismiss, or banner-owned abort. Settled provider error: Retry + Copy + clear-only X. Hidden state renders nothing. Session Stop outside banner owns abort.

Props: `state`, `onDismiss?`, `onRetry?`, `retryRevision?`, `now?`, `collapseThreshold?`. Retry is one-shot per settled revision: first click disables; changed `lastError.timestamp`, message, or retry phase re-enables. Same-message failure therefore offers Retry again. Collapsed retry re-expands when retry ends so terminal error always exposes X. Billing/quota uses ordinary error variant. Test ids: `error-banner`, `error-banner-text`, `error-banner-retry`, `error-banner-dismiss`, `error-banner-collapse`, `error-banner-expand`, `retry-banner`, `retry-banner-attempt`. See changes: simplify-error-retry-single-card, fix-retry-error-lifecycle.
