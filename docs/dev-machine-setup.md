# Developing on a second machine

How to pick up this project on another box (e.g. the Mac mini) and where the
live pieces are. This carries the **environment/topology** facts that the code
can't; for the deploy runbook see [`deploy.md`](./deploy.md), for the real
signing cert see [`cert-day.md`](./cert-day.md), and for the feature/roadmap
handoff see [`../HANDOFF.md`](../HANDOFF.md).

## Machine map (home LAN `10.1.2.0/24`)

| Role | Host | Notes |
|---|---|---|
| Primary dev (macOS) | this laptop | holds the **prod** signing cert + prod `.env` |
| Second dev (macOS) | `mac-mini.local` → `10.1.2.233` (`angelo@`) | Homebrew Node 26, git, clone under `~/Documents/fun-stuff/wallet-designer` |
| **Prod app** (LXC) | `10.1.2.237:4317` | `root@`, pm2 process `boardingpass`, code at `/opt/boardingpass` (rsync-managed, **no git**) |
| Reverse proxy (LXC) | `~10.1.2.154` | Nginx Proxy Manager, Let's Encrypt TLS → forwards to `10.1.2.237:4317` |
| Public URL | `https://boardingpass.geloflix.com` | split-DNS/WireGuard on LAN; public DNS → home WAN |

> **Reaching the LAN boxes from off-network needs the WireGuard VPN on.** All
> `10.1.2.x` SSH/HTTP is only routable over the LAN or the VPN.

## Repo & sync

- Remote: `git@github.com:angeloslvrs/wallet-designer.git`, branch **`main`**.
- Workflow is **direct commits to `main`** (personal project — no PR gate). Pull
  before you start; the two dev machines drift otherwise.
- The prod box has **no git** — it's rsync-managed from a dev machine (see
  [`deploy.md`](./deploy.md) "Fast redeploy").

## Local dev setup (per machine)

Needs **Node ≥ 24** (the store uses built-in `node:sqlite`).

```bash
git clone git@github.com:angeloslvrs/wallet-designer.git
cd wallet-designer
npm install
cp .env.example .env      # dev profile (CERT_PROFILE=dev)
npm run init              # one-time: self-signed dev cert + placeholder assets (required before any build)
npm run dev               # designer SPA :4318 + API :4317
npm test                  # vitest run — confirms the toolchain is healthy
```

## Profiles: dev vs prod

`CERT_PROFILE` in `.env` selects the signing cert:

- **`dev`** (default, from `npm run init`): self-signed. Builds + signs so tests
  and the designer work, **but passes won't install on a real iPhone.** Fine for
  all development that isn't on-device.
- **`prod`**: real Apple Pass Type ID cert. Signs installable passes **and**
  authenticates to APNs. Only lives on this laptop and the prod box.

### To give a dev machine prod signing (optional)

Not needed for normal dev. To sign real passes / deploy from another machine,
copy the gitignored secrets from a machine that already has them:

```bash
# from a machine that has certs/prod + prod .env:
scp .env <user>@<host>:~/…/wallet-designer/.env                       # sets CERT_PROFILE=prod, PASS_TYPE_ID, TEAM_ID, WEB_SERVICE_URL
scp certs/prod/{signerCert,signerKey,wwdr}.pem <user>@<host>:~/…/wallet-designer/certs/prod/
```

Prod identity values (`PASS_TYPE_ID`, `TEAM_ID`, `WEB_SERVICE_URL`, admin creds)
are documented in [`deploy.md`](./deploy.md) "Environment".

## Secrets — never in git, where they live

| Secret | Lives on | Regenerable? |
|---|---|---|
| `certs/dev/*.pem` | any machine, via `npm run init` | ✅ yes |
| `certs/prod/{signerCert,signerKey,wwdr}.pem` | this laptop + prod box | ❌ real Apple cert — copy it |
| `.env` (prod values) | this laptop + prod box | ❌ copy it |
| `state/passes.sqlite` | prod box (authoritative) + each machine's own dev store | issued passes + device registrations |

## Deploying (from a dev machine → prod box)

Full runbook in [`deploy.md`](./deploy.md). The short version:

```bash
npm run build:designer      # build the SPA bundle locally (box has prod deps only)
# rsync apps/server/, packages/pass-builder/, packages/pass-schema/, apps/designer/dist/
#   to root@10.1.2.237:/opt/boardingpass/  (see deploy.md for exact commands)
ssh root@10.1.2.237 'pm2 restart boardingpass'
```

Ship **every layer you touched**: `apps/server/` for API code, `packages/` for
builder/schema (the server runs them via workspace symlinks), and rebuilt
`dist/` for the SPA.
