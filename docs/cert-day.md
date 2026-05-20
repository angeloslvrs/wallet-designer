# Cert Day Runbook

When the Apple Developer account is in hand, follow these steps to swap from the self-signed dev cert to a real Apple-issued Pass Type ID cert. **No code changes are required.**

## Prerequisites

- Apple Developer account in good standing.
- Access to a Mac with Keychain (CSR generation must happen there).
- OpenSSL CLI.

## Steps

### 1. Register a Pass Type ID

1. Go to https://developer.apple.com/account/resources/identifiers/list/passTypeId.
2. Click `+`, choose **Pass Type IDs**, continue.
3. Description: e.g. "Rocket Partners Boarding Pass".
4. Identifier: `pass.com.rocketpartners.airline.boardingpass` (must begin with `pass.`).
5. Save.

### 2. Generate a CSR on your Mac

1. Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**.
2. Email: your Apple ID.
3. Common Name: `pass.com.rocketpartners.airline.boardingpass`.
4. Choose **Saved to disk** + **Let me specify key pair information**. Continue.
5. Key size: 2048-bit RSA, algorithm: RSA. Save the `.certSigningRequest`.
6. Keychain Access will create a key pair in your Login keychain.

### 3. Upload the CSR and download the cert

1. Back on developer.apple.com, click your Pass Type ID, then **Create Certificate**.
2. Upload the CSR. Download the resulting `pass.cer`.

### 4. Export the private key from Keychain

1. In Keychain Access, find the private key paired with the CSR (it has the same Common Name as the request).
2. Right-click → **Export**. Choose `.p12` format. Set a passphrase.
3. Convert to PEM:

```bash
openssl pkcs12 -in pass.p12 -out signerKey.pem -nodes -clcerts -legacy
# the file will contain both the cert and the key; trim to just the key block if necessary
```

### 5. Convert the Pass Type ID Certificate to PEM

```bash
openssl x509 -inform DER -in pass.cer -out signerCert.pem
```

### 6. Download Apple's WWDR intermediate

The current generation is **WWDR G4**.

```bash
curl -o wwdr.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in wwdr.cer -out wwdr.pem
```

### 7. Drop the three PEMs into `certs/prod/`

```
certs/prod/
├── signerCert.pem
├── signerKey.pem
└── wwdr.pem
```

### 8. Update `.env`

```
CERT_PROFILE=prod
PASS_TYPE_ID=pass.com.rocketpartners.airline.boardingpass
TEAM_ID=ABCDE12345   # your Team ID from the developer portal
KEY_PASSPHRASE=<the passphrase you set in step 4, if any>
```

Also update `fixtures/*.json` (or the form state in the SPA): `meta.passTypeId` and `meta.teamId` must match the real values.

### 9. Sanity check

```bash
npm run cert:inspect
```

The output's "Subject" line must contain your real Pass Type ID; the "Issuer" must reference **Apple WWDR**.

### 10. Build a real pass

```bash
npm run build:pass -- --in fixtures/fully-loaded.json
```

AirDrop or email the resulting `out/fully-loaded.pkpass` to your iPhone. Tap to add to Wallet.

## Gotchas

- **CSR must be generated on the same Mac the private key will live on.** If you move the `.p12` to a different machine, that's fine, but the original key pair was created in that Mac's Keychain.
- **WWDR generation matters.** Apple has issued multiple WWDR intermediates (G2, G3, G4, G6). G4 is current as of this writing. Using the wrong one breaks the trust chain.
- **PassTypeId must match.** The `passTypeIdentifier` value in `pass.json` (set from `meta.passTypeId` in form state) must equal the Pass Type ID you registered. If they disagree, Wallet rejects the pass.
- **Don't commit the PEMs.** `certs/prod/` is in `.gitignore`. Use a password manager or your team's secret store.
