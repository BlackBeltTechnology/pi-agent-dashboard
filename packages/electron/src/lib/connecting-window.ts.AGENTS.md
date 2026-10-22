# connecting-window.ts — index

`openConnectingWindow(initial, onClosed)` → `ConnectingHandle{push,focus,close,isOpen}`; `getConnectingWindow()`. Loads bundled `renderer/connecting.html` only; wizard preload; sandbox. Only window that ever sees the knock confirm code. Pairing state pushed on `servers:connecting-state`. See change: add-electron-server-windows (D11).
