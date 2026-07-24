# ThinkingLevelSelector.tsx — index

Thinking-level picker. Optional prop `supportedLevels` filters `THINKING_LEVELS` to supported set (canonical order). Falls back to all six when `supportedLevels` undefined/empty. See change: adopt-pi-071-072-073-features.

See change: fix-popover-container-clip — `boundaryRef` + `estimatedWidth:128` + `preferredAnchor:"left"` (in the ChatView pane, NOT immune); `anchorRight ? right-0 : left-0`.

See change: honor-native-models-json-metadata — `THINKING_LEVELS` extended to `off..xhigh,max`; `max` is opt-in, renders ONLY when `supportedLevels` explicitly includes it (a max-capable session runtime + native `thinkingLevelMap.max`, derived extension-side). The undefined/empty FALLBACK stays six (`FALLBACK_LEVELS`, no `max`).
