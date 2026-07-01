# Deploy runbook

How the live boarding-pass service is hosted, how to redeploy, and the gotchas
learned getting it working end-to-end. Companion to [`cert-day.md`](./cert-day.md)
and [`dev-machine-setup.md`](./dev-machine-setup.md) (developing on a second machine).

## Topology

```
iPhone / browser
   │  https://boardingpass.geloflix.com         (public DNS → home WAN; split-DNS/WireGuard → NPM on LAN)
   ▼
Nginx Proxy Manager  (separate LXC, ~10.1.2.154)  — Let's Encrypt TLS, proxies to ↓
   ▼
App LXC  10.1.2.237 : 4317   (Ubuntu, pm2 process "boardingpass")
   └─ Express serves BOTH the built SPA and /api on one port
   └─ APNs push is OUTBOUND from here → api.push.apple.com:443
```

One Express process (`apps/server`) serves the designer SPA (`apps/designer/dist`)
**and** the API on **port 4317**, so a single origin covers the UI, `/api`, and the
pass `webServiceURL` callbacks.

## Access model (who can reach what)

`apps/server/src/middleware/guard.js`:

- **`/api/wallet/*`** (Apple PassKit web service) — **public**. Safe: each call is
  authenticated per-pass by the `ApplePass {authenticationToken}` header.
- **Everything else** (SPA, `/api/build`, `/api/passes`, `/api/fixtures`, `/api/profile`)
  — **LAN / VPN only**, or a remote client with **admin Basic Auth**. So the public
  internet can't mint or edit passes, but you can use the configurator over WireGuard
  (your VPN IP is in a private range) or from the LAN.

Requires `app.set("trust proxy", 1)` so the real client IP is read from NPM's
`X-Forwarded-For`. Private ranges allowed: `10/8`, `192.168/16`, `172.16–31`,
loopback, IPv6 ULA (`fc/fd`).

## Environment (`/opt/boardingpass/.env` — NOT in git)

```ini
CERT_PROFILE=prod
PASS_TYPE_ID=pass.com.angelo.airline.boardingpass   # must match the signing cert
TEAM_ID=WB7K79MCZG                                   # must match the signing cert
ORG_NAME=EVA Air
PORT=4317
WEB_SERVICE_URL=https://boardingpass.geloflix.com/api/wallet
ADMIN_USER=gelo
ADMIN_PASSWORD=<set-a-strong-password>               # remote Basic-Auth for the configurator
# KEY_PASSPHRASE=<only if the signer key is encrypted>
```

The server **forces** `passTypeId`/`teamId` from this env onto every issued pass, so
any pass (not just the EVA fixture) installs on a device.

## Secrets that live ONLY on the box (gitignored)

- `certs/prod/{signerCert,signerKey,wwdr}.pem` — Apple Pass Type ID cert (signs passes
  **and** authenticates to APNs). See [`cert-day.md`](./cert-day.md).
- `.env` — the file above.
- `state/passes.sqlite` — issued passes + device registrations (SQLite, via
  `node:sqlite`). A legacy `state/passes.json` is imported once on first boot
  (a timestamped `.bak` is written) and then ignored.
- `node_modules/`, `apps/designer/dist/` — build artifacts.

## Fast redeploy (from your dev machine)

The SPA bundle is gitignored, so build it locally and ship `dist`. The box runs
production deps only (no Vite), so **always rebuild the bundle on the dev machine**:

```bash
# from the repo root
npm run build:designer                                   # → apps/designer/dist (hashed bundle)

rsync -az --exclude '.env' --exclude node_modules apps/server/ \
  root@10.1.2.237:/opt/boardingpass/apps/server/          # server code (never overwrites .env)
# Workspace packages: the server imports @wpd/pass-builder + @wpd/pass-schema through
# node_modules symlinks into packages/, so changes there MUST ship too — a server-only
# rsync leaves the builder/schema code stale on the box.
rsync -az --delete --exclude node_modules packages/pass-builder/ \
  root@10.1.2.237:/opt/boardingpass/packages/pass-builder/
rsync -az --delete --exclude node_modules packages/pass-schema/ \
  root@10.1.2.237:/opt/boardingpass/packages/pass-schema/
rsync -az --delete apps/designer/dist/ \
  root@10.1.2.237:/opt/boardingpass/apps/designer/dist/    # built SPA

# if package.json deps changed, refresh them on the box:
ssh root@10.1.2.237 'cd /opt/boardingpass && npm install --omit=dev'

ssh root@10.1.2.237 'pm2 restart boardingpass'
```

> Ship every layer you touched: `apps/server/` for API code, `packages/` for builder/schema
> changes (the server runs that code via workspace symlinks), and rebuilt `dist/` for the SPA.
> Static files are served from disk — no restart needed for dist-only changes, but a restart
> is harmless.

## From scratch (fresh box)

```bash
# 1. Node 24 + tooling  (the store uses built-in node:sqlite — needs Node >= 24)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs rsync
npm install -g pm2

# 2. Get the code
git clone git@github.com:angeloslvrs/wallet-designer.git /opt/boardingpass
cd /opt/boardingpass

# 3. Add the secrets that aren't in git
#    - drop certs/prod/{signerCert,signerKey,wwdr}.pem  (see cert-day.md)
#    - create .env  (see "Environment" above)

# 4. Install + build (full deps here so Vite is available to build the SPA)
npm install
npm run build:designer

# 5. Run under pm2, persist across reboots
pm2 start npm --name boardingpass --cwd /opt/boardingpass -- run start
pm2 save
pm2 startup systemd -u root --hp /root      # run the command it prints, if any

# 6. Smoke test on the box
curl -fsS http://127.0.0.1:4317/api/profile   # → {"profile":"prod",...}
```

## Nginx Proxy Manager (the proxy LXC)

Proxy Host:

| Field | Value |
|---|---|
| Domain | `boardingpass.geloflix.com` |
| Scheme | `http` |
| Forward Hostname/IP | `10.1.2.237` |
| Forward Port | `4317` |
| SSL | request Let's Encrypt cert · Force SSL · HTTP/2 |

One bit of custom config is **required**: open the proxy host → **Advanced → Custom Nginx
Configuration** and set `proxy_buffering off;`, or the SPA bundle is truncated over the
domain (see the `proxy_buffering` entry under "Hard-won gotchas"). Otherwise defaults are
fine: nginx forwards the `Authorization` header (required by the PassKit callbacks) and
`DELETE` by default. Ports: public **80** (ACME) + **443**
forward to the NPM LXC; NPM → `10.1.2.237:4317` internally; outbound **443** from the
app box → `api.push.apple.com`.

## Hard-won gotchas (don't regress these)

- **The box must be on Node >= 24.** The pass store uses built-in `node:sqlite`, absent on
  Node <= 22 — the server crash-loops on boot there. Upgrade a live box with no downtime
  (the running app keeps its in-memory binary through the apt step):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
  pm2 update          # respawns the pm2 daemon under the new Node, then restarts the app
  ```
  On first boot under the SQLite store, the legacy `state/passes.json` is imported once
  (a timestamped `.bak` is written) — `GET /api/passes` should return the same record count
  it had before.
- **gzip is mandatory.** `app.use(compression())` — without it nginx buffers the ~1.4 MB
  JS bundle to a temp file that fails, delivering a **0-byte body** with the full
  `Content-Length` → the SPA shows only a skeleton over the domain. Compression shrinks the
  body, but is **not** sufficient on its own — the proxy still buffers (see next gotcha).
- **`proxy_buffering off;` on the NPM proxy host is mandatory** (proxy host → **Advanced →
  Custom Nginx Configuration**). Even with gzip on, nginx buffers the proxied bundle; once it
  overflows the in-memory proxy buffers it spills to a temp file, and when that write fails the
  response is truncated mid-stream. The browser logs `ERR_INCOMPLETE_CHUNKED_ENCODING`, the SPA
  module never finishes parsing, and you get the static HTML shell with a **blank form**. `curl`
  and the direct `:4317` path look fine — nothing buffers them, and a fast reader drains the
  socket before the spill — which makes this easy to misdiagnose. Config:
  ```nginx
  proxy_buffering off;
  proxy_request_buffering off;   # optional — also lets large .pkpasstemplate uploads stream
  ```
  **Do NOT add `proxy_http_version 1.1;` here.** NPM already emits it per proxy host, so a second
  copy is a duplicate directive → `nginx: [emerg] "proxy_http_version" directive is duplicate` →
  `nginx -t` fails → *none* of the custom config loads and the site stays broken until removed.
- **`index.html` must be `no-cache`; hashed assets `immutable`.** And the SPA fallback
  must **404 missing assets** (not return `index.html`) — otherwise a stale cached
  `index.html` requesting an old bundle hash gets HTML back, runs it as JS, and the app
  silently dies.
- **Busting a poisoned client cache** when bundle *content* is unchanged needs a real
  byte change (a comment gets minified away — use a runtime side effect) so the content
  hash changes and clients fetch a new URL.
- **Seat semantics:** only emit `seatNumber` (full seat, e.g. `38K`). Emitting a stale
  `seatRow`/`seatSection` that disagrees with the number made iOS render `3838`.
- **`authenticationToken` is stable per serial.** Re-issuing must NOT rotate it, or the
  copy already on a device 401s every update.

## Operations

```bash
ssh root@10.1.2.237 'pm2 logs boardingpass'                 # watch requests / APNs pushes
ssh root@10.1.2.237 'pm2 restart boardingpass'              # restart
ssh root@10.1.2.237 'rm /opt/boardingpass/state/passes.sqlite* && pm2 restart boardingpass'   # wipe issued passes
```

## Demo flow

1. **Designer** (on LAN, or over VPN, or with Basic Auth): fill the form, or load a
   **template**, or **Save template** for reuse.
2. **Trip** panel: add passengers → **Issue whole trip** → an **Add to Wallet** button
   per passenger.
3. Build the demo schedule near "now" so the **Live Activity** appears:
   `node scripts/build-pass.js --in fixtures/eva-br262.json --now`
4. **Manage** tab: per-pass and whole-trip **gate / delay** push, **edit**, **delete**.
5. Push delivery + the device fetching the updated pass are visible in `pm2 logs`.
