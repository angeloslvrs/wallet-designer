#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="certs/dev"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/signerCert.pem" ]; then
  echo "Dev cert already exists at $CERT_DIR. Delete it manually to regenerate."
  exit 0
fi

echo "→ Generating self-signed CA (stands in for Apple WWDR)…"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$CERT_DIR/ca.key" \
  -out    "$CERT_DIR/wwdr.pem" \
  -subj "/C=US/O=Local Dev/CN=Local Dev WWDR" \
  -addext "basicConstraints=critical,CA:TRUE" 2>/dev/null

echo "→ Generating leaf signing cert (Pass Type ID: pass.dev.local)…"
openssl req -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/signerKey.pem" \
  -out    "$CERT_DIR/signer.csr" \
  -subj "/C=US/O=Rocket Partners/UID=pass.dev.local/CN=Pass Type ID: pass.dev.local" 2>/dev/null

openssl x509 -req -in "$CERT_DIR/signer.csr" \
  -CA "$CERT_DIR/wwdr.pem" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/signerCert.pem" \
  -days 825 2>/dev/null

rm -f "$CERT_DIR/signer.csr" "$CERT_DIR/ca.key" "$CERT_DIR"/*.srl

echo "✓ Dev cert written to $CERT_DIR/"
echo "  - signerCert.pem"
echo "  - signerKey.pem"
echo "  - wwdr.pem"
