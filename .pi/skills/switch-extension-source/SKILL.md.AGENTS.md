# switch-extension-source/SKILL.md — index

Skill. Switch monorepo extension/skill package between published npm source and local working-tree source. Guarantees one source per package. Writes global `~/.pi/agent/settings.json` packages[]; project `.pi/settings.json` only cleaned (old `+packages/<dir>/` overlay paths stripped, empty filters pruned), never added to. No overlay mode. Pitfall: empty project filter shadows same-path global bridge → `REGISTER_TIMEOUT`. Takes effect next session start.
