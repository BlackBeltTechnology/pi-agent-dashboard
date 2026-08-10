# DOX — qa

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). Subdir files owned by their own `AGENTS.md` (`fixtures/`, `packer/`, `scripts/`, `tests/`). See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores VM build artifacts: `output/` images, `iso/` downloads, `packer_cache/`, `clones/` working dirs, `crash.log`. |
| `Makefile` | Build/test/manual/clean targets for QA VMs. Targets: `build-{linux-x86,linux-arm,windows,macos-x86,macos-arm,-all}`, `test-{linux-x86,linux-arm,windows,macos-x86,macos-arm,-all}`, `manual-<target>`, `clean`, `test-windows-remote-nsis SETUP=<Setup.exe>`. Preflight `check_placeholders` / `check_user_data` reject unfilled `REPLACE_WITH_` var files. Calls `scripts/run-test.sh`, `scripts/vm-clone.sh`, `scripts/vm-destroy.sh`. SSH user `qa`, key `~/.ssh/qa_vm_key`, `VMRUN` path hard-coded to VMware Fusion. |
| `README.md` | Full QA setup + usage docs. Prereqs (Packer, VMware Fusion, `ssh-keygen -t ed25519 -f ~/.ssh/qa_vm_key`), ISO download table, hardware split (Intel Mac x86 builder, M1 Mac ARM builder), quick start (`make build-/test-/manual-`), manual macOS VM install steps (`vmware-vmx` builder, no unattended install), test coverage list (install, server start, WS, terminal, git ops, Electron zip V2 bootstrap Windows, NSIS Setup.exe smoke Windows, Electron real-launch Linux `xvfb-run`), directory structure map. |
