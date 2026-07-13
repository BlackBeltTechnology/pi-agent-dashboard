# Tasks — signpost-camera-scan-pairing

## 1. Signpost camera scan in the operator UI

- [ ] 1.1 In `packages/client/src/components/Gateway/GatewayPairQR.tsx`, add a primary instruction adjacent to the QR (pairing selection only): "Scan with your phone camera — no typing needed." → verify: rendered text present when a TLS pairing endpoint is selected.
- [ ] 1.2 Enlarge the pairing QR from 132px to ~180px (`QrCanvas` `size` prop for the pairing case); keep it responsive-safe. → verify: canvas `width` reflects the new size; layout unbroken at mobile/desktop widths.
- [ ] 1.3 Label the copy-string box as a fallback ("Or paste in the desktop app") and keep its copy button + bare-payload content unchanged. → verify: fallback label present; copy-string still the bare `pi:pair:v1.…` payload.

## 2. Tests

- [ ] 2.1 Extend the `GatewayPairQR` render test: assert the camera-scan instruction renders for a TLS pairing selection and is ABSENT for a link (no-TLS) selection. → verify: test passes.
- [ ] 2.2 Assert the copy-string carries its fallback label and still equals the bare payload string. → verify: test passes.
- [ ] 2.3 Assert the pairing QR canvas renders at the enlarged size. → verify: test passes.

## 3. Accessibility (accessibility-a11y checkpoint)

- [ ] 3.1 Confirm the new instruction is real text (not icon-only), the QR keeps a `role`/label, and keyboard/tab order through the network selector → copy → approve is unchanged. → verify: manual a11y pass / existing a11y tests green.

## 4. Validate

- [ ] 4.1 `npx openspec validate signpost-camera-scan-pairing --strict` passes.
- [ ] 4.2 `npm run build` + client render tests green; manual check of the "Connect a device" panel shows the camera instruction primary and the copy-string as labeled fallback.
