# __tests__/event-wiring-model-state.test.ts — index

Model/thinking replay regression: marked history cannot overwrite the live register (normal, skip-wipe, late frames); unmarked live selections still apply inside a replay window and outside it; a live selection made during replay rides the replay-exit `broadcastSessionUpdated` (`model`/`thinkingLevel`).
