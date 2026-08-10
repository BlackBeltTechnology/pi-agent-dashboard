# Toast.tsx — index

Canonical `ToastVariant = error\|warning\|success\|info\|neutral` (re-exported by `useAsyncAction`, referenced by `useMessageHandler`). `showToast(text, variant="neutral")` — default flipped error→neutral. `VARIANT_CLASSES` sources every tier from `--severity-*` triples; close (×) = variant `-fg`/70. See change: add-async-action-feedback, unify-message-severity-colors.
