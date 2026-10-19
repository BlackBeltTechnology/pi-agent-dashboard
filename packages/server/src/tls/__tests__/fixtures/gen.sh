#!/usr/bin/env bash
# Regenerate the committed TLS test fixtures: one test CA + leaf certificates.
# Node's `crypto` can parse X.509 but not mint it, so openssl does it once and
# the PEMs are committed. Leaf validity is ~100 years so handshake tests never
# expire; the 90-day leaf is for renewal-threshold tests that drive a fake
# clock relative to its own notBefore/notAfter (never a real handshake).
#
# Usage: ./gen.sh   (idempotent: overwrites the PEMs below)
# See change: add-tailscale-cert-tls (task 1.4).
set -euo pipefail
cd "$(dirname "$0")"

ca_crt=ca.pem
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The CA key is throwaway: it only signs the leaves below and is never committed.
ca_key="$tmp/ca-key.pem"

newkey() { openssl genrsa -out "$1" 2048 2>/dev/null; }

newkey "$ca_key"
cat >"$tmp/ca.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=pi-dashboard test CA
[v3]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
CNF
openssl req -x509 -new -sha256 -key "$ca_key" -days 36500 -config "$tmp/ca.cnf" -out "$ca_crt"

# leaf <file-stem> <days> <SAN dns entries...>   (subject CN = first SAN)
leaf() {
  local stem=$1 days=$2; shift 2
  local cn=$1 san="" i=1
  for n in "$@"; do san+="DNS.$i=$n"$'\n'; i=$((i + 1)); done
  newkey "leaf-$stem-key.pem"
  cat >"$tmp/leaf.cnf" <<CNF
[req]
distinguished_name=dn
prompt=no
[dn]
CN=$cn
[ext]
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=@san
[san]
$san
CNF
  openssl req -new -key "leaf-$stem-key.pem" -config "$tmp/leaf.cnf" -out "$tmp/leaf.csr"
  openssl x509 -req -sha256 -in "$tmp/leaf.csr" -CA "$ca_crt" -CAkey "$ca_key" -CAcreateserial \
    -CAserial "$tmp/ca.srl" -days "$days" -extfile "$tmp/leaf.cnf" -extensions ext -out "leaf-$stem.pem" 2>/dev/null
}

leaf host.example.ts.net 36500 host.example.ts.net
leaf wildcard.example.com 36500 '*.example.com'
leaf dash.example.com 36500 dash.example.com
leaf a.test 36500 a.test
leaf b.test 36500 b.test
leaf c.test 36500 c.test
leaf x.test 36500 x.test
leaf 90d-host.example.ts.net 90 host.example.ts.net

for f in leaf-*.pem; do
  case "$f" in *-key.pem) continue ;; esac
  openssl verify -CAfile "$ca_crt" "$f" >/dev/null
done
echo "fixtures regenerated"
