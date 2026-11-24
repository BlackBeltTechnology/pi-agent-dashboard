# DOX — packages/google-plugin/src/client

Settings → Google accounts. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `GoogleSettings.tsx` | Settings section (empty until the accounts UI task: title + intro). |
| `index.tsx` | Client barrel: lazy `GoogleSettings` inside its own `Suspense`; eager `catalog`. |
