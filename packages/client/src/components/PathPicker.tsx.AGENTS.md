# PathPicker.tsx — index

Reusable keyboard-first path picker with typeahead directory list. Change `fix-pathpicker-windows-trailing-sep`: `tryConfirm` Rule 2 accepts `\` trailing separator (Windows + UNC), not just `/`. See change: distinguish-offline-from-network-denied — new onOpenServers prop; browse 403 network_not_allowed sets denial state, renders remedy hint + Settings → Servers affordance instead of bare error.
