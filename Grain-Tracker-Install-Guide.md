# Grain Tracker — Complete Install Guide
### From a brand-new VPS to a running application, step by step

**Who this is for:** anyone, even if you've never touched a server before.
**Time needed:** about 30–45 minutes (most of it is waiting for installs).
**What you'll end up with:** Grain Tracker running on your own server, reachable from a web browser, with automatic backups and security hardening.

---

## What you need before starting

| # | Thing | Where you get it |
|---|-------|------------------|
| 1 | A VPS running **Ubuntu 24.04** (fresh install) | Your VPS provider (Hostinger, DigitalOcean, Vultr, Hetzner…) — choose "Ubuntu 24.04" when creating it |
| 2 | The server's **IP address** (looks like `203.0.113.50`) | Shown in your VPS provider's control panel |
| 3 | The **root password** (or SSH key) | Also from your VPS provider's panel |
| 4 | **Bitvise SSH Client** or **PuTTY** on your Windows PC | Free download — google "Bitvise SSH Client download" |
| 5 | The Grain Tracker source code on GitHub | `https://github.com/kurtimas/GTv9` (public — the script clones it for you) |

> **Two passwords matter in this guide.** The **server login password**
> (for the `vpsadmin` Linux account — you choose it in Part 3) and the
> **app admin password** (the installer generates it and prints it once —
> it unlocks admin actions inside the web app, like adding sites and bins).
> They are different on purpose.

---

## PART 1 — Log into your server for the first time

1. Open **Bitvise** (or PuTTY).
2. Fill in:
   - **Host:** your server IP (e.g. `203.0.113.50`)
   - **Port:** `22`
   - **Username:** `root`
   - **Password:** the root password from your VPS provider
3. Click **Login** (Bitvise) or **Open** (PuTTY).
4. The first time, it asks if you trust the server's fingerprint — click **Yes / Accept**.
5. You now see a black terminal window with a prompt like:
   ```
   root@kbot:~#
   ```
   You're in. Everything below happens in this window unless stated otherwise.

> **Typing tips:** paste into the terminal with **right-click** (not Ctrl+V).
> Commands are case-sensitive. Press **Enter** after each one.

---

## PART 2 — Put the setup script on the server

The setup script does all the heavy lifting (about 10 automated steps).

1. Create the file:
   ```bash
   nano gtv8-vps-setup.sh
   ```
2. A text editor opens. **Paste the entire contents** of `gtv8-vps-setup.sh`
   (from the repo) into the window — in Bitvise's terminal, **right-click** to paste.
3. Save and exit: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

---

## PART 3 — Edit the settings that matter

1. Open the script:
   ```bash
   nano gtv8-vps-setup.sh
   ```
2. Scroll to the **CONFIG** block near the top (use Page Down) and set:

   | Setting | What to do |
   |---------|------------|
   | `DOMAIN` | Pre-filled with `grain.kurt.wtf`. **If you don't have that domain, set `DOMAIN=""` now** — the no-domain and domain paths differ (ports, HTTPS), and adding a domain later means re-running this script with it set. |
   | `TIMEZONE` | Set to your elevator's zone (e.g. `America/Chicago`). The daily report and end-of-day close follow it. |
   | `ADMIN_USER` | The everyday Linux login account (default `vpsadmin` is fine). |

3. **The server login password is asked when the script runs.** Either wait
   for the prompt, or pre-set it and run in one go:
   ```bash
   ADMIN_PASSWORD='MyOwnStrongPassword!2026' ./gtv8-vps-setup.sh
   ```
   (This is the Linux account password — write it down.)

4. Save and exit: **Ctrl+O**, **Enter**, **Ctrl+X**.

---

## PART 4 — Run the installer

1. Make it executable and run it:
   ```bash
   chmod +x gtv8-vps-setup.sh
   ./gtv8-vps-setup.sh
   ```
   (Or the one-liner from Part 3 with `ADMIN_PASSWORD` set.)

2. You'll see green progress banners:
   ```
   ==> 1/10  System update + essentials
   ==> 2/10  Admin user: vpsadmin
   ==> 3/10  Hardening: UFW + fail2ban + SSH
   ==> 4/10  XFCE4 desktop + XRDP
   ==> 5/10  Docker CE + Compose plugin
   ==> 6/10  Cloning repo
   ==> 7/10  Generating stack in /opt/gtv9-deploy
   ==> 8/10  Building app
   ==> 9/10  systemd auto-start + update helper
   ==> 10/10  Backups + HTTPS
   ```

   **Steps 4–8 take the longest** (GUI packages + Docker build) — 10 to 20 minutes
   of scrolling text is normal. Don't close the window.

   When step 7 prints the **APP admin password**, copy it down — it is shown
   once and stored in `/opt/gtv9-deploy/.env` (you can always find it later
   with `sudo grep ADMIN_PASSWORD /opt/gtv9-deploy/.env`). Note: while
   `ADMIN_PASSWORD` is unset or left at the default `grain-admin`, the app's
   admin gate is OPEN and admin actions (sites, farmers, lots, bins, sync
   settings) ask for no password at all — the generated non-default password
   is what turns the gate on. Step 7 also prints a **SYNC_KEY**: save it too —
   it's the shared secret the main-office portal requires before it accepts
   any end-of-day sync (the office refuses all syncs without it).

3. **⚠️ If you see this error, just wait:**
   ```
   E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process ... (unattended-upgr)
   ```
   A fresh Ubuntu server runs its own security updates at first boot and blocks
   the installer. Wait 2–5 minutes, then re-run — the script is safe to re-run.

4. When it finishes you'll see a summary box:
   ```
   ================================================================================
     GRAIN TRACKER v2 — VPS SETUP COMPLETE
   ================================================================================
     Server IP  : <your IP>
     Admin user : vpsadmin
     SSH        : <IP>:22
     GUI        : <IP>:3389
     App        : https://grain.kurt.wtf     (or http://<IP>:3000 without a domain)
   ================================================================================
   ```

---

## PART 5 — Switch to your admin account (important!)

The installer **disabled root login** for security. Before closing your current
window, prove the new account works:

1. Open a **new** Bitvise/PuTTY window (keep the old one open!).
2. Log in with:
   - **Host:** same server IP
   - **Username:** `vpsadmin`
   - **Password:** the password you chose in Part 3
3. If you get a prompt like `vpsadmin@kbot:~$` — success. Close the root window.
4. From now on, always log in as `vpsadmin`. Commands that need admin powers
   start with `sudo` (it will ask for your password).

> **Fix permissions once** (the installer created some files as root):
> ```bash
> sudo chown -R vpsadmin:vpsadmin /opt/GTv9 /opt/gtv9-deploy
> git config --global --add safe.directory /opt/GTv9
> ```

---

## PART 6 — Open the application

### Without a domain (you set `DOMAIN=""` in Part 3)

Open any browser and go to:

```
http://YOUR-SERVER-IP:3000
```

You should see the **Grain Tracker** dashboard (light "field-day" theme,
dark sidebar).

### With a domain (you set `DOMAIN` in Part 3)

The installer already opened ports 80/443, installed Caddy with a free
HTTPS certificate, and bound the app to localhost behind it. Just make sure
your DNS A record points at the VPS, then browse to **`https://<your-domain>`**.

> **Adding or changing a domain later:** nothing reads `DOMAIN` from the
> `.env` file — edit `DOMAIN` in the script's CONFIG block and re-run the
> script (it is safe to re-run; your data and secrets are kept).

> **Why the domain matters:** browsers only let a page talk to a USB scale
> over **HTTPS** (or localhost). With the domain, any scale-house PC running
> Chrome or Edge can use the scale. Without it, only a browser on the VPS
> desktop itself can.

---

## PART 7 — (Optional) Remote desktop GUI

The installer set up a lightweight **XFCE4** desktop:

1. On Windows, press **Win+R**, type `mstsc`, press Enter.
2. **Computer:** your server IP → **Connect**.
3. Log in as `vpsadmin` (session type: **Xorg**).
4. Useful for running the app in a browser *on the server itself*
   (`http://localhost:3000`), which is one way to use a USB scale attached
   to the VPS.

---

## PART 8 — First run inside the app

Do this once, in order (in the web app). The **app admin password** (from
Part 4) unlocks site, bin, people, and lot changes.

1. **Site admin** (sidebar, bottom) → unlock with the admin password → add
   your **site** (elevator/location).
2. **Bins** page → add your **bins** with crop type and capacity (bushels
   or lbs — it converts).
3. **Farmers & Lots** page → add **farmers**, then their **lots**
   (lot codes auto-suggest, e.g. `706C-KM-26-01`). Attach a **landlord** +
   split % for crop-share lots.
4. **Dashboard** → open your first **weight sheet** and weigh a truck:
   - Click **Connect USB scale** (scale plugged in) or **Simulator**
     (to practice), or type weights manually.
   - Enter the **truck ID**, **WEIGH IN** (gross) → truck dumps →
     **WEIGH OUT** (tare).
   - The app computes net lbs → bushels (with moisture shrink + dockage),
     auto-assigns the least-filled matching bin, and updates inventory.
5. **Reports** page → end of day: review totals, then **Close day** to lock
   the day's sheets. (It refuses while a truck is still mid-weigh — finish
   or void that load first.)

---

## PART 9 — Day-to-day cheat sheet

Run these on the VPS (logged in as `vpsadmin`):

| Task | Command |
|------|---------|
| See if it's running | `docker ps` |
| Live app logs | `docker logs -f grain-tracker` (Ctrl+C to stop watching) |
| Restart the app | `cd /opt/gtv9-deploy && docker compose restart app` |
| Update to latest code from GitHub | `sudo grain-update` |
| Find the app admin password | `sudo grep ADMIN_PASSWORD /opt/gtv9-deploy/.env` |
| Find the office sync key (`SYNC_KEY`) | `sudo grep SYNC_KEY /opt/gtv9-deploy/.env` |
| Manual database backup | `sudo grain-backup` |
| Find backups (nightly, kept 14 days) | `ls /var/backups/grain-tracker` |
| Check auto-start service | `sudo systemctl status grain-tracker` |
| Reboot the whole server | `sudo reboot` — **the app starts itself** |

**Copy backups off the server weekly.** In Bitvise, open the **SFTP** window,
browse to `/var/backups/grain-tracker/`, and download the newest `.sql.gz` file
to your PC. If the server ever dies, that file plus this guide rebuilds everything.

---

## Troubleshooting — the errors people actually hit

| Symptom | Fix |
|---------|-----|
| `Could not get lock /var/lib/dpkg/lock-frontend` | Ubuntu is self-updating. Wait 2–5 min, re-run the script. |
| `fatal: detected dubious ownership in repository` | `git config --global --add safe.directory /opt/GTv9` |
| `permission denied` on `/opt/gtv9-deploy/.env` | `sudo chown -R vpsadmin:vpsadmin /opt/GTv9 /opt/gtv9-deploy` |
| Git asks for a password / `Invalid username or token` | The URL is wrong. Fix it: `git -C /opt/GTv9 remote set-url origin https://github.com/kurtimas/GTv9.git` — the repo is public, pulling needs no login. |
| App URL loads but "Offline" banner shows | Database is still starting (first boot takes ~1 min). Wait and refresh. Still stuck: `docker logs grain-mysql`. If the app keeps restarting, `docker logs grain-tracker` — by design it refuses to start without MySQL (so tickets are never written to a throwaway local database). |
| `http://IP:3000` doesn't load but the domain works | Expected when `DOMAIN` is set — the app is bound to localhost behind Caddy. Use `https://<your-domain>`, or re-run with `DOMAIN=""`. |
| "Admin password required" in the app | The admin gate is only on when `ADMIN_PASSWORD` in `/opt/gtv9-deploy/.env` is set to a non-default value. Use that password (`sudo grep ADMIN_PASSWORD /opt/gtv9-deploy/.env`); five wrong tries lock it out for a minute. To open the gate (no password asked), remove the variable or set it to `grain-admin` and `docker compose restart app`. |
| Office portal shows no data / scale house "Sync now" fails with 503 | The office is missing its `SYNC_KEY` (it refuses all syncs without one — fail-closed). Set `SYNC_KEY` in the office's environment to the value from `sudo grep SYNC_KEY /opt/gtv9-deploy/.env`, and put the same value in the app's Settings → Main-office sync. |
| Can't log in as root anymore | Working as intended! Use `vpsadmin`. |
| USB scale button says "Web Serial not available" | Use **Chrome or Edge**, and the page must be **HTTPS** (domain) or **localhost**. Plain `http://<ip>:3000` from another PC won't work — set up the domain (Part 6). |
| Forgot `vpsadmin` password | Log in via your VPS provider's web console as root, then `passwd vpsadmin`. |

---

## Appendix — What got installed (for the curious)

- **Ubuntu 24.04** hardened: UFW firewall (only SSH/RDP/web ports open),
  fail2ban (blocks password-guessing bots), root SSH disabled,
  automatic security updates.
- **XFCE4 + XRDP**: lightweight remote desktop.
- **Docker CE**: runs the two containers:
  - `grain-tracker` — the app (Node 20, non-root, health-checked; built from the repo root via `app/Dockerfile` — the build context must be `/opt/GTv9`, not `/opt/GTv9/app`)
  - `grain-mysql` — MySQL 8 database with a persistent data volume
- **systemd service** `grain-tracker.service` — auto-starts the stack on boot.
- **`grain-update`** — one command to pull the newest code and rebuild.
- **`grain-backup`** — nightly `mysqldump` at 01:00 into
  `/var/backups/grain-tracker`, 14 days kept.
- **Caddy** (only if `DOMAIN` set) — automatic free HTTPS certificate.
