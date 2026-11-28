# Deploying Deal Search on the LAN Proxmox VM

The app runs as one Docker container on a Proxmox VM on the home LAN. Stores see the home Saudi
residential IP, so they serve their KSA storefronts. There is **no login and there are no rate
limits** (owner decision, see the design spec). The per-store caches and the blocked-store
back-offs stay: they protect against store blocking and do not limit users.

noon and SHEIN need a real, headed Google Chrome. **That Chrome runs inside the container** on a
virtual display (Xvfb `:99`), with its profile on the data volume. Nothing on the VM desktop or on
your PC is used.

## The VM

| Item | Value |
|---|---|
| Proxmox VM | 300 `deal-search`, start at boot (onboot=1) |
| Resources | 4 vCPU, 4 GB RAM, 40 GB disk |
| OS | Ubuntu 24.04 LTS, Docker 29 + docker compose v5 |
| Address | 192.168.1.48 (give it a DHCP reservation) |
| User | `deploy` (sudo, in the `docker` group) |
| SSH from the PC (Git Bash) | `ssh -i ~/.ssh/deal_search_proxmox deploy@192.168.1.48` |
| App folder | `/home/deploy/deal-search` (code + `.env`; no data) |
| Data | Docker volume `deal-search_deal-data`, mounted at `/data` in the container |
| URL | `http://192.168.1.48:3000` |

To create a similar VM: on Proxmox, create a VM (q35, VirtIO SCSI, 4 cores, 4096 MB, 40 GB),
install Ubuntu Server 24.04, then install Docker from Docker's apt repository
(`docker-ce docker-ce-cli containerd.io docker-compose-plugin`), create the `deploy` user, add it to
the `docker` group and authorize your SSH key. A VM is preferred over an LXC container so Chrome
and Xvfb run without extra privileges. Set "Start at boot" in the VM's Options.

## What runs in the container

`docker/entrypoint.sh`, under `tini`:

1. starts `Xvfb :99` (1920x1080, unix socket only, access control on: a random cookie in
   `XAUTHORITY=/tmp/.deal-search-Xauthority`, which Chrome inherits) and waits for it;
2. runs `node scripts/install-specs.mjs` (copies `api-specs/` into `API_ANYTHING_HOME=/data/aa-home`
   and seeds the AliExpress KSA cookie);
3. `exec node server.js` (Next.js standalone) on `0.0.0.0:3000`.

| Path in `/data` | Content |
|---|---|
| `data.db` (+ `-wal`, `-shm`) | SQLite: history, watches, alerts, price observations (`DEAL_SEARCH_DB`) |
| `aa-home/` | API Anything home: specs, sessions, cookies (`API_ANYTHING_HOME`) |
| `noon-profile/` | noon's Chrome profile (`NOON_PROFILE_DIR`) |
| `shein-profile/` | SHEIN's Chrome profile (`SHEIN_PROFILE_DIR`) |

The container runs as the non-root `node` user. Healthcheck: `curl http://127.0.0.1:3000/api/health`
every 30 s. Logs: Docker `json-file`, 5 x 10 MB.

### Chrome sandbox (no `--no-sandbox`)

Chrome keeps its sandbox. The sandbox creates user, PID and network namespaces. Docker's default
seccomp profile blocks `clone`/`unshare`/`setns` with namespace flags unless the container has
`CAP_SYS_ADMIN`. Without a change Chrome dies at start with "Failed to move to new namespace ...
Operation not permitted" and "Zygote process exited". That was checked on this VM on 2026-11-27.
The setuid helper does not help either, because the container has no `CAP_SYS_ADMIN`.

`docker/seccomp-chrome.json` is Docker's default profile (moby/profiles `seccomp/default.json`)
with three rules appended, each marked with a `comment` starting `deal-search:`:

| Rule | Why |
|---|---|
| `clone` with arg0 `& 0x0E020000 == 0` | New user, PID and network namespaces only. `CLONE_NEWNS`, `CLONE_NEWCGROUP`, `CLONE_NEWUTS` and `CLONE_NEWIPC` stay denied. |
| `unshare` with the same mask | The same namespaces only. |
| `chroot` | Chrome's sandbox chroots to `/proc/self/fdinfo/` *inside its own user namespace*. Docker allows `chroot` only with `CAP_SYS_CHROOT`, which `cap_drop: ALL` removes. The kernel still requires that capability in the caller's namespace, so this does not let the container chroot. Without this rule Chrome dies with `Check failed: sys_chroot("/proc/self/fdinfo/") == 0`. |

`setns` is not allowed, because Chrome does not need it. `clone3` keeps Docker's ENOSYS, and
glibc falls back to `clone`.

`docker-compose.yml` also sets `no-new-privileges:true` and `cap_drop: [ALL]`. The process runs
as `node` (uid 1000) with `CapEff: 0` and `NoNewPrivs: 1`, and no capability is added back.
Checked on this VM on 2026-11-27:

- with `unshare -U`, `-U -p -f` and `-U -n` allowed, and `-U -m`, `-U -i`, `-U -u` and `-U -C`
  denied, Chrome starts sandboxed on Xvfb;
- a live noon search returns results.

The alternatives were weaker. `--no-sandbox` turns off Chrome's renderer isolation.
`seccomp=unconfined` or `cap_add: SYS_ADMIN` widen the whole container. Unrestricted
`clone`/`unshare`/`setns` also allows mount, IPC, UTS and cgroup namespaces.

If a Docker upgrade changes the default profile, regenerate the file: take the new
`default.json` and append the same three rules.

Chrome is started exactly as on the PC: the fixed free debug port on 127.0.0.1 (never port 0,
which makes `navigator.webdriver` true and gets noon's 403), headed, attached over CDP.

## First deploy (from the PC)

```bash
cd ksa-deal-search                # your clone
cp .env.example /tmp/deal.env    # then edit: APP_HOSTS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
ENV_FILE=/tmp/deal.env scripts/deploy.sh
rm /tmp/deal.env
```

`scripts/deploy.sh` packs the committed `HEAD` with `git archive` (or `WORKTREE=1` for the current
working tree), replaces `/home/deploy/deal-search` on the VM except `.env`, uploads `ENV_FILE` as
`.env` only if the VM has none (without `ENV_FILE` it copies `.env.example` and warns), runs
`docker compose up -d --build`, then polls `/api/health`.

Or by hand on the VM:

```bash
git clone <repo> ~/deal-search && cd ~/deal-search   # or copy the files
cp .env.example .env && nano .env && chmod 600 .env
docker compose up -d --build
curl -s http://127.0.0.1:3000/api/health
```

### `.env`

| Variable | Meaning |
|---|---|
| `APP_HOSTS` | Hosts the browser may use, comma-separated `host[:port]`, exact match. Loopback is always allowed. Example: `192.168.1.48:3000,deals.lan` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Price alerts by Telegram (optional) |
| `ALERT_CHECK_HOURS` | Hours between alert checks (default 6) |
| `NODE_ENV` | `production` |
| `CADDY_HOST` | Only with the `https` profile: the LAN name Caddy serves |
| `SERPAPI_KEY` | Google Shopping KSA check through SerpApi (optional). Server-only, never logged |
| `GSHOP_MONTHLY_BUDGET` | SerpApi searches the app may use per month (default 240; the free plan has 250) |

**SerpApi key.** Put `SERPAPI_KEY=...` in `.env` on the VM, next to `docker-compose.yml`, and keep
the file private: `chmod 600 .env` (owner read/write only). Then `docker compose up -d`. Without a
key, "Check other stores" uses the Chrome fallback on google.com.sa only (its own profile, 20 loads
an hour, 100 a day, 15 s apart, 2 h to 12 h back-off after a CAPTCHA). The check counts its SerpApi
searches per plan period in the SQLite file and stops at the budget; checks are capped at 30 an hour and 100 a day overall and 10 an hour per client (`429` past that); `https://serpapi.com/account.json`
(free) shows the plan's remaining searches.

`.env` is never committed and never copied into the image (`.dockerignore`).

A request whose Host is not loopback and not in `APP_HOSTS` gets 403 "Cross-site requests are not
allowed". If you open the app by a new name or port, add it to `APP_HOSTS` and run
`docker compose up -d`.

## Optional LAN HTTPS (Caddy)

Off by default. To use it, point `deals.lan` at 192.168.1.48 in the router's DNS (or each device's
hosts file), then:

```bash
# .env: APP_HOSTS=192.168.1.48:3000,deals.lan   CADDY_HOST=deals.lan
docker compose --profile https up -d
```

Caddy issues a certificate from its own internal CA. To avoid browser warnings, install its root
on each device: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt`.
Caddy passes the original Host to the app, so `deals.lan` (no port) must be in `APP_HOSTS`.

## Update

From the PC: commit, then `scripts/deploy.sh`. On the VM with a git clone:
`git pull && docker compose up -d --build`. The volume (DB, profiles, cookies) is kept.
Old images: `docker image prune -f`.

## Stop, restart, shutdown

`docker compose stop` sends SIGTERM. The app (with `NEXT_MANUAL_SIG_HANDLE` set in the image)
asks noon's and SHEIN's Chrome to quit (`Browser.close`, hard kill after 20 s), stops the alerts
timer, then closes the SQLite database, all within compose's `stop_grace_period: 30s`. Searches
still running at that moment fail. `restart: unless-stopped` brings the app back after a reboot.

## Backup and restore

On the VM:

```bash
cd ~/deal-search && scripts/backup.sh          # ~/deal-search-backups/deal-search-<stamp>.tar.gz
BACKUP_DIR=/mnt/nas KEEP=14 scripts/backup.sh
```

The DB is copied with SQLite's online `.backup` and checked with `PRAGMA integrity_check`; the rest of
`/data` is tarred without Chrome's caches. The newest 7 archives are kept. Daily at 03:30 with cron
(`crontab -e`):

```
30 3 * * * cd /home/deploy/deal-search && scripts/backup.sh >> /home/deploy/deal-search-backups/backup.log 2>&1
```

Proxmox's own VM backups (vzdump) also cover the volume.

Restore (replaces all data):

```bash
cd ~/deal-search
docker compose stop app
docker run --rm -v deal-search_deal-data:/data -v ~/deal-search-backups:/b debian:bookworm-slim \
  sh -c 'rm -rf /data/* /data/.[!.]* ; tar -xzf /b/deal-search-<stamp>.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose start app
```

## Logs and status

```bash
docker compose ps                         # STATUS shows (healthy)
docker compose logs -f --tail=200 app
curl -s http://192.168.1.48:3000/api/health   # {"ok":true,"version":"0.1.0","db":"ok","uptime":123}
docker compose exec app sh                # shell in the container
docker stats deal-search
```

## Troubleshooting

**A store shows "blocked".** The store refused the request (anti-bot page, rate class). The app
backs off that store for a while and tries again later; nothing to fix unless it persists for
days. noon and SHEIN score the profile: if one stays blocked, stop the app, move its profile aside
(`docker compose exec app mv /data/noon-profile /data/noon-profile.blocked`), start again, then
search once. Check the VM's public IP is the home connection (no VPN on the VM).

**Chrome will not start** (noon/SHEIN error "Chrome not found", "Chrome exited early",
"Chrome debug port did not open"):

- `docker compose exec app google-chrome-stable --version` must print a version.
- Try it by hand on the virtual display:
  `docker compose exec app google-chrome-stable --user-data-dir=/tmp/t --no-first-run about:blank`
  and read the error. "Failed to move to new namespace", "sys_chroot" or "Zygote process exited":
  the seccomp profile is not applied or is missing a rule. Check `docker inspect deal-search --format '{{.HostConfig.SecurityOpt}}'`
  and that `docker/seccomp-chrome.json` exists next to `docker-compose.yml`.
- "Chrome exited early (code 21)": Chrome believes the profile is used by another machine (a
  stale `SingletonLock`). The entrypoint deletes these locks at every start, and the compose file
  pins `hostname: deal-search`, so `docker compose restart app` clears it.
- Crashing tabs: `shm_size: 1gb` must be in effect (`docker compose exec app df -h /dev/shm`).

**DISPLAY / Xvfb.** The entrypoint logs "Xvfb ready on :99". If it says "Xvfb did not start", the
log lines after it say why. `docker compose exec app sh -c 'echo $DISPLAY; ls -l /tmp/.X11-unix'`
must show `:99` and a socket `X99`. Xvfb runs with access control (no `-ac`): an X client run by
hand inside the container needs `XAUTHORITY=/tmp/.deal-search-Xauthority` (the entrypoint exports it
for the server and Chrome). Never run Chrome headless to work around it: noon and SHEIN block
headless Chrome.

**403 in the browser.** The address is not in `APP_HOSTS` (see `.env`).

**Health is 503 / `"db":"error"`.** The volume is not writable or full: `docker compose exec app
ls -la /data`, `df -h` on the VM.

**Public hostname (Cloudflare Tunnel).** `cloudflared` (compose profile `tunnel`) opens an outbound-only
tunnel; no inbound port is needed. The tunnel `deal-search` is remotely managed in Cloudflare:
ingress `deals.example.com -> http://app:3000`, DNS `deals` CNAME `<tunnel-id>.cfargotunnel.com` (proxied).
On the VM: `.env` has `COMPOSE_PROFILES=tunnel` and `deals.example.com` in `APP_HOSTS`; the token is
in `.env.tunnel` (`TUNNEL_TOKEN=<token>`, mode 600), read only by `cloudflared`, never by the app.
The app has no login and no limits (owner decision), so anyone with the URL can use it: put Cloudflare Access (or another login) in front of a public hostname.

**GPU.** VM 300 has the host's GeForce GTX 1050 Ti passed through (Proxmox resource mapping
`gtx1050ti`, `hostpci0: mapping=gtx1050ti,pcie=1,rombar=0,x-vga=0`, IOMMU group 2). The guest runs the
headless NVIDIA 580 server driver (`nvidia-headless-580-server`, `nvidia-utils-580-server`; 580 is the last
branch that supports Pascal). Check: `nvidia-smi`. The app does not use the GPU (Chrome renders in software
under Xvfb); it is there for future work. VMs 9011 and 202 map the same card: only one of them can run at a time.

**Exposure.** Ports are published on IPv4 only (`${APP_BIND:-0.0.0.0}`). The VM has a global IPv6
address, and a bare `"3000:3000"` would also listen on `[::]` and be reachable from the internet.
ufw does not filter Docker-published ports. Set `APP_BIND=192.168.1.48` in `.env` to bind one address.
Check: `ss -tlnp | grep 3000` must show no `[::]` line.

**Port 3000 is taken.** Change the left side of `ports:` in `docker-compose.yml` (for example
`"8080:3000"`) and put `192.168.1.48:8080` in `APP_HOSTS`.

## Safety caps (owner ruling)

The app is public with no login; these small in-memory caps protect the server, the Telegram bot
and the stores. Normal personal use never reaches them; a restart clears them.

| What | Cap | Answer past it |
|---|---|---|
| Telegram test message | 1 per 60 s | `429 {"error":"Wait a minute before sending another test"}` |
| Price watches | 100 | `409 {"error":"You can keep up to 100 price alerts. Delete one to add another."}` |
| Re-arm one watch (new target, or POST on an existing watch) | 5 per watch per 60 s, counted after the change is stored | `429 {"error":"Wait a minute before changing this alert again"}` |
| Searches | 4 running + 8 waiting | `503 {"error":"Busy, try again in a moment"}`, `Retry-After: 5` |
| JSON request body | 8 KB, read as a stream | `413` |
| Check cycle | 100 watches, 20 Telegram alerts | the rest wait for the next cycle |
| Stored history | price points 180 days, newest 1000 alert events | pruned each cycle |

The alert checker's searches share the 4 lanes but wait instead of getting 503.
