#!/bin/sh
# Generate the overlay LISTENER certificate set into the shared `acme-certs`
# volume (/certs): a throwaway root (root.pem), a leaf for pebble.test
# (pebble.pem / pebble.key) and a leaf for acme-dns.test (acme-dns.pem /
# acme-dns.key, the acme-dns double's HTTPS listener). The dashboard trusts
# root.pem through NODE_EXTRA_CA_CERTS so acme-client can reach
# https://pebble.test:14000/dir and the solver https://acme-dns.test:8443.
# Generated per harness, never committed; the root key is deleted after
# signing. Idempotent: an existing set is kept (the volume dies with `down -v`).
# Pebble's ISSUING root is a different, random one per Pebble start:
# https://pebble.test:15000/roots/0. See change: add-acme-dns01-certs (D10).
set -eu
cd /certs
if [ -s root.pem ] && [ -s pebble.pem ] && [ -s pebble.key ] && [ -s acme-dns.pem ] && [ -s acme-dns.key ]; then
  echo "[acme-certs] reusing existing listener certs"
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout root.key -out root.pem \
  -subj "/CN=pi-dashboard e2e pebble listener root" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

# leaf <name>: <name>.key + <name>.pem.tmp for <name>.test, signed by the root.
leaf() {
  openssl req -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$1.test"
  printf '%s\n' "subjectAltName=DNS:$1.test,DNS:$1,DNS:localhost,IP:127.0.0.1" \
    "basicConstraints=CA:FALSE" "keyUsage=digitalSignature,keyEncipherment" \
    "extendedKeyUsage=serverAuth" > ext.cnf
  openssl x509 -req -days 30 -in "$1.csr" -CA root.pem -CAkey root.key -CAcreateserial \
    -extfile ext.cnf -out "$1.pem.tmp"
  rm -f "$1.csr" ext.cnf
  chmod 644 "$1.key" "$1.pem.tmp"
}
leaf acme-dns
leaf pebble
rm -f root.key root.srl
chmod 644 root.pem
mv acme-dns.pem.tmp acme-dns.pem
mv pebble.pem.tmp pebble.pem # written last: presence means a complete set
echo "[acme-certs] generated listener root + pebble.test + acme-dns.test leaves"
