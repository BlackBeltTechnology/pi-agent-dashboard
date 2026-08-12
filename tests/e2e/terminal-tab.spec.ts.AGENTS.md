# terminal-tab.spec.ts — index

Terminal-as-tab spec (change: terminals-in-tabbed-panes). Opens the session split, asserts no terminal tab until `+ Terminal` (`new-terminal-launch`, opt-in D3), then create → `term:<id>` tab + live xterm (`Terminal input` textbox) + close-tab kills it (D4). Folder auto-surface/reconcile stay L1 (harness-flaky).
