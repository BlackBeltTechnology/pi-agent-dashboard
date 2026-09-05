# 10-faux-model.sh — index

VM smoke: faux prompt round-trip on clean box. Node driver connects `/ws`, snapshots pre-existing sessions, spawns `pi --mode rpc -e <fixture> --model faux/faux-1` (FAUX_SCRIPT=plain-text), drives prompt via REST, asserts scripted text on `/ws`. `SKIP:`+exit 0 when pi absent. Registered in `qa/tests/run-all.sh`. See change: add-faux-model-integration-tests.
