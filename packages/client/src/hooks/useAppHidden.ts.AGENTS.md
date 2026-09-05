# useAppHidden.ts — index

NEW. Exports `useAppHidden()` hook + `applyAppHiddenClass(root, hidden)`. Toggles `app-hidden` class on document root from `document.visibilityState`; listens visibilitychange + window blur/focus. CSS `:root.app-hidden *` sets `animation-play-state: paused`, freezes compositor when window hidden to tray. See change: throttle-idle-ui-animations.
