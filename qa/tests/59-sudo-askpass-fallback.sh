#!/usr/bin/env bash
# L2 (Linux): D1 — a REAL sudo falls back to $SUDO_ASKPASS when it has no tty, WITHOUT -A.
#
# test-plan #S78 (add-sudo-credential-prompt). The change's load-bearing assumption was
# verified on macOS sudo only; this records what Linux classic sudo and sudo-rs do:
#   - helper invoked, prompt in argv[1], no `-A` (argc == 1, argv[1] != -A)
#   - wrong password => re-invoked 1..3 times, every time with the SAME $PPID, and that
#     parent is sudo
#   - helper exit 1 => sudo aborts, NO retry (exactly one invocation)
#   - a flavour that never calls the helper is reported "UNSUPPORTED: <flavour>: helper
#     never invoked" (design D1: mark unsupported flavours) — recorded, not a failure,
#     unless NO flavour is supported.
#
# Needs the non-NOPASSWD `qa-sudo` user (packer/scripts/provision-linux.sh). SKIPs
# (exit 0) off Linux, without that user, or without a way to run commands as it.
#
# See change: add-sudo-credential-prompt.
set -euo pipefail

echo "=== Test: sudo SUDO_ASKPASS no-tty fallback ==="

if [ "$(uname -s)" != "Linux" ]; then
  echo "SKIP: Linux only (macOS is covered by manual QA)"
  exit 0
fi

QA_USER="qa-sudo"
QA_PASS="qa-sudo-pass"
if ! id "$QA_USER" >/dev/null 2>&1; then
  echo "SKIP: user '$QA_USER' not provisioned (qa/packer/scripts/provision-linux.sh)"
  exit 0
fi
command -v setsid >/dev/null 2>&1 || { echo "SKIP: setsid not installed"; exit 0; }

# Run a command as the QA user (no tty is guaranteed by the setsid inside).
if [ "$(id -u)" -eq 0 ]; then
  as_qa() { runuser -u "$QA_USER" -- "$@"; }
elif sudo -n true 2>/dev/null; then
  as_qa() { sudo -n -u "$QA_USER" -H "$@"; }
else
  echo "SKIP: neither root nor passwordless sudo to become '$QA_USER'"
  exit 0
fi

WORK="$(mktemp -d /tmp/qa-sudo-askpass.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
chmod 777 "$WORK"

# The capture helper: one line per invocation; behaviour chosen by $WORK/mode.
HELPER="$WORK/askpass.sh"
cat > "$HELPER" <<EOF
#!/usr/bin/env bash
parent=\$(ps -o comm= -p "\$PPID" 2>/dev/null | tr -d ' ')
echo "ppid=\$PPID parent=\$parent argc=\$# arg1=\$1" >> "$WORK/invocations"
case "\$(cat "$WORK/mode")" in
  ok)    printf '%s\n' "$QA_PASS" ;;
  wrong) printf '%s\n' "definitely-not-the-password" ;;
  fail)  exit 1 ;;
esac
EOF
chmod 755 "$HELPER"

# run_sudo <sudo-binary> <mode>: fresh capture, then `sudo -k; sudo true` with no tty.
# Sets RC and leaves the helper's records in $WORK/invocations.
run_sudo() {
  local bin="$1" mode="$2"
  : > "$WORK/invocations"
  echo "$mode" > "$WORK/mode"
  chmod 666 "$WORK/invocations" "$WORK/mode"
  RC=0
  # setsid -w: new session, no controlling tty; stdin from /dev/null, output captured.
  as_qa env SUDO_ASKPASS="$HELPER" timeout 90 setsid -w \
    bash -c "'$bin' -k; '$bin' true" \
    </dev/null >"$WORK/out" 2>&1 || RC=$?
}

invocations() { grep -c '^ppid=' "$WORK/invocations" || true; }

FAILED=0
SUPPORTED=0
fail() { echo "FAIL: $*"; FAILED=1; }

check_flavour() {
  local bin="$1" label="$2"
  echo "--- flavour: $label ($bin) ---"

  # 1. correct password
  run_sudo "$bin" ok
  if [ "$(invocations)" -eq 0 ]; then
    echo "UNSUPPORTED: $label: helper never invoked (rc=$RC; sudo output: $(tr '\n' ' ' < "$WORK/out" | head -c 200))"
    return 0
  fi
  SUPPORTED=$((SUPPORTED + 1))
  [ "$RC" -eq 0 ] || fail "$label: correct password via helper: sudo exited $RC"
  FIRST=$(head -1 "$WORK/invocations")
  case "$FIRST" in *" argc=1 "*) ;; *) fail "$label: helper argc != 1 (invoked with -A or extra args): $FIRST" ;; esac
  case "$FIRST" in *"arg1=-A"*) fail "$label: helper invoked with -A: $FIRST" ;; esac
  case "$FIRST" in *"arg1=" | *"arg1= ") fail "$label: empty prompt in argv[1]: $FIRST" ;; esac
  case "$FIRST" in *"parent=sudo"*) ;; *) fail "$label: helper's parent is not sudo: $FIRST" ;; esac
  echo "ok: $label: invoked without -A, prompt in argv[1]: ${FIRST#*arg1=}"

  # 2. wrong password: bounded retries, one parent
  run_sudo "$bin" wrong
  N=$(invocations)
  [ "$RC" -ne 0 ] || fail "$label: wrong password but sudo exited 0"
  if [ "$N" -lt 1 ] || [ "$N" -gt 3 ]; then
    fail "$label: wrong password => helper invoked $N times (expected 1..3)"
  fi
  PPIDS=$(sed -n 's/^ppid=\([0-9]*\) .*/\1/p' "$WORK/invocations" | sort -u | wc -l | tr -d ' ')
  [ "$PPIDS" -eq 1 ] || fail "$label: retries came from $PPIDS different parents (expected 1 = sudo)"
  echo "ok: $label: wrong password => $N invocation(s), single parent"

  # 3. helper failure aborts, no retry
  run_sudo "$bin" fail
  N=$(invocations)
  [ "$RC" -ne 0 ] || fail "$label: helper exit 1 but sudo exited 0"
  [ "$N" -eq 1 ] || fail "$label: helper exit 1 => $N invocations (expected exactly 1, no retry)"
  echo "ok: $label: helper exit 1 => sudo aborted after $N invocation(s)"
}

# Flavours present on this host: the system `sudo` (classic or sudo-rs, named by --version)
# and an explicit `sudo-rs` binary when installed alongside it.
declare -A SEEN=()
for bin in sudo sudo-rs; do
  path=$(command -v "$bin" 2>/dev/null || true)
  [ -n "$path" ] || { echo "note: $bin not installed"; continue; }
  real=$(readlink -f "$path")
  [ -z "${SEEN[$real]:-}" ] || continue
  SEEN[$real]=1
  version=$("$path" --version 2>&1 | head -1 || true)
  case "$version" in *sudo-rs*) label="sudo-rs" ;; *) label="sudo-classic" ;; esac
  check_flavour "$path" "$label [$version]"
done

if [ "$SUPPORTED" -eq 0 ]; then
  fail "no sudo flavour on this host calls SUDO_ASKPASS without -A and without a tty (D1 assumption does not hold)"
fi
[ "$FAILED" -eq 0 ] || exit 1
echo "PASS: sudo SUDO_ASKPASS fallback ($SUPPORTED supported flavour(s))"
